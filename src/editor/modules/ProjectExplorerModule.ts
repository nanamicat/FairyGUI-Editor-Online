import {
    getProjectResourceUrl,
    parseProjectResourceUrl,
    queryProjectResourceReferences,
    type ProjectResourceReference,
} from "../commands/HighRiskAuthoringTransactions";
import type { ShellEventListener, ShellEventTarget } from "../EditorShellConfig";
import type {
    ProjectSnapshotComponent,
    ProjectSnapshotResource,
} from "../model/ProjectSnapshot";
import {
    getDesktopDocumentTabId,
} from "../runtime/DesktopDocumentTabs";
import {
    searchDesktopProject,
    type DesktopProjectSearchResult,
} from "../runtime/DesktopProjectSearch";
import {
    LibraryController,
} from "../ui/LibraryController";
import {
    ProjectTreeInteractionController,
    type HierarchyDropTarget,
    type HierarchyItemData,
    type LibraryDragState,
    type LibraryItemData,
    type HierarchyDragState,
} from "../ui/ProjectTreeInteractionController";
import { ResourcePreviewController } from "../ui/ResourcePreviewController";
import { setOverflowButtonTitle } from "../ui/EditorFormControls";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const PROJECT_EXPLORER_SERVICE = "fairygui.project-explorer";

const DISPLAY_NODE_ICONS: Record<string, string> = {
    GButton: "icon_button",
    GComboBox: "icon_combobox",
    GComponent: "icon_component",
    GGraph: "icon_graph",
    GGroup: "icon_group",
    GImage: "icon_image",
    GLabel: "icon_label",
    GList: "icon_list",
    GLoader: "icon_loader",
    GLoader3D: "icon_loader3D",
    GMovieClip: "icon_movieclip",
    GProgressBar: "icon_progressbar",
    GRichTextField: "icon_richtext",
    GScrollBar: "icon_scrollbar",
    GSlider: "icon_slider",
    GTextField: "icon_text",
    GTextInput: "icon_inputtext",
    GTree: "icon_list",
};

export type ProjectExplorerPanelMode = "library" | "favorites" | "search" | "reference";

export type ProjectExplorerEvents = {
    editPackageGroups(): void;
    applyLibrarySelection(data: LibraryItemData, preserveResourceSelection: boolean): void;
    clearLibrarySelection(): void;
    resourceViewStateChanged(): void;
    showLibraryContextMenu(cell: fgui.GComponent, data: LibraryItemData): void;
    showHierarchyContextMenu(cell: fgui.GComponent, data: HierarchyItemData): void;
    openLibraryItem(data: Extract<LibraryItemData, { kind: "component" | "resource" }>): void;
    getComponentPreviewEnabled(): boolean;
    setComponentPreviewEnabled(enabled: boolean): void;
    activateDocument(packageId: string, componentId: string): boolean;
    documentSelectionChanged(): void;
    deactivateTimelineKeyboard(): void;
    showLeftPanel(mode: ProjectExplorerPanelMode, ensureVisible: boolean): void;
    setTransientStatus(message: string): void;
};

export type ProjectExplorerDisplayListActions = {
    toggleHierarchyNodeLock(data: HierarchyItemData): void;
    applyLibraryDrop(state: LibraryDragState, point: { x: number; y: number }): Promise<void>;
    applyHierarchyDrop(state: HierarchyDragState, target: HierarchyDropTarget): Promise<void>;
};

export class EditorProjectExplorer {
    readonly library: LibraryController;
    readonly treeInteraction: ProjectTreeInteractionController;
    readonly resourcePreview: ResourcePreviewController;

    private events: ProjectExplorerEvents | null = null;
    private displayListActions: ProjectExplorerDisplayListActions | null = null;
    private readonly viewUnbinders: Array<() => void> = [];
    private hierarchyExpandedState = true;
    private hierarchySearchQuery = "";
    private readonly hierarchyHiddenNodes = new Map<string, Set<string>>();
    private readonly hierarchyRelationsDisabled = new Set<string>();
    private readonly hierarchyShowAllInvisibles = new Set<string>();
    private libraryLinked = false;
    private searchResults: DesktopProjectSearchResult[] = [];

