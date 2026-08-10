import { showResourceHealthDialog } from "../dialogs/ResourceHealthDialog";
import { queryProjectResourceReferences } from "../commands/HighRiskAuthoringTransactions";
import type { EditorResourceSelector } from "../model/EditorCommand";
import type { ResourceHealthEntry, ResourceHealthIssue } from "../runtime/ResourceHealthAudit";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { AUTHORING_DIALOGS_SERVICE, EditorAuthoringDialogs } from "./AuthoringDialogsModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorResourceAuthoring, RESOURCE_AUTHORING_SERVICE } from "./ResourceAuthoringModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const RESOURCE_HEALTH_MODULE_ID = "fairygui.resource-health";

export function createResourceHealthModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: RESOURCE_HEALTH_MODULE_ID,
        activate(context) {
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const session = context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE);
            const dialogs = context.requireService<EditorAuthoringDialogs>(AUTHORING_DIALOGS_SERVICE);
            const resourceAuthoring = context.requireService<EditorResourceAuthoring>(RESOURCE_AUTHORING_SERVICE);
            const dialogContext = {
                getWorkingProject: () => session.liveSessionBridge.getWorkingProject(),
                getActiveDialog: () => dialogs.controller.getActiveDialog(),
                setActiveDialog: (dialog: fgui.Window | null) => dialogs.controller.setActiveDialog(dialog),
                countIncomingReferences: (selector: EditorResourceSelector) => (
                    queryProjectResourceReferences(
                        session.liveSessionBridge.getWorkingProject(),
                        selector,
                        "incoming",
                    ).reduce((count, reference) => count + reference.count, 0)
                ),
                locate: (entry: ResourceHealthEntry) => {
                    resourceAuthoring.selectLibraryResource(entry.packageId, entry.resourceId);
                    chrome.setDebugAttribute(
                        "data-fairy-editor-resource-health-selection",
                        `${entry.packageId}/${entry.resourceId}`,
                    );
                    chrome.setStatus(`已在资源库中定位 ${entry.packageName}/${entry.name}。`);
                },
                repair: (issue: ResourceHealthIssue, entries: ResourceHealthEntry[]) => (
                    resourceAuthoring.repairResourceHealthIssue(issue, entries)
                ),
                setDebugAttribute: (name: string, value: string) => chrome.setDebugAttribute(name, value),
                setStatus: (message: string) => chrome.setStatus(message),
                eventOwner: resourceAuthoring,
            };
            context.onDeactivate(chrome.registerToolMenuContribution({
                id: RESOURCE_HEALTH_MODULE_ID,
                itemName: "desktopMenuResourceHealth",
                title: "资源健康…",
                isEnabled: () => session.commandAdapter.getSessionState().liveSession,
                run: () => showResourceHealthDialog(dialogContext),
            }));
            context.onDeactivate(() => {
                const dialog = dialogContext.getActiveDialog();
                if (!dialog || !["desktopResourceHealthDialog", "resourceHealthRepairDialog"].includes(dialog.name)) return;
                dialog.dispose();
                if (dialogContext.getActiveDialog() === dialog) dialogContext.setActiveDialog(null);
            });
        },
    };
}
