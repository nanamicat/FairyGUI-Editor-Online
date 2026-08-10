import { prepareImportPackage } from "../commands/PackageComponentTransactions";
import type { HighRiskTransactionPreparation } from "../commands/HighRiskAuthoringTransactions";
import { ProjectImportDialog } from "../dialogs/ProjectImportDialog";
import { showPublishSettingsEditor } from "../dialogs/PublishSettingsEditor";
import {
    EDITOR_PREFERENCES_STORAGE_KEY,
    parseEditorPreferences,
} from "../runtime/EditorPreferences";
import { getBrowserSaveFailure } from "../ui/InspectorPresentation";
import { getWorkspaceLifecycleFailure } from "../ui/InspectorPresentation";
import { downloadBrowserFile } from "../services/BrowserDownload";
import { pickBrowserFile, readZipProjectFiles } from "../services/BrowserProjectImport";
import type { BrowserLiveSessionIdentity } from "../services/BrowserLiveSessionBridge";
import {
    exportFairyPackage,
    exportFairyPackageResources,
    inspectFairyPackageResourceImport,
    prepareImportFairyPackageResources,
    readFairyPackageFiles,
} from "../services/FairyPackageTransfer";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { AUTHORING_DIALOGS_SERVICE, EditorAuthoringDialogs } from "./AuthoringDialogsModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";
import { EditorProjectExplorer, PROJECT_EXPLORER_SERVICE } from "./ProjectExplorerModule";
import { EditorResourceAuthoring, RESOURCE_AUTHORING_SERVICE } from "./ResourceAuthoringModule";
import {
    EditorWorkspaceLifecycle,
    recordWorkspaceLifecycleDebug,
    WORKSPACE_LIFECYCLE_SERVICE,
} from "./WorkspaceLifecycleModule";

class FairyPackageImport {
    private pending: Promise<void> = Promise.resolve();
    private disposed = false;

    constructor(
        private readonly chrome: EditorShellChrome,
        private readonly session: EditorProjectSession,
        private readonly document: EditorDocumentAuthoring,
        private readonly explorer: EditorProjectExplorer,
        private readonly dialogs: EditorAuthoringDialogs,
        private readonly resourceAuthoring: EditorResourceAuthoring,
    ) {}

    importPackage(retryFile?: File): Promise<void> {
        return this.enqueue(() => this.importPackageNow(retryFile));
    }

    importResources(retryFile?: File): Promise<void> {
        return this.enqueue(() => this.importResourcesNow(retryFile));
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        this.clearRetries();
        await this.pending;
        this.clearRetries();
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        if (this.disposed) return Promise.resolve();
        const result = this.pending.then(task, task);
        this.pending = result.catch(() => undefined);
        return result;
    }

    private async applyPreparation(
        preparation: HighRiskTransactionPreparation,
        identity: BrowserLiveSessionIdentity | null,
    ): Promise<boolean> {
        try {
            const outcome = await this.session.runExclusive(() => (
                this.session.applyPreparationNow(preparation, identity)
            ));
            if (outcome.kind === "unavailable") {
                this.chrome.setStatus(`Operation unavailable: ${outcome.preparation.code}. ${outcome.preparation.message}`);
                return false;
            }
            if (outcome.kind === "stale") {
                this.chrome.setStatus("Operation cancelled because the project changed while it was queued. Retry the action.", "warning");
                return false;
            }
            if (!outcome.result.ok) {
                this.chrome.setStatus(`Operation failed: ${outcome.result.error?.code || "unknown_error"}.`, "error");
                return false;
            }
            this.chrome.setStatus(outcome.summary);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.chrome.setStatus(`Operation failed: ${message}`, "error");
            console.error("[Editor Transaction] FairyGUI package transfer failed", error);
            return false;
        }
    }

    private ensureCurrent(identity: BrowserLiveSessionIdentity, label: string): boolean {
        if (this.session.liveSessionBridge.isSessionIdentityCurrent(identity)) return true;
        this.chrome.setDebugAttribute("data-fairy-editor-package-interaction", `cancelled:${label}:session-changed`);
        this.chrome.setStatus(`FairyGUI ${label} cancelled because the live session changed.`);
        return false;
    }

