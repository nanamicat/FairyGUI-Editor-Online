import type { BrowserWorkspaceLifecycleResult } from "../model/BrowserWorkspace";
import { getWorkspaceLifecycleFailure } from "../ui/InspectorPresentation";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

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
