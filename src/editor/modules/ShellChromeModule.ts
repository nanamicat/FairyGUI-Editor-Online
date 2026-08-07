import { EditorTextInput } from "../ui/EditorUiExtensions";
import type { EditorActionId } from "../EditorShellConfig";
import type { DesktopConsoleLevel } from "../runtime/DesktopConsoleLog";
import type { DesktopLayoutPanels } from "../ui/DesktopLayoutController";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type {
    EditorToolMenuContribution,
    EditorToolMenuProvider,
    FairyGuiEditorWorkbenchHost,
} from "../workbench/EditorShellModuleHost";

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
    private readonly actions = new Map<EditorActionId, () => void>();
    private readonly toolMenuContributions = new Map<string, EditorToolMenuContribution>();
    private readonly toolMenuProviders = new Set<EditorToolMenuProvider>();
    private statusReporter: ((message: string, level: DesktopConsoleLevel) => void) | null = null;
    private layoutRequester: (() => void) | null = null;
    private readonly layoutParticipants = new Set<() => void>();
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
        this.actions.clear();
        this.toolMenuContributions.clear();
        this.toolMenuProviders.clear();
        this.statusReporter = null;
        this.layoutRequester = null;
        this.layoutParticipants.clear();
        for (const panel of this.roots) {
            panel.removeFromParent();
            panel.dispose();
        }
    }

    bindStatusReporter(reporter: (message: string, level: DesktopConsoleLevel) => void): () => void {
        if (this.statusReporter) throw new Error("Shell status reporter is already bound.");
        this.statusReporter = reporter;
        return () => {
            if (this.statusReporter === reporter) this.statusReporter = null;
        };
    }

    bindLayoutRequester(requester: () => void): () => void {
        if (this.layoutRequester) throw new Error("Shell layout requester is already bound.");
        this.layoutRequester = requester;
        return () => {
            if (this.layoutRequester === requester) this.layoutRequester = null;
        };
    }

    requestLayout(): void {
        this.layoutRequester?.();
    }

    registerLayoutParticipant(participant: () => void): () => void {
        this.layoutParticipants.add(participant);
        return () => this.layoutParticipants.delete(participant);
    }

    notifyLayout(): void {
        for (const participant of this.layoutParticipants) participant();
    }

    setStatus(message: string, level: DesktopConsoleLevel = "info"): void {
        if (this.statusReporter) {
            this.statusReporter(message, level);
            return;
        }
        this.statusLine.title = message;
        this.setDebugAttribute("data-fairy-editor-status", message);
    }

    setDebugAttribute(name: string, value: string): void {
        if (this.disposed) return;
        if (typeof document !== "undefined" && document.body) document.body.setAttribute(name, value);
    }

    registerActions(ids: EditorActionId[], handler: () => void): () => void {
        if (this.disposed) throw new Error("Shell chrome is disposed.");
        for (const id of ids) {
            if (this.actions.has(id)) throw new Error(`Editor action ${id} is already registered.`);
            this.actions.set(id, handler);
        }
        return () => {
            for (const id of ids) {
                if (this.actions.get(id) === handler) this.actions.delete(id);
            }
        };
    }

    runAction(id: EditorActionId): boolean {
        const handler = this.actions.get(id);
        if (!handler) return false;
        handler();
        return true;
    }

    hasAction(id: EditorActionId): boolean {
        return this.actions.has(id);
    }

    registerToolMenuContribution(contribution: EditorToolMenuContribution): () => void {
        if (this.disposed) throw new Error("Shell chrome is disposed.");
        if (this.toolMenuContributions.has(contribution.id)) {
            throw new Error(`Editor tool contribution ${contribution.id} is already registered.`);
        }
        this.toolMenuContributions.set(contribution.id, contribution);
        return () => {
            if (this.toolMenuContributions.get(contribution.id) === contribution) {
                this.toolMenuContributions.delete(contribution.id);
            }
        };
    }

    registerToolMenuProvider(provider: EditorToolMenuProvider): () => void {
        if (this.disposed) throw new Error("Shell chrome is disposed.");
        this.toolMenuProviders.add(provider);
        return () => this.toolMenuProviders.delete(provider);
    }

    getToolMenuContributions(): EditorToolMenuContribution[] {
        return [...this.toolMenuContributions.values()];
    }

    getToolMenuProviders(): EditorToolMenuProvider[] {
        return [...this.toolMenuProviders];
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
