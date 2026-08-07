import { showResourceHealthDialog } from "../dialogs/ResourceHealthDialog";
import type { EditorModule } from "../workbench/EditorWorkbench";
import {
    EDITOR_SHELL_MODULE_HOST_SERVICE,
    type EditorShellModuleHost,
    type FairyGuiEditorWorkbenchHost,
} from "../workbench/EditorShellModuleHost";

export const RESOURCE_HEALTH_MODULE_ID = "fairygui.resource-health";

export function createResourceHealthModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: RESOURCE_HEALTH_MODULE_ID,
        activate(context) {
            const shell = context.requireService<EditorShellModuleHost>(EDITOR_SHELL_MODULE_HOST_SERVICE);
            context.onDeactivate(shell.registerToolMenuContribution({
                id: RESOURCE_HEALTH_MODULE_ID,
                itemName: "desktopMenuResourceHealth",
                title: "资源健康…",
                isEnabled: () => shell.isLiveSession(),
                run: () => showResourceHealthDialog(shell.createResourceHealthDialogContext()),
            }));
            context.onDeactivate(() => {
                const dialogContext = shell.createResourceHealthDialogContext();
                const dialog = dialogContext.getActiveDialog();
                if (dialog?.name !== "desktopResourceHealthDialog") return;
                dialog.dispose();
                if (dialogContext.getActiveDialog() === dialog) dialogContext.setActiveDialog(null);
            });
        },
    };
}