    private async importPackageNow(retryFile?: File): Promise<void> {
        const bridge = this.session.liveSessionBridge;
        const interactionIdentity = bridge.captureSessionIdentity();
        const backend = bridge.getFairyPackageBackend();
        const project = bridge.getWorkingProject();
        if (!interactionIdentity || !backend || !project) {
            this.chrome.setStatus("FairyGUI package import requires a connected live session.", "error");
            return;
        }
        let file = retryFile;
        try {
            file ||= await pickBrowserFile(
                ".fairypackage,.zip,application/zip,application/x-zip-compressed",
                "FairyGUI package import was cancelled.",
                "fairy-package",
            );
            if (!this.ensureCurrent(interactionIdentity, "package import")) return;
            const archiveFiles = await readZipProjectFiles(file);
            if (!this.ensureCurrent(interactionIdentity, "package import")) return;
            const imported = await readFairyPackageFiles(backend, archiveFiles);
            if (!this.ensureCurrent(interactionIdentity, "package import")) return;
            const importedName = file.name.replace(/\.[^.]+$/, "")
                || String((imported as { name?: unknown }).name || "Imported");
            const packageName = await this.dialogs.controller.requestTextInput(
                "desktopImportFairyPackageDialog",
                "Import FairyGUI package",
                "New package name",
                importedName,
                "Import",
            );
            if (!this.ensureCurrent(interactionIdentity, "package import") || packageName === null) return;
            const currentProject = bridge.getWorkingProject();
            if (!currentProject) return;
            const preparation = prepareImportPackage(currentProject, imported, packageName);
            if (!await this.applyPreparation(preparation, interactionIdentity) || !preparation.ok) {
                this.resourceAuthoring.controller.recordImport(
                    "fairyPackage",
                    [file],
                    "",
                    "Import transaction was rejected.",
                    () => this.importPackage(file),
                );
                return;
            }
            const operation = preparation.transaction.operation;
            if (operation.kind !== "addPackage") return;
            const importedPackage = operation.package as { id: string; name?: string };
            this.resourceAuthoring.selectLibraryPackage(importedPackage.id);
            this.chrome.setDebugAttribute("data-fairy-editor-package-import", importedPackage.id);
            this.chrome.setStatus(`FairyGUI package imported: ${importedPackage.name || importedPackage.id}.`);
            this.resourceAuthoring.controller.recordImport("fairyPackage", [file], importedPackage.id);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.chrome.setDebugAttribute("data-fairy-editor-package-import", `error:${message}`);
            this.chrome.setStatus(`FairyGUI package import failed: ${message}`, "error");
            if (file) {
                this.resourceAuthoring.controller.recordImport(
                    "fairyPackage",
                    [file],
                    "",
                    message,
                    () => this.importPackage(file),
                );
            }
        }
    }

