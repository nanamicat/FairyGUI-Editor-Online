export interface EditorToolMenuContribution {
    id: string;
    itemName: string;
    title: string;
    isEnabled?(): boolean;
    run(): void | Promise<void>;
}

export type EditorToolMenuProvider = () => EditorToolMenuContribution[];

export interface FairyGuiEditorWorkbenchHost {
    mainView: fgui.GComponent;
}
