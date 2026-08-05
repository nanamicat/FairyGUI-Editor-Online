import type { EditorCommandDiagnostic, EditorCommandOperation } from "../model/EditorCommand";
import { cloneJson } from "../commands/AuthoringTransactionSupport";
import type {
    BrowserSaveTarget,
    BrowserEventsStepResult,
    BrowserReloadStepResult,
    BrowserSaveStepResult,
    BrowserWorkspaceExport,
} from "../model/BrowserWorkspace";
import type {
    BrowserLiveSessionBaseline,
    BrowserLiveProjectSource,
    BrowserLiveSessionRuntime,
    BrowserLiveSessionState,
    BrowserLiveTransactionResult,
    BrowserWorkspaceRestoreStatus,
} from "../model/BrowserLiveSession";
import type { EditorProjectSnapshot } from "../model/ProjectSnapshot";
import { BrowserProjectStorage, type BrowserProjectStorageAdapter } from "./BrowserProjectStorage";
import {
    createDisplayNodeSaveTarget,
    createTransactionSaveTarget,
    verifySaveTarget,
} from "./BrowserSaveTargetVerifier";
import { normalizeLatestTransactionOperations } from "./LatestTransactionNormalizer";
import { createProjectSnapshotFromUamProject } from "./UamProjectSnapshotAdapter";
import type { FairyPackageBackendModule } from "./FairyPackageTransfer";

export { createTransactionSaveTarget } from "./BrowserSaveTargetVerifier";
export { normalizeLatestTransactionOperations } from "./LatestTransactionNormalizer";

export const BROWSER_UAM_BASELINE_URL = "resources/editor/runtime/uam-baseline.json";
export const BROWSER_BACKEND_BUNDLE_URL = "resources/editor/runtime/openfairygui-backend-browser.js";
const RUNTIME_UAM_BASELINE_FALLBACK_URL = "assets/resources/editor/runtime/uam-baseline.json";
const RUNTIME_BACKEND_BUNDLE_FALLBACK_URL = "assets/resources/editor/runtime/openfairygui-backend-browser.js";

type DynamicImporter = (url: string) => Promise<BrowserBackendModule>;

interface BrowserBackendModule {
    BackendRuntime: new (options?: { fileSystem?: unknown }) => BrowserBackendRuntime;
    createBackendStorageFileSystem?: (storage: BrowserProjectStorageAdapter) => unknown;
    ProjectReader?: new (fileSystem: unknown) => { read(projectPath: string, options?: { includeBinaryData?: boolean; hydrateResourceBytes?: boolean }): Promise<unknown> };
    liftDocumentToUamProject?: (doc: unknown) => unknown;
    applyUamTransaction?: (project: unknown, operations: EditorCommandOperation[]) => unknown;
    applyUamTransactionAsync?: (project: unknown, operations: EditorCommandOperation[]) => Promise<unknown>;
    publishBrowser?: (options: {
        document: unknown;
        sourceFileSystem: unknown;
        outputFileSystem: BrowserProjectStorageAdapter;
        projectType: "layabox";
        output: string;
        packages?: string[];
        branch?: string;
    }) => Promise<{
        success: boolean;
        files: Array<{ path: string; size: number }>;
        diagnostics: Array<{ level: string; message: string }>;
    }>;
    BACKEND_CONTRACT_VERSION: string;
    BACKEND_CAPABILITY_SCHEMA_VERSION: number;
}

interface BrowserBackendRuntime {
    openSession(input: { projectPath: string }): Promise<BrowserBackendOpenProjectResult>;
    openProjectSession(input: {
        project: unknown;
        canonicalProjectPath?: string;
        storage?: {
            fileSystem: unknown;
            fairyPath: string;
            canonicalProjectPath?: string;
            canonicalPathKey?: string;
        };
    }): BrowserBackendOpenProjectResult;
    applyTransaction(input: {
        sessionId: string;
        expectedRevision: number;
        operations: EditorCommandOperation[];
    }): Promise<BrowserBackendApplyTransactionResult>;
    saveSession(input: {
        sessionId: string;
        expectedRevision?: number;
        force?: boolean;
        mode?: "materializeCleanSession";
    }): Promise<BrowserBackendSaveSessionResult>;
    materializeSession?(input: {
        sessionId: string;
        expectedRevision?: number;
        storage?: {
            fileSystem: unknown;
            fairyPath: string;
            canonicalProjectPath?: string;
            canonicalPathKey?: string;
        };
        targetPath?: string;
        fileSystem?: unknown;
        mode?: "fullProject";
        reason?: string;
    }): Promise<BrowserBackendSaveSessionResult>;
    getEvents(input: {
        sessionId: string;
        afterSeq: number;
        limit: number;
    }): BrowserBackendEventsResult;
    closeSession(input: {
        sessionId: string;
    }): Promise<{
        ok: boolean;
        error?: BrowserBackendError;
    }>;
}

interface BrowserBackendOpenProjectResult {
    ok: boolean;
    data?: {
        sessionId: string;
        revision: number;
        dirty: boolean;
        uamFidelity?: "full" | "unsupported";
        lockHeld?: boolean;
    };
    error?: BrowserBackendError;
    meta?: {
        diagnostics?: EditorCommandDiagnostic[];
    };
    diagnostics?: EditorCommandDiagnostic[];
}

interface BrowserBackendApplyTransactionResult {
    ok: boolean;
    data?: {
        revision: number;
        dirty: boolean;
    };
    error?: BrowserBackendError;
    meta?: {
        diagnostics?: EditorCommandDiagnostic[];
    };
    diagnostics?: EditorCommandDiagnostic[];
    session?: {
        revision?: number;
        dirty?: boolean;
    };
    snapshot?: {
        revision?: number;
        dirty?: boolean;
    };
}

interface BrowserBackendSaveSessionResult {
    ok: boolean;
    data?: {
        revision: number;
        dirty: boolean;
        lastSavedRevision?: number;
        materializeRevision?: number;
        saveRevision?: number;
        writtenPaths?: string[];
        skippedPaths?: string[];
    };
    error?: BrowserBackendError & {
        capability?: string;
        requiredAdapter?: string;
        lastSavedRevision?: number;
    };
    meta?: {
        diagnostics?: EditorCommandDiagnostic[];
    };
    diagnostics?: EditorCommandDiagnostic[];
    session?: {
        revision?: number;
        dirty?: boolean;
        lastSavedRevision?: number;
    };
    snapshot?: {
        revision?: number;
        dirty?: boolean;
        lastSavedRevision?: number;
    };
}

interface BrowserBackendEventsResult {
    ok: boolean;
    data?: {
        events: Array<{ kind: string }>;
    };
    error?: BrowserBackendError;
}

interface BrowserBackendError {
    code?: string;
    message?: string;
    expectedRevision?: number;
    actualRevision?: number;
    opIndex?: number;
    opKind?: string;
}