    private async importResourcesNow(retryFile?: File): Promise<void> {
        const bridge = this.session.liveSessionBridge;
        const interactionIdentity = bridge.captureSessionIdentity();
        const backend = bridge.getFairyPackageBackend();
        const project = bridge.getWorkingProject() as {
            packages?: Array<{ id?: string; name?: string }>;
        } | null;
        if (!interactionIdentity || !backend || !project?.packages?.length) {
            this.chrome.setStatus("FairyGUI resource import requires a connected live session.", "error");
            return;
        }
        let file = retryFile;
        try {
            file ||= await pickBrowserFile(
                ".fairypackage,.zip,application/zip,application/x-zip-compressed",
                "FairyGUI resource import was cancelled.",
                "fairy-package-resources",
            );
            if (!this.ensureCurrent(interactionIdentity, "resource import")) return;
            const archiveFiles = await readZipProjectFiles(file);
            if (!this.ensureCurrent(interactionIdentity, "resource import")) return;
            const imported = await readFairyPackageFiles(backend, archiveFiles);
            if (!this.ensureCurrent(interactionIdentity, "resource import")) return;
            const initialPackageId = this.explorer.library.packageId
                || this.document.packageId
                || String(project.packages[0]?.id || "");
            const targetPackageValue = await this.dialogs.controller.requestTextInput(
                "desktopImportFairyPackageResourcesTargetDialog",
                "Import resources",
                "Target existing package ID or name",
                initialPackageId,
                "Next",
            );
            if (!this.ensureCurrent(interactionIdentity, "resource import") || targetPackageValue === null) return;
            let currentProject = bridge.getWorkingProject() as typeof project;
            if (!currentProject?.packages?.length) return;
            let targetPackage = currentProject.packages.find((pkg) => (
                pkg.id === targetPackageValue.trim() || pkg.name === targetPackageValue.trim()
            ));
            if (!targetPackage?.id) {
                this.chrome.setStatus(
                    `FairyGUI resource import failed: target package ${targetPackageValue.trim() || "(empty)"} was not found.`,
                    "error",
                );
                return;
            }
            const librarySelection = this.explorer.library.getInspectorSelection();
            const selectedFolder = librarySelection?.kind === "folder" && librarySelection.packageId === targetPackage.id
                ? librarySelection
                : null;
            const targetPath = await this.dialogs.controller.requestTextInput(
                "desktopImportFairyPackageResourcesFolderDialog",
                `Import resources into ${targetPackage.name || targetPackage.id}`,
                "Target existing folder path",
                selectedFolder?.path || "/",
                "Inspect conflicts",
            );
            if (!this.ensureCurrent(interactionIdentity, "resource import") || targetPath === null) return;
            const targetBranch = selectedFolder?.branch || "";
            currentProject = bridge.getWorkingProject() as typeof project;
            if (!currentProject?.packages?.length) return;
            targetPackage = currentProject.packages.find((pkg) => pkg.id === targetPackage?.id);
            if (!targetPackage?.id) {
                this.chrome.setStatus("FairyGUI resource import cancelled because the target package changed.");
                return;
            }
            let inspection = inspectFairyPackageResourceImport(currentProject, imported, {
                targetPackageId: targetPackage.id,
                targetPath,
                targetBranch,
            });
            const conflictPreview = inspection.conflicts.slice(0, 4).map((conflict) => (
                `${conflict.targetPath}${conflict.fileName} (${conflict.incomingKind} -> ${conflict.targetKind})`
            )).join("; ");
            const conflictStrategy = inspection.conflicts.length > 0
                ? await this.dialogs.controller.requestPasteConflictStrategy(
                    `Conflicts: ${inspection.conflicts.length}/${inspection.resourceCount}`
                    + `${conflictPreview ? `. ${conflictPreview}${inspection.conflicts.length > 4 ? "; ..." : ""}` : "."}`,
                )
                : "rename";
            if (!this.ensureCurrent(interactionIdentity, "resource import") || conflictStrategy === null) return;
            currentProject = bridge.getWorkingProject() as typeof project;
            if (!currentProject?.packages?.length) return;
            targetPackage = currentProject.packages.find((pkg) => pkg.id === targetPackage?.id);
            if (!targetPackage?.id) {
                this.chrome.setStatus("FairyGUI resource import cancelled because the target package changed.");
                return;
            }
            inspection = inspectFairyPackageResourceImport(currentProject, imported, {
                targetPackageId: targetPackage.id,
                targetPath,
                targetBranch,
            });
            const preparation = prepareImportFairyPackageResources(currentProject, imported, {
                targetPackageId: targetPackage.id,
                targetPath,
                targetBranch,
                conflictStrategy,
            });
            if (!await this.applyPreparation(preparation, interactionIdentity) || !preparation.ok) {
                this.resourceAuthoring.controller.recordImport(
                    "fairyPackageResources",
                    [file],
                    targetPackage.id,
                    "Import transaction was rejected.",
                    () => this.importResources(file),
                );
                return;
            }
            this.resourceAuthoring.selectLibraryPackage(targetPackage.id);
            this.chrome.setDebugAttribute(
                "data-fairy-editor-package-resource-import",
                `${targetPackage.id}:${preparation.counts.added}:${preparation.counts.replaced}:${preparation.counts.skipped}:${conflictStrategy}`,
            );
            this.chrome.setStatus(
                `FairyGUI resources imported into ${targetPackage.name || targetPackage.id}${inspection.targetPath}: `
                    + `${preparation.counts.added} added, ${preparation.counts.replaced} replaced, ${preparation.counts.skipped} skipped.`,
            );
            this.resourceAuthoring.controller.recordImport("fairyPackageResources", [file], targetPackage.id);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.chrome.setDebugAttribute("data-fairy-editor-package-resource-import", `error:${message}`);
            this.chrome.setStatus(`FairyGUI resource import failed: ${message}`, "error");
            if (file) {
                this.resourceAuthoring.controller.recordImport(
                    "fairyPackageResources",
                    [file],
                    this.explorer.library.packageId,
                    message,
                    () => this.importResources(file),
                );
            }
        }
    }

