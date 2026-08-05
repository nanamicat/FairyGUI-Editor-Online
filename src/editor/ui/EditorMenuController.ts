import type { EditorShortcutId } from "../runtime/EditorPreferences";

export type EditorMenuCommand =
    | "undo"
    | "redo"
    | "cut"
    | "copy"
    | "paste"
    | "duplicate"
    | "delete"
    | "replace"
    | "selectAll"
    | "selectNone"
    | "moveForward"
    | "moveBackward"
    | "moveTop"
    | "moveBottom"
    | "openGroup"
    | "closeGroup"
    | "showInLibrary"
    | "timelineAdd"
    | "timelineDuplicate"
    | "timelineEdit"
    | "timelineRemove"
    | "workspace"
    | "startScene"
    | "toggleHierarchy"
    | "search"
    | "showLibrary"
    | "showFavorites"
    | "showTransitions"
    | "toggleLeftDock"
    | "toggleInspectorDock"
    | "toggleTimeline"
    | "toggleConsole"
    | "previousDocument"
    | "nextDocument"
    | "closeDocument"
    | "closeOtherDocuments"
    | "closeAllDocuments"
    | "openReferencedComponent"
    | "playRuntimeTransition";

interface EditorMenuState {
    canUndo: boolean;
    canRedo: boolean;
    shortcuts: Record<EditorShortcutId, string>;
    selectedNodeCount: number;
    canPaste: boolean;
    hasSelectedComponent: boolean;
    selectedNodeIsGroup: boolean;
    groupDepth: number;
    canShowInLibrary: boolean;
    timelineVisible: boolean;
    selectedTransition: boolean;
    selectedTimelineItem: boolean;
    hierarchyExpanded: boolean;
    leftTopPanelMode: "library" | "favorites" | "search" | "reference" | "transition";
    leftDockVisible: boolean;
    inspectorDockVisible: boolean;
    consoleVisible: boolean;
    documentCount: number;
    hasActiveDocument: boolean;
    hasReferencedComponent: boolean;
}

interface EditorMenuControllerOptions {
    getState: () => EditorMenuState;
    run: (command: EditorMenuCommand) => void;
    createMenu: () => fgui.PopupMenu;
    addItem: (
        menu: fgui.PopupMenu,
        name: string,
        title: string,
        handler: () => void,
        shortcut?: string,
    ) => fgui.GButton;
    setEnabled: (item: fgui.GButton, enabled: boolean) => void;
    showMenu: (menu: fgui.PopupMenu, anchor: fgui.GObject, source: string, status: string) => void;
    setStatus: (message: string) => void;
    setDebugAttribute: (name: string, value: string) => void;
}

export class EditorMenuController {
    constructor(private readonly options: EditorMenuControllerOptions) {}

    showEditMenu(anchor: fgui.GObject): void {
        const state = this.options.getState();
        const menu = this.options.createMenu();
        const add = (
            name: string,
            title: string,
            command: EditorMenuCommand,
            enabled = true,
            shortcut?: string,
        ): fgui.GButton => {
            const item = this.options.addItem(menu, name, title, () => this.options.run(command), shortcut);
            this.options.setEnabled(item, enabled);
            return item;
        };

        add("desktopMenuUndo", "撤销", "undo", state.canUndo, state.shortcuts.undo);
        add("desktopMenuRedo", "重做", "redo", state.canRedo, state.shortcuts.redo);
        menu.addSeperator();
        add("desktopMenuCutDisplayNodes", "剪切", "cut", state.selectedNodeCount > 0, "Ctrl+X");
        add("desktopMenuCopy", "复制", "copy", state.selectedNodeCount > 0, "Ctrl+C");
        add("desktopMenuPaste", "粘贴", "paste", state.canPaste, "Ctrl+V");
        add("desktopMenuDuplicateDisplayNodes", "创建副本", "duplicate", state.selectedNodeCount > 0, "Ctrl+D");
        add("desktopMenuDeleteDisplayNodes", "删除", "delete", state.selectedNodeCount > 0, "Delete");
        add("desktopMenuReplaceDisplayNodes", "替换…", "replace", state.selectedNodeCount > 0);
        menu.addSeperator();
        add("desktopMenuSelectAllDisplayNodes", "全选", "selectAll", state.hasSelectedComponent, "Ctrl+A");
        add("desktopMenuSelectNoDisplayNodes", "取消选择", "selectNone", state.selectedNodeCount > 0, "Ctrl+Shift+A");
        add("desktopMenuMoveDisplayNodesForward", "上移一层", "moveForward", state.selectedNodeCount > 0, "Ctrl+]");
        add("desktopMenuMoveDisplayNodesBackward", "下移一层", "moveBackward", state.selectedNodeCount > 0, "Ctrl+[");
        add("desktopMenuMoveDisplayNodesTop", "移至顶层", "moveTop", state.selectedNodeCount > 0);
        add("desktopMenuMoveDisplayNodesBottom", "移至底层", "moveBottom", state.selectedNodeCount > 0);
        add("desktopMenuOpenGroup", "进入组", "openGroup", state.selectedNodeIsGroup, "Enter");
        add("desktopMenuCloseGroup", "退出组", "closeGroup", state.groupDepth > 0);
        add("desktopMenuShowDisplayNodeInLibrary", "在资源库中定位", "showInLibrary", state.canShowInLibrary);
        menu.addSeperator();
        const timelineEnabled = state.timelineVisible && state.selectedTransition;
        const timelineItemEnabled = timelineEnabled && state.selectedTimelineItem;
        add("desktopMenuTimelineItemAdd", "添加时间轴动作…", "timelineAdd", timelineEnabled);
        add("desktopMenuTimelineItemDuplicate", "复制时间轴项目", "timelineDuplicate", timelineItemEnabled, "Insert");
        add("desktopMenuTimelineItemEdit", "编辑时间轴动作…", "timelineEdit", timelineItemEnabled, "Enter");
        add("desktopMenuTimelineItemRemove", "删除时间轴项目", "timelineRemove", timelineItemEnabled, "Delete");
        this.options.showMenu(menu, anchor, "edit", "已打开编辑菜单。");
    }

