import type {
    BrowserSaveResult,
    BrowserSaveTarget,
    BrowserWorkspaceLifecycleResult,
} from "../model/BrowserWorkspace";
import type { BrowserProjectImportResult, BrowserProjectReadProgress } from "../services/BrowserProjectImport";
import type { BrowserLiveSessionIdentity } from "../services/BrowserLiveSessionBridge";
import { createDisplayNodeSaveTarget } from "../services/BrowserSaveTargetVerifier";
import { loadProjectSnapshot } from "../services/ProjectSnapshotLoader";
import type {
    BrowserWorkspaceRegistry,
    BrowserWorkspaceRegistryEntry,
} from "../runtime/BrowserWorkspaceRegistry";
import {
    getBrowserSaveFailure,
    getWorkspaceLifecycleFailure,
} from "../ui/InspectorPresentation";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const WORKSPACE_LIFECYCLE_SERVICE = "fairygui.workspace-lifecycle";

export type WorkspaceLifecycleHost = {
    persistWorkspaceViewState(): void;
    resetAndRestoreWorkspaceViewState(): void;
    showStartScene(): void;
    stopPublishedTestQuietly(): void;
};

export function recordWorkspaceLifecycleDebug(
    chrome: EditorShellChrome,
    result: BrowserWorkspaceLifecycleResult,
): void {
    const materialize = result.results.materialize;
    const apply = result.results.apply;
    chrome.setDebugAttribute("data-fairy-editor-workspace-action", result.mode);
    chrome.setDebugAttribute("data-fairy-editor-workspace-ok", result.ok ? "true" : "false");
    chrome.setDebugAttribute("data-fairy-editor-workspace-project-file", result.storage.projectFileExists ? "true" : "false");
    chrome.setDebugAttribute("data-fairy-editor-workspace-files", String(result.storage.fileCount));
    chrome.setDebugAttribute("data-fairy-editor-workspace-materialize-ok", materialize ? String(materialize.ok) : "");
    chrome.setDebugAttribute("data-fairy-editor-workspace-materialize-revision", materialize?.revision === undefined ? "" : String(materialize.revision));
    chrome.setDebugAttribute("data-fairy-editor-workspace-apply-ok", apply ? String(apply.ok) : "");
    chrome.setDebugAttribute("data-fairy-editor-workspace-import-source", result.imported?.source || "");
    chrome.setDebugAttribute("data-fairy-editor-workspace-import-fairy", result.imported?.fairyPath || "");
    chrome.setDebugAttribute("data-fairy-editor-workspace-export-format", result.export?.format || "");
    chrome.setDebugAttribute("data-fairy-editor-workspace-folder-binding", result.storage.directoryWriteback?.status || "");
}

export class EditorWorkspaceLifecycle {
    private host: WorkspaceLifecycleHost | null = null;
    private readonly inFlight = new Set<Promise<unknown>>();
    private active = true;

    constructor(
        private readonly chrome: EditorShellChrome,
        private readonly session: EditorProjectSession,
        private readonly document: EditorDocumentAuthoring,
    ) {}

    get registry(): BrowserWorkspaceRegistry {
        return this.session.workspaceLifecycle.registry;
    }

    bind(host: WorkspaceLifecycleHost): () => void {
        if (this.host) throw new Error("Workspace lifecycle host is already bound.");
        this.host = host;
        return () => {
            if (this.host === host) this.host = null;
        };
    }

    initialize(): Promise<boolean> {
        if (!this.active) return Promise.resolve(false);
        return this.track(this.session.runExclusive(() => this.initializeNow()));
    }

    prepareStartScene(): Promise<void> {
        return this.track(this.session.workspaceLifecycle.prepareRecentDirectories().catch((error) => {
            this.chrome.setStatus(`最近项目授权记录读取失败：${error instanceof Error ? error.message : String(error)}`, "warning");
        }));
    }

    openProject(picked: BrowserProjectImportResult): Promise<boolean> {
        if (!this.active) return Promise.resolve(false);
        return this.track(this.session.runExclusive(() => this.openProjectNow(picked)));
    }

