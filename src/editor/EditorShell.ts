import { findComponent,findDisplayNode,findResource } from "./commands/AuthoringTransactionSupport";
import { EditorCommandAdapter } from "./commands/EditorCommandAdapter";
import { createCommonDisplayNodePropsCommands } from "./commands/DisplayNodePropsLogic";
import {
    ALIGN_TOOLBAR_ACTIONS,
    CUSTOM_ARRANGE_ACTIONS,
    MENU_ITEMS,
    OBJECT_TOOLBAR_ACTIONS,
    PROJECT_SELECTION_STORAGE_KEY,
    TOOLBAR_ACTIONS,
    type EditorActionId,
    type ShellAction,
    type ShellEventListener,
    type ShellEventTarget,
} from "./EditorShellConfig";
import {
    createDisplayNodeClipboard,
    getProjectResourceUrl,
    parseProjectResourceUrl,
    prepareAddPrimitiveDisplayNode,
    prepareAdjustDisplayNodeDepth,
    prepareDetachDisplayNodes,
    prepareGroupDisplayNodes,
    prepareMoveDisplayNode,
    preparePasteDisplayNodes,
    preparePlaceResourceDisplayNode,
    prepareRemoveComponent,
    prepareRenameDisplayNode,
    prepareReplaceDisplayNodes,
    prepareUngroupDisplayNodes,
    queryProjectResourceReferences,
    readComponentProperties,
    type DisplayNodeClipboard,
    type HighRiskTransactionPreparation,
    type PrimitiveDisplayNodeKind,
    type ProjectResourceReference
} from "./commands/HighRiskAuthoringTransactions";
import { requestEditorTextInput } from "./dialogs/EditorDialogs";
import {
    showBrowserPluginDialog as openBrowserPluginDialog,
    showBrowserPluginPanel as openBrowserPluginPanel,
} from "./dialogs/BrowserPluginDialog";
import { showBrowserWorkspaceDialog as openBrowserWorkspaceDialog } from "./dialogs/BrowserWorkspaceDialog";
import type { ExportedControllerDefinition } from "./dialogs/ComponentInstancePropertyEditors";
import { showPreferencesDialog as openPreferencesDialog } from "./dialogs/PreferencesDialog";
import { ProjectImportDialog } from "./dialogs/ProjectImportDialog";
import {
    showProjectSettingsEditor as openProjectSettingsEditor,
    showStringsFunctionDialog as openStringsFunctionDialog,
} from "./dialogs/ProjectSettingsEditor";
import { showPackageGroupsEditor as openPackageGroupsEditor } from "./dialogs/PackageGroupsEditor";
import { showPublishSettingsEditor as openPublishSettingsEditor } from "./dialogs/PublishSettingsEditor";
import { showReplaceObjectDialog as openReplaceObjectDialog } from "./dialogs/ReplaceObjectDialog";
import {
    showResourceHealthDialog as openResourceHealthDialog,
} from "./dialogs/ResourceHealthDialog";
import type {
    BrowserSaveResult,
    BrowserSaveTarget,
    BrowserWorkspaceLifecycleResult,
} from "./model/BrowserWorkspace";
import type {
    ComponentCustomPropertyDefinition,
    EditorCommandOperation,
    EditorCommandResult,
    EditorDisplayNodeSelector,
    EditorHighRiskTransaction,
    EditorResourceSelector,
    SetDisplayNodePropsCommand
} from "./model/EditorCommand";
import type {
    EditorProjectSnapshot,
    ProjectSnapshotComponent,
    ProjectSnapshotDisplayNode,
    ProjectSnapshotPackage,
    ProjectSnapshotResource,
    ProjectSnapshotResourceFolder,
} from "./model/ProjectSnapshot";
import type {
    AuthoringPreviewProjectionPlan,
    ProjectionInvalidation,
} from "./runtime/AuthoringPreviewProjection";
import type { AuthoringRuntimePackageLoadResult } from "./runtime/AuthoringRuntimePackageLoader";
import {
    BrowserPluginHost,
    type BrowserPluginMenuContribution,
    validateBrowserPluginWriteCommands,
} from "./runtime/BrowserPluginHost";
import {
    DEFAULT_BROWSER_WORKSPACE_ID,
    type BrowserWorkspaceRegistryEntry,
} from "./runtime/BrowserWorkspaceRegistry";
import {
    createDesktopCanvasPositionCommands,
    createDesktopCanvasRotationCommands,
    createDesktopCanvasTransformCommands,
    getDesktopCanvasNudge,
    inferDesktopCanvasColumnCount,
    inferDesktopCanvasSpacing,
    resolveDesktopCanvasAlignment,
    resolveDesktopCanvasCustomArrange,
    type DesktopCanvasAlignmentMode,
    type DesktopCanvasCustomArrangeMode,
} from "./runtime/DesktopCanvasInteraction";
import {
    appendDesktopConsoleEntry,
    getDesktopConsoleCopyText,
    type DesktopConsoleEntry,
    type DesktopConsoleLevel,
} from "./runtime/DesktopConsoleLog";
import {
    getDesktopDocumentTabId,
    resolveDesktopReferencedComponentTab,
    type DesktopDocumentTab,
} from "./runtime/DesktopDocumentTabs";
import {
    searchDesktopProject,
    type DesktopProjectSearchResult,
} from "./runtime/DesktopProjectSearch";
import {
    EDITOR_PREFERENCES_STORAGE_KEY,
    createDefaultEditorPreferences,
    parseEditorPreferences,
    resolveEditorShortcut,
    type EditorPreferences,
    type EditorShortcutId,
} from "./runtime/EditorPreferences";
import { PublishedTestController } from "./runtime/PublishedTestController";
import {
    RuntimePreviewController,
    type RuntimePreviewCanvasSettings,
    type RuntimePreviewGraphPoints,
    type RuntimePreviewNodePivot,
    type RuntimePreviewNodePosition,
    type RuntimePreviewNodeRotation,
    type RuntimePreviewNodeTransform,
} from "./runtime/RuntimePreviewController";
import {
    WorkspaceLifecycleController,
    loadBrowserWorkspaceRegistry,
} from "./runtime/WorkspaceLifecycleController";
import { ResourcePreviewController } from "./ui/ResourcePreviewController";
import {
    BrowserLiveSessionBridge,
    type BrowserLiveSessionIdentity,
} from "./services/BrowserLiveSessionBridge";
import {
    type BrowserProjectImportResult
} from "./services/BrowserProjectImport";
import { BrowserProjectStorage } from "./services/BrowserProjectStorage";
import { createDisplayNodeSaveTarget } from "./services/BrowserSaveTargetVerifier";
import { loadProjectSnapshot } from "./services/ProjectSnapshotLoader";
import {
    ActiveDocumentController,
    type ActiveDocumentSelection,
    type PersistedEditorSelection,
} from "./ui/ActiveDocumentController";
import { AuthoringDialogController } from "./ui/AuthoringDialogController";
import { ControllerTimelineAuthoringController } from "./ui/ControllerTimelineAuthoringController";
import {
    DesktopLayoutController,
    type DesktopLeftTopPanelMode,
    type DesktopLayoutPanels as ShellPanels,
} from "./ui/DesktopLayoutController";
import {
    DocumentWorkspaceController,
} from "./ui/DocumentWorkspaceController";
import {
    setActionEnabled as setEditorFormActionEnabled,
} from "./ui/EditorFormControls";
import {
    EditorConsoleItem,
    EditorCustomArrangePanel,
    EditorTextInput,
} from "./ui/EditorUiExtensions";
import {
    EditorMenuController,
    type EditorMenuCommand,
} from "./ui/EditorMenuController";
import {
    InspectorController,
    type InspectorPanelAction,
} from "./ui/InspectorController";
import {
    describeAuthoringPreviewProjection,
    getBrowserSaveFailure,
    getWorkspaceLifecycleFailure,
} from "./ui/InspectorPresentation";
import {
    LibraryController,
    type LibraryResourceFolderSelector,
} from "./ui/LibraryController";
import {
    ProjectTreeInteractionController,
    type HierarchyDragState,
    type HierarchyDropTarget,
    type HierarchyItemData,
    type LibraryDragState,
    type LibraryItemData,
} from "./ui/ProjectTreeInteractionController";
import { ResourceAuthoringController } from "./ui/ResourceAuthoringController";

let pendingEditorShellDisposal: Promise<void> = Promise.resolve();

const EDITOR_REPOSITORY_URL = "https://github.com/OpenFairyGUI/FairyGUI-Editor-Online";
const FAIRYGUI_WEBSITE_URL = "https://fairygui.com/";

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

export class EditorShell {
    private readonly mainView: fgui.GComponent;
    private readonly holder: fgui.GObject;
    private readonly menuBar: fgui.GComponent;
    private readonly toolbar: fgui.GComponent;
    private readonly startScene: fgui.GComponent;
    private readonly statusLine: fgui.GButton;
    private readonly panels: ShellPanels;
    private readonly inspectorCommandPanel: InspectorController;
    private readonly libraryDock: fgui.GComponent;
    private readonly hierarchyDock: fgui.GComponent;
    private readonly favoritesView: fgui.GComponent;
    private readonly searchView: fgui.GComponent;
    private readonly searchInput: fgui.GTextInput;
    private readonly referenceView: fgui.GComponent;
    private readonly referenceInput: fgui.GTextInput;
    private readonly transitionListView: fgui.GComponent;
    private readonly testView: fgui.GComponent;
    private readonly publishedTest: PublishedTestController;
    private readonly panelList: fgui.GComponent[];
    private readonly timelineView: fgui.GComponent;
    private readonly controllerTimeline: ControllerTimelineAuthoringController;
    private readonly consoleView: fgui.GComponent;
    private readonly runtimePreview: RuntimePreviewController;
    private readonly resourcePreview: ResourcePreviewController;
    private readonly commandAdapter = new EditorCommandAdapter();
    private readonly initialWorkspaceRegistry = loadBrowserWorkspaceRegistry();
    private readonly projectStorage = new BrowserProjectStorage(
        this.initialWorkspaceRegistry.activeId,
        this.initialWorkspaceRegistry.entries.find(
            (entry) => entry.id === this.initialWorkspaceRegistry.activeId,
        )?.fairyPath,
    );
    private readonly browserPluginHost = new BrowserPluginHost();
    private readonly liveSessionBridge = new BrowserLiveSessionBridge(this.projectStorage);
    private readonly workspaceLifecycle = new WorkspaceLifecycleController(
        this.liveSessionBridge,
        this.projectStorage,
        this.initialWorkspaceRegistry,
    );
    private readonly projectImportDialog: ProjectImportDialog;
    private projectSnapshot: EditorProjectSnapshot | null = null;
    private actionMenu: fgui.PopupMenu | null = null;
    private readonly actionUnbinders: Array<() => void> = [];
    private readonly editorActions = new Map<EditorActionId, () => void>();
    private commandLastResult: EditorCommandResult | null = null;
    private authoringJsonDialog: fgui.Window | null = null;
    private editorPreferences: EditorPreferences = createDefaultEditorPreferences();
    private readonly documentWorkspace: DocumentWorkspaceController;
    private readonly activeDocument: ActiveDocumentController;
    private readonly desktopLayout: DesktopLayoutController;
    private readonly libraryController: LibraryController;
    private readonly authoringDialogs: AuthoringDialogController;
    private readonly resourceAuthoring: ResourceAuthoringController;
    private readonly editorMenus: EditorMenuController;
    private hierarchyExpanded = true;
    private hierarchyKeyboardActive = false;
    private hierarchySearchQuery = "";
    private readonly hierarchyHiddenNodes = new Map<string, Set<string>>();
    private readonly hierarchyRelationsDisabled = new Set<string>();
    private readonly hierarchyShowAllInvisibles = new Set<string>();
    private readonly treeInteraction: ProjectTreeInteractionController;
    private authoringOperationQueue: Promise<void> = Promise.resolve();
    private desktopSnapEnabled = false;
    private canvasSettings: RuntimePreviewCanvasSettings = {
        backgroundColor: "#666666",
        canvasColor: "#999999",
        componentEdge: true,
        alignmentGuides: true,
        showGrid: false,
        gridSize: 8,
        gridBrightness: 30,
    };
    private canvasPerDocumentZoom = false;
    private readonly canvasViewByDocument = new Map<string, { zoom: number; panX: number; panY: number }>();
    private readonly modifiedPackageIds = new Set<string>();
    private desktopPanToolEnabled = false;
    private desktopObjectTool: PrimitiveDisplayNodeKind | null = null;
    private libraryLinked = false;
    private activeBranch = "";
    private activeLanguagePath = "";
    private displayNodeClipboard: DisplayNodeClipboard | null = null;
    private searchResults: DesktopProjectSearchResult[] = [];
    private consoleEntries: DesktopConsoleEntry[] = [];
    private customArrangePanel: EditorCustomArrangePanel | null = null;
    private customArrangeSelectionIds: string[] = [];
    private disposed = false;

    private get leftDockVisible(): boolean { return this.desktopLayout.leftDockVisible; }
    private set leftDockVisible(value: boolean) { this.desktopLayout.leftDockVisible = value; }
    private get leftTopPanelMode(): DesktopLeftTopPanelMode { return this.desktopLayout.leftTopPanelMode; }
    private set leftTopPanelMode(value: DesktopLeftTopPanelMode) { this.desktopLayout.leftTopPanelMode = value; }
    private get timelineVisible(): boolean { return this.desktopLayout.timelineVisible; }
    private set timelineVisible(value: boolean) { this.desktopLayout.timelineVisible = value; }
    private get consoleVisible(): boolean { return this.desktopLayout.consoleVisible; }
    private set consoleVisible(value: boolean) { this.desktopLayout.consoleVisible = value; }
    private get libraryPackageId(): string { return this.libraryController.packageId; }
    private set libraryPackageId(value: string) { this.libraryController.setPackageId(value); }
    private get selectedLibraryResourceSelectors(): EditorResourceSelector[] {
        return this.libraryController.resourceSelectors;
    }
    private set selectedLibraryResourceSelectors(value: EditorResourceSelector[]) {
        this.libraryController.setResourceSelection(value);
    }
    private get selectedPackageId(): string { return this.activeDocument.packageId; }
    private get selectedComponentId(): string { return this.activeDocument.componentId; }
    private get selectedDisplayNodeId(): string { return this.activeDocument.primaryNodeId; }
    private get selectedDisplayNodeIds(): string[] { return this.activeDocument.nodeIds; }
    private get selectedResourceFolder(): LibraryResourceFolderSelector | null {
        const selection = this.libraryController.getInspectorSelection();
        return selection?.kind === "folder" ? selection : null;
    }

    constructor(mainView: fgui.GComponent) {
        this.mainView = mainView;
        this.projectImportDialog = new ProjectImportDialog(mainView, {
            applyImport: (picked, label) => this.applyProjectImport(picked, label),
            onError: (label, error) => this.renderWorkspaceImportError(label, error),
            pickDirectory: () => this.workspaceLifecycle.pickDirectoryProject(),
            pickZip: () => this.workspaceLifecycle.pickZipProject(),
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
            setStatus: (message) => this.setStatus(message),
            showWorkspace: () => this.showEditorWorkspace(),
        });
        this.holder = this.requireChild(mainView, "holder");
        this.menuBar = this.requireChild(mainView, "menuBar").asCom;
        this.toolbar = this.requireChild(mainView, "toolbar").asCom;
        this.startScene = this.requireChild(mainView, "startScene").asCom;
        this.statusLine = this.requireChild(mainView, "logItem").asButton;
        this.panels = this.createPanels();
        this.inspectorCommandPanel = new InspectorController(
            this.panels.inspector.getChild("list").asList,
            (action) => this.onInspectorPanelAction(action),
            (name, value) => this.setDebugAttribute(name, value),
        );
        this.documentWorkspace = new DocumentWorkspaceController(this.panels.document, {
            activateDocument: (documentTab) => this.activateDocumentFromTab(documentTab),
            closeDocument: (documentTab, event) => this.onDocumentTabClose(documentTab, event),
            changeGroupPathDepth: (targetDepth) => this.changeGroupPathDepth(targetDepth),
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
        });
        this.activeDocument = new ActiveDocumentController(
            this.documentWorkspace,
            (name, value) => this.setDebugAttribute(name, value),
        );
        this.favoritesView = this.createPanel("FavoritesView", "desktopFavoritesView");
        this.favoritesView.visible = false;
        this.mainView.addChild(this.favoritesView);
        this.searchView = this.createPanel("SearchView", "desktopSearchView");
        this.searchView.visible = false;
        this.mainView.addChild(this.searchView);
        this.searchInput = (this.searchView.getChild("keyword") as EditorTextInput).input;
        this.libraryDock = this.createLibraryDock();
        this.hierarchyDock = this.createHierarchyDock();
        this.referenceView = this.createPanel("ReferenceView", "desktopReferenceView");
        this.referenceView.visible = false;
        this.referenceView.getController("c1").selectedIndex = 0;
        this.referenceView.getChild("showReplace").visible = false;
        this.mainView.addChild(this.referenceView);
        this.referenceInput = (this.referenceView.getChild("source") as EditorTextInput).input;
        this.transitionListView = this.createPanel("TransitionListView", "desktopTransitionListView");
        this.transitionListView.visible = false;
        this.transitionListView.getChild("list").asList.selectionMode = fgui.ListSelectionMode.Single;
        this.mainView.addChild(this.transitionListView);
        this.testView = this.createPanel("TestView", "desktopTestView");
        this.testView.visible = false;
        this.mainView.addChild(this.testView);
        this.publishedTest = new PublishedTestController(this.testView, {
            getSelectedPackage: () => this.getSelectedPackage(),
            getSelectedComponent: () => this.getSelectedComponent(),
            getSelectedComponentSelector: () => this.getSelectedComponentSelector(),
            getWorkingProject: () => this.liveSessionBridge.getWorkingProject(),
            isDirty: () => this.commandAdapter.getSessionState().dirty,
            requiresRuntimePublish: () => this.runtimePreview.requiresRuntimePublish(),
            setToolbarActive: (active) => { this.toolbar.getController("test").selectedIndex = active ? 1 : 0; },
            requestLayout: () => this.layout(),
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
            setStatus: (message) => this.setStatus(message),
        });
        this.panelList = [
            this.libraryDock,
            this.referenceView,
            this.transitionListView,
            this.panels.document,
            this.testView,
            this.panels.preview,
            this.hierarchyDock,
            this.panels.inspector,
        ];
        this.timelineView = this.createPanel("TimelineView", "desktopTimelineView");
        this.timelineView.visible = false;
        this.panels.document.addChild(this.timelineView);
        this.authoringDialogs = new AuthoringDialogController({
            eventOwner: this,
            getWorkingProject: () => this.liveSessionBridge.getWorkingProject(),
            getProjectSnapshot: () => this.projectSnapshot,
            getSelectedPackage: () => this.getLibraryActionPackage(),
            getSelectedComponent: () => this.getLibraryActionComponent(),
            getSelectedResource: () => this.getSelectedResource(),
            getSelectedDisplayNode: () => this.getSelectedDisplayNode(),
            getSelectedDisplayNodeSelector: () => this.getSelectedDisplayNodeSelector(),
            getSelectedComponentSelector: () => this.getLibraryActionComponentSelector(),
            getSelectedControllerName: () => this.controllerTimeline.selectedControllerName,
            setSelectedControllerName: (name) => { this.controllerTimeline.selectedControllerName = name; },
            getSelectedTransitionName: () => this.controllerTimeline.selectedTransitionName,
            isLiveSession: () => this.commandAdapter.getSessionState().liveSession,
            getCustomPropertyDefinitions: () => this.getSelectedComponentCustomPropertyDefinitions(),
            getExportedControllers: () => this.getSelectedComponentExportedControllers(),
            applyDisplayNodeCommand: (command, summary) => this.applyDisplayNodePropsCommand(command, summary),
            setGraphPointEditing: (enabled, shapeLocked) => this.runtimePreview.setGraphPointEditing(enabled, shapeLocked),
            isGraphPointEditing: () => this.runtimePreview.isGraphPointEditing(),
            isGraphShapeLocked: () => this.runtimePreview.isGraphShapeLocked(),
            applyPreparation: (preparation) => this.applyAuthoringPreparation(preparation),
            download: (blob, fileName) => this.downloadWorkspaceExport(blob, fileName),
            activateDocument: (packageId, componentId) => this.activateDocumentTab({ packageId, componentId }),
            onTimelineItemApplied: (itemIndex) => {
                this.controllerTimeline.setSelectedTimelineItemIndex(itemIndex);
                this.controllerTimeline.populateTimeline();
            },
            createActionMenu: () => this.createActionMenu(),
            addMenuItem: (menu, name, title, handler) => this.addMenuItem(menu, name, title, handler),
            setStatus: (message) => this.setStatus(message),
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
        });
        this.resourceAuthoring = new ResourceAuthoringController({
            liveSessionBridge: this.liveSessionBridge,
            dialogs: this.authoringDialogs,
            isLiveSession: () => this.commandAdapter.getSessionState().liveSession,
            getSelectedPackage: () => this.getLibraryActionPackage(),
            getSelectedComponent: () => this.getLibraryActionComponent(),
            getSelectedResource: () => this.getSelectedResource(),
            getSelectedResourceFolder: () => this.getSelectedResourceFolder(),
            getPackages: () => this.projectSnapshot?.packages || [],
            getSelectedComponentSelector: () => this.getLibraryActionComponentSelector(),
            getSelectedResourceFolderSelector: () => this.selectedResourceFolder,
            setSelectedResourceFolderSelector: (selector) => {
                this.libraryController.setInspectorSelection(selector ? { kind: "folder", ...selector } : null);
            },
            getSelectedPackageId: () => this.selectedPackageId,
            getLibraryPackageId: () => this.libraryPackageId,
            setLibraryPackageId: (packageId) => { this.libraryPackageId = packageId; },
            getSelectedLibraryResourceSelectors: () => this.libraryController.getSelectedResourceSelectors(this.leftTopPanelMode),
            applyPreparation: (preparation, identity) => this.applyAuthoringPreparation(preparation, identity),
            applyLibrarySelection: (data, preserve) => this.applyLibrarySelection(data, preserve),
            refreshProjectViews: () => this.refreshProjectViews(),
            createActionMenu: () => this.createActionMenu(),
            addMenuItem: (menu, name, title, handler) => this.addMenuItem(menu, name, title, handler),
            showActionMenu: (menu, anchor, source, status) => this.showActionMenu(menu, anchor, source, status),
            showSelectedResourceInspector: () => this.showSelectedResourceInspector(),
            showProjectReferences: () => this.showProjectReferencesForCurrentSelection(),
            removeSelectedComponent: () => this.requestAuthoringRemoveComponent(),
            runEditorAction: (action) => this.runEditorAction(action),
            download: (blob, fileName) => this.downloadWorkspaceExport(blob, fileName),
            setStatus: (message, level) => this.setStatus(message, level),
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
        });
        this.editorMenus = new EditorMenuController({
            getState: () => ({
                canUndo: this.commandAdapter.canUndo(),
                canRedo: this.commandAdapter.canRedo(),
                shortcuts: this.editorPreferences.shortcuts,
                selectedNodeCount: this.selectedDisplayNodeIds.length,
                canPaste: Boolean(this.displayNodeClipboard && this.getSelectedComponent()),
                hasSelectedComponent: Boolean(this.getSelectedComponent()),
                selectedNodeIsGroup: this.getSelectedDisplayNode()?.type === "GGroup",
                groupDepth: this.getActiveGroupPath().length,
                canShowInLibrary: Boolean(this.getSelectedDisplayNodeResourceSelector()),
                timelineVisible: this.timelineVisible,
                selectedTransition: Boolean(this.controllerTimeline.selectedTransitionName),
                selectedTimelineItem: this.controllerTimeline.getSelectedTimelineItemIndex() >= 0,
                hierarchyExpanded: this.hierarchyExpanded,
                leftTopPanelMode: this.leftTopPanelMode,
                leftDockVisible: this.leftDockVisible,
                inspectorDockVisible: this.desktopLayout.inspectorDockVisible,
                consoleVisible: this.consoleVisible,
                documentCount: this.documentWorkspace.count,
                hasActiveDocument: Boolean(this.getActiveDocumentTab()),
                hasReferencedComponent: Boolean(this.getReferencedComponentTab()),
            }),
            run: (command) => this.runEditorMenuCommand(command),
            createMenu: () => this.createActionMenu(),
            addItem: (menu, name, title, handler, shortcut) => this.addMenuItem(
                menu,
                name,
                title,
                handler,
                shortcut,
            ),
            setEnabled: setEditorFormActionEnabled,
            showMenu: (menu, anchor, source, status) => this.showActionMenu(menu, anchor, source, status),
            setStatus: (message) => this.setTransientStatus(message),
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
        });
        this.consoleView = this.createPanel("ConsoleView", "desktopConsoleView");
        this.consoleView.visible = false;
        this.panels.document.addChild(this.consoleView);
        this.populateDesktopConsole();
        this.desktopLayout = new DesktopLayoutController({
            mainView: this.mainView,
            holder: this.holder,
            startScene: this.startScene,
            statusLine: this.statusLine,
            panels: this.panels,
            libraryDock: this.libraryDock,
            hierarchyDock: this.hierarchyDock,
            favoritesView: this.favoritesView,
            searchView: this.searchView,
            referenceView: this.referenceView,
            transitionListView: this.transitionListView,
            timelineView: this.timelineView,
            consoleView: this.consoleView,
            testView: this.testView,
            getComponentPreviewEnabled: () => this.editorPreferences.componentPreviewEnabled,
            getSelectedTransitionName: () => this.controllerTimeline.selectedTransitionName,
            getWorkspaceName: () => this.projectStorage.getWorkspaceName(),
            isTestActive: () => this.publishedTest.isActive(),
            afterLayout: () => {
                this.publishedTest.layout();
                this.runtimePreview.layout();
                this.layoutInspectorLines();
                this.projectImportDialog.layout();
            },
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
            setStatus: (message) => this.setStatus(message),
        });
        this.resourcePreview = new ResourcePreviewController(
            this.panels.preview,
            () => this.liveSessionBridge.getWorkingProject(),
            (projectId, packageName, componentName) => this.runtimePreview.createLibraryComponentPreview(
                projectId,
                packageName,
                componentName,
            ),
            () => this.editorPreferences.componentPreviewEnabled,
            (enabled) => this.updateEditorPreferences({
                ...this.editorPreferences,
                componentPreviewEnabled: enabled,
            }),
            (name, value) => this.setDebugAttribute(name, value),
            (message) => this.setStatus(message),
        );
        this.treeInteraction = new ProjectTreeInteractionController(
            this.mainView,
            this.panels.library.getChild("listView").asList,
            this.panels.hierarchy.getChild("list").asTree,
            {
                getSelectedPackageId: () => this.selectedPackageId,
                getSelectedComponentId: () => this.selectedComponentId,
                getSelectedPackage: () => this.getSelectedPackage(),
                getSelectedComponent: () => this.getSelectedComponent(),
                findResourceType: (packageId, resourceId) => this.findResource(packageId, resourceId)?.type || "",
                isComponentExported: (packageId, componentId) => (
                    this.findResource(packageId, componentId)?.exported
                    ?? this.projectSnapshot?.packages.find((pkg) => pkg.id === packageId)
                        ?.components.find((component) => component.id === componentId)?.exported
                    ?? false
                ),
                showLibraryContextMenu: (cell, data) => this.showLibraryContextMenu(cell, data),
                showHierarchyContextMenu: (cell, data) => this.showHierarchyContextMenu(cell, data),
                openLibraryItem: (data) => this.openLibraryItem(data),
                resolveAuthoringDropPoint: (stageX, stageY) => this.runtimePreview.resolveAuthoringDropPoint(stageX, stageY),
                selectHierarchyNode: (data) => this.selectHierarchyDragNode(data),
                toggleHierarchyNodeLock: (data) => this.toggleHierarchyNodeLock(data),
                toggleHierarchyNodeHidden: (data) => this.toggleHierarchyNodeHidden(data),
                applyLibraryDrop: (state, point) => this.applyLibraryDrop(state, point),
                applyHierarchyDrop: (state, target) => this.applyHierarchyDrop(state, target),
                setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
                setStatus: (message) => this.setStatus(message),
            },
        );
        this.libraryController = new LibraryController(
            this.panels.library,
            this.favoritesView,
            this.treeInteraction,
            {
                getSnapshot: () => this.projectSnapshot,
                getSelectedPackageId: () => this.selectedPackageId,
                getWorkingProject: () => this.liveSessionBridge.getWorkingProject(),
                editPackageGroups: () => this.showPackageGroupsEditor(),
                applySelection: (data, preserveResourceSelection) => {
                    this.applyLibrarySelection(data, preserveResourceSelection);
                },
                clearSelection: () => {
                    this.clearResourceSelection();
                    this.populateInspectorFromSnapshot();
                    this.layoutInspectorLines();
                },
                setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
                setStatus: (message) => this.setStatus(message),
                onViewStateChanged: () => this.saveResourceViewState(),
            },
        );
        this.restoreEditorPreferences();
        this.restoreDesktopLayoutState();
        this.restoreResourceViewState();
        const documentContainer = this.requireChild(this.panels.document, "docContainer").asCom;
        this.runtimePreview = new RuntimePreviewController(
            documentContainer,
            documentContainer,
            (nodeIds, primaryNodeId) => this.onPreviewNodesSelected(nodeIds, primaryNodeId),
            null,
            (result) => this.onRuntimePreviewPackageLoad(result),
            this.projectStorage,
            (positions) => this.commitPreviewNodePositions(positions),
            (transforms) => this.commitPreviewNodeTransforms(transforms),
            (transforms) => this.commitPreviewNodeRotations(transforms),
            (transform) => this.commitPreviewNodePivot(transform),
            (transform) => this.commitPreviewGraphPoints(transform),
            (zoom, panX, panY) => this.onPreviewViewChanged(zoom, panX, panY),
            (point) => this.placeDesktopPrimitive(point),
            (nodeId) => this.openSelectedGroup(nodeId) || this.openReferencedComponent(nodeId),
            () => this.editorMenus.showCanvasContextMenu(),
        );
        this.controllerTimeline = new ControllerTimelineAuthoringController({
            documentView: this.panels.document,
            transitionListView: this.transitionListView,
            timelineView: this.timelineView,
            liveSessionBridge: this.liveSessionBridge,
            runtimePreview: this.runtimePreview,
            dialogs: this.authoringDialogs,
            isLiveSession: () => this.commandAdapter.getSessionState().liveSession,
            getSelectedComponentSelector: () => this.getSelectedComponentSelector(),
            getSelectedComponent: () => this.getSelectedComponent(),
            getSelectedDisplayNodeId: () => this.selectedDisplayNodeId,
            applyPreparation: (preparation, identity) => this.applyAuthoringPreparation(preparation, identity),
            getTimelineVisible: () => this.timelineVisible,
            setTimelineVisible: (visible) => { this.timelineVisible = visible; },
            setConsoleVisible: (visible) => { this.consoleVisible = visible; },
            getLeftDockVisible: () => this.leftDockVisible,
            setLeftDockVisible: (visible) => { this.leftDockVisible = visible; },
            setLeftTopPanelMode: (mode) => { this.leftTopPanelMode = mode; },
            showEditorWorkspace: () => this.showEditorWorkspace(),
            layout: () => this.layout(),
            saveLayout: () => this.saveDesktopLayoutState(),
            setStatus: (message) => this.setStatus(message),
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
        });
        this.commandAdapter.setLiveSessionRuntime(this.liveSessionBridge);

        this.configureMainViewControllers();
        this.populateStaticData();
        this.registerEditorActions();
        this.bindActions();
        this.configureToolbarCapabilities();
        this.layout();
        const priorDisposal = pendingEditorShellDisposal;
        void this.enqueueAuthoringOperation(async () => {
            await priorDisposal;
            return this.disposed ? false : this.initializeProjectSnapshotNow();
        });

        Laya.stage.on(Laya.Event.RESIZE, this, this.onStageResize);
        Laya.stage.on(Laya.Event.MOUSE_DOWN, this, this.onStageMouseDown);
        Laya.stage.on(Laya.Event.KEY_DOWN, this, this.onStageKeyDown);
        Laya.stage.on(Laya.Event.KEY_UP, this, this.onStageKeyUp);
        void this.initializeBrowserPlugins();
        this.setStatus("Loading project snapshot.");
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
        Laya.stage.off(Laya.Event.MOUSE_DOWN, this, this.onStageMouseDown);
        Laya.stage.off(Laya.Event.KEY_DOWN, this, this.onStageKeyDown);
        Laya.stage.off(Laya.Event.KEY_UP, this, this.onStageKeyUp);
        this.controllerTimeline.dispose();
        this.documentWorkspace.dispose();
        this.unbindActions();
        const closeLiveSession = this.authoringOperationQueue.then(() => this.liveSessionBridge.reset());
        pendingEditorShellDisposal = closeLiveSession.then(
            (): void => {},
            (): void => {},
        );
        this.authoringOperationQueue = pendingEditorShellDisposal;
        void closeLiveSession.then((result) => {
            if (!result.ok) console.warn("[Editor Session] dispose could not close the live session", result);
        }).catch((error) => {
            console.warn("[Editor Session] dispose failed to close the live session", error);
        });
        this.projectImportDialog.close();
        this.browserPluginHost.dispose();
        this.authoringDialogs.dispose();
        this.actionMenu?.dispose();
        this.actionMenu = null;
        this.customArrangePanel?.dispose();
        this.customArrangePanel = null;
        this.inspectorCommandPanel.clear();
        this.publishedTest.dispose();
        this.runtimePreview.dispose();
        this.resourcePreview.dispose();
        this.desktopLayout.dispose();
        this.treeInteraction.dispose();
        for (const panel of this.panelList) {
            if (panel.parent) {
                this.mainView.removeChild(panel, true);
            }
        }
    }

