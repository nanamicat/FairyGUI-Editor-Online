import { EditorCommandAdapter } from "../commands/EditorCommandAdapter";
import type { HighRiskTransactionPreparation } from "../commands/HighRiskAuthoringTransactions";
import {
    DEFAULT_BROWSER_WORKSPACE_ID,
} from "../runtime/BrowserWorkspaceRegistry";
import {
    WorkspaceLifecycleController,
    loadBrowserWorkspaceRegistry,
} from "../runtime/WorkspaceLifecycleController";
import { BrowserLiveSessionBridge } from "../services/BrowserLiveSessionBridge";
import { BrowserProjectStorage } from "../services/BrowserProjectStorage";
import type {
    EditorCommandOperation,
    EditorCommandResult,
    EditorHighRiskTransaction,
    SetDisplayNodePropsCommand,
} from "../model/EditorCommand";
import type { EditorProjectSnapshot } from "../model/ProjectSnapshot";
import type { BrowserSaveTarget } from "../model/BrowserWorkspace";
import type { BrowserLiveSessionIdentity } from "../services/BrowserLiveSessionBridge";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";

export const PROJECT_SESSION_SERVICE = "fairygui.project-session";

let pendingProjectSessionDisposal: Promise<void> = Promise.resolve();

export class EditorProjectSession {
    readonly commandAdapter = new EditorCommandAdapter();
    readonly projectStorage: BrowserProjectStorage;
    readonly liveSessionBridge: BrowserLiveSessionBridge;
    readonly workspaceLifecycle: WorkspaceLifecycleController;
    private currentSnapshot: EditorProjectSnapshot | null = null;
    private currentLastResult: EditorCommandResult | null = null;
    private readonly modifiedPackageIds = new Set<string>();
    private readonly snapshotResetListeners = new Set<(
        snapshot: EditorProjectSnapshot,
        previous: EditorProjectSnapshot | null,
    ) => void>();
    private readonly snapshotSyncListeners = new Set<(
        snapshot: EditorProjectSnapshot,
        operations: EditorCommandOperation[],
    ) => void>();

    private operationQueue: Promise<void>;
    private disposed = false;

    constructor() {
        const registry = loadBrowserWorkspaceRegistry();
        this.projectStorage = new BrowserProjectStorage(
            registry.activeId || DEFAULT_BROWSER_WORKSPACE_ID,
            registry.entries.find((entry) => entry.id === registry.activeId)?.fairyPath,
        );
        this.liveSessionBridge = new BrowserLiveSessionBridge(this.projectStorage);
        this.workspaceLifecycle = new WorkspaceLifecycleController(
            this.liveSessionBridge,
            this.projectStorage,
            registry,
        );
        this.commandAdapter.setLiveSessionRuntime(this.liveSessionBridge);
        this.operationQueue = pendingProjectSessionDisposal;
    }

    get snapshot(): EditorProjectSnapshot | null { return this.currentSnapshot; }
    get lastResult(): EditorCommandResult | null { return this.currentLastResult; }

    getModifiedPackageIds(): string[] {
        return [...this.modifiedPackageIds];
    }

    markPackagesPublished(packageIds: string[]): void {
        for (const packageId of packageIds) this.modifiedPackageIds.delete(packageId);
    }

    onDidResetSnapshot(
        listener: (snapshot: EditorProjectSnapshot, previous: EditorProjectSnapshot | null) => void,
    ): () => void {
        this.snapshotResetListeners.add(listener);
        return () => this.snapshotResetListeners.delete(listener);
    }

    onDidSyncSnapshot(
        listener: (snapshot: EditorProjectSnapshot, operations: EditorCommandOperation[]) => void,
    ): () => void {
        this.snapshotSyncListeners.add(listener);
        return () => this.snapshotSyncListeners.delete(listener);
    }

    resetSnapshot(snapshot: EditorProjectSnapshot, revision = 0): void {
        const previous = this.currentSnapshot;
        this.currentSnapshot = snapshot;
        this.commandAdapter.reset(snapshot, revision);
        this.currentLastResult = null;
        this.modifiedPackageIds.clear();
        for (const listener of this.snapshotResetListeners) listener(snapshot, previous);
    }

    syncSnapshot(
        snapshot: EditorProjectSnapshot,
        operations: EditorCommandOperation[] = [],
        notify = true,
    ): void {
        this.currentSnapshot = snapshot;
        this.commandAdapter.updateSnapshot(snapshot);
        if (operations.length) this.markModifiedPackages(snapshot, operations);
        if (notify) {
            for (const listener of this.snapshotSyncListeners) listener(snapshot, operations);
        }
    }

    clearSnapshot(): void {
        this.currentSnapshot = null;
        this.currentLastResult = null;
    }

    updateLastResult(result: EditorCommandResult | null): void {
        this.currentLastResult = result;
    }

    async connectNow() {
        const state = await this.liveSessionBridge.connect();
        if (state.status !== "connected") return { state, snapshot: null, synchronized: false };
        const snapshot = this.liveSessionBridge.getProjectSnapshot();
        if (!snapshot) {
            await this.liveSessionBridge.reset();
            return { state, snapshot: null, synchronized: false };
        }
        this.resetSnapshot(snapshot, state.revision);
        return { state, snapshot, synchronized: true };
    }

