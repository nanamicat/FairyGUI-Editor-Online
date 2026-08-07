import type { FairyPackageImportConflictStrategy } from "../services/FairyPackageTransfer";

export type EditorDialogContext = {
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    setStatus(message: string): void;
    setDebugAttribute(name: string, value: string): void;
    eventOwner: object;
};

export type EditorPackageChoice = { id: string; name: string };

export function requestEditorTextInput(
    options: EditorDialogContext,
    dialogName: string,
    title: string,
    prompt: string,
    initialValue: string,
    confirmTitle: string,
    validate?: (value: string) => string | null,
): Promise<string | null> {
    return new Promise((resolve) => {
        options.getActiveDialog()?.dispose();
        const dialog = new fgui.Window();
        dialog.modal = true;
        dialog.name = dialogName;
        dialog.contentPane = fgui.UIPackage.createObject("Builder", "InputDialog").asCom;
        const content = dialog.contentPane;
        content.getChild("frame").asLabel.title = title;
        content.getChild("prompt").text = prompt;
        const input = content.getChild("input").asCom.getChild("title").asTextInput;
        input.text = initialValue;
        let settled = false;
        const close = (value: string | null): void => {
            if (settled) return;
            if (value !== null) {
                const validationError = validate?.(value);
                if (validationError) {
                    content.getChild("prompt").text = validationError;
                    options.setStatus(validationError);
                    return;
                }
            }
            settled = true;
            dialog.dispose();
            if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
            options.setDebugAttribute("data-fairy-editor-input-dialog", value === null ? "cancelled" : "confirmed");
            resolve(value);
        };
        const ok = content.getChild("ok").asButton;
        ok.title = confirmTitle;
        content.getChild("cancel").asButton.onClick(options.eventOwner, () => close(null));
        ok.onClick(options.eventOwner, () => close(input.text));
        input.on(Laya.Event.KEY_DOWN, options.eventOwner, (event: Laya.Event) => {
            if (event.key === "Enter") close(input.text);
            else if (event.key === "Escape") close(null);
        });
        dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => close(null));
        options.setActiveDialog(dialog);
        dialog.show();
        input.requestFocus();
        options.setDebugAttribute("data-fairy-editor-input-dialog", dialogName);
    });
}

export function requestPasteConflictStrategy(
    options: EditorDialogContext,
    summary: string,
): Promise<FairyPackageImportConflictStrategy | null> {
    return new Promise((resolve) => {
        options.getActiveDialog()?.dispose();
        const dialog = new fgui.Window();
        dialog.modal = true;
        dialog.name = "desktopPasteOptionDialog";
        const content = fgui.UIPackage.createObject("Builder", "PasteOptionDialog").asCom;
        dialog.contentPane = content;
        content.getChild("frame").asLabel.title = "Paste options";
        content.getChild("n42").text = summary;
        content.getChild("n42").tooltips = summary;
        content.getController("c1").selectedIndex = 0;
        let settled = false;
        const close = (value: FairyPackageImportConflictStrategy | null): void => {
            if (settled) return;
            settled = true;
            dialog.dispose();
            if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
            options.setDebugAttribute("data-fairy-editor-paste-options", value || "cancelled");
            if (value === null) options.setStatus("Resource import conflict handling cancelled.");
            resolve(value);
        };
        content.getChild("n3").asButton.onClick(options.eventOwner, () => {
            close((["rename", "replace", "skip"] as const)[content.getController("c1").selectedIndex]);
        });
        content.getChild("n4").asButton.onClick(options.eventOwner, () => close(null));
        dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => close(null));
        options.setActiveDialog(dialog);
        dialog.show();
        options.setDebugAttribute("data-fairy-editor-paste-options", "open");
        options.setStatus("Choose how to handle conflicting imported resources.");
    });
}

export function requestEditorPackage(
    options: EditorDialogContext,
    title: string,
    packages: EditorPackageChoice[],
    initialId = "",
): Promise<string | null> {
    return new Promise((resolve) => {
        options.getActiveDialog()?.dispose();
        const dialog = new fgui.Window();
        dialog.modal = true;
        dialog.name = "desktopChoosePackageDialog";
        const content = fgui.UIPackage.createObject("Builder", "ChoosePackageDialog").asCom;
        dialog.contentPane = content;
        content.getChild("frame").asLabel.title = title;
        for (const name of ["selectAll", "selectReverse", "selectNone"]) content.getChild(name).visible = false;
        const list = content.getChild("pkgList").asList;
        list.selectionMode = fgui.ListSelectionMode.Single;
        const search = content.getChild("find").asCom.getChild("title").asTextInput;
        const ok = content.getChild("ok").asButton;
        let selectedId = initialId;
        let settled = false;
        const render = (): void => {
            const query = search.text.trim().toLocaleLowerCase();
            list.removeChildrenToPool();
            for (const entry of packages.filter((item) =>
                !query || item.name.toLocaleLowerCase().includes(query) || item.id.toLocaleLowerCase().includes(query),
            )) {
                const item = list.addItemFromPool().asButton;
                item.data = entry.id;
                item.title = entry.name;
                item.getChild("path").text = entry.id;
                item.getChild("delete").visible = false;
                if (entry.id === selectedId) list.selectedIndex = list.numChildren - 1;
            }
            ok.enabled = list.selectedIndex >= 0;
        };
        const close = (value: string | null): void => {
            if (settled) return;
            settled = true;
            dialog.dispose();
            if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
            resolve(value);
        };
        list.on(fgui.Events.CLICK_ITEM, options.eventOwner, (itemObject: fgui.GObject) => {
            selectedId = String(itemObject.data || "");
            ok.enabled = Boolean(selectedId);
        });
        search.on(Laya.Event.INPUT, options.eventOwner, render);
        ok.onClick(options.eventOwner, () => close(selectedId || null));
        content.getChild("cancel").asButton.onClick(options.eventOwner, () => close(null));
        dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => close(null));
        options.setActiveDialog(dialog);
        render();
        dialog.show();
        dialog.centerOn(fgui.GRoot.inst, true);
    });
}

export function showEditorConfirmation(
    options: EditorDialogContext,
    dialogName: string,
    title: string,
    message: string,
    confirmTitle: string,
    debugAttribute: string,
    pendingMessage: string,
    cancelMessage: string,
    onConfirm: () => void,
): void {
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.contentPane = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    dialog.name = dialogName;
    const content = dialog.contentPane;
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = title;
    content.getChild("n2").text = message;
    const confirm = content.getChild("n1").asButton;
    const cancel = content.getChild("n3").asButton;
    confirm.title = confirmTitle;
    cancel.title = "Cancel";
    const close = (): void => {
        dialog.dispose();
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    };
    confirm.onClick(options.eventOwner, () => {
        options.setDebugAttribute(debugAttribute, "confirmed");
        close();
        onConfirm();
    });
    cancel.onClick(options.eventOwner, () => {
        options.setDebugAttribute(debugAttribute, "cancelled");
        close();
        options.setStatus(cancelMessage);
    });
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => {
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    });
    options.setActiveDialog(dialog);
    dialog.show();
    options.setDebugAttribute(debugAttribute, "open");
    options.setStatus(pendingMessage);
}