    private clearRetries(): void {
        this.resourceAuthoring.controller.clearImportRetries("fairyPackage", "fairyPackageResources");
    }
}

class FairyPackageExport {
    private pending: Promise<void> = Promise.resolve();
    private active = true;

    constructor(
        private readonly chrome: EditorShellChrome,
        private readonly session: EditorProjectSession,
        private readonly document: EditorDocumentAuthoring,
        private readonly explorer: EditorProjectExplorer,
        private readonly resourceAuthoring: EditorResourceAuthoring,
    ) {}

    exportPackage(): Promise<void> {
        return this.enqueue(async () => {
            const bridge = this.session.liveSessionBridge;
            const backend = bridge.getFairyPackageBackend();
            const project = bridge.getWorkingProject();
            const packageId = this.explorer.library.packageId || this.document.packageId;
            if (!backend || !project || !packageId) {
                this.chrome.setStatus("FairyGUI package export requires a selected package and connected live session.", "error");
                return;
            }
            try {
                const exported = await exportFairyPackage(backend, project, packageId);
                if (!this.active) return;
                downloadBrowserFile(exported.blob, exported.fileName);
                this.chrome.setDebugAttribute("data-fairy-editor-package-export", `${exported.packageId}:${exported.files.length}`);
                this.chrome.setStatus(`FairyGUI package exported: ${exported.fileName} (${exported.files.length} files).`);
            } catch (error) {
                if (!this.active) return;
                const message = error instanceof Error ? error.message : String(error);
                this.chrome.setDebugAttribute("data-fairy-editor-package-export", `error:${message}`);
                this.chrome.setStatus(`FairyGUI package export failed: ${message}`, "error");
            }
        });
    }

    exportResources(): Promise<void> {
        return this.enqueue(async () => {
            const bridge = this.session.liveSessionBridge;
            const backend = bridge.getFairyPackageBackend();
            const project = bridge.getWorkingProject();
            const selectors = this.resourceAuthoring.getSelectedLibraryResourceSelectors();
            if (!backend || !project || selectors.length === 0) {
                this.chrome.setStatus("FairyGUI resource export requires selected resources and a connected live session.", "error");
                return;
            }
            try {
                const exported = await exportFairyPackageResources(backend, project, selectors);
                if (!this.active) return;
                downloadBrowserFile(exported.blob, exported.fileName);
                this.chrome.setDebugAttribute(
                    "data-fairy-editor-resource-subset-export",
                    `${exported.packageId}:${selectors.length}:${exported.files.length}`,
                );
                this.chrome.setStatus(
                    `Exported ${selectors.length} selected resource${selectors.length === 1 ? "" : "s"} with dependencies: `
                        + `${exported.fileName} (${exported.files.length} files).`,
                );
            } catch (error) {
                if (!this.active) return;
                const message = error instanceof Error ? error.message : String(error);
                this.chrome.setDebugAttribute("data-fairy-editor-resource-subset-export", `error:${message}`);
                this.chrome.setStatus(`FairyGUI selected-resource export failed: ${message}`, "error");
            }
        });
    }