    layout(): void {
        if (this.disposed) return;
        this.desktopLayout.layout();
    }

    private createPanels(): ShellPanels {
        const panels: ShellPanels = {
            library: this.createPanel("LibraryView", "projectLibraryView"),
            document: this.createPanel("DocumentView", "projectDocumentView"),
            preview: this.createPanel("PreviewView", "projectPreviewView"),
            hierarchy: this.createPanel("HierarchyView", "projectHierarchyView"),
            inspector: this.createPanel("InspectorView", "projectInspectorView"),
        };

        for (const panel of [
            panels.library,
            panels.document,
            panels.preview,
            panels.hierarchy,
            panels.inspector,
        ]) {
            this.mainView.addChild(panel);
        }

        return panels;
    }

    private cancelDockSplitterDrag(restore: boolean): boolean {
        return this.desktopLayout.cancelSplitterDrag(restore);
    }

    private toggleDesktopDock(dock: "left" | "inspector"): void {
        this.desktopLayout.toggleDock(dock);
    }

    private getWorkspaceLocalStorageKey(key: string): string {
        return `${key}:${this.projectStorage.getWorkspaceName()}`;
    }

    private readWorkspaceLocalStorage(key: string): string | null {
        const scoped = localStorage.getItem(this.getWorkspaceLocalStorageKey(key));
        if (scoped !== null) return scoped;
        return this.projectStorage.getWorkspaceName() === DEFAULT_BROWSER_WORKSPACE_ID
            ? localStorage.getItem(key)
            : null;
    }

    private saveResourceViewState(): void {
        try {
            localStorage.setItem(this.getWorkspaceLocalStorageKey("fairygui-editor-online.resource-view.v1"), JSON.stringify({
                ...this.libraryController.getViewState(),
                linked: this.libraryLinked,
                branch: this.activeBranch,
                language: this.activeLanguagePath,
                canvas: this.canvasSettings,
                canvasPerDocumentZoom: this.canvasPerDocumentZoom,
                snapToGrid: this.desktopSnapEnabled,
            }));
        } catch {
            // View preferences are optional and never block authoring.
        }
    }

    private restoreResourceViewState(): void {
        try {
            const raw = this.readWorkspaceLocalStorage("fairygui-editor-online.resource-view.v1");
            const state = raw ? JSON.parse(raw) as Record<string, unknown> : {};
            this.libraryController.restoreViewState(state);
            this.libraryLinked = state.linked === true;
            this.activeBranch = typeof state.branch === "string" ? state.branch : "";
            this.activeLanguagePath = typeof state.language === "string" ? state.language : "";
            if (state.canvas && typeof state.canvas === "object") this.canvasSettings = {
                ...this.canvasSettings,
                ...state.canvas as Partial<RuntimePreviewCanvasSettings>,
            };
            this.canvasPerDocumentZoom = state.canvasPerDocumentZoom === true;
            this.desktopSnapEnabled = state.snapToGrid === true;
            this.panels.library.getChild("btnSync").asButton.selected = this.libraryLinked;
            const slider = this.panels.library.getChild("iconSize").asCom.getChild("slider").asSlider;
            slider.value = this.libraryController.getViewState().iconSizeStep;
            this.runtimePreview?.setCanvasSettings(this.canvasSettings);
            this.runtimePreview?.setSnapEnabled(this.desktopSnapEnabled, this.canvasSettings.gridSize);
        } catch {
            this.libraryController.restoreViewState({});
        }
    }

    private restoreDesktopLayoutState(): void {
        this.desktopLayout.restore();
    }

    private saveDesktopLayoutState(): void {
        this.desktopLayout.save();
    }

    private applyDefaultDesktopLayoutState(): void {
        this.desktopLayout.applyDefaults();
    }

    private resetDesktopLayout(): void {
        this.desktopLayout.reset();
    }

    private restoreEditorPreferences(): void {
        try {
            this.editorPreferences = parseEditorPreferences(
                localStorage.getItem(EDITOR_PREFERENCES_STORAGE_KEY),
            );
        } catch {
            this.editorPreferences = createDefaultEditorPreferences();
        }
    }

    private updateEditorPreferences(preferences: EditorPreferences): void {
        this.editorPreferences = preferences;
        try {
            localStorage.setItem(EDITOR_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
        } catch {
            // Preferences persistence is optional and must not block authoring.
        }
        this.layout();
        this.setStatus("Editor preferences saved in this browser.");
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

    private configureMainViewControllers(): void {
        this.mainView.getController("start").selectedIndex = 0;
        this.mainView.getController("menu").selectedIndex = 0;
        this.startScene.visible = false;
        this.statusLine.visible = true;
        this.mainView.getChild("userInfo").visible = false;
        this.toolbar.getChild("tbImport").tooltips = "导入项目";
        this.startScene.getChild("n3").asRichTextField.text = "[url=create]创建浏览器工作区[/url]";
        this.startScene.getChild("n4").asRichTextField.text = "[url=open]导入项目...[/url]";
        this.startScene.getChild("n5").asRichTextField.text = "[url=open_folder]从文件夹导入...[/url]";

        const viewScale = this.toolbar.getChild("viewScale").asComboBox;
        viewScale.items = ["50%", "75%", "100%", "125%", "150%", "200%"];
        viewScale.values = ["0.5", "0.75", "1", "1.25", "1.5", "2"];
        viewScale.selectedIndex = 2;

        this.refreshToolbarSettingsSelectors();
        this.toolbar.getController("test").selectedIndex = 0;
    }

    private refreshToolbarSettingsSelectors(): void {
        const project = this.liveSessionBridge.getWorkingProject() as {
            branches?: string[];
            settings?: { i18n?: { langFiles?: Array<{ name?: string; path?: string }> } };
        } | null;
        const branches = this.toolbar.getChild("branches").asComboBox;
        branches.items = ["main", ...(project?.branches || [])];
        branches.values = ["", ...(project?.branches || [])];
        if (!branches.values.includes(this.activeBranch)) this.activeBranch = "";
        branches.selectedIndex = Math.max(0, branches.values.indexOf(this.activeBranch));
        this.libraryController?.setActiveBranch(this.activeBranch);
        const languageFiles = project?.settings?.i18n?.langFiles || [];
        const lang = this.toolbar.getChild("lang").asComboBox;
        lang.items = ["default", ...languageFiles.map((item) => item.name || item.path || "language")];
        lang.values = ["", ...languageFiles.map((item) => item.path || item.name || "")];
        if (!lang.values.includes(this.activeLanguagePath)) this.activeLanguagePath = "";
        lang.selectedIndex = Math.max(0, lang.values.indexOf(this.activeLanguagePath));
        this.setDebugAttribute("data-fairy-editor-branches", branches.values.join(","));
        this.setDebugAttribute("data-fairy-editor-languages", lang.values.join(","));
    }

    private openProjectSettingsDialog(): void {
        openProjectSettingsEditor({
            getWorkingProject: () => this.liveSessionBridge.getWorkingProject(),
            getActiveDialog: () => this.authoringJsonDialog,
            setActiveDialog: (dialog) => { this.authoringJsonDialog = dialog; },
            applyPreparation: (preparation) => this.applyAuthoringPreparation(preparation),
            applyDisplayNodeCommands: (commands, summary) => this.applyDisplayNodePropsCommands(commands, summary),
            download: (blob, fileName) => this.downloadWorkspaceExport(blob, fileName),
            runWorkspaceTextFileTask: async (task) => {
                await this.enqueueAuthoringOperation(async () => {
                    const state = await this.projectStorage.initialize();
                    const adapter = this.projectStorage.getAdapter();
                    if (!state.available || !adapter) {
                        throw new Error(state.error || "Browser workspace storage is unavailable.");
                    }
                    await task({
                        read: async (path) => await adapter.exists(path) ? await adapter.readFile(path) : null,
                        write: (path, content) => adapter.writeFile(path, content),
                    });
                });
            },
            setStatus: (message) => this.setStatus(message),
            eventOwner: this,
        });
    }

    private showPackageGroupsEditor(): void {
        openPackageGroupsEditor({
            getWorkingProject: () => this.liveSessionBridge.getWorkingProject(),
            getPackages: () => this.projectSnapshot?.packages || [],
            getLocalPackageIds: () => this.libraryController.getLocalPackageIds(),
            setLocalPackageIds: (ids) => {
                this.libraryController.setLocalPackageIds(ids);
                this.populateLibraryFromSnapshot();
            },
            getActiveDialog: () => this.authoringJsonDialog,
            setActiveDialog: (dialog) => { this.authoringJsonDialog = dialog; },
            applyPreparation: (preparation) => this.applyAuthoringPreparation(preparation),
            setStatus: (message) => this.setStatus(message),
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
            eventOwner: this,
        });
    }

    private populateStaticData(): void {
        this.populateMenuBar();
        this.populateFallbackLibrary();
        this.populateFallbackDocument();
        this.populateFallbackPreview();
        this.populateFallbackHierarchy();
        this.renderInspectorLines(["正在打开项目…"]);
    }

    private populateMenuBar(): void {
        const menuList = this.menuBar.getChild("list").asList;
        menuList.removeChildrenToPool();

        for (const itemDef of MENU_ITEMS) {
            const item = menuList.addItemFromPool().asButton;
            item.title = itemDef.title;
            item.data = itemDef.action;
            this.listenClick(item, this.onMenuItemClick, [item]);
        }
    }

    private configureToolbarCapabilities(): void {
        const packageButton = this.toolbar.getChild("tbCreatePkg");
        packageButton.grayed = false;
        packageButton.touchable = true;
        packageButton.tooltips = "Add an empty package.";
        const componentButton = this.toolbar.getChild("tbCreateCom");
        componentButton.grayed = false;
        componentButton.touchable = true;
        componentButton.tooltips = "Add an empty component to the selected package.";
        const buttonButton = this.toolbar.getChild("tbCreateButton");
        buttonButton.grayed = false;
        buttonButton.touchable = true;
        buttonButton.tooltips = "Create a Button component in the selected package.";
        const labelButton = this.toolbar.getChild("tbCreateLabel");
        labelButton.grayed = false;
        labelButton.touchable = true;
        labelButton.tooltips = "Create a Label component in the selected package.";
        for (const [childName, templateName] of [
            ["tbCreateComboBox", "ComboBox"],
            ["tbCreateProgressBar", "ProgressBar"],
            ["tbCreateSlider", "Slider"],
        ] as const) {
            const button = this.toolbar.getChild(childName);
            button.grayed = false;
            button.touchable = true;
            button.tooltips = `Create a ${templateName} component in the selected package.`;
        }
        for (const [childName, tooltip] of [
            ["tbCreateFont", "使用 FNT 和纹理新建位图字体"],
            ["tbCreateMc", "使用图片序列、GIF 或 Sprite Sheet 新建动画"],
        ] as const) {
            const button = this.toolbar.getChild(childName);
            button.grayed = false;
            button.touchable = true;
            button.tooltips = tooltip;
        }
        for (const [childName, tooltip] of [
            ["tbCanvas", "画布显示设置"],
            ["tbBranch", "项目分支设置"],
            ["tbLang", "项目语言设置"],
        ] as const) {
            const button = this.toolbar.getChild(childName);
            button.grayed = false;
            button.touchable = true;
            button.tooltips = tooltip;
        }
        this.toolbar.getChild("tbTest").visible = true;
    }

    private populateFallbackLibrary(): void {
        this.libraryController.populateFallback();
    }

    private populateFallbackDocument(): void {
        const tabs = this.panels.document.getChild("tabs").asList;
        tabs.removeChildrenToPool();
        const tab = tabs.addItemFromPool().asButton;
        tab.title = "Builder/MainView";
        tab.selected = true;
        this.controllerTimeline.populateControllerPanel();
        this.controllerTimeline.populateTimeline();
    }

    private populateFallbackPreview(): void {
        this.panels.preview.getChild("desc").text = "Builder/MainView";
    }

    private populateFallbackHierarchy(): void {
        const tree = this.panels.hierarchy.getChild("list").asTree;
        this.treeInteraction.resetTree(tree);
        this.treeInteraction.configureHierarchyTree(tree);
        for (const childName of ["menuBar", "toolbar", "LibraryView", "DocumentView", "PreviewView", "HierarchyView", "InspectorView"]) {
            tree.rootNode.addChild(this.createTreeLeaf(childName, "icon_component"));
        }
    }

    private refreshProjectViews(
        invalidation: ProjectionInvalidation = "refresh-runtime-preview",
    ): void {
        if (this.disposed) return;
        this.refreshToolbarSettingsSelectors();
        this.populateLibraryFromSnapshot();
        this.populateFavoritesFromSnapshot();
        this.populateDocumentFromSnapshot();
        if (invalidation === "refresh-runtime-preview") {
            this.populatePreviewFromSnapshot();
        } else {
            this.panels.preview.getChild("desc").text = "Authoring model changed; publish/import a matching runtime package to refresh preview.";
        }
        this.populateHierarchyFromSnapshot();
        this.populateInspectorFromSnapshot();
        this.layoutInspectorLines();
        this.refreshProjectSearch();
        if (this.leftTopPanelMode === "reference") this.refreshProjectReferences();
    }

    private populateLibraryFromSnapshot(): void {
        this.libraryController.populate();
    }

    private populateFavoritesFromSnapshot(): void {
        this.libraryController.populateFavorites();
    }

    private populateDocumentFromSnapshot(): void {
        const snapshot = this.projectSnapshot;
        if (!snapshot) return;
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const activeDocument = selectedPackage && selectedComponent
            ? { packageId: selectedPackage.id, componentId: selectedComponent.id }
            : null;
        this.documentWorkspace.render(snapshot, activeDocument);
        this.persistProjectSelection();
        this.controllerTimeline.populateControllerPanel();
        this.controllerTimeline.populateTransitionList();
        this.controllerTimeline.populateTimeline();
    }

    private getActiveGroupPath(component: ProjectSnapshotComponent | null = this.getSelectedComponent()): string[] {
        return this.documentWorkspace.getGroupPath(this.getActiveDocumentTab(), component);
    }

    private setActiveGroupPath(groupIds: string[]): void {
        this.documentWorkspace.setGroupPath(this.getActiveDocumentTab(), groupIds);
    }

    private getScopedDisplayNodeIds(component: ProjectSnapshotComponent): string[] {
        return this.documentWorkspace.getScopedNodeIds(this.getActiveDocumentTab(), component);
    }

    private changeGroupPathDepth(targetDepth: number): void {
        const path = this.getActiveGroupPath();
        if (!Number.isInteger(targetDepth) || targetDepth < 0 || targetDepth >= path.length) return;
        this.setActiveGroupPath(path.slice(0, targetDepth));
        this.clearDisplayNodeSelection();
        this.persistProjectSelection();
        this.refreshProjectViews();
        this.setStatus(targetDepth === 0 ? "Closed group isolation." : `Group isolation moved to depth ${targetDepth}.`);
    }

    private openSelectedGroup(nodeId: string = this.selectedDisplayNodeId): boolean {
        const component = this.getSelectedComponent();
        const group = component?.children.find((node) => node.id === nodeId);
        if (!component || group?.type !== "GGroup") return false;
        const path = this.documentWorkspace.getPathForGroup(component, group.id);
        if (path.length === 0) return false;
        this.setActiveGroupPath(path);
        this.clearDisplayNodeSelection();
        this.persistProjectSelection();
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-group-isolation", `open:${path.join("/")}`);
        this.setStatus(`Opened group ${group.name || group.id}; selection is limited to its direct members.`);
        return true;
    }

    private closeSelectedGroup(): void {
        const path = this.getActiveGroupPath();
        if (path.length === 0) return;
        this.setActiveGroupPath(path.slice(0, -1));
        this.clearDisplayNodeSelection();
        this.persistProjectSelection();
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-group-isolation", `close:${path[path.length - 1]}`);
        this.setStatus("Closed one group-isolation level.");
    }

    private getActiveDocumentTab(): DesktopDocumentTab | null {
        return this.activeDocument.getActiveTab(this.projectSnapshot);
    }

    private activateDocumentTab(documentTab: DesktopDocumentTab): boolean {
        if (!this.activeDocument.activate(this.projectSnapshot, documentTab)) return false;
        if (this.canvasPerDocumentZoom) {
            const view = this.canvasViewByDocument.get(getDesktopDocumentTabId(documentTab)) || { zoom: 1, panX: 0, panY: 0 };
            this.runtimePreview.setViewState(view.zoom, view.panX, view.panY);
        }
        this.clearResourceSelection();
        this.persistProjectSelection();
        this.refreshProjectViews();
        if (this.libraryLinked) this.locateActiveDocumentInLibrary(false);
        this.setDebugAttribute("data-fairy-editor-active-document", getDesktopDocumentTabId(documentTab));
        return true;
    }

    private activateDocumentFromTab(documentTab: DesktopDocumentTab): void {
        if (!this.activateDocumentTab(documentTab)) return;
        const component = this.getSelectedComponent();
        this.setStatus(`Document activated: ${component?.name || documentTab.componentId}.`);
    }

    private onDocumentTabClose(documentTab: DesktopDocumentTab, event?: Laya.Event): void {
        event?.stopPropagation();
        const activeDocument = this.activeDocument.close(this.projectSnapshot, documentTab);
        this.clearResourceSelection();
        this.persistProjectSelection();
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-document-tab-close", getDesktopDocumentTabId(documentTab));
        this.setStatus(
            activeDocument
                ? `Document closed; active ${this.getSelectedComponent()?.name || activeDocument.componentId}.`
                : "All documents closed.",
        );
    }

    private closeOtherDocuments(): void {
        const activeDocument = this.getActiveDocumentTab();
        if (!activeDocument) return;
        for (const documentTab of this.documentWorkspace.getOpenTabs()) {
            if (getDesktopDocumentTabId(documentTab) !== getDesktopDocumentTabId(activeDocument)) {
                this.documentWorkspace.close(documentTab, activeDocument);
            }
        }
        this.persistProjectSelection();
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-document-tab-close", "others");
        this.setStatus("已关闭其他文档。");
    }

    private closeAllDocuments(): void {
        this.documentWorkspace.clear();
        this.activeDocument.setActiveSelection(this.projectSnapshot, this.selectedPackageId, "");
        this.clearResourceSelection();
        this.persistProjectSelection();
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-document-tab-close", "all");
        this.setStatus("已关闭所有文档。");
    }

    private cycleDocumentTab(delta: number): void {
        const target = this.activeDocument.cycle(this.projectSnapshot, delta);
        if (!target) return;
        this.clearResourceSelection();
        this.persistProjectSelection();
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-active-document", getDesktopDocumentTabId(target));
        this.setStatus(`Document activated: ${this.getSelectedComponent()?.name || target.componentId}.`);
    }

    private getReferencedComponentTab(nodeId: string = this.selectedDisplayNodeId): DesktopDocumentTab | null {
        const owner = this.getActiveDocumentTab();
        if (!owner || !nodeId) return null;
        return resolveDesktopReferencedComponentTab(
            this.liveSessionBridge.getWorkingProject(),
            owner,
            nodeId,
        );
    }

    private openReferencedComponent(nodeId: string = this.selectedDisplayNodeId): boolean {
        const target = this.getReferencedComponentTab(nodeId);
        if (!target || !this.activateDocumentTab(target)) return false;
        this.setDebugAttribute(
            "data-fairy-editor-open-reference",
            `${nodeId}->${getDesktopDocumentTabId(target)}`,
        );
        this.setStatus(`Referenced component opened: ${this.getSelectedComponent()?.name || target.componentId}.`);
        return true;
    }

    private populatePreviewFromSnapshot(): void {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedResource = this.getSelectedResource();
        const inspectorSelection = this.libraryController.getInspectorSelection();
        if (
            selectedResource
            && inspectorSelection?.kind === "resource"
            && this.resourcePreview.matches(inspectorSelection.packageId, selectedResource.id)
        ) {
            if (selectedResource.type === "Component") {
                const pkg = this.projectSnapshot?.packages.find((candidate) => candidate.id === inspectorSelection.packageId);
                const component = pkg?.components.find((candidate) => candidate.id === selectedResource.id);
                if (pkg && component) {
                    this.resourcePreview.showComponent(this.projectSnapshot?.project.id || "", pkg, component);
                }
            } else {
                this.resourcePreview.show(inspectorSelection.packageId, selectedResource);
            }
        } else {
            this.resourcePreview.clear();
            this.updatePreviewDescriptionFromSnapshot();
        }
        this.runtimePreview.setEditorHiddenNodeIds(this.getHierarchyHiddenNodeIds());
        this.runtimePreview.setShowAllInvisibleNodes(
            this.hierarchyShowAllInvisibles.has(this.getHierarchyDocumentKey()),
        );
        this.runtimePreview.refresh(
            this.projectSnapshot ? this.projectSnapshot.project.id : "",
            selectedPackage ? selectedPackage.name : "",
            selectedComponent,
            this.selectedDisplayNodeIds,
        );
    }

    private updatePreviewDescriptionFromSnapshot(suffix: string = ""): void {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const label = selectedPackage && selectedComponent
            ? `${selectedPackage.name}/${selectedComponent.name} ${selectedComponent.width}x${selectedComponent.height}`
            : "No component";
        this.panels.preview.getChild("desc").text = suffix ? `${label} · ${suffix}` : label;
    }

    private populateHierarchyFromSnapshot(): void {
        const tree = this.panels.hierarchy.getChild("list").asTree;
        this.treeInteraction.resetTree(tree);
        this.treeInteraction.configureHierarchyTree(tree);
        tree.clearSelection();

        const selectedComponent = this.getSelectedComponent();
        this.updateHierarchyToolbarState(selectedComponent);
        if (!selectedComponent) return;

        const scopedIds = new Set(this.getScopedDisplayNodeIds(selectedComponent));
        const visibleIds = this.getHierarchySearchVisibleIds(selectedComponent, scopedIds);
        const groupPath = this.getActiveGroupPath(selectedComponent);
        this.appendHierarchyNodes(
            tree.rootNode,
            selectedComponent,
            groupPath[groupPath.length - 1] || "",
            visibleIds,
        );
        this.selectCurrentHierarchyNode(tree);
    }

    private populateInspectorFromSnapshot(): void {
        const snapshot = this.projectSnapshot;
        if (!snapshot) return;

        const selectedResource = this.getSelectedResource();
        if (selectedResource) {
            this.renderResourceInspector(selectedResource);
            return;
        }
        const selectedFolder = this.getSelectedResourceFolder();
        if (selectedFolder) {
            this.renderResourceFolderInspector(selectedFolder);
            return;
        }

        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedNode = this.getSelectedDisplayNode();
        this.inspectorCommandPanel.renderSnapshot({
            snapshot,
            workingProject: this.liveSessionBridge.getWorkingProject(),
            selectedPackage,
            selectedComponent,
            selectedNode,
            selectedNodes: this.getSelectedDisplayNodes(),
            commandSession: this.commandAdapter.getSessionState(),
            componentCustomPropertiesEditable:
                this.getSelectedComponentCustomPropertyDefinitions().length > 0
                || this.getSelectedComponentExportedControllers().length > 0,
        });
    }

    private renderResourceInspector(resource: ProjectSnapshotResource | null): void {
        this.inspectorCommandPanel.renderResource(resource);
    }

    private renderResourceFolderInspector(folder: ProjectSnapshotResourceFolder | null): void {
        this.inspectorCommandPanel.renderResourceFolder(folder);
    }

    private renderInspectorLines(details: string[]): void {
        if (this.disposed) return;
        this.inspectorCommandPanel.renderLines(details);
    }

    private layoutInspectorLines(): void {
        if (this.disposed) return;
        this.inspectorCommandPanel.layout();
    }

    private onInspectorPanelAction(action: InspectorPanelAction): void {
        switch (action) {
            case "command:apply":
                void (this.selectedDisplayNodeIds.length > 1
                    ? this.applyMultiSelectionCommand()
                    : this.applyInspectorCommand());
                return;
            case "command:sourceSize": void this.applySelectedNodeSourceSize(); return;
            case "properties:common": this.authoringDialogs.showCommonDisplayProperties(); return;
            case "properties:text": this.authoringDialogs.showTextProperties(); return;
            case "properties:graph": this.authoringDialogs.showGraphProperties(); return;
            case "properties:group": this.authoringDialogs.showGroupProperties(); return;
            case "properties:loader": this.authoringDialogs.showLoaderProperties(); return;
            case "properties:loader3d": this.authoringDialogs.showLoader3DProperties(); return;
            case "properties:list": this.authoringDialogs.showListProperties(); return;
            case "properties:componentInstance": this.authoringDialogs.showComponentInstanceProperties(); return;
            case "properties:componentCustomValues": this.authoringDialogs.showComponentCustomPropertyValues(); return;
            case "display:relations": this.authoringDialogs.showRelationEditor(); return;
            case "display:gears": this.authoringDialogs.showGearEditor(); return;
        }
    }

    private async applyMultiSelectionCommand(): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedIds = this.selectedDisplayNodeIds.slice();
        if (!selectedPackage || !selectedComponent || selectedIds.length < 2) {
            this.setStatus("Multi-selection command skipped: select at least two display nodes.");
            return;
        }

        const readResult = this.inspectorCommandPanel.readMultiSelectionValues();
        if (!readResult.ok) {
            this.setStatus(readResult.message);
            return;
        }

        await this.enqueueAuthoringOperation(async () => {
            if (!this.sameDisplayNodeSelection(selectedIds, this.selectedDisplayNodeIds)) {
                this.setStatus("Multi-selection command cancelled because the selection changed.");
                return false;
            }
            const selectedNodes = this.getSelectedDisplayNodes();
            if (selectedNodes.length !== selectedIds.length) return false;
            const { commands, changedFields } = createCommonDisplayNodePropsCommands(
                selectedPackage.id,
                selectedComponent.id,
                selectedNodes,
                readResult.values,
            );
            if (commands.length === 0) {
                this.setStatus("Multi-selection common properties are unchanged.");
                this.setDebugAttribute("data-fairy-editor-multi-inspector", "unchanged");
                return true;
            }
            const applied = await this.applyDisplayNodePropsCommandsNow(
                commands,
                `multi-selection common properties (${commands.length} nodes)`,
            );
            if (applied) {
                this.setDebugAttribute(
                    "data-fairy-editor-multi-inspector",
                    `${commands.length}:${changedFields.join(",")}`,
                );
                this.setDebugAttribute(
                    "data-fairy-editor-multi-inspector-selection",
                    selectedIds.join(","),
                );
            }
            return applied;
        });
    }

    private async applyInspectorCommand(): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedNode = this.getSelectedDisplayNode();
        if (!selectedPackage || !selectedComponent || !selectedNode) {
            this.setStatus("Command skipped: no display node selected.");
            return;
        }

        const command = this.inspectorCommandPanel.createDisplayNodeCommand(
            selectedPackage,
            selectedComponent,
            selectedNode,
        );
        if (Object.keys(command.props).length === 0) return;
        await this.applyDisplayNodePropsCommand(command, "setDisplayNodeProps");
    }