    constructor(
        private readonly chrome: EditorShellChrome,
        private readonly session: EditorProjectSession,
        private readonly document: EditorDocumentAuthoring,
    ) {
        this.resourcePreview = new ResourcePreviewController(
            chrome.panels.preview,
            () => session.liveSessionBridge.getWorkingProject(),
            (projectId, packageName, componentName) => document.preview.createLibraryComponentPreview(
                projectId,
                packageName,
                componentName,
            ),
            () => this.events?.getComponentPreviewEnabled() ?? true,
            (enabled) => this.events?.setComponentPreviewEnabled(enabled),
            (name, value) => chrome.setDebugAttribute(name, value),
            (message) => chrome.setStatus(message),
        );
        this.treeInteraction = new ProjectTreeInteractionController(
            chrome.mainView,
            chrome.panels.library.getChild("listView").asList,
            chrome.panels.hierarchy.getChild("list").asTree,
            {
                getSelectedPackageId: () => document.packageId,
                getSelectedComponentId: () => document.componentId,
                getSelectedPackage: () => document.getSelectedPackage(),
                getSelectedComponent: () => document.getSelectedComponent(),
                findResourceType: (packageId, resourceId) => this.findResource(packageId, resourceId)?.type || "",
                isComponentExported: (packageId, componentId) => (
                    this.findResource(packageId, componentId)?.exported
                    ?? session.snapshot?.packages.find((pkg) => pkg.id === packageId)
                        ?.components.find((component) => component.id === componentId)?.exported
                    ?? false
                ),
                showLibraryContextMenu: (cell, data) => this.events?.showLibraryContextMenu(cell, data),
                showHierarchyContextMenu: (cell, data) => this.events?.showHierarchyContextMenu(cell, data),
                openLibraryItem: (data) => this.events?.openLibraryItem(data),
                resolveAuthoringDropPoint: (stageX, stageY) => document.preview.resolveAuthoringDropPoint(stageX, stageY),
                selectHierarchyNode: (data) => this.selectHierarchyDragNode(data),
                toggleHierarchyNodeLock: (data) => this.displayListActions?.toggleHierarchyNodeLock(data),
                toggleHierarchyNodeHidden: (data) => this.toggleHierarchyNodeHidden(data),
                applyLibraryDrop: (state, point) => this.displayListActions?.applyLibraryDrop(state, point) ?? Promise.resolve(),
                applyHierarchyDrop: (state, target) => this.displayListActions?.applyHierarchyDrop(state, target) ?? Promise.resolve(),
                setDebugAttribute: (name, value) => chrome.setDebugAttribute(name, value),
                setStatus: (message) => chrome.setStatus(message),
            },
        );
        this.library = new LibraryController(
            chrome.panels.library,
            chrome.favoritesView,
            this.treeInteraction,
            {
                getSnapshot: () => session.snapshot,
                getSelectedPackageId: () => document.packageId,
                getWorkingProject: () => session.liveSessionBridge.getWorkingProject(),
                editPackageGroups: () => this.events?.editPackageGroups(),
                applySelection: (data, preserve) => this.events?.applyLibrarySelection(data, preserve),
                clearSelection: () => {
                    this.library.clearInspectorSelection();
                    this.events?.clearLibrarySelection();
                },
                setDebugAttribute: (name, value) => chrome.setDebugAttribute(name, value),
                setStatus: (message) => chrome.setStatus(message),
                onViewStateChanged: () => this.events?.resourceViewStateChanged(),
            },
        );
        try {
            this.bindViewActions();
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    bind(events: ProjectExplorerEvents): () => void {
        if (this.events) throw new Error("Project explorer events are already bound.");
        this.events = events;
        return () => {
            if (this.events === events) this.events = null;
        };
    }

    bindDisplayListActions(actions: ProjectExplorerDisplayListActions): () => void {
        if (this.displayListActions) throw new Error("Project explorer display-list actions are already bound.");
        this.displayListActions = actions;
        return () => {
            if (this.displayListActions === actions) this.displayListActions = null;
        };
    }

    get linked(): boolean { return this.libraryLinked; }
    set linked(value: boolean) {
        this.libraryLinked = value;
        this.chrome.panels.library.getChild("btnSync").asButton.selected = value;
    }

    get hierarchyExpanded(): boolean { return this.hierarchyExpandedState; }
    get hierarchyQuery(): string { return this.hierarchySearchQuery; }

    populateFallbackLibrary(): void {
        this.library.populateFallback();
    }

    populateFallbackHierarchy(): void {
        const tree = this.chrome.panels.hierarchy.getChild("list").asTree;
        this.treeInteraction.resetTree(tree);
        this.treeInteraction.configureHierarchyTree(tree);
        for (const childName of ["menuBar", "toolbar", "LibraryView", "DocumentView", "PreviewView", "HierarchyView", "InspectorView"]) {
            tree.rootNode.addChild(this.createTreeLeaf(childName, "icon_component"));
        }
    }

    populateLibrary(scrollSelectionIntoView = false): void {
        this.library.populate(scrollSelectionIntoView);
    }

    populateFavorites(): void {
        this.library.populateFavorites();
    }

    populateHierarchy(): void {
        const tree = this.chrome.panels.hierarchy.getChild("list").asTree;
        this.treeInteraction.resetTree(tree);
        this.treeInteraction.configureHierarchyTree(tree);
        tree.clearSelection();

        const selectedComponent = this.document.getSelectedComponent();
        this.updateHierarchyToolbarState(selectedComponent);
        if (!selectedComponent) return;

        const scopedIds = new Set(this.document.getScopedNodeIds(selectedComponent));
        const visibleIds = this.getHierarchySearchVisibleIds(selectedComponent, scopedIds);
        const groupPath = this.document.getActiveGroupPath(selectedComponent);
        this.appendHierarchyNodes(
            tree.rootNode,
            selectedComponent,
            groupPath[groupPath.length - 1] || "",
            visibleIds,
        );
        this.selectCurrentHierarchyNode(tree);
    }

    syncRuntimePreviewPresentation(): void {
        this.document.preview.setEditorHiddenNodeIds(this.getHierarchyHiddenNodeIds());
        this.document.preview.setShowAllInvisibleNodes(
            this.hierarchyShowAllInvisibles.has(this.getHierarchyDocumentKey()),
        );
    }

    handleLibraryItemClick(data: LibraryItemData | null, list: fgui.GList): void {
        this.library.handleItemClick(data, list);
    }

    locateActiveDocumentInLibrary(reportStatus = true): void {
        const tab = this.document.getActiveTab();
        if (!tab) {
            if (reportStatus) this.chrome.setStatus("定位当前文档需要先打开一个组件。");
            return;
        }
        this.events?.showLeftPanel("library", true);
        this.library.setPackageId(tab.packageId);
        this.library.setResourceSelection([{
            packageId: tab.packageId,
            resourceId: tab.componentId,
        }]);
        this.library.setInspectorSelection({
            kind: "resource",
            packageId: tab.packageId,
            resourceId: tab.componentId,
        });
        this.populateLibrary(true);
        this.chrome.requestLayout();
        this.chrome.setDebugAttribute(
            "data-fairy-editor-library-locate-document",
            getDesktopDocumentTabId(tab),
        );
        if (reportStatus) {
            this.chrome.setStatus(`已在资源库中定位 ${this.document.getSelectedComponent()?.name || tab.componentId}。`);
        }
    }

    showProjectSearch(): void {
        this.events?.showLeftPanel("search", true);
        this.refreshProjectSearch();
        this.chrome.requestLayout();
        this.chrome.searchInput.requestFocus();
        this.setTransientStatus("项目搜索已打开。");
    }

    showLibraryPanel(): void {
        this.events?.showLeftPanel("library", false);
        this.library.setResourceSelection([]);
        this.chrome.setDebugAttribute("data-fairy-editor-library-resource-selection", "");
        this.populateLibrary();
        this.chrome.requestLayout();
        this.setTransientStatus("Library opened.");
    }

    showFavoritesPanel(): void {
        this.events?.showLeftPanel("favorites", true);
        this.library.setResourceSelection([]);
        this.chrome.setDebugAttribute("data-fairy-editor-library-resource-selection", "");
        this.populateFavorites();
        this.chrome.requestLayout();
        this.setTransientStatus("Favorites opened.");
    }

    showProjectReferencesForCurrentSelection(): void {
        const pkg = this.document.getSelectedPackage();
        const selection = this.library.getInspectorSelection();
        const selectedResource = selection?.kind === "resource"
            ? this.findResource(selection.packageId, selection.resourceId)
            : null;
        const selectedComponent = this.document.getSelectedComponent();
        const resourceId = selectedResource?.id || selectedComponent?.id || "";
        if (!pkg || !resourceId) {
            this.chrome.setStatus("Find References requires a selected resource or component.");
            return;
        }
        this.events?.showLeftPanel("reference", true);
        this.chrome.referenceInput.text = getProjectResourceUrl({ packageId: pkg.id, resourceId });
        this.refreshProjectReferences();
        this.chrome.requestLayout();
        this.chrome.referenceInput.requestFocus();
        this.chrome.setStatus(`References opened for ${selectedResource?.name || selectedComponent?.name || resourceId}.`);
    }

    toggleHierarchyExpansion(): void {
        this.hierarchyExpandedState = !this.hierarchyExpandedState;
        const tree = this.chrome.panels.hierarchy.getChild("list").asTree;
        if (this.hierarchyExpandedState) tree.expandAll();
        else tree.collapseAll();
        this.chrome.setDebugAttribute("data-fairy-editor-hierarchy-expanded", String(this.hierarchyExpandedState));
        this.setTransientStatus(`Hierarchy ${this.hierarchyExpandedState ? "expanded" : "collapsed"}.`);
    }

    setHierarchySearchQuery(value: string): void {
        this.hierarchySearchQuery = value.toLocaleLowerCase();
        const searchBar = this.chrome.panels.hierarchy.getChild("searchBar").asButton;
        searchBar.title = this.hierarchySearchQuery;
        searchBar.visible = this.hierarchySearchQuery.length > 0;
        if (searchBar.visible) {
            const width = Math.min(150, Math.max(48, this.hierarchySearchQuery.length * 7 + 32));
            searchBar.setSize(width, 27);
            searchBar.getChild("title").setSize(Math.max(11, width - 30), 18);
        }
        this.populateHierarchy();
        this.chrome.setDebugAttribute("data-fairy-editor-hierarchy-search", this.hierarchySearchQuery);
    }

    clearHierarchySearch(): void {
        if (!this.hierarchySearchQuery) return;
        this.setHierarchySearchQuery("");
        this.setTransientStatus("Display-list search cleared.");
    }

    private bindViewActions(): void {
        this.listenEvent(this.chrome.libraryDock.getChild("tab2"), fgui.Events.CLICK_ITEM, this.onLibraryDockTabClick);
        this.listenClick(this.chrome.panels.library.getChild("btnLocate"), this.locateActiveDocumentInLibrary, [true]);
        this.listenEvent(this.chrome.panels.library.getChild("btnSync"), fgui.Events.STATE_CHANGED, this.onLibrarySyncChanged);
        this.listenClick(this.chrome.panels.hierarchy.getChild("expand"), this.toggleHierarchyExpansion);
        this.listenClick(this.chrome.panels.hierarchy.getChild("status"), this.toggleAllHierarchyVisibility);
        this.listenClick(this.chrome.panels.hierarchy.getChild("warnings"), this.selectDuplicateHierarchyNames);
        this.listenClick(
            this.chrome.panels.hierarchy.getChild("searchBar").asCom.getChild("cancel"),
            this.clearHierarchySearch,
        );
        this.listenEvent(
            this.chrome.panels.hierarchy.getChild("btnRelationDisabled"),
            fgui.Events.STATE_CHANGED,
            this.onHierarchyRelationsDisabledChanged,
        );
        this.listenEvent(
            this.chrome.panels.hierarchy.getChild("btnShowAllInvisibles"),
            fgui.Events.STATE_CHANGED,
            this.onHierarchyShowAllInvisiblesChanged,
        );
        this.listenEvent(this.chrome.panels.library.getChild("group"), fgui.Events.STATE_CHANGED, this.onLibraryFilterChanged);
        this.listenEvent(this.chrome.panels.library.getChild("listView"), fgui.Events.CLICK_ITEM, this.onLibraryItemClick);
        this.listenEvent(this.chrome.panels.library.getChild("treeView"), fgui.Events.CLICK_ITEM, this.onLibraryTreeItemClick);
        this.listenClick(this.chrome.panels.library.getChild("btnCollapseAll"), this.collapseLibrary);
        this.listenEvent(
            this.chrome.panels.library.getChild("btnTwoColumn"),
            fgui.Events.STATE_CHANGED,
            this.onLibraryTwoColumnChanged,
        );
        this.listenEvent(
            this.chrome.panels.library.getChild("iconSize").asCom.getChild("slider"),
            fgui.Events.STATE_CHANGED,
            this.onLibraryIconSizeChanged,
        );
        this.listenEvent(this.chrome.favoritesView.getChild("treeView"), fgui.Events.CLICK_ITEM, this.onLibraryTreeItemClick);
        this.listenClick(this.chrome.favoritesView.getChild("btnCollapseAll"), this.collapseFavorites);
        this.listenClick(this.chrome.favoritesView.getChild("btnExpandAll"), this.expandFavorites);
        this.listenClick(this.chrome.searchView.getChild("find"), this.refreshProjectSearch);
        this.listenEvent(this.chrome.searchInput, Laya.Event.KEY_DOWN, this.onSearchKeywordKeyDown);
        this.listenEvent(this.chrome.searchView.getChild("list"), fgui.Events.CLICK_ITEM, this.onSearchResultClick);
        this.listenClick(this.chrome.referenceView.getChild("find"), this.refreshProjectReferences);
        this.listenEvent(this.chrome.referenceInput, Laya.Event.KEY_DOWN, this.onReferenceInputKeyDown);
        this.listenEvent(
            this.chrome.referenceView.getController("queryType"),
            fgui.Events.STATE_CHANGED,
            this.refreshProjectReferences,
        );
        this.listenEvent(this.chrome.referenceView.getChild("list"), fgui.Events.CLICK_ITEM, this.onReferenceResultClick);
    }

    private listenClick(target: fgui.GObject, listener: ShellEventListener, args?: any[]): void {
        target.onClick(this, listener, args);
        this.viewUnbinders.push(() => target.offClick(this, listener));
    }

    private listenEvent(
        target: ShellEventTarget,
        type: string,
        listener: ShellEventListener,
        args?: any[],
    ): void {
        target.on(type, this, listener, args);
        this.viewUnbinders.push(() => target.off(type, this, listener));
    }

    private setTransientStatus(message: string): void {
        if (this.events) this.events.setTransientStatus(message);
        else this.chrome.setStatus(message);
    }

    private onLibraryDockTabClick(itemObject: fgui.GObject): void {
        const mode = itemObject.data as "library" | "favorites" | "search" | null;
        if (mode === "library") this.showLibraryPanel();
        else if (mode === "favorites") this.showFavoritesPanel();
        else if (mode === "search") this.showProjectSearch();
    }

    private onLibraryTreeItemClick(itemObject: fgui.GObject): void {
        this.events?.deactivateTimelineKeyboard();
        const node = itemObject.treeNode;
        const data = node ? (node.data as LibraryItemData | null) : null;
        const tree = itemObject.parent as fgui.GTree;
        const expandedStatusInEvent = (tree as unknown as { _expandedStatusInEvt: boolean })._expandedStatusInEvt;
        // ponytail: frozen FairyGUI does not implement clickToExpand=2; expand package labels without hijacking arrow clicks.
        if (data?.kind === "package" && node && node.expanded === expandedStatusInEvent) node.expanded = true;
        this.library.captureExpansionState();
        this.handleLibraryItemClick(data, tree);
    }

    private onLibraryItemClick(itemObject: fgui.GObject): void {
        this.events?.deactivateTimelineKeyboard();
        this.handleLibraryItemClick(itemObject.data as LibraryItemData | null, itemObject.parent as fgui.GList);
    }

    private onLibraryFilterChanged(): void {
        this.library.handleFilterChanged();
    }

    private onLibrarySyncChanged(): void {
        this.libraryLinked = this.chrome.panels.library.getChild("btnSync").asButton.selected;
        this.events?.resourceViewStateChanged();
        this.chrome.setDebugAttribute("data-fairy-editor-library-linked", String(this.libraryLinked));
        if (this.libraryLinked) this.locateActiveDocumentInLibrary(false);
        else this.chrome.setStatus("资源库已取消与当前文档联动。");
    }

    private onLibraryIconSizeChanged(): void {
        const value = this.chrome.panels.library.getChild("iconSize").asCom.getChild("slider").asSlider.value;
        this.library.setIconSizeStep(value);
        this.populateLibrary();
        this.chrome.setDebugAttribute("data-fairy-editor-library-icon-size", String(value));
        this.chrome.setStatus(`资源缩略图尺寸：${value + 1}/6。`);
    }

    private onLibraryTwoColumnChanged(): void {
        this.events?.resourceViewStateChanged();
        this.chrome.requestLayout();
        this.chrome.setStatus(`资源库${this.chrome.panels.library.getChild("btnTwoColumn").asButton.selected ? "双列" : "单列"}视图已保存。`);
    }

    private collapseFavorites(): void { this.library.collapseFavorites(); }
    private collapseLibrary(): void { this.library.collapseLibrary(); }
    private expandFavorites(): void { this.library.expandFavorites(); }

    private onSearchKeywordKeyDown(event: Laya.Event): void {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        this.refreshProjectSearch();
    }

    refreshProjectSearch(): void {
        const keyword = this.chrome.searchInput.text.trim();
        this.searchResults = this.session.snapshot && keyword
            ? searchDesktopProject(this.session.snapshot, keyword)
            : [];
        const list = this.chrome.searchView.getChild("list").asList;
        list.removeChildrenToPool();
        for (const result of this.searchResults) {
            const item = list.addItemFromPool().asButton;
            setOverflowButtonTitle(item, result.label);
            item.data = result;
        }
        this.chrome.searchView.getChild("result").text = keyword
            ? `${this.searchResults.length} 个结果`
            : "输入关键词搜索项目";
        this.chrome.setDebugAttribute("data-fairy-editor-search-query", keyword);
        this.chrome.setDebugAttribute("data-fairy-editor-search-count", String(this.searchResults.length));
    }

    private onReferenceInputKeyDown(event: Laya.Event): void {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        this.refreshProjectReferences();
    }

    refreshProjectReferences(): void {
        const project = this.session.liveSessionBridge.getWorkingProject();
        const source = parseProjectResourceUrl(project, this.chrome.referenceInput.text);
        const direction = this.chrome.referenceView.getController("queryType").selectedIndex === 0
            ? "incoming"
            : "outgoing";
        const references = source
            ? queryProjectResourceReferences(project, source, direction)
            : [];
        const list = this.chrome.referenceView.getChild("list").asList;
        list.removeChildrenToPool();
        for (const reference of references) {
            const item = list.addItemFromPool().asButton;
            setOverflowButtonTitle(item, `${reference.label} · ${reference.count}`);
            item.data = reference;
            item.tooltips = `${reference.label}（${reference.count} 个引用）`;
        }
        const totalCount = references.reduce((count, reference) => count + reference.count, 0);
        this.chrome.referenceView.getChild("result").text = source
            ? `${totalCount} 个引用，分布在 ${references.length} 个文件中`
            : "未找到资源 URL";
        this.chrome.setDebugAttribute("data-fairy-editor-reference-direction", direction);
        this.chrome.setDebugAttribute("data-fairy-editor-reference-source", this.chrome.referenceInput.text.trim());
        this.chrome.setDebugAttribute("data-fairy-editor-reference-count", String(references.length));
    }

    private onSearchResultClick(itemObject: fgui.GObject): void {
        const result = itemObject.data as DesktopProjectSearchResult | null;
        if (!result || !this.navigateProjectResult(result)) return;
        if (result.kind === "component") {
            this.chrome.setStatus(`Search opened ${result.label}.`);
        } else if (result.kind === "displayNode") {
            this.chrome.setStatus(`Search selected ${result.label}.`);
        }
        this.chrome.setDebugAttribute(
            "data-fairy-editor-search-selection",
            result.kind === "package"
                ? `${result.kind}:${result.packageId}`
                : result.kind === "component"
                    ? `${result.kind}:${result.packageId}/${result.componentId}`
                    : result.kind === "resource"
                        ? `${result.kind}:${result.packageId}/${result.resourceId}`
                        : `${result.kind}:${result.packageId}/${result.componentId}/${result.nodeId}`,
        );
    }

    private onReferenceResultClick(itemObject: fgui.GObject): void {
        const reference = itemObject.data as ProjectResourceReference | null;
        if (!reference) return;
        const result: DesktopProjectSearchResult = reference.kind === "projectSettings"
            ? { kind: "package", packageId: reference.packageId, label: reference.label }
            : reference.resourceKind === "component"
                ? {
                    kind: "component",
                    packageId: reference.packageId,
                    componentId: reference.resourceId,
                    label: reference.label,
                }
                : {
                    kind: "resource",
                    packageId: reference.packageId,
                    resourceId: reference.resourceId,
                    label: reference.label,
                };
        if (!this.navigateProjectResult(result)) return;
        this.chrome.setDebugAttribute(
            "data-fairy-editor-reference-selection",
            `${reference.kind}:${reference.packageId}/${reference.resourceId}`,
        );
        this.chrome.setStatus(`Reference opened ${reference.label}.`);
    }

    private navigateProjectResult(result: DesktopProjectSearchResult): boolean {
        this.library.setPackageId(result.packageId);
        if (result.kind === "package") {
            this.events?.applyLibrarySelection({ kind: "package", packageId: result.packageId }, false);
        } else if (result.kind === "component") {
            if (!this.events?.activateDocument(result.packageId, result.componentId)) return false;
        } else if (result.kind === "resource") {
            this.events?.applyLibrarySelection({
                kind: "resource",
                packageId: result.packageId,
                resourceId: result.resourceId,
            }, false);
            this.populateLibrary();
        } else {
            if (!this.events?.activateDocument(result.packageId, result.componentId)) return false;
            this.document.setSelection([result.nodeId], result.nodeId);
            this.events.documentSelectionChanged();
            this.populateHierarchy();
        }
        return true;
    }

    private selectHierarchyDragNode(data: HierarchyItemData): void {
        this.document.setActiveSelection(
            this.document.packageId,
            data.componentId,
            [data.nodeId],
            data.nodeId,
        );
        this.events?.documentSelectionChanged();
    }

    private getHierarchyDocumentKey(): string {
        return this.document.packageId && this.document.componentId
            ? `${this.document.packageId}/${this.document.componentId}`
            : "";
    }

    private getHierarchyHiddenNodeIds(): Set<string> {
        return this.hierarchyHiddenNodes.get(this.getHierarchyDocumentKey()) || new Set<string>();
    }

    private toggleHierarchyNodeHidden(data: HierarchyItemData): void {
        const key = this.getHierarchyDocumentKey();
        if (!key || data.componentId !== this.document.componentId) return;
        const hidden = new Set(this.getHierarchyHiddenNodeIds());
        hidden.has(data.nodeId) ? hidden.delete(data.nodeId) : hidden.add(data.nodeId);
        if (hidden.size > 0) this.hierarchyHiddenNodes.set(key, hidden);
        else this.hierarchyHiddenNodes.delete(key);
        this.document.preview.setEditorHiddenNodeIds(hidden);
        this.populateHierarchy();
        this.chrome.setDebugAttribute("data-fairy-editor-hierarchy-hidden", [...hidden].join(","));
        this.setTransientStatus(`${hidden.has(data.nodeId) ? "Hidden" : "Shown"} ${data.nodeId} in the editor.`);
    }

    private toggleAllHierarchyVisibility(): void {
        const component = this.document.getSelectedComponent();
        const key = this.getHierarchyDocumentKey();
        if (!component || !key || component.children.length === 0) return;
        const hidden = this.getHierarchyHiddenNodeIds();
        if (hidden.size > 0) this.hierarchyHiddenNodes.delete(key);
        else this.hierarchyHiddenNodes.set(key, new Set(component.children.map((node) => node.id)));
        const next = this.getHierarchyHiddenNodeIds();
        this.document.preview.setEditorHiddenNodeIds(next);
        this.populateHierarchy();
        this.chrome.setDebugAttribute("data-fairy-editor-hierarchy-hidden", [...next].join(","));
        this.setTransientStatus(next.size > 0 ? "All display nodes hidden in the editor." : "All display nodes shown in the editor.");
    }

    private onHierarchyRelationsDisabledChanged(): void {
        const key = this.getHierarchyDocumentKey();
        if (!key) return;
        const selected = this.chrome.panels.hierarchy.getChild("btnRelationDisabled").asButton.selected;
        selected ? this.hierarchyRelationsDisabled.add(key) : this.hierarchyRelationsDisabled.delete(key);
        this.chrome.setDebugAttribute("data-fairy-editor-hierarchy-relations-disabled", String(selected));
        this.setTransientStatus(`Display-list relations ${selected ? "disabled" : "enabled"} for editor transforms.`);
    }

    private onHierarchyShowAllInvisiblesChanged(): void {
        const key = this.getHierarchyDocumentKey();
        if (!key) return;
        const selected = this.chrome.panels.hierarchy.getChild("btnShowAllInvisibles").asButton.selected;
        selected ? this.hierarchyShowAllInvisibles.add(key) : this.hierarchyShowAllInvisibles.delete(key);
        this.document.preview.setShowAllInvisibleNodes(selected);
        this.chrome.setDebugAttribute("data-fairy-editor-hierarchy-show-invisibles", String(selected));
        this.setTransientStatus(`${selected ? "Showing" : "Respecting"} invisible display nodes in the editor.`);
    }

    private getHierarchySearchVisibleIds(
        component: ProjectSnapshotComponent,
        scopedIds: Set<string>,
    ): Set<string> {
        if (!this.hierarchySearchQuery) return scopedIds;
        const byId = new Map(component.children.map((node) => [node.id, node]));
        const visible = new Set<string>();
        for (const node of component.children) {
            if (!scopedIds.has(node.id)) continue;
            const label = `${node.name || ""} ${node.id}`.toLocaleLowerCase();
            if (!label.includes(this.hierarchySearchQuery)) continue;
            visible.add(node.id);
            let groupId = node.group;
            while (groupId && scopedIds.has(groupId) && !visible.has(groupId)) {
                visible.add(groupId);
                groupId = byId.get(groupId)?.group || "";
            }
        }
        return visible;
    }

    private updateHierarchyToolbarState(component: ProjectSnapshotComponent | null): void {
        const key = this.getHierarchyDocumentKey();
        const hasNodes = Boolean(component?.children.length);
        const hierarchy = this.chrome.panels.hierarchy;
        hierarchy.getChild("status").grayed = !hasNodes;
        hierarchy.getChild("lock").grayed = !hasNodes;
        hierarchy.getChild("rename").grayed = this.document.nodeIds.length !== 1;
        hierarchy.getChild("btnRelationDisabled").asButton.selected = this.hierarchyRelationsDisabled.has(key);
        hierarchy.getChild("btnShowAllInvisibles").asButton.selected = this.hierarchyShowAllInvisibles.has(key);

        const duplicateNames = new Set<string>();
        const seenNames = new Set<string>();
        for (const node of component?.children || []) {
            if (!node.name) continue;
            seenNames.has(node.name) ? duplicateNames.add(node.name) : seenNames.add(node.name);
        }
        const warnings = hierarchy.getChild("warnings");
        warnings.visible = duplicateNames.size > 0;
        warnings.tooltips = duplicateNames.size > 0
            ? `重复名称：${[...duplicateNames].join("、")}`
            : "";
    }

    private selectDuplicateHierarchyNames(): void {
        const component = this.document.getSelectedComponent();
        if (!component) return;
        const groups = new Map<string, string[]>();
        for (const node of component.children) {
            if (!node.name) continue;
            const ids = groups.get(node.name) || [];
            ids.push(node.id);
            groups.set(node.name, ids);
        }
        const duplicate = [...groups.entries()].find(([, ids]) => ids.length > 1);
        if (!duplicate) return;
        this.document.setSelection(duplicate[1], duplicate[1][0]);
        this.events?.documentSelectionChanged();
        this.populateHierarchy();
        this.setTransientStatus(`Selected duplicate display name: ${duplicate[0]}.`);
    }

    private appendHierarchyNodes(
        parent: fgui.GTreeNode,
        component: ProjectSnapshotComponent,
        parentGroupId: string,
        scopedIds: Set<string>,
    ): void {
        for (const child of component.children) {
            if (!scopedIds.has(child.id) || child.group !== parentGroupId) continue;
            const hasChildren = child.type === "GGroup" && component.children.some(
                (candidate) => scopedIds.has(candidate.id) && candidate.group === child.id,
            );
            const node = this.createTreeNode(
                hasChildren,
                `${child.name || child.id} [${child.type}]`,
                DISPLAY_NODE_ICONS[child.type] || "icon_component",
            );
            node.expanded = hasChildren && this.hierarchyExpandedState;
            node.data = {
                kind: "displayNode",
                componentId: component.id,
                nodeId: child.id,
                locked: child.locked,
                hidden: this.getHierarchyHiddenNodeIds().has(child.id),
            } as HierarchyItemData;
            parent.addChild(node);
            if (hasChildren) this.appendHierarchyNodes(node, component, child.id, scopedIds);
        }
    }

    private createTreeNode(hasChildren: boolean, text: string, icon = ""): fgui.GTreeNode {
        const node = new fgui.GTreeNode(hasChildren);
        this.treeInteraction.setNodeLabel(node, text);
        if (icon) this.treeInteraction.setNodeIcon(node, icon);
        return node;
    }

    private createTreeLeaf(text: string, icon = ""): fgui.GTreeNode {
        return this.createTreeNode(false, text, icon);
    }

    private selectCurrentHierarchyNode(tree: fgui.GTree): void {
        if (!this.document.primaryNodeId) return;
        const find = (parent: fgui.GTreeNode): fgui.GTreeNode | null => {
            for (let index = 0; index < parent.numChildren; index += 1) {
                const child = parent.getChildAt(index);
                const data = child.data as HierarchyItemData | null;
                if (data?.nodeId === this.document.primaryNodeId) return child;
                if (child.isFolder) {
                    const nested = find(child);
                    if (nested) return nested;
                }
            }
            return null;
        };
        const selected = find(tree.rootNode);
        if (selected) tree.selectNode(selected, true);
    }

    findResource(packageId: string, resourceId: string): ProjectSnapshotResource | null {
        return this.session.snapshot?.packages.find((pkg) => pkg.id === packageId)
            ?.resources.find((resource) => resource.id === resourceId) || null;
    }

    dispose(): void {
        this.events = null;
        this.displayListActions = null;
        for (const unbind of this.viewUnbinders.splice(0).reverse()) unbind();
        this.library.dispose();
        this.resourcePreview.dispose();
        this.treeInteraction.dispose();
        const trees = [
            this.chrome.panels.library.getChild("treeView").asTree,
            this.chrome.favoritesView.getChild("treeView").asTree,
            this.chrome.panels.hierarchy.getChild("list").asTree,
        ];
        for (const tree of trees) {
            tree.rootNode.removeChildren();
            tree.removeChildrenToPool();
            tree.itemPool.clear();
            tree.treeNodeRender = (_node, cell) => { cell.text = ""; };
        }
        const list = this.chrome.panels.library.getChild("listView").asList;
        list.removeChildrenToPool();
        list.itemPool.clear();
    }
}

export function createProjectExplorerModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.project-explorer",
        hotReloadable: false,
        activate(context) {
            const explorer = new EditorProjectExplorer(
                context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE),
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
                context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE),
            );
            context.provideService(PROJECT_EXPLORER_SERVICE, explorer);
            return () => explorer.dispose();
        },
    };
}
