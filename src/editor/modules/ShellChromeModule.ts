import { EditorTextInput } from "../ui/EditorUiExtensions";
import type { DesktopLayoutPanels } from "../ui/DesktopLayoutController";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";

export const SHELL_CHROME_SERVICE = "fairygui.shell-chrome";

export class EditorShellChrome {
    readonly holder: fgui.GObject;
    readonly menuBar: fgui.GComponent;
    readonly toolbar: fgui.GComponent;
    readonly startScene: fgui.GComponent;
    readonly statusLine: fgui.GButton;
    readonly panels: DesktopLayoutPanels;
    readonly favoritesView: fgui.GComponent;
    readonly searchView: fgui.GComponent;
    readonly searchInput: fgui.GTextInput;
    readonly libraryDock: fgui.GComponent;
    readonly hierarchyDock: fgui.GComponent;
    readonly referenceView: fgui.GComponent;
    readonly referenceInput: fgui.GTextInput;
    readonly transitionListView: fgui.GComponent;
    readonly testView: fgui.GComponent;
    readonly timelineView: fgui.GComponent;
    readonly consoleView: fgui.GComponent;

    private readonly roots: fgui.GComponent[];
    private disposed = false;

    constructor(readonly mainView: fgui.GComponent) {
        this.holder = this.requireChild(mainView, "holder");
        this.menuBar = this.requireChild(mainView, "menuBar").asCom;
        this.toolbar = this.requireChild(mainView, "toolbar").asCom;
        this.startScene = this.requireChild(mainView, "startScene").asCom;
        this.statusLine = this.requireChild(mainView, "logItem").asButton;
        this.panels = this.createPanels();

        this.favoritesView = this.createPanel("FavoritesView", "desktopFavoritesView");
        this.favoritesView.visible = false;
        mainView.addChild(this.favoritesView);
        this.searchView = this.createPanel("SearchView", "desktopSearchView");
        this.searchView.visible = false;
        mainView.addChild(this.searchView);
        this.searchInput = (this.searchView.getChild("keyword") as EditorTextInput).input;
        this.libraryDock = this.createLibraryDock();
        this.hierarchyDock = this.createHierarchyDock();

        this.referenceView = this.createPanel("ReferenceView", "desktopReferenceView");
        this.referenceView.visible = false;
        this.referenceView.getController("c1").selectedIndex = 0;
        this.referenceView.getChild("showReplace").visible = false;
        mainView.addChild(this.referenceView);
        this.referenceInput = (this.referenceView.getChild("source") as EditorTextInput).input;

        this.transitionListView = this.createPanel("TransitionListView", "desktopTransitionListView");
        this.transitionListView.visible = false;
        this.transitionListView.getChild("list").asList.selectionMode = fgui.ListSelectionMode.Single;
        mainView.addChild(this.transitionListView);
        this.testView = this.createPanel("TestView", "desktopTestView");
        this.testView.visible = false;
        mainView.addChild(this.testView);

        this.timelineView = this.createPanel("TimelineView", "desktopTimelineView");
        this.timelineView.visible = false;
        this.panels.document.addChild(this.timelineView);
        this.consoleView = this.createPanel("ConsoleView", "desktopConsoleView");
        this.consoleView.visible = false;
        this.panels.document.addChild(this.consoleView);

        this.roots = [
            this.libraryDock,
            this.referenceView,
            this.transitionListView,
            this.panels.document,
            this.testView,
            this.panels.preview,
            this.hierarchyDock,
            this.panels.inspector,
        ];
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const panel of this.roots) {
            panel.removeFromParent();
            panel.dispose();
        }
    }

    private createPanels(): DesktopLayoutPanels {
        const panels: DesktopLayoutPanels = {
            library: this.createPanel("LibraryView", "projectLibraryView"),
            document: this.createPanel("DocumentView", "projectDocumentView"),
            preview: this.createPanel("PreviewView", "projectPreviewView"),
            hierarchy: this.createPanel("HierarchyView", "projectHierarchyView"),
            inspector: this.createPanel("InspectorView", "projectInspectorView"),
        };
        for (const panel of Object.values(panels)) this.mainView.addChild(panel);
        return panels;
    }

    private createPanel(componentName: string, objectName: string): fgui.GComponent {
        const panel = fgui.UIPackage.createObject("Builder", componentName).asCom;
        panel.name = objectName;
        return panel;
    }

    private createLibraryDock(): fgui.GComponent {
        const dock = this.createPanel("ViewGrid", "desktopLibraryDock");
        this.panels.library.getChild("btnTwoColumn").asButton.selected = false;
        dock.getController("tabLayout").selectedIndex = 1;
        const content = dock.getChild("content").asCom;
        for (const panel of [this.panels.library, this.favoritesView, this.searchView]) content.addChild(panel);
        const tabs = dock.getChild("tab2").asList;
        tabs.removeChildrenToPool();
        tabs.selectionMode = fgui.ListSelectionMode.Single;
        for (const [title, mode, icon] of [
            ["资源", "library", "panel_lib"],
            ["收藏", "favorites", "panel_favorite"],
            ["搜索", "search", "panel_search"],
        ] as const) {
            const item = tabs.addItemFromPool().asButton;
            item.title = title;
            item.icon = fgui.UIPackage.getItemURL("Builder", icon);
            item.data = mode;
        }
        tabs.selectedIndex = 0;
        this.mainView.addChild(dock);
        return dock;
    }

    private createHierarchyDock(): fgui.GComponent {
        const dock = this.createPanel("ViewGrid", "desktopHierarchyDock");
        dock.getController("tabLayout").selectedIndex = 1;
        dock.getChild("content").asCom.addChild(this.panels.hierarchy);
        const tabs = dock.getChild("tab2").asList;
        tabs.removeChildrenToPool();
        const tab = tabs.addItemFromPool().asButton;
        tab.title = "显示列表";
        tab.icon = fgui.UIPackage.getItemURL("Builder", "panel_hierarchy");
        tabs.selectedIndex = 0;

        for (const name of ["status", "rename", "btnRelationDisabled", "btnShowAllInvisibles"]) {
            this.panels.hierarchy.getChild(name).visible = true;
        }
        this.panels.hierarchy.getChild("warnings").visible = false;
        const searchBar = this.panels.hierarchy.getChild("searchBar").asButton;
        searchBar.title = "";
        searchBar.visible = false;
        this.panels.hierarchy.getChild("list").tooltips = "选中显示列表后直接键入可搜索，Backspace 删除，Esc 清空";
        this.panels.hierarchy.getChild("status").tooltips = "隐藏/显示全部元件（仅设计期有效）";
        this.panels.hierarchy.getChild("lock").tooltips = "锁定/解锁全部元件";
        this.mainView.addChild(dock);
        return dock;
    }

    private requireChild(parent: fgui.GComponent, name: string): fgui.GObject {
        const child = parent.getChild(name);
        if (!child) throw new Error(`Missing required UI child "${name}" in ${parent.name || parent.resourceURL}.`);
        return child;
    }
}

export function createShellChromeModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.shell-chrome",
        hotReloadable: false,
        activate(context) {
            const chrome = new EditorShellChrome(context.host.mainView);
            context.provideService(SHELL_CHROME_SERVICE, chrome);
            return () => chrome.dispose();
        },
    };
}
