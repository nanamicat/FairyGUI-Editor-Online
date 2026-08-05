import {
    parseProjectResourceUrl,
    type PrimitiveDisplayNodeKind,
} from "../commands/HighRiskAuthoringTransactions";
import type { EditorResourceSelector } from "../model/EditorCommand";

const REPLACE_OBJECT_HISTORY_STORAGE_KEY = "fairygui-editor-online.replace-object-history.v1";

export type ReplaceObjectDialogContext = {
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    setStatus(message: string, kind?: "error"): void;
    setDebugAttribute(name: string, value: string): void;
    eventOwner: object;
};

export function showReplaceObjectDialog(
    context: ReplaceObjectDialogContext,
    project: unknown,
    initialTarget: string,
    selectedCount: number,
    onReplace: (target: PrimitiveDisplayNodeKind | EditorResourceSelector) => void,
): void {
    context.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopReplaceObjectDialog";
    const content = fgui.UIPackage.createObject("Builder", "ReplaceObjectDialog").asCom;
    dialog.contentPane = content;
    const input = content.getChild("target").asCom.getChild("title").asTextInput;
    input.text = initialTarget;
    const builtIns: Array<[string, PrimitiveDisplayNodeKind]> = [
        ["text", "text"],
        ["richtext", "richText"],
        ["inputtext", "textInput"],
        ["graph", "graph"],
        ["loader", "loader"],
        ["loader3D", "loader3D"],
    ];
    for (const [name, kind] of builtIns) {
        const button = content.getChild(name).asButton;
        button.tooltips = kind;
        button.onClick(context.eventOwner, () => { input.text = kind; });
    }

    let history: string[] = [];
    try {
        const stored = JSON.parse(localStorage.getItem(REPLACE_OBJECT_HISTORY_STORAGE_KEY) || "[]");
        if (Array.isArray(stored)) {
            history = stored.filter((value): value is string => typeof value === "string").slice(0, 5);
        }
    } catch {
        history = [];
    }
    const historyList = content.getChild("history").asList;
    historyList.removeChildrenToPool();
    for (const value of history) {
        const item = historyList.addItemFromPool().asButton;
        item.title = value;
        item.data = value;
    }
    historyList.on(fgui.Events.CLICK_ITEM, context.eventOwner, (item: fgui.GObject) => {
        input.text = String(item.data || item.asButton.title || "");
    });

    const close = (): void => {
        dialog.dispose();
        if (context.getActiveDialog() === dialog) context.setActiveDialog(null);
    };
    content.getChild("ok").asButton.onClick(context.eventOwner, () => {
        const value = input.text.trim();
        const primitive = builtIns.find(([, kind]) => kind === value)?.[1];
        const resource = primitive ? null : parseProjectResourceUrl(project, value);
        if (!primitive && !resource) {
            context.setStatus("Replace target must be a built-in object kind or an existing ui:// resource URL.", "error");
            return;
        }
        localStorage.setItem(
            REPLACE_OBJECT_HISTORY_STORAGE_KEY,
            JSON.stringify([value, ...history.filter((entry) => entry !== value)].slice(0, 5)),
        );
        close();
        onReplace(primitive || resource!);
    });
    content.getChild("cancel").asButton.onClick(context.eventOwner, () => {
        close();
        context.setStatus("Replace cancelled.");
    });
    dialog.on(Laya.Event.UNDISPLAY, context.eventOwner, () => {
        if (context.getActiveDialog() === dialog) context.setActiveDialog(null);
    });
    context.setActiveDialog(dialog);
    dialog.show();
    context.setDebugAttribute("data-fairy-editor-replace-dialog", initialTarget);
    context.setStatus(`Replace ${selectedCount} selected display node${selectedCount === 1 ? "" : "s"}.`);
}