interface BrowserLiveSessionLifecycleToken {
    generation: number;
    runtime: BrowserBackendRuntime | null;
    sessionId: string;
    revision: number;
}

export interface BrowserLiveSessionIdentity {
    generation: number;
    sessionId: string;
    revision: number;
}

export interface BrowserLiveSessionResetResult {
    ok: boolean;
    errorCode?: string;
    message?: string;
}

class BrowserLiveSessionLifecycleInterruptedError extends Error {
    readonly code: "live_session_reset" | "live_session_stale";

    constructor(readonly reason: "lifecycle" | "revision" = "lifecycle") {
        super(reason === "revision"
            ? "Browser live session revision changed while the operation was running."
            : "Browser live session lifecycle changed while the operation was running.");
        this.name = "BrowserLiveSessionLifecycleInterruptedError";
        this.code = reason === "revision" ? "live_session_stale" : "live_session_reset";
    }
}

export class BrowserLiveSessionBridge implements BrowserLiveSessionRuntime {
    private status: BrowserLiveSessionState["status"] = "idle";
    private runtime: BrowserBackendRuntime | null = null;
    private backendModule: BrowserBackendModule | null = null;
    private fileSystem: unknown = null;
    private readonly projectStorage: BrowserProjectStorage | null;
    private sessionId = "";
    private revision = 0;
    private dirty = false;
    private uamFidelity: "full" | "unsupported" | undefined;
    private lockHeld: boolean | undefined;
    private backendPackageVersion = "";
    private backendBuildSource: "npm_package" | "workspace_source" = "npm_package";
    private backendContractVersion = "";
    private capabilitySchemaVersion = 0;
    private error = "";
    private projectSource: BrowserLiveProjectSource = "uam_baseline";
    private workspaceRestoreStatus: BrowserWorkspaceRestoreStatus = "unavailable";
    private workspaceRestoreMessage = "";
    private workingProject: unknown | null = null;
    private currentProjectSnapshot: EditorProjectSnapshot | null = null;
    private lastSaveTarget: BrowserSaveTarget | null = null;
    private lifecycleGeneration = 0;
    private acceptingOperations = true;
    private readonly inFlightOperations = new Set<Promise<void>>();
    private resetOperation: Promise<BrowserLiveSessionResetResult> | null = null;
    private connectOperation: Promise<BrowserLiveSessionState> | null = null;

    constructor(projectStorage: BrowserProjectStorage | null = null) {
        this.projectStorage = projectStorage;
    }

    getState(): BrowserLiveSessionState {
        return {
            status: this.status,
            liveSession: this.status === "connected",
            revision: this.revision,
            dirty: this.dirty,
            uamFidelity: this.uamFidelity,
            lockHeld: this.lockHeld,
            projectSource: this.projectSource,
            workspaceRestoreStatus: this.workspaceRestoreStatus,
            workspaceRestoreMessage: this.workspaceRestoreMessage || undefined,
            sessionId: this.sessionId || undefined,
            backendPackageVersion: this.backendPackageVersion || undefined,
            backendBuildSource: this.backendBuildSource,
            backendContractVersion: this.backendContractVersion || undefined,
            capabilitySchemaVersion: this.capabilitySchemaVersion || undefined,
            backendBundleUrl: BROWSER_BACKEND_BUNDLE_URL,
            uamBaselineUrl: BROWSER_UAM_BASELINE_URL,
            boundary: this.getBoundary(),
            error: this.error || undefined,
        };
    }

    getProjectSnapshot(): EditorProjectSnapshot | null {
        return this.currentProjectSnapshot;
    }

    getLastSaveTarget(): BrowserSaveTarget | null {
        return this.lastSaveTarget;
    }

    getWorkingProject(): unknown | null {
        return this.workingProject ? cloneJson(this.workingProject) : null;
    }

    captureSessionIdentity(): BrowserLiveSessionIdentity | null {
        if (!this.acceptingOperations || this.status !== "connected" || !this.sessionId) return null;
        return {
            generation: this.lifecycleGeneration,
            sessionId: this.sessionId,
            revision: this.revision,
        };
    }

    isSessionIdentityCurrent(identity: BrowserLiveSessionIdentity): boolean {
        return this.acceptingOperations
            && this.status === "connected"
            && identity.generation === this.lifecycleGeneration
            && identity.sessionId === this.sessionId
            && identity.revision === this.revision;
    }

    getFairyPackageBackend(): FairyPackageBackendModule | null {
        const backend = this.backendModule;
        if (!backend?.createBackendStorageFileSystem || !backend.ProjectReader || !backend.liftDocumentToUamProject) {
            return null;
        }
        return {
            BackendRuntime: backend.BackendRuntime,
            createBackendStorageFileSystem: backend.createBackendStorageFileSystem,
            ProjectReader: backend.ProjectReader,
            liftDocumentToUamProject: backend.liftDocumentToUamProject,
        };
    }

    async publishRuntimeBundle(
        snapshot: EditorProjectSnapshot,
        options: { packageIds?: string[]; branch?: string } = {},
    ): Promise<{
        success: boolean;
        fileCount: number;
        packageCount: number;
        diagnostics: Array<{ level: string; message: string }>;
        archive?: BrowserWorkspaceExport;
    }> {
        const projectStorage = this.projectStorage;
        const adapter = projectStorage?.getAdapter();
        if (projectStorage && adapter && !await adapter.exists(projectStorage.getFairyPath())) {
            const bootstrap = await this.bootstrapWorkspace();
            if (!bootstrap.connect.ok || !bootstrap.save.ok || !bootstrap.reload.ok) {
                throw new Error("Browser publish could not initialize the empty browser workspace.");
            }
        }
        return this.runLifecycleOperation((token) => this.publishRuntimeBundleInternal(token, snapshot, options));
    }

