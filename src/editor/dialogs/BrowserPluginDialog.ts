import type { BrowserPluginSummary } from "../runtime/BrowserPluginHost";
import { addInspectorLine, createInspectorButton, setActionEnabled } from "../ui/EditorFormControls";

export interface BrowserPluginDialogContext {
    list(): BrowserPluginSummary[];
    install(): void;
    reload(pluginId: string): Promise<void>;
    setEnabled(pluginId: string, enabled: boolean): Promise<void>;
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    setDebugAttribute(name: string, value: string): void;
    setStatus(message: string): void;
    eventOwner: object;
}

type BrowserPluginPanelContext = Pick<
    BrowserPluginDialogContext,
    "getActiveDialog" | "setActiveDialog" | "setDebugAttribute" | "eventOwner"
>;

export function showBrowserPluginPanel(
    context: BrowserPluginPanelContext,
    title: string,
    lines: string[],
): void {
    context.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "browserPluginPanelDialog";
    const content = fgui.UIPackage.createObject("Builder", "AlertDialog").asCom;
    dialog.contentPane = content;
    content.getChild("frame").asLabel.title = title;
    const message = content.getChild("n2").asTextField;
    message.text = lines.join("\n");
    content.setSize(520, Math.max(120, 82 + lines.length * 20));
    content.getChild("n1").asButton.onClick(context.eventOwner, () => dialog.dispose());
    dialog.on(Laya.Event.UNDISPLAY, context.eventOwner, () => {
        if (context.getActiveDialog() === dialog) context.setActiveDialog(null);
    });
    context.setActiveDialog(dialog);
    dialog.show();
    context.setDebugAttribute("data-fairy-editor-plugin-panel", title);
}

export function showBrowserPluginDialog(context: BrowserPluginDialogContext): void {
    context.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "browserPluginDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(560, 590);
    dialog.contentPane = content;
    content.getChild("frame").asLabel.title = "浏览器插件";
    content.getChild("n2").visible = false;
    content.getChild("n1").visible = false;
    content.getChild("n3").visible = false;

    const pluginView = fgui.UIPackage.createObject("Builder", "PlugInView").asCom;
    pluginView.name = "browserPluginView";
    pluginView.setXY(12, 30);
    pluginView.setSize(536, 470);
    pluginView.getChild("pluginFolder").visible = false;
    pluginView.getChild("newPlugin").visible = false;
    pluginView.getChild("reload").visible = false;
    content.addChild(pluginView);
    const list = pluginView.getChild("list").asList;
    list.selectionMode = fgui.ListSelectionMode.Single;
    const install = createInspectorButton(content, "browserPluginInstall", "安装插件…", 12, 508, 112);
    const reload = createInspectorButton(content, "browserPluginReload", "重新载入", 132, 508, 104);
    const toggle = createInspectorButton(content, "browserPluginToggle", "启用", 244, 508, 104);
    const cancel = createInspectorButton(content, "browserPluginClose", "关闭", 436, 508, 112);
    const description = addInspectorLine(
        content,
        "browserPluginDescription",
        "安装带版本号的 ESM 插件清单；新插件默认停用。",
        14,
        542,
        410,
        "#bdbdbd",
    );
    let busy = false;

    const selected = (): BrowserPluginSummary | null => {
        if (list.selectedIndex < 0) return null;
        return list.getChildAt(list.selectedIndex).data as BrowserPluginSummary | null;
    };
    const render = (selectedId = selected()?.id || ""): void => {
        list.removeChildrenToPool();
        const plugins = context.list();
        for (const plugin of plugins) {
            const item = list.addItemFromPool().asButton;
            item.data = plugin;
            item.asCom.getChild("name").asTextField.text = `${plugin.name}  ${plugin.version}`;
            item.asCom.getChild("desc").asTextField.text = plugin.error
                ? `错误：${plugin.error}`
                : plugin.description || "无说明";
            item.asCom.getChild("author").asTextField.text = [
                plugin.enabled ? "已启用" : "已停用",
                `权限：${plugin.permissions.join("、") || "无"}`,
                `来源：${formatPluginSource(plugin.manifestUrl)}`,
            ].join(" · ");
            item.setSize(list.width, 73);
            item.tooltips = [
                `ID: ${plugin.id}`,
                `清单：${plugin.manifestUrl}`,
            ].filter(Boolean).join("\n");
            if (plugin.id === selectedId) list.selectedIndex = list.numChildren - 1;
        }
        if (list.selectedIndex < 0 && list.numChildren > 0) list.selectedIndex = 0;
        const plugin = selected();
        toggle.title = plugin?.enabled ? "停用" : "启用";
        setActionEnabled(toggle, Boolean(plugin) && !busy);
        setActionEnabled(reload, Boolean(plugin) && !busy);
        setActionEnabled(install, !busy);
        description.text = plugin
            ? busy ? `正在处理 ${plugin.name}…` : `${plugin.name}：${formatPluginState(plugin)}`
            : "尚未安装插件。点击“安装插件…”添加清单 URL。";
        context.setDebugAttribute("data-fairy-editor-plugin-count", String(plugins.length));
        context.setDebugAttribute("data-fairy-editor-plugin-selected", plugin?.id || "");
        context.setDebugAttribute("data-fairy-editor-plugin-state", plugin?.state || "none");
        context.setDebugAttribute(
            "data-fairy-editor-plugin-sandbox",
            plugin?.environment ? `dom:${plugin.environment.dom};opfs:${plugin.environment.opfs}` : "none",
        );
    };
    const close = (): void => {
        dialog.dispose();
        if (context.getActiveDialog() === dialog) context.setActiveDialog(null);
    };
    const perform = async (label: string, action: (plugin: BrowserPluginSummary) => Promise<void>): Promise<void> => {
        const plugin = selected();
        if (!plugin || busy) return;
        busy = true;
        render(plugin.id);
        try {
            await action(plugin);
            context.setStatus(`${label}: ${plugin.name}.`);
        } catch (error) {
            context.setStatus(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            busy = false;
            render(plugin.id);
        }
    };

    list.on(fgui.Events.CLICK_ITEM, context.eventOwner, () => render());
    install.onClick(context.eventOwner, () => {
        close();
        context.install();
    });
    reload.onClick(context.eventOwner, () => void perform("插件已重新载入", (plugin) => context.reload(plugin.id)));
    toggle.onClick(context.eventOwner, () => void perform(
        selected()?.enabled ? "插件已停用" : "插件已启用",
        (plugin) => context.setEnabled(plugin.id, !plugin.enabled),
    ));
    cancel.onClick(context.eventOwner, close);
    dialog.on(Laya.Event.UNDISPLAY, context.eventOwner, () => {
        if (context.getActiveDialog() === dialog) context.setActiveDialog(null);
    });
    context.setActiveDialog(dialog);
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    render();
    context.setDebugAttribute("data-fairy-editor-plugin-dialog", "open");
    context.setStatus("已打开浏览器插件管理器。");
}

function formatPluginSource(manifestUrl: string): string {
    try {
        return new URL(manifestUrl).host || manifestUrl;
    } catch {
        return manifestUrl;
    }
}

function formatPluginState(plugin: BrowserPluginSummary): string {
    if (plugin.error) return `加载错误：${plugin.error}`;
    if (!plugin.enabled) return "已停用";
    return plugin.state === "ready" ? "运行中" : "正在加载";
}