    private async applyDisplayNodePropsCommand(
        command: SetDisplayNodePropsCommand,
        summary: string,
    ): Promise<boolean> {
        return this.applyDisplayNodePropsCommands([command], summary);
    }

    private async applyDisplayNodePropsCommands(
        commands: SetDisplayNodePropsCommand[],
        summary: string,
    ): Promise<boolean> {
        return this.enqueueAuthoringOperation(() => (
            this.applyDisplayNodePropsCommandsNow(commands, summary)
        ));
    }

    private async applyDisplayNodePropsCommandsNow(
        commands: SetDisplayNodePropsCommand[],
        summary: string,
    ): Promise<boolean> {
        let result: EditorCommandResult;
        let projection: AuthoringPreviewProjectionPlan | null = null;
        try {
            result = commands.length === 1
                ? await this.commandAdapter.applySetDisplayNodePropsWithRuntime(commands[0])
                : await this.commandAdapter.applySetDisplayNodePropsGroupWithRuntime(commands, summary);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.refreshPreviewForSelectedNode();
            this.populateInspectorFromSnapshot();
            this.setStatus(`Command failed: ${message}`, "error");
            console.error("[Editor Session] command apply failed", error);
            return false;
        }

        if (this.disposed) return false;
        this.commandLastResult = result;
        if (result.ok) {
            const snapshot = this.liveSessionBridge.getProjectSnapshot();
            const operations = result.operations || (result.operation ? [result.operation] : []);
            if (snapshot) projection = this.applyLiveProjectSnapshot(snapshot, operations);
        }
        if (result.ok) {
            this.setStatus(`${summary}. ${describeAuthoringPreviewProjection(projection)}`);
        } else {
            this.refreshPreviewForSelectedNode();
            this.populateInspectorFromSnapshot();
            this.setStatus(`Command failed: ${result.error ? result.error.code : "unknown_error"}.`);
        }
        return result.ok;
    }

    private async undoCommand(): Promise<void> {
        await this.enqueueAuthoringOperation(() => this.undoCommandNow());
    }