    private async publishRuntimeBundleInternal(
        token: BrowserLiveSessionLifecycleToken,
        snapshot: EditorProjectSnapshot,
        options: { packageIds?: string[]; branch?: string },
    ): Promise<{
        success: boolean;
        fileCount: number;
        packageCount: number;
        diagnostics: Array<{ level: string; message: string }>;
        archive?: BrowserWorkspaceExport;
    }> {
        this.assertLifecycleCurrent(token, true);
        const backendModule = this.backendModule;
        const adapter = this.projectStorage?.getAdapter();
        if (!backendModule?.ProjectReader || !backendModule.publishBrowser || !this.fileSystem || !adapter || !this.projectStorage) {
            throw new Error("Browser publish requires a connected workspace-backed OpenFairyGUI session.");
        }

        const reader = new backendModule.ProjectReader(this.fileSystem);
        const document = await reader.read(this.projectStorage.getFairyPath(), {
            includeBinaryData: true,
            hydrateResourceBytes: true,
        });
        this.assertLifecycleCurrent(token, true);
        const output = ".fairygui-runtime";
        const result = await backendModule.publishBrowser({
            document,
            sourceFileSystem: this.fileSystem,
            outputFileSystem: adapter,
            projectType: "layabox",
            output,
            packages: options.packageIds?.flatMap((id) => {
                const name = snapshot.packages.find((pkg) => pkg.id === id)?.name;
                return name ? [name] : [];
            }),
            branch: options.branch || undefined,
        });
        this.assertLifecycleCurrent(token, true);
        if (!result.success) {
            return { success: false, fileCount: result.files.length, packageCount: 0, diagnostics: result.diagnostics };
        }

        const publishedFiles = result.files.map((file) => file.path.replaceAll("\\", "/").split("/").pop() || "");
        const publishedIds = options.packageIds ? new Set(options.packageIds) : null;
        const packages = snapshot.packages.flatMap((pkg) => {
            if (publishedIds && !publishedIds.has(pkg.id)) return [];
            const files = publishedFiles.filter((file) =>
                file === `${pkg.publishName}.fui` || file.startsWith(`${pkg.publishName}_`),
            );
            return files.includes(`${pkg.publishName}.fui`)
                ? [{
                    packageId: pkg.id,
                    packageName: pkg.name,
                    publishName: pkg.publishName,
                    resourceKey: `${output}/${pkg.publishName}`,
                    files,
                }]
                : [];
        });
        let previousPackages: typeof packages = [];
        const manifestPath = `${output}/manifest.json`;
        if (publishedIds && await adapter.exists(manifestPath)) {
            try {
                const previous = JSON.parse(await adapter.readFile(manifestPath)) as { packages?: typeof packages };
                previousPackages = (previous.packages || []).filter((pkg) => !publishedIds.has(pkg.packageId));
            } catch {
                previousPackages = [];
            }
        }
        await adapter.writeFile(manifestPath, `${JSON.stringify({
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            source: { projectId: snapshot.project.id },
            packages: [...previousPackages, ...packages],
        }, null, 2)}\n`);
        this.assertLifecycleCurrent(token, true);
        const archive = await this.projectStorage.exportRuntimeBundleZip().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Browser runtime ZIP export failed: ${message}`);
        });
        this.assertLifecycleCurrent(token, true);

        return {
            success: true,
            fileCount: result.files.length,
            packageCount: packages.length,
            diagnostics: result.diagnostics,
            archive,
        };
    }

    async reset(): Promise<BrowserLiveSessionResetResult> {
        if (this.resetOperation) return this.resetOperation;
        this.acceptingOperations = false;
        this.lifecycleGeneration += 1;
        const runtime = this.runtime;
        const sessionId = this.sessionId;
        const pending = [...this.inFlightOperations];
        const operation = (async (): Promise<BrowserLiveSessionResetResult> => {
            await Promise.all(pending);
            if (runtime && sessionId) {
                let closed: Awaited<ReturnType<BrowserBackendRuntime["closeSession"]>>;
                try {
                    closed = await runtime.closeSession({ sessionId });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.status = "failed";
                    this.error = `Failed to close the previous browser live session: ${message}`;
                    return { ok: false, errorCode: "live_session_close_failed", message: this.error };
                }
                if (!closed.ok && closed.error?.code !== "session_not_found") {
                    this.status = "failed";
                    this.error = closed.error?.message || "Failed to close the previous browser live session.";
                    return {
                        ok: false,
                        errorCode: closed.error?.code || "live_session_close_failed",
                        message: this.error,
                    };
                }
            }

            this.clearSessionState();
            this.acceptingOperations = true;
            return { ok: true };
        })();
        this.resetOperation = operation;
        try {
            return await operation;
        } finally {
            if (this.resetOperation === operation) this.resetOperation = null;
        }
    }

    private clearSessionState(): void {
        this.status = "idle";
        this.runtime = null;
        this.backendModule = null;
        this.fileSystem = null;
        this.sessionId = "";
        this.revision = 0;
        this.dirty = false;
        this.uamFidelity = undefined;
        this.lockHeld = undefined;
        this.backendPackageVersion = "";
        this.backendBuildSource = "npm_package";
        this.backendContractVersion = "";
        this.capabilitySchemaVersion = 0;
        this.error = "";
        this.projectSource = "uam_baseline";
        this.workspaceRestoreStatus = "unavailable";
        this.workspaceRestoreMessage = "";
        this.workingProject = null;
        this.currentProjectSnapshot = null;
        this.lastSaveTarget = null;
    }

    private runLifecycleOperation<T>(
        operation: (token: BrowserLiveSessionLifecycleToken) => Promise<T>,
    ): Promise<T> {
        if (!this.acceptingOperations) {
            return Promise.reject(new BrowserLiveSessionLifecycleInterruptedError());
        }
        const token: BrowserLiveSessionLifecycleToken = {
            generation: this.lifecycleGeneration,
            runtime: this.runtime,
            sessionId: this.sessionId,
            revision: this.revision,
        };
        const result = operation(token);
        const settled = result.then(() => undefined, () => undefined);
        this.inFlightOperations.add(settled);
        void settled.finally(() => this.inFlightOperations.delete(settled));
        return result;
    }

    private assertLifecycleCurrent(
        token: BrowserLiveSessionLifecycleToken,
        requireIdentity = false,
    ): void {
        if (
            !this.acceptingOperations
            || token.generation !== this.lifecycleGeneration
            || (requireIdentity && (token.runtime !== this.runtime || token.sessionId !== this.sessionId))
        ) {
            throw new BrowserLiveSessionLifecycleInterruptedError();
        }
        if (requireIdentity && token.revision !== this.revision) {
            throw new BrowserLiveSessionLifecycleInterruptedError("revision");
        }
    }

    private createInterruptedState(): BrowserLiveSessionState {
        return {
            ...this.getState(),
            status: "idle",
            liveSession: false,
            error: "Browser live session lifecycle changed while connecting.",
        };
    }

    private createInterruptedTransactionResult(
        error: BrowserLiveSessionLifecycleInterruptedError,
    ): BrowserLiveTransactionResult {
        const stale = error.reason === "revision";
        return {
            ok: false,
            error: {
                code: error.code,
                message: stale
                    ? "The browser live session revision changed before the transaction completed."
                    : "The browser live session changed before the transaction completed.",
            },
            diagnostics: this.createDiagnostics("error", stale
                ? "LIVE_SESSION_STALE"
                : "LIVE_SESSION_RESET"),
            raw: null,
        };
    }

    private createInterruptedSaveResult(error: BrowserLiveSessionLifecycleInterruptedError): {
        save: BrowserSaveStepResult;
        reload: BrowserReloadStepResult;
        events: BrowserEventsStepResult;
        diagnostics: EditorCommandDiagnostic[];
    } {
        const stale = error.reason === "revision";
        return {
            save: {
                ok: false,
                errorCode: error.code,
                message: stale
                    ? "The browser live session revision changed before save verification completed."
                    : "The browser live session changed before save verification completed.",
            },
            reload: {
                ok: false,
                status: "skipped",
                message: stale ? "A newer revision invalidated save verification." : "Session reset interrupted save verification.",
            },
            events: {
                ok: false,
                kinds: [],
                message: stale ? "A newer revision invalidated event collection." : "Session reset interrupted event collection.",
            },
            diagnostics: this.createDiagnostics("error", stale
                ? "LIVE_SESSION_STALE"
                : "LIVE_SESSION_RESET"),
        };
    }

    private createInterruptedBootstrapResult(): {
        connect: BrowserSaveStepResult;
        materialize: BrowserSaveStepResult;
        save: BrowserSaveStepResult;
        reload: BrowserReloadStepResult;
        events: BrowserEventsStepResult;
        diagnostics: EditorCommandDiagnostic[];
    } {
        return {
            connect: { ok: false, message: "Browser live session reset interrupted workspace bootstrap." },
            materialize: { ok: false, message: "Workspace bootstrap was interrupted." },
            save: { ok: false, errorCode: "live_session_reset", message: "Workspace bootstrap was interrupted." },
            reload: { ok: false, status: "skipped", message: "Workspace bootstrap was interrupted." },
            events: { ok: false, kinds: [], message: "Workspace bootstrap was interrupted." },
            diagnostics: this.createDiagnostics("error", "LIVE_SESSION_RESET"),
        };
    }

    async connect(): Promise<BrowserLiveSessionState> {
        if (this.status === "connected") return this.getState();
        if (this.connectOperation) return this.connectOperation;
        if (!this.acceptingOperations) return this.createInterruptedState();
        const operation = this.runLifecycleOperation((token) => this.connectInternal(token));
        this.connectOperation = operation;
        try {
            return await operation;
        } finally {
            if (this.connectOperation === operation) this.connectOperation = null;
        }
    }

    private async connectInternal(token: BrowserLiveSessionLifecycleToken): Promise<BrowserLiveSessionState> {
        this.status = "loading";
        this.error = "";
        this.projectSource = "uam_baseline";
        this.workspaceRestoreStatus = "unavailable";
        this.workspaceRestoreMessage = "";
        this.workingProject = null;
        this.currentProjectSnapshot = null;
        this.lastSaveTarget = null;

        try {
            const [baseline, backendModule] = await Promise.all([
                loadBrowserLiveSessionBaseline(),
                importBrowserBackendBundle(),
            ]);
            this.assertLifecycleCurrent(token);

            const storageInput = await this.createStorageOpenInput(backendModule, token);
            this.assertLifecycleCurrent(token);
            const sessionProject = await this.resolveSessionProject(baseline, backendModule, storageInput, token);
            this.assertLifecycleCurrent(token);
            const restoringWorkspace = Boolean(storageInput && this.getState().projectSource === "browser_workspace");
            const runtime = new backendModule.BackendRuntime(
                restoringWorkspace ? { fileSystem: storageInput?.fileSystem } : undefined,
            );
            const opened = restoringWorkspace
                ? await runtime.openSession({ projectPath: "." })
                : runtime.openProjectSession({
                    project: sessionProject,
                    canonicalProjectPath: storageInput
                        ? undefined
                        : "memory://browser-live-session",
                    storage: storageInput || undefined,
                });

            if (!opened.ok || !opened.data) {
                throw new Error(formatBackendOpenError(opened));
            }

            this.runtime = runtime;
            this.backendModule = backendModule;
            this.sessionId = opened.data.sessionId;
            this.revision = opened.data.revision;
            this.dirty = opened.data.dirty;
            this.uamFidelity = opened.data.uamFidelity;
            this.lockHeld = opened.data.lockHeld;
            this.backendPackageVersion = baseline.source.packageVersion;
            this.backendBuildSource = baseline.source.sourceKind ?? "npm_package";
            this.backendContractVersion = backendModule.BACKEND_CONTRACT_VERSION;
            this.capabilitySchemaVersion = backendModule.BACKEND_CAPABILITY_SCHEMA_VERSION;
            const sessionSource = this.getState().projectSource;
            this.setWorkingProject(sessionProject, sessionSource === "browser_workspace" ? "BrowserWorkspace" : "UamBaseline");
            this.status = "connected";
        } catch (error) {
            if (error instanceof BrowserLiveSessionLifecycleInterruptedError) {
                return this.createInterruptedState();
            }
            this.status = "failed";
            this.runtime = null;
            this.backendModule = null;
            this.fileSystem = null;
            this.sessionId = "";
            this.uamFidelity = undefined;
            this.lockHeld = undefined;
            this.projectSource = "uam_baseline";
            this.workspaceRestoreStatus = "failed";
            this.error = error instanceof Error ? error.message : String(error);
            this.workspaceRestoreMessage = this.error;
            this.workingProject = null;
            this.currentProjectSnapshot = null;
            this.lastSaveTarget = null;
        }

        return this.getState();
    }

    async bootstrapWorkspace(): Promise<{
        target?: BrowserSaveTarget;
        connect: BrowserSaveStepResult;
        materialize?: BrowserSaveStepResult;
        apply?: BrowserSaveStepResult;
        save: BrowserSaveStepResult;
        reload: BrowserReloadStepResult;
        events: BrowserEventsStepResult;
        diagnostics: EditorCommandDiagnostic[];
    }> {
        try {
            return await this.runLifecycleOperation((token) => this.bootstrapWorkspaceInternal(token));
        } catch (error) {
            if (error instanceof BrowserLiveSessionLifecycleInterruptedError) {
                return this.createInterruptedBootstrapResult();
            }
            throw error;
        }
    }

    private async bootstrapWorkspaceInternal(token: BrowserLiveSessionLifecycleToken): Promise<{
        target?: BrowserSaveTarget;
        connect: BrowserSaveStepResult;
        materialize?: BrowserSaveStepResult;
        apply?: BrowserSaveStepResult;
        save: BrowserSaveStepResult;
        reload: BrowserReloadStepResult;
        events: BrowserEventsStepResult;
        diagnostics: EditorCommandDiagnostic[];
    }> {
        const connected = await this.connect();
        this.assertLifecycleCurrent(token);
        const connect: BrowserSaveStepResult = {
            ok: connected.status === "connected",
            revision: connected.revision,
            dirty: connected.dirty,
            message: connected.status === "connected" ? undefined : connected.error || connected.boundary,
        };
        if (connected.status !== "connected") {
            return {
                connect,
                materialize: { ok: false, message: "Bootstrap skipped because the browser live session is not connected." },
                save: { ok: false, message: "Bootstrap save did not run." },
                reload: { ok: false, status: "skipped", message: "Bootstrap save did not run." },
                events: { ok: false, kinds: [], message: "Bootstrap save did not run." },
                diagnostics: this.createDiagnostics("error", "WORKSPACE_BOOTSTRAP_SESSION_UNAVAILABLE"),
            };
        }

        const runtime = this.runtime;
        if (!runtime || !this.fileSystem || !this.projectStorage) {
            return {
                connect,
                materialize: { ok: false, revision: this.revision, dirty: this.dirty, message: "Browser workspace storage is not attached." },
                save: { ok: false, revision: this.revision, dirty: this.dirty, message: "Bootstrap save did not run." },
                reload: { ok: false, status: "skipped", message: "Bootstrap save did not run." },
                events: { ok: false, kinds: [], message: "Bootstrap save did not run." },
                diagnostics: this.createDiagnostics("error", "WORKSPACE_BOOTSTRAP_STORAGE_UNAVAILABLE"),
            };
        }

        const adapter = this.projectStorage.getAdapter();
        const projectExists = adapter && await adapter.exists(this.projectStorage.getFairyPath());
        this.assertLifecycleCurrent(token);
        if (projectExists) {
            return {
                connect,
                materialize: {
                    ok: true,
                    revision: this.revision,
                    dirty: this.dirty,
                    message: "Workspace project file already exists; bootstrap did not change the session.",
                },
                save: {
                    ok: true,
                    revision: this.revision,
                    dirty: this.dirty,
                    message: "Workspace is already bootstrapped.",
                },
                reload: {
                    ok: true,
                    status: "skipped",
                    message: "Workspace is already bootstrapped.",
                },
                events: this.getSaveEvents(),
                diagnostics: this.createDiagnostics("info", "BROWSER_WORKSPACE_ALREADY_BOOTSTRAPPED"),
            };
        }

        const baseline = await loadBrowserLiveSessionBaseline();
        this.assertLifecycleCurrent(token);
        const target = createBootstrapTarget(baseline);

        if (typeof runtime.materializeSession === "function") {
            const materialized = await runtime.materializeSession({
                sessionId: this.sessionId,
                expectedRevision: this.revision,
                mode: "fullProject",
                reason: "workspace_bootstrap",
            });
            this.assertLifecycleCurrent(token);
            const diagnostics = this.collectDiagnostics(materialized);
            if (materialized.ok && materialized.data) {
                this.revision = materialized.data.revision;
                this.dirty = materialized.data.dirty;
            }

            const save = summarizeSaveResult(materialized);
            const reload = save.ok
                ? await this.reloadSavedTarget(target ?? undefined, token, false)
                : {
                    ok: false,
                    status: "skipped" as const,
                    message: "Materialize failed.",
                };
            this.assertLifecycleCurrent(token);
            const events = this.getSaveEvents();

            return {
                target: target ?? undefined,
                connect,
                materialize: {
                    ok: true,
                    revision: this.revision,
                    dirty: this.dirty,
                    message:
                        "No synthetic transaction was needed; OpenFairyGUI materializeSession wrote the clean project into browser workspace storage.",
                },
                save,
                reload,
                events,
                diagnostics: [
                    {
                        severity: save.ok ? "info" : "error",
                        code: save.ok
                            ? "BROWSER_WORKSPACE_MATERIALIZED"
                            : "BROWSER_WORKSPACE_MATERIALIZE_FAILED",
                        message: save.ok
                            ? "OpenFairyGUI materializeSession seeded the browser workspace from a clean UAM session."
                            : save.message || "OpenFairyGUI materializeSession failed.",
                    },
                    ...diagnostics,
                ],
            };
        }

        if (!target) {
            return {
                connect,
                materialize: {
                    ok: false,
                    revision: this.revision,
                    dirty: this.dirty,
                    message: "The runtime baseline does not contain a bootstrap display node target.",
                },
                save: { ok: false, revision: this.revision, dirty: this.dirty, message: "Bootstrap save did not run." },
                reload: { ok: false, status: "skipped", message: "Bootstrap save did not run." },
                events: { ok: false, kinds: [], message: "Bootstrap save did not run." },
                diagnostics: this.createDiagnostics("error", "WORKSPACE_BOOTSTRAP_TARGET_MISSING"),
            };
        }

        const operation = createBootstrapOperation(target, this.revision + 1);
        const applied = await this.applyTransaction([operation], this.revision);
        this.assertLifecycleCurrent(token);
        if (!applied.ok) {
            const error = "error" in applied ? applied.error : {
                code: "workspace_bootstrap_apply_failed",
                message: "Workspace bootstrap transaction failed.",
            };
            return {
                target,
                connect,
                materialize: {
                    ok: false,
                    revision: applied.revision,
                    dirty: applied.dirty,
                    errorCode: error.code,
                    message: error.message,
                },
                save: { ok: false, revision: this.revision, dirty: this.dirty, message: "Bootstrap save did not run." },
                reload: { ok: false, status: "skipped", message: "Bootstrap save did not run." },
                events: { ok: false, kinds: [], message: "Bootstrap save did not run." },
                diagnostics: applied.diagnostics,
            };
        }

        const saved = await this.saveWorkspace(target);
        this.assertLifecycleCurrent(token);
            return {
                target,
                connect,
                apply: {
                ok: true,
                revision: applied.revision,
                dirty: applied.dirty,
                message: "A semantic no-op setDisplayNodeProps transaction forced OpenFairyGUI materialization into the browser workspace.",
            },
            save: saved.save,
            reload: saved.reload,
            events: saved.events,
            diagnostics: [
                {
                    severity: "warning",
                    code: "WORKSPACE_BOOTSTRAP_USES_NOOP_TRANSACTION",
                    message:
                        "This backend bundle does not expose materializeSession, so explicit workspace bootstrap uses an unchanged setDisplayNodeProps transaction before saveSession.",
                },
                ...applied.diagnostics,
                ...saved.diagnostics,
            ],
        };
    }

    async applyTransaction(
        operations: EditorCommandOperation[],
        expectedRevision: number,
        inverseOperations?: EditorCommandOperation[],
    ): Promise<BrowserLiveTransactionResult> {
        try {
            return await this.runLifecycleOperation((token) =>
                this.applyTransactionInternal(token, operations, expectedRevision, inverseOperations));
        } catch (error) {
            if (error instanceof BrowserLiveSessionLifecycleInterruptedError) {
                return this.createInterruptedTransactionResult(error);
            }
            throw error;
        }
    }

    private async applyTransactionInternal(
        token: BrowserLiveSessionLifecycleToken,
        operations: EditorCommandOperation[],
        expectedRevision: number,
        inverseOperations?: EditorCommandOperation[],
    ): Promise<BrowserLiveTransactionResult> {
        const runtime = token.runtime;
        const sessionId = token.sessionId;
        if (this.status !== "connected" || !runtime || !sessionId) {
            return {
                ok: false,
                error: {
                    code: "live_session_unavailable",
                    message: this.error || "The browser live session is not connected.",
                },
                diagnostics: this.createDiagnostics("error", "LIVE_SESSION_UNAVAILABLE"),
                raw: null,
            };
        }

        const runtimeOperations = normalizeLatestTransactionOperations(this.workingProject, operations);
        const needsUamSnapshot = runtimeOperations.some((operation) => operation.kind !== "setDisplayNodeProps");
        const needsAsyncProjection = runtimeOperations.some((operation) => operation.kind === "replaceResourceBytes");
        const canProject = needsAsyncProjection
            ? Boolean(this.backendModule?.applyUamTransactionAsync)
            : Boolean(this.backendModule?.applyUamTransaction);
        if (needsUamSnapshot && (!canProject || !this.workingProject)) {
            return {
                ok: false,
                error: {
                    code: "uam_snapshot_unavailable",
                    message: needsAsyncProjection
                        ? "Resource byte replacement requires the browser bundle to expose applyUamTransactionAsync and an active UAM working project."
                        : "High-risk editing requires the browser bundle to expose applyUamTransaction and an active UAM working project.",
                },
                diagnostics: this.createDiagnostics("error", "UAM_SNAPSHOT_UNAVAILABLE"),
                raw: null,
            };
        }

        let projectedProject: unknown | null = null;
        if (canProject && this.workingProject) {
            try {
                const workingProject = cloneJson(this.workingProject);
                const projectedOperations = cloneJson(runtimeOperations);
                projectedProject = needsAsyncProjection
                    ? await this.backendModule?.applyUamTransactionAsync?.(workingProject, projectedOperations) ?? null
                    : this.backendModule?.applyUamTransaction?.(workingProject, projectedOperations) ?? null;
                this.assertLifecycleCurrent(token, true);

                if (inverseOperations?.length && projectedProject) {
                    const projectedInverseOperations = normalizeLatestTransactionOperations(
                        projectedProject,
                        cloneJson(inverseOperations),
                    );
                    const inverseNeedsAsyncProjection = projectedInverseOperations.some(
                        (operation) => operation.kind === "replaceResourceBytes",
                    );
                    const applyInverseAsync = this.backendModule?.applyUamTransactionAsync;
                    const applyInverse = this.backendModule?.applyUamTransaction;
                    if (inverseNeedsAsyncProjection && !applyInverseAsync) {
                        throw new Error("Resource byte replacement inverse requires applyUamTransactionAsync.");
                    }
                    if (!inverseNeedsAsyncProjection && !applyInverse) {
                        throw new Error("Transaction inverse requires applyUamTransaction.");
                    }
                    if (inverseNeedsAsyncProjection) {
                        await applyInverseAsync?.(
                            cloneJson(projectedProject),
                            projectedInverseOperations,
                        );
                    } else {
                        applyInverse?.(
                            cloneJson(projectedProject),
                            projectedInverseOperations,
                        );
                    }
                    this.assertLifecycleCurrent(token, true);
                }
            } catch (error) {
                if (error instanceof BrowserLiveSessionLifecycleInterruptedError) throw error;
                const message = error instanceof Error ? error.message : String(error);
                return {
                    ok: false,
                    error: {
                        code: "uam_snapshot_apply_failed",
                        message: `UAM snapshot transaction rejected before backend apply: ${message}`,
                    },
                    diagnostics: this.createDiagnostics("error", "UAM_SNAPSHOT_APPLY_FAILED"),
                    raw: error,
                };
            }
        }

        const result = await runtime.applyTransaction({
            sessionId,
            expectedRevision,
            operations: runtimeOperations,
        });
        this.assertLifecycleCurrent(token, true);

        if (result.ok && result.data) {
            this.revision = result.data.revision;
            this.dirty = result.data.dirty;
            if (projectedProject) {
                this.setWorkingProject(projectedProject, this.projectSource === "browser_workspace" ? "BrowserWorkspace" : "UamBaseline");
                this.lastSaveTarget = createTransactionSaveTarget(projectedProject, runtimeOperations);
            }
            return {
                ok: true,
                revision: result.data.revision,
                dirty: result.data.dirty,
                diagnostics: [
                    ...this.createDiagnostics("info", needsUamSnapshot
                        ? "AUTHORING_TRANSACTION_APPLIED"
                        : "LIVE_TRANSACTION_APPLIED"),
                ],
                raw: result,
            };
        }

        return {
            ok: false,
            revision: result.session?.revision ?? result.snapshot?.revision,
            dirty: result.session?.dirty ?? result.snapshot?.dirty,
            error: {
                code: result.error?.code || "live_transaction_failed",
                message: result.error?.message || "The browser live transaction failed.",
                expectedRevision: result.error?.expectedRevision,
                actualRevision: result.error?.actualRevision,
                opIndex: result.error?.opIndex,
                opKind: result.error?.opKind,
            },
            diagnostics: [
                ...this.createDiagnostics("error", "LIVE_TRANSACTION_FAILED"),
                ...this.collectDiagnostics(result),
            ],
            raw: result,
        };
    }

    async saveWorkspace(target?: BrowserSaveTarget): Promise<{
        save: BrowserSaveStepResult;
        reload: BrowserReloadStepResult;
        events: BrowserEventsStepResult;
        diagnostics: EditorCommandDiagnostic[];
    }> {
        try {
            return await this.runLifecycleOperation((token) => this.saveWorkspaceInternal(token, target));
        } catch (error) {
            if (error instanceof BrowserLiveSessionLifecycleInterruptedError) {
                return this.createInterruptedSaveResult(error);
            }
            throw error;
        }
    }

    private async saveWorkspaceInternal(
        token: BrowserLiveSessionLifecycleToken,
        target?: BrowserSaveTarget,
    ): Promise<{
        save: BrowserSaveStepResult;
        reload: BrowserReloadStepResult;
        events: BrowserEventsStepResult;
        diagnostics: EditorCommandDiagnostic[];
    }> {
        const runtime = token.runtime;
        const sessionId = token.sessionId;
        if (this.status !== "connected" || !runtime || !sessionId) {
            return {
                save: {
                    ok: false,
                    errorCode: "live_session_unavailable",
                    message: this.error || "OpenFairyGUI browser live session is not connected.",
                },
                reload: {
                    ok: false,
                    status: "skipped",
                    message: "Save did not run.",
                },
                events: {
                    ok: false,
                    kinds: [],
                    message: "Save did not run.",
                },
                diagnostics: this.createDiagnostics("error", "LIVE_SESSION_UNAVAILABLE"),
            };
        }

        if (!this.fileSystem) {
            return {
                save: {
                    ok: false,
                    revision: this.revision,
                    dirty: this.dirty,
                    errorCode: "storage_adapter_unavailable",
                    message: "Browser workspace storage is not attached to the editor session.",
                },
                reload: {
                    ok: false,
                    status: "skipped",
                    message: "Save did not run.",
                },
                events: {
                    ok: false,
                    kinds: [],
                    message: "Save did not run.",
                },
                diagnostics: this.createDiagnostics("error", "STORAGE_ADAPTER_UNAVAILABLE"),
            };
        }

        const saved = await runtime.saveSession({
            sessionId,
            expectedRevision: this.revision,
        });
        this.assertLifecycleCurrent(token, true);
        const diagnostics = this.collectDiagnostics(saved);
        if (saved.ok && saved.data) {
            this.revision = saved.data.revision;
            this.dirty = saved.data.dirty;
        }

        const save = summarizeSaveResult(saved);
        const reload = save.ok
            ? await this.reloadSavedTarget(target, token)
            : {
                ok: false,
                status: "skipped" as const,
                message: "Save failed.",
            };
        this.assertLifecycleCurrent(token, true);
        const events = this.getSaveEvents();

        return {
            save,
            reload,
            events,
            diagnostics: [
                ...diagnostics,
                ...this.createDiagnostics(save.ok ? "info" : "error", save.ok
                    ? "BROWSER_WORKSPACE_SAVED"
                    : "BROWSER_WORKSPACE_SAVE_FAILED"),
            ],
        };
    }

    private setWorkingProject(
        project: unknown,
        reader: "BrowserWorkspace" | "UamBaseline",
    ): void {
        this.workingProject = cloneJson(project);
        this.currentProjectSnapshot = createProjectSnapshotFromUamProject(this.workingProject, {
            projectPath: this.projectStorage?.getFairyPath() || "memory://browser-live-session",
            openfairyguiVersion: this.backendPackageVersion || "unknown",
            reader,
        });
    }

    private getBoundary(): string {
        if (this.status === "connected") {
            return this.fileSystem
                ? `The browser backend is connected to workspace storage. Project source: ${this.projectSource}; restore: ${this.workspaceRestoreStatus}.`
                : "The browser backend is connected to an in-memory project session. Persistent save needs browser workspace storage.";
        }
        if (this.status === "loading") {
            return "OpenFairyGUI backend browser bundle is loading.";
        }
        if (this.status === "failed") {
            return "OpenFairyGUI backend browser bundle failed to connect; command adapter can fall back to the browser working copy.";
        }
        return "OpenFairyGUI backend browser bundle has not been requested yet.";
    }

    private createDiagnostics(
        severity: EditorCommandDiagnostic["severity"],
        code: string,
    ): EditorCommandDiagnostic[] {
        return [
            {
                severity,
                code,
                message: this.getBoundary(),
            },
        ];
    }

    private collectDiagnostics(result: {
        meta?: { diagnostics?: EditorCommandDiagnostic[] };
        diagnostics?: EditorCommandDiagnostic[];
    }): EditorCommandDiagnostic[] {
        const diagnostics = result.meta?.diagnostics ?? result.diagnostics ?? [];
        return diagnostics.slice();
    }

    private async createStorageOpenInput(
        backendModule: BrowserBackendModule,
        token: BrowserLiveSessionLifecycleToken,
    ): Promise<{
        fileSystem: unknown;
        fairyPath: string;
        canonicalProjectPath: string;
        canonicalPathKey: string;
    } | null> {
        if (!this.projectStorage || typeof backendModule.createBackendStorageFileSystem !== "function") {
            this.fileSystem = null;
            return null;
        }

        const storageState = await this.projectStorage.initialize();
        this.assertLifecycleCurrent(token);
        const adapter = this.projectStorage.getAdapter();
        if (!storageState.available || !adapter) {
            this.fileSystem = null;
            return null;
        }

        const fileSystem = backendModule.createBackendStorageFileSystem(adapter);
        this.fileSystem = fileSystem;
        return {
            fileSystem,
            fairyPath: this.projectStorage.getFairyPath(),
            canonicalProjectPath: `${storageState.kind}://${storageState.workspaceName}`,
            canonicalPathKey: `${storageState.kind}://${storageState.workspaceName}`,
        };
    }

    private async resolveSessionProject(
        baseline: BrowserLiveSessionBaseline,
        backendModule: BrowserBackendModule,
        storageInput: {
            fileSystem: unknown;
            fairyPath: string;
        } | null,
        token: BrowserLiveSessionLifecycleToken,
    ): Promise<unknown> {
        const baselineProject = cloneJson(baseline.uamProject);
        this.projectSource = "uam_baseline";
        this.workspaceRestoreStatus = storageInput ? "missing" : "unavailable";
        this.workspaceRestoreMessage = storageInput
            ? "Browser workspace does not contain a project file yet; the session starts from generated UAM baseline."
            : "Browser workspace storage is unavailable; the session starts from generated UAM baseline.";

        if (!storageInput || !this.projectStorage) {
            return baselineProject;
        }

        const adapter = this.projectStorage.getAdapter();
        if (!adapter) {
            this.workspaceRestoreStatus = "unavailable";
            this.workspaceRestoreMessage = "Browser workspace adapter is unavailable.";
            return baselineProject;
        }

        if (!backendModule.ProjectReader || !backendModule.liftDocumentToUamProject) {
            this.workspaceRestoreStatus = "unsupported";
            this.workspaceRestoreMessage =
                "Backend bundle does not expose ProjectReader/liftDocumentToUamProject for workspace restore.";
            throw new Error(this.workspaceRestoreMessage);
        }

        const fairyPath = this.projectStorage.getFairyPath();
        if (!(await adapter.exists(fairyPath))) {
            this.assertLifecycleCurrent(token);
            this.workspaceRestoreStatus = "missing";
            this.workspaceRestoreMessage =
                "Browser workspace project file is missing; the next dirty save can seed the workspace.";
            return baselineProject;
        }

        try {
            const reader = new backendModule.ProjectReader(storageInput.fileSystem);
            const doc = await reader.read(fairyPath, { includeBinaryData: true, hydrateResourceBytes: true });
            this.assertLifecycleCurrent(token);
            const restoredProject = backendModule.liftDocumentToUamProject(doc);
            this.projectSource = "browser_workspace";
            this.workspaceRestoreStatus = "restored";
            this.workspaceRestoreMessage =
                "Browser workspace project file was restored and is the OpenFairyGUI session source.";
            return restoredProject;
        } catch (error) {
            if (error instanceof BrowserLiveSessionLifecycleInterruptedError) throw error;
            this.projectSource = "uam_baseline";
            this.workspaceRestoreStatus = "failed";
            this.workspaceRestoreMessage = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }

    private async reloadSavedTarget(
        target?: BrowserSaveTarget,
        token?: BrowserLiveSessionLifecycleToken,
        requireIdentity = true,
    ): Promise<BrowserReloadStepResult> {
        if (!target) {
            return {
                ok: true,
                status: "skipped",
                message: "No target was selected for reload verification.",
            };
        }

        if (!this.backendModule?.ProjectReader || !this.backendModule.liftDocumentToUamProject || !this.fileSystem || !this.projectStorage) {
            return {
                ok: true,
                status: "skipped",
                message: "Backend bundle does not expose ProjectReader/liftDocumentToUamProject for reload verification.",
            };
        }

        try {
            const reader = new this.backendModule.ProjectReader(this.fileSystem);
            const doc = await reader.read(this.projectStorage.getFairyPath(), { includeBinaryData: true, hydrateResourceBytes: true });
            if (token) this.assertLifecycleCurrent(token, requireIdentity);
            const project = this.backendModule.liftDocumentToUamProject(doc);
            const verification = verifySaveTarget(project, target);
            this.projectSource = "browser_workspace";
            this.workspaceRestoreStatus = "restored";
            this.workspaceRestoreMessage =
                "Browser workspace save completed and ProjectReader reload is now the active UAM snapshot source.";
            this.setWorkingProject(project, "BrowserWorkspace");
            return {
                ok: verification.ok,
                status: verification.ok ? "verified" : "failed",
                reloaded: verification.reloaded,
                message: verification.message,
            };
        } catch (error) {
            return {
                ok: false,
                status: "failed",
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private getSaveEvents(): BrowserEventsStepResult {
        if (!this.runtime || !this.sessionId) {
            return {
                ok: false,
                kinds: [],
                message: "OpenFairyGUI session is unavailable.",
            };
        }

        const events = this.runtime.getEvents({
            sessionId: this.sessionId,
            afterSeq: 0,
            limit: 30,
        });
        if (!events.ok || !events.data) {
            return {
                ok: false,
                kinds: [],
                message: events.error?.message || "Failed to read OpenFairyGUI backend events.",
            };
        }

        return {
            ok: true,
            kinds: events.data.events.map((event) => event.kind),
        };
    }
}

export async function loadBrowserLiveSessionBaseline(
    url: string = BROWSER_UAM_BASELINE_URL,
): Promise<BrowserLiveSessionBaseline> {
    const response = await fetchFirstAvailable(
        url === BROWSER_UAM_BASELINE_URL
            ? [url, RUNTIME_UAM_BASELINE_FALLBACK_URL]
            : [url],
        "runtime project baseline",
    );

    const baseline = (await response.json()) as BrowserLiveSessionBaseline;
    assertBrowserLiveSessionBaseline(baseline);
    baseline.uamProject = hydrateBaselineBinaryData(baseline.uamProject);
    return baseline;
}

async function importBrowserBackendBundle(): Promise<BrowserBackendModule> {
    const response = await fetchFirstAvailable(
        [BROWSER_BACKEND_BUNDLE_URL, RUNTIME_BACKEND_BUNDLE_FALLBACK_URL],
        "editor backend browser bundle",
    );
    const bundleUrl = new URL(response.url, window.location.href).href;
    const dynamicImport = new Function("url", "return import(url)") as DynamicImporter;
    const backendModule = await dynamicImport(bundleUrl);

    if (!backendModule.BackendRuntime) {
        throw new Error("Editor backend browser bundle does not export BackendRuntime.");
    }

    return backendModule;
}

async function fetchFirstAvailable(urls: string[], label: string): Promise<Response> {
    const failures: string[] = [];

    for (const url of urls) {
        const response = await fetch(url, { cache: "no-cache" });
        if (response.ok) return response;
        failures.push(`${url}: ${response.status} ${response.statusText}`);
    }

    throw new Error(`Failed to load ${label}. Tried ${failures.join("; ")}.`);
}

function assertBrowserLiveSessionBaseline(baseline: BrowserLiveSessionBaseline): void {
    if (!baseline || (baseline.schemaVersion !== 1 && baseline.schemaVersion !== 2)) {
        throw new Error("Unsupported runtime project baseline schema.");
    }

    if (!baseline.source || !baseline.project || !baseline.target || !baseline.uamProject) {
        throw new Error("Runtime project baseline is missing required data.");
    }
}

function hydrateBaselineBinaryData(value: unknown): unknown {
    const project = cloneJson(value) as {
        packages?: Array<{
            resources?: Array<{ binaryData?: unknown; sourceBytes?: unknown }>;
        }>;
    };
    for (const pkg of project.packages ?? []) {
        for (const resource of pkg.resources ?? []) {
            const encoded = (resource.sourceBytes ?? resource.binaryData) as { encoding?: unknown; data?: unknown } | undefined;
            if (encoded?.encoding !== "base64" || typeof encoded.data !== "string") continue;
            delete resource.binaryData;
            resource.sourceBytes = decodeBase64(encoded.data);
        }
    }
    return project;
}

function decodeBase64(value: string): Uint8Array {
    const raw = atob(value);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
        bytes[index] = raw.charCodeAt(index);
    }
    return bytes;
}

function formatBackendOpenError(result: BrowserBackendOpenProjectResult): string {
    if (result.error?.code || result.error?.message) {
        return `${result.error.code || "backend_open_failed"}: ${result.error.message || "Open project session failed."}`;
    }

    return "Backend openProjectSession failed without a structured error.";
}

function summarizeSaveResult(result: BrowserBackendSaveSessionResult): BrowserSaveStepResult {
    if (result.ok && result.data) {
        return {
            ok: true,
            revision: result.data.revision,
            dirty: result.data.dirty,
            lastSavedRevision: result.data.lastSavedRevision,
        };
    }

    return {
        ok: false,
        revision: result.session?.revision ?? result.snapshot?.revision,
        dirty: result.session?.dirty ?? result.snapshot?.dirty,
        lastSavedRevision: result.session?.lastSavedRevision ?? result.snapshot?.lastSavedRevision ?? result.error?.lastSavedRevision,
        errorCode: result.error?.code || "workspace_save_failed",
        message: result.error?.message || "OpenFairyGUI saveSession failed.",
    };
}

function createBootstrapTarget(baseline: BrowserLiveSessionBaseline): BrowserSaveTarget | null {
    const selector = {
        packageId: baseline.target.packageId,
        componentResourceId: baseline.target.componentResourceId,
        displayNodeId: baseline.target.displayNodeId,
    };
    return createDisplayNodeSaveTarget(baseline.uamProject, selector);
}

function createBootstrapOperation(target: BrowserSaveTarget, revision: number): EditorCommandOperation {
    if (target.kind !== "displayNode") {
        throw new Error("Bootstrap target must be a display node.");
    }
    const props: {
        position?: { x: number; y: number };
        size?: { width: number; height: number };
        pivot?: { x: number; y: number };
        pivotAsAnchor?: boolean;
        visible?: boolean;
        text?: string;
        font?: string;
        fontSize?: number;
        color?: string;
    } = {
        position: {
            x: target.expected.x,
            y: target.expected.y,
        },
        visible: target.expected.visible,
        pivot: {
            x: target.expected.pivotX,
            y: target.expected.pivotY,
        },
        pivotAsAnchor: target.expected.pivotAsAnchor,
    };
    if (target.expected.width > 0 && target.expected.height > 0) {
        props.size = {
            width: target.expected.width,
            height: target.expected.height,
        };
    }
    if (target.expected.text.length > 0) {
        props.text = target.expected.text;
    }
    if (target.expected.font) {
        props.font = target.expected.font;
    }
    if (target.expected.fontSize > 0) {
        props.fontSize = target.expected.fontSize;
    }
    if (target.expected.color) {
        props.color = target.expected.color;
    }

    return {
        opId: `bootstrap-workspace-${revision}`,
        kind: "setDisplayNodeProps",
        selector: target.selector,
        props,
    };
}