    showCanvasContextMenu(): void {
        this.showEditMenu(fgui.GRoot.inst);
        this.options.setDebugAttribute("data-fairy-editor-menu", "canvas-context");
        this.options.setStatus("已打开画布快捷菜单。");
    }

    showViewMenu(anchor: fgui.GObject): void {
        const state = this.options.getState();
        const menu = this.options.createMenu();
        const add = (
            name: string,
            title: string,
            command: EditorMenuCommand,
            shortcut?: string,
            enabled = true,
        ): fgui.GButton => {
            const item = this.options.addItem(menu, name, title, () => this.options.run(command), shortcut);
            this.options.setEnabled(item, enabled);
            return item;
        };

        add("desktopMenuWorkspaceView", "编辑工作区", "workspace");
        add("desktopMenuStartScene", "开始页", "startScene");
        add("desktopMenuHierarchy", state.hierarchyExpanded ? "折叠层级" : "展开层级", "toggleHierarchy");
        add("desktopMenuProjectSearch", "搜索项目…", "search", state.shortcuts.projectSearch);
        if (state.leftTopPanelMode !== "library") add("desktopMenuShowLibrary", "显示资源库", "showLibrary");
        if (state.leftTopPanelMode !== "favorites") add("desktopMenuShowFavorites", "显示收藏", "showFavorites");
        add("desktopMenuShowTransitions", "显示过渡", "showTransitions");
        add("desktopMenuLeftDock", state.leftDockVisible ? "隐藏左侧面板" : "显示左侧面板", "toggleLeftDock");
        add(
            "desktopMenuInspectorDock",
            state.inspectorDockVisible ? "隐藏属性面板" : "显示属性面板",
            "toggleInspectorDock",
        );
        add("desktopMenuTimeline", state.timelineVisible ? "隐藏时间轴" : "显示时间轴", "toggleTimeline");
        add("desktopMenuConsole", state.consoleVisible ? "隐藏控制台" : "显示控制台", "toggleConsole");
        menu.addSeperator();
        add(
            "desktopMenuPreviousDocument",
            "上一个文档",
            "previousDocument",
            state.shortcuts.previousDocument,
            state.documentCount > 1,
        );
        add(
            "desktopMenuNextDocument",
            "下一个文档",
            "nextDocument",
            state.shortcuts.nextDocument,
            state.documentCount > 1,
        );
        add(
            "desktopMenuCloseDocument",
            "关闭文档",
            "closeDocument",
            state.shortcuts.closeDocument,
            state.hasActiveDocument,
        );
        add(
            "desktopMenuCloseOtherDocuments",
            "关闭其他文档",
            "closeOtherDocuments",
            undefined,
            state.hasActiveDocument && state.documentCount > 1,
        );
        add(
            "desktopMenuCloseAllDocuments",
            "关闭所有文档",
            "closeAllDocuments",
            undefined,
            state.documentCount > 0,
        );
        add(
            "desktopMenuOpenReferencedComponent",
            "打开引用的组件",
            "openReferencedComponent",
            "Enter",
            state.hasReferencedComponent,
        );
        menu.addSeperator();
        add("desktopMenuPreviewPlay", "播放运行时过渡", "playRuntimeTransition");
        this.options.showMenu(menu, anchor, "view", "已打开查看菜单。");
    }
}
