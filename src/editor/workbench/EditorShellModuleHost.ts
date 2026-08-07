import type { ResourceHealthDialogContext } from "../dialogs/ResourceHealthDialog";
import type {
    EditorDisplayNodeSelector,
    SetDisplayNodePropsCommand,
} from "../model/EditorCommand";

export const EDITOR_SHELL_MODULE_HOST_SERVICE = "fairygui.editor-shell-host";

export interface EditorToolMenuContribution {
    id: string;
    itemName: string;
    title: string;
    isEnabled?(): boolean;
    run(): void | Promise<void>;
}

export type EditorToolMenuProvider = () => EditorToolMenuContribution[];

export interface BrowserPluginModuleContext {
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    requestTextInput(
        name: string,
        title: string,
        message: string,
        current: string,
        confirmLabel: string,
    ): Promise<string | null>;
    createInvocationContext(): unknown;
    getSelectedDisplayNodeSelector(): EditorDisplayNodeSelector | null;
    applyDisplayNodeCommands(commands: SetDisplayNodePropsCommand[], summary: string): Promise<boolean>;
    setDebugAttribute(name: string, value: string): void;
    setStatus(message: string): void;
    eventOwner: object;
}

export interface EditorShellModuleHost {
    registerToolMenuContribution(contribution: EditorToolMenuContribution): () => void;
    registerToolMenuProvider(provider: EditorToolMenuProvider): () => void;
    isLiveSession(): boolean;
    createResourceHealthDialogContext(): ResourceHealthDialogContext;
    createBrowserPluginModuleContext(): BrowserPluginModuleContext;
}

export interface FairyGuiEditorWorkbenchHost {
    mainView: fgui.GComponent;
}