    async dispose(): Promise<void> {
        this.active = false;
        await this.pending;
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        if (!this.active) return Promise.resolve();
        const result = this.pending.then(task, task);
        this.pending = result.catch(() => undefined);
        return result;
    }
}

export function createFairyPackageImportModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.fairy-package-import",
        hotReloadable: false,
        activate(context) {
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const transfer = new FairyPackageImport(
                chrome,
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
                context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE),
                context.requireService<EditorProjectExplorer>(PROJECT_EXPLORER_SERVICE),
                context.requireService<EditorAuthoringDialogs>(AUTHORING_DIALOGS_SERVICE),
                context.requireService<EditorResourceAuthoring>(RESOURCE_AUTHORING_SERVICE),
            );
            context.onDeactivate(() => transfer.dispose());
            context.onDeactivate(chrome.registerActions(
                ["resource:importFairyPackage"],
                () => { void transfer.importPackage(); },
            ));
            context.onDeactivate(chrome.registerActions(
                ["resource:importFairyPackageResources"],
                () => { void transfer.importResources(); },
            ));
        },
    };
}

export function createFairyPackageExportModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.fairy-package-export",
        activate(context) {
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const transfer = new FairyPackageExport(
                chrome,
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
                context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE),
                context.requireService<EditorProjectExplorer>(PROJECT_EXPLORER_SERVICE),
                context.requireService<EditorResourceAuthoring>(RESOURCE_AUTHORING_SERVICE),
            );
            context.onDeactivate(() => transfer.dispose());
            context.onDeactivate(chrome.registerActions(
                ["resource:exportFairyPackage"],
                () => { void transfer.exportPackage(); },
            ));
            context.onDeactivate(chrome.registerActions(
                ["resource:exportFairyPackageResources"],
                () => { void transfer.exportResources(); },
            ));
        },
    };
}

export function createWorkspaceExportModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.workspace-export",
        activate(context) {
            const session = context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE);
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const toolbarButton = chrome.toolbar.getChild("tbSaveAll");
            toolbarButton.visible = true;
            let inFlight: Promise<unknown> = Promise.resolve();
            const unregister = chrome.registerActions(["toolbar:exportWorkspace"], () => {
                inFlight = session.runExclusive(async () => {
                    chrome.setStatus("Browser workspace export started.");
                    try {
                        const result = await session.workspaceLifecycle.exportWorkspaceZip();
                        if (result.ok && result.export?.blob) {
                            downloadBrowserFile(result.export.blob, result.export.fileName);
                        }
                        recordWorkspaceLifecycleDebug(chrome, result);
                        chrome.setStatus(
                            result.ok
                                ? `Browser workspace exported: ${result.export?.fileName || "ZIP"}.`
                                : `Browser workspace export failed: ${getWorkspaceLifecycleFailure(result)}.`,
                        );
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        chrome.setStatus(`Browser workspace export failed: ${message}`, "error");
                        console.error("[Workspace] export failed", error);
                    }
                });
            });
            return async () => {
                unregister();
                toolbarButton.visible = false;
                await inFlight;
            };
        },
    };
}

