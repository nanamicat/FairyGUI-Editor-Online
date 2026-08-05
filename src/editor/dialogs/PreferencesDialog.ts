import {
    EDITOR_SHORTCUTS,
    createDefaultEditorPreferences,
    findEditorShortcutConflicts,
    normalizeEditorShortcut,
    type EditorPreferences,
    type EditorShortcutId,
} from "../runtime/EditorPreferences";

export interface PreferencesDialogContext {
    getPreferences(): EditorPreferences;
    updatePreferences(preferences: EditorPreferences): void;
    requestShortcut(id: EditorShortcutId, current: string): Promise<string | null>;
    resetLayout(): void;
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    setDebugAttribute(name: string, value: string): void;
    setStatus(message: string): void;
    eventOwner: object;
}

export function showPreferencesDialog(context: PreferencesDialogContext): void {
    context.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopPreferencesDialog";
    const content = fgui.UIPackage.createObject("Builder", "PreferencesDialog").asCom;
    dialog.contentPane = content;
    content.getChild("frame").asLabel.title = "偏好设置";

    const tabs = content.getChild("tab").asList;
    if (tabs.numChildren >= 2) {
        tabs.getChildAt(0).asButton.title = "常规";
        tabs.getChildAt(1).asButton.title = "快捷键";
    }
    if (tabs.numChildren >= 3) tabs.getChildAt(2).asButton.title = "布局";
    const pageController = content.getController("c1");
    const syncPageVisibility = (): void => {
        const setVisible = (names: string[], visible: boolean): void => {
            for (const name of names) {
                const child = content.getChild(name);
                if (child) child.visible = visible;
            }
        };
        setVisible(["n37", "language", "n39", "checkNewVersion", "n45"], pageController.selectedIndex === 0);
        setVisible(
            ["n47", "functionList", "resetHotkeys", "n57", "n58", "n59", "n60", "n61", "n52"],
            pageController.selectedIndex === 1,
        );
        setVisible(["n67", "pngTool", "browseTool", "n70"], pageController.selectedIndex === 2);
    };
    pageController.on(fgui.Events.STATE_CHANGED, context.eventOwner, syncPageVisibility);
    const preview = content.getChild("language").asComboBox;
    content.getChild("n37").text = "组件预览";
    preview.items = ["启用", "停用"];
    preview.values = ["enabled", "disabled"];
    const conflictStatus = content.getChild("checkNewVersion").asComboBox;
    content.getChild("n39").text = "快捷键冲突";
    conflictStatus.enabled = false;
    for (const name of ["n63", "publishAction", "n65", "saveBeforePublish", "n71", "editorFont"]) {
        content.getChild(name).visible = false;
    }

    const shortcutList = content.getChild("functionList").asList;
    const resetShortcuts = content.getChild("resetHotkeys").asButton;
    resetShortcuts.title = "恢复默认快捷键";
    content.getChild("n67").text = "桌面布局";
    const layoutSummary = content.getChild("pngTool").asCom.getChild("title").asTextInput;
    layoutSummary.text = "仅保存在当前浏览器";
    layoutSummary.editable = false;
    const resetLayout = content.getChild("browseTool").asButton;
    resetLayout.title = "重置";
    resetLayout.setXY(492, 28);
    resetLayout.setSize(76, 25);

    let rendering = false;
    const render = (): void => {
        rendering = true;
        const preferences = context.getPreferences();
        const conflicts = findEditorShortcutConflicts(preferences);
        preview.value = preferences.componentPreviewEnabled ? "enabled" : "disabled";
        conflictStatus.items = [conflicts.length ? `${conflicts.length} 项冲突` : "无冲突"];
        conflictStatus.values = [String(conflicts.length)];
        conflictStatus.selectedIndex = 0;
        shortcutList.removeChildrenToPool();
        for (const entry of EDITOR_SHORTCUTS) {
            const item = shortcutList.addItemFromPool().asButton;
            const shortcut = preferences.shortcuts[entry.id];
            const conflict = conflicts.find((candidate) => candidate.shortcut === shortcut);
            item.getChild("desc").text = entry.label;
            item.getChild("title").text = conflict
                ? `[color=#e06c75]${shortcut || "未分配"} · 冲突[/color]`
                : shortcut || "[color=#a0a0a0]未分配[/color]";
            item.data = entry.id;
            item.tooltips = conflict ? conflict.labels.join(" / ") : "点击编辑";
        }
        context.setDebugAttribute(
            "data-fairy-editor-preferences",
            `preview=${preferences.componentPreviewEnabled ? "enabled" : "disabled"},conflicts=${conflicts.length}`,
        );
        rendering = false;
    };

    preview.on(fgui.Events.STATE_CHANGED, context.eventOwner, () => {
        if (rendering) return;
        const current = context.getPreferences();
        context.updatePreferences({ ...current, componentPreviewEnabled: preview.value !== "disabled" });
        render();
    });
    shortcutList.on(fgui.Events.CLICK_ITEM, context.eventOwner, (itemObject: fgui.GObject) => {
        const id = itemObject.data as EditorShortcutId | null;
        if (!id) return;
        const current = context.getPreferences();
        void context.requestShortcut(id, current.shortcuts[id]).then((value) => {
            if (value === null) return;
            const shortcut = normalizeEditorShortcut(value);
            if (value.trim() && !shortcut) {
                context.setStatus("快捷键必须包含一个非修饰键。");
                return;
            }
            context.updatePreferences({
                ...current,
                shortcuts: { ...current.shortcuts, [id]: shortcut },
            });
            render();
        });
    });
    resetShortcuts.onClick(context.eventOwner, () => {
        const current = context.getPreferences();
        context.updatePreferences({ ...current, shortcuts: createDefaultEditorPreferences().shortcuts });
        render();
        context.setStatus("编辑器快捷键已恢复默认设置。");
    });
    resetLayout.onClick(context.eventOwner, () => {
        context.resetLayout();
        context.setDebugAttribute("data-fairy-editor-layout-reset", "default");
    });
    content.getChild("cancel").asButton.onClick(context.eventOwner, () => dialog.dispose());
    dialog.on(Laya.Event.UNDISPLAY, context.eventOwner, () => {
        if (context.getActiveDialog() === dialog) context.setActiveDialog(null);
    });

    render();
    syncPageVisibility();
    context.setActiveDialog(dialog);
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    context.setDebugAttribute("data-fairy-editor-preferences-dialog", "open");
    context.setStatus("已打开偏好设置；用户设置仅保存在当前浏览器。");
}