    openDirectoryProject(
        directory: FileSystemDirectoryHandle,
        onProgress?: (progress: BrowserProjectReadProgress) => void,
    ): Promise<boolean> {
        if (!this.active) return Promise.resolve(false);
        return this.track(this.session.runExclusive(async () => {
            if (!this.guardTransition("open", "data-fairy-editor-workspace-open")) return false;
            this.session.workspaceLifecycle.setReadProgressHandler(onProgress);
            try {
                const existing = await this.session.workspaceLifecycle.findDirectoryWorkspace(directory);
                if (existing) return await this.switchNow(existing, () => (
                    this.session.workspaceLifecycle.readDirectoryProject(directory, onProgress)
                ));
                const picked = await this.session.workspaceLifecycle.readDirectoryProject(directory, onProgress);
                return await this.openProjectNow(picked);
            } finally {
                this.session.workspaceLifecycle.setReadProgressHandler();
            }
        }));
    }

    private async openProjectNow(picked: BrowserProjectImportResult): Promise<boolean> {
        if (!this.guardTransition("open", "data-fairy-editor-workspace-open")) return false;
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        try {
            const existing = await this.session.workspaceLifecycle.findPickedDirectoryWorkspace(picked);
            if (existing) return await this.switchNow(existing, () => Promise.resolve(picked));
            this.document.persist();
            this.host?.persistWorkspaceViewState();
            const entry = await this.session.workspaceLifecycle.createWorkspace(
                picked.imported.sourceName,
                picked.imported.fairyPath,
            );
            this.session.clearSnapshot();
            this.document.reset();
            this.host?.resetAndRestoreWorkspaceViewState();
            return await this.importWorkspaceNow(picked, "Folder", entry.id);
        } catch (error) {
            await this.reconcileSwitchFailureNow(identity);
            return this.failSwitch(error);
        }
    }

    save(): Promise<void> {
        if (!this.active) return Promise.resolve();
        return this.track(this.session.runExclusive(() => this.saveNow()));
    }

    create(name: string): Promise<boolean> {
        if (!this.active) return Promise.resolve(false);
        return this.track(this.session.runExclusive(() => this.createNow(name)));
    }

    switch(entry: BrowserWorkspaceRegistryEntry): Promise<boolean> {
        if (!this.active) return Promise.resolve(false);
        if (!this.guardTransition("switch", "data-fairy-editor-workspace-switch")) return Promise.resolve(false);
        // Request permission now, before the session queue or IndexedDB can consume user activation.
        const permission = this.session.workspaceLifecycle.authorizeWorkspace(entry);
        return this.track(permission.then(() => this.active
            ? this.session.runExclusive(() => this.switchNow(entry))
            : false).catch((error) => {
            this.chrome.setStatus(`项目打开失败：${error instanceof Error ? error.message : String(error)}`, "error");
            return false;
        }));
    }

    close(): Promise<boolean> {
        if (!this.active) return Promise.resolve(false);
        return this.track(this.session.runExclusive(() => this.closeNow()));
    }

    reauthorizeFolder(): Promise<void> {
        if (!this.active) return Promise.resolve();
        // Browser permission prompts must stay on the user-activation path instead of waiting in the session queue.
        return this.track(this.reauthorizeFolderNow());
    }

    checkExternalChanges(): Promise<void> {
        if (!this.active) return Promise.resolve();
        return this.track(this.session.runExclusive(() => this.checkExternalChangesNow()));
    }

    importWorkspace(picked: BrowserProjectImportResult, label: string): Promise<boolean> {
        if (!this.active) return Promise.resolve(false);
        const workspaceId = this.registry.activeId;
        return this.track(this.session.runExclusive(() => this.importWorkspaceNow(picked, label, workspaceId)));
    }

    pickDirectoryProject(): Promise<BrowserProjectImportResult> {
        return this.session.workspaceLifecycle.pickDirectoryProject();
    }

    invalidateRuntime(refreshPreview = false): void {
        this.host?.stopPublishedTestQuietly();
        this.document.resetRuntimePackages();
        if (refreshPreview) this.document.refreshPreview();
    }