export function createWorkspaceImportModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.workspace-import",
        activate(context) {
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const workspace = context.requireService<EditorWorkspaceLifecycle>(WORKSPACE_LIFECYCLE_SERVICE);
            let inFlight: Promise<boolean> = Promise.resolve(false);
            const showWorkspace = (): void => {
                chrome.mainView.getController("start").selectedIndex = 0;
                chrome.startScene.visible = false;
                chrome.requestLayout();
            };
            const dialog = new ProjectImportDialog(chrome.mainView, {
                applyImport: (picked, label) => {
                    inFlight = workspace.importWorkspace(picked, label);
                    return inFlight;
                },
                onError: (label, error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    chrome.setStatus(`Project ${label} import failed: ${message}`, "error");
                    console.error(`[Workspace] project ${label} import failed`, error);
                },
                pickDirectory: () => workspace.pickDirectoryProject(),
                pickZip: () => workspace.pickZipProject(),
                setDebugAttribute: (name, value) => chrome.setDebugAttribute(name, value),
                setStatus: (message) => chrome.setStatus(message),
                showWorkspace,
            });
            const unregisterActions = chrome.registerActions([
                "toolbar:importProjectDirectory",
                "workspace:importProject",
            ], () => dialog.show());
            const unregisterDirectory = chrome.registerActions(["workspace:importProjectDirectory"], () => dialog.pickDirectory());
            const unregisterZip = chrome.registerActions(["workspace:importProjectZip"], () => dialog.pickZip());
            const unregisterLayout = chrome.registerLayoutParticipant(() => dialog.layout());
            const toolbarButton = chrome.toolbar.getChild("tbImport");
            toolbarButton.visible = true;
            return async () => {
                unregisterActions();
                unregisterDirectory();
                unregisterZip();
                unregisterLayout();
                toolbarButton.visible = false;
                await inFlight;
                dialog.close();
            };
        },
    };
}

