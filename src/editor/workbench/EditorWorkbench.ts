export type EditorModuleState = "installed" | "activating" | "active" | "deactivating" | "error";

export type EditorModuleDisposer = () => void | Promise<void>;

export interface EditorModuleContext<THost> {
    readonly host: THost;
    readonly moduleId: string;
    provideService<T>(serviceId: string, service: T): void;
    requireService<T>(serviceId: string): T;
    optionalService<T>(serviceId: string): T | undefined;
    onDeactivate(disposer: EditorModuleDisposer): void;
}

export interface EditorModule<THost> {
    readonly id: string;
    readonly hotReloadable?: boolean;
    activate(
        context: EditorModuleContext<THost>,
    ): void | EditorModuleDisposer | Promise<void | EditorModuleDisposer>;
}

export interface EditorModuleSummary {
    id: string;
    state: EditorModuleState;
    hotReloadable: boolean;
    dependencies: string[];
    error: string;
}

interface EditorModuleRecord<THost> {
    module: EditorModule<THost>;
    state: EditorModuleState;
    dependencies: Set<string>;
    scope: EditorModuleScope | null;
    error: string;
}

interface EditorServiceRecord {
    ownerId: string;
    value: unknown;
}

class EditorModuleScope {
    private readonly disposers: EditorModuleDisposer[] = [];
    private disposed = false;

    add(disposer: EditorModuleDisposer): void {
        if (this.disposed) throw new Error("Cannot register cleanup after the editor module was deactivated.");
        this.disposers.push(disposer);
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        const errors: unknown[] = [];
        for (const disposer of this.disposers.reverse()) {
            try {
                await disposer();
            } catch (error) {
                errors.push(error);
            }
        }
        this.disposers.length = 0;
        if (errors.length > 0) throw new AggregateError(errors, "Editor module cleanup failed.");
    }
}

export class EditorWorkbench<THost> {
    private readonly modules = new Map<string, EditorModuleRecord<THost>>();
    private readonly services = new Map<string, EditorServiceRecord>();
    private readonly activationOrder: string[] = [];
    private operationQueue: Promise<void> = Promise.resolve();
    private started = false;
    private disposeRequested = false;
    private disposed = false;

    constructor(readonly host: THost) {}

    install(modules: EditorModule<THost>[]): void {
        if (this.started || this.disposeRequested) {
            throw new Error("Install product modules before starting the editor workbench.");
        }
        for (const module of modules) {
            this.validateModule(module);
            if (this.modules.has(module.id)) throw new Error(`Editor module ${module.id} is already installed.`);
            this.modules.set(module.id, {
                module,
                state: "installed",
                dependencies: new Set(),
                scope: null,
                error: "",
            });
        }
    }

    list(): EditorModuleSummary[] {
        return [...this.modules.values()].map((record) => ({
            id: record.module.id,
            state: record.state,
            hotReloadable: record.module.hotReloadable !== false,
            dependencies: [...record.dependencies].sort(),
            error: record.error,
        }));
    }

    start(): Promise<void> {
        if (this.disposeRequested) return Promise.reject(new Error("Editor workbench disposal was requested."));
        return this.enqueue(async () => {
            if (this.started) return;
            const activated: EditorModuleRecord<THost>[] = [];
            try {
                for (const record of this.modules.values()) {
                    await this.activateRecord(record);
                    activated.push(record);
                }
                this.started = true;
            } catch (error) {
                const rollbackErrors: unknown[] = [];
                for (const record of activated.reverse()) {
                    await this.deactivateRecord(record, false).catch((rollbackError) => {
                        rollbackErrors.push(rollbackError);
                    });
                }
                if (rollbackErrors.length > 0) {
                    throw new AggregateError(
                        [error, ...rollbackErrors],
                        `Editor workbench start failed and rollback was incomplete: ${this.formatError(error)}`,
                    );
                }
                throw error;
            }
        });
    }

    activate(moduleId: string): Promise<void> {
        this.assertOperational();
        return this.enqueue(async () => {
            await this.activateRecord(this.requireRecord(moduleId));
        });
    }

    attach(module: EditorModule<THost>): Promise<void> {
        this.assertOperational();
        return this.enqueue(async () => {
            this.validateModule(module);
            if (this.modules.has(module.id)) throw new Error(`Editor module ${module.id} is already installed.`);
            const record: EditorModuleRecord<THost> = {
                module,
                state: "installed",
                dependencies: new Set(),
                scope: null,
                error: "",
            };
            this.modules.set(module.id, record);
            try {
                await this.activateRecord(record);
            } catch (error) {
                this.modules.delete(module.id);
                throw error;
            }
        });
    }

    deactivate(moduleId: string): Promise<void> {
        this.assertOperational();
        return this.enqueue(async () => {
            const record = this.requireRecord(moduleId);
            if (record.module.hotReloadable === false) {
                throw new Error(`Editor module ${moduleId} is bound to the workbench lifecycle and cannot be hot-unplugged.`);
            }
            await this.deactivateRecord(record, true);
        });
    }

    reload(moduleId: string): Promise<void> {
        this.assertOperational();
        return this.enqueue(async () => {
            const record = this.requireRecord(moduleId);
            if (record.module.hotReloadable === false) {
                throw new Error(`Editor module ${moduleId} is bound to the workbench lifecycle and cannot be hot-reloaded.`);
            }
            await this.deactivateRecord(record, true);
            await this.activateRecord(record);
        });
    }