    async dispose(): Promise<void> {
        if (!this.active) return;
        this.active = false;
        await Promise.allSettled([...this.inFlight]);
        this.host = null;
    }

    private async initializeNow(restoreBinding = true, runtimeInvalidated = false): Promise<boolean> {
        const workspaceId = this.registry.activeId;
        let quarantineReason: string | null;
        try {
            quarantineReason = await this.session.workspaceLifecycle.getActiveWorkspaceQuarantine();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.failClosedWorkspaceNow(
                workspaceId,
                `Workspace quarantine state could not be verified: ${message}`,
                runtimeInvalidated,
            );
        }
        if (quarantineReason) {
            return this.failClosedWorkspaceNow(workspaceId, quarantineReason, runtimeInvalidated);
        }
        this.chrome.setDebugAttribute("data-fairy-editor-workspace-quarantined", "");
        try {
            if (restoreBinding) await this.session.workspaceLifecycle.restoreWorkspaceBinding();
            if (!runtimeInvalidated) this.invalidateRuntime();
            if (await this.connectNow()) {
                this.chrome.setStatus("Project loaded.");
                return true;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.chrome.setStatus(`Live project load failed: ${message}`, "error");
            console.error("[Editor Project] live project load failed", error);
        }
        try {
            this.session.resetSnapshot(await loadProjectSnapshot());
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.chrome.setStatus(`Snapshot fallback failed: ${message}`, "error");
            console.error("[Editor Project] snapshot fallback failed", error);
        }
        return false;
    }

    private async createNow(name: string): Promise<boolean> {
        if (!this.guardTransition("switch", "data-fairy-editor-workspace-switch")) return false;
        this.document.persist();
        this.host?.persistWorkspaceViewState();
        this.chrome.setStatus(`正在创建浏览器工作区 ${name}…`);
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        try {
            const entry = await this.session.workspaceLifecycle.createWorkspace(name);
            return await this.finishSwitchNow(entry);
        } catch (error) {
            await this.reconcileSwitchFailureNow(identity);
            return this.failSwitch(error);
        }
    }

    private async saveNow(): Promise<void> {
        this.chrome.setStatus("Browser workspace save started.");
        try {
            const outcome = await this.session.saveWorkspaceNow(this.createSaveTarget());
            if (outcome.kind === "unaligned") {
                this.chrome.setStatus(
                    "Browser workspace save blocked: reconnect the browser live session before saving.",
                    "error",
                );
                return;
            }
            const { result } = outcome;
            this.recordSaveResult(result);
            if (outcome.newerEdits) {
                this.chrome.setStatus("Save completed, but newer edits were detected. Save again.", "error");
                return;
            }
            if (result.ok) {
                this.chrome.setStatus(
                    result.writeback?.status === "saved"
                        ? `Browser workspace saved and wrote ${result.writeback.directoryName}.`
                        : "Browser workspace saved.",
                );
                return;
            }
            if (
                result.results.save.ok
                && result.results.reload.ok
                && result.writeback?.status === "conflict"
            ) {
                this.chrome.setStatus(
                    "Browser workspace saved; Folder write-back was blocked by external changes. Resolve the conflict and select the project directory again.",
                );
                return;
            }
            this.chrome.setStatus(`Browser workspace save failed: ${getBrowserSaveFailure(result)}.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.chrome.setStatus(`Browser workspace save failed: ${message}`, "error");
            console.error("[Workspace] save failed", error);
        }
    }

    private async switchNow(
        entry: BrowserWorkspaceRegistryEntry,
        recover?: () => Promise<BrowserProjectImportResult>,
    ): Promise<boolean> {
        if (!this.guardTransition("switch", "data-fairy-editor-workspace-switch")) return false;
        this.document.persist();
        this.host?.persistWorkspaceViewState();
        this.chrome.setStatus(`正在切换到浏览器工作区 ${entry.name}…`);
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        try {
            const state = await this.session.workspaceLifecycle.switchWorkspace(entry);
            if (recover && (!state.projectFileExists || await this.session.workspaceLifecycle.getActiveWorkspaceQuarantine())) {
                const picked = await recover();
                this.session.clearSnapshot();
                this.document.reset();
                this.host?.resetAndRestoreWorkspaceViewState();
                return await this.importWorkspaceNow(picked, "Folder", entry.id);
            }
            return await this.finishSwitchNow(entry);
        } catch (error) {
            await this.reconcileSwitchFailureNow(identity);
            return this.failSwitch(error);
        }
    }

    private async reconcileSwitchFailureNow(identity: BrowserLiveSessionIdentity | null): Promise<void> {
        if (identity && this.session.liveSessionBridge.isSessionIdentityCurrent(identity)) return;
        this.invalidateRuntime();
        this.session.clearSnapshot();
        this.document.reset();
        await this.initializeNow(false, true);
    }

    private async finishSwitchNow(entry: BrowserWorkspaceRegistryEntry): Promise<boolean> {
        this.invalidateRuntime();
        this.session.clearSnapshot();
        this.document.reset();
        this.host?.resetAndRestoreWorkspaceViewState();
        if (!await this.initializeNow(false, true)) {
            this.chrome.setDebugAttribute("data-fairy-editor-workspace-switch", "failed");
            return false;
        }
        this.chrome.setDebugAttribute("data-fairy-editor-workspace-switch", entry.id);
        this.chrome.setStatus(`已打开浏览器工作区：${entry.name}。`);
        return true;
    }

    private failSwitch(error: unknown): false {
        const message = error instanceof Error ? error.message : String(error);
        this.chrome.setDebugAttribute("data-fairy-editor-workspace-switch", "failed");
        this.chrome.setStatus(`浏览器工作区切换失败：${message}`, "error");
        console.error("[Workspace] switch failed", error);
        return false;
    }

    private async closeNow(): Promise<boolean> {
        if (!this.guardTransition("close", "data-fairy-editor-workspace-close")) return false;
        this.document.persist();
        this.host?.persistWorkspaceViewState();
        try {
            const reset = await this.session.workspaceLifecycle.closeWorkspace();
            if (!reset.ok) {
                this.chrome.setStatus(`工作区关闭失败：${reset.message || "会话重置失败"}。`, "error");
                return false;
            }
            this.invalidateRuntime();
            this.session.clearSnapshot();
            this.document.reset();
            this.recordSessionState(this.session.liveSessionBridge.getState());
            this.chrome.setDebugAttribute(
                "data-fairy-editor-workspace-close",
                this.session.workspaceLifecycle.registry.activeId,
            );
            this.chrome.setStatus("浏览器工作区已关闭；其中的文件和最近记录均已保留。");
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.chrome.setStatus(`工作区关闭失败：${message}`, "error");
            return false;
        }
    }

    private async reauthorizeFolderNow(): Promise<void> {
        try {
            const state = await this.session.workspaceLifecycle.reauthorizeDirectoryBinding();
            this.chrome.setDebugAttribute(
                "data-fairy-editor-workspace-reauthorize",
                state.directoryWriteback?.status || "none",
            );
            this.chrome.setStatus(state.directoryWriteback?.message || "No Folder binding is attached.");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.chrome.setStatus(`Folder reauthorization failed: ${message}`, "error");
        }
    }

    private async checkExternalChangesNow(): Promise<void> {
        try {
            const result = await this.session.workspaceLifecycle.checkExternalChanges();
            this.chrome.setDebugAttribute("data-fairy-editor-workspace-external", result.status);
            this.chrome.setDebugAttribute(
                "data-fairy-editor-workspace-external-conflicts",
                String(result.conflictCount || 0),
            );
            this.chrome.setStatus(
                result.message || (result.ok ? "No external changes detected." : "External changes detected."),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.chrome.setStatus(`External-change check failed: ${message}`, "error");
        }
    }

    private async importWorkspaceNow(
        picked: BrowserProjectImportResult,
        label: string,
        workspaceId: string,
    ): Promise<boolean> {
        if (this.registry.activeId !== workspaceId) {
            this.chrome.setDebugAttribute("data-fairy-editor-workspace-import", "cancelled-workspace-changed");
            this.chrome.setStatus("Workspace import cancelled because the active workspace changed.", "warning");
            return false;
        }
        if (!this.guardTransition("import", "data-fairy-editor-workspace-import")) return false;
        this.chrome.setStatus(picked.imported.onDemand ? "正在打开目录，按需读取工程文件…" : `Project ${label} import started.`);
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        this.invalidateRuntime();
        try {
            const result = await this.session.workspaceLifecycle.importWorkspace(picked);
            recordWorkspaceLifecycleDebug(this.chrome, result);
            const sessionChanged = !identity
                || !this.session.liveSessionBridge.isSessionIdentityCurrent(identity);
            if (!result.ok) {
                const rollbackFailed = result.diagnostics.some((diagnostic) => (
                    diagnostic.code === "BROWSER_WORKSPACE_ROLLBACK_FAILED"
                ));
                if (rollbackFailed) {
                    return this.quarantineImportedWorkspaceNow(
                        workspaceId,
                        `Project ${label} import failed: ${getWorkspaceLifecycleFailure(result)}.`,
                    );
                }
                if (sessionChanged) {
                    await this.reconcileImportNow();
                } else {
                    this.document.refreshPreview();
                }
                this.chrome.setStatus(`Project ${label} import failed: ${getWorkspaceLifecycleFailure(result)}.`);
                return false;
            }
            this.session.clearSnapshot();
            this.document.reset();
            let connected = false;
            try {
                connected = await this.connectNow();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return this.quarantineImportedWorkspaceNow(
                    workspaceId,
                    `Project ${label} imported, but live session validation failed: ${message}`,
                );
            }
            if (!connected) {
                return this.quarantineImportedWorkspaceNow(
                    workspaceId,
                    `Project ${label} imported, but the browser live session did not reconnect.`,
                );
            }
            try {
                await this.session.workspaceLifecycle.clearActiveWorkspaceQuarantine();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return this.quarantineImportedWorkspaceNow(
                    workspaceId,
                    `Project ${label} was validated, but its quarantine marker could not be cleared: ${message}`,
                );
            }
            this.chrome.setDebugAttribute("data-fairy-editor-workspace-quarantined", "");
            const binding = result.storage.directoryWriteback;
            this.chrome.setStatus(
                picked.directoryHandle && binding?.status !== "ready"
                    ? `项目已打开；目录写回不可用：${binding?.message || "请重新授权目录。"}`
                    : result.storage.onDemand ? "项目已打开；文件按需读取，保存写回授权目录。" : `Project ${label} imported: files ${result.storage.fileCount}.`,
                picked.directoryHandle && binding?.status !== "ready" ? "warning" : "info",
            );
            return true;
        } catch (error) {
            if (!identity || !this.session.liveSessionBridge.isSessionIdentityCurrent(identity)) {
                await this.reconcileImportNow();
            } else {
                this.document.refreshPreview();
            }
            const message = error instanceof Error ? error.message : String(error);
            this.chrome.setStatus(`Project ${label} import failed: ${message}`, "error");
            console.error(`[Workspace] project ${label} import failed`, error);
            return false;
        }
    }

    private async reconcileImportNow(): Promise<void> {
        this.session.clearSnapshot();
        this.document.reset();
        await this.initializeNow(false, true);
    }

    private async quarantineImportedWorkspaceNow(workspaceId: string, reason: string): Promise<false> {
        let reportedReason = reason;
        try {
            await this.session.workspaceLifecycle.quarantineActiveWorkspace(reason);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            reportedReason += ` Quarantine persistence failed: ${message} Do not reload this page.`;
        }
        return this.failClosedWorkspaceNow(workspaceId, reportedReason, true);
    }

    private async failClosedWorkspaceNow(
        workspaceId: string,
        reason: string,
        runtimeInvalidated: boolean,
    ): Promise<false> {
        if (!runtimeInvalidated) this.invalidateRuntime();
        try {
            await this.session.workspaceLifecycle.closeWorkspace();
        } catch (error) {
            console.error("[Workspace] quarantined live session reset failed", error);
        }
        this.session.clearSnapshot();
        this.document.reset();
        this.recordSessionState(this.session.liveSessionBridge.getState());
        this.host?.showStartScene();
        this.chrome.setDebugAttribute("data-fairy-editor-workspace-quarantined", workspaceId);
        this.chrome.setStatus(reason, "error");
        return false;
    }

    private async connectNow(): Promise<boolean> {
        const { state, synchronized } = await this.session.connectNow();
        this.recordSessionState(state);
        if (state.status === "connected") {
            if (!synchronized) {
                const message = "Browser live session connected without a synchronized project snapshot.";
                this.chrome.setDebugAttribute("data-fairy-editor-session-error", "snapshot_sync_missing");
                this.chrome.setStatus(message, "error");
                console.warn(`[Editor Session] ${message}`);
                return false;
            }
            this.chrome.setStatus("Editor session connected.");
            return true;
        }
        this.chrome.setStatus(
            `Editor session ${state.status}: ${state.error || "unavailable"}`,
            state.status === "failed" ? "error" : "warning",
        );
        if (state.status === "failed") console.warn("[Editor Session] browser live session bridge failed", state);
        return false;
    }

    private createSaveTarget(): BrowserSaveTarget | undefined {
        const lastOperation = this.session.lastResult?.operation;
        if (lastOperation && lastOperation.kind !== "setDisplayNodeProps") {
            return this.session.liveSessionBridge.getLastSaveTarget() || undefined;
        }
        const selector = this.document.getSelectedNodeSelector();
        if (!selector) return undefined;
        return createDisplayNodeSaveTarget(
            this.session.liveSessionBridge.getWorkingProject(),
            selector,
        ) || undefined;
    }

    private guardTransition(action: string, debugAttribute: string): boolean {
        if (!this.session.commandAdapter.getSessionState().dirty) return true;
        this.chrome.setDebugAttribute(debugAttribute, "blocked-dirty");
        this.chrome.setDebugAttribute("data-fairy-editor-workspace-transition", `${action}:blocked-dirty`);
        this.chrome.setStatus(`Workspace ${action} blocked: Save or Undo the active workspace first.`);
        return false;
    }

    private recordSessionState(state: Awaited<ReturnType<EditorProjectSession["connectNow"]>>["state"]): void {
        this.chrome.setDebugAttribute("data-fairy-editor-session-status", state.status);
        this.chrome.setDebugAttribute("data-fairy-editor-session-source", state.projectSource);
        this.chrome.setDebugAttribute("data-fairy-editor-session-backend", state.backendPackageVersion || "");
        this.chrome.setDebugAttribute("data-fairy-editor-session-model-fidelity", state.uamFidelity || "");
        this.chrome.setDebugAttribute("data-fairy-editor-session-lock-held", String(state.lockHeld ?? false));
        this.chrome.setDebugAttribute("data-fairy-editor-session-error", state.error || "");
    }

    private recordSaveResult(result: BrowserSaveResult): void {
        this.chrome.setDebugAttribute("data-fairy-editor-workspace-save-ok", result.ok ? "true" : "false");
        this.chrome.setDebugAttribute("data-fairy-editor-workspace-writeback", result.writeback?.status || "");
        this.chrome.setDebugAttribute(
            "data-fairy-editor-workspace-writeback-conflicts",
            result.writeback?.conflictCount === undefined ? "" : String(result.writeback.conflictCount),
        );
    }

    private track<T>(promise: Promise<T>): Promise<T> {
        this.inFlight.add(promise);
        void promise.then(
            () => this.inFlight.delete(promise),
            () => this.inFlight.delete(promise),
        );
        return promise;
    }
}

export function createWorkspaceLifecycleModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: WORKSPACE_LIFECYCLE_SERVICE,
        hotReloadable: false,
        activate(context) {
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const lifecycle = new EditorWorkspaceLifecycle(
                chrome,
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
                context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE),
            );
            context.onDeactivate(() => lifecycle.dispose());
            context.provideService(WORKSPACE_LIFECYCLE_SERVICE, lifecycle);
            context.onDeactivate(chrome.registerActions(["toolbar:save", "save"], () => {
                void lifecycle.save();
            }));
        },
    };
}
