import {
    DEFAULT_BROWSER_WORKSPACE_ID,
    type BrowserWorkspaceRegistryEntry,
} from "../runtime/BrowserWorkspaceRegistry";
import { addInspectorLine, createInspectorButton, setActionEnabled } from "../ui/EditorFormControls";

export interface BrowserWorkspaceDialogContext {
    entries: BrowserWorkspaceRegistryEntry[];
    activeId: string;
    select(entry: BrowserWorkspaceRegistryEntry): void;
    create(): void;
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    setDebugAttribute(name: string, value: string): void;
    setStatus(message: string): void;
    eventOwner: object;
}

export function showBrowserWorkspaceDialog(context: BrowserWorkspaceDialogContext): void {
    context.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "browserWorkspaceSelectorDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(655, 500);
    dialog.contentPane = content;
    content.getChild("frame").asLabel.title = "浏览器工作区";
    content.getChild("n1").visible = false;
    content.getChild("n2").visible = false;
    content.getChild("n3").visible = false;
    addInspectorLine(content, "workspaceDescription", "工作区隔离保存浏览器内项目文件、标签页和布局。", 14, 32, 625, "#bdbdbd");
    addInspectorLine(content, "workspaceBoundary", "Folder 绑定跟随当前工作区；关闭工作区不会删除文件或最近记录。", 14, 52, 625, "#878787");
    const listBackground = new fgui.GGraph();
    listBackground.name = "workspaceListBackground";
    listBackground.setXY(11, 78);
    listBackground.setSize(633, 350);
    listBackground.drawRect(1, "#292828", "#383838");
    content.addChild(listBackground);
    const list = new fgui.GList();
    list.name = "workspaceList";
    list.setXY(12, 79);
    list.setSize(631, 348);
    list.layout = fgui.ListLayoutType.SingleColumn;
    list.defaultItem = fgui.UIPackage.getItemURL("Builder", "RecentItem");
    (list as fgui.GList & { setupOverflow(value: fgui.OverflowType): void })
        .setupOverflow(fgui.OverflowType.Scroll);
    list.selectionMode = fgui.ListSelectionMode.Single;
    content.addChild(list);
    for (const entry of context.entries) {
        const item = list.addItemFromPool().asButton;
        item.setSize(list.width - 12, 30);
        item.data = entry;
        const title = item.asCom.getChild("title").asRichTextField;
        title.setXY(8, 3);
        title.setSize(180, 24);
        const displayName = entry.id === DEFAULT_BROWSER_WORKSPACE_ID ? "默认工作区" : entry.name;
        title.text = `${entry.id === context.activeId ? "[当前] " : ""}${displayName}`;
        const path = item.asCom.getChild("path").asTextField;
        path.setXY(196, 5);
        path.setSize(item.width - 202, 20);
        path.text = `工程：${entry.fairyPath} · 最近打开：${new Date(entry.lastOpenedAt).toLocaleString("zh-CN")}`;
        item.asCom.getChild("delete").visible = false;
        item.tooltips = `工作区 ID：${entry.id}\n${path.text}`;
        if (entry.id === context.activeId) list.selectedIndex = list.numChildren - 1;
    }
    if (list.selectedIndex < 0 && list.numChildren > 0) list.selectedIndex = 0;
    const empty = addInspectorLine(content, "workspaceEmpty", "尚无可打开的工作区。", 24, 96, 600, "#878787");
    empty.visible = list.numChildren === 0;
    const create = createInspectorButton(content, "createWorkspace", "新建工作区…", 12, 452, 120);
    const open = createInspectorButton(content, "openWorkspace", "打开", 493, 452, 70);
    const cancel = createInspectorButton(content, "closeWorkspaceDialog", "关闭", 573, 452, 70);
    setActionEnabled(open, list.selectedIndex >= 0);
    const close = (): void => {
        dialog.dispose();
        if (context.getActiveDialog() === dialog) context.setActiveDialog(null);
    };
    create.onClick(context.eventOwner, () => {
        close();
        context.create();
    });
    list.on(fgui.Events.CLICK_ITEM, context.eventOwner, () => setActionEnabled(open, list.selectedIndex >= 0));
    open.onClick(context.eventOwner, () => {
        const entry = list.selectedIndex >= 0
            ? list.getChildAt(list.selectedIndex).data as BrowserWorkspaceRegistryEntry | null
            : null;
        if (!entry) {
            context.setStatus("请先选择一个工作区。");
            return;
        }
        close();
        context.select(entry);
    });
    cancel.onClick(context.eventOwner, close);
    dialog.on(Laya.Event.UNDISPLAY, context.eventOwner, () => {
        if (context.getActiveDialog() === dialog) context.setActiveDialog(null);
    });
    context.setActiveDialog(dialog);
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    context.setDebugAttribute("data-fairy-editor-workspace-selector", String(context.entries.length));
    context.setStatus(`已打开工作区列表，共 ${context.entries.length} 项。`);
}
