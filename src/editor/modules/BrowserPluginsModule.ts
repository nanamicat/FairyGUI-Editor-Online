import {
    showBrowserPluginDialog,
    showBrowserPluginPanel,
} from "../dialogs/BrowserPluginDialog";
import {
    BrowserPluginHost,
    type BrowserPluginMenuContribution,
    validateBrowserPluginWriteCommands,
} from "../runtime/BrowserPluginHost";
import type { EditorModule } from "../workbench/EditorWorkbench";
import {
    EDITOR_SHELL_MODULE_HOST_SERVICE,
    type BrowserPluginModuleContext,
    type EditorShellModuleHost,
    type FairyGuiEditorWorkbenchHost,
} from "../workbench/EditorShellModuleHost";

export const BROWSER_PLUGINS_MODULE_ID = "fairygui.browser-plugins";

export function createBrowserPluginsModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: BROWSER_PLUGINS_MODULE_ID,
        async activate(context) {
            const shell = context.requireService<EditorShellModuleHost>(EDITOR_SHELL_MODULE_HOST_SERVICE);
            const ui = shell.createBrowserPluginModuleContext();
            const pluginHost = new BrowserPluginHost();
            let active = true;

            const refreshDebugState = (): void => {
                const plugins = pluginHost.list();
                const ready = plugins.filter((plugin) => plugin.enabled && plugin.state === "ready");
                ui.setDebugAttribute("data-fairy-editor-plugin-host", active ? "ready" : "detached");
                ui.setDebugAttribute("data-fairy-editor-plugin-count", String(plugins.length));
                ui.setDebugAttribute("data-fairy-editor-plugin-ready", String(ready.length));
                ui.setDebugAttribute(
                    "data-fairy-editor-plugin-sandbox",
                    ready.map((plugin) => (
                        `${plugin.id}:dom=${plugin.environment?.dom};opfs=${plugin.environment?.opfs}`
                    )).join("|"),
                );
            };

            const runBrowserPluginContribution = async (
                contribution: BrowserPluginMenuContribution,
            ): Promise<void> => {
                if (!active) return;
                ui.setDebugAttribute(
                    "data-fairy-editor-plugin-invoke",
                    `${contribution.pluginId}:${contribution.id}:pending`,
                );
                try {
                    const result = await pluginHost.invoke(
                        contribution.pluginId,
                        contribution.id,
                        ui.createInvocationContext(),
                    );
                    if (!active) return;
                    const commands = validateBrowserPluginWriteCommands(
                        result,
                        ui.getSelectedDisplayNodeSelector(),
                    );
                    if (commands.length > 0) {
                        const applied = await ui.applyDisplayNodeCommands(
                            commands,
                            `browser plugin ${contribution.id}`,
                        );
                        if (!applied || !active) return;
                    }
                    if (result.panel) {
                        showBrowserPluginPanel(ui, result.panel.title, result.panel.lines);
                    }
                    ui.setDebugAttribute(
                        "data-fairy-editor-plugin-invoke",
                        `${contribution.pluginId}:${contribution.id}:ok:${commands.length}`,
                    );
                    ui.setStatus(`浏览器插件已完成：${contribution.title}。`);
                } catch (error) {
                    await pluginHost.setEnabled(contribution.pluginId, false).catch(() => undefined);
                    if (!active) return;
                    refreshDebugState();
                    ui.setDebugAttribute(
                        "data-fairy-editor-plugin-invoke",
                        `${contribution.pluginId}:${contribution.id}:failed`,
                    );
                    ui.setStatus(
                        `浏览器插件执行失败并已停用：${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            };

            const showManager = (): void => {
                if (!active) return;
                showBrowserPluginDialog({
                    list: () => pluginHost.list(),
                    install: () => void installPlugin(),
                    reload: async (pluginId) => {
                        await pluginHost.reload(pluginId);
                        if (active) refreshDebugState();
                    },
                    setEnabled: async (pluginId, enabled) => {
                        await pluginHost.setEnabled(pluginId, enabled);
                        if (active) refreshDebugState();
                    },
                    getActiveDialog: ui.getActiveDialog,
                    setActiveDialog: ui.setActiveDialog,
                    setDebugAttribute: ui.setDebugAttribute,
                    setStatus: ui.setStatus,
                    eventOwner: ui.eventOwner,
                });
            };

            const installPlugin = async (): Promise<void> => {
                const manifestUrl = await ui.requestTextInput(
                    "browserPluginInstallDialog",
                    "安装浏览器插件",
                    "请输入 HTTPS 清单 URL；新插件安装后默认停用。",
                    "",
                    "安装",
                );
                if (!active || manifestUrl === null || !manifestUrl.trim()) return;
                try {
                    const plugin = await pluginHost.install(manifestUrl.trim(), false);
                    if (!active) return;
                    refreshDebugState();
                    ui.setDebugAttribute("data-fairy-editor-plugin-install", plugin.id);
                    ui.setStatus(`浏览器插件 ${plugin.name} 已安装并保持停用；请检查权限后再启用。`);
                    showManager();
                } catch (error) {
                    if (!active) return;
                    ui.setDebugAttribute("data-fairy-editor-plugin-install", "failed");
                    ui.setStatus(`浏览器插件安装失败：${error instanceof Error ? error.message : String(error)}`);
                }
            };

            context.onDeactivate(() => pluginHost.dispose());
            context.onDeactivate(shell.registerToolMenuContribution({
                id: `${BROWSER_PLUGINS_MODULE_ID}.manager`,
                itemName: "desktopMenuBrowserPlugins",
                title: "浏览器插件…",
                run: showManager,
            }));
            context.onDeactivate(shell.registerToolMenuProvider(() => (
                active
                    ? pluginHost.menuContributions().map((contribution) => ({
                        id: `${BROWSER_PLUGINS_MODULE_ID}.${contribution.id}`,
                        itemName: `browserPlugin:${contribution.id}`,
                        title: contribution.title,
                        run: () => runBrowserPluginContribution(contribution),
                    }))
                    : []
            )));
            context.onDeactivate(() => {
                active = false;
                const dialog = ui.getActiveDialog();
                if (!["browserPluginDialog", "browserPluginPanelDialog", "browserPluginInstallDialog"].includes(
                    dialog?.name || "",
                )) return;
                dialog?.dispose();
                if (ui.getActiveDialog() === dialog) ui.setActiveDialog(null);
            });
            context.onDeactivate(() => {
                ui.setDebugAttribute("data-fairy-editor-plugin-host", "detached");
                ui.setDebugAttribute("data-fairy-editor-plugin-ready", "0");
                ui.setDebugAttribute("data-fairy-editor-plugin-sandbox", "");
            });

            try {
                await pluginHost.initialize();
                if (active) refreshDebugState();
            } catch (error) {
                if (!active) return;
                ui.setDebugAttribute("data-fairy-editor-plugin-host", "error");
                console.error("[BrowserPlugin] initialization failed", error);
            }
        },
    };
}
