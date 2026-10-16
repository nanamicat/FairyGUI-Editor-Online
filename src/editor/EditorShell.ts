import { findComponent, findDisplayNode, findResource } from "./commands/AuthoringTransactionSupport";
import {
    MENU_ITEMS,
    OBJECT_TOOLBAR_ACTIONS,
    TOOLBAR_ACTIONS,
    type EditorActionId,
    type ShellAction,
    type ShellEventListener,
    type ShellEventTarget,
} from "./EditorShellConfig";
import {
    getProjectResourceUrl,
    prepareRemoveComponent,
    readComponentProperties,
    type HighRiskTransactionPreparation,
    type PrimitiveDisplayNodeKind
} from "./commands/HighRiskAuthoringTransactions";
import { showBrowserWorkspaceDialog as openBrowserWorkspaceDialog } from "./dialogs/BrowserWorkspaceDialog";
import { showCreateLocalProjectDialog } from "./dialogs/CreateLocalProjectDialog";
import { isFilePickerCancelled, supportsLocalDirectories } from "./services/BrowserFileSystemAccess";
import { BrowserProjectImport, type BrowserProjectImportResult } from "./services/BrowserProjectImport";
import type { ExportedControllerDefinition } from "./dialogs/ComponentInstancePropertyEditors";
import { showPreferencesDialog as openPreferencesDialog } from "./dialogs/PreferencesDialog";
import {
    showProjectSettingsEditor as openProjectSettingsEditor,
    showStringsFunctionDialog as openStringsFunctionDialog,
} from "./dialogs/ProjectSettingsEditor";
import { showPackageGroupsEditor as openPackageGroupsEditor } from "./dialogs/PackageGroupsEditor";
import type {
    ComponentCustomPropertyDefinition,
    EditorCommandOperation,
    EditorCommandResult,
    EditorDisplayNodeSelector,
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
import {
    type AuthoringRuntimePackageLoadResult,
} from "./runtime/AuthoringRuntimePackageLoader";
import {
    DEFAULT_BROWSER_WORKSPACE_ID,
    type BrowserWorkspaceRegistryEntry,
} from "./runtime/BrowserWorkspaceRegistry";
import {
    getDesktopCanvasNudge,
} from "./runtime/DesktopCanvasInteraction";
import {
    appendDesktopConsoleEntry,
    getDesktopConsoleCopyText,
    type DesktopConsoleEntry,
    type DesktopConsoleLevel,
} from "./runtime/DesktopConsoleLog";
import {
    getDesktopDocumentTabId,
    type DesktopDocumentTab,
} from "./runtime/DesktopDocumentTabs";
import {
    EDITOR_SHORTCUTS,
    EDITOR_PREFERENCES_STORAGE_KEY,
    createDefaultEditorPreferences,
    parseEditorPreferences,
    resolveEditorShortcut,
    type EditorPreferences,
    type EditorShortcutId,
} from "./runtime/EditorPreferences";
import { PublishedTestController } from "./runtime/PublishedTestController";
import type {
    RuntimePreviewController,
    RuntimePreviewCanvasSettings,
} from "./runtime/RuntimePreviewController";
import {
    type BrowserLiveSessionIdentity,
} from "./services/BrowserLiveSessionBridge";
import type { ActiveDocumentSelection } from "./ui/ActiveDocumentController";
import {
    DesktopLayoutController,
    type DesktopLeftTopPanelMode,
    type DesktopLayoutPanels as ShellPanels,
} from "./ui/DesktopLayoutController";
import {
    setActionEnabled as setEditorFormActionEnabled,
} from "./ui/EditorFormControls";
import {
    EditorConsoleItem,
} from "./ui/EditorUiExtensions";
import {
    EditorMenuController,
    type EditorMenuCommand,
} from "./ui/EditorMenuController";
import type { InspectorPanelAction } from "./ui/InspectorController";
import {
    describeAuthoringPreviewProjection,
} from "./ui/InspectorPresentation";
import type { LibraryResourceFolderSelector } from "./ui/LibraryController";
import {
    type HierarchyItemData,
    type LibraryItemData,
} from "./ui/ProjectTreeInteractionController";
import { EditorShellChrome } from "./modules/ShellChromeModule";
import { EditorProjectSession } from "./modules/ProjectSessionModule";
import { EditorDocumentAuthoring } from "./modules/DocumentAuthoringModule";
import { EditorInspector } from "./modules/InspectorModule";
import { EditorProjectExplorer } from "./modules/ProjectExplorerModule";
import { EditorAuthoringDialogs } from "./modules/AuthoringDialogsModule";
import { EditorTimeline } from "./modules/TimelineModule";
import { EditorResourceAuthoring } from "./modules/ResourceAuthoringModule";
import { EditorDisplayListAuthoring } from "./modules/DisplayListAuthoringModule";
import { EditorWorkspaceLifecycle } from "./modules/WorkspaceLifecycleModule";
import { downloadBrowserFile } from "./services/BrowserDownload";

const EDITOR_REPOSITORY_URL = "https://github.com/OpenFairyGUI/FairyGUI-Editor-Online";
const FAIRYGUI_WEBSITE_URL = "https://fairygui.com/";

export class EditorShell {
    private readonly mainView: fgui.GComponent;
    private readonly chrome: EditorShellChrome;
    private readonly holder: fgui.GObject;
    private readonly menuBar: fgui.GComponent;
    private readonly toolbar: fgui.GComponent;
    private readonly startScene: fgui.GComponent;
    private readonly statusLine: fgui.GButton;
    private readonly panels: ShellPanels;
    private readonly inspectorCommandPanel: EditorInspector;
    private readonly unbindInspectorActions: () => void;
    private readonly libraryDock: fgui.GComponent;
    private readonly hierarchyDock: fgui.GComponent;
    private readonly favoritesView: fgui.GComponent;
    private readonly searchView: fgui.GComponent;
    private readonly referenceView: fgui.GComponent;
    private readonly transitionListView: fgui.GComponent;
    private readonly testView: fgui.GComponent;
    private readonly publishedTest: PublishedTestController;
    private readonly timelineView: fgui.GComponent;
    private readonly controllerTimeline: EditorTimeline["controller"];
    private readonly unbindTimeline: () => void;
    private readonly consoleView: fgui.GComponent;
    private readonly resourcePreview: EditorProjectExplorer["resourcePreview"];
    private readonly projectSession: EditorProjectSession;
    private readonly unbindProjectSnapshot: () => void;
    private readonly unbindLiveProjectSnapshot: () => void;
    private readonly documentAuthoring: EditorDocumentAuthoring;
    private readonly unbindDocumentAuthoring: () => void;
    private readonly workspaceLifecycle: EditorWorkspaceLifecycle;
    private readonly unbindWorkspaceLifecycle: () => void;
    private actionMenu: fgui.PopupMenu | null = null;
    private readonly actionUnbinders: Array<() => void> = [];
    private editorPreferences: EditorPreferences = createDefaultEditorPreferences();
    private readonly desktopLayout: DesktopLayoutController;
    private readonly libraryController: EditorProjectExplorer["library"];
    private readonly projectExplorer: EditorProjectExplorer;
    private readonly unbindProjectExplorer: () => void;
    private readonly authoringDialogs: EditorAuthoringDialogs["controller"];
    private readonly unbindAuthoringDialogs: () => void;
    private readonly resourceAuthoring: EditorResourceAuthoring["controller"];
    private readonly unbindResourceAuthoring: () => void;
    private readonly displayListAuthoring: EditorDisplayListAuthoring;
    private readonly unbindDisplayListAuthoring: () => void;
    private readonly editorMenus: EditorMenuController;
    private hierarchyKeyboardActive = false;
    private readonly treeInteraction: EditorProjectExplorer["treeInteraction"];
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
    private desktopPanToolEnabled = false;
    private desktopObjectTool: PrimitiveDisplayNodeKind | null = null;
    private activeBranch = "";
    private activeLanguagePath = "";
    private consoleEntries: DesktopConsoleEntry[] = [];
    private disposed = false;

    private get commandAdapter() { return this.projectSession.commandAdapter; }
    private get projectStorage() { return this.projectSession.projectStorage; }
    private get liveSessionBridge() { return this.projectSession.liveSessionBridge; }
    private get projectSnapshot(): EditorProjectSnapshot | null { return this.projectSession.snapshot; }
    private get runtimePreview(): RuntimePreviewController { return this.documentAuthoring.preview; }
    private get authoringJsonDialog(): fgui.Window | null { return this.authoringDialogs.getActiveDialog(); }
    private set authoringJsonDialog(dialog: fgui.Window | null) { this.authoringDialogs.setActiveDialog(dialog); }

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
    private get selectedPackageId(): string { return this.documentAuthoring.packageId; }
    private get selectedComponentId(): string { return this.documentAuthoring.componentId; }
    private get selectedDisplayNodeId(): string { return this.documentAuthoring.primaryNodeId; }
    private get selectedDisplayNodeIds(): string[] { return this.documentAuthoring.nodeIds; }
    private get selectedResourceFolder(): LibraryResourceFolderSelector | null {
        const selection = this.libraryController.getInspectorSelection();
        return selection?.kind === "folder" ? selection : null;
    }

    constructor(
        chrome: EditorShellChrome,
        projectSession: EditorProjectSession,
        documentAuthoring: EditorDocumentAuthoring,
        workspaceLifecycle: EditorWorkspaceLifecycle,
        inspector: EditorInspector,
        projectExplorer: EditorProjectExplorer,
        authoringDialogs: EditorAuthoringDialogs,
        displayListAuthoring: EditorDisplayListAuthoring,
        timeline: EditorTimeline,
        resourceAuthoring: EditorResourceAuthoring,
    ) {
        this.chrome = chrome;
        this.mainView = chrome.mainView;
        this.actionUnbinders.push(chrome.bindStatusReporter((message, level) => this.setStatus(message, level)));
        this.actionUnbinders.push(chrome.bindLayoutRequester(() => this.layout()));
        this.projectSession = projectSession;
        this.unbindProjectSnapshot = projectSession.onDidResetSnapshot((snapshot, previous) => {
            this.renderProjectSnapshot(snapshot, previous);
        });
        this.unbindLiveProjectSnapshot = projectSession.onDidSyncSnapshot((snapshot, operations) => {
            this.renderLiveProjectSnapshot(snapshot, operations);
        });
        this.documentAuthoring = documentAuthoring;
        this.workspaceLifecycle = workspaceLifecycle;
        this.unbindDocumentAuthoring = documentAuthoring.bind({
            activateDocument: (tab) => this.onDocumentActivated(tab),
            closeDocument: (tab) => this.onDocumentClosed(tab),
            changeGroupPathDepth: (depth) => this.onGroupPathDepthChanged(depth),
            selectPreviewNodes: (nodeIds, primaryNodeId) => this.onPreviewNodesSelected(nodeIds, primaryNodeId),
            runtimePackageLoaded: (result) => this.onRuntimePreviewPackageLoad(result),
            previewViewChanged: (zoom, panX, panY) => this.onPreviewViewChanged(zoom, panX, panY),
            createNode: (point) => this.placeDesktopPrimitive(point),
            openNode: (nodeId) => {
                this.openSelectedGroup(nodeId) || this.openReferencedComponent(nodeId);
            },
            showCanvasContextMenu: () => this.editorMenus.showCanvasContextMenu(),
            refreshPreview: () => this.populatePreviewFromSnapshot(),
        });
        this.holder = chrome.holder;
        this.menuBar = chrome.menuBar;
        this.toolbar = chrome.toolbar;
        this.startScene = chrome.startScene;
        this.statusLine = chrome.statusLine;
        this.panels = chrome.panels;
        this.resourcePreview = projectExplorer.resourcePreview;
        this.treeInteraction = projectExplorer.treeInteraction;
        this.libraryController = projectExplorer.library;
        this.projectExplorer = projectExplorer;
        this.unbindProjectExplorer = projectExplorer.bind({
            editPackageGroups: () => this.showPackageGroupsEditor(),
            applyLibrarySelection: (data, preserve) => this.applyLibrarySelection(data, preserve),
            clearLibrarySelection: () => {
                this.clearResourceSelection();
                this.populateInspectorFromSnapshot();
                this.layoutInspectorLines();
            },
            resourceViewStateChanged: () => this.saveResourceViewState(),
            showLibraryContextMenu: (cell, data) => this.showLibraryContextMenu(cell, data),
            showHierarchyContextMenu: (cell, data) => this.showHierarchyContextMenu(cell, data),
            openLibraryItem: (data) => this.openLibraryItem(data),
            getComponentPreviewEnabled: () => this.editorPreferences.componentPreviewEnabled,
            setComponentPreviewEnabled: (enabled) => this.updateEditorPreferences({
                ...this.editorPreferences,
                componentPreviewEnabled: enabled,
            }),
            activateDocument: (packageId, componentId) => this.activateDocumentTab({ packageId, componentId }),
            documentSelectionChanged: () => {
                this.clearResourceSelection();
                this.populateInspectorFromSnapshot();
                this.runtimePreview.selectNodes(this.selectedDisplayNodeIds, this.selectedDisplayNodeId);
                this.layoutInspectorLines();
            },
            deactivateTimelineKeyboard: () => this.controllerTimeline.setKeyboardActive(false),
            showLeftPanel: (mode, ensureVisible) => {
                if (ensureVisible) {
                    this.showEditorWorkspace();
                    if (!this.leftDockVisible) {
                        this.leftDockVisible = true;
                        this.saveDesktopLayoutState();
                    }
                }
                this.leftTopPanelMode = mode;
            },
            setTransientStatus: (message) => this.setTransientStatus(message),
        });
        this.inspectorCommandPanel = inspector;
        this.unbindInspectorActions = inspector.bindActions((action) => this.onInspectorPanelAction(action));
        this.favoritesView = chrome.favoritesView;
        this.searchView = chrome.searchView;
        this.libraryDock = chrome.libraryDock;
        this.hierarchyDock = chrome.hierarchyDock;
        this.referenceView = chrome.referenceView;
        this.transitionListView = chrome.transitionListView;
        this.testView = chrome.testView;
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
        this.timelineView = chrome.timelineView;
        this.controllerTimeline = timeline.controller;
        this.unbindTimeline = timeline.bind({
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
        });
        this.authoringDialogs = authoringDialogs.controller;
        this.unbindAuthoringDialogs = authoringDialogs.bind({
            getSelectedControllerName: () => this.controllerTimeline.selectedControllerName,
            setSelectedControllerName: (name) => { this.controllerTimeline.selectedControllerName = name; },
            getSelectedTransitionName: () => this.controllerTimeline.selectedTransitionName,
            getCustomPropertyDefinitions: () => this.getSelectedComponentCustomPropertyDefinitions(),
            getExportedControllers: () => this.getSelectedComponentExportedControllers(),
            applyDisplayNodeCommand: (command, summary) => this.applyDisplayNodePropsCommand(command, summary),
            applyPreparation: (preparation, identity) => this.applyAuthoringPreparation(preparation, identity),
            activateDocument: (packageId, componentId) => this.activateDocumentTab({ packageId, componentId }),
            onTimelineItemApplied: (itemIndex) => {
                this.controllerTimeline.setSelectedTimelineItemIndex(itemIndex);
                this.controllerTimeline.populateTimeline();
            },
            createActionMenu: () => this.createActionMenu(),
            addMenuItem: (menu, name, title, handler) => this.addMenuItem(menu, name, title, handler),
        });
        this.displayListAuthoring = displayListAuthoring;
        this.unbindDisplayListAuthoring = displayListAuthoring.bind({
            refreshSelectionViews: () => this.syncDisplayNodeSelectionViews(),
            refreshProjectViews: () => this.refreshProjectViews(),
        });
        this.resourceAuthoring = resourceAuthoring.controller;
        this.unbindResourceAuthoring = resourceAuthoring.bind({
            getSelectedLibraryResourceSelectors: () => this.libraryController.getSelectedResourceSelectors(this.leftTopPanelMode),
            applyPreparation: (preparation, identity) => this.applyAuthoringPreparation(preparation, identity),
            applyLibrarySelection: (data, preserve) => this.applyLibrarySelection(data, preserve),
            refreshProjectViews: () => this.refreshProjectViews(),
            createActionMenu: () => this.createActionMenu(),
            addMenuItem: (menu, name, title, handler) => this.addMenuItem(menu, name, title, handler),
            showActionMenu: (menu, anchor, source, status) => this.showActionMenu(menu, anchor, source, status),
            showSelectedResourceInspector: () => this.showSelectedResourceInspector(),
            removeSelectedComponent: () => this.requestAuthoringRemoveComponent(),
        });
        this.editorMenus = new EditorMenuController({
            getState: () => ({
                canUndo: this.commandAdapter.canUndo(),
                canRedo: this.commandAdapter.canRedo(),
                shortcuts: this.editorPreferences.shortcuts,
                selectedNodeCount: this.selectedDisplayNodeIds.length,
                canPaste: this.displayListAuthoring.canPaste,
                hasSelectedComponent: Boolean(this.getSelectedComponent()),
                selectedNodeIsGroup: this.getSelectedDisplayNode()?.type === "GGroup",
                groupDepth: this.getActiveGroupPath().length,
                canShowInLibrary: Boolean(this.getSelectedDisplayNodeResourceSelector()),
                timelineVisible: this.timelineVisible,
                selectedTransition: Boolean(this.controllerTimeline.selectedTransitionName),
                selectedTimelineItem: this.controllerTimeline.getSelectedTimelineItemIndex() >= 0,
                hierarchyExpanded: this.projectExplorer.hierarchyExpanded,
                leftTopPanelMode: this.leftTopPanelMode,
                leftDockVisible: this.leftDockVisible,
                inspectorDockVisible: this.desktopLayout.inspectorDockVisible,
                consoleVisible: this.consoleVisible,
                documentCount: this.documentAuthoring.count,
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
        this.consoleView = chrome.consoleView;
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
                this.controllerTimeline.fitLayout();
                this.publishedTest.layout();
                this.runtimePreview.layout();
                this.layoutInspectorLines();
            },
            setDebugAttribute: (name, value) => this.setDebugAttribute(name, value),
            setStatus: (message) => this.setStatus(message),
        });
        this.unbindWorkspaceLifecycle = workspaceLifecycle.bind({
            persistWorkspaceViewState: () => this.saveDesktopLayoutState(),
            resetAndRestoreWorkspaceViewState: () => {
                this.libraryPackageId = "";
                this.clearResourceSelection();
                this.selectedLibraryResourceSelectors = [];
                this.applyDefaultDesktopLayoutState();
                this.restoreDesktopLayoutState();
                this.restoreResourceViewState();
            },
            showStartScene: () => this.showStartScene(),
            stopPublishedTestQuietly: () => this.publishedTest.stop(false),
        });
        this.restoreEditorPreferences();
        this.restoreDesktopLayoutState();
        this.restoreResourceViewState();
        this.configureMainViewControllers();
        this.populateStaticData();
        this.registerEditorActions();
        this.bindActions();
        this.configureToolbarCapabilities();
        this.layout();
        this.showStartScene();
        void this.workspaceLifecycle.prepareStartScene().then(() => {
            if (!this.disposed && this.startScene.visible) this.populateStartSceneRecentWorkspaces();
        });

        Laya.stage.on(Laya.Event.RESIZE, this, this.onStageResize);
        Laya.stage.on(Laya.Event.MOUSE_DOWN, this, this.onStageMouseDown);
        Laya.stage.on(Laya.Event.KEY_DOWN, this, this.onStageKeyDown);
        Laya.stage.on(Laya.Event.KEY_UP, this, this.onStageKeyUp);
        this.setStatus("请选择 FairyGUI 工程目录，并允许浏览器读写。");
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        Laya.stage.off(Laya.Event.RESIZE, this, this.onStageResize);
        Laya.stage.off(Laya.Event.MOUSE_DOWN, this, this.onStageMouseDown);
        Laya.stage.off(Laya.Event.KEY_DOWN, this, this.onStageKeyDown);
        Laya.stage.off(Laya.Event.KEY_UP, this, this.onStageKeyUp);
        this.unbindProjectSnapshot();
        this.unbindLiveProjectSnapshot();
        this.unbindDocumentAuthoring();
        this.unbindInspectorActions();
        this.unbindProjectExplorer();
        this.unbindResourceAuthoring();
        this.unbindDisplayListAuthoring();
        this.unbindWorkspaceLifecycle();
        this.unbindTimeline();
        this.unbindAuthoringDialogs();
        this.unbindActions();
        this.actionMenu?.dispose();
        this.actionMenu = null;
        this.publishedTest.dispose();
        this.desktopLayout.dispose();
    }

    layout(): void {
        if (this.disposed) return;
        this.desktopLayout.layout();
        this.chrome.notifyLayout();
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
            const workspace = this.projectStorage.getWorkspaceName();
            localStorage.setItem(this.getWorkspaceLocalStorageKey("fairygui-editor-online.resource-view.v1"), JSON.stringify({
                ...this.libraryController.getViewState(),
                linked: this.projectExplorer.linked,
                branch: this.activeBranch,
                language: this.activeLanguagePath,
                canvas: this.canvasSettings,
                canvasPerDocumentZoom: this.documentAuthoring.usePerDocumentView,
                snapToGrid: this.desktopSnapEnabled,
                twoColumn: this.panels.library.getChild("btnTwoColumn").asButton.selected,
            }));
            this.setDebugAttribute(
                "data-fairy-editor-resource-view-save",
                `${workspace}:${this.panels.library.getChild("btnTwoColumn").asButton.selected ? "two" : "one"}`,
            );
        } catch (error) {
            this.setDebugAttribute(
                "data-fairy-editor-resource-view-save",
                `error:${error instanceof Error ? error.message : String(error)}`,
            );
            // View preferences are optional and never block authoring.
        }
    }

    private restoreResourceViewState(): void {
        try {
            const raw = this.readWorkspaceLocalStorage("fairygui-editor-online.resource-view.v1");
            const state = raw ? JSON.parse(raw) as Record<string, unknown> : {};
            this.libraryController.restoreViewState(state);
            this.projectExplorer.linked = state.linked === true;
            this.activeBranch = typeof state.branch === "string" ? state.branch : "";
            this.activeLanguagePath = typeof state.language === "string" ? state.language : "";
            if (state.canvas && typeof state.canvas === "object") this.canvasSettings = {
                ...this.canvasSettings,
                ...state.canvas as Partial<RuntimePreviewCanvasSettings>,
            };
            this.documentAuthoring.usePerDocumentView = state.canvasPerDocumentZoom === true;
            this.desktopSnapEnabled = state.snapToGrid === true;
            this.panels.library.getChild("btnTwoColumn").asButton.selected = state.twoColumn === true;
            this.setDebugAttribute(
                "data-fairy-editor-resource-view-restore",
                `${this.projectStorage.getWorkspaceName()}:${state.twoColumn === true ? "two" : "one"}`,
            );
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
        this.applyEditorPreferences();
    }

    private updateEditorPreferences(preferences: EditorPreferences): void {
        this.editorPreferences = preferences;
        try {
            localStorage.setItem(EDITOR_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
        } catch {
            // Preferences persistence is optional and must not block authoring.
        }
        this.applyEditorPreferences();
        this.layout();
        this.setStatus("Editor preferences saved in this browser.");
    }

    private applyEditorPreferences(): void {
        const language = this.editorPreferences.language === "system"
            ? (navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en")
            : this.editorPreferences.language;
        document.documentElement.lang = language;
        const font = this.editorPreferences.uiFont.trim() || "Arial";
        Laya.Config.defaultFont = font;
        const applyFont = (object: fgui.GObject): void => {
            if (object.name === "docContainer" || object === this.testView) return;
            if (object instanceof fgui.GTextField) object.font = font;
            if (!(object instanceof fgui.GComponent)) return;
            for (let index = 0; index < object.numChildren; index += 1) applyFont(object.getChildAt(index));
        };
        for (const root of [this.menuBar, this.toolbar, this.startScene, this.statusLine, ...Object.values(this.panels)]) {
            applyFont(root);
        }
        this.setDebugAttribute("data-fairy-editor-language", language);
        this.setDebugAttribute("data-fairy-editor-ui-font", font);
    }

    private configureMainViewControllers(): void {
        this.mainView.getController("start").selectedIndex = 0;
        this.mainView.getController("menu").selectedIndex = 0;
        this.startScene.visible = false;
        this.statusLine.visible = true;
        this.mainView.getChild("userInfo").visible = false;
        this.toolbar.getChild("tbImport").tooltips = "导入项目";
        this.toolbar.getChild("tbSaveAll").visible = false;
        this.startScene.getChild("n3").asRichTextField.text = "[url=create]创建新项目[/url]";
        this.startScene.getChild("n4").asRichTextField.text = "[url=open]打开项目...[/url]";
        this.startScene.getChild("n5").asRichTextField.text = "[url=open_folder]打开文件夹...[/url]";
        this.startScene.getChild("n4").tooltips = "选择包含 .fairy 文件的项目目录，并授权读写整个工程。";
        const hint = new fgui.GTextField();
        hint.name = "directoryPermissionHint";
        hint.fontSize = 13;
        hint.color = "#bdbdbd";
        hint.autoSize = fgui.AutoSizeType.None;
        hint.setXY(350, 166);
        hint.setSize(560, 62);
        hint.text = supportsLocalDirectories()
            ? "选择项目目录后，请允许浏览器读写。\n保存会写回授权目录；刷新后可从最近项目重新授权打开。"
            : "本地目录读写需要 HTTPS / localhost 下的 Chrome 或 Edge。\n请在支持 File System Access API 的浏览器中打开本页。";
        this.startScene.addChild(hint);
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
            download: downloadBrowserFile,
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
                this.projectExplorer.populateLibrary();
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
        this.projectExplorer.populateFallbackLibrary();
        this.populateFallbackDocument();
        this.populateFallbackPreview();
        this.projectExplorer.populateFallbackHierarchy();
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
        this.toolbar.getChild("tbImport").visible = false;
        this.toolbar.getChild("tbSaveAll").visible = false;
        this.toolbar.getChild("tbPublish").visible = false;
        this.toolbar.getChild("tbPublishSettings").visible = false;
        this.toolbar.getChild("tbTest").visible = true;
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

    private refreshProjectViews(
        invalidation: ProjectionInvalidation = "refresh-runtime-preview",
    ): void {
        if (this.disposed) return;
        this.refreshToolbarSettingsSelectors();
        this.projectExplorer.populateLibrary();
        this.projectExplorer.populateFavorites();
        this.populateDocumentFromSnapshot();
        if (invalidation === "refresh-runtime-preview") {
            this.populatePreviewFromSnapshot();
        } else {
            this.panels.preview.getChild("desc").text = "Authoring model changed; publish/import a matching runtime package to refresh preview.";
        }
        this.projectExplorer.populateHierarchy();
        this.populateInspectorFromSnapshot();
        this.layoutInspectorLines();
        this.projectExplorer.refreshProjectSearch();
        if (this.leftTopPanelMode === "reference") this.projectExplorer.refreshProjectReferences();
    }

    private populateDocumentFromSnapshot(): void {
        const snapshot = this.projectSnapshot;
        if (!snapshot) return;
        this.documentAuthoring.render(snapshot);
        this.controllerTimeline.populateControllerPanel();
        this.controllerTimeline.populateTransitionList();
        this.controllerTimeline.populateTimeline();
    }

    private getActiveGroupPath(component: ProjectSnapshotComponent | null = this.getSelectedComponent()): string[] {
        return this.documentAuthoring.getActiveGroupPath(component);
    }

    private getScopedDisplayNodeIds(component: ProjectSnapshotComponent): string[] {
        return this.documentAuthoring.getScopedNodeIds(component);
    }

    private onGroupPathDepthChanged(targetDepth: number): void {
        this.clearResourceSelection();
        this.refreshProjectViews();
        this.setStatus(targetDepth === 0 ? "Closed group isolation." : `Group isolation moved to depth ${targetDepth}.`);
    }

    private openSelectedGroup(nodeId: string = this.selectedDisplayNodeId): boolean {
        const path = this.documentAuthoring.openGroup(nodeId);
        if (!path) return false;
        this.clearResourceSelection();
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-group-isolation", `open:${path.join("/")}`);
        const group = this.getSelectedComponent()?.children.find((node) => node.id === nodeId);
        this.setStatus(`Opened group ${group?.name || nodeId}; selection is limited to its direct members.`);
        return true;
    }

    private closeSelectedGroup(): void {
        const closedGroupId = this.documentAuthoring.closeGroup();
        if (!closedGroupId) return;
        this.clearResourceSelection();
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-group-isolation", `close:${closedGroupId}`);
        this.setStatus("Closed one group-isolation level.");
    }

    private getActiveDocumentTab(): DesktopDocumentTab | null {
        return this.documentAuthoring.getActiveTab();
    }

    private activateDocumentTab(documentTab: DesktopDocumentTab): boolean {
        if (!this.documentAuthoring.activate(documentTab)) return false;
        this.finishDocumentActivation(documentTab);
        return true;
    }

    private finishDocumentActivation(documentTab: DesktopDocumentTab): void {
        this.clearResourceSelection();
        this.refreshProjectViews();
        if (this.projectExplorer.linked) this.projectExplorer.locateActiveDocumentInLibrary(false);
        this.setDebugAttribute("data-fairy-editor-active-document", getDesktopDocumentTabId(documentTab));
    }

    private onDocumentActivated(documentTab: DesktopDocumentTab): void {
        this.finishDocumentActivation(documentTab);
        const component = this.getSelectedComponent();
        this.setStatus(`Document activated: ${component?.name || documentTab.componentId}.`);
    }

    private onDocumentTabClose(documentTab: DesktopDocumentTab, event?: Laya.Event): void {
        event?.stopPropagation();
        this.documentAuthoring.close(documentTab);
        this.onDocumentClosed(documentTab);
    }

    private onDocumentClosed(documentTab: DesktopDocumentTab): void {
        const activeDocument = this.getActiveDocumentTab();
        this.clearResourceSelection();
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-document-tab-close", getDesktopDocumentTabId(documentTab));
        this.setStatus(
            activeDocument
                ? `Document closed; active ${this.getSelectedComponent()?.name || activeDocument.componentId}.`
                : "All documents closed.",
        );
    }

    private closeOtherDocuments(): void {
        if (!this.documentAuthoring.closeOthers()) return;
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-document-tab-close", "others");
        this.setStatus("已关闭其他文档。");
    }

    private closeAllDocuments(): void {
        this.documentAuthoring.closeAll();
        this.clearResourceSelection();
        this.refreshProjectViews();
        this.setDebugAttribute("data-fairy-editor-document-tab-close", "all");
        this.setStatus("已关闭所有文档。");
    }

    private cycleDocumentTab(delta: number): void {
        const target = this.documentAuthoring.cycle(delta);
        if (!target) return;
        this.finishDocumentActivation(target);
        this.setStatus(`Document activated: ${this.getSelectedComponent()?.name || target.componentId}.`);
    }

    private getReferencedComponentTab(nodeId: string = this.selectedDisplayNodeId): DesktopDocumentTab | null {
        return this.documentAuthoring.getReferencedComponentTab(nodeId);
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
        this.projectExplorer.syncRuntimePreviewPresentation();
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

    private populateInspectorFromSnapshot(): void {
        this.inspectorCommandPanel.renderCurrent(
            this.getSelectedComponentCustomPropertyDefinitions().length > 0
            || this.getSelectedComponentExportedControllers().length > 0,
        );
    }

    private renderResourceInspector(resource: ProjectSnapshotResource | null): void {
        this.inspectorCommandPanel.renderResource(resource);
    }

    private renderResourceFolderInspector(folder: ProjectSnapshotResourceFolder | null): void {
        this.inspectorCommandPanel.renderResourceFolder(folder, this.commandAdapter.getSessionState().liveSession);
    }

    private renderInspectorLines(details: string[]): void {
        if (!this.disposed) this.inspectorCommandPanel.renderLines(details);
    }

    private layoutInspectorLines(): void {
        if (!this.disposed) this.inspectorCommandPanel.layout();
    }

    private onInspectorPanelAction(action: InspectorPanelAction): void {
        switch (action) {
            case "command:sourceSize": void this.displayListAuthoring.applySelectedNodeSourceSize(); return;
            case "properties:common": this.authoringDialogs.showCommonDisplayProperties(); return;
            case "properties:image": this.authoringDialogs.showImageProperties(); return;
            case "properties:movieClip": this.authoringDialogs.showMovieClipProperties(); return;
            case "properties:text": this.authoringDialogs.showTextProperties(); return;
            case "properties:graph": this.authoringDialogs.showGraphProperties(); return;
            case "properties:group": this.authoringDialogs.showGroupProperties(); return;
            case "properties:loader": this.authoringDialogs.showLoaderProperties(); return;
            case "properties:loader3d": this.authoringDialogs.showLoader3DProperties(); return;
            case "properties:list": this.authoringDialogs.showListProperties(); return;
            case "properties:componentInstance": this.authoringDialogs.showComponentInstanceProperties(); return;
            case "properties:componentCustomValues": this.authoringDialogs.showComponentCustomPropertyValues(); return;
            case "component:properties": this.authoringDialogs.showComponentProperties(); return;
            case "component:extension": this.authoringDialogs.showComponentExtensionProperties(); return;
            case "component:customProperties": this.authoringDialogs.showComponentCustomPropertyDefinitions(); return;
            case "resourceFolder:atlas": this.resourceAuthoring.showResourceFolderPropertiesEditor(); return;
            case "display:relations": this.authoringDialogs.showRelationEditor(); return;
            case "display:gears": this.authoringDialogs.showGearEditor(); return;
        }
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
        let commandResult: Awaited<ReturnType<EditorProjectSession["applyDisplayNodePropsNow"]>>;
        let projection: AuthoringPreviewProjectionPlan | null = null;
        try {
            commandResult = await this.projectSession.applyDisplayNodePropsNow(commands, summary, false);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.refreshPreviewForSelectedNode();
            this.populateInspectorFromSnapshot();
            this.setStatus(`Command failed: ${message}`, "error");
            console.error("[Editor Session] command apply failed", error);
            return false;
        }

        if (this.disposed) return false;
        if (commandResult.result.ok && commandResult.snapshot) {
            projection = this.renderLiveProjectSnapshot(commandResult.snapshot, commandResult.operations);
        }
        if (commandResult.result.ok) {
            this.setStatus(`${summary}. ${describeAuthoringPreviewProjection(projection)}`);
        } else {
            this.refreshPreviewForSelectedNode();
            this.populateInspectorFromSnapshot();
            this.setStatus(`Command failed: ${commandResult.result.error?.code || "unknown_error"}.`);
        }
        return commandResult.result.ok;
    }

    private async undoCommand(): Promise<void> {
        await this.enqueueAuthoringOperation(() => this.undoCommandNow());
    }

    private async undoCommandNow(): Promise<void> {
        let commandResult: Awaited<ReturnType<EditorProjectSession["undoNow"]>>;
        try {
            commandResult = await this.projectSession.undoNow(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Undo failed: ${message}`, "error");
            console.error("[Editor Session] command undo failed", error);
            return;
        }
        if (this.disposed) return;
        this.applyCommandHistoryResult(commandResult.result, "Undo", commandResult.snapshot);
    }

    private async redoCommand(): Promise<void> {
        await this.enqueueAuthoringOperation(() => this.redoCommandNow());
    }

    private async redoCommandNow(): Promise<void> {
        let commandResult: Awaited<ReturnType<EditorProjectSession["redoNow"]>>;
        try {
            commandResult = await this.projectSession.redoNow(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Redo failed: ${message}`, "error");
            console.error("[Editor Session] command redo failed", error);
            return;
        }
        if (this.disposed) return;
        this.applyCommandHistoryResult(commandResult.result, "Redo", commandResult.snapshot);
    }

    private applyCommandHistoryResult(
        result: EditorCommandResult,
        action: "Undo" | "Redo",
        snapshot: EditorProjectSnapshot | null,
    ): void {
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

        const operations = result.operations || (result.operation ? [result.operation] : []);
        if (snapshot) {
            const selection = this.documentAuthoring.resolveCommandTargetSelection(snapshot, targets);
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
        let outcome: Awaited<ReturnType<EditorProjectSession["applyPreparationNow"]>>;
        try {
            outcome = await this.projectSession.applyPreparationNow(preparation, preparationIdentity, false);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Operation failed: ${message}`, "error");
            console.error("[Editor Transaction] apply failed", error);
            return false;
        }

        if (this.disposed) return false;
        if (outcome.kind === "unavailable") {
            this.setStatus(`Operation unavailable: ${outcome.preparation.code}. ${outcome.preparation.message}`);
            return false;
        }
        if (outcome.kind === "stale") {
            this.setStatus(
                "Operation cancelled because the project changed while it was queued. Retry the action.",
                "warning",
            );
            return false;
        }
        const { result, snapshot, operations, summary } = outcome;
        if (!result.ok) {
            this.setStatus(`Operation failed: ${result.error?.code || "unknown_error"}.`, "error");
            this.populateInspectorFromSnapshot();
            return false;
        }

        if (snapshot) {
            const projection = this.renderLiveProjectSnapshot(snapshot, operations);
            this.setStatus(
                `${summary}. ${describeAuthoringPreviewProjection(projection)}`,
            );
            return true;
        }
        this.setStatus(`${summary}. Canvas could not be refreshed.`);
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

    private onPreviewViewChanged(zoom: number, panX: number, panY: number): void {
        const combo = this.toolbar.getChild("viewScale").asComboBox;
        const index = combo.values.indexOf(String(zoom));
        if (index >= 0 && combo.selectedIndex !== index) combo.selectedIndex = index;
    }

    private enqueueAuthoringOperation(task: () => Promise<boolean>): Promise<boolean>;
    private enqueueAuthoringOperation(task: () => Promise<void>): Promise<void>;
    private enqueueAuthoringOperation(
        task: () => Promise<boolean | void>,
    ): Promise<boolean | void> {
        return this.projectSession.runExclusive(() => (
            this.disposed ? Promise.resolve(false) : task()
        ));
    }

    private sameDisplayNodeSelection(left: string[], right: string[]): boolean {
        return left.length === right.length
            && left.every((nodeId) => right.indexOf(nodeId) >= 0);
    }

    private setDisplayNodeSelection(nodeIds: string[], primaryNodeId: string = ""): void {
        this.documentAuthoring.setSelection(nodeIds, primaryNodeId);
    }

    private clearDisplayNodeSelection(): void {
        this.documentAuthoring.clearSelection();
    }

    private clearResourceSelection(): void {
        this.libraryController.clearInspectorSelection();
    }

    private syncDisplayNodeSelectionViews(): void {
        this.projectExplorer.populateHierarchy();
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

    private getSelectedComponentSelector(): { packageId: string; componentResourceId: string } | null {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        if (!selectedPackage || !selectedComponent) return null;
        return { packageId: selectedPackage.id, componentResourceId: selectedComponent.id };
    }

    private registerEditorActions(): void {
        const register = (ids: EditorActionId[], run: () => void): void => {
            this.actionUnbinders.push(this.chrome.registerActions(ids, run));
        };
        register(["library:refresh"], () => { void this.refreshProjectSnapshot(); });
        register(["menu:file", "workspace:showPanel"], () => this.showBrowserWorkspaceSelector());
        register(["menu:resource"], () => this.showSelectedResourceInspector());
        register(["menu:tools"], () => this.openProjectSettingsDialog());
        register(["menu:view", "hierarchy:expand"], () => this.projectExplorer.toggleHierarchyExpansion());
        register(["toolbar:canvasSettings"], () => this.showCanvasSettings());
        register(["toolbar:branchSettings", "toolbar:languageSettings"], () => this.openProjectSettingsDialog());
        register(["toolbar:test"], () => this.publishedTest.start());
        register(["toolbar:stopTest"], () => this.publishedTest.stop());
        register(["toolbar:reloadTest"], () => this.publishedTest.reload());
        register(["preview:play"], () => {
            if (!this.resourcePreview.play()) this.controllerTimeline.playRuntimePreviewTransition();
        });
        register(["projectSearch"], () => this.projectExplorer.showProjectSearch());
        register(["undo"], () => { if (this.commandAdapter.canUndo()) void this.undoCommand(); });
        register(["redo"], () => { if (this.commandAdapter.canRedo()) void this.redoCommand(); });
        register(["nextDocument"], () => { if (this.documentAuthoring.count > 1) this.cycleDocumentTab(1); });
        register(["previousDocument"], () => { if (this.documentAuthoring.count > 1) this.cycleDocumentTab(-1); });
        register(["closeDocument"], () => {
            const activeDocument = this.getActiveDocumentTab();
            if (activeDocument) this.onDocumentTabClose(activeDocument);
        });
        register(["test"], () => {
            this.publishedTest.isActive() ? this.publishedTest.reload() : this.publishedTest.start();
        });
        register(["preferences"], () => this.showPreferencesDialog());
        register(["duplicate"], () => {
            if (!this.controllerTimeline.isTimelineFocused() && this.selectedDisplayNodeIds.length > 0) {
                void this.displayListAuthoring.duplicateSelectedDisplayNodes();
            }
        });
        register(["delete"], () => {
            if (this.controllerTimeline.isTimelineFocused()) void this.controllerTimeline.removeSelectedTimelineItem();
            else if (this.selectedDisplayNodeIds.length > 0) void this.displayListAuthoring.deleteSelectedDisplayNodes();
        });
        register(["openReferenced"], () => {
            if (this.controllerTimeline.isTimelineFocused()) this.controllerTimeline.showSelectedTimelineItemEditor();
            else this.openSelectedGroup() || this.openReferencedComponent();
        });
        register(["toggleGrid"], () => this.toggleDesktopGridSnap());
        register(["showLibrary"], () => this.projectExplorer.showLibraryPanel());
        register(["showFavorites"], () => this.projectExplorer.showFavoritesPanel());
        register(["toggleTimeline"], () => this.toggleTimeline());
        register(["toggleConsole"], () => this.toggleDesktopConsole());
    }

    private runEditorAction(action: EditorActionId): boolean {
        return this.chrome.runAction(action);
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
        this.listenClick(this.panels.library.getChild("btnRefresh"), this.onAction, ["library:refresh"]);
        this.listenClick(this.panels.preview.getChild("play"), this.onAction, ["preview:play"]);
        this.listenClick(this.panels.document.getChild("hand"), this.setDesktopPanTool, [true]);
        this.listenClick(this.panels.document.getChild("arrow"), this.setDesktopPanTool, [false]);
        const objectToolbar = this.panels.document.getChild("objToolbar").asCom;
        for (const action of OBJECT_TOOLBAR_ACTIONS) {
            this.listenClick(objectToolbar.getChild(action.childName), this.setDesktopObjectTool, [action.kind]);
        }
        this.listenEvent(this.panels.library.getChild("listView"), Laya.Event.RIGHT_MOUSE_DOWN, this.onLibraryBackgroundRightClick);
        this.listenEvent(this.panels.library.getChild("treeView"), Laya.Event.RIGHT_MOUSE_DOWN, this.onLibraryBackgroundRightClick);
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
        if (this.handleTimelineKey(event)) return;
        this.handleCanvasKey(event);
    }

    private handleHierarchyKey(event: Laya.Event): boolean {
        if (!this.hierarchyKeyboardActive || event.ctrlKey || event.metaKey || event.altKey) return false;
        if (event.key === "F2") {
            event.preventDefault();
            this.displayListAuthoring.showHierarchyRenameDialog();
            return true;
        }
        if (event.key === "Escape" && this.projectExplorer.hierarchyQuery) {
            event.preventDefault();
            this.projectExplorer.clearHierarchySearch();
            return true;
        }
        if (event.key === "Backspace") {
            event.preventDefault();
            this.projectExplorer.setHierarchySearchQuery(this.projectExplorer.hierarchyQuery.slice(0, -1));
            return true;
        }
        if (event.key.length !== 1) return false;
        event.preventDefault();
        this.projectExplorer.setHierarchySearchQuery(this.projectExplorer.hierarchyQuery + event.key.toLocaleLowerCase());
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
        if (canvasFocused && (key === "=" || key === "+" || key === "-" || key === "0")) {
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
        else return false;
        event.preventDefault();
        return true;
    }

    private handleCanvasKey(event: Laya.Event): void {
        if (event.altKey || !this.runtimePreview.hasCanvasFocus()) return;
        const nudge = getDesktopCanvasNudge(event.key, event.shiftKey);
        if (!nudge) return;

        event.preventDefault();
        this.documentAuthoring.nudgeSelectedNodes(nudge.x, nudge.y);
    }

    private toggleDesktopGridSnap(): void {
        if (!this.runtimePreview.hasCanvasFocus()) return;
        this.desktopSnapEnabled = !this.desktopSnapEnabled;
        this.runtimePreview.setSnapEnabled(this.desktopSnapEnabled, this.canvasSettings.gridSize);
        this.saveResourceViewState();
        this.setDebugAttribute(
            "data-fairy-editor-canvas-snap",
            this.desktopSnapEnabled ? `${this.canvasSettings.gridSize}px` : "off",
        );
        this.setStatus(`Canvas snap ${this.desktopSnapEnabled ? `enabled at ${this.canvasSettings.gridSize}px` : "disabled"}.`);
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

    private async placeDesktopPrimitive(point: { x: number; y: number }): Promise<boolean> {
        const kind = this.desktopObjectTool;
        if (!kind) return false;
        this.desktopObjectTool = null;
        this.runtimePreview.setCreationMode(false);
        const applied = await this.displayListAuthoring.placeDesktopPrimitive(kind, point);
        if (!applied) return false;
        this.setDesktopObjectTool(null);
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
            case "cut": this.displayListAuthoring.cutSelectedDisplayNodes(); return;
            case "copy": this.displayListAuthoring.copySelectedDisplayNodes(); return;
            case "paste": void this.displayListAuthoring.pasteDisplayNodes(); return;
            case "duplicate": void this.displayListAuthoring.duplicateSelectedDisplayNodes(); return;
            case "delete": void this.displayListAuthoring.deleteSelectedDisplayNodes(); return;
            case "replace": this.displayListAuthoring.showReplaceObjectDialog(); return;
            case "selectAll": this.displayListAuthoring.selectAllDisplayNodes(); return;
            case "selectNone": this.displayListAuthoring.selectNoDisplayNodes(); return;
            case "moveForward": void this.displayListAuthoring.adjustSelectedDisplayNodeDepth("forward"); return;
            case "moveBackward": void this.displayListAuthoring.adjustSelectedDisplayNodeDepth("backward"); return;
            case "moveTop": void this.displayListAuthoring.adjustSelectedDisplayNodeDepth("top"); return;
            case "moveBottom": void this.displayListAuthoring.adjustSelectedDisplayNodeDepth("bottom"); return;
            case "openGroup": this.openSelectedGroup(); return;
            case "closeGroup": this.closeSelectedGroup(); return;
            case "showInLibrary": this.showSelectedDisplayNodeInLibrary(); return;
            case "timelineAdd": this.controllerTimeline.showAddTimelineItemEditor(); return;
            case "timelineDuplicate": void this.controllerTimeline.duplicateSelectedTimelineItem(); return;
            case "timelineEdit": this.controllerTimeline.showSelectedTimelineItemEditor(); return;
            case "timelineRemove": void this.controllerTimeline.removeSelectedTimelineItem(); return;
            case "workspace": this.showEditorWorkspace(); this.setTransientStatus("Editor workspace opened."); return;
            case "startScene": this.showStartScene(); return;
            case "toggleHierarchy": this.projectExplorer.toggleHierarchyExpansion(); return;
            case "search": this.projectExplorer.showProjectSearch(); return;
            case "showLibrary": this.projectExplorer.showLibraryPanel(); return;
            case "showFavorites": this.projectExplorer.showFavoritesPanel(); return;
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
            this.createLocalProject();
            return;
        }

        if (link === "open" || link === "open_folder") {
            void this.openLocalProject();
            return;
        }

        if (link === "import_project") {
            this.runEditorAction("workspace:importProject");
            return;
        }

        this.setTransientStatus(`Start scene link ignored: ${link}.`);
    }

    private onStartSceneRecentWorkspaceClick(itemObject: fgui.GObject): void {
        const entry = itemObject.data as BrowserWorkspaceRegistryEntry | null;
        if (!entry) return;
        void this.workspaceLifecycle.switch(entry).then((opened) => {
            if (opened && !this.disposed) this.showEditorWorkspace();
        });
    }

    private showFileMenu(anchor: fgui.GObject): void {
        const menu = this.createActionMenu();

        this.addMenuItem(menu, "localProjectNewMenu", "创建新项目…", () => this.createLocalProject());
        this.addMenuItem(menu, "localProjectOpenMenu", "打开项目文件夹…", () => { void this.openLocalProject(); });
        menu.addSeperator();

        if (this.chrome.hasAction("workspace:importProject")) {
            this.addMenuItem(menu, "workspaceMenuImportProject", "导入项目...", () => {
                this.runEditorAction("workspace:importProject");
            });
            this.addMenuItem(menu, "workspaceMenuImportFolder", "从文件夹导入...", () => {
                this.runEditorAction("workspace:importProjectDirectory");
            });
            menu.addSeperator();
        }
        this.addMenuItem(menu, "browserWorkspaceNewMenu", "新建浏览器工作区…", () => {
            void this.createBrowserWorkspace();
        });
        this.addMenuItem(menu, "workspaceMenuWorkspace", "浏览器工作区...", () => {
            this.showBrowserWorkspaceSelector();
        });
        this.addMenuItem(menu, "browserWorkspaceReauthorizeFolderMenu", "重新授权绑定文件夹...", () => {
            void this.workspaceLifecycle.reauthorizeFolder();
        });
        this.addMenuItem(menu, "browserWorkspaceCheckExternalMenu", "检查文件夹外部变化", () => {
            void this.workspaceLifecycle.checkExternalChanges();
        });
        this.addMenuItem(menu, "browserWorkspaceCloseMenu", "关闭当前工作区", () => {
            void this.workspaceLifecycle.close().then((closed) => {
                if (closed && !this.disposed) this.showStartScene();
            });
        });
        this.addMenuItem(menu, "workspaceMenuStartScene", "开始页...", () => {
            this.showStartScene();
        });
        this.addMenuItem(menu, "workspaceMenuSave", "保存", () => {
            this.runEditorAction("save");
        }, this.editorPreferences.shortcuts.save);
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

    private showToolsMenu(anchor: fgui.GObject): void {
        const menu = this.createActionMenu();
        this.addMenuItem(menu, "desktopMenuPreferences", "偏好设置…", () => {
            this.showPreferencesDialog();
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
                download: downloadBrowserFile,
                runWorkspaceTextFileTask: async () => undefined,
                setStatus: (message) => this.setStatus(message),
                eventOwner: this,
            });
        });
        this.addMenuItem(menu, "desktopMenuWorkspace", "浏览器工作区...", () => {
            this.showBrowserWorkspaceSelector();
        });
        const moduleContributions = [
            ...this.chrome.getToolMenuContributions(),
            ...this.chrome.getToolMenuProviders().flatMap((provider) => provider()),
        ];
        for (const contribution of moduleContributions) {
            const item = this.addMenuItem(menu, contribution.itemName, contribution.title, () => {
                void Promise.resolve(contribution.run()).catch((error) => {
                    this.setStatus(
                        `工具模块 ${contribution.id} 执行失败：${error instanceof Error ? error.message : String(error)}`,
                    );
                });
            });
            setEditorFormActionEnabled(item, contribution.isEnabled?.() ?? true);
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
        check("docScaleOption").selected = this.documentAuthoring.usePerDocumentView;
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
            this.documentAuthoring.usePerDocumentView = check("docScaleOption").selected;
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

    private showHelpMenu(anchor: fgui.GObject): void {
        const menu = this.createActionMenu();
        this.addMenuItem(menu, "desktopMenuUserGuide", "使用指南", () => {
            this.showHelpTextDialog("userGuideDialog", "使用指南", [
                "1. 从开始页选择本地项目文件夹，并允许浏览器读写；保存会写回授权目录。",
                "2. 单击资源会选中并显示属性；双击组件或资源会打开对应编辑器/预览器。",
                "3. 资源库空白或资源上右击可创建、导入、重命名、移动、删除、导出及查看导入历史。",
                "4. 保存会写入浏览器工作区；绑定可写 Folder 时会先检查外部冲突再写回。",
                "5. 发布从已保存的工作区生成运行时 ZIP；可在偏好设置中启用发布前自动保存。",
                "6. Undo/Redo、画布编辑、时间轴和属性编辑共用同一事务历史。",
            ]);
        });
        this.addMenuItem(menu, "desktopMenuShortcutGuide", "快捷键说明", () => {
            this.showHelpTextDialog(
                "shortcutGuideDialog",
                "快捷键说明",
                EDITOR_SHORTCUTS.map((entry) => `${entry.label}：${this.editorPreferences.shortcuts[entry.id] || "未分配"}`),
            );
        });
        menu.addSeperator();
        this.addMenuItem(menu, "desktopMenuAbout", "关于 FairyGUI 编辑器", () => {
            this.showAboutDialog();
        });
        this.showActionMenu(menu, anchor, "help", "已打开帮助菜单。");
    }

    private showHelpTextDialog(name: string, title: string, lines: string[]): void {
        this.authoringJsonDialog?.dispose();
        const dialog = new fgui.Window();
        dialog.modal = true;
        dialog.name = name;
        const content = fgui.UIPackage.createObject("Builder", "AboutDialog").asCom;
        dialog.contentPane = content;
        content.getChild("frame").asLabel.title = title;
        content.getChild("n4").visible = false;
        content.getChild("n17").visible = false;
        content.getChild("n15").visible = false;
        content.getChild("license").visible = false;
        const message = content.getChild("msg").asRichTextField;
        message.setXY(20, 38);
        message.setSize(454, 252);
        message.align = "left";
        message.fontSize = lines.length > 14 ? 10 : 12;
        const columnLength = Math.ceil(lines.length / 2);
        message.text = lines.length > 14
            ? lines.slice(0, columnLength).map((line, index) => `${line.padEnd(31)}${lines[index + columnLength] || ""}`).join("\n")
            : lines.join("\n");
        const close = content.getChild("n14").asButton;
        close.title = "关闭";
        close.visible = true;
        close.touchable = true;
        close.setXY(content.width - close.width - 12, content.height - close.height - 12);
        content.setChildIndex(close, content.numChildren - 1);
        close.onClick(this, () => dialog.dispose());
        dialog.on(Laya.Event.UNDISPLAY, this, () => {
            if (this.authoringJsonDialog === dialog) this.authoringJsonDialog = null;
        });
        this.authoringJsonDialog = dialog;
        dialog.show();
        dialog.centerOn(fgui.GRoot.inst, true);
        this.setDebugAttribute("data-fairy-editor-help-dialog", name);
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
        this.setDebugAttribute("data-fairy-editor-view", "start");
        this.layout();
        this.setTransientStatus("Start scene opened.");
    }

    private populateStartSceneRecentWorkspaces(): void {
        const list = this.startScene.getChild("recentList").asList;
        list.removeChildrenToPool();
        const entries = [...this.workspaceLifecycle.registry.entries]
            .filter((entry) => entry.source || entry.id !== DEFAULT_BROWSER_WORKSPACE_ID)
            .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
        for (const entry of entries) {
            const item = list.addItemFromPool().asButton;
            item.data = entry;
            const title = item.getChild("title").asRichTextField;
            title.ubbEnabled = false;
            title.text = entry.name;
            item.getChild("path").asTextField.text = entry.sourceName
                ? `${entry.sourceName}/${entry.fairyPath}`
                : `${entry.fairyPath} · ${new Date(entry.lastOpenedAt).toLocaleString("zh-CN")}`;
            item.getChild("delete").visible = false;
            item.tooltips = entry.source === "directory" ? `授权并打开 ${entry.name}` : `打开 ${entry.name}`;
        }
        this.setDebugAttribute("data-fairy-editor-recent-projects", String(entries.length));
    }

    private showEditorWorkspace(): void {
        this.mainView.getController("start").selectedIndex = 0;
        this.startScene.visible = false;
        this.setDebugAttribute("data-fairy-editor-view", "workspace");
        this.layout();
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
        this.resetRuntimePreviewPackages();
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
            this.resetRuntimePreviewPackages();
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
        this.projectExplorer.handleLibraryItemClick(data, list);
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

    private applyLibrarySelection(data: LibraryItemData | null, preserveResourceSelection = false): void {
        if (!data) return;
        this.libraryController.prepareSelection(data, preserveResourceSelection);

        if (data.kind === "package") {
            this.libraryPackageId = data.packageId;
            this.clearResourceSelection();
            const selectedPackage = this.projectSnapshot?.packages.find((pkg) => pkg.id === data.packageId) || null;
            this.projectExplorer.populateLibrary();
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

        this.documentAuthoring.setActiveSelection(
            this.selectedPackageId,
            data.componentId,
            [data.nodeId],
            data.nodeId,
        );
        this.clearResourceSelection();
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
        this.chrome.setDebugAttribute(name, value);
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
        this.projectExplorer.populateLibrary();
        this.layout();
        this.setDebugAttribute(
            "data-fairy-editor-library-resource-selection",
            `${selector.packageId}/${selector.resourceId}`,
        );
        this.setDebugAttribute("data-fairy-editor-show-in-library", getProjectResourceUrl(selector));
        this.setStatus(`Shown in Library: ${getProjectResourceUrl(selector)}.`);
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

    private showBrowserWorkspaceSelector(): void {
        openBrowserWorkspaceDialog({
            entries: this.workspaceLifecycle.registry.entries,
            activeId: this.workspaceLifecycle.registry.activeId,
            select: (entry) => void this.workspaceLifecycle.switch(entry).then((opened) => {
                if (opened && !this.disposed) this.showEditorWorkspace();
            }),
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
        await this.workspaceLifecycle.create(name);
    }

    private canOpenLocalProject(): boolean {
        if (this.commandAdapter.getSessionState().dirty) {
            this.setStatus("请先保存或撤销当前项目的修改，再创建或打开项目。");
            return false;
        }
        if (!supportsLocalDirectories()) {
            this.setStatus("本地目录读写需要 HTTPS 或 localhost 下的 Chrome / Edge，请在支持 File System Access API 的浏览器中打开。");
            return false;
        }
        return true;
    }

    private localProjectOpening = false;

    private async openPickedLocalProject(picked: BrowserProjectImportResult): Promise<boolean> {
        const opened = await this.workspaceLifecycle.openProject(picked);
        if (opened && !this.disposed) this.showEditorWorkspace();
        return opened;
    }

    private async openLocalProject(): Promise<void> {
        if (this.localProjectOpening || !this.canOpenLocalProject()) return;
        this.localProjectOpening = true;
        this.setDebugAttribute("data-fairy-editor-directory-picker", "waiting");
        this.setStatus("等待选择项目目录，请在浏览器提示中允许读写。");
        try {
            const picked = await new BrowserProjectImport().pickDirectoryProject((progress) => {
                if (this.disposed) return;
                this.setDebugAttribute("data-fairy-editor-directory-picker", "reading");
                this.setStatus(`已选择 ${progress.sourceName}，正在读取工程：${progress.fileCount} 个文件，${(progress.totalBytes / 1024 / 1024).toFixed(1)} MB…`);
            });
            if (!this.disposed) {
                this.setDebugAttribute("data-fairy-editor-directory-picker", "opening");
                this.setStatus(`正在打开 ${picked.imported.fairyPath}，共 ${picked.imported.fileCount} 个文件…`);
                const opened = await this.openPickedLocalProject(picked);
                this.setDebugAttribute("data-fairy-editor-directory-picker", opened ? "opened" : "failed");
            }
        } catch (error) {
            console.warn("[Workspace] Local directory selection failed", error);
            if (isFilePickerCancelled(error)) {
                this.setDebugAttribute("data-fairy-editor-directory-picker", "cancelled-or-denied");
                this.setStatus("目录选择已取消或未获浏览器授权（AbortError），尚未读取工程。请重新选择目录并完成访问/编辑授权。", "warning");
            } else {
                this.setDebugAttribute("data-fairy-editor-directory-picker", "failed");
                this.setStatus(`项目打开失败：${error instanceof Error ? error.message : String(error)}`, "error");
            }
        } finally {
            this.localProjectOpening = false;
        }
    }

    private createLocalProject(): void {
        if (!this.canOpenLocalProject()) return;
        this.authoringJsonDialog?.dispose();
        this.authoringJsonDialog = showCreateLocalProjectDialog({
            canCreate: () => this.canOpenLocalProject(),
            openProject: (picked) => this.openPickedLocalProject(picked),
            setStatus: (message) => this.setStatus(message),
            setActiveDialog: (dialog) => { this.authoringJsonDialog = dialog; },
        });
    }

    private resetRuntimePreviewPackages(): void {
        this.documentAuthoring.resetRuntimePackages();
    }

    private renderProjectSnapshot(
        snapshot: EditorProjectSnapshot,
        previous: EditorProjectSnapshot | null,
    ): void {
        if (this.disposed) return;
        if (previous?.project.id !== snapshot.project.id) {
            this.documentAuthoring.reset();
        }
        this.clearResourceSelection();
        const preferredPackage = snapshot.packages.find((pkg) => pkg.name === "Builder") || snapshot.packages[0] || null;
        const preferredComponent = preferredPackage
            ? preferredPackage.components.find((component) => component.name === "MainView")
                || preferredPackage.components[0]
                || null
            : null;

        if (!this.documentAuthoring.restore(snapshot)) {
            this.documentAuthoring.setActiveSelection(
                preferredPackage?.id || "",
                preferredComponent?.id || "",
                [],
                "",
                snapshot,
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
        this.projectSession.syncSnapshot(snapshot, operations, false);
        return this.renderLiveProjectSnapshot(snapshot, operations, invalidation, preferredSelection);
    }

    private renderLiveProjectSnapshot(
        snapshot: EditorProjectSnapshot,
        operations: EditorCommandOperation[] = [],
        invalidation: ProjectionInvalidation = "preserve-runtime-preview",
        preferredSelection: ActiveDocumentSelection | null = null,
    ): AuthoringPreviewProjectionPlan | null {
        if (this.disposed) return null;
        const previousPackageId = this.selectedPackageId;
        const previousComponentId = this.selectedComponentId;
        if (preferredSelection) {
            this.documentAuthoring.setActiveSelection(
                preferredSelection.packageId,
                preferredSelection.componentId,
                preferredSelection.nodeIds,
                preferredSelection.primaryNodeId,
                snapshot,
            );
            this.clearResourceSelection();
        } else {
            const selectedPackage = snapshot.packages.find((pkg) => pkg.id === this.selectedPackageId)
                || snapshot.packages[0]
                || null;
            const selectedComponent = selectedPackage?.components.find(
                (component) => component.id === this.selectedComponentId,
            ) || selectedPackage?.components[0] || null;
            this.documentAuthoring.setActiveSelection(
                selectedPackage?.id || "",
                selectedComponent?.id || "",
                this.selectedDisplayNodeIds,
                this.selectedDisplayNodeId,
                snapshot,
            );
        }
        this.libraryController.reconcileInspectorSelection(snapshot);
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

    private getSelectedPackage(): ProjectSnapshotPackage | null {
        return this.documentAuthoring.getSelectedPackage();
    }

    private getSelectedComponent(): ProjectSnapshotComponent | null {
        return this.documentAuthoring.getSelectedComponent();
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

}