    private async undoCommandNow(): Promise<void> {
        let result: EditorCommandResult;
        try {
            result = await this.commandAdapter.undoLastWithRuntime();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Undo failed: ${message}`, "error");
            console.error("[Editor Session] command undo failed", error);
            return;
        }
        if (this.disposed) return;
        this.applyCommandHistoryResult(result, "Undo");
    }

    private async redoCommand(): Promise<void> {
        await this.enqueueAuthoringOperation(() => this.redoCommandNow());
    }

    private async redoCommandNow(): Promise<void> {
        let result: EditorCommandResult;
        try {
            result = await this.commandAdapter.redoLastWithRuntime();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Redo failed: ${message}`, "error");
            console.error("[Editor Session] command redo failed", error);
            return;
        }
        if (this.disposed) return;
        this.applyCommandHistoryResult(result, "Redo");
    }

    private applyCommandHistoryResult(result: EditorCommandResult, action: "Undo" | "Redo"): void {
        this.commandLastResult = result;

        const targets = (result.operations || (result.operation ? [result.operation] : []))
            .map((operation) => this.getDisplayNodeSelectorFromOperation(operation))
            .filter((target): target is EditorDisplayNodeSelector => !!target);
        if (!result.ok) {
            this.populateInspectorFromSnapshot();
            this.setStatus(
                `${action} failed: ${result.error?.code || "unknown_error"}. ${result.error?.message || ""}`.trim(),
            );
            return;
        }

        const snapshot = this.liveSessionBridge.getProjectSnapshot();
        const operations = result.operations || (result.operation ? [result.operation] : []);
        if (snapshot) {
            const selection = this.activeDocument.resolveCommandTargetSelection(snapshot, targets);
            const projection = this.applyLiveProjectSnapshot(
                snapshot,
                operations,
                "preserve-runtime-preview",
                selection,
            );
            this.setStatus(
                `${action}${result.summary ? `: ${result.summary}` : ""}. ${describeAuthoringPreviewProjection(projection)}`,
            );
            return;
        }
        this.refreshProjectViews();
        this.refreshPreviewForSelectedNode();
        this.setStatus(`${action} completed.`);
    }

    private requestAuthoringRemoveComponent(): void {
        const selector = this.getLibraryActionComponentSelector();
        const component = this.getLibraryActionComponent();
        const selectedPackage = this.getLibraryActionPackage();
        if (!selector || !component || !selectedPackage) {
            this.setStatus("Component removal skipped: no component selected.");
            return;
        }
        const preparation = prepareRemoveComponent(
            this.liveSessionBridge.getWorkingProject(),
            selector,
        );
        const preparationIdentity = this.liveSessionBridge.captureSessionIdentity();
        if (preparation.ok === false) {
            this.setStatus(`Operation unavailable: ${preparation.code}. ${preparation.message}`);
            return;
        }
        const referenceCount = preparation.transaction.operations?.filter(
            (operation) => operation.kind === "detachDisplayNode",
        ).length || 0;
        this.authoringDialogs.showConfirmation(
            "authoringRemoveComponentConfirmDialog",
            "Remove component",
            `Remove ${selectedPackage.name}/${component.name} (${component.childCount} nodes, ${component.controllerCount} controllers, ${component.transitionCount} transitions)?`
                + ` Detach ${referenceCount} incoming reference${referenceCount === 1 ? "" : "s"}; shared resources remain. Undo remains available after Save.`,
            "Remove",
            "data-fairy-editor-transaction-remove-component-confirmation",
            "Confirm component removal.",
            "Component removal cancelled.",
            () => void this.applyAuthoringPreparation(preparation, preparationIdentity),
        );
    }

    private async applyAuthoringPreparation(
        preparation: HighRiskTransactionPreparation,
        preparationIdentity: BrowserLiveSessionIdentity | null = this.liveSessionBridge.captureSessionIdentity(),
    ): Promise<boolean> {
        return this.enqueueAuthoringOperation(() => (
            this.applyAuthoringPreparationNow(preparation, preparationIdentity)
        ));
    }

    private async applyAuthoringPreparationNow(
        preparation: HighRiskTransactionPreparation,
        preparationIdentity: BrowserLiveSessionIdentity | null,
    ): Promise<boolean> {
        if (preparation.ok === false) {
            this.setStatus(`Operation unavailable: ${preparation.code}. ${preparation.message}`);
            return false;
        }
        if (!preparationIdentity || !this.liveSessionBridge.isSessionIdentityCurrent(preparationIdentity)) {
            this.setStatus(
                "Operation cancelled because the project changed while it was queued. Retry the action.",
                "warning",
            );
            return false;
        }

        let result: EditorCommandResult;
        try {
            result = await this.commandAdapter.applyHighRiskTransactionWithRuntime(
                preparation.transaction as EditorHighRiskTransaction,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Operation failed: ${message}`, "error");
            console.error("[Editor Transaction] apply failed", error);
            return false;
        }

        if (this.disposed) return false;
        this.commandLastResult = result;
        if (!result.ok) {
            this.setStatus(`Operation failed: ${result.error?.code || "unknown_error"}.`, "error");
            this.populateInspectorFromSnapshot();
            return false;
        }

        const snapshot = this.liveSessionBridge.getProjectSnapshot();
        if (snapshot) {
            const projection = this.applyLiveProjectSnapshot(
                snapshot,
                result.operations || (result.operation ? [result.operation] : []),
            );
            this.setStatus(
                `${preparation.transaction.summary}. ${describeAuthoringPreviewProjection(projection)}`,
            );
            return true;
        }
        this.setStatus(`${preparation.transaction.summary}. Canvas could not be refreshed.`);
        return true;
    }

    private refreshPreviewForSelectedNode(): void {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedNode = this.getSelectedDisplayNode();
        if (!selectedPackage || !selectedComponent || !selectedNode) return;

        const visibility = selectedNode.visible ? "" : " hidden";
        this.panels.preview.getChild("desc").text =
            `${selectedPackage.name}/${selectedComponent.name}/${selectedNode.name || selectedNode.id} ${selectedNode.width}x${selectedNode.height} @ ${selectedNode.x},${selectedNode.y}${visibility}`;
        this.setDebugAttribute(
            "data-fairy-editor-selected-node-position",
            `${selectedNode.x},${selectedNode.y}`,
        );
        this.setDebugAttribute(
            "data-fairy-editor-selected-node-pivot",
            `${selectedNode.pivotX},${selectedNode.pivotY},${selectedNode.pivotAsAnchor}`,
        );
        this.runtimePreview.applyDisplayNodeState(selectedNode);
    }

    private commitPreviewNodePositions(positions: RuntimePreviewNodePosition[]): Promise<boolean> {
        const selectedIds = new Set(this.selectedDisplayNodeIds);
        if (
            selectedIds.size === 0
            || positions.length !== selectedIds.size
            || positions.some((position) => !selectedIds.has(position.nodeId))
        ) {
            return Promise.resolve(false);
        }

        return this.enqueueAuthoringOperation(() => (
            this.applyDesktopNodePositions(positions, "canvas drag")
        ));
    }

    private commitPreviewNodeTransforms(
        transforms: RuntimePreviewNodeTransform[],
    ): Promise<boolean> {
        const selectedIds = new Set(this.selectedDisplayNodeIds);
        if (
            selectedIds.size === 0
            || transforms.length !== selectedIds.size
            || transforms.some((transform) => !selectedIds.has(transform.nodeId))
        ) {
            return Promise.resolve(false);
        }
        return this.enqueueAuthoringOperation(() => (
            this.applyDesktopNodeTransforms(transforms)
        ));
    }

    private commitPreviewNodeRotations(transforms: RuntimePreviewNodeRotation[]): Promise<boolean> {
        const selectedIds = new Set(this.selectedDisplayNodeIds);
        if (
            selectedIds.size === 0
            || transforms.length !== selectedIds.size
            || transforms.some((transform) => !selectedIds.has(transform.nodeId))
        ) {
            return Promise.resolve(false);
        }
        return this.enqueueAuthoringOperation(() => (
            this.applyDesktopNodeRotations(transforms)
        ));
    }

    private commitPreviewNodePivot(transform: RuntimePreviewNodePivot): Promise<boolean> {
        if (
            this.selectedDisplayNodeIds.length !== 1
            || this.selectedDisplayNodeIds[0] !== transform.nodeId
        ) {
            return Promise.resolve(false);
        }
        return this.enqueueAuthoringOperation(() => this.applyDesktopNodePivot(transform));
    }

    private commitPreviewGraphPoints(transform: RuntimePreviewGraphPoints): Promise<boolean> {
        if (
            this.selectedDisplayNodeIds.length !== 1
            || this.selectedDisplayNodeIds[0] !== transform.nodeId
        ) {
            return Promise.resolve(false);
        }
        return this.enqueueAuthoringOperation(() => this.applyDesktopGraphPoints(transform));
    }

    private onPreviewViewChanged(zoom: number, panX: number, panY: number): void {
        this.setDebugAttribute("data-fairy-editor-canvas-zoom", zoom.toFixed(2));
        this.setDebugAttribute("data-fairy-editor-canvas-pan", `${panX},${panY}`);
        const document = this.getActiveDocumentTab();
        if (document && this.canvasPerDocumentZoom) {
            this.canvasViewByDocument.set(getDesktopDocumentTabId(document), { zoom, panX, panY });
        }
        const combo = this.toolbar.getChild("viewScale").asComboBox;
        const index = combo.values.indexOf(String(zoom));
        if (index >= 0 && combo.selectedIndex !== index) combo.selectedIndex = index;
    }

    private queueSelectedNodeNudge(dx: number, dy: number): void {
        const selectedIds = this.selectedDisplayNodeIds.slice();
        if (selectedIds.length === 0) return;

        void this.enqueueAuthoringOperation(async () => {
            if (!this.sameDisplayNodeSelection(selectedIds, this.selectedDisplayNodeIds)) {
                return false;
            }
            const selectedNodes = this.getSelectedDisplayNodes();
            if (selectedNodes.length !== selectedIds.length) return false;
            return this.applyDesktopNodePositions(
                selectedNodes.map((node) => ({
                    nodeId: node.id,
                    x: node.x + dx,
                    y: node.y + dy,
                })),
                "keyboard nudge",
            );
        });
    }

    private enqueueAuthoringOperation(task: () => Promise<boolean>): Promise<boolean>;
    private enqueueAuthoringOperation(task: () => Promise<void>): Promise<void>;
    private enqueueAuthoringOperation(
        task: () => Promise<boolean | void>,
    ): Promise<boolean | void> {
        const result = this.authoringOperationQueue.then(() => (
            this.disposed ? false : task()
        ));
        this.authoringOperationQueue = result.then(
            (): void => {},
            (): void => {},
        );
        return result;
    }

    private async applyDesktopNodePositions(
        positions: RuntimePreviewNodePosition[],
        source: "canvas drag" | "keyboard nudge",
    ): Promise<boolean> {
        if (this.disposed) return false;
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        if (!selectedPackage || !selectedComponent) return false;

        const selectedNodes = this.getSelectedDisplayNodes();
        if (selectedNodes.length !== this.selectedDisplayNodeIds.length) return false;
        const commands = createDesktopCanvasPositionCommands({
            packageId: selectedPackage.id,
            componentResourceId: selectedComponent.id,
            nodes: selectedNodes,
        }, positions);
        if (!commands) return false;
        if (commands.length === 0) return true;

        const summary = commands.length === 1
            ? `${source} ${selectedNodes[0].name || selectedNodes[0].id} to ${commands[0].props.position!.x},${commands[0].props.position!.y}`
            : `${source} ${commands.length} selected nodes`;
        const applied = await this.applyDisplayNodePropsCommandsNow(commands, summary);
        if (applied) {
            this.setDebugAttribute("data-fairy-editor-canvas-interaction", source);
            this.setDebugAttribute("data-fairy-editor-canvas-selection-count", String(commands.length));
            this.setDebugAttribute(
                "data-fairy-editor-canvas-position",
                commands.map((command) => (
                    `${command.selector.displayNodeId}:${command.props.position!.x},${command.props.position!.y}`
                )).join("|"),
            );
        }
        return applied;
    }

    private async applyDesktopNodeTransforms(
        transforms: RuntimePreviewNodeTransform[],
        source?: string,
    ): Promise<boolean> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        if (!selectedPackage || !selectedComponent) return false;
        const selectedNodes = this.getSelectedDisplayNodes();
        if (selectedNodes.length !== this.selectedDisplayNodeIds.length) return false;
        const commands = createDesktopCanvasTransformCommands({
            packageId: selectedPackage.id,
            componentResourceId: selectedComponent.id,
            nodes: selectedNodes,
        }, transforms);
        if (!commands) return false;
        if (commands.length === 0) return true;
        const nodeById = new Map(selectedNodes.map((node) => [node.id, node]));
        const interaction = source || (commands.length === 1 ? "resize" : "group scale");
        const summary = commands.length === 1
            ? `canvas ${interaction} ${selectedNodes[0].name || selectedNodes[0].id}`
            : `canvas ${interaction} ${commands.length} selected nodes`;
        const applied = await this.applyDisplayNodePropsCommandsNow(commands, summary);
        if (applied) {
            this.setDebugAttribute(
                "data-fairy-editor-canvas-interaction",
                interaction,
            );
            this.setDebugAttribute(
                "data-fairy-editor-canvas-selection-count",
                String(commands.length),
            );
            this.setDebugAttribute(
                "data-fairy-editor-canvas-size",
                commands.map((command) => {
                    const node = nodeById.get(command.selector.displayNodeId)!;
                    const size = command.props.size || node;
                    return `${command.selector.displayNodeId}:${size.width},${size.height}`;
                }).join("|"),
            );
            this.setDebugAttribute(
                "data-fairy-editor-canvas-position",
                commands.map((command) => {
                    const node = nodeById.get(command.selector.displayNodeId)!;
                    const position = command.props.position || node;
                    return `${command.selector.displayNodeId}:${position.x},${position.y}`;
                }).join("|"),
            );
        }
        return applied;
    }

    private onAlignToolbarAction(mode: DesktopCanvasAlignmentMode): void {
        const selectedIds = this.selectedDisplayNodeIds.slice();
        const minimum = mode === "distributeX" || mode === "distributeY" ? 3 : 2;
        if (selectedIds.length < minimum) {
            this.setStatus(`Canvas ${mode} requires at least ${minimum} selected nodes.`);
            return;
        }
        void this.enqueueAuthoringOperation(async () => {
            if (!this.sameDisplayNodeSelection(selectedIds, this.selectedDisplayNodeIds)) return false;
            const selectedNodes = this.getSelectedDisplayNodes();
            if (selectedNodes.length !== selectedIds.length) return false;
            const transforms = resolveDesktopCanvasAlignment(
                selectedNodes.map((node) => ({
                    id: node.id,
                    x: node.x,
                    y: node.y,
                    width: node.width,
                    height: node.height,
                })),
                mode,
                this.selectedDisplayNodeId,
            ).map((node) => ({ ...node, nodeId: node.id }));
            const applied = await this.applyDesktopNodeTransforms(transforms, `align ${mode}`);
            if (applied) {
                this.setDebugAttribute(
                    "data-fairy-editor-canvas-align",
                    `${mode}:${transforms.map((node) => (
                        `${node.nodeId}@${node.x},${node.y}/${node.width}x${node.height}`
                    )).join("|")}`,
                );
            }
            return applied;
        });
    }

    private showCustomArrangePanel(
        mode: DesktopCanvasCustomArrangeMode,
        anchor: fgui.GObject,
    ): void {
        const selectedNodes = this.getSelectedDisplayNodes();
        if (selectedNodes.length < 2) {
            this.setStatus(`Canvas ${mode} arrange requires at least 2 selected nodes.`);
            return;
        }
        const items = selectedNodes.map((node) => ({
            id: node.id,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
        }));
        if (!this.customArrangePanel) {
            this.customArrangePanel = fgui.UIPackage.createObject(
                "Builder",
                "CustomArrangePanel",
            ) as EditorCustomArrangePanel;
            this.customArrangePanel.name = "desktopCustomArrangePanel";
            this.customArrangePanel.okButton.onClick(this, this.applyCustomArrange);
        }
        const panel = this.customArrangePanel;
        panel.setOptions(mode, {
            lineSpacing: inferDesktopCanvasSpacing(items, "y"),
            columnSpacing: inferDesktopCanvasSpacing(items, "x"),
            columnCount: inferDesktopCanvasColumnCount(items),
        });
        this.customArrangeSelectionIds = selectedNodes.map((node) => node.id);
        fgui.GRoot.inst.showPopup(panel, anchor);
        this.setDebugAttribute("data-fairy-editor-canvas-arrange-panel", mode);
        this.setTransientStatus(`Canvas ${mode} arrange options opened.`);
    }

    private applyCustomArrange(): void {
        const panel = this.customArrangePanel;
        if (!panel) return;
        const mode = panel.mode;
        const options = panel.readOptions();
        if (!options) {
            this.setStatus("Canvas arrange requires integer spacing and a positive column count.");
            return;
        }
        const selectedIds = this.customArrangeSelectionIds.slice();
        fgui.GRoot.inst.hidePopup(panel);
        void this.enqueueAuthoringOperation(async () => {
            if (!this.sameDisplayNodeSelection(selectedIds, this.selectedDisplayNodeIds)) return false;
            const selectedNodes = this.getSelectedDisplayNodes();
            if (selectedNodes.length !== selectedIds.length) return false;
            const transforms = resolveDesktopCanvasCustomArrange(
                selectedNodes.map((node) => ({
                    id: node.id,
                    x: node.x,
                    y: node.y,
                    width: node.width,
                    height: node.height,
                })),
                mode,
                options,
            ).map((node) => ({ ...node, nodeId: node.id }));
            const applied = await this.applyDesktopNodeTransforms(transforms, `arrange ${mode}`);
            if (applied) {
                this.setDebugAttribute(
                    "data-fairy-editor-canvas-arrange",
                    `${mode}:${options.columnCount},${options.columnSpacing},${options.lineSpacing}:`
                    + transforms.map((node) => `${node.nodeId}@${node.x},${node.y}`).join("|"),
                );
            }
            return applied;
        });
    }

    private async applyDesktopNodeRotations(
        transforms: RuntimePreviewNodeRotation[],
    ): Promise<boolean> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        if (!selectedPackage || !selectedComponent) return false;
        const selectedNodes = this.getSelectedDisplayNodes();
        if (selectedNodes.length !== this.selectedDisplayNodeIds.length) return false;
        const commands = createDesktopCanvasRotationCommands({
            packageId: selectedPackage.id,
            componentResourceId: selectedComponent.id,
            nodes: selectedNodes,
        }, transforms);
        if (!commands) return false;
        if (commands.length === 0) return true;
        const nodeById = new Map(selectedNodes.map((node) => [node.id, node]));
        const interaction = commands.length === 1 ? "rotate" : "group rotate";
        const summary = commands.length === 1
            ? `canvas rotate ${selectedNodes[0].name || selectedNodes[0].id} to ${commands[0].props.rotation ?? selectedNodes[0].rotation}°`
            : `canvas group rotate ${commands.length} selected nodes`;
        const applied = await this.applyDisplayNodePropsCommandsNow(commands, summary);
        if (applied) {
            this.setDebugAttribute("data-fairy-editor-canvas-interaction", interaction);
            this.setDebugAttribute("data-fairy-editor-canvas-selection-count", String(commands.length));
            this.setDebugAttribute(
                "data-fairy-editor-canvas-rotation",
                commands.map((command) => {
                    const node = nodeById.get(command.selector.displayNodeId)!;
                    return `${command.selector.displayNodeId}:${command.props.rotation ?? node.rotation}`;
                }).join("|"),
            );
            this.setDebugAttribute(
                "data-fairy-editor-canvas-position",
                commands.map((command) => {
                    const node = nodeById.get(command.selector.displayNodeId)!;
                    const position = command.props.position || node;
                    return `${command.selector.displayNodeId}:${position.x},${position.y}`;
                }).join("|"),
            );
        }
        return applied;
    }

    private async applyDesktopNodePivot(transform: RuntimePreviewNodePivot): Promise<boolean> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedNode = this.getSelectedDisplayNode();
        if (
            !selectedPackage
            || !selectedComponent
            || !selectedNode
            || selectedNode.id !== transform.nodeId
            || selectedNode.type === "GGroup"
            || selectedNode.type === "GLoader3D"
        ) {
            return false;
        }
        const position = { x: Math.round(transform.x), y: Math.round(transform.y) };
        const pivot = { x: transform.pivotX, y: transform.pivotY };
        const positionChanged = selectedNode.x !== position.x || selectedNode.y !== position.y;
        const pivotChanged = selectedNode.pivotX !== pivot.x || selectedNode.pivotY !== pivot.y;
        if (!positionChanged && !pivotChanged) return true;
        const command: SetDisplayNodePropsCommand = {
            kind: "setDisplayNodeProps",
            selector: {
                packageId: selectedPackage.id,
                componentResourceId: selectedComponent.id,
                displayNodeId: selectedNode.id,
            },
            props: {
                ...(positionChanged ? { position } : {}),
                ...(pivotChanged ? { pivot } : {}),
            },
        };
        const applied = await this.applyDisplayNodePropsCommandsNow(
            [command],
            `canvas pivot ${selectedNode.name || selectedNode.id} to ${pivot.x},${pivot.y}`,
        );
        if (applied) {
            this.setDebugAttribute("data-fairy-editor-canvas-interaction", "pivot");
            this.setDebugAttribute(
                "data-fairy-editor-canvas-pivot",
                `${selectedNode.id}:${pivot.x},${pivot.y}@${position.x},${position.y}`,
            );
        }
        return applied;
    }

    private async applyDesktopGraphPoints(transform: RuntimePreviewGraphPoints): Promise<boolean> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedNode = this.getSelectedDisplayNode();
        const graph = selectedNode?.graphProperties;
        if (
            !selectedPackage
            || !selectedComponent
            || !selectedNode
            || selectedNode.id !== transform.nodeId
            || selectedNode.type !== "GGraph"
            || (graph?.graphType !== 3 && graph?.graphType !== 4)
        ) {
            return false;
        }
        const polygonPoints = transform.points;
        const regularDistances = transform.distances;
        if (graph.graphType === 3 && (
            !graph.points
            || !polygonPoints
            || polygonPoints.length !== graph.points.length
            || polygonPoints.length < 6
            || polygonPoints.length % 2 !== 0
            || polygonPoints.some((value) => !Number.isFinite(value))
        )) return false;
        if (graph.graphType === 4 && (
            !regularDistances
            || regularDistances.length !== graph.sides
            || regularDistances.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
        )) return false;
        const before = graph.graphType === 3 ? graph.points! : Array.from({ length: graph.sides }, (_, index) => graph.distances?.[index] ?? 1);
        const after = graph.graphType === 3 ? polygonPoints! : regularDistances!;
        if (after.every((value, index) => value === before[index])) return true;
        const command: SetDisplayNodePropsCommand = {
            kind: "setDisplayNodeProps",
            selector: {
                packageId: selectedPackage.id,
                componentResourceId: selectedComponent.id,
                displayNodeId: selectedNode.id,
            },
            props: {
                graphProperties: {
                    ...structuredClone(graph),
                    ...(graph.graphType === 3 ? { points: [...polygonPoints!] } : { distances: [...regularDistances!] }),
                },
            },
        };
        const applied = await this.applyDisplayNodePropsCommandsNow(
            [command],
            `canvas ${graph.graphType === 3 ? "polygon point" : "regular polygon radius"} ${selectedNode.name || selectedNode.id}`,
        );
        if (applied) {
            const changedIndex = after.findIndex((value, index) => value !== before[index]);
            const pointIndex = graph.graphType === 3 ? Math.max(0, Math.floor(changedIndex / 2)) : Math.max(0, changedIndex);
            this.setDebugAttribute("data-fairy-editor-canvas-interaction", "graph-point");
            this.setDebugAttribute(
                "data-fairy-editor-canvas-graph-point",
                graph.graphType === 3
                    ? `${selectedNode.id}:${pointIndex}:${polygonPoints![pointIndex * 2]},${polygonPoints![pointIndex * 2 + 1]}`
                    : `${selectedNode.id}:${pointIndex}:distance=${regularDistances![pointIndex]}`,
            );
        }
        return applied;
    }

    private sameDisplayNodeSelection(left: string[], right: string[]): boolean {
        return left.length === right.length
            && left.every((nodeId) => right.indexOf(nodeId) >= 0);
    }

    private setDisplayNodeSelection(nodeIds: string[], primaryNodeId: string = ""): void {
        this.activeDocument.setNodeSelection(this.projectSnapshot, nodeIds, primaryNodeId);
    }

    private clearDisplayNodeSelection(): void {
        this.activeDocument.clearNodeSelection();
    }

    private clearResourceSelection(): void {
        this.libraryController.clearInspectorSelection();
    }

    private syncDisplayNodeSelectionViews(): void {
        this.persistProjectSelection();
        this.populateHierarchyFromSnapshot();
        this.populateInspectorFromSnapshot();
        this.runtimePreview.selectNodes(this.selectedDisplayNodeIds, this.selectedDisplayNodeId);
        this.layoutInspectorLines();
    }

    private getDisplayNodeSelectorFromOperation(
        operation: NonNullable<EditorCommandResult["operation"]>,
    ): EditorDisplayNodeSelector | null {
        if (operation.kind === "setDisplayNodeProps" || operation.kind === "detachDisplayNode") {
            return operation.selector;
        }
        if (operation.kind === "attachDisplayNode") {
            const displayNodeId = String((operation.node as { id?: unknown } | null)?.id || "");
            return displayNodeId ? { ...operation.selector, displayNodeId } : null;
        }
        return null;
    }

    private getSelectedDisplayNodeSelector(): EditorDisplayNodeSelector | null {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedNode = this.getSelectedDisplayNode();
        if (!selectedPackage || !selectedComponent || !selectedNode) return null;
        return {
            packageId: selectedPackage.id,
            componentResourceId: selectedComponent.id,
            displayNodeId: selectedNode.id,
        };
    }

    private getSelectedComponentCustomPropertyDefinitions(): ComponentCustomPropertyDefinition[] {
        const selector = this.getSelectedDisplayNodeSelector();
        if (!selector) return [];
        const project = this.liveSessionBridge.getWorkingProject();
        const owner = findComponent(project, selector);
        const node = owner?.displayList?.find((candidate) => candidate.id === selector.displayNodeId);
        if (node?.kind !== "component" || !node.resource?.resourceId) return [];
        const resource = findResource(project, {
            packageId: node.resource.packageId || selector.packageId,
            resourceId: node.resource.resourceId,
        });
        return resource?.kind === "component" && resource.component
            ? readComponentProperties(resource.component).customProperties
            : [];
    }

    private getSelectedComponentExportedControllers(): ExportedControllerDefinition[] {
        const selector = this.getSelectedDisplayNodeSelector();
        if (!selector) return [];
        const project = this.liveSessionBridge.getWorkingProject();
        const owner = findComponent(project, selector);
        const node = owner?.displayList?.find((candidate) => candidate.id === selector.displayNodeId);
        if (node?.kind !== "component" || !node.resource?.resourceId) return [];
        const resource = findResource(project, {
            packageId: node.resource.packageId || selector.packageId,
            resourceId: node.resource.resourceId,
        });
        return resource?.kind === "component"
            ? (resource.component?.controllers || []).flatMap((controller) => (
                controller.exported && controller.name
                    ? [{
                        name: controller.name,
                        label: controller.alias || controller.name,
                        pages: (controller.pages || []).flatMap((page) => (
                            page.id ? [{ id: page.id, name: page.name || page.id }] : []
                        )),
                    }]
                    : []
            ))
            : [];
    }

    private getSelectedDisplayNodes(): ProjectSnapshotDisplayNode[] {
        const component = this.getSelectedComponent();
        if (!component) return [];
        const nodesById = new Map(component.children.map((node) => [node.id, node]));
        return this.selectedDisplayNodeIds.flatMap((nodeId) => {
            const node = nodesById.get(nodeId);
            return node ? [node] : [];
        });
    }

    private getSelectedComponentSelector(): { packageId: string; componentResourceId: string } | null {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        if (!selectedPackage || !selectedComponent) return null;
        return { packageId: selectedPackage.id, componentResourceId: selectedComponent.id };
    }

    private registerEditorActions(): void {
        const register = (ids: EditorActionId[], run: () => void): void => {
            for (const id of ids) this.editorActions.set(id, run);
        };
        register(["library:refresh"], () => { void this.refreshProjectSnapshot(); });
        register(["menu:file", "workspace:showPanel"], () => this.showBrowserWorkspaceSelector());
        register(["menu:resource"], () => this.showSelectedResourceInspector());
        register(["menu:tools"], () => this.openProjectSettingsDialog());
        register(["menu:view", "hierarchy:expand"], () => this.toggleHierarchyExpansion());
        register(["toolbar:publish", "menu:publish"], () => { void this.publishBrowserRuntimeBundle(); });
        register(["toolbar:publishSettings"], () => {
            openPublishSettingsEditor({
                getWorkingProject: () => this.liveSessionBridge.getWorkingProject(),
                getActiveDialog: () => this.authoringJsonDialog,
                setActiveDialog: (dialog) => { this.authoringJsonDialog = dialog; },
                applyPreparation: (preparation) => this.applyAuthoringPreparation(preparation),
                publish: (mode) => this.publishBrowserRuntimeBundle(mode),
                setStatus: (message) => this.setStatus(message),
                eventOwner: this,
            });
        });
        register(["toolbar:canvasSettings"], () => this.showCanvasSettings());
        register(["toolbar:branchSettings", "toolbar:languageSettings"], () => this.openProjectSettingsDialog());
        register(["toolbar:test"], () => this.publishedTest.start());
        register(["toolbar:stopTest"], () => this.publishedTest.stop());
        register(["toolbar:reloadTest"], () => this.publishedTest.reload());
        register(["toolbar:save", "save"], () => { void this.saveBrowserWorkspace(); });
        register(["toolbar:importProjectDirectory", "workspace:importProject"], () => this.showProjectImportDialog());
        register(["workspace:importProjectDirectory"], () => this.importProjectDirectory());
        register(["workspace:importProjectZip"], () => this.importProjectZip());
        register(["toolbar:exportWorkspace"], () => { void this.exportBrowserWorkspaceZip(); });
        register(["preview:play"], () => {
            if (!this.resourcePreview.play()) this.controllerTimeline.playRuntimePreviewTransition();
        });
        register(["toolbar:createPackage"], () => { void this.resourceAuthoring.applyAuthoringAddPackage(); });
        register(["toolbar:createComponent"], () => { void this.resourceAuthoring.applyAuthoringAddComponent(); });
        register(["toolbar:createButton"], () => this.authoringDialogs.showComponentTemplate("button"));
        register(["toolbar:createLabel"], () => this.authoringDialogs.showComponentTemplate("label"));
        register(["toolbar:createComboBox"], () => this.authoringDialogs.showComponentTemplate("comboBox"));
        register(["toolbar:createProgressBar"], () => this.authoringDialogs.showComponentTemplate("progressBar"));
        register(["toolbar:createSlider"], () => this.authoringDialogs.showComponentTemplate("slider"));
        register(["toolbar:createBitmapFont"], () => this.resourceAuthoring.showCreateBitmapFontDialog());
        register(["toolbar:createMovieClip"], () => this.resourceAuthoring.showCreateMovieClipDialog());
        register(["projectSearch"], () => this.showProjectSearch());
        register(["undo"], () => { if (this.commandAdapter.canUndo()) void this.undoCommand(); });
        register(["redo"], () => { if (this.commandAdapter.canRedo()) void this.redoCommand(); });
        register(["nextDocument"], () => { if (this.documentWorkspace.count > 1) this.cycleDocumentTab(1); });
        register(["previousDocument"], () => { if (this.documentWorkspace.count > 1) this.cycleDocumentTab(-1); });
        register(["closeDocument"], () => {
            const activeDocument = this.getActiveDocumentTab();
            if (activeDocument) this.onDocumentTabClose(activeDocument);
        });
        register(["test"], () => {
            this.publishedTest.isActive() ? this.publishedTest.reload() : this.publishedTest.start();
        });
    }

    private runEditorAction(action: EditorActionId): boolean {
        const run = this.editorActions.get(action);
        if (!run) return false;
        run();
        return true;
    }

    private bindActions(): void {
        for (const item of TOOLBAR_ACTIONS) {
            this.listenClick(this.toolbar.getChild(item.childName), this.onAction, [item.action]);
        }
        this.listenEvent(this.toolbar.getChild("branches"), fgui.Events.STATE_CHANGED, this.onToolbarBranchChanged);
        this.listenEvent(this.toolbar.getChild("lang"), fgui.Events.STATE_CHANGED, this.onToolbarLanguageChanged);
        this.listenEvent(this.toolbar.getChild("viewScale"), fgui.Events.STATE_CHANGED, this.onToolbarViewScaleChanged);

        this.listenClick(this.statusLine, this.showDesktopConsole);
        this.listenClick(this.consoleView.getChild("btnClear"), this.clearDesktopConsole);
        this.listenClick(this.consoleView.getChild("btnCopy"), this.copyDesktopConsole);
        this.listenEvent(this.libraryDock.getChild("tab2"), fgui.Events.CLICK_ITEM, this.onLibraryDockTabClick);
        this.listenClick(this.panels.library.getChild("btnRefresh"), this.onAction, ["library:refresh"]);
        this.listenClick(this.panels.library.getChild("btnLocate"), this.locateActiveDocumentInLibrary, [true]);
        this.listenEvent(this.panels.library.getChild("btnSync"), fgui.Events.STATE_CHANGED, this.onLibrarySyncChanged);
        this.listenClick(this.panels.hierarchy.getChild("expand"), this.onAction, ["hierarchy:expand"]);
        this.listenClick(this.panels.hierarchy.getChild("status"), this.toggleAllHierarchyVisibility);
        this.listenClick(this.panels.hierarchy.getChild("lock"), this.toggleAllHierarchyLocks);
        this.listenClick(this.panels.hierarchy.getChild("rename"), this.showHierarchyRenameDialog);
        this.listenClick(this.panels.hierarchy.getChild("warnings"), this.selectDuplicateHierarchyNames);
        this.listenClick(this.panels.hierarchy.getChild("searchBar").asCom.getChild("cancel"), this.clearHierarchySearch);
        this.listenEvent(
            this.panels.hierarchy.getChild("btnRelationDisabled"),
            fgui.Events.STATE_CHANGED,
            this.onHierarchyRelationsDisabledChanged,
        );
        this.listenEvent(
            this.panels.hierarchy.getChild("btnShowAllInvisibles"),
            fgui.Events.STATE_CHANGED,
            this.onHierarchyShowAllInvisiblesChanged,
        );
        this.listenClick(this.panels.preview.getChild("play"), this.onAction, ["preview:play"]);
        this.listenClick(this.panels.document.getChild("hand"), this.setDesktopPanTool, [true]);
        this.listenClick(this.panels.document.getChild("arrow"), this.setDesktopPanTool, [false]);
        const objectToolbar = this.panels.document.getChild("objToolbar").asCom;
        for (const action of OBJECT_TOOLBAR_ACTIONS) {
            this.listenClick(objectToolbar.getChild(action.childName), this.setDesktopObjectTool, [action.kind]);
        }
        this.listenClick(objectToolbar.getChild("group"), this.groupSelectedDisplayNodes);
        this.listenClick(objectToolbar.getChild("ungroup"), this.ungroupSelectedDisplayNodes);
        const alignToolbar = this.panels.document.getChild("alignToolbar").asCom;
        for (const action of ALIGN_TOOLBAR_ACTIONS) {
            this.listenClick(alignToolbar.getChild(action.childName), this.onAlignToolbarAction, [action.mode]);
        }
        for (const action of CUSTOM_ARRANGE_ACTIONS) {
            const button = alignToolbar.getChild(action.childName);
            this.listenClick(button, this.showCustomArrangePanel, [action.mode, button]);
        }
        this.listenEvent(this.panels.library.getChild("group"), fgui.Events.STATE_CHANGED, this.onLibraryFilterChanged);
        this.listenEvent(this.panels.library.getChild("listView"), fgui.Events.CLICK_ITEM, this.onLibraryItemClick);
        this.listenEvent(this.panels.library.getChild("treeView"), fgui.Events.CLICK_ITEM, this.onLibraryTreeItemClick);
        this.listenEvent(this.panels.library.getChild("listView"), Laya.Event.RIGHT_MOUSE_DOWN, this.onLibraryBackgroundRightClick);
        this.listenEvent(this.panels.library.getChild("treeView"), Laya.Event.RIGHT_MOUSE_DOWN, this.onLibraryBackgroundRightClick);
        this.listenClick(this.panels.library.getChild("btnCollapseAll"), this.collapseLibrary);
        this.listenEvent(this.panels.library.getChild("btnTwoColumn"), fgui.Events.STATE_CHANGED, this.layout);
        this.listenEvent(
            this.panels.library.getChild("iconSize").asCom.getChild("slider"),
            fgui.Events.STATE_CHANGED,
            this.onLibraryIconSizeChanged,
        );
        this.listenEvent(this.favoritesView.getChild("treeView"), fgui.Events.CLICK_ITEM, this.onLibraryTreeItemClick);
        this.listenClick(this.favoritesView.getChild("btnCollapseAll"), this.collapseFavorites);
        this.listenClick(this.favoritesView.getChild("btnExpandAll"), this.expandFavorites);
        this.listenClick(this.searchView.getChild("find"), this.refreshProjectSearch);
        this.listenEvent(this.searchInput, Laya.Event.KEY_DOWN, this.onSearchKeywordKeyDown);
        this.listenEvent(this.searchView.getChild("list"), fgui.Events.CLICK_ITEM, this.onSearchResultClick);
        this.listenClick(this.referenceView.getChild("find"), this.refreshProjectReferences);
        this.listenEvent(this.referenceInput, Laya.Event.KEY_DOWN, this.onReferenceInputKeyDown);
        this.listenEvent(this.referenceView.getController("queryType"), fgui.Events.STATE_CHANGED, this.refreshProjectReferences);
        this.listenEvent(this.referenceView.getChild("list"), fgui.Events.CLICK_ITEM, this.onReferenceResultClick);
        this.listenClick(this.testView.getChild("contentScaler"), this.openProjectSettingsDialog);
        this.listenEvent(this.panels.hierarchy.getChild("list"), fgui.Events.CLICK_ITEM, this.onHierarchyItemClick);
        this.bindStartSceneLinks();
    }

    private unbindActions(): void {
        for (const unbind of this.actionUnbinders.splice(0).reverse()) unbind();
    }

    private bindStartSceneLinks(): void {
        for (const childName of ["n3", "n4", "n5"]) {
            const link = this.startScene.getChild(childName);
            if (link) this.listenEvent(link, Laya.Event.LINK, this.onStartSceneLink);
        }
        this.listenEvent(
            this.startScene.getChild("recentList"),
            fgui.Events.CLICK_ITEM,
            this.onStartSceneRecentWorkspaceClick,
        );
    }

    private onLibraryDockTabClick(itemObject: fgui.GObject): void {
        const mode = itemObject.data as "library" | "favorites" | "search" | null;
        if (mode === "library") this.showLibraryPanel();
        else if (mode === "favorites") this.showFavoritesPanel();
        else if (mode === "search") this.showProjectSearch();
    }

    private listenClick(target: fgui.GObject, listener: ShellEventListener, args?: any[]): void {
        target.onClick(this, listener, args);
        this.actionUnbinders.push(() => target.offClick(this, listener));
    }

    private listenEvent(
        target: ShellEventTarget,
        type: string,
        listener: ShellEventListener,
        args?: any[],
    ): void {
        target.on(type, this, listener, args);
        this.actionUnbinders.push(() => { target.off(type, this, listener); });
    }

    private onStageResize(): void {
        this.layout();
    }

    private onStageMouseDown(event: Laya.Event): void {
        const object = fgui.GObject.cast(event.target as Laya.Sprite);
        this.hierarchyKeyboardActive = Boolean(
            object && (object === this.panels.hierarchy || this.panels.hierarchy.isAncestorOf(object)),
        );
        const timelineKeyboardActive = Boolean(
            object && (object === this.timelineView || this.timelineView.isAncestorOf(object)),
        );
        this.controllerTimeline.setKeyboardActive(timelineKeyboardActive);
        this.setDebugAttribute(
            "data-fairy-editor-timeline-keyboard",
            timelineKeyboardActive ? "active" : "inactive",
        );
    }

    private onStageKeyDown(event: Laya.Event): void {
        this.setDebugAttribute("data-fairy-editor-last-key", event.key);
        this.setDebugAttribute(
            "data-fairy-editor-canvas-focus",
            this.runtimePreview.hasCanvasFocus() ? "true" : "false",
        );
        this.setDebugAttribute("data-fairy-editor-focus", fgui.GRoot.inst.focus?.name || "");
        if (fgui.GRoot.inst.focus instanceof fgui.GTextInput) return;
        if (fgui.GRoot.inst.hasModalWindow) return;
        if (this.handleHierarchyKey(event)) return;

        const preferenceShortcut = resolveEditorShortcut(event, this.editorPreferences);
        if (preferenceShortcut) {
            this.handleEditorShortcut(preferenceShortcut, event);
            return;
        }
        if (this.handleEscapeKey(event) || this.handleCanvasPanKey(event)) return;
        if (event.ctrlKey || event.metaKey) {
            this.handleModifiedEditorKey(event);
            return;
        }
        if (this.handleTimelineKey(event) || this.handleSelectionKey(event)) return;
        this.handleCanvasKey(event);
    }

    private handleHierarchyKey(event: Laya.Event): boolean {
        if (!this.hierarchyKeyboardActive || event.ctrlKey || event.metaKey || event.altKey) return false;
        if (event.key === "F2") {
            event.preventDefault();
            this.showHierarchyRenameDialog();
            return true;
        }
        if (event.key === "Escape" && this.hierarchySearchQuery) {
            event.preventDefault();
            this.clearHierarchySearch();
            return true;
        }
        if (event.key === "Backspace") {
            event.preventDefault();
            this.setHierarchySearchQuery(this.hierarchySearchQuery.slice(0, -1));
            return true;
        }
        if (event.key.length !== 1) return false;
        event.preventDefault();
        this.setHierarchySearchQuery(this.hierarchySearchQuery + event.key.toLocaleLowerCase());
        return true;
    }

    private handleEscapeKey(event: Laya.Event): boolean {
        if (event.key !== "Escape") return false;
        if (this.publishedTest.isActive()) this.publishedTest.stop();
        else if (this.desktopObjectTool) {
            this.setDesktopObjectTool(null);
            this.setStatus("Canvas object creation cancelled.");
        } else if (this.cancelDockSplitterDrag(true)) {
            this.setStatus("Desktop splitter resize cancelled.");
        } else if (this.controllerTimeline.cancelTimelineDrag(true)) {
            this.setStatus("Timeline drag cancelled.");
        } else if (this.runtimePreview.cancelActiveInteraction()) {
            this.setStatus("Canvas drag cancelled.");
        } else if (this.runtimePreview.cancelGraphPointEditing()) {
            this.setDebugAttribute("data-fairy-editor-graph-point-editing", "inactive");
            this.setStatus("Polygon point editing exited.");
        } else {
            return false;
        }
        event.preventDefault();
        return true;
    }

    private handleCanvasPanKey(event: Laya.Event): boolean {
        if ((event.key !== " " && event.key !== "Space") || !this.runtimePreview.hasCanvasFocus()) return false;
        event.preventDefault();
        this.runtimePreview.setPanShortcutActive(true);
        this.setStatus("Hold Space and drag to pan the canvas.");
        return true;
    }

    private handleModifiedEditorKey(event: Laya.Event): void {
        const key = event.key.toLowerCase();
        const canvasFocused = this.runtimePreview.hasCanvasFocus();
        if (key === "a" && canvasFocused) {
            event.preventDefault();
            event.shiftKey ? this.selectNoDisplayNodes() : this.selectAllDisplayNodes();
        } else if ((key === "]" || key === "[") && canvasFocused) {
            event.preventDefault();
            void this.adjustSelectedDisplayNodeDepth(key === "]" ? "forward" : "backward");
        } else if (key === "c") {
            event.preventDefault();
            this.copySelectedDisplayNodes();
        } else if (key === "x") {
            event.preventDefault();
            this.cutSelectedDisplayNodes();
        } else if (key === "v") {
            event.preventDefault();
            void this.pasteDisplayNodes();
        } else if (key === "d" && !this.controllerTimeline.isTimelineFocused() && this.selectedDisplayNodeIds.length > 0) {
            event.preventDefault();
            void this.duplicateSelectedDisplayNodes();
        } else if (key === "g" && canvasFocused) {
            event.preventDefault();
            void (event.shiftKey ? this.ungroupSelectedDisplayNodes() : this.groupSelectedDisplayNodes());
        } else if (canvasFocused && (key === "=" || key === "+" || key === "-" || key === "0")) {
            event.preventDefault();
            if (key === "0") this.runtimePreview.resetView();
            else this.runtimePreview.adjustZoom(key === "-" ? 0.8 : 1.25);
            const view = this.runtimePreview.getViewState();
            this.setStatus(`Canvas view ${Math.round(view.zoom * 100)}% pan ${view.panX},${view.panY}.`);
        } else if (key === "z" && event.shiftKey && this.commandAdapter.canRedo()) {
            event.preventDefault();
            void this.redoCommand();
        }
    }

    private handleTimelineKey(event: Laya.Event): boolean {
        if (!this.controllerTimeline.isTimelineFocused()) return false;
        if (event.key === "Insert") void this.controllerTimeline.duplicateSelectedTimelineItem();
        else if (event.key === "Delete") void this.controllerTimeline.removeSelectedTimelineItem();
        else if (event.key === "Enter") this.controllerTimeline.showSelectedTimelineItemEditor();
        else return false;
        event.preventDefault();
        return true;
    }

    private handleSelectionKey(event: Laya.Event): boolean {
        if (event.key === "Enter" && (this.openSelectedGroup() || this.openReferencedComponent())) {
            event.preventDefault();
            return true;
        }
        if (event.key === "Delete" && this.selectedDisplayNodeIds.length > 0) {
            event.preventDefault();
            void this.deleteSelectedDisplayNodes();
            return true;
        }
        return false;
    }

    private handleCanvasKey(event: Laya.Event): void {
        if (event.altKey || !this.runtimePreview.hasCanvasFocus()) return;
        if (event.key.toLowerCase() === "g") {
            event.preventDefault();
            this.desktopSnapEnabled = !this.desktopSnapEnabled;
            this.runtimePreview.setSnapEnabled(this.desktopSnapEnabled, this.canvasSettings.gridSize);
            this.setDebugAttribute(
                "data-fairy-editor-canvas-snap",
                this.desktopSnapEnabled ? `${this.canvasSettings.gridSize}px` : "off",
            );
            this.setStatus(`Canvas snap ${this.desktopSnapEnabled ? `enabled at ${this.canvasSettings.gridSize}px` : "disabled"}.`);
            return;
        }
        const nudge = getDesktopCanvasNudge(event.key, event.shiftKey);
        if (!nudge) return;

        event.preventDefault();
        this.queueSelectedNodeNudge(nudge.x, nudge.y);
    }

    private handleEditorShortcut(id: EditorShortcutId, event: Laya.Event): void {
        event.preventDefault();
        this.runEditorAction(id);
        this.setDebugAttribute("data-fairy-editor-shortcut", id);
    }

    private onStageKeyUp(event: Laya.Event): void {
        if (event.key === " " || event.key === "Space") {
            this.runtimePreview.setPanShortcutActive(this.desktopPanToolEnabled);
        }
    }

    private setDesktopPanTool(enabled: boolean): void {
        this.controllerTimeline.setKeyboardActive(false);
        this.desktopObjectTool = null;
        this.runtimePreview.setCreationMode(false);
        this.desktopPanToolEnabled = enabled;
        this.runtimePreview.setPanShortcutActive(enabled);
        this.setDebugAttribute("data-fairy-editor-canvas-tool", enabled ? "pan" : "select");
        this.setStatus(`Canvas ${enabled ? "pan" : "select"} tool active.`);
    }

    private setDesktopObjectTool(kind: PrimitiveDisplayNodeKind | null): void {
        this.controllerTimeline.setKeyboardActive(false);
        this.desktopObjectTool = kind;
        this.desktopPanToolEnabled = false;
        this.runtimePreview.setPanShortcutActive(false);
        this.runtimePreview.setCreationMode(!!kind);
        this.panels.document.getController("editType").selectedIndex = 0;
        this.setDebugAttribute("data-fairy-editor-canvas-tool", kind ? `create-${kind}` : "select");
        if (kind) this.setStatus(`Canvas ${kind} tool active; click inside the component.`);
    }

    private selectAllDisplayNodes(): void {
        const component = this.getSelectedComponent();
        if (!component) return;
        const nodeIds = this.getScopedDisplayNodeIds(component);
        this.setDisplayNodeSelection(nodeIds, nodeIds[nodeIds.length - 1] || "");
        this.syncDisplayNodeSelectionViews();
        this.setDebugAttribute("data-fairy-editor-document-selection", `all:${nodeIds.length}`);
        this.setStatus(`Selected all ${nodeIds.length} display nodes.`);
    }

    private selectNoDisplayNodes(): void {
        this.clearDisplayNodeSelection();
        this.syncDisplayNodeSelectionViews();
        this.setDebugAttribute("data-fairy-editor-document-selection", "none");
        this.setStatus("Display-node selection cleared.");
    }

    private async adjustSelectedDisplayNodeDepth(
        direction: "forward" | "backward" | "top" | "bottom",
    ): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        const selectedIds = this.selectedDisplayNodeIds.slice();
        if (!selector || selectedIds.length === 0) return;
        const preparation = prepareAdjustDisplayNodeDepth(
            this.liveSessionBridge.getWorkingProject(),
            selectedIds.map((displayNodeId) => ({ ...selector, displayNodeId })),
            direction,
        );
        if (!await this.applyAuthoringPreparation(preparation)) return;

        this.setDisplayNodeSelection(selectedIds, this.selectedDisplayNodeId);
        this.persistProjectSelection();
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-document-depth", `${direction}:${selectedIds.join(",")}`);
        this.setStatus(
            `Moved ${selectedIds.length} display node${selectedIds.length === 1 ? "" : "s"} ${direction}; `
            + "Publish to update the runtime preview.",
        );
    }

    private async groupSelectedDisplayNodes(): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        const selectedIds = this.selectedDisplayNodeIds.slice();
        if (!selector) return;
        const preparation = prepareGroupDisplayNodes(
            this.liveSessionBridge.getWorkingProject(),
            selectedIds.map((displayNodeId) => ({ ...selector, displayNodeId })),
        );
        if (!preparation.ok) {
            await this.applyAuthoringPreparation(preparation);
            this.setDebugAttribute("data-fairy-editor-object-group", `rejected:${preparation.code}`);
            return;
        }
        const attach = (preparation.transaction.operations || [preparation.transaction.operation])
            .find((operation) => operation.kind === "attachDisplayNode");
        const groupId = String((attach?.node as { id?: unknown } | undefined)?.id || "");
        if (!await this.applyAuthoringPreparation(preparation)) return;

        this.setDisplayNodeSelection(groupId ? [groupId] : [], groupId);
        this.syncDisplayNodeSelectionViews();
        this.setDebugAttribute("data-fairy-editor-object-group", `grouped:${groupId}:${selectedIds.length}`);
        this.setStatus(
            `Grouped ${selectedIds.length} display nodes as ${groupId}; `
            + "Publish to update the runtime preview.",
        );
    }

    private async ungroupSelectedDisplayNodes(): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        if (!selector) return;
        const preparation = prepareUngroupDisplayNodes(
            this.liveSessionBridge.getWorkingProject(),
            this.selectedDisplayNodeIds.map((displayNodeId) => ({ ...selector, displayNodeId })),
        );
        if (!preparation.ok) {
            await this.applyAuthoringPreparation(preparation);
            this.setDebugAttribute("data-fairy-editor-object-group", `rejected:${preparation.code}`);
            return;
        }
        const memberIds = (preparation.transaction.operations || [preparation.transaction.operation])
            .flatMap((operation) => (
                operation.kind === "setDisplayNodeProps" && operation.props.group !== undefined
                    ? [operation.selector.displayNodeId]
                    : []
            ));
        if (!await this.applyAuthoringPreparation(preparation)) return;

        const primaryId = memberIds[memberIds.length - 1] || "";
        this.setDisplayNodeSelection(memberIds, primaryId);
        this.syncDisplayNodeSelectionViews();
        this.setDebugAttribute("data-fairy-editor-object-group", `ungrouped:${memberIds.join(",") || "empty"}`);
        this.setStatus(
            "Ungrouped selection. Publish to update the runtime preview.",
        );
    }

    private async placeDesktopPrimitive(point: { x: number; y: number }): Promise<boolean> {
        const kind = this.desktopObjectTool;
        const selector = this.getSelectedComponentSelector();
        if (!kind || !selector) return false;
        this.desktopObjectTool = null;
        this.runtimePreview.setCreationMode(false);
        const preparation = prepareAddPrimitiveDisplayNode(
            this.liveSessionBridge.getWorkingProject(),
            selector,
            kind,
            point,
        );
        if (preparation.ok === false) {
            await this.applyAuthoringPreparation(preparation);
            return false;
        }
        const operation = (preparation.transaction.operations || [preparation.transaction.operation])
            .find((candidate) => candidate.kind === "attachDisplayNode");
        const nodeId = String((operation?.node as { id?: unknown } | null)?.id || "");
        const applied = await this.applyAuthoringPreparation(preparation);
        if (!applied) return false;

        this.setDesktopObjectTool(null);
        this.setDisplayNodeSelection(nodeId ? [nodeId] : [], nodeId);
        this.syncDisplayNodeSelectionViews();
        this.setDebugAttribute(
            "data-fairy-editor-object-create",
            `${kind}:${nodeId}@${point.x},${point.y}`,
        );
        this.setStatus(
            `Created ${kind} ${nodeId} at ${point.x},${point.y}; `
            + "Publish to update the runtime preview.",
        );
        return true;
    }

    private onMenuItemClick(item: fgui.GButton): void {
        const action = item.data as ShellAction;
        if (action === "menu:file") {
            this.showFileMenu(item);
            return;
        }

        if (action === "menu:edit") {
            this.editorMenus.showEditMenu(item);
            return;
        }

        if (action === "menu:resource") {
            this.resourceAuthoring.showResourceMenu(item);
            return;
        }

        if (action === "menu:tools") {
            this.showToolsMenu(item);
            return;
        }

        if (action === "menu:view") {
            this.editorMenus.showViewMenu(item);
            return;
        }

        if (action === "menu:help") {
            this.showHelpMenu(item);
            return;
        }

        this.onAction(action);
    }

    private runEditorMenuCommand(command: EditorMenuCommand): void {
        switch (command) {
            case "undo": this.runEditorAction("undo"); return;
            case "redo": this.runEditorAction("redo"); return;
            case "cut": this.cutSelectedDisplayNodes(); return;
            case "copy": this.copySelectedDisplayNodes(); return;
            case "paste": void this.pasteDisplayNodes(); return;
            case "duplicate": void this.duplicateSelectedDisplayNodes(); return;
            case "delete": void this.deleteSelectedDisplayNodes(); return;
            case "replace": this.showReplaceObjectDialog(); return;
            case "selectAll": this.selectAllDisplayNodes(); return;
            case "selectNone": this.selectNoDisplayNodes(); return;
            case "moveForward": void this.adjustSelectedDisplayNodeDepth("forward"); return;
            case "moveBackward": void this.adjustSelectedDisplayNodeDepth("backward"); return;
            case "moveTop": void this.adjustSelectedDisplayNodeDepth("top"); return;
            case "moveBottom": void this.adjustSelectedDisplayNodeDepth("bottom"); return;
            case "openGroup": this.openSelectedGroup(); return;
            case "closeGroup": this.closeSelectedGroup(); return;
            case "showInLibrary": this.showSelectedDisplayNodeInLibrary(); return;
            case "timelineAdd": this.controllerTimeline.showAddTimelineItemEditor(); return;
            case "timelineDuplicate": void this.controllerTimeline.duplicateSelectedTimelineItem(); return;
            case "timelineEdit": this.controllerTimeline.showSelectedTimelineItemEditor(); return;
            case "timelineRemove": void this.controllerTimeline.removeSelectedTimelineItem(); return;
            case "workspace": this.showEditorWorkspace(); this.setTransientStatus("Editor workspace opened."); return;
            case "startScene": this.showStartScene(); return;
            case "toggleHierarchy": this.toggleHierarchyExpansion(); return;
            case "search": this.showProjectSearch(); return;
            case "showLibrary": this.showLibraryPanel(); return;
            case "showFavorites": this.showFavoritesPanel(); return;
            case "showTransitions": this.controllerTimeline.showTransitionList(); return;
            case "toggleLeftDock": this.toggleDesktopDock("left"); return;
            case "toggleInspectorDock": this.toggleDesktopDock("inspector"); return;
            case "toggleTimeline": this.toggleTimeline(); return;
            case "toggleConsole": this.toggleDesktopConsole(); return;
            case "previousDocument": this.cycleDocumentTab(-1); return;
            case "nextDocument": this.cycleDocumentTab(1); return;
            case "closeDocument": {
                const document = this.getActiveDocumentTab();
                if (document) this.onDocumentTabClose(document);
                return;
            }
            case "closeOtherDocuments": this.closeOtherDocuments(); return;
            case "closeAllDocuments": this.closeAllDocuments(); return;
            case "openReferencedComponent": this.openReferencedComponent(); return;
            case "playRuntimeTransition": this.controllerTimeline.playRuntimePreviewTransition(); return;
        }
    }

    private onStartSceneLink(link: string): void {
        if (link === "create") {
            void this.createBrowserWorkspace();
            return;
        }

        if (link === "open" || link === "import_project") {
            this.showEditorWorkspace();
            this.showProjectImportDialog();
            return;
        }

        if (link === "open_folder") {
            this.showEditorWorkspace();
            this.importProjectDirectory();
            return;
        }

        this.setTransientStatus(`Start scene link ignored: ${link}.`);
    }

    private onStartSceneRecentWorkspaceClick(itemObject: fgui.GObject): void {
        const entry = itemObject.data as BrowserWorkspaceRegistryEntry | null;
        if (!entry) return;
        this.showEditorWorkspace();
        void this.switchBrowserWorkspace(entry);
    }

    private showFileMenu(anchor: fgui.GObject): void {
        const menu = this.createActionMenu();

        this.addMenuItem(menu, "workspaceMenuImportProject", "导入项目...", () => {
            this.showProjectImportDialog();
        });
        this.addMenuItem(menu, "workspaceMenuImportFolder", "从文件夹导入...", () => {
            this.importProjectDirectory();
        });
        this.addMenuItem(menu, "workspaceMenuImportZip", "从 ZIP 导入...", () => {
            this.importProjectZip();
        });
        menu.addSeperator();
        this.addMenuItem(menu, "browserWorkspaceNewMenu", "新建浏览器工作区…", () => {
            void this.createBrowserWorkspace();
        });
        this.addMenuItem(menu, "workspaceMenuWorkspace", "浏览器工作区...", () => {
            this.showBrowserWorkspaceSelector();
        });
        this.addMenuItem(menu, "browserWorkspaceCloseMenu", "关闭当前工作区", () => {
            void this.closeBrowserWorkspace();
        });
        this.addMenuItem(menu, "workspaceMenuStartScene", "开始页...", () => {
            this.showStartScene();
        });
        this.addMenuItem(menu, "workspaceMenuSave", "保存", () => {
            this.runEditorAction("save");
        }, this.editorPreferences.shortcuts.save);
        this.addMenuItem(menu, "workspaceMenuExport", "导出工作区 ZIP", () => {
            this.runEditorAction("toolbar:exportWorkspace");
        });
        this.showActionMenu(menu, anchor, "file", "已打开文件菜单。");
    }

    private addMenuItem(
        menu: fgui.PopupMenu,
        name: string,
        title: string,
        handler: () => void,
        shortcut = "",
    ): fgui.GButton {
        const item = menu.addItem(title, handler);
        item.name = name;
        const shortcutField = item.getChild("shortcut");
        if (shortcutField) {
            shortcutField.text = shortcut;
        }
        return item;
    }

    private createActionMenu(): fgui.PopupMenu {
        this.actionMenu?.dispose();
        const menu = new fgui.PopupMenu();
        this.actionMenu = menu;
        return menu;
    }

    private showActionMenu(menu: fgui.PopupMenu, anchor: fgui.GObject | null, name: string, status: string): void {
        menu.contentPane.setSize(248, menu.contentPane.height);
        this.setDebugAttribute("data-fairy-editor-menu", name);
        this.setDebugAttribute("data-fairy-editor-file-menu", name === "file" ? "open" : "closed");
        this.setTransientStatus(status);
        menu.show(anchor || undefined);
    }

    private getSelectedLibraryResourceSelectors(): EditorResourceSelector[] {
        return this.libraryController.getSelectedResourceSelectors(this.leftTopPanelMode);
    }

    private applyClickedLibrarySelection(data: LibraryItemData | null, list: fgui.GList): void {
        this.libraryController.handleItemClick(data, list);
    }

    private showToolsMenu(anchor: fgui.GObject): void {
        const menu = this.createActionMenu();
        this.addMenuItem(menu, "desktopMenuPreferences", "偏好设置…", () => {
            this.showPreferencesDialog();
        });
        this.addMenuItem(menu, "desktopMenuBrowserPlugins", "浏览器插件…", () => {
            this.showBrowserPluginDialog();
        });
        menu.addSeperator();
        this.addMenuItem(menu, "desktopMenuProjectSettings", "项目设置...", () => {
            this.onAction("menu:tools");
        });
        this.addMenuItem(menu, "desktopMenuStrings", "字符串导入和导出…", () => {
            openStringsFunctionDialog({
                getWorkingProject: () => this.liveSessionBridge.getWorkingProject(),
                getActiveDialog: () => this.authoringJsonDialog,
                setActiveDialog: (dialog) => { this.authoringJsonDialog = dialog; },
                applyPreparation: (preparation) => this.applyAuthoringPreparation(preparation),
                applyDisplayNodeCommands: (commands, summary) => this.applyDisplayNodePropsCommands(commands, summary),
                download: (blob, fileName) => this.downloadWorkspaceExport(blob, fileName),
                runWorkspaceTextFileTask: async () => undefined,
                setStatus: (message) => this.setStatus(message),
                eventOwner: this,
            });
        });
        this.addMenuItem(menu, "desktopMenuWorkspace", "浏览器工作区...", () => {
            this.showBrowserWorkspaceSelector();
        });
        const resourceHealth = this.addMenuItem(menu, "desktopMenuResourceHealth", "资源健康…", () => {
            this.showResourceHealthDialog();
        });
        setEditorFormActionEnabled(resourceHealth, this.commandAdapter.getSessionState().liveSession);
        const pluginContributions = this.browserPluginHost.menuContributions();
        if (pluginContributions.length > 0) {
            menu.addSeperator();
            for (const contribution of pluginContributions) {
                this.addMenuItem(menu, `browserPlugin:${contribution.id}`, contribution.title, () => {
                    void this.runBrowserPluginContribution(contribution);
                });
            }
        }
        this.showActionMenu(menu, anchor, "tools", "已打开工具菜单。");
    }

    private showCanvasSettings(): void {
        const panel = fgui.UIPackage.createObject("Builder", "CanvasSettingsPanel").asCom;
        panel.name = "desktopCanvasSettingsPanel";
        const check = (name: string): fgui.GButton => panel.getChild(name).asButton;
        const numeric = (name: string): fgui.GLabel => panel.getChild(name).asLabel;
        check("auxline1").selected = this.canvasSettings.componentEdge;
        check("auxline2").selected = this.canvasSettings.alignmentGuides;
        check("docScaleOption").selected = this.canvasPerDocumentZoom;
        check("showGrid").selected = this.canvasSettings.showGrid;
        check("snapToGrid").selected = this.desktopSnapEnabled;
        numeric("gridSize").title = String(this.canvasSettings.gridSize);
        numeric("gridColor").title = String(this.canvasSettings.gridBrightness);

        let backgroundColor = this.canvasSettings.backgroundColor;
        let canvasColor = this.canvasSettings.canvasColor;
        const pickers: HTMLInputElement[] = [];
        const bindColor = (name: "backgroundColor" | "canvasColor", get: () => string, set: (value: string) => void): void => {
            const button = panel.getChild(name).asButton;
            const swatch = button.getChild("n1").asGraph;
            swatch.fillColor = get();
            button.tooltips = get();
            button.onClick(this, () => {
                const input = document.createElement("input");
                input.type = "color";
                input.value = get();
                input.setAttribute("aria-label", name === "backgroundColor" ? "Canvas background color" : "Component canvas color");
                input.style.position = "fixed";
                input.style.left = "-100px";
                input.style.top = "-100px";
                input.addEventListener("input", () => {
                    set(input.value);
                    swatch.fillColor = input.value;
                    button.tooltips = input.value;
                    apply();
                });
                input.addEventListener("change", () => input.remove(), { once: true });
                document.body.appendChild(input);
                pickers.push(input);
                input.click();
            });
        };
        const apply = (): void => {
            const gridSize = Number(numeric("gridSize").title.trim());
            const brightness = Number(numeric("gridColor").title.trim());
            if (!Number.isFinite(gridSize) || gridSize < 1 || !Number.isFinite(brightness)) {
                this.setStatus("网格大小必须大于 0，亮度必须是数字。", "error");
                return;
            }
            this.canvasSettings = {
                backgroundColor,
                canvasColor,
                componentEdge: check("auxline1").selected,
                alignmentGuides: check("auxline2").selected,
                showGrid: check("showGrid").selected,
                gridSize: Math.trunc(gridSize),
                gridBrightness: Math.max(0, Math.min(100, Math.trunc(brightness))),
            };
            this.canvasPerDocumentZoom = check("docScaleOption").selected;
            this.desktopSnapEnabled = check("snapToGrid").selected;
            this.runtimePreview.setCanvasSettings(this.canvasSettings);
            this.runtimePreview.setSnapEnabled(this.desktopSnapEnabled, this.canvasSettings.gridSize);
            this.saveResourceViewState();
            this.setDebugAttribute(
                "data-fairy-editor-canvas-settings",
                `${this.canvasSettings.backgroundColor}:${this.canvasSettings.canvasColor}:${this.canvasSettings.showGrid}:${this.canvasSettings.gridSize}:${this.desktopSnapEnabled}`,
            );
        };
        bindColor("backgroundColor", () => backgroundColor, (value) => { backgroundColor = value; });
        bindColor("canvasColor", () => canvasColor, (value) => { canvasColor = value; });
        for (const name of ["auxline1", "auxline2", "docScaleOption", "showGrid", "snapToGrid"]) {
            panel.getChild(name).on(fgui.Events.STATE_CHANGED, this, apply);
        }
        for (const name of ["gridSize", "gridColor"]) {
            const field = numeric(name).getTextField();
            if (field instanceof fgui.GTextInput) field.on(Laya.Event.BLUR, this, apply);
        }
        panel.on(Laya.Event.UNDISPLAY, this, () => {
            for (const input of pickers) input.remove();
        });
        apply();
        fgui.GRoot.inst.showPopup(panel, this.toolbar.getChild("tbCanvas"));
        this.setDebugAttribute("data-fairy-editor-canvas-settings-popup", "open");
        this.setStatus("已打开画布显示设置。");
    }

    private async initializeBrowserPlugins(): Promise<void> {
        try {
            await this.browserPluginHost.initialize();
            if (this.disposed) return;
            this.refreshBrowserPluginDebugState();
        } catch (error) {
            this.setDebugAttribute("data-fairy-editor-plugin-host", "error");
            console.error("[BrowserPlugin] initialization failed", error);
        }
    }

    private showBrowserPluginDialog(): void {
        openBrowserPluginDialog({
            list: () => this.browserPluginHost.list(),
            install: () => void this.installBrowserPlugin(),
            reload: async (pluginId) => {
                await this.browserPluginHost.reload(pluginId);
                if (this.disposed) return;
                this.refreshBrowserPluginDebugState();
            },
            setEnabled: async (pluginId, enabled) => {
                await this.browserPluginHost.setEnabled(pluginId, enabled);
                if (this.disposed) return;
                this.refreshBrowserPluginDebugState();
            },
            getActiveDialog: () => this.authoringJsonDialog,
            setActiveDialog: (dialog) => { this.authoringJsonDialog = dialog; },
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
            setStatus: (message) => this.setStatus(message),
            eventOwner: this,
        });
    }

    private async installBrowserPlugin(): Promise<void> {
        const manifestUrl = await this.authoringDialogs.requestTextInput(
            "browserPluginInstallDialog",
            "安装浏览器插件",
            "请输入 HTTPS 清单 URL；新插件安装后默认停用。",
            "",
            "安装",
        );
        if (this.disposed) return;
        if (manifestUrl === null || !manifestUrl.trim()) return;
        try {
            const plugin = await this.browserPluginHost.install(manifestUrl.trim(), false);
            if (this.disposed) return;
            this.refreshBrowserPluginDebugState();
            this.setDebugAttribute("data-fairy-editor-plugin-install", plugin.id);
            this.setStatus(`浏览器插件 ${plugin.name} 已安装并保持停用；请检查权限后再启用。`);
            this.showBrowserPluginDialog();
        } catch (error) {
            this.setDebugAttribute("data-fairy-editor-plugin-install", "failed");
            this.setStatus(`浏览器插件安装失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async runBrowserPluginContribution(contribution: BrowserPluginMenuContribution): Promise<void> {
        this.setDebugAttribute("data-fairy-editor-plugin-invoke", `${contribution.pluginId}:${contribution.id}:pending`);
        try {
            const result = await this.browserPluginHost.invoke(
                contribution.pluginId,
                contribution.id,
                this.createBrowserPluginContext(),
            );
            if (this.disposed) return;
            const commands = validateBrowserPluginWriteCommands(
                result,
                this.getSelectedDisplayNodeSelector(),
            );
            if (commands.length > 0) {
                const applied = await this.applyDisplayNodePropsCommands(
                    commands,
                    `browser plugin ${contribution.id}`,
                );
                if (!applied) return;
            }
            if (result.panel) this.showBrowserPluginPanel(result.panel.title, result.panel.lines);
            this.setDebugAttribute(
                "data-fairy-editor-plugin-invoke",
                `${contribution.pluginId}:${contribution.id}:ok:${commands.length}`,
            );
            this.setStatus(`浏览器插件已完成：${contribution.title}。`);
        } catch (error) {
            await this.browserPluginHost.setEnabled(contribution.pluginId, false).catch(() => undefined);
            this.refreshBrowserPluginDebugState();
            this.setDebugAttribute("data-fairy-editor-plugin-invoke", `${contribution.pluginId}:${contribution.id}:failed`);
            this.setStatus(`浏览器插件执行失败并已停用：${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private createBrowserPluginContext(): unknown {
        const activeWorkspace = this.workspaceLifecycle.registry.entries.find(
            (entry) => entry.id === this.projectStorage.getWorkspaceName(),
        );
        const selector = this.getSelectedDisplayNodeSelector();
        const snapshotNode = this.getSelectedDisplayNode();
        const liveNode = selector
            ? findDisplayNode(this.liveSessionBridge.getWorkingProject(), selector)
            : null;
        return {
            workspace: {
                id: this.projectStorage.getWorkspaceName(),
                name: activeWorkspace?.name || "浏览器工作区",
            },
            project: this.projectSnapshot ? {
                id: this.projectSnapshot.project.id,
                packages: this.projectSnapshot.totals.packages,
                components: this.projectSnapshot.totals.components,
                displayObjects: this.projectSnapshot.totals.displayObjects,
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
    }

    private showBrowserPluginPanel(title: string, lines: string[]): void {
        openBrowserPluginPanel({
            getActiveDialog: () => this.authoringJsonDialog,
            setActiveDialog: (dialog) => { this.authoringJsonDialog = dialog; },
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
            eventOwner: this,
        }, title, lines);
    }

    private refreshBrowserPluginDebugState(): void {
        const plugins = this.browserPluginHost.list();
        const ready = plugins.filter((plugin) => plugin.enabled && plugin.state === "ready");
        this.setDebugAttribute("data-fairy-editor-plugin-host", "ready");
        this.setDebugAttribute("data-fairy-editor-plugin-count", String(plugins.length));
        this.setDebugAttribute("data-fairy-editor-plugin-ready", String(ready.length));
        this.setDebugAttribute(
            "data-fairy-editor-plugin-sandbox",
            ready.map((plugin) => `${plugin.id}:dom=${plugin.environment?.dom};opfs=${plugin.environment?.opfs}`).join("|"),
        );
    }

    private showPreferencesDialog(): void {
        openPreferencesDialog({
            getPreferences: () => this.editorPreferences,
            updatePreferences: (preferences) => this.updateEditorPreferences(preferences),
            requestShortcut: (id, current) => this.requestEditorShortcut(id, current),
            resetLayout: () => this.resetDesktopLayout(),
            getActiveDialog: () => this.authoringJsonDialog,
            setActiveDialog: (dialog) => { this.authoringJsonDialog = dialog; },
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
            setStatus: (message) => this.setStatus(message),
            eventOwner: this,
        });
    }

    private requestEditorShortcut(id: EditorShortcutId, current: string): Promise<string | null> {
        return this.authoringDialogs.requestTextInput(
            "desktopShortcutInputDialog",
            "编辑快捷键",
            `请输入 ${id} 的快捷键（例如 Ctrl+F）；留空可取消分配。`,
            current,
            "应用",
        );
    }

    private showResourceHealthDialog(): void {
        openResourceHealthDialog({
            getWorkingProject: () => this.liveSessionBridge.getWorkingProject(),
            getActiveDialog: () => this.authoringJsonDialog,
            setActiveDialog: (dialog) => { this.authoringJsonDialog = dialog; },
            countIncomingReferences: (selector) => queryProjectResourceReferences(
                this.liveSessionBridge.getWorkingProject(),
                selector,
                "incoming",
            ).reduce((count, reference) => count + reference.count, 0),
            locate: (entry) => {
                this.navigateProjectResult({
                    kind: "resource",
                    packageId: entry.packageId,
                    resourceId: entry.resourceId,
                    label: `${entry.packageName}/${entry.name}`,
                });
                this.setDebugAttribute(
                    "data-fairy-editor-resource-health-selection",
                    `${entry.packageId}/${entry.resourceId}`,
                );
                this.setStatus(`已在资源库中定位 ${entry.packageName}/${entry.name}。`);
            },
            repair: (issue, entries) => this.resourceAuthoring.repairResourceHealthIssue(issue, entries),
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
            setStatus: (message) => this.setStatus(message),
            eventOwner: this,
        });
    }

    private showHelpMenu(anchor: fgui.GObject): void {
        const menu = this.createActionMenu();
        this.addMenuItem(menu, "desktopMenuAbout", "关于 FairyGUI 编辑器", () => {
            this.showAboutDialog();
        });
        this.showActionMenu(menu, anchor, "help", "已打开帮助菜单。");
    }

    private showAboutDialog(): void {
        this.authoringJsonDialog?.dispose();
        const dialog = new fgui.Window();
        dialog.modal = true;
        dialog.name = "aboutDialog";
        const content = fgui.UIPackage.createObject("Builder", "AboutDialog").asCom;
        dialog.contentPane = content;
        content.getChild("msg").asRichTextField.text = "基于 OpenFairyGUI 的浏览器版 FairyGUI 编辑器";
        const links = content.getChild("license").asRichTextField;
        links.text = [
            "“FairyGUI”名称、官方 Logo 及相关品牌标识的权利归其权利人所有。本项目并非 FairyGUI 官方产品。",
            "",
            `[url=${EDITOR_REPOSITORY_URL}]GitHub 仓库[/url]`,
            `[url=${FAIRYGUI_WEBSITE_URL}]FairyGUI 官网[/url]`,
        ].join("\n");
        links.on(Laya.Event.LINK, this, this.onAboutDialogLink);
        content.getChild("n14").asButton.onClick(this, () => dialog.dispose());
        dialog.on(Laya.Event.UNDISPLAY, this, () => {
            if (this.authoringJsonDialog === dialog) this.authoringJsonDialog = null;
        });
        this.authoringJsonDialog = dialog;
        dialog.show();
        dialog.centerOn(fgui.GRoot.inst, true);
    }

    private onAboutDialogLink(url: string): void {
        if (url !== EDITOR_REPOSITORY_URL && url !== FAIRYGUI_WEBSITE_URL) return;
        const opened = window.open(url, "_blank");
        if (!opened) {
            this.setTransientStatus("浏览器阻止了打开外部链接。");
            return;
        }
        opened.opener = null;
        this.setTransientStatus("已在浏览器打开外部链接。");
    }

    private showSelectedResourceInspector(): void {
        const resource = this.getSelectedResource();
        if (!resource) {
            this.renderInspectorLines(["未选择资源"]);
            this.layoutInspectorLines();
            this.setTransientStatus("Resource inspector requires a selected resource.");
            return;
        }

        this.renderResourceInspector(resource);
        this.setTransientStatus(`Resource inspector opened: ${resource.name || resource.id}.`);
    }

    private showStartScene(): void {
        this.populateStartSceneRecentWorkspaces();
        this.mainView.getController("start").selectedIndex = 1;
        this.startScene.visible = true;
        this.layout();
        this.setTransientStatus("Start scene opened.");
    }

    private populateStartSceneRecentWorkspaces(): void {
        const list = this.startScene.getChild("recentList").asList;
        list.removeChildrenToPool();
        const entries = [...this.workspaceLifecycle.registry.entries]
            .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
        for (const entry of entries) {
            const item = list.addItemFromPool().asButton;
            item.data = entry;
            item.getChild("title").asRichTextField.text = entry.name;
            item.getChild("path").asTextField.text = `${entry.fairyPath} · ${new Date(entry.lastOpenedAt).toLocaleString("zh-CN")}`;
            item.getChild("delete").visible = false;
            item.tooltips = `打开 ${entry.name}`;
        }
    }

    private showEditorWorkspace(): void {
        this.mainView.getController("start").selectedIndex = 0;
        this.startScene.visible = false;
        this.layout();
    }

    private toggleHierarchyExpansion(): void {
        this.hierarchyExpanded = !this.hierarchyExpanded;
        const tree = this.panels.hierarchy.getChild("list").asTree;
        if (this.hierarchyExpanded) tree.expandAll();
        else tree.collapseAll();
        this.setDebugAttribute("data-fairy-editor-hierarchy-expanded", String(this.hierarchyExpanded));
        this.setTransientStatus(`Hierarchy ${this.hierarchyExpanded ? "expanded" : "collapsed"}.`);
    }

    private toggleTimeline(): void {
        this.timelineVisible = !this.timelineVisible;
        if (this.timelineVisible) this.consoleVisible = false;
        else this.controllerTimeline.setKeyboardActive(false);
        this.layout();
        this.saveDesktopLayoutState();
        this.setTransientStatus(`Timeline ${this.timelineVisible ? "shown" : "hidden"}.`);
    }

    private showDesktopConsole(): void {
        if (this.consoleVisible) return;
        this.consoleVisible = true;
        this.timelineVisible = false;
        this.controllerTimeline.setKeyboardActive(false);
        this.layout();
        this.saveDesktopLayoutState();
        this.setTransientStatus("Console shown.");
    }

    private toggleDesktopConsole(): void {
        if (!this.consoleVisible) {
            this.showDesktopConsole();
            return;
        }
        this.consoleVisible = false;
        this.layout();
        this.saveDesktopLayoutState();
        this.setTransientStatus("Console hidden.");
    }

    private clearDesktopConsole(): void {
        this.consoleEntries = [];
        this.populateDesktopConsole();
    }

    private async copyDesktopConsole(): Promise<void> {
        const list = this.consoleView.getChild("list").asList;
        const text = getDesktopConsoleCopyText(this.consoleEntries, list.getSelection());
        if (!text) {
            this.setStatus("Select console entries before copying.");
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            this.setStatus("Selected console entries copied.");
        } catch (error) {
            this.setStatus(`Console copy failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
    }

    private populateDesktopConsole(): void {
        const list = this.consoleView.getChild("list").asList;
        list.removeChildrenToPool();
        for (const [index, entry] of this.consoleEntries.entries()) {
            const item = list.addItemFromPool() as EditorConsoleItem;
            item.render(entry, index, list.width);
        }
        list.scrollPane?.scrollBottom();
        this.setDebugAttribute("data-fairy-editor-console-count", String(this.consoleEntries.length));
    }

    private onAction(action: ShellAction): void {
        this.runEditorAction(action);
    }

    private onToolbarBranchChanged(): void {
        const branch = this.toolbar.getChild("branches").asComboBox.value;
        if (branch === this.activeBranch) return;
        this.activeBranch = branch;
        fgui.UIPackage.branch = branch;
        this.libraryController.setActiveBranch(branch);
        const testActive = this.publishedTest.isActive();
        this.runtimePreview.resetRuntimePackages();
        this.refreshProjectViews();
        if (testActive) this.publishedTest.reload();
        this.setDebugAttribute("data-fairy-editor-active-branch", branch || "main");
        this.saveResourceViewState();
        this.setStatus(`当前分支：${branch || "main"}。`);
    }

    private onToolbarLanguageChanged(): void {
        const path = this.toolbar.getChild("lang").asComboBox.value;
        if (path === this.activeLanguagePath) return;
        void this.enqueueAuthoringOperation(async () => {
            const state = await this.projectStorage.initialize();
            const adapter = this.projectStorage.getAdapter();
            if (!state.available || !adapter) {
                this.setStatus(state.error || "浏览器工作区不可用。", "error");
                return false;
            }
            if (path && !await adapter.exists(path)) {
                this.setStatus(`语言文件不存在：${path}。`, "error");
                this.refreshToolbarSettingsSelectors();
                return false;
            }
            const source = path ? await adapter.readFile(path) : "";
            fgui.UIPackage.setStringsSource(source);
            this.activeLanguagePath = path;
            const testActive = this.publishedTest.isActive();
            this.runtimePreview.resetRuntimePackages();
            this.refreshProjectViews();
            if (testActive) this.publishedTest.reload();
            this.setDebugAttribute("data-fairy-editor-active-language", path || "default");
            this.saveResourceViewState();
            this.setStatus(`当前语言：${path || "default"}。`);
            return true;
        });
    }

    private onToolbarViewScaleChanged(): void {
        const zoom = Number(this.toolbar.getChild("viewScale").asComboBox.value);
        if (!Number.isFinite(zoom) || zoom <= 0) return;
        this.runtimePreview.setViewState(zoom, 0, 0);
    }

    private onLibraryTreeItemClick(itemObject: fgui.GObject): void {
        this.controllerTimeline.setKeyboardActive(false);
        const data = itemObject.treeNode ? (itemObject.treeNode.data as LibraryItemData | null) : null;
        this.applyClickedLibrarySelection(data, itemObject.parent as fgui.GList);
    }

    private onLibraryFilterChanged(): void {
        this.libraryController.handleFilterChanged();
    }

    private onLibrarySyncChanged(): void {
        this.libraryLinked = this.panels.library.getChild("btnSync").asButton.selected;
        this.saveResourceViewState();
        this.setDebugAttribute("data-fairy-editor-library-linked", String(this.libraryLinked));
        if (this.libraryLinked) this.locateActiveDocumentInLibrary(false);
        else this.setStatus("资源库已取消与当前文档联动。");
    }

    private onLibraryIconSizeChanged(): void {
        const value = this.panels.library.getChild("iconSize").asCom.getChild("slider").asSlider.value;
        this.libraryController.setIconSizeStep(value);
        this.populateLibraryFromSnapshot();
        this.setDebugAttribute("data-fairy-editor-library-icon-size", String(value));
        this.setStatus(`资源缩略图尺寸：${value + 1}/6。`);
    }

    private locateActiveDocumentInLibrary(reportStatus = true): void {
        const document = this.getActiveDocumentTab();
        if (!document) {
            if (reportStatus) this.setStatus("定位当前文档需要先打开一个组件。");
            return;
        }
        this.showEditorWorkspace();
        if (!this.leftDockVisible) {
            this.leftDockVisible = true;
            this.saveDesktopLayoutState();
        }
        this.leftTopPanelMode = "library";
        this.libraryPackageId = document.packageId;
        this.selectedLibraryResourceSelectors = [{
            packageId: document.packageId,
            resourceId: document.componentId,
        }];
        this.libraryController.setInspectorSelection({
            kind: "resource",
            packageId: document.packageId,
            resourceId: document.componentId,
        });
        this.populateLibraryFromSnapshot();
        this.layout();
        this.setDebugAttribute(
            "data-fairy-editor-library-locate-document",
            getDesktopDocumentTabId(document),
        );
        if (reportStatus) this.setStatus(`已在资源库中定位 ${this.getSelectedComponent()?.name || document.componentId}。`);
    }

    private onLibraryItemClick(itemObject: fgui.GObject): void {
        this.controllerTimeline.setKeyboardActive(false);
        this.applyClickedLibrarySelection(itemObject.data as LibraryItemData | null, itemObject.parent as fgui.GList);
    }

    private openLibraryItem(data: Extract<LibraryItemData, { kind: "component" | "resource" }>): void {
        this.controllerTimeline.setKeyboardActive(false);
        if (data.kind === "component") {
            if (!this.activateDocumentTab({ packageId: data.packageId, componentId: data.componentId })) return;
            this.setDebugAttribute("data-fairy-editor-library-open", `Component:${data.packageId}/${data.componentId}`);
            this.setStatus(`Opened component ${this.getSelectedComponent()?.name || data.componentId}.`);
            return;
        }

        this.applyLibrarySelection(data);
        const resource = this.findResource(data.packageId, data.resourceId);
        if (!resource) return;
        this.setDebugAttribute("data-fairy-editor-library-open", `${resource.type}:${data.packageId}/${data.resourceId}`);
        if (resource.type === "ImageResource") {
            this.authoringDialogs.showImageEditor();
        } else if (resource.type === "MovieClipResource") {
            this.authoringDialogs.showMovieClipEditor();
        } else if (resource.type === "FontResource") {
            this.authoringDialogs.showFontEditor();
        } else {
            this.resourcePreview.openWithBrowser(data.packageId, resource);
        }
    }

    private showLibraryContextMenu(cell: fgui.GComponent, data: LibraryItemData): void {
        this.controllerTimeline.setKeyboardActive(false);
        const list = cell.parent as fgui.GList;
        const index = list.getChildIndex(cell);
        if (index >= 0 && !list.getSelection().includes(index)) {
            this.treeInteraction.resetLibrarySelection(list);
            list.addSelection(index);
        }
        this.applyClickedLibrarySelection(data, list);
        if (data.kind === "component") {
            this.libraryController.setInspectorSelection({
                kind: "resource",
                packageId: data.packageId,
                resourceId: data.componentId,
            });
        }
        this.setDebugAttribute(
            "data-fairy-editor-library-context",
            data.kind === "component"
                ? `${data.kind}:${data.packageId}/${data.componentId}`
                : data.kind === "resource"
                    ? `${data.kind}:${data.packageId}/${data.resourceId}`
                    : data.kind === "folder"
                        ? `${data.kind}:${data.packageId}${data.path}`
                        : `${data.kind}:${data.packageId}`,
        );
        this.resourceAuthoring.showResourceMenu();
    }

    private showHierarchyContextMenu(cell: fgui.GComponent, data: HierarchyItemData): void {
        this.setDebugAttribute(
            "data-fairy-editor-hierarchy-context",
            `${data.componentId}/${data.nodeId}`,
        );
        this.editorMenus.showEditMenu(cell);
        this.setStatus(`已打开 ${this.getSelectedDisplayNode()?.name || data.nodeId} 的快捷菜单。`);
    }

    private onLibraryBackgroundRightClick(event: Laya.Event): void {
        event.stopPropagation();
        this.resourceAuthoring.showResourceMenu();
    }

    private showProjectSearch(): void {
        this.showEditorWorkspace();
        if (!this.leftDockVisible) {
            this.leftDockVisible = true;
            this.saveDesktopLayoutState();
        }
        this.leftTopPanelMode = "search";
        this.refreshProjectSearch();
        this.layout();
        this.searchInput.requestFocus();
        this.setTransientStatus("Project search opened.");
    }

    private showLibraryPanel(): void {
        this.leftTopPanelMode = "library";
        this.selectedLibraryResourceSelectors = [];
        this.setDebugAttribute("data-fairy-editor-library-resource-selection", "");
        this.populateLibraryFromSnapshot();
        this.layout();
        this.setTransientStatus("Library opened.");
    }

    private showFavoritesPanel(): void {
        this.showEditorWorkspace();
        if (!this.leftDockVisible) {
            this.leftDockVisible = true;
            this.saveDesktopLayoutState();
        }
        this.leftTopPanelMode = "favorites";
        this.selectedLibraryResourceSelectors = [];
        this.setDebugAttribute("data-fairy-editor-library-resource-selection", "");
        this.populateFavoritesFromSnapshot();
        this.layout();
        this.setTransientStatus("Favorites opened.");
    }

    private collapseFavorites(): void {
        this.libraryController.collapseFavorites();
    }

    private collapseLibrary(): void {
        this.libraryController.collapseLibrary();
    }

    private expandFavorites(): void {
        this.libraryController.expandFavorites();
    }

    private showProjectReferencesForCurrentSelection(): void {
        const pkg = this.getSelectedPackage();
        const selectedResource = this.getSelectedResource();
        const selectedComponent = this.getSelectedComponent();
        const resourceId = selectedResource?.id || selectedComponent?.id || "";
        if (!pkg || !resourceId) {
            this.setStatus("Find References requires a selected resource or component.");
            return;
        }
        this.showEditorWorkspace();
        if (!this.leftDockVisible) {
            this.leftDockVisible = true;
            this.saveDesktopLayoutState();
        }
        this.leftTopPanelMode = "reference";
        this.referenceInput.text = getProjectResourceUrl({ packageId: pkg.id, resourceId });
        this.refreshProjectReferences();
        this.layout();
        this.referenceInput.requestFocus();
        this.setStatus(`References opened for ${selectedResource?.name || selectedComponent?.name || resourceId}.`);
    }

    private onSearchKeywordKeyDown(event: Laya.Event): void {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        this.refreshProjectSearch();
    }

    private refreshProjectSearch(): void {
        const keyword = this.searchInput.text.trim();
        this.searchResults = this.projectSnapshot && keyword
            ? searchDesktopProject(this.projectSnapshot, keyword)
            : [];
        const list = this.searchView.getChild("list").asList;
        list.removeChildrenToPool();
        for (const result of this.searchResults) {
            const item = list.addItemFromPool().asButton;
            item.title = result.label;
            item.data = result;
            item.tooltips = result.label;
        }
        this.searchView.getChild("result").text = keyword
            ? `${this.searchResults.length} result${this.searchResults.length === 1 ? "" : "s"}`
            : "Enter a project search term";
        this.setDebugAttribute("data-fairy-editor-search-query", keyword);
        this.setDebugAttribute("data-fairy-editor-search-count", String(this.searchResults.length));
    }

    private onReferenceInputKeyDown(event: Laya.Event): void {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        this.refreshProjectReferences();
    }

    private refreshProjectReferences(): void {
        const project = this.liveSessionBridge.getWorkingProject();
        const source = parseProjectResourceUrl(project, this.referenceInput.text);
        const direction = this.referenceView.getController("queryType").selectedIndex === 0
            ? "incoming"
            : "outgoing";
        const references = source
            ? queryProjectResourceReferences(project, source, direction)
            : [];
        const list = this.referenceView.getChild("list").asList;
        list.removeChildrenToPool();
        for (const reference of references) {
            const item = list.addItemFromPool().asButton;
            item.title = `${reference.label} · ${reference.count}`;
            item.data = reference;
            item.tooltips = `${reference.label} (${reference.count} reference${reference.count === 1 ? "" : "s"})`;
        }
        const totalCount = references.reduce(
            (count, reference) => count + reference.count,
            0,
        );
        this.referenceView.getChild("result").text = source
            ? `${totalCount} reference${totalCount === 1 ? "" : "s"} in ${references.length} file${references.length === 1 ? "" : "s"}`
            : "Resource URL not found";
        this.setDebugAttribute("data-fairy-editor-reference-direction", direction);
        this.setDebugAttribute("data-fairy-editor-reference-source", this.referenceInput.text.trim());
        this.setDebugAttribute("data-fairy-editor-reference-count", String(references.length));
    }

    private onSearchResultClick(itemObject: fgui.GObject): void {
        const result = itemObject.data as DesktopProjectSearchResult | null;
        if (!result || !this.navigateProjectResult(result)) return;
        if (result.kind === "component") {
            this.setStatus(`Search opened ${result.label}.`);
        } else if (result.kind === "displayNode") {
            this.setStatus(`Search selected ${result.label}.`);
        }
        this.setDebugAttribute(
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
            ? {
                kind: "package",
                packageId: reference.packageId,
                label: reference.label,
            }
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
        this.setDebugAttribute(
            "data-fairy-editor-reference-selection",
            `${reference.kind}:${reference.packageId}/${reference.resourceId}`,
        );
        this.setStatus(`Reference opened ${reference.label}.`);
    }

    private navigateProjectResult(result: DesktopProjectSearchResult): boolean {
        this.libraryPackageId = result.packageId;

        if (result.kind === "package") {
            this.applyLibrarySelection({ kind: "package", packageId: result.packageId });
        } else if (result.kind === "component") {
            if (!this.activateDocumentTab({
                packageId: result.packageId,
                componentId: result.componentId,
            })) return false;
        } else if (result.kind === "resource") {
            this.applyLibrarySelection({
                kind: "resource",
                packageId: result.packageId,
                resourceId: result.resourceId,
            });
            this.populateLibraryFromSnapshot();
        } else {
            if (!this.activateDocumentTab({
                packageId: result.packageId,
                componentId: result.componentId,
            })) return false;
            this.setDisplayNodeSelection([result.nodeId], result.nodeId);
            this.persistProjectSelection();
            this.refreshProjectViews();
        }
        return true;
    }

    private applyLibrarySelection(data: LibraryItemData | null, preserveResourceSelection = false): void {
        if (!data) return;
        this.libraryController.prepareSelection(data, preserveResourceSelection);

        if (data.kind === "package") {
            this.libraryPackageId = data.packageId;
            this.clearResourceSelection();
            const selectedPackage = this.projectSnapshot?.packages.find((pkg) => pkg.id === data.packageId) || null;
            this.activeDocument.setActiveSelection(
                this.projectSnapshot,
                data.packageId,
                selectedPackage?.components[0]?.id || "",
            );
            this.persistProjectSelection();
            this.refreshProjectViews();
            this.setTransientStatus(`Package selected: ${selectedPackage ? selectedPackage.name : data.packageId}.`);
            return;
        }

        if (data.kind === "component") {
            this.libraryPackageId = data.packageId;
            this.libraryController.setInspectorSelection({
                kind: "resource",
                packageId: data.packageId,
                resourceId: data.componentId,
            });
            const pkg = this.projectSnapshot?.packages.find((candidate) => candidate.id === data.packageId);
            const component = pkg?.components.find((candidate) => candidate.id === data.componentId);
            this.renderResourceInspector(this.findResource(data.packageId, data.componentId));
            if (pkg && component) {
                this.resourcePreview.showComponent(this.projectSnapshot?.project.id || "", pkg, component);
            } else {
                this.resourcePreview.clear();
            }
            this.setTransientStatus(`Component selected: ${component ? component.name : data.componentId}.`);
            return;
        }

        if (data.kind === "folder") {
            this.libraryPackageId = data.packageId;
            this.libraryController.setInspectorSelection({
                kind: "folder",
                packageId: data.packageId,
                branch: data.branch,
                path: data.path,
            });
            this.renderResourceFolderInspector(this.getSelectedResourceFolder());
            this.setTransientStatus(`Resource folder selected: ${data.path}.`);
            return;
        }

        const resource = this.findResource(data.packageId, data.resourceId);
        this.libraryPackageId = data.packageId;
        this.libraryController.setInspectorSelection({
            kind: "resource",
            packageId: data.packageId,
            resourceId: data.resourceId,
        });
        this.renderResourceInspector(resource);
        if (resource) this.resourcePreview.show(data.packageId, resource);
        this.setTransientStatus(`Resource selected: ${resource ? resource.name : data.resourceId}.`);
    }

    private onHierarchyItemClick(itemObject: fgui.GObject): void {
        this.controllerTimeline.setKeyboardActive(false);
        const data = itemObject.treeNode ? (itemObject.treeNode.data as HierarchyItemData | null) : null;
        if (!data) return;

        this.activeDocument.setActiveSelection(
            this.projectSnapshot,
            this.selectedPackageId,
            data.componentId,
            [data.nodeId],
            data.nodeId,
        );
        this.clearResourceSelection();

        this.persistProjectSelection();
        this.populateInspectorFromSnapshot();
        this.runtimePreview.selectNodes(this.selectedDisplayNodeIds, this.selectedDisplayNodeId);
        this.layoutInspectorLines();
        const selectedNode = this.getSelectedDisplayNode();
        const selectedComponent = this.getSelectedComponent();
        this.setTransientStatus(
            selectedNode
                ? `Display node selected: ${selectedNode.name || selectedNode.id}.`
                : `Component selected: ${selectedComponent ? selectedComponent.name : data.componentId}.`,
        );
    }

    private onPreviewNodesSelected(nodeIds: string[], primaryNodeId: string): void {
        const selectedComponent = this.getSelectedComponent();
        if (!selectedComponent) return;

        this.setDisplayNodeSelection(nodeIds, primaryNodeId);
        this.clearResourceSelection();
        this.syncDisplayNodeSelectionViews();
        const selectedNode = this.getSelectedDisplayNode();
        this.setTransientStatus(
            this.selectedDisplayNodeIds.length > 1
                ? `${this.selectedDisplayNodeIds.length} preview objects selected; primary ${selectedNode?.name || selectedNode?.id || "-"}.`
                : selectedNode
                    ? `Preview object selected: ${selectedNode.name || selectedNode.id}.`
                    : "Preview selection cleared.",
        );
    }

    private onRuntimePreviewPackageLoad(result: AuthoringRuntimePackageLoadResult): void {
        if (this.disposed) return;

        this.setDebugAttribute("data-fairy-editor-runtime-package", result.packageName);
        this.setDebugAttribute("data-fairy-editor-runtime-package-status", result.status);
        this.setDebugAttribute("data-fairy-editor-runtime-package-source", result.source || "");
        this.setDebugAttribute("data-fairy-editor-runtime-package-message", result.message);
        if (!result.ok) {
            const selectedPackage = this.getSelectedPackage();
            const selectedComponent = this.getSelectedComponent();
            if (selectedPackage?.name === result.packageName && selectedComponent) {
                this.panels.preview.getChild("desc").text =
                    `${selectedPackage.name}/${selectedComponent.name} runtime ${result.status}: ${result.message}`;
            }
        }
        this.setStatus(
            result.ok
                ? `Runtime preview package loaded: ${result.packageName}.`
                : `Runtime preview package ${result.status}: ${result.packageName}. ${result.message}`,
        );
    }

    private setStatus(message: string, consoleLevel: DesktopConsoleLevel = "info"): void {
        if (this.disposed) return;
        this.consoleEntries = appendDesktopConsoleEntry(this.consoleEntries, message, consoleLevel);
        this.populateDesktopConsole();
        this.setTransientStatus(message);
    }

    private setTransientStatus(message: string): void {
        if (this.disposed) return;
        const session = this.commandAdapter.getSessionState();
        const saveState = session.dirty ? "未保存" : "已保存";
        this.statusLine.title = `[color=${session.dirty ? "#e4b85f" : "#8ccf7e"}]${saveState}[/color] ${message}`;
        this.statusLine.tooltips = session.dirty ? "当前工作区有未保存的更改。" : "当前工作区已保存。";
        this.setDebugAttribute("data-fairy-editor-session-mode", session.adapterMode);
        this.setDebugAttribute("data-fairy-editor-dirty", String(session.dirty));
        this.setDebugAttribute("data-fairy-editor-status", message);
    }

    private setDebugAttribute(name: string, value: string): void {
        if (this.disposed) return;
        if (typeof document !== "undefined" && document.body) {
            document.body.setAttribute(name, value);
        }
    }

    private async applyLibraryDrop(
        state: LibraryDragState,
        point: { x: number; y: number },
    ): Promise<void> {
        const resourceId = state.data.kind === "component"
            ? state.data.componentId
            : state.data.resourceId;
        const preparation = preparePlaceResourceDisplayNode(
            this.liveSessionBridge.getWorkingProject(),
            {
                packageId: state.targetPackageId,
                componentResourceId: state.targetComponentId,
            },
            { packageId: state.data.packageId, resourceId },
            point,
        );
        if (preparation.ok === false) {
            this.setDebugAttribute("data-fairy-editor-library-drag", "failed");
            await this.applyAuthoringPreparation(preparation);
            return;
        }
        const operation = (preparation.transaction.operations || [preparation.transaction.operation])
            .find((candidate) => candidate.kind === "attachDisplayNode");
        const nodeId = String((operation?.node as { id?: unknown } | null)?.id || "");

        this.activeDocument.setActiveSelection(
            this.projectSnapshot,
            state.targetPackageId,
            state.targetComponentId,
        );
        this.clearResourceSelection();
        if (!await this.applyAuthoringPreparation(preparation)) {
            this.setDebugAttribute("data-fairy-editor-library-drag", "failed");
            return;
        }

        this.setDisplayNodeSelection(nodeId ? [nodeId] : [], nodeId);
        this.syncDisplayNodeSelectionViews();
        this.setDebugAttribute("data-fairy-editor-library-drag", "placed");
        this.setDebugAttribute(
            "data-fairy-editor-library-drop",
            `${resourceId}:${nodeId}@${point.x},${point.y}`,
        );
        this.setStatus(
            `Placed ${resourceId} as ${nodeId} at ${point.x},${point.y}; `
            + "Publish to update the runtime preview.",
        );
    }

    private selectHierarchyDragNode(data: HierarchyItemData): void {
        this.activeDocument.setActiveSelection(
            this.projectSnapshot,
            this.selectedPackageId,
            data.componentId,
            [data.nodeId],
            data.nodeId,
        );
        this.clearResourceSelection();
        this.persistProjectSelection();
        this.populateInspectorFromSnapshot();
        this.runtimePreview.selectNodes(this.selectedDisplayNodeIds, this.selectedDisplayNodeId);
        this.layoutInspectorLines();
    }

    private getHierarchyDocumentKey(): string {
        return this.selectedPackageId && this.selectedComponentId
            ? `${this.selectedPackageId}/${this.selectedComponentId}`
            : "";
    }

    private getHierarchyHiddenNodeIds(): Set<string> {
        return this.hierarchyHiddenNodes.get(this.getHierarchyDocumentKey()) || new Set<string>();
    }

    private toggleHierarchyNodeHidden(data: HierarchyItemData): void {
        const key = this.getHierarchyDocumentKey();
        if (!key || data.componentId !== this.selectedComponentId) return;
        const hidden = new Set(this.getHierarchyHiddenNodeIds());
        hidden.has(data.nodeId) ? hidden.delete(data.nodeId) : hidden.add(data.nodeId);
        if (hidden.size > 0) this.hierarchyHiddenNodes.set(key, hidden);
        else this.hierarchyHiddenNodes.delete(key);
        this.runtimePreview.setEditorHiddenNodeIds(hidden);
        this.populateHierarchyFromSnapshot();
        this.setDebugAttribute("data-fairy-editor-hierarchy-hidden", [...hidden].join(","));
        this.setTransientStatus(`${hidden.has(data.nodeId) ? "Hidden" : "Shown"} ${data.nodeId} in the editor.`);
    }

    private toggleAllHierarchyVisibility(): void {
        const component = this.getSelectedComponent();
        const key = this.getHierarchyDocumentKey();
        if (!component || !key || component.children.length === 0) return;
        const hidden = this.getHierarchyHiddenNodeIds();
        if (hidden.size > 0) this.hierarchyHiddenNodes.delete(key);
        else this.hierarchyHiddenNodes.set(key, new Set(component.children.map((node) => node.id)));
        const next = this.getHierarchyHiddenNodeIds();
        this.runtimePreview.setEditorHiddenNodeIds(next);
        this.populateHierarchyFromSnapshot();
        this.setDebugAttribute("data-fairy-editor-hierarchy-hidden", [...next].join(","));
        this.setTransientStatus(next.size > 0 ? "All display nodes hidden in the editor." : "All display nodes shown in the editor.");
    }

    private showHierarchyRenameDialog(): void {
        const node = this.getSelectedDisplayNode();
        const selector = this.getSelectedDisplayNodeSelector();
        if (!node || !selector || this.selectedDisplayNodeIds.length !== 1) {
            this.setTransientStatus("Select one display node to rename.");
            return;
        }
        void requestEditorTextInput(
            {
                getActiveDialog: () => this.authoringJsonDialog,
                setActiveDialog: (dialog) => { this.authoringJsonDialog = dialog; },
                setStatus: (message) => this.setStatus(message),
                setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
                eventOwner: this,
            },
            "desktopHierarchyRenameDialog",
            "重命名",
            "输入显示对象名称",
            node.name || node.id,
            "重命名",
            (value) => value.trim() ? null : "名称不能为空。",
        ).then(async (value) => {
            const newName = value?.trim();
            if (!newName || newName === node.name) return;
            const preparation = prepareRenameDisplayNode(
                this.liveSessionBridge.getWorkingProject(),
                selector,
                newName,
            );
            if (!await this.applyAuthoringPreparation(preparation)) return;
            this.setDisplayNodeSelection([selector.displayNodeId], selector.displayNodeId);
            this.syncDisplayNodeSelectionViews();
            this.setDebugAttribute("data-fairy-editor-hierarchy-rename", `${selector.displayNodeId}:${newName}`);
        });
    }

    private onHierarchyRelationsDisabledChanged(): void {
        const key = this.getHierarchyDocumentKey();
        if (!key) return;
        const selected = this.panels.hierarchy.getChild("btnRelationDisabled").asButton.selected;
        selected ? this.hierarchyRelationsDisabled.add(key) : this.hierarchyRelationsDisabled.delete(key);
        this.setDebugAttribute("data-fairy-editor-hierarchy-relations-disabled", String(selected));
        this.setTransientStatus(`Display-list relations ${selected ? "disabled" : "enabled"} for editor transforms.`);
    }

    private onHierarchyShowAllInvisiblesChanged(): void {
        const key = this.getHierarchyDocumentKey();
        if (!key) return;
        const selected = this.panels.hierarchy.getChild("btnShowAllInvisibles").asButton.selected;
        selected ? this.hierarchyShowAllInvisibles.add(key) : this.hierarchyShowAllInvisibles.delete(key);
        this.runtimePreview.setShowAllInvisibleNodes(selected);
        this.setDebugAttribute("data-fairy-editor-hierarchy-show-invisibles", String(selected));
        this.setTransientStatus(`${selected ? "Showing" : "Respecting"} invisible display nodes in the editor.`);
    }

    private toggleHierarchyNodeLock(data: HierarchyItemData): void {
        const component = this.getSelectedComponent();
        const node = component?.children.find((candidate) => candidate.id === data.nodeId);
        if (!component || component.id !== data.componentId || !node) return;
        void this.applyDisplayNodePropsCommand({
            kind: "setDisplayNodeProps",
            selector: {
                packageId: this.selectedPackageId,
                componentResourceId: component.id,
                displayNodeId: node.id,
            },
            props: { locked: !node.locked },
        }, `${node.locked ? "Unlocked" : "Locked"} ${node.name || node.id}`);
    }

    private toggleAllHierarchyLocks(): void {
        const component = this.getSelectedComponent();
        if (!component || component.children.length === 0) return;
        const locked = !component.children.some((node) => node.locked);
        const commands = component.children
            .filter((node) => node.locked !== locked)
            .map<SetDisplayNodePropsCommand>((node) => ({
                kind: "setDisplayNodeProps",
                selector: {
                    packageId: this.selectedPackageId,
                    componentResourceId: component.id,
                    displayNodeId: node.id,
                },
                props: { locked },
            }));
        if (commands.length > 0) {
            void this.applyDisplayNodePropsCommands(commands, `${locked ? "Locked" : "Unlocked"} all display nodes`);
        }
    }

    private async applyHierarchyDrop(
        state: HierarchyDragState,
        target: HierarchyDropTarget,
    ): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        if (!selectedPackage) return;
        const applied = await this.applyAuthoringPreparation(prepareMoveDisplayNode(
            this.liveSessionBridge.getWorkingProject(),
            {
                packageId: selectedPackage.id,
                componentResourceId: state.sourceComponentId,
                displayNodeId: state.nodeId,
            },
            target.componentId,
            target.targetIndex,
        ));
        if (!applied) {
            this.setDebugAttribute("data-fairy-editor-hierarchy-drag", "failed");
            return;
        }

        this.activeDocument.setActiveSelection(
            this.projectSnapshot,
            this.selectedPackageId,
            target.componentId,
            [state.nodeId],
            state.nodeId,
        );
        this.clearResourceSelection();
        this.persistProjectSelection();
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-hierarchy-drag", target.kind);
        this.setDebugAttribute(
            "data-fairy-editor-hierarchy-drop",
            `${state.nodeId}:${target.componentId}@${target.targetIndex}`,
        );
        this.setStatus(
            `Hierarchy ${target.kind}: `
            + `${state.nodeId} to ${target.componentId}@${target.targetIndex}.`,
        );
    }

    private showReplaceObjectDialog(): void {
        if (!this.getSelectedComponentSelector() || this.selectedDisplayNodeIds.length === 0) {
            this.setStatus("Replace requires at least one selected display node.");
            return;
        }
        const project = this.liveSessionBridge.getWorkingProject();
        const selectedLibraryTarget = this.selectedLibraryResourceSelectors.length === 1
            ? this.selectedLibraryResourceSelectors[0]
            : null;
        const selectedLibraryResource = selectedLibraryTarget
            ? findResource(project, selectedLibraryTarget)
            : null;
        const initialTarget = selectedLibraryTarget
            && ["image", "component", "movieClip"].includes(String(selectedLibraryResource?.kind || ""))
            ? getProjectResourceUrl(selectedLibraryTarget)
            : "text";
        openReplaceObjectDialog(
            {
                getActiveDialog: () => this.authoringJsonDialog,
                setActiveDialog: (dialog) => { this.authoringJsonDialog = dialog; },
                setStatus: (message, kind) => this.setStatus(message, kind),
                setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
                eventOwner: this,
            },
            project,
            initialTarget,
            this.selectedDisplayNodeIds.length,
            (target) => void this.replaceSelectedDisplayNodes(target),
        );
    }

    private async replaceSelectedDisplayNodes(
        target: PrimitiveDisplayNodeKind | EditorResourceSelector,
    ): Promise<void> {
        const owner = this.getSelectedComponentSelector();
        const selectedIds = this.selectedDisplayNodeIds.slice();
        if (!owner || selectedIds.length === 0) return;
        const preparation = prepareReplaceDisplayNodes(
            this.liveSessionBridge.getWorkingProject(),
            selectedIds.map((displayNodeId) => ({ ...owner, displayNodeId })),
            target,
        );
        if (!await this.applyAuthoringPreparation(preparation)) return;
        this.setDisplayNodeSelection(selectedIds, this.selectedDisplayNodeId || selectedIds[selectedIds.length - 1]);
        this.persistProjectSelection();
        this.refreshProjectViews();
        const targetLabel = typeof target === "string" ? target : getProjectResourceUrl(target);
        this.setDebugAttribute("data-fairy-editor-display-node-replace", `${selectedIds.join(",")}->${targetLabel}`);
        this.setStatus(
            `Replaced ${selectedIds.length} display node${selectedIds.length === 1 ? "" : "s"} with ${targetLabel}; `
            + "Publish to update the runtime preview.",
        );
    }

    private copySelectedDisplayNodes(): boolean {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        if (!selectedPackage || !selectedComponent || this.selectedDisplayNodeIds.length === 0) {
            this.setStatus("Copy skipped: no display node selected.");
            return false;
        }
        const preparation = createDisplayNodeClipboard(
            this.liveSessionBridge.getWorkingProject(),
            this.selectedDisplayNodeIds.map((displayNodeId) => ({
                packageId: selectedPackage.id,
                componentResourceId: selectedComponent.id,
                displayNodeId,
            })),
        );
        if (preparation.ok === false) {
            this.setStatus(`Copy unavailable: ${preparation.code}. ${preparation.message}`);
            return false;
        }
        this.displayNodeClipboard = preparation.clipboard;
        this.setDebugAttribute(
            "data-fairy-editor-display-node-clipboard",
            `${preparation.clipboard.packageId}/${preparation.clipboard.componentResourceId}:${preparation.clipboard.nodes.length}`,
        );
        this.setStatus(`Copied ${preparation.clipboard.nodes.length} display node${preparation.clipboard.nodes.length === 1 ? "" : "s"}.`);
        return true;
    }

    private cutSelectedDisplayNodes(): void {
        if (this.copySelectedDisplayNodes()) void this.deleteSelectedDisplayNodes();
    }

    private async pasteDisplayNodes(
        clipboard: DisplayNodeClipboard | null = this.displayNodeClipboard,
        pastTense: string = "Pasted",
        debugAttribute: string = "data-fairy-editor-display-node-paste",
    ): Promise<void> {
        const target = this.getSelectedComponentSelector();
        if (!target || !clipboard) {
            this.setStatus("Paste skipped: select a target component after copying display nodes.");
            return;
        }
        const preparation = preparePasteDisplayNodes(
            this.liveSessionBridge.getWorkingProject(),
            target,
            clipboard,
        );
        if (preparation.ok === false) {
            this.setStatus(`Paste unavailable: ${preparation.code}. ${preparation.message}`);
            return;
        }
        const pastedNodeIds = (preparation.transaction.operations || [preparation.transaction.operation])
            .flatMap((operation) => {
                if (operation.kind !== "attachDisplayNode") return [];
                if (
                    operation.selector.packageId !== target.packageId
                    || operation.selector.componentResourceId !== target.componentResourceId
                ) return [];
                const id = String((operation.node as { id?: unknown } | null)?.id || "");
                return id ? [id] : [];
            });
        if (!await this.applyAuthoringPreparation(preparation)) return;

        this.setDisplayNodeSelection(pastedNodeIds, pastedNodeIds[pastedNodeIds.length - 1] || "");
        this.syncDisplayNodeSelectionViews();
        this.setDebugAttribute(debugAttribute, pastedNodeIds.join(","));
        this.setStatus(
            `${pastTense} ${pastedNodeIds.length} display node${pastedNodeIds.length === 1 ? "" : "s"} `
            + "Canvas updated. Publish to update the runtime preview.",
        );
    }

    private async duplicateSelectedDisplayNodes(): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        if (!selectedPackage || !selectedComponent || this.selectedDisplayNodeIds.length === 0) return;
        const copied = createDisplayNodeClipboard(
            this.liveSessionBridge.getWorkingProject(),
            this.selectedDisplayNodeIds.map((displayNodeId) => ({
                packageId: selectedPackage.id,
                componentResourceId: selectedComponent.id,
                displayNodeId,
            })),
        );
        if (copied.ok === false) {
            this.setStatus(`Duplicate unavailable: ${copied.code}. ${copied.message}`);
            return;
        }
        await this.pasteDisplayNodes(
            copied.clipboard,
            "Duplicated",
            "data-fairy-editor-display-node-duplicate",
        );
    }

    private getSelectedDisplayNodeResourceSelector(): EditorResourceSelector | null {
        const owner = this.getSelectedComponentSelector();
        if (!owner || !this.selectedDisplayNodeId) return null;
        const node = findDisplayNode(this.liveSessionBridge.getWorkingProject(), {
            ...owner,
            displayNodeId: this.selectedDisplayNodeId,
        });
        const resourceId = String(node?.resource?.resourceId || "");
        return resourceId ? {
            packageId: String(node?.resource?.packageId || owner.packageId),
            resourceId,
        } : null;
    }

    private async applySelectedNodeSourceSize(): Promise<void> {
        const selector = this.getSelectedDisplayNodeResourceSelector();
        const owner = this.getSelectedComponentSelector();
        const selectedNode = this.getSelectedDisplayNode();
        if (!selector || !owner || !selectedNode) {
            this.setStatus("Source size requires one resource-backed display node.");
            return;
        }
        const pkg = this.projectSnapshot?.packages.find((candidate) => candidate.id === selector.packageId);
        const resource = pkg?.resources.find((candidate) => candidate.id === selector.resourceId);
        const component = pkg?.components.find((candidate) => candidate.id === selector.resourceId);
        const width = resource?.width ?? component?.width;
        const height = resource?.height ?? component?.height;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width! <= 0 || height! <= 0) {
            this.setStatus("Source size is unavailable for the selected resource.");
            return;
        }
        await this.applyDisplayNodePropsCommand({
            kind: "setDisplayNodeProps",
            selector: { ...owner, displayNodeId: selectedNode.id },
            props: { size: { width: width!, height: height! } },
        }, `source size ${selectedNode.id}`);
    }

    private showSelectedDisplayNodeInLibrary(): void {
        const selector = this.getSelectedDisplayNodeResourceSelector();
        if (!selector) {
            this.setStatus("Show in Library requires a resource-backed display node.");
            return;
        }
        this.showEditorWorkspace();
        if (!this.leftDockVisible) {
            this.leftDockVisible = true;
            this.saveDesktopLayoutState();
        }
        this.leftTopPanelMode = "library";
        this.libraryPackageId = selector.packageId;
        this.selectedLibraryResourceSelectors = [selector];
        this.populateLibraryFromSnapshot();
        this.layout();
        this.setDebugAttribute(
            "data-fairy-editor-library-resource-selection",
            `${selector.packageId}/${selector.resourceId}`,
        );
        this.setDebugAttribute("data-fairy-editor-show-in-library", getProjectResourceUrl(selector));
        this.setStatus(`Shown in Library: ${getProjectResourceUrl(selector)}.`);
    }

    private async deleteSelectedDisplayNodes(): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        if (!selectedPackage || !selectedComponent || this.selectedDisplayNodeIds.length === 0) return;
        const deletedIds = this.selectedDisplayNodeIds.slice();
        const preparation = prepareDetachDisplayNodes(
            this.liveSessionBridge.getWorkingProject(),
            deletedIds.map((displayNodeId) => ({
                packageId: selectedPackage.id,
                componentResourceId: selectedComponent.id,
                displayNodeId,
            })),
        );
        if (!await this.applyAuthoringPreparation(preparation)) return;
        this.setDebugAttribute("data-fairy-editor-display-node-delete", deletedIds.join(","));
        this.setStatus(
            `Deleted ${deletedIds.length} display node${deletedIds.length === 1 ? "" : "s"} `
            + "Canvas updated. Publish to update the runtime preview.",
        );
    }

    private setHierarchySearchQuery(value: string): void {
        this.hierarchySearchQuery = value.toLocaleLowerCase();
        const searchBar = this.panels.hierarchy.getChild("searchBar").asButton;
        searchBar.title = this.hierarchySearchQuery;
        searchBar.visible = this.hierarchySearchQuery.length > 0;
        if (searchBar.visible) {
            const width = Math.min(150, Math.max(48, this.hierarchySearchQuery.length * 7 + 32));
            searchBar.setSize(width, 27);
            searchBar.getChild("title").setSize(Math.max(11, width - 30), 18);
        }
        this.populateHierarchyFromSnapshot();
        this.setDebugAttribute("data-fairy-editor-hierarchy-search", this.hierarchySearchQuery);
    }

    private clearHierarchySearch(): void {
        if (!this.hierarchySearchQuery) return;
        this.setHierarchySearchQuery("");
        this.setTransientStatus("Display-list search cleared.");
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
        this.panels.hierarchy.getChild("status").grayed = !hasNodes;
        this.panels.hierarchy.getChild("lock").grayed = !hasNodes;
        this.panels.hierarchy.getChild("rename").grayed = this.selectedDisplayNodeIds.length !== 1;
        this.panels.hierarchy.getChild("btnRelationDisabled").asButton.selected = this.hierarchyRelationsDisabled.has(key);
        this.panels.hierarchy.getChild("btnShowAllInvisibles").asButton.selected = this.hierarchyShowAllInvisibles.has(key);

        const duplicateNames = new Set<string>();
        const seenNames = new Set<string>();
        for (const node of component?.children || []) {
            if (!node.name) continue;
            seenNames.has(node.name) ? duplicateNames.add(node.name) : seenNames.add(node.name);
        }
        const warnings = this.panels.hierarchy.getChild("warnings");
        warnings.visible = duplicateNames.size > 0;
        warnings.tooltips = duplicateNames.size > 0
            ? `重复名称：${[...duplicateNames].join("、")}`
            : "";
    }

    private selectDuplicateHierarchyNames(): void {
        const component = this.getSelectedComponent();
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
        this.setDisplayNodeSelection(duplicate[1], duplicate[1][0]);
        this.syncDisplayNodeSelectionViews();
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
                this.getDisplayNodeIcon(child.type),
            );
            node.expanded = hasChildren && this.hierarchyExpanded;
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

    private getDisplayNodeIcon(type: string): string {
        return DISPLAY_NODE_ICONS[type] || "icon_component";
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

    private async initializeProjectSnapshotNow(): Promise<boolean> {
        try {
            const snapshot = await loadProjectSnapshot();
            if (this.disposed) return false;
            this.applyProjectSnapshot(snapshot);
            await this.workspaceLifecycle.restoreWorkspaceBinding();
            if (this.disposed) return false;
            if (!await this.connectBrowserLiveSession() || this.disposed) return false;
            this.setStatus("Project loaded.");
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.renderInspectorLines(["无法打开项目"]);
            this.layoutInspectorLines();
            this.setStatus(`Snapshot load failed: ${message}`, "error");
            console.error("[Editor Project] snapshot load failed", error);
            return false;
        }
    }

    private async refreshProjectSnapshot(): Promise<void> {
        await this.enqueueAuthoringOperation(async () => {
            const state = this.liveSessionBridge.getState();
            const snapshot = this.liveSessionBridge.getProjectSnapshot();
            if (
                state.status !== "connected"
                || !snapshot
                || state.revision !== this.commandAdapter.getRevision()
            ) {
                this.setStatus(
                    "Project refresh blocked: reconnect the browser live session before refreshing.",
                    "error",
                );
                return;
            }
            this.applyLiveProjectSnapshot(snapshot);
            this.setStatus(
                "Project refreshed.",
            );
        });
    }

    private async publishBrowserRuntimeBundle(mode: "current" | "modified" | "all" = "modified"): Promise<void> {
        await this.enqueueAuthoringOperation(() => this.publishBrowserRuntimeBundleNow(mode));
    }

    private async publishBrowserRuntimeBundleNow(mode: "current" | "modified" | "all" = "modified"): Promise<void> {
        if (!this.commandAdapter.isLiveSessionAligned()) {
            this.setStatus(
                "Browser runtime publish blocked: reconnect the browser live session before publishing.",
                "error",
            );
            return;
        }
        const snapshot = this.projectSnapshot;
        if (!snapshot) {
            this.setStatus("Browser publish unavailable: no authoring project is loaded.");
            return;
        }
        if (this.commandAdapter.getSessionState().dirty) {
            this.setStatus("Browser publish blocked: save changes first.");
            return;
        }
        const packageIds = mode === "all"
            ? snapshot.packages.map((pkg) => pkg.id)
            : mode === "current"
                ? [this.getSelectedPackage()?.id || ""].filter(Boolean)
                : this.modifiedPackageIds.size
                    ? [...this.modifiedPackageIds]
                    : this.runtimePreview.requiresRuntimePublish()
                        ? snapshot.packages.map((pkg) => pkg.id)
                        : [];
        if (!packageIds.length) {
            this.setStatus("没有需要发布的已修改包。");
            return;
        }

        const waitingDialog = new fgui.Window();
        waitingDialog.modal = true;
        waitingDialog.name = "publishWaitingDialog";
        const waitingContent = fgui.UIPackage.createObject("Builder", "WaitingDialog").asCom;
        waitingDialog.contentPane = waitingContent;
        waitingContent.getChild("title").asTextField.text = "发布中...";
        waitingContent.getChild("cancel").visible = false;
        waitingDialog.show();
        waitingDialog.centerOn(fgui.GRoot.inst, true);
        this.setStatus("Publishing browser workspace runtime bundle...");
        try {
            const result = await this.liveSessionBridge.publishRuntimeBundle(snapshot, {
                packageIds,
                branch: this.activeBranch,
            });
            if (this.disposed) return;
            if (!result.success) {
                this.setStatus("Browser runtime publish failed.");
                return;
            }
            if (!result.archive?.blob) throw new Error("Browser runtime ZIP export did not produce a download.");
            this.downloadWorkspaceExport(result.archive.blob, result.archive.fileName);
            this.resetPublishedRuntimePackages();
            this.populatePreviewFromSnapshot();
            this.setDebugAttribute("data-fairy-editor-preview-projection", "refreshed");
            this.setDebugAttribute("data-fairy-editor-preview-runtime-status", "current");
            this.setDebugAttribute("data-fairy-editor-preview-projection-reason", "browser_publish");
            packageIds.forEach((id) => this.modifiedPackageIds.delete(id));
            this.setStatus(`Browser runtime publish complete: ${result.packageCount} package(s), ${result.fileCount} file(s); downloaded ${result.archive.fileName}.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Browser runtime publish failed: ${message}`);
            console.error("[Publish] browser runtime publish failed", error);
        } finally {
            waitingDialog.dispose();
        }
    }

    private async saveBrowserWorkspace(): Promise<void> {
        await this.enqueueAuthoringOperation(() => this.saveBrowserWorkspaceNow());
    }

    private async saveBrowserWorkspaceNow(): Promise<void> {
        if (!this.commandAdapter.isLiveSessionAligned()) {
            this.setStatus(
                "Browser workspace save blocked: reconnect the browser live session before saving.",
                "error",
            );
            return;
        }
        const checkpointStateId = this.commandAdapter.getCurrentStateId();
        const checkpointRevision = this.commandAdapter.getRevision();
        const target = this.createBrowserSaveTargetForSelection();
        this.setStatus("Browser workspace save started.");

        try {
            const result = await this.workspaceLifecycle.save(target);
            if (this.disposed) return;
            this.recordBrowserSaveResult(result);
            const browserWorkspaceSaved = result.results.save.ok && result.results.reload.ok;
            const checkpointSaved = browserWorkspaceSaved
                && result.results.save.revision === checkpointRevision;
            if (checkpointSaved) {
                this.commandAdapter.markSaved(checkpointStateId);
                const reloadedSnapshot = this.liveSessionBridge.getProjectSnapshot();
                if (reloadedSnapshot) {
                    const operations = this.commandLastResult?.operations
                        || (this.commandLastResult?.operation ? [this.commandLastResult.operation] : []);
                    this.applyLiveProjectSnapshot(reloadedSnapshot, operations);
                } else {
                    this.populateInspectorFromSnapshot();
                }
                this.recordBrowserSaveResult(result);
            } else if (browserWorkspaceSaved) {
                this.setStatus(
                    "Save completed, but newer edits were detected. Save again.",
                    "error",
                );
                return;
            }
            if (result.ok) {
                this.setStatus(
                    result.writeback?.status === "saved"
                        ? `Browser workspace saved and wrote ${result.writeback.directoryName}.`
                        : "Browser workspace saved.",
                );
                return;
            }

            if (
                result.results.save.ok
                && result.results.reload.ok
                && result.writeback?.status === "conflict"
            ) {
                this.setStatus("Browser workspace saved; Folder write-back was blocked by external changes. Re-import Folder or Export ZIP.");
                return;
            }

            this.setStatus(`Browser workspace save failed: ${getBrowserSaveFailure(result)}.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Browser workspace save failed: ${message}`, "error");
            console.error("[Workspace] save failed", error);
        }
    }

    private showBrowserWorkspaceSelector(): void {
        openBrowserWorkspaceDialog({
            entries: this.workspaceLifecycle.registry.entries,
            activeId: this.workspaceLifecycle.registry.activeId,
            select: (entry) => void this.switchBrowserWorkspace(entry),
            create: () => void this.createBrowserWorkspace(),
            getActiveDialog: () => this.authoringJsonDialog,
            setActiveDialog: (dialog) => { this.authoringJsonDialog = dialog; },
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
            setStatus: (message) => this.setStatus(message),
            eventOwner: this,
        });
    }

    private async createBrowserWorkspace(): Promise<void> {
        if (this.commandAdapter.getSessionState().dirty) {
            this.setStatus("无法新建工作区：请先保存或撤销当前工作区的修改。");
            return;
        }
        const name = await this.authoringDialogs.requestTextInput(
            "browserWorkspaceNameDialog",
            "新建浏览器工作区",
            "请输入工作区名称。项目文件、Folder 绑定、标签页和布局将使用独立的浏览器命名空间。",
            "工作区",
            "创建",
        );
        if (name === null) return;
        this.showEditorWorkspace();
        await this.enqueueAuthoringOperation(async () => {
            if (!this.guardWorkspaceTransition("switch", "data-fairy-editor-workspace-switch")) return;
            await this.switchBrowserWorkspaceNow(this.workspaceLifecycle.addWorkspace(name));
        });
    }

    private async switchBrowserWorkspace(entry: BrowserWorkspaceRegistryEntry): Promise<void> {
        await this.enqueueAuthoringOperation(() => this.switchBrowserWorkspaceNow(entry));
    }

    private async switchBrowserWorkspaceNow(entry: BrowserWorkspaceRegistryEntry): Promise<void> {
        if (!this.guardWorkspaceTransition("switch", "data-fairy-editor-workspace-switch")) return;
        this.persistProjectSelection();
        this.saveDesktopLayoutState();
        this.setStatus(`正在切换到浏览器工作区 ${entry.name}…`);
        try {
            await this.workspaceLifecycle.switchWorkspace(entry);
            if (this.disposed) return;
            this.resetPublishedRuntimePackages();
            this.projectSnapshot = null;
            this.documentWorkspace.clear();
            this.activeDocument.reset();
            this.libraryPackageId = "";
            this.clearResourceSelection();
            this.selectedLibraryResourceSelectors = [];
            this.applyDefaultDesktopLayoutState();
            this.restoreDesktopLayoutState();
            this.restoreResourceViewState();
            if (!await this.initializeProjectSnapshotNow()) {
                this.setDebugAttribute("data-fairy-editor-workspace-switch", "failed");
                return;
            }
            this.setDebugAttribute("data-fairy-editor-workspace-switch", entry.id);
            this.setStatus(`已打开浏览器工作区：${entry.name}。`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setDebugAttribute("data-fairy-editor-workspace-switch", "failed");
            this.setStatus(`浏览器工作区切换失败：${message}`, "error");
            console.error("[Workspace] switch failed", error);
        }
    }

    private async closeBrowserWorkspace(): Promise<void> {
        await this.enqueueAuthoringOperation(() => this.closeBrowserWorkspaceNow());
    }

    private async closeBrowserWorkspaceNow(): Promise<void> {
        if (!this.guardWorkspaceTransition("close", "data-fairy-editor-workspace-close")) return;
        this.persistProjectSelection();
        this.saveDesktopLayoutState();
        const reset = await this.workspaceLifecycle.closeWorkspace();
        if (this.disposed) return;
        if (!reset.ok) {
            this.setStatus(`工作区关闭失败：${reset.message || "会话重置失败"}。`, "error");
            return;
        }
        this.resetPublishedRuntimePackages();
        this.showStartScene();
        this.setDebugAttribute("data-fairy-editor-workspace-close", this.workspaceLifecycle.registry.activeId);
        this.setStatus("浏览器工作区已关闭；其中的文件和最近记录均已保留。");
    }

    private async reauthorizeBrowserWorkspaceFolder(): Promise<void> {
        await this.enqueueAuthoringOperation(() => this.reauthorizeBrowserWorkspaceFolderNow());
    }

    private async reauthorizeBrowserWorkspaceFolderNow(): Promise<void> {
        const state = await this.workspaceLifecycle.reauthorizeDirectoryBinding();
        if (this.disposed) return;
        this.setDebugAttribute(
            "data-fairy-editor-workspace-reauthorize",
            state.directoryWriteback?.status || "none",
        );
        this.setStatus(state.directoryWriteback?.message || "No Folder binding is attached.");
    }

    private async checkBrowserWorkspaceExternalChanges(): Promise<void> {
        await this.enqueueAuthoringOperation(() => this.checkBrowserWorkspaceExternalChangesNow());
    }

    private async checkBrowserWorkspaceExternalChangesNow(): Promise<void> {
        const { result } = await this.workspaceLifecycle.checkExternalChanges();
        if (this.disposed) return;
        this.setDebugAttribute("data-fairy-editor-workspace-external", result.status);
        this.setDebugAttribute(
            "data-fairy-editor-workspace-external-conflicts",
            String(result.conflictCount || 0),
        );
        this.setStatus(result.message || (result.ok ? "No external changes detected." : "External changes detected."));
    }

    private showProjectImportDialog(): void {
        this.projectImportDialog.show();
    }

    private importProjectDirectory(): void {
        this.projectImportDialog.pickDirectory();
    }

    private importProjectZip(): void {
        this.projectImportDialog.pickZip();
    }

    private async applyProjectImport(
        picked: BrowserProjectImportResult,
        label: string,
    ): Promise<boolean> {
        return this.enqueueAuthoringOperation(() => this.applyProjectImportNow(picked, label));
    }

    private async applyProjectImportNow(
        picked: BrowserProjectImportResult,
        label: string,
    ): Promise<boolean> {
        if (!this.guardWorkspaceTransition("import", "data-fairy-editor-workspace-import")) return false;
        this.setStatus(`Project ${label} import started.`);

        const result = await this.workspaceLifecycle.importWorkspace(picked);
        if (this.disposed) return false;

        if (result.ok) {
            this.resetPublishedRuntimePackages();
            const connected = await this.connectBrowserLiveSession();
            this.recordWorkspaceLifecycleResult(result);
            if (!connected) {
                this.setStatus(`Project ${label} imported, but the browser live session did not reconnect.`, "error");
                return false;
            }
            this.setStatus(`Project ${label} imported: files ${result.storage.fileCount}.`);
            return true;
        }

        this.recordWorkspaceLifecycleResult(result);
        this.setStatus(`Project ${label} import failed: ${getWorkspaceLifecycleFailure(result)}.`);
        return false;
    }

    private renderWorkspaceImportError(label: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus(`Project ${label} import failed: ${message}`, "error");
        console.error(`[Workspace] project ${label} import failed`, error);
    }

    private async exportBrowserWorkspaceZip(): Promise<void> {
        await this.enqueueAuthoringOperation(() => this.exportBrowserWorkspaceZipNow());
    }

    private async exportBrowserWorkspaceZipNow(): Promise<void> {
        this.setStatus("Browser workspace export started.");

        try {
            const result = await this.workspaceLifecycle.exportWorkspaceZip();
            if (this.disposed) return;
            if (result.ok && result.export?.blob) {
                this.downloadWorkspaceExport(result.export.blob, result.export.fileName);
            }
            this.recordWorkspaceLifecycleResult(result);
            this.setStatus(
                result.ok
                    ? `Browser workspace exported: ${result.export?.fileName || "ZIP"}.`
                    : `Browser workspace export failed: ${getWorkspaceLifecycleFailure(result)}.`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Browser workspace export failed: ${message}`, "error");
            console.error("[Workspace] export failed", error);
        }
    }

    private createBrowserSaveTargetForSelection(): BrowserSaveTarget | undefined {
        const lastOperation = this.commandLastResult?.operation;
        if (lastOperation && lastOperation.kind !== "setDisplayNodeProps") {
            return this.liveSessionBridge.getLastSaveTarget() || undefined;
        }
        const selector = this.getSelectedDisplayNodeSelector();
        if (!selector) return undefined;
        return createDisplayNodeSaveTarget(
            this.liveSessionBridge.getWorkingProject(),
            selector,
        ) || undefined;
    }

    private guardWorkspaceTransition(action: string, debugAttribute: string): boolean {
        if (!this.commandAdapter.getSessionState().dirty) return true;
        this.setDebugAttribute(debugAttribute, "blocked-dirty");
        this.setDebugAttribute("data-fairy-editor-workspace-transition", `${action}:blocked-dirty`);
        this.setStatus(`Workspace ${action} blocked: Save or Undo the active workspace first.`);
        return false;
    }

    private resetPublishedRuntimePackages(): void {
        this.publishedTest.stop(false);
        this.runtimePreview.resetRuntimePackages();
    }

    private async connectBrowserLiveSession(): Promise<boolean> {
        this.commandAdapter.setLiveSessionRuntime(this.liveSessionBridge);
        this.populateInspectorFromSnapshot();
        this.layoutInspectorLines();

        const state = await this.liveSessionBridge.connect();
        if (this.disposed) return false;
        this.setDebugAttribute("data-fairy-editor-session-status", state.status);
        this.setDebugAttribute("data-fairy-editor-session-source", state.projectSource);
        this.setDebugAttribute("data-fairy-editor-session-backend", state.backendPackageVersion || "");
        this.setDebugAttribute("data-fairy-editor-session-model-fidelity", state.uamFidelity || "");
        this.setDebugAttribute("data-fairy-editor-session-lock-held", String(state.lockHeld ?? false));
        this.setDebugAttribute("data-fairy-editor-session-error", state.error || "");

        this.populateInspectorFromSnapshot();
        this.layoutInspectorLines();

        if (state.status === "connected") {
            const liveSnapshot = this.liveSessionBridge.getProjectSnapshot();
            if (!liveSnapshot) {
                const message = "Browser live session connected without a synchronized project snapshot.";
                this.setDebugAttribute("data-fairy-editor-session-error", "snapshot_sync_missing");
                this.setStatus(message, "error");
                console.warn(`[Editor Session] ${message}`);
                await this.liveSessionBridge.reset();
                return false;
            }
            if (state.projectSource === "browser_workspace") {
                // Storage is initialized only after the first static preview request; retry now so a saved workspace bundle wins.
                this.resetPublishedRuntimePackages();
            }
            this.applyProjectSnapshot(liveSnapshot, state.revision);
            this.setStatus(
                "Editor session connected.",
            );
            return true;
        }

        this.setStatus(
            `Editor session ${state.status}: ${state.error || "unavailable"}`,
            state.status === "failed" ? "error" : "warning",
        );
        if (state.status === "failed") {
            console.warn("[Editor Session] browser live session bridge failed", state);
        }
        return false;
    }

    private recordWorkspaceLifecycleResult(result: BrowserWorkspaceLifecycleResult): void {
        const materialize = result.results.materialize;
        const apply = result.results.apply;
        this.setDebugAttribute("data-fairy-editor-workspace-action", result.mode);
        this.setDebugAttribute("data-fairy-editor-workspace-ok", result.ok ? "true" : "false");
        this.setDebugAttribute("data-fairy-editor-workspace-project-file", result.storage.projectFileExists ? "true" : "false");
        this.setDebugAttribute("data-fairy-editor-workspace-files", String(result.storage.fileCount));
        this.setDebugAttribute("data-fairy-editor-workspace-materialize-ok", materialize ? String(materialize.ok) : "");
        this.setDebugAttribute("data-fairy-editor-workspace-materialize-revision", materialize?.revision === undefined ? "" : String(materialize.revision));
        this.setDebugAttribute("data-fairy-editor-workspace-apply-ok", apply ? String(apply.ok) : "");
        this.setDebugAttribute("data-fairy-editor-workspace-import-source", result.imported?.source || "");
        this.setDebugAttribute("data-fairy-editor-workspace-import-fairy", result.imported?.fairyPath || "");
        this.setDebugAttribute("data-fairy-editor-workspace-export-format", result.export?.format || "");
        this.setDebugAttribute(
            "data-fairy-editor-workspace-folder-binding",
            result.storage.directoryWriteback?.status || "",
        );
    }

    private downloadWorkspaceExport(blob: Blob, fileName: string): void {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        try {
            anchor.click();
        } finally {
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
        }
    }

    private recordBrowserSaveResult(result: BrowserSaveResult): void {
        this.setDebugAttribute("data-fairy-editor-workspace-save-ok", result.ok ? "true" : "false");
        this.setDebugAttribute("data-fairy-editor-workspace-writeback", result.writeback?.status || "");
        this.setDebugAttribute(
            "data-fairy-editor-workspace-writeback-conflicts",
            result.writeback?.conflictCount === undefined ? "" : String(result.writeback.conflictCount),
        );
    }

    private applyProjectSnapshot(snapshot: EditorProjectSnapshot, revision = 0): void {
        if (this.disposed) return;
        if (this.projectSnapshot?.project.id !== snapshot.project.id) {
            this.documentWorkspace.clear();
        }
        this.projectSnapshot = snapshot;
        this.commandAdapter.reset(snapshot, revision);
        this.commandLastResult = null;
        this.clearResourceSelection();
        const preferredPackage = snapshot.packages.find((pkg) => pkg.name === "Builder") || snapshot.packages[0] || null;
        const preferredComponent = preferredPackage
            ? preferredPackage.components.find((component) => component.name === "MainView")
                || preferredPackage.components[0]
                || null
            : null;

        if (!this.restoreProjectSelection(snapshot)) {
            this.activeDocument.setActiveSelection(
                snapshot,
                preferredPackage?.id || "",
                preferredComponent?.id || "",
            );
        }
        this.refreshProjectViews();
    }

    private applyLiveProjectSnapshot(
        snapshot: EditorProjectSnapshot,
        operations: EditorCommandOperation[] = [],
        invalidation: ProjectionInvalidation = "preserve-runtime-preview",
        preferredSelection: ActiveDocumentSelection | null = null,
    ): AuthoringPreviewProjectionPlan | null {
        if (this.disposed) return null;
        if (operations.length) this.markModifiedPackages(snapshot, operations);
        const previousPackageId = this.selectedPackageId;
        const previousComponentId = this.selectedComponentId;
        this.projectSnapshot = snapshot;
        this.commandAdapter.updateSnapshot(snapshot);
        if (preferredSelection) {
            this.activeDocument.setActiveSelection(
                snapshot,
                preferredSelection.packageId,
                preferredSelection.componentId,
                preferredSelection.nodeIds,
                preferredSelection.primaryNodeId,
            );
            this.clearResourceSelection();
        } else {
            const selectedPackage = snapshot.packages.find((pkg) => pkg.id === this.selectedPackageId)
                || snapshot.packages[0]
                || null;
            const selectedComponent = selectedPackage?.components.find(
                (component) => component.id === this.selectedComponentId,
            ) || selectedPackage?.components[0] || null;
            this.activeDocument.setActiveSelection(
                snapshot,
                selectedPackage?.id || "",
                selectedComponent?.id || "",
                this.selectedDisplayNodeIds,
                this.selectedDisplayNodeId,
            );
        }
        this.libraryController.reconcileInspectorSelection(snapshot);
        this.persistProjectSelection();
        const selectionChanged = previousPackageId !== this.selectedPackageId
            || previousComponentId !== this.selectedComponentId;
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        if (operations.length === 0 || !selectedPackage || !selectedComponent) {
            this.refreshProjectViews();
            this.setDebugAttribute("data-fairy-editor-preview-projection", "refreshed");
            this.setDebugAttribute("data-fairy-editor-preview-runtime-status", "current");
            this.setDebugAttribute("data-fairy-editor-preview-projection-reason", "full_refresh");
            return null;
        }

        this.refreshProjectViews(
            selectionChanged ? "refresh-runtime-preview" : invalidation,
        );
        const projection = this.runtimePreview.projectAuthoringSnapshot(
            selectedPackage.id,
            selectedComponent,
            operations,
        );
        this.setDebugAttribute("data-fairy-editor-preview-projection", projection.status);
        this.setDebugAttribute("data-fairy-editor-preview-projection-mode", projection.mode);
        this.setDebugAttribute("data-fairy-editor-preview-runtime-status", projection.runtimeStatus);
        this.setDebugAttribute("data-fairy-editor-preview-projection-reason", projection.reason);
        this.updatePreviewDescriptionFromSnapshot(
            projection.status === "applied"
                ? projection.runtimeStatus === "publish-required"
                    ? `Authoring canvas synced: ${projection.mode} · Runtime publish required`
                    : `Authoring canvas synced: ${projection.mode}`
                : "Authoring canvas unaffected",
        );
        return projection;
    }

    private markModifiedPackages(snapshot: EditorProjectSnapshot, operations: EditorCommandOperation[]): void {
        const validIds = new Set(snapshot.packages.map((pkg) => pkg.id));
        const found = new Set<string>();
        let projectWide = false;
        const visit = (value: unknown): void => {
            if (!value || typeof value !== "object") return;
            const record = value as Record<string, unknown>;
            if (record.kind === "updateProjectSettings") projectWide = true;
            if (typeof record.packageId === "string" && validIds.has(record.packageId)) found.add(record.packageId);
            if (record.kind === "addPackage" && record.package && typeof record.package === "object") {
                const id = String((record.package as Record<string, unknown>).id || "");
                if (validIds.has(id)) found.add(id);
            }
            Object.values(record).forEach(visit);
        };
        operations.forEach(visit);
        if (projectWide || !found.size) snapshot.packages.forEach((pkg) => this.modifiedPackageIds.add(pkg.id));
        else found.forEach((id) => this.modifiedPackageIds.add(id));
    }

    private restoreProjectSelection(snapshot: EditorProjectSnapshot): boolean {
        const selection = this.readProjectSelection();
        if (!selection || selection.projectId !== snapshot.project.id) return false;
        return this.activeDocument.restore(snapshot, selection);
    }

    private persistProjectSelection(): void {
        if (typeof window === "undefined") return;
        const selection = this.activeDocument.createPersistedSelection(this.projectSnapshot);
        if (!selection) return;
        try {
            window.localStorage.setItem(
                this.getWorkspaceLocalStorageKey(PROJECT_SELECTION_STORAGE_KEY),
                JSON.stringify(selection),
            );
        } catch {
            // Local storage is optional UI state; project persistence remains in browser workspace storage.
        }
    }

    private readProjectSelection(): PersistedEditorSelection | null {
        if (typeof window === "undefined") return null;

        try {
            const raw = this.readWorkspaceLocalStorage(PROJECT_SELECTION_STORAGE_KEY);
            if (!raw) return null;
            const value = JSON.parse(raw) as Partial<PersistedEditorSelection>;
            if (
                typeof value.projectId !== "string"
                || typeof value.packageId !== "string"
                || typeof value.componentId !== "string"
                || typeof value.displayNodeId !== "string"
            ) return null;
            const openDocuments = Array.isArray(value.openDocuments)
                ? value.openDocuments.filter((tab): tab is DesktopDocumentTab => (
                    !!tab
                    && typeof tab.packageId === "string"
                    && typeof tab.componentId === "string"
                ))
                : undefined;
            const groupPaths = Array.isArray(value.groupPaths)
                ? value.groupPaths.filter((entry): entry is DesktopDocumentTab & { groupIds: string[] } => (
                    !!entry
                    && typeof entry.packageId === "string"
                    && typeof entry.componentId === "string"
                    && Array.isArray(entry.groupIds)
                    && entry.groupIds.every((groupId) => typeof groupId === "string")
                ))
                : undefined;
            return { ...value, openDocuments, groupPaths } as PersistedEditorSelection;
        } catch {
            return null;
        }
    }

    private getSelectedPackage(): ProjectSnapshotPackage | null {
        return this.activeDocument.getPackage(this.projectSnapshot);
    }

    private getSelectedComponent(): ProjectSnapshotComponent | null {
        return this.activeDocument.getComponent(this.projectSnapshot);
    }

    private getSelectedResource(): ProjectSnapshotResource | null {
        const selection = this.libraryController.getInspectorSelection();
        if (selection?.kind !== "resource") return null;
        return this.findResource(selection.packageId, selection.resourceId);
    }

    private getLibraryActionPackage(): ProjectSnapshotPackage | null {
        const selection = this.libraryController.getInspectorSelection();
        return selection
            ? this.projectSnapshot?.packages.find((pkg) => pkg.id === selection.packageId) || null
            : this.getSelectedPackage();
    }

    private getLibraryActionComponent(): ProjectSnapshotComponent | null {
        const selection = this.libraryController.getInspectorSelection();
        const resource = this.getSelectedResource();
        const pkg = this.getLibraryActionPackage();
        if (selection?.kind !== "resource") return this.getSelectedComponent();
        return resource?.type === "Component"
            ? pkg?.components.find((component) => component.id === resource.id) || null
            : null;
    }

    private getLibraryActionComponentSelector(): { packageId: string; componentResourceId: string } | null {
        const pkg = this.getLibraryActionPackage();
        const component = this.getLibraryActionComponent();
        return pkg && component ? { packageId: pkg.id, componentResourceId: component.id } : null;
    }

    private getSelectedResourceFolder(): ProjectSnapshotResourceFolder | null {
        const selected = this.selectedResourceFolder;
        if (!selected) return null;
        const pkg = this.projectSnapshot?.packages.find((candidate) => candidate.id === selected.packageId);
        return (pkg?.folders || []).find((folder) => (
            folder.branch === selected.branch && folder.path === selected.path
        )) || null;
    }

    private getSelectedDisplayNode(): ProjectSnapshotDisplayNode | null {
        const component = this.getSelectedComponent();
        if (!component || !this.selectedDisplayNodeId) return null;
        return component.children.find((child) => child.id === this.selectedDisplayNodeId) || null;
    }

    private findResource(packageId: string, resourceId: string): ProjectSnapshotResource | null {
        const pkg = this.projectSnapshot?.packages.find((candidate) => candidate.id === packageId);
        return pkg?.resources.find((resource) => resource.id === resourceId) || null;
    }

    private selectCurrentHierarchyNode(tree: fgui.GTree): void {
        if (!this.selectedDisplayNodeId) return;
        const find = (parent: fgui.GTreeNode): fgui.GTreeNode | null => {
            for (let i = 0; i < parent.numChildren; i += 1) {
                const child = parent.getChildAt(i);
                const data = child.data as HierarchyItemData | null;
                if (data?.nodeId === this.selectedDisplayNodeId) return child;
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

    private requireChild(owner: fgui.GComponent, childName: string): fgui.GObject {
        const child = owner.getChild(childName);
        if (!child) {
            throw new Error(`Missing required UI child "${childName}" in ${owner.name || owner.resourceURL}.`);
        }
        return child;
    }
}
