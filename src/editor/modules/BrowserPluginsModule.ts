import {
    showBrowserPluginDialog,
    showBrowserPluginPanel,
} from "../dialogs/BrowserPluginDialog";
import {
    BrowserPluginHost,
    type BrowserPluginMenuContribution,
    validateBrowserPluginWriteCommands,
} from "../runtime/BrowserPluginHost";
import { findDisplayNode } from "../commands/AuthoringTransactionSupport";
import type { EditorDisplayNodeSelector, SetDisplayNodePropsCommand } from "../model/EditorCommand";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { AUTHORING_DIALOGS_SERVICE, EditorAuthoringDialogs } from "./AuthoringDialogsModule";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const BROWSER_PLUGINS_MODULE_ID = "fairygui.browser-plugins";

export function createBrowserPluginsModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: BROWSER_PLUGINS_MODULE_ID,
        async activate(context) {
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const session = context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE);
            const document = context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE);
            const dialogs = context.requireService<EditorAuthoringDialogs>(AUTHORING_DIALOGS_SERVICE);
            const pluginHost = new BrowserPluginHost();
            let active = true;
            const inFlight = new Set<Promise<void>>();
            const ui = {
                getActiveDialog: () => dialogs.controller.getActiveDialog(),
                setActiveDialog: (dialog: fgui.Window | null) => dialogs.controller.setActiveDialog(dialog),
                requestTextInput: (
                    name: string,
                    title: string,
                    message: string,
                    current: string,
                    confirmLabel: string,
                ) => dialogs.controller.requestTextInput(name, title, message, current, confirmLabel),
                createInvocationContext: () => {
                    const activeWorkspace = session.workspaceLifecycle.registry.entries.find(
                        (entry) => entry.id === session.projectStorage.getWorkspaceName(),
                    );
                    const selector = document.getSelectedNodeSelector();
                    const snapshotNode = document.getSelectedNode();
                    const liveNode = selector
                        ? findDisplayNode(session.liveSessionBridge.getWorkingProject(), selector)
                        : null;
                    const snapshot = session.snapshot;
                    return {
                        workspace: {
                            id: session.projectStorage.getWorkspaceName(),
                            name: activeWorkspace?.name || "浏览器工作区",
                        },
                        project: snapshot ? {
                            id: snapshot.project.id,
                            packages: snapshot.totals.packages,
                            components: snapshot.totals.components,
                            displayObjects: snapshot.totals.displayObjects,
                        } : null,
                        selection: selector && snapshotNode && liveNode ? {
                            selector,
                            node: {
                                id: snapshotNode.id,
                                name: snapshotNode.name,
                                type: snapshotNode.type,
                                x: Number(liveNode.position?.x ?? snapshotNode.x),
                                y: Number(liveNode.position?.y ?? snapshotNode.y),
                                width: Number(liveNode.size?.width ?? snapshotNode.width),
                                height: Number(liveNode.size?.height ?? snapshotNode.height),
                            },
                        } : null,
                    };
                },
                getSelectedDisplayNodeSelector: () => document.getSelectedNodeSelector(),
                setDebugAttribute: (name: string, value: string) => chrome.setDebugAttribute(name, value),
                setStatus: (message: string) => chrome.setStatus(message),
                eventOwner: pluginHost,
            };

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

            const sameSelector = (
                left: EditorDisplayNodeSelector | null,
                right: EditorDisplayNodeSelector | null,
            ): boolean => Boolean(
                left
                && right
                && left.packageId === right.packageId
                && left.componentResourceId === right.componentResourceId
                && left.displayNodeId === right.displayNodeId,
            );
            const applyDisplayNodeCommands = (
                commands: SetDisplayNodePropsCommand[],
                summary: string,
                selector: EditorDisplayNodeSelector | null,
            ): Promise<boolean> => session.runExclusive(async () => {
                if (!active || !sameSelector(selector, document.getSelectedNodeSelector())) return false;
                try {
                    const { result } = await session.applyDisplayNodePropsNow(commands, summary);
                    if (result.ok) {
                        chrome.setStatus(`${summary}.`);
                        return true;
                    }
                    document.refreshPreview();
                    chrome.setStatus(`Command failed: ${result.error?.code || "unknown_error"}.`, "error");
                    return false;
                } catch (error) {
                    document.refreshPreview();
                    chrome.setStatus(
                        `Command failed: ${error instanceof Error ? error.message : String(error)}`,
                        "error",
                    );
                    return false;
                }
            });

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
                    const selector = ui.getSelectedDisplayNodeSelector();
                    const commands = validateBrowserPluginWriteCommands(result, selector);
                    if (commands.length > 0) {
                        const applied = await applyDisplayNodeCommands(
                            commands,
                            `browser plugin ${contribution.id}`,
                            selector,
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
            const trackContribution = (contribution: BrowserPluginMenuContribution): Promise<void> => {
                const task = runBrowserPluginContribution(contribution);
                inFlight.add(task);
                void task.then(
                    () => inFlight.delete(task),
                    () => inFlight.delete(task),
                );
                return task;
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

            context.onDeactivate(() => {
                ui.setDebugAttribute("data-fairy-editor-plugin-host", "detached");
                ui.setDebugAttribute("data-fairy-editor-plugin-ready", "0");
                ui.setDebugAttribute("data-fairy-editor-plugin-sandbox", "");
            });
            context.onDeactivate(async () => { await Promise.allSettled([...inFlight]); });
            context.onDeactivate(() => pluginHost.dispose());
            context.onDeactivate(() => {
                active = false;
                const dialog = ui.getActiveDialog();
                if (!["browserPluginDialog", "browserPluginPanelDialog", "browserPluginInstallDialog"].includes(
                    dialog?.name || "",
                )) return;
                dialog?.dispose();
                if (ui.getActiveDialog() === dialog) ui.setActiveDialog(null);
            });
            context.onDeactivate(chrome.registerToolMenuContribution({
                id: `${BROWSER_PLUGINS_MODULE_ID}.manager`,
                itemName: "desktopMenuBrowserPlugins",
                title: "浏览器插件…",
                run: showManager,
            }));
            context.onDeactivate(chrome.registerToolMenuProvider(() => (
                active
                    ? pluginHost.menuContributions().map((contribution) => ({
                        id: `${BROWSER_PLUGINS_MODULE_ID}.${contribution.id}`,
                        itemName: `browserPlugin:${contribution.id}`,
                        title: contribution.title,
                        run: () => trackContribution(contribution),
                    }))
                    : []
            )));
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
