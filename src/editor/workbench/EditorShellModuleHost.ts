import type { ResourceHealthDialogContext } from "../dialogs/ResourceHealthDialog";

export const EDITOR_SHELL_MODULE_HOST_SERVICE = "fairygui.editor-shell-host";

export interface EditorToolMenuContribution {
    id: string;
    itemName: string;
    title: string;
    isEnabled?(): boolean;
    run(): void | Promise<void>;
}

export interface EditorShellModuleHost {
    registerToolMenuContribution(contribution: EditorToolMenuContribution): () => void;
    isLiveSession(): boolean;
    createResourceHealthDialogContext(): ResourceHealthDialogContext;
}

export interface FairyGuiEditorWorkbenchHost {
    mainView: fgui.GComponent;
}
