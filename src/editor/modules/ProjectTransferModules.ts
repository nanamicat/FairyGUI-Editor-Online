import type { BrowserWorkspaceLifecycleResult } from "../model/BrowserWorkspace";
import { ProjectImportDialog } from "../dialogs/ProjectImportDialog";
import { showPublishSettingsEditor } from "../dialogs/PublishSettingsEditor";
import {
    EDITOR_PREFERENCES_STORAGE_KEY,
    parseEditorPreferences,
} from "../runtime/EditorPreferences";
import { getBrowserSaveFailure } from "../ui/InspectorPresentation";
import { getWorkspaceLifecycleFailure } from "../ui/InspectorPresentation";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";

export function downloadBrowserFile(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    try {
        anchor.click();
    } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}

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
            const session = context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE);
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const document = context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE);
            let inFlight: Promise<boolean> = Promise.resolve(false);
            const showWorkspace = (): void => {
                chrome.mainView.getController("start").selectedIndex = 0;
                chrome.startScene.visible = false;
                chrome.requestLayout();
            };
            const recordSessionState = (state: Awaited<ReturnType<EditorProjectSession["connectNow"]>>["state"]): void => {
                chrome.setDebugAttribute("data-fairy-editor-session-status", state.status);
                chrome.setDebugAttribute("data-fairy-editor-session-source", state.projectSource);
                chrome.setDebugAttribute("data-fairy-editor-session-backend", state.backendPackageVersion || "");
                chrome.setDebugAttribute("data-fairy-editor-session-model-fidelity", state.uamFidelity || "");
                chrome.setDebugAttribute("data-fairy-editor-session-lock-held", String(state.lockHeld ?? false));
                chrome.setDebugAttribute("data-fairy-editor-session-error", state.error || "");
            };
            const dialog = new ProjectImportDialog(chrome.mainView, {
                applyImport: (picked, label) => {
                    inFlight = session.runExclusive(async () => {
                        if (session.commandAdapter.getSessionState().dirty) {
                            chrome.setDebugAttribute("data-fairy-editor-workspace-import", "blocked-dirty");
                            chrome.setDebugAttribute("data-fairy-editor-workspace-transition", "import:blocked-dirty");
                            chrome.setStatus("Workspace import blocked: Save or Undo the active workspace first.");
                            return false;
                        }
                        chrome.setStatus(`Project ${label} import started.`);
                        const result = await session.workspaceLifecycle.importWorkspace(picked);
                        recordWorkspaceLifecycleDebug(chrome, result);
                        if (!result.ok) {
                            chrome.setStatus(`Project ${label} import failed: ${getWorkspaceLifecycleFailure(result)}.`);
                            return false;
                        }
                        document.resetRuntimePackages();
                        const connected = await session.connectNow();
                        recordSessionState(connected.state);
                        if (!connected.synchronized) {
                            chrome.setStatus(`Project ${label} imported, but the browser live session did not reconnect.`, "error");
                            return false;
                        }
                        chrome.setStatus(`Project ${label} imported: files ${result.storage.fileCount}.`);
                        return true;
                    });
                    return inFlight;
                },
                onError: (label, error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    chrome.setStatus(`Project ${label} import failed: ${message}`, "error");
                    console.error(`[Workspace] project ${label} import failed`, error);
                },
                pickDirectory: () => session.workspaceLifecycle.pickDirectoryProject(),
                pickZip: () => session.workspaceLifecycle.pickZipProject(),
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
            let activeDialog: fgui.Window | null = null;
            let inFlight: Promise<void> = Promise.resolve();

            const publish = (mode: "current" | "modified" | "all" = "modified"): Promise<void> => {
                inFlight = session.runExclusive(async () => {
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
                            ? [document.activeDocument.getPackage(snapshot)?.id || ""].filter(Boolean)
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
                        chrome.runAction("toolbar:stopTest");
                        document.resetRuntimePackages();
                        document.refreshPreview();
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
                });
                return inFlight;
            };

            const unregisterPublish = chrome.registerActions(["toolbar:publish", "menu:publish", "publish"], () => {
                const preferences = parseEditorPreferences(localStorage.getItem(EDITOR_PREFERENCES_STORAGE_KEY));
                publish(preferences.publishAction);
            });
            const unregisterSettings = chrome.registerActions(["toolbar:publishSettings"], () => {
                showPublishSettingsEditor({
                    getWorkingProject: () => session.liveSessionBridge.getWorkingProject(),
                    getActiveDialog: () => activeDialog,
                    setActiveDialog: (dialog) => { activeDialog = dialog; },
                    applyPreparation: (preparation) => session.runExclusive(async () => {
                        const outcome = await session.applyPreparationNow(
                            preparation,
                            session.liveSessionBridge.captureSessionIdentity(),
                        );
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
                    }),
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
                unregisterPublish();
                unregisterSettings();
                publishButton.visible = false;
                settingsButton.visible = false;
                activeDialog?.dispose();
                activeDialog = null;
                await inFlight;
            };
        },
    };
}