    detach(moduleId: string): Promise<void> {
        this.assertOperational();
        return this.enqueue(async () => {
            const record = this.requireRecord(moduleId);
            if (record.module.hotReloadable === false) {
                throw new Error(`Editor module ${moduleId} is bound to the workbench lifecycle and cannot be detached.`);
            }
            await this.deactivateRecord(record, true);
            this.modules.delete(moduleId);
        });
    }

    dispose(): Promise<void> {
        if (this.disposeRequested) return this.operationQueue;
        this.disposeRequested = true;
        return this.enqueue(async () => {
            const errors: unknown[] = [];
            for (const moduleId of [...this.activationOrder].reverse()) {
                await this.deactivateRecord(this.requireRecord(moduleId), false).catch((error) => {
                    errors.push(error);
                });
            }
            this.services.clear();
            this.started = false;
            this.disposed = true;
            if (errors.length > 0) {
                throw new AggregateError(
                    errors,
                    `Editor workbench disposal failed: ${errors.map((error) => this.formatError(error)).join("; ")}`,
                );
            }
        });
    }

    private async activateRecord(record: EditorModuleRecord<THost>): Promise<void> {
        if (record.state === "active") return;
        if (record.state === "activating" || record.state === "deactivating") {
            throw new Error(`Editor module ${record.module.id} is already changing state.`);
        }

        const scope = new EditorModuleScope();
        record.state = "activating";
        record.dependencies.clear();
        record.error = "";
        const context: EditorModuleContext<THost> = {
            host: this.host,
            moduleId: record.module.id,
            provideService: <T>(serviceId: string, service: T): void => {
                this.validateServiceId(serviceId);
                if (this.services.has(serviceId)) throw new Error(`Editor service ${serviceId} is already provided.`);
                const registration: EditorServiceRecord = { ownerId: record.module.id, value: service };
                this.services.set(serviceId, registration);
                scope.add(() => {
                    if (this.services.get(serviceId) === registration) this.services.delete(serviceId);
                });
            },
            requireService: <T>(serviceId: string): T => {
                const service = this.resolveService<T>(serviceId, record);
                if (service === undefined) throw new Error(`Required editor service ${serviceId} is unavailable.`);
                return service;
            },
            optionalService: <T>(serviceId: string): T | undefined => this.resolveService<T>(serviceId, record),
            onDeactivate: (disposer): void => scope.add(disposer),
        };

        try {
            const disposer = await record.module.activate(context);
            if (disposer) scope.add(disposer);
            record.scope = scope;
            record.state = "active";
            this.activationOrder.push(record.module.id);
        } catch (error) {
            let activationError = error;
            try {
                await scope.dispose();
            } catch (cleanupError) {
                activationError = new AggregateError(
                    [error, cleanupError],
                    `Editor module ${record.module.id} activation and cleanup failed: ${this.formatError(error)}`,
                );
            }
            record.scope = null;
            record.state = "error";
            record.error = this.formatError(activationError);
            record.dependencies.clear();
            throw activationError;
        }
    }

    private async deactivateRecord(record: EditorModuleRecord<THost>, enforceDependents: boolean): Promise<void> {
        if (record.state === "installed") return;
        if (record.state !== "active" && record.state !== "error") {
            throw new Error(`Editor module ${record.module.id} cannot deactivate from ${record.state}.`);
        }
        if (enforceDependents) {
            const dependents = [...this.modules.values()]
                .filter((candidate) => candidate.state === "active" && candidate.dependencies.has(record.module.id))
                .map((candidate) => candidate.module.id);
            if (dependents.length > 0) {
                throw new Error(`Editor module ${record.module.id} is required by active modules: ${dependents.join(", ")}.`);
            }
        }

        record.state = "deactivating";
        const scope = record.scope;
        record.scope = null;
        try {
            await scope?.dispose();
            record.state = "installed";
            record.error = "";
        } catch (error) {
            record.state = "error";
            record.error = this.formatError(error);
            throw error;
        } finally {
            record.dependencies.clear();
            const orderIndex = this.activationOrder.lastIndexOf(record.module.id);
            if (orderIndex >= 0) this.activationOrder.splice(orderIndex, 1);
        }
    }

    private resolveService<T>(serviceId: string, consumer: EditorModuleRecord<THost>): T | undefined {
        this.validateServiceId(serviceId);
        const registration = this.services.get(serviceId);
        if (!registration) return undefined;
        if (registration.ownerId !== consumer.module.id) consumer.dependencies.add(registration.ownerId);
        return registration.value as T;
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.operationQueue.then(operation, operation);
        this.operationQueue = next.then(() => undefined, () => undefined);
        return next;
    }

    private requireRecord(moduleId: string): EditorModuleRecord<THost> {
        const record = this.modules.get(moduleId);
        if (!record) throw new Error(`Editor module ${moduleId} is not installed.`);
        return record;
    }

    private validateModule(module: EditorModule<THost>): void {
        if (!module || !/^[a-z][a-z0-9.-]+$/.test(module.id) || typeof module.activate !== "function") {
            throw new Error("Editor modules require a lowercase namespaced id and activate(context).");
        }
    }

    private validateServiceId(serviceId: string): void {
        if (!/^[a-z][a-z0-9.-]+$/.test(serviceId)) throw new Error(`Invalid editor service id: ${serviceId}.`);
    }

    private assertOperational(): void {
        if (this.disposeRequested || this.disposed) throw new Error("Editor workbench is disposing or disposed.");
        if (!this.started) throw new Error("Start the editor workbench before changing modules.");
    }

    private formatError(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