    async applyPreparationNow(
        preparation: HighRiskTransactionPreparation,
        identity: BrowserLiveSessionIdentity | null,
        notify = true,
    ) {
        if (preparation.ok === false) {
            return { ok: false as const, kind: "unavailable" as const, preparation };
        }
        if (!identity || !this.liveSessionBridge.isSessionIdentityCurrent(identity)) {
            return { ok: false as const, kind: "stale" as const };
        }
        const result = await this.commandAdapter.applyHighRiskTransactionWithRuntime(
            preparation.transaction as EditorHighRiskTransaction,
        );
        this.currentLastResult = result;
        const operations = result.operations || (result.operation ? [result.operation] : []);
        const snapshot = result.ok ? this.liveSessionBridge.getProjectSnapshot() : null;
        if (snapshot) this.syncSnapshot(snapshot, operations, notify);
        return {
            ok: result.ok,
            kind: "result" as const,
            result,
            snapshot,
            operations,
            summary: preparation.transaction.summary,
        };
    }

    async applyDisplayNodePropsNow(
        commands: SetDisplayNodePropsCommand[],
        summary: string,
        notify = true,
    ) {
        const result = commands.length === 1
            ? await this.commandAdapter.applySetDisplayNodePropsWithRuntime(commands[0])
            : await this.commandAdapter.applySetDisplayNodePropsGroupWithRuntime(commands, summary);
        return this.syncCommandResult(result, notify);
    }

    async undoNow(notify = true) {
        return this.syncCommandResult(
            await this.commandAdapter.undoLastWithRuntime(),
            notify,
        );
    }

    async redoNow(notify = true) {
        return this.syncCommandResult(
            await this.commandAdapter.redoLastWithRuntime(),
            notify,
        );
    }

    async saveWorkspaceNow(target?: BrowserSaveTarget, notify = true) {
        if (!this.commandAdapter.isLiveSessionAligned()) {
            return { kind: "unaligned" as const };
        }
        const checkpointStateId = this.commandAdapter.getCurrentStateId();
        const checkpointRevision = this.commandAdapter.getRevision();
        const result = await this.workspaceLifecycle.save(target);
        const browserWorkspaceSaved = result.results.save.ok && result.results.reload.ok;
        const checkpointSaved = browserWorkspaceSaved
            && result.results.save.revision === checkpointRevision;
        let snapshot: EditorProjectSnapshot | null = null;
        const operations = this.currentLastResult?.operations
            || (this.currentLastResult?.operation ? [this.currentLastResult.operation] : []);
        if (checkpointSaved) {
            this.commandAdapter.markSaved(checkpointStateId);
            snapshot = this.liveSessionBridge.getProjectSnapshot();
            if (snapshot) this.syncSnapshot(snapshot, operations, notify);
        }
        return {
            kind: "result" as const,
            result,
            browserWorkspaceSaved,
            checkpointSaved,
            newerEdits: browserWorkspaceSaved && !checkpointSaved,
            snapshot,
            operations,
        };
    }

    runExclusive<T>(task: () => Promise<T>): Promise<T> {
        if (this.disposed) return Promise.reject(new Error("Project session is disposed."));
        const result = this.operationQueue.then(task);
        this.operationQueue = result.then(
            (): void => {},
            (): void => {},
        );
        return result;
    }

    async dispose(): Promise<void> {
        if (this.disposed) return this.operationQueue;
        this.disposed = true;
        this.snapshotResetListeners.clear();
        this.snapshotSyncListeners.clear();
        const close = this.operationQueue.then(() => this.liveSessionBridge.reset());
        pendingProjectSessionDisposal = close.then(
            (): void => {},
            (): void => {},
        );
        this.operationQueue = pendingProjectSessionDisposal;
        try {
            const result = await close;
            if (!result.ok) console.warn("[Editor Session] dispose could not close the live session", result);
        } catch (error) {
            console.warn("[Editor Session] dispose failed to close the live session", error);
        }
    }

    private syncCommandResult(result: EditorCommandResult, notify: boolean) {
        this.currentLastResult = result;
        const operations = result.operations || (result.operation ? [result.operation] : []);
        const snapshot = result.ok ? this.liveSessionBridge.getProjectSnapshot() : null;
        if (snapshot) this.syncSnapshot(snapshot, operations, notify);
        return {
            kind: "result" as const,
            result,
            snapshot,
            operations,
        };
    }

    private markModifiedPackages(snapshot: EditorProjectSnapshot, operations: EditorCommandOperation[]): void {
        const validIds = new Set(snapshot.packages.map((pkg) => pkg.id));
        const found = new Set<string>();
        let projectWide = false;
        const visit = (value: unknown): void => {
            if (!value || typeof value !== "object") return;
            const record = value as Record<string, unknown>;
            if (record.kind === "updateProjectSettings") projectWide = true;
            if (typeof record.packageId === "string" && validIds.has(record.packageId)) found.add(record.packageId);
            if (record.kind === "addPackage" && record.package && typeof record.package === "object") {
                const id = String((record.package as Record<string, unknown>).id || "");
                if (validIds.has(id)) found.add(id);
            }
            Object.values(record).forEach(visit);
        };
        operations.forEach(visit);
        if (projectWide || found.size === 0) snapshot.packages.forEach((pkg) => this.modifiedPackageIds.add(pkg.id));
        else found.forEach((id) => this.modifiedPackageIds.add(id));
    }
}

export function createProjectSessionModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.project-session",
        hotReloadable: false,
        activate(context) {
            const session = new EditorProjectSession();
            context.provideService(PROJECT_SESSION_SERVICE, session);
            return () => session.dispose();
        },
    };
}