export function createRuntimePublishModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.runtime-publish",
        activate(context) {
            const session = context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE);
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const document = context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE);
            const workspace = context.requireService<EditorWorkspaceLifecycle>(WORKSPACE_LIFECYCLE_SERVICE);
            let activeDialog: fgui.Window | null = null;
            const inFlight = new Set<Promise<unknown>>();
            let active = true;
            const track = <T>(promise: Promise<T>): Promise<T> => {
                inFlight.add(promise);
                void promise.then(
                    () => inFlight.delete(promise),
                    () => inFlight.delete(promise),
                );
                return promise;
            };

            const publish = (mode: "current" | "modified" | "all" = "modified"): Promise<void> => {
                if (!active) return Promise.resolve();
                const identity = session.liveSessionBridge.captureSessionIdentity();
                const requestedPackageId = document.activeDocument.getPackage(session.snapshot)?.id || "";
                return track(session.runExclusive(async () => {
                    if (!identity || !session.liveSessionBridge.isSessionIdentityCurrent(identity)) {
                        chrome.setStatus("Browser publish cancelled because the project changed while it was queued.", "warning");
                        return;
                    }
                    if (!session.commandAdapter.isLiveSessionAligned()) {
                        chrome.setStatus("Browser runtime publish blocked: reconnect the browser live session before publishing.", "error");
                        return;
                    }
                    const snapshot = session.snapshot;
                    if (!snapshot) {
                        chrome.setStatus("Browser publish unavailable: no authoring project is loaded.");
                        return;
                    }
                    const preferences = parseEditorPreferences(localStorage.getItem(EDITOR_PREFERENCES_STORAGE_KEY));
                    if (session.commandAdapter.getSessionState().dirty && preferences.saveBeforePublish) {
                        chrome.setStatus("发布前正在自动保存工作区...");
                        const saved = await session.saveWorkspaceNow();
                        if (saved.kind === "result" && !saved.result.ok) {
                            chrome.setStatus(`Browser workspace save failed: ${getBrowserSaveFailure(saved.result)}.`, "error");
                        }
                    }
                    if (session.commandAdapter.getSessionState().dirty) {
                        chrome.setStatus("Browser publish blocked: save changes first.");
                        return;
                    }
                    const packageIds = mode === "all"
                        ? snapshot.packages.map((pkg) => pkg.id)
                        : mode === "current"
                            ? [requestedPackageId].filter(Boolean)
                            : session.getModifiedPackageIds().length
                                ? session.getModifiedPackageIds()
                                : document.preview.requiresRuntimePublish()
                                    ? snapshot.packages.map((pkg) => pkg.id)
                                    : [];
                    if (!packageIds.length) {
                        chrome.setStatus("没有需要发布的已修改包。");
                        return;
                    }

                    const waitingDialog = new fgui.Window();
                    waitingDialog.modal = true;
                    waitingDialog.name = "publishWaitingDialog";
                    const waitingContent = fgui.UIPackage.createObject("Builder", "WaitingDialog").asCom;
                    waitingDialog.contentPane = waitingContent;
                    waitingContent.getChild("title").asTextField.text = "发布中...";
                    waitingContent.getChild("cancel").visible = false;
                    waitingDialog.show();
                    waitingDialog.centerOn(fgui.GRoot.inst, true);
                    chrome.setStatus("Publishing browser workspace runtime bundle...");
                    try {
                        const result = await session.liveSessionBridge.publishRuntimeBundle(snapshot, {
                            packageIds,
                            branch: chrome.toolbar.getChild("tbBranch").asComboBox.value,
                        });
                        if (!result.success) {
                            chrome.setStatus("Browser runtime publish failed.");
                            return;
                        }
                        if (!result.archive?.blob) throw new Error("Browser runtime ZIP export did not produce a download.");
                        downloadBrowserFile(result.archive.blob, result.archive.fileName);
                        workspace.invalidateRuntime(true);
                        session.markPackagesPublished(packageIds);
                        chrome.setDebugAttribute("data-fairy-editor-preview-projection", "refreshed");
                        chrome.setDebugAttribute("data-fairy-editor-preview-runtime-status", "current");
                        chrome.setDebugAttribute("data-fairy-editor-preview-projection-reason", "browser_publish");
                        chrome.setStatus(`Browser runtime publish complete: ${result.packageCount} package(s), ${result.fileCount} file(s); downloaded ${result.archive.fileName}.`);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        chrome.setStatus(`Browser runtime publish failed: ${message}`);
                        console.error("[Publish] browser runtime publish failed", error);
                    } finally {
                        waitingDialog.dispose();
                    }
                }));
            };

            const unregisterPublish = chrome.registerActions(["toolbar:publish", "menu:publish", "publish"], () => {
                const preferences = parseEditorPreferences(localStorage.getItem(EDITOR_PREFERENCES_STORAGE_KEY));
                publish(preferences.publishAction);
            });
            const unregisterSettings = chrome.registerActions(["toolbar:publishSettings"], () => {
                const identity = session.liveSessionBridge.captureSessionIdentity();
                showPublishSettingsEditor({
                    getWorkingProject: () => session.liveSessionBridge.getWorkingProject(),
                    getActiveDialog: () => activeDialog,
                    setActiveDialog: (dialog) => { activeDialog = dialog; },
                    applyPreparation: (preparation) => {
                        if (!active) return Promise.resolve(false);
                        return track(session.runExclusive(async () => {
                            try {
                                const outcome = await session.applyPreparationNow(preparation, identity);
                                if (outcome.kind === "unavailable") {
                                    chrome.setStatus(`Operation unavailable: ${outcome.preparation.code}. ${outcome.preparation.message}`);
                                    return false;
                                }
                                if (outcome.kind === "stale") {
                                    chrome.setStatus("Operation cancelled because the project changed while it was queued. Retry the action.", "warning");
                                    return false;
                                }
                                if (!outcome.result.ok) {
                                    chrome.setStatus(`Operation failed: ${outcome.result.error?.code || "unknown_error"}.`, "error");
                                    return false;
                                }
                                chrome.setStatus(outcome.summary);
                                return true;
                            } catch (error) {
                                const message = error instanceof Error ? error.message : String(error);
                                chrome.setStatus(`Publish settings update failed: ${message}`, "error");
                                console.error("[Publish] settings update failed", error);
                                return false;
                            }
                        }));
                    },
                    publish: (mode) => publish(mode),
                    setStatus: (message) => chrome.setStatus(message),
                    eventOwner: chrome,
                });
            });
            const publishButton = chrome.toolbar.getChild("tbPublish");
            const settingsButton = chrome.toolbar.getChild("tbPublishSettings");
            publishButton.visible = true;
            settingsButton.visible = true;
            return async () => {
                active = false;
                unregisterPublish();
                unregisterSettings();
                publishButton.visible = false;
                settingsButton.visible = false;
                activeDialog?.dispose();
                activeDialog = null;
                await Promise.allSettled([...inFlight]);
            };
        },
    };
}
