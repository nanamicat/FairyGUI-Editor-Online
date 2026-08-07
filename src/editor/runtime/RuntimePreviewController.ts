import type { ProjectSnapshotComponent, ProjectSnapshotDisplayNode } from "../model/ProjectSnapshot";
import {
    AuthoringRuntimePackageLoader,
    type AuthoringRuntimePackageLoadResult,
} from "./AuthoringRuntimePackageLoader";
import {
    getDesktopCanvasBounds,
    getDesktopCanvasMarqueeSelection,
    hasDesktopCanvasDragMoved,
    resolveDesktopCanvasDragPosition,
    resolveDesktopCanvasGraphPoint,
    resolveDesktopCanvasRegularPolygonDistance,
    resolveDesktopCanvasGroupRotation,
    resolveDesktopCanvasGroupResize,
    resolveDesktopCanvasPivot,
    resolveDesktopCanvasRect,
    resolveDesktopCanvasResize,
    resolveDesktopCanvasRotation,
    snapDesktopCanvasValue,
    type DesktopCanvasPoint,
} from "./DesktopCanvasInteraction";
import type { EditorCommandOperation, GraphEditableProperties } from "../model/EditorCommand";
import {
    planAuthoringPreviewProjection,
    type AuthoringPreviewProjectionPlan,
} from "./AuthoringPreviewProjection";

export type RuntimePreviewSelectionHandler = (
    nodeIds: string[],
    primaryNodeId: string,
) => void;
export type RuntimePreviewPackageLoadHandler = (result: AuthoringRuntimePackageLoadResult) => void;
export interface RuntimePreviewNodePosition {
    nodeId: string;
    x: number;
    y: number;
}
export interface RuntimePreviewNodeTransform extends RuntimePreviewNodePosition {
    width: number;
    height: number;
}
export interface RuntimePreviewNodeRotation extends RuntimePreviewNodePosition {
    rotation: number;
}
export interface RuntimePreviewNodePivot extends RuntimePreviewNodePosition {
    pivotX: number;
    pivotY: number;
}
export interface RuntimePreviewGraphPoints {
    nodeId: string;
    points: number[] | null;
    distances: number[] | null;
}
export type RuntimePreviewNodeMoveHandler = (
    positions: RuntimePreviewNodePosition[],
) => Promise<boolean>;
export type RuntimePreviewNodeResizeHandler = (
    transforms: RuntimePreviewNodeTransform[],
) => Promise<boolean>;
export type RuntimePreviewNodeRotateHandler = (
    transforms: RuntimePreviewNodeRotation[],
) => Promise<boolean>;
export type RuntimePreviewNodePivotHandler = (
    transform: RuntimePreviewNodePivot,
) => Promise<boolean>;
export type RuntimePreviewGraphPointsHandler = (
    transform: RuntimePreviewGraphPoints,
) => Promise<boolean>;
export type RuntimePreviewViewChangeHandler = (
    zoom: number,
    panX: number,
    panY: number,
) => void;
export type RuntimePreviewCreateNodeHandler = (point: DesktopCanvasPoint) => Promise<boolean>;
export type RuntimePreviewOpenNodeHandler = (nodeId: string) => void;
export type RuntimePreviewContextMenuHandler = () => void;

interface RuntimePreviewBinding {
    object: fgui.GObject;
}

interface RuntimePreviewDragItem {
    nodeId: string;
    object: fgui.GObject;
    startObjectPosition: DesktopCanvasPoint;
    startProjectPosition: DesktopCanvasPoint;
    targetPosition: DesktopCanvasPoint;
}

interface RuntimePreviewDragState {
    touchId: number;
    startStagePointer: DesktopCanvasPoint;
    startLocalPointer: DesktopCanvasPoint;
    items: RuntimePreviewDragItem[];
    moved: boolean;
}

interface RuntimePreviewMarqueeState {
    touchId: number;
    startStagePointer: DesktopCanvasPoint;
    currentStagePointer: DesktopCanvasPoint;
    additive: boolean;
    moved: boolean;
}

interface RuntimePreviewResizeItem extends RuntimePreviewNodeTransform {
    object: fgui.GObject;
    startObjectPosition: DesktopCanvasPoint;
    startObjectSize: { width: number; height: number };
}

interface RuntimePreviewResizeState {
    touchId: number;
    startStagePointer: DesktopCanvasPoint;
    startLocalPointer: DesktopCanvasPoint;
    startBounds: { x: number; y: number; width: number; height: number };
    items: RuntimePreviewResizeItem[];
    targets: RuntimePreviewNodeTransform[];
    moved: boolean;
}

interface RuntimePreviewRotateItem {
    nodeId: string;
    object: fgui.GObject;
    startObjectPosition: DesktopCanvasPoint;
    startObjectRotation: number;
}

interface RuntimePreviewRotateState {
    touchId: number;
    centerStage: DesktopCanvasPoint;
    centerProject: DesktopCanvasPoint;
    startStagePointer: DesktopCanvasPoint;
    items: RuntimePreviewRotateItem[];
    targets: RuntimePreviewNodeRotation[];
    moved: boolean;
}

interface RuntimePreviewPivotState {
    touchId: number;
    startStagePointer: DesktopCanvasPoint;
    nodeId: string;
    object: fgui.GObject;
    startPosition: DesktopCanvasPoint;
    startPivot: DesktopCanvasPoint;
    size: { width: number; height: number };
    scale: DesktopCanvasPoint;
    rotation: number;
    pivotAsAnchor: boolean;
    target: RuntimePreviewNodePivot;
    moved: boolean;
}

interface RuntimePreviewPanState {
    touchId: number;
    startStagePointer: DesktopCanvasPoint;
    startPan: DesktopCanvasPoint;
}

interface RuntimePreviewGraphPointState {
    touchId: number;
    startStagePointer: DesktopCanvasPoint;
    nodeId: string;
    object: fgui.GGraph;
    pointIndex: number;
    properties: GraphEditableProperties;
    startPoints: number[];
    targetPoints: number[];
    startDistances: number[] | null;
    targetDistances: number[] | null;
    moved: boolean;
}

const PREVIEW_ROOT_NAME = "runtimePreviewRoot";
const CANVAS_BACKGROUND_NAME = "runtimePreviewBackground";
const COMPONENT_CANVAS_BACKGROUND_NAME = "runtimePreviewComponentCanvas";
const SELECTION_FRAME_NAME = "runtimePreviewSelection";
const MARQUEE_FRAME_NAME = "runtimePreviewMarquee";
const RESIZE_HANDLE_NAME = "runtimePreviewResizeHandle";
const ROTATE_HANDLE_NAME = "runtimePreviewRotateHandle";
const PIVOT_HANDLE_NAME = "runtimePreviewPivotHandle";
const GRAPH_POINT_HANDLE_NAME = "runtimePreviewGraphPointHandle";
const DOUBLE_CLICK_INTERVAL_MS = 600;
const PREVIEW_PADDING = 24;
const WORKSPACE_BACKGROUND_COLOR: string = "#666666";
const WORKSPACE_CANVAS_COLOR: string = "#999999";

export interface RuntimePreviewCanvasSettings {
    backgroundColor: string;
    canvasColor: string;
    componentEdge: boolean;
    alignmentGuides: boolean;
    showGrid: boolean;
    gridSize: number;
    gridBrightness: number;
}

export class RuntimePreviewController {
    private readonly owner: fgui.GComponent;
    private readonly viewport: fgui.GObject;
    private readonly placeholder: fgui.GObject | null;
    private readonly canvasBackground: fgui.GGraph;
    private readonly componentCanvasBackground: fgui.GGraph;
    private readonly selectionFrame: fgui.GGraph;
    private readonly marqueeFrame: fgui.GGraph;
    private readonly resizeHandle: fgui.GGraph;
    private readonly rotateHandle: fgui.GGraph;
    private readonly pivotHandle: fgui.GGraph;
    private readonly snapVerticalGuide: fgui.GGraph;
    private readonly snapHorizontalGuide: fgui.GGraph;
    private readonly onSelectNode: RuntimePreviewSelectionHandler;
    private readonly onRuntimePackageLoad?: RuntimePreviewPackageLoadHandler;
    private readonly onMoveNode?: RuntimePreviewNodeMoveHandler;
    private readonly onResizeNode?: RuntimePreviewNodeResizeHandler;
    private readonly onRotateNode?: RuntimePreviewNodeRotateHandler;
    private readonly onPivotNode?: RuntimePreviewNodePivotHandler;
    private readonly onGraphPoints?: RuntimePreviewGraphPointsHandler;
    private readonly onViewChange?: RuntimePreviewViewChangeHandler;
    private readonly onCreateNode?: RuntimePreviewCreateNodeHandler;
    private readonly onOpenNode?: RuntimePreviewOpenNodeHandler;
    private readonly onContextMenu?: RuntimePreviewContextMenuHandler;
    private readonly runtimePackageLoader: AuthoringRuntimePackageLoader;
    private readonly graphPointHandles: fgui.GGraph[] = [];
    private previewRoot: fgui.GComponent | null = null;
    private previewPackageName = "";
    private previewComponentId = "";
    private previewSourceRevision = "";
    private projectedComponent: ProjectSnapshotComponent | null = null;
    private selectedNodeId = "";
    private selectedNodeIds = new Set<string>();
    private bindings: RuntimePreviewBinding[] = [];
    private readonly previewObjects = new Map<string, fgui.GObject>();
    private readonly authoringProxyIds = new Set<string>();
    private editorHiddenNodeIds = new Set<string>();
    private showAllInvisibleNodes = false;
    private publishedRuntimeNodeOrder: string[] = [];
    private runtimePublishRequired = false;
    private dragState: RuntimePreviewDragState | null = null;
    private marqueeState: RuntimePreviewMarqueeState | null = null;
    private resizeState: RuntimePreviewResizeState | null = null;
    private rotateState: RuntimePreviewRotateState | null = null;
    private pivotState: RuntimePreviewPivotState | null = null;
    private graphPointState: RuntimePreviewGraphPointState | null = null;
    private graphPointEditing = false;
    private graphShapeLocked = false;
    private panState: RuntimePreviewPanState | null = null;
    private snapEnabled = false;
    private snapStep = 8;
    private canvasSettings: RuntimePreviewCanvasSettings = {
        backgroundColor: WORKSPACE_BACKGROUND_COLOR,
        canvasColor: WORKSPACE_CANVAS_COLOR,
        componentEdge: true,
        alignmentGuides: true,
        showGrid: false,
        gridSize: 8,
        gridBrightness: 30,
    };
    private panShortcutActive = false;
    private zoom = 1;
    private panX = 0;
    private panY = 0;
    private canvasFocused = false;
    private creationMode = false;
    private lastClickNodeId = "";
    private lastClickAt = 0;
    private refreshRevision = 0;
    private disposed = false;

    constructor(
        owner: fgui.GComponent,
        viewport: fgui.GObject,
        onSelectNode: RuntimePreviewSelectionHandler,
        placeholder: fgui.GObject | null = null,
        onRuntimePackageLoad?: RuntimePreviewPackageLoadHandler,
        runtimePackageLoader: AuthoringRuntimePackageLoader = new AuthoringRuntimePackageLoader(),
        onMoveNode?: RuntimePreviewNodeMoveHandler,
        onResizeNode?: RuntimePreviewNodeResizeHandler,
        onRotateNode?: RuntimePreviewNodeRotateHandler,
        onPivotNode?: RuntimePreviewNodePivotHandler,
        onGraphPoints?: RuntimePreviewGraphPointsHandler,
        onViewChange?: RuntimePreviewViewChangeHandler,
        onCreateNode?: RuntimePreviewCreateNodeHandler,
        onOpenNode?: RuntimePreviewOpenNodeHandler,
        onContextMenu?: RuntimePreviewContextMenuHandler,
    ) {
        this.owner = owner;
        this.viewport = viewport;
        this.placeholder = placeholder;
        this.onSelectNode = onSelectNode;
        this.onRuntimePackageLoad = onRuntimePackageLoad;
        this.onMoveNode = onMoveNode;
        this.onResizeNode = onResizeNode;
        this.onRotateNode = onRotateNode;
        this.onPivotNode = onPivotNode;
        this.onGraphPoints = onGraphPoints;
        this.onViewChange = onViewChange;
        this.onCreateNode = onCreateNode;
        this.onOpenNode = onOpenNode;
        this.onContextMenu = onContextMenu;
        this.runtimePackageLoader = runtimePackageLoader;

        this.canvasBackground = new fgui.GGraph();
        this.canvasBackground.name = CANVAS_BACKGROUND_NAME;
        this.canvasBackground.touchable = false;
        this.owner.addChild(this.canvasBackground);

        this.componentCanvasBackground = new fgui.GGraph();
        this.componentCanvasBackground.name = COMPONENT_CANVAS_BACKGROUND_NAME;
        this.componentCanvasBackground.touchable = false;
        this.componentCanvasBackground.visible = false;
        this.owner.addChild(this.componentCanvasBackground);

        this.selectionFrame = new fgui.GGraph();
        this.selectionFrame.name = SELECTION_FRAME_NAME;
        this.selectionFrame.touchable = false;
        this.selectionFrame.visible = false;
        this.selectionFrame.drawRect(1, "#6db8ff", "rgba(0,0,0,0)");
        this.owner.addChild(this.selectionFrame);

        this.marqueeFrame = new fgui.GGraph();
        this.marqueeFrame.name = MARQUEE_FRAME_NAME;
        this.marqueeFrame.touchable = false;
        this.marqueeFrame.visible = false;
        this.marqueeFrame.drawRect(1, "#8ac6ff", "rgba(109,184,255,0.12)");
        this.owner.addChild(this.marqueeFrame);

        this.resizeHandle = new fgui.GGraph();
        this.resizeHandle.name = RESIZE_HANDLE_NAME;
        this.resizeHandle.touchable = true;
        this.resizeHandle.visible = false;
        this.resizeHandle.setSize(10, 10);
        this.resizeHandle.drawRect(1, "#d8efff", "#3f9ee8");
        this.resizeHandle.on(Laya.Event.MOUSE_DOWN, this, this.onResizeHandleMouseDown);
        this.owner.addChild(this.resizeHandle);

        this.rotateHandle = new fgui.GGraph();
        this.rotateHandle.name = ROTATE_HANDLE_NAME;
        this.rotateHandle.touchable = true;
        this.rotateHandle.visible = false;
        this.rotateHandle.setSize(10, 10);
        this.rotateHandle.drawRect(1, "#d8efff", "#ef9f3f");
        this.rotateHandle.on(Laya.Event.MOUSE_DOWN, this, this.onRotateHandleMouseDown);
        this.owner.addChild(this.rotateHandle);

        this.pivotHandle = new fgui.GGraph();
        this.pivotHandle.name = PIVOT_HANDLE_NAME;
        this.pivotHandle.touchable = true;
        this.pivotHandle.visible = false;
        this.pivotHandle.setSize(10, 10);
        this.pivotHandle.drawRect(1, "#ffffff", "#d45cff");
        this.pivotHandle.on(Laya.Event.MOUSE_DOWN, this, this.onPivotHandleMouseDown);
        this.owner.addChild(this.pivotHandle);

        this.snapVerticalGuide = new fgui.GGraph();
        this.snapVerticalGuide.name = "runtimePreviewSnapVertical";
        this.snapVerticalGuide.touchable = false;
        this.snapVerticalGuide.visible = false;
        this.owner.addChild(this.snapVerticalGuide);

        this.snapHorizontalGuide = new fgui.GGraph();
        this.snapHorizontalGuide.name = "runtimePreviewSnapHorizontal";
        this.snapHorizontalGuide.touchable = false;
        this.snapHorizontalGuide.visible = false;
        this.owner.addChild(this.snapHorizontalGuide);
        Laya.stage.on(Laya.Event.MOUSE_DOWN, this, this.onStageMouseDown);
    }

    dispose(): void {
        this.disposed = true;
        this.refreshRevision += 1;
        this.clearPreview();
        this.runtimePackageLoader.reset();
        Laya.stage.off(Laya.Event.MOUSE_DOWN, this, this.onStageMouseDown);
        if (this.selectionFrame.parent) {
            this.owner.removeChild(this.selectionFrame, true);
        }
        if (this.marqueeFrame.parent) {
            this.owner.removeChild(this.marqueeFrame, true);
        }
        this.resizeHandle.off(Laya.Event.MOUSE_DOWN, this, this.onResizeHandleMouseDown);
        if (this.resizeHandle.parent) {
            this.owner.removeChild(this.resizeHandle, true);
        }
        this.rotateHandle.off(Laya.Event.MOUSE_DOWN, this, this.onRotateHandleMouseDown);
        if (this.rotateHandle.parent) {
            this.owner.removeChild(this.rotateHandle, true);
        }
        this.pivotHandle.off(Laya.Event.MOUSE_DOWN, this, this.onPivotHandleMouseDown);
        if (this.pivotHandle.parent) {
            this.owner.removeChild(this.pivotHandle, true);
        }
        for (const handle of this.graphPointHandles) {
            handle.off(Laya.Event.MOUSE_DOWN, this, this.onGraphPointHandleMouseDown);
            if (handle.parent) this.owner.removeChild(handle, true);
        }
        this.graphPointHandles.length = 0;
        if (this.snapVerticalGuide.parent) {
            this.owner.removeChild(this.snapVerticalGuide, true);
        }
        if (this.snapHorizontalGuide.parent) {
            this.owner.removeChild(this.snapHorizontalGuide, true);
        }
        if (this.canvasBackground.parent) {
            this.owner.removeChild(this.canvasBackground, true);
        }
        if (this.componentCanvasBackground.parent) {
            this.owner.removeChild(this.componentCanvasBackground, true);
        }
    }

    refresh(
        projectId: string,
        packageName: string,
        component: ProjectSnapshotComponent | null,
        selectedNodeIds: string[],
    ): void {
        if (this.disposed) return;
        const refreshRevision = ++this.refreshRevision;
        this.selectNodes(selectedNodeIds);
        const sourceRevision = this.runtimePackageLoader.getSourceRevision();

        if (!packageName || !component) {
            this.clearPreview();
            return;
        }

        if (
            this.previewRoot
            && this.previewPackageName === packageName
            && this.previewComponentId === component.id
            && this.previewSourceRevision === sourceRevision
        ) {
            this.projectedComponent = component;
            this.synchronizeAuthoringObjects(component);
            this.layout();
            this.updateSelectionFrame();
            return;
        }

        this.clearPreview();
        void this.loadRuntimePackage(refreshRevision, projectId, packageName, component);
    }

    resetRuntimePackages(): void {
        if (this.disposed) return;
        this.refreshRevision += 1;
        this.clearPreview();
        this.runtimePackageLoader.reset();
    }

    async createLibraryComponentPreview(
        projectId: string,
        packageName: string,
        componentName: string,
    ): Promise<fgui.GObject | null> {
        if (this.disposed) return null;
        const result = await this.runtimePackageLoader.ensureLoaded(projectId, packageName);
        if (!result.ok || this.disposed) return null;
        try {
            return fgui.UIPackage.createObject(packageName, componentName);
        } catch {
            return null;
        }
    }

    private async loadRuntimePackage(
        refreshRevision: number,
        projectId: string,
        packageName: string,
        component: ProjectSnapshotComponent,
    ): Promise<void> {
        const result = await this.runtimePackageLoader.ensureLoaded(projectId, packageName);
        if (this.disposed || refreshRevision !== this.refreshRevision) return;

        this.onRuntimePackageLoad?.(result);
        if (!result.ok) {
            this.createPreview(packageName, component, result.sourceRevision, true);
            return;
        }

        this.createPreview(packageName, component, result.sourceRevision);
    }

    private createPreview(
        packageName: string,
        component: ProjectSnapshotComponent,
        sourceRevision: string,
        authoringOnly = false,
    ): void {
        const created = authoringOnly ? null : fgui.UIPackage.createObject(packageName, component.name);
        const root = created?.asCom || new fgui.GComponent();
        if (!created) root.setSize(Math.max(1, component.width), Math.max(1, component.height));
        this.publishedRuntimeNodeOrder = created
            ? Array.from({ length: root.numChildren }, (_, index) => root.getChildAt(index).id).filter(Boolean)
            : [];
        this.runtimePublishRequired = !created;
        root.name = PREVIEW_ROOT_NAME;
        root.touchable = true;
        this.previewRoot = root;
        this.previewPackageName = packageName;
        this.previewComponentId = component.id;
        this.previewSourceRevision = sourceRevision;
        this.projectedComponent = component;
        this.setPlaceholderVisible(false);
        this.owner.addChild(root);

        this.bindSelectableObjects(root);
        this.synchronizeAuthoringObjects(component);
        this.layout();
        this.updateSelectionFrame();
    }

    layout(): void {
        this.layoutBackground();

        const root = this.previewRoot;
        if (!root) return;

        const viewportWidth = Math.max(1, this.viewport.width);
        const viewportHeight = Math.max(1, this.viewport.height);
        const holderWidth = Math.max(1, viewportWidth - PREVIEW_PADDING * 2);
        const holderHeight = Math.max(1, viewportHeight - PREVIEW_PADDING * 2);
        const contentWidth = Math.max(1, root.width);
        const contentHeight = Math.max(1, root.height);
        const baseScale = Math.min(1, holderWidth / contentWidth, holderHeight / contentHeight);
        const scale = baseScale * this.zoom;
        const width = contentWidth * scale;
        const height = contentHeight * scale;
        const viewportX = this.viewport === this.owner ? 0 : this.viewport.x;
        const viewportY = this.viewport === this.owner ? 0 : this.viewport.y;
        const x = viewportX + Math.floor((viewportWidth - width) / 2) + this.panX;
        const y = viewportY + Math.floor((viewportHeight - height) / 2) + this.panY;

        this.layoutComponentCanvas(x, y, width, height);
        root.setScale(scale, scale);
        root.setXY(x, y);
        this.owner.setChildIndex(this.canvasBackground, 0);
        this.owner.setChildIndex(this.componentCanvasBackground, 1);
        this.owner.setChildIndex(this.selectionFrame, this.owner.numChildren - 1);
        this.owner.setChildIndex(this.marqueeFrame, this.owner.numChildren - 1);
        this.owner.setChildIndex(this.resizeHandle, this.owner.numChildren - 1);
        this.owner.setChildIndex(this.rotateHandle, this.owner.numChildren - 1);
        this.updateSelectionFrame();
    }

    selectNode(nodeId: string): void {
        this.selectNodes(nodeId ? [nodeId] : [], nodeId);
    }

    selectNodes(nodeIds: string[], primaryNodeId: string = ""): void {
        const previousPrimary = this.selectedNodeId;
        this.selectedNodeIds = new Set(nodeIds.filter(Boolean));
        this.selectedNodeId = primaryNodeId && this.selectedNodeIds.has(primaryNodeId)
            ? primaryNodeId
            : nodeIds.find((nodeId) => this.selectedNodeIds.has(nodeId)) || "";
        if (this.graphPointEditing && (this.selectedNodeIds.size !== 1 || this.selectedNodeId !== previousPrimary)) {
            this.graphPointEditing = false;
            this.graphShapeLocked = false;
        }
        this.updateSelectionFrame();
    }

    setGraphPointEditing(enabled: boolean, shapeLocked = false): void {
        this.cancelCanvasInteraction(true);
        this.graphPointEditing = enabled;
        this.graphShapeLocked = enabled && shapeLocked;
        this.updateSelectionFrame();
    }

    isGraphPointEditing(): boolean {
        return this.graphPointEditing;
    }

    isGraphShapeLocked(): boolean {
        return this.graphShapeLocked;
    }

    cancelGraphPointEditing(): boolean {
        if (!this.graphPointEditing) return false;
        this.setGraphPointEditing(false);
        return true;
    }

    setEditorHiddenNodeIds(nodeIds: Iterable<string>): void {
        this.editorHiddenNodeIds = new Set(nodeIds);
        if (this.projectedComponent) this.synchronizeAuthoringObjects(this.projectedComponent);
    }

    setShowAllInvisibleNodes(enabled: boolean): void {
        this.showAllInvisibleNodes = enabled;
        if (this.projectedComponent) this.synchronizeAuthoringObjects(this.projectedComponent);
    }

    hasCanvasFocus(): boolean {
        return !!this.previewRoot && this.canvasFocused;
    }

    requiresRuntimePublish(): boolean {
        return this.runtimePublishRequired;
    }

    resolveAuthoringDropPoint(stageX: number, stageY: number): DesktopCanvasPoint | null {
        const root = this.previewRoot;
        if (!root) return null;
        const point = root.globalToLocal(stageX, stageY);
        if (point.x < 0 || point.y < 0 || point.x > root.width || point.y > root.height) return null;
        return {
            x: this.snapEnabled ? snapDesktopCanvasValue(point.x, this.snapStep) : Math.round(point.x),
            y: this.snapEnabled ? snapDesktopCanvasValue(point.y, this.snapStep) : Math.round(point.y),
        };
    }

    setSnapEnabled(enabled: boolean, step = this.snapStep): void {
        this.snapEnabled = enabled;
        this.snapStep = Math.max(1, Math.trunc(step));
        if (!enabled) this.hideSnapGuides();
    }

    setCanvasSettings(settings: RuntimePreviewCanvasSettings): void {
        this.canvasSettings = {
            ...settings,
            gridSize: Math.max(1, Math.trunc(settings.gridSize)),
            gridBrightness: Math.max(0, Math.min(100, Math.trunc(settings.gridBrightness))),
        };
        this.snapStep = this.canvasSettings.gridSize;
        this.layout();
    }

    setPanShortcutActive(active: boolean): void {
        this.panShortcutActive = active;
    }

    setCreationMode(active: boolean): void {
        this.creationMode = active;
    }

    adjustZoom(factor: number): number {
        this.zoom = Math.min(4, Math.max(0.25, Math.round(this.zoom * factor * 100) / 100));
        this.layout();
        this.emitViewChange();
        return this.zoom;
    }

    resetView(): void {
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.layout();
        this.emitViewChange();
    }

    setViewState(zoom: number, panX: number, panY: number): void {
        this.zoom = Math.min(4, Math.max(0.25, Number.isFinite(zoom) ? zoom : 1));
        this.panX = Number.isFinite(panX) ? Math.round(panX) : 0;
        this.panY = Number.isFinite(panY) ? Math.round(panY) : 0;
        this.layout();
        this.emitViewChange();
    }

    getViewState(): { zoom: number; panX: number; panY: number } {
        return { zoom: this.zoom, panX: this.panX, panY: this.panY };
    }

    cancelActiveInteraction(): boolean {
        if (
            !this.dragState
            && !this.marqueeState
            && !this.resizeState
            && !this.rotateState
            && !this.pivotState
            && !this.graphPointState
            && !this.panState
        ) return false;
        this.cancelCanvasInteraction(true);
        this.updateSelectionFrame();
        return true;
    }

    playFirstTransition(): { ok: boolean; transitionName?: string } {
        const transition = this.previewRoot?.getTransitionAt(0);
        if (!transition) return { ok: false };

        transition.play();
        return { ok: true, transitionName: transition.name || "first transition" };
    }

    playTransition(name: string): { ok: boolean; transitionName?: string } {
        const transition = name ? this.previewRoot?.getTransition(name) : null;
        if (!transition) return { ok: false };

        transition.play();
        return { ok: true, transitionName: transition.name || name };
    }

    applyDisplayNodeState(state: ProjectSnapshotDisplayNode): void {
        const object = this.findPreviewObjectById(state.id);
        if (!object) return;

        this.applyObjectState(object, state);
        this.updateSelectionFrame();
    }

    projectAuthoringSnapshot(
        packageId: string,
        component: ProjectSnapshotComponent,
        operations: EditorCommandOperation[],
    ): AuthoringPreviewProjectionPlan {
        const plan = planAuthoringPreviewProjection(
            operations,
            packageId,
            component,
        );
        if (plan.runtimeStatus === "publish-required") this.runtimePublishRequired = true;
        if (plan.status !== "applied") {
            return this.runtimePublishRequired && plan.runtimeStatus !== "publish-required"
                ? { ...plan, runtimeStatus: "publish-required" }
                : plan;
        }

        this.projectedComponent = component;
        this.previewRoot?.setSize(Math.max(1, component.width), Math.max(1, component.height));
        this.synchronizeAuthoringObjects(component);
        this.layout();
        const currentNodeOrder = component.children.map((node) => node.id);
        const structureRequiresPublish = currentNodeOrder.length !== this.publishedRuntimeNodeOrder.length
            || currentNodeOrder.some((nodeId, index) => nodeId !== this.publishedRuntimeNodeOrder[index]);
        const runtimeStatus = this.runtimePublishRequired || structureRequiresPublish
            ? "publish-required"
            : "current";
        return runtimeStatus === plan.runtimeStatus ? plan : { ...plan, runtimeStatus };
    }

    private synchronizeAuthoringObjects(component: ProjectSnapshotComponent): void {
        const root = this.previewRoot;
        if (!root) return;
        const presentNodeIds = new Set(component.children.map((node) => node.id));
        for (const [nodeId, object] of this.previewObjects) {
            if (presentNodeIds.has(nodeId)) continue;
            this.runtimePublishRequired = true;
            if (this.authoringProxyIds.has(nodeId)) {
                if (object.parent === root) root.removeChild(object, true);
                this.previewObjects.delete(nodeId);
                this.authoringProxyIds.delete(nodeId);
            } else {
                object.visible = false;
            }
        }
        for (const child of component.children) {
            let object = this.findPreviewObjectById(child.id);
            if (!object) {
                object = this.createAuthoringProxy(child);
                root.addChild(object);
                this.previewObjects.set(child.id, object);
                this.authoringProxyIds.add(child.id);
                this.runtimePublishRequired = true;
            }
            this.applyObjectState(object, child);
        }
        for (const child of component.children) {
            const object = this.findPreviewObjectById(child.id);
            if (!object) continue;
            if (this.showAllInvisibleNodes) object.visible = true;
            if (this.editorHiddenNodeIds.has(child.id)) object.visible = false;
        }
        this.applyProjectedDisplayListOrder(component);
        this.selectedNodeIds = new Set(
            [...this.selectedNodeIds].filter((nodeId) => presentNodeIds.has(nodeId)),
        );
        if (this.selectedNodeId && !this.selectedNodeIds.has(this.selectedNodeId)) {
            this.selectedNodeId = [...this.selectedNodeIds][0] || "";
        }
        this.updateSelectionFrame();
    }

    private createAuthoringProxy(state: ProjectSnapshotDisplayNode): fgui.GObject {
        const isText = Boolean(state.text) || state.type.toLowerCase().includes("text");
        const object = isText ? new fgui.GTextField() : new fgui.GGraph();
        object.name = `authoring:${state.name || state.id}`;
        if (object instanceof fgui.GTextField) {
            object.align = "center";
            object.valign = "middle";
            object.color = state.color || "#d8efff";
        }
        return object;
    }

    private applyProjectedDisplayListOrder(component: ProjectSnapshotComponent): void {
        const root = this.previewRoot;
        if (!root) return;
        let index = 0;
        for (const child of component.children) {
            const object = this.findPreviewObjectById(child.id);
            if (!object || object.parent !== root) continue;
            root.setChildIndex(object, Math.min(index, root.numChildren - 1));
            index += 1;
        }
    }

    private applyObjectState(
        object: fgui.GObject,
        state: ProjectSnapshotDisplayNode,
    ): void {
        const snapshotState = state as Partial<ProjectSnapshotDisplayNode>;
        object.setPivot(state.pivotX, state.pivotY, state.pivotAsAnchor);
        object.setXY(state.x, state.y);
        object.setScale(state.scale.x, state.scale.y);
        object.setSkew(state.skew.x, state.skew.y);
        object.minWidth = state.minSize.width;
        object.minHeight = state.minSize.height;
        object.maxWidth = state.maxSize.width;
        object.maxHeight = state.maxSize.height;
        if (state.width > 0 && state.height > 0) {
            object.setSize(state.width, state.height);
        }
        if (state.text !== undefined) {
            object.text = object instanceof fgui.GTextField && this.authoringProxyIds.has(state.id)
                ? state.text || state.name
                : state.text;
        }
        if (snapshotState.alpha !== undefined) object.alpha = snapshotState.alpha;
        if (snapshotState.rotation !== undefined) object.rotation = snapshotState.rotation;
        object.visible = (snapshotState.visible !== false || this.showAllInvisibleNodes)
            && !this.editorHiddenNodeIds.has(state.id);
        if (snapshotState.grayed !== undefined) object.grayed = snapshotState.grayed;
        if (snapshotState.touchable !== undefined) object.touchable = snapshotState.touchable;
        object.tooltips = state.tooltips;
        object.blendMode = state.blendMode;
        if (state.filter === "color") {
            const values = state.filterData.split(",").map((value) => Number(value.trim()));
            if (values.length === 4 && values.every(Number.isFinite)) {
                object.filters = [new Laya.ColorFilter().adjustColor(values[0], values[1], values[2], values[3])];
            } else {
                object.filters = [];
                this.runtimePublishRequired = true;
            }
        } else {
            object.filters = [];
        }
        const instance = snapshotState.componentInstanceProperties;
        if (instance?.extensionType === "Button" && object instanceof fgui.GButton) {
            object.title = instance.title;
            object.selectedTitle = instance.selectedTitle;
            object.icon = instance.icon;
            object.selectedIcon = instance.selectedIcon;
            if (instance.titleColor) object.titleColor = instance.titleColor;
            if (instance.titleFontSize > 0) object.titleFontSize = instance.titleFontSize;
            object.selected = instance.checked;
            object.sound = instance.sound;
            object.soundVolumeScale = instance.soundVolumeScale;
        } else if (instance?.extensionType === "Label" && object instanceof fgui.GLabel) {
            object.title = instance.title;
            object.icon = instance.icon;
            if (instance.titleColor) object.titleColor = instance.titleColor;
            if (instance.titleFontSize > 0) object.titleFontSize = instance.titleFontSize;
        } else if (instance?.extensionType === "ComboBox" && object instanceof fgui.GComboBox) {
            object.text = instance.title;
            object.icon = instance.icon;
            if (instance.titleColor) object.titleColor = instance.titleColor;
            object.popupDirection = instance.popupDirection;
            object.visibleItemCount = instance.visibleItemCount;
            object.items = instance.items.map((item) => item.title || "");
            object.values = instance.items.map((item) => item.value || "");
            object.icons = instance.items.map((item) => item.icon || "");
        } else if (
            (instance?.extensionType === "ProgressBar" && object instanceof fgui.GProgressBar)
            || (instance?.extensionType === "Slider" && object instanceof fgui.GSlider)
        ) {
            object.min = instance.min;
            object.max = instance.max;
            object.value = instance.value;
        }
        if (object instanceof fgui.GImage && snapshotState.imageProperties) {
            const image = snapshotState.imageProperties;
            object.color = image.color;
            object.flip = image.flip;
            object.fillMethod = image.fillMethod;
            object.fillOrigin = image.fillOrigin;
            object.fillClockwise = image.fillClockwise;
            object.fillAmount = image.fillAmount;
        } else if (object instanceof fgui.GMovieClip && snapshotState.movieClipProperties) {
            const movieClip = snapshotState.movieClipProperties;
            object.playing = movieClip.playing;
            object.frame = movieClip.frame;
            object.color = movieClip.color;
        } else if (object instanceof fgui.GLoader && snapshotState.loaderProperties) {
            const loader = snapshotState.loaderProperties;
            object.fill = loader.fill;
            object.shrinkOnly = loader.shrinkOnly;
            object.useResize = loader.useResize;
            object.autoSize = loader.autoSize;
            object.align = ["left", "center", "right"][loader.align] || "left";
            object.verticalAlign = ["top", "middle", "bottom"][loader.vAlign] || "top";
            object.playing = loader.playing;
            object.frame = loader.frame;
            object.color = loader.color;
            object.fillMethod = loader.fillMethod;
            object.fillOrigin = loader.fillOrigin;
            object.fillClockwise = loader.fillClockwise;
            object.fillAmount = loader.fillAmount;
            try {
                object.url = loader.url;
            } catch {
                this.runtimePublishRequired = true;
            }
        } else if (object instanceof fgui.GLoader3D && snapshotState.loader3DProperties) {
            const loader = snapshotState.loader3DProperties;
            object.fill = loader.fill;
            object.shrinkOnly = loader.shrinkOnly;
            object.autoSize = loader.autoSize;
            object.align = [fgui.AlignType.Left, fgui.AlignType.Center, fgui.AlignType.Right][loader.align]
                ?? fgui.AlignType.Left;
            object.verticalAlign = [fgui.VertAlignType.Top, fgui.VertAlignType.Middle, fgui.VertAlignType.Bottom][loader.vAlign]
                ?? fgui.VertAlignType.Top;
            object.animationName = loader.animationName;
            object.skinName = loader.skinName;
            object.playing = loader.playing;
            object.frame = loader.frame;
            object.loop = loader.loop;
            object.color = loader.color;
            try {
                object.url = loader.url;
            } catch {
                this.runtimePublishRequired = true;
            }
        } else if (object instanceof fgui.GList && snapshotState.listProperties) {
            const list = snapshotState.listProperties;
            object.layout = list.layout;
            object.align = ["left", "center", "right"][list.align] || "left";
            object.verticalAlign = ["top", "middle", "bottom"][list.vAlign] || "top";
            object.lineGap = list.lineGap;
            object.columnGap = list.columnGap;
            object.lineCount = list.lineCount;
            object.columnCount = list.columnCount;
            object.selectionMode = list.selectionMode;
            object.defaultItem = list.defaultItem;
            object.autoResizeItem = list.autoResizeItem;
            object.childrenRenderOrder = list.childrenRenderOrder;
            object.apexIndex = list.apexIndex;
            object.scrollItemToViewOnClick = list.scrollItemToViewOnClick;
            object.foldInvisibleItems = list.foldInvisibleItems;
            if (object instanceof fgui.GTree && "indent" in list) {
                object.indent = list.indent;
                object.clickToExpand = list.clickToExpand;
            }
            this.runtimePublishRequired = true;
        } else if (object instanceof fgui.GTextField) {
            if (snapshotState.font !== undefined) {
                try {
                    object.font = snapshotState.font;
                } catch {
                    this.runtimePublishRequired = true;
                    // ponytail: keep authoring usable with the default font until Publish refreshes stale bitmap-font assets.
                    try {
                        object.font = "";
                    } catch {
                        // The UAM snapshot remains authoritative even if the frozen runtime rejects its fallback.
                    }
                }
            }
            if (snapshotState.fontSize !== undefined && snapshotState.fontSize > 0) {
                object.fontSize = snapshotState.fontSize;
            }
            if (state.color) object.color = state.color;
            const properties = snapshotState.textProperties;
            if (properties) {
                object.align = ["left", "center", "right"][properties.align] || "left";
                object.valign = ["top", "middle", "bottom"][properties.vAlign] || "top";
                object.leading = properties.leading;
                object.letterSpacing = properties.letterSpacing;
                object.autoSize = properties.autoSize;
                object.singleLine = properties.singleLine;
                object.ubbEnabled = properties.ubbEnabled;
                object.underline = properties.underline;
                object.italic = properties.italic;
                object.bold = properties.bold;
                object.stroke = properties.strokeColor ? properties.strokeSize : 0;
                if (properties.strokeColor) object.strokeColor = properties.strokeColor;
            }
            if (object instanceof fgui.GTextInput && snapshotState.textInputProperties) {
                object.promptText = snapshotState.textInputProperties.promptText;
                object.maxLength = snapshotState.textInputProperties.maxLength;
                object.restrict = snapshotState.textInputProperties.restrict;
                object.password = snapshotState.textInputProperties.password;
            }
        } else if (object instanceof fgui.GGraph) {
            const graph = snapshotState.graphProperties;
            if (!graph) {
                if (this.authoringProxyIds.has(state.id)) {
                    object.drawRect(1, "#6db8ff", "rgba(109,184,255,0.18)");
                }
            } else {
                this.drawGraphObject(object, graph);
            }
        }
        object.visible = state.visible !== false;
    }

    private drawGraphObject(object: fgui.GGraph, graph: GraphEditableProperties): void {
        if (graph.graphType === 1) {
            object.drawRect(
                graph.lineSize,
                graph.lineColor,
                graph.fillColor,
                graph.cornerRadius || undefined,
            );
        } else if (graph.graphType === 2) {
            const graphics = object.displayObject.graphics;
            graphics.clear();
            graphics.drawEllipse(
                object.width / 2,
                object.height / 2,
                object.width / 2,
                object.height / 2,
                graph.fillColor,
                graph.lineSize > 0 ? graph.lineColor : null,
                graph.lineSize,
            );
        } else if (graph.graphType === 3 && graph.points && graph.points.length >= 6) {
            object.drawPolygon(graph.lineSize, graph.lineColor, graph.fillColor, [...graph.points]);
        } else if (graph.graphType === 4 && graph.sides >= 3) {
            object.drawRegularPolygon(
                graph.lineSize,
                graph.lineColor,
                graph.fillColor,
                graph.sides,
                graph.startAngle,
                graph.distances ? [...graph.distances] : undefined,
            );
        } else {
            object.displayObject.graphics.clear();
        }
    }

    private clearPreview(): void {
        this.cancelCanvasInteraction(false);
        for (const binding of this.bindings) {
            binding.object.off(Laya.Event.MOUSE_DOWN, this, this.onPreviewObjectMouseDown);
            binding.object.off(Laya.Event.RIGHT_MOUSE_DOWN, this, this.onPreviewObjectRightMouseDown);
        }
        this.bindings = [];
        this.previewObjects.clear();
        this.authoringProxyIds.clear();
        this.publishedRuntimeNodeOrder = [];
        this.runtimePublishRequired = false;

        if (this.previewRoot && this.previewRoot.parent) {
            this.owner.removeChild(this.previewRoot, true);
        }

        this.previewRoot = null;
        this.previewPackageName = "";
        this.previewComponentId = "";
        this.previewSourceRevision = "";
        this.projectedComponent = null;
        this.lastClickNodeId = "";
        this.lastClickAt = 0;
        this.componentCanvasBackground.visible = false;
        this.selectionFrame.visible = false;
        this.marqueeFrame.visible = false;
        this.resizeHandle.visible = false;
        this.rotateHandle.visible = false;
        this.pivotHandle.visible = false;
        this.hideGraphPointHandles();
        this.hideSnapGuides();
        this.setPlaceholderVisible(true);
    }

    private bindSelectableObjects(root: fgui.GComponent): void {
        for (let index = 0; index < root.numChildren; index += 1) {
            const object = root.getChildAt(index);
            if (object.id) this.previewObjects.set(object.id, object);
        }

        root.on(Laya.Event.MOUSE_DOWN, this, this.onPreviewObjectMouseDown);
        root.on(Laya.Event.RIGHT_MOUSE_DOWN, this, this.onPreviewObjectRightMouseDown);
        this.bindings.push({ object: root });
    }

    private onPreviewObjectRightMouseDown(event: Laya.Event): void {
        const root = this.previewRoot;
        const component = this.projectedComponent;
        if (!root || !component || !this.onContextMenu) return;
        event.preventDefault();
        event.stopPropagation();
        root.requestFocus();
        const node = this.findPreviewNodeAt(component, event.stageX, event.stageY);
        if (node && !this.selectedNodeIds.has(node.id)) {
            this.selectNodes([node.id], node.id);
            this.onSelectNode([node.id], node.id);
        }
        this.onContextMenu();
    }

    private onPreviewObjectMouseDown(event: Laya.Event): void {
        const root = this.previewRoot;
        const component = this.projectedComponent;
        if (!root || !component || event.button !== 0 || this.panShortcutActive) return;

        const node = this.findPreviewNodeAt(component, event.stageX, event.stageY);
        root.requestFocus();
        if (this.creationMode && this.onCreateNode) {
            event.stopPropagation();
            const point = this.resolveAuthoringDropPoint(event.stageX, event.stageY);
            if (point) void this.onCreateNode(point);
            return;
        }
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        if (!node || event.altKey) {
            this.cancelCanvasInteraction(true);
            this.marqueeState = {
                touchId: event.touchId,
                startStagePointer: { x: event.stageX, y: event.stageY },
                currentStagePointer: { x: event.stageX, y: event.stageY },
                additive,
                moved: false,
            };
            this.bindCanvasInteractionEvents();
            return;
        }

        const object = this.findPreviewObjectById(node.id);
        if (!object) return;

        const now = Date.now();
        const doubleClick = node.id === this.lastClickNodeId
            && now - this.lastClickAt <= DOUBLE_CLICK_INTERVAL_MS;
        this.lastClickNodeId = node.id;
        this.lastClickAt = now;
        if (doubleClick && this.onOpenNode) {
            event.stopPropagation();
            this.lastClickNodeId = "";
            this.lastClickAt = 0;
            this.cancelCanvasInteraction(true);
            this.selectNodes([node.id], node.id);
            this.onSelectNode([node.id], node.id);
            this.onOpenNode(node.id);
            return;
        }

        this.cancelCanvasInteraction(true);
        if (additive) {
            const next = new Set(this.selectedNodeIds);
            if (next.has(node.id)) {
                next.delete(node.id);
            } else {
                next.add(node.id);
            }
            const nodeIds = [...next];
            const primaryNodeId = next.has(node.id) ? node.id : nodeIds[0] || "";
            this.selectNodes(nodeIds, primaryNodeId);
            this.onSelectNode(nodeIds, primaryNodeId);
            return;
        }

        const nodeIds = this.selectedNodeIds.has(node.id)
            ? [...this.selectedNodeIds]
            : [node.id];
        this.selectNodes(nodeIds, node.id);
        this.onSelectNode(nodeIds, node.id);
        if (!this.onMoveNode) return;

        const localPointer = root.globalToLocal(event.stageX, event.stageY);
        const items = nodeIds.flatMap((nodeId): RuntimePreviewDragItem[] => {
            const selectedObject = this.findPreviewObjectById(nodeId);
            const selectedNode = component.children.find((child) => child.id === nodeId);
            return selectedObject && selectedNode
                ? [{
                    nodeId,
                    object: selectedObject,
                    startObjectPosition: { x: selectedObject.x, y: selectedObject.y },
                    startProjectPosition: { x: selectedNode.x, y: selectedNode.y },
                    targetPosition: { x: selectedNode.x, y: selectedNode.y },
                }]
                : [];
        });
        if (items.length === 0) return;

        this.dragState = {
            touchId: event.touchId,
            startStagePointer: { x: event.stageX, y: event.stageY },
            startLocalPointer: { x: localPointer.x, y: localPointer.y },
            items,
            moved: false,
        };
        this.bindCanvasInteractionEvents();
    }

    private onStageMouseDown(event: Laya.Event): void {
        const point = this.viewport.globalToLocal(event.stageX, event.stageY);
        this.canvasFocused = point.x >= 0
            && point.y >= 0
            && point.x <= this.viewport.width
            && point.y <= this.viewport.height;
        if (event.button === 0 && this.panShortcutActive && this.canvasFocused && this.previewRoot) {
            event.stopPropagation();
            this.cancelCanvasInteraction(true);
            this.panState = {
                touchId: event.touchId,
                startStagePointer: { x: event.stageX, y: event.stageY },
                startPan: { x: this.panX, y: this.panY },
            };
            this.bindCanvasInteractionEvents();
        }
    }

    private onResizeHandleMouseDown(event: Laya.Event): void {
        const root = this.previewRoot;
        if (
            !root
            || !this.onResizeNode
            || event.button !== 0
            || this.selectedNodeIds.size === 0
        ) {
            return;
        }
        const items = [...this.selectedNodeIds].flatMap((nodeId) => {
            const object = this.findPreviewObjectById(nodeId);
            if (!object || object.parent !== root) return [];
            return [{
                nodeId,
                object,
                x: object.x,
                y: object.y,
                width: object.width,
                height: object.height,
                startObjectPosition: { x: object.x, y: object.y },
                startObjectSize: { width: object.width, height: object.height },
            } satisfies RuntimePreviewResizeItem];
        });
        const startBounds = getDesktopCanvasBounds(
            items.map((item) => ({
                id: item.nodeId,
                x: item.x,
                y: item.y,
                width: item.width,
                height: item.height,
            })),
        );
        if (!startBounds || items.length !== this.selectedNodeIds.size) return;

        event.stopPropagation();
        this.cancelCanvasInteraction(true);
        root.requestFocus();
        const localPointer = root.globalToLocal(event.stageX, event.stageY);
        this.resizeState = {
            touchId: event.touchId,
            startStagePointer: { x: event.stageX, y: event.stageY },
            startLocalPointer: { x: localPointer.x, y: localPointer.y },
            startBounds,
            items,
            targets: items.map((item) => ({
                nodeId: item.nodeId,
                x: item.x,
                y: item.y,
                width: item.width,
                height: item.height,
            })),
            moved: false,
        };
        this.bindCanvasInteractionEvents();
    }

    private onRotateHandleMouseDown(event: Laya.Event): void {
        const root = this.previewRoot;
        if (
            !root
            || !this.onRotateNode
            || event.button !== 0
            || this.selectedNodeIds.size === 0
        ) {
            return;
        }
        const items = [...this.selectedNodeIds].flatMap((nodeId) => {
            const object = this.findPreviewObjectById(nodeId);
            if (!object || object.parent !== root) return [];
            return [{
                nodeId,
                object,
                startObjectPosition: { x: object.x, y: object.y },
                startObjectRotation: object.rotation,
            } satisfies RuntimePreviewRotateItem];
        });
        const bounds = getDesktopCanvasBounds(items.map((item) => ({
            id: item.nodeId,
            x: item.object.x,
            y: item.object.y,
            width: item.object.width,
            height: item.object.height,
        })));
        if (!bounds || items.length !== this.selectedNodeIds.size) return;
        const centerProject = {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
        };

        event.stopPropagation();
        this.cancelCanvasInteraction(true);
        root.requestFocus();
        const centerStage = root.localToGlobal(centerProject.x, centerProject.y);
        this.rotateState = {
            touchId: event.touchId,
            centerStage: { x: centerStage.x, y: centerStage.y },
            centerProject,
            startStagePointer: { x: event.stageX, y: event.stageY },
            items,
            targets: items.map((item) => ({
                nodeId: item.nodeId,
                x: item.startObjectPosition.x,
                y: item.startObjectPosition.y,
                rotation: item.startObjectRotation,
            })),
            moved: false,
        };
        this.bindCanvasInteractionEvents();
    }

    private onPivotHandleMouseDown(event: Laya.Event): void {
        const root = this.previewRoot;
        const component = this.projectedComponent;
        const nodeId = this.selectedNodeId;
        const node = component?.children.find((child) => child.id === nodeId);
        const object = this.findPreviewObjectById(nodeId);
        if (
            !root
            || !node
            || !object
            || !this.onPivotNode
            || event.button !== 0
            || this.selectedNodeIds.size !== 1
            || !this.supportsPivot(node)
            || object.width <= 0
            || object.height <= 0
            || object.scaleX === 0
            || object.scaleY === 0
        ) {
            return;
        }

        event.stopPropagation();
        this.cancelCanvasInteraction(true);
        root.requestFocus();
        this.pivotState = {
            touchId: event.touchId,
            startStagePointer: { x: event.stageX, y: event.stageY },
            nodeId,
            object,
            startPosition: { x: node.x, y: node.y },
            startPivot: { x: node.pivotX, y: node.pivotY },
            size: { width: object.width, height: object.height },
            scale: { x: object.scaleX, y: object.scaleY },
            rotation: node.rotation,
            pivotAsAnchor: node.pivotAsAnchor,
            target: {
                nodeId,
                x: node.x,
                y: node.y,
                pivotX: node.pivotX,
                pivotY: node.pivotY,
            },
            moved: false,
        };
        this.bindCanvasInteractionEvents();
    }

    private onGraphPointHandleMouseDown(pointIndex: number, event: Laya.Event): void {
        const root = this.previewRoot;
        const nodeId = this.selectedNodeId;
        const node = this.projectedComponent?.children.find((child) => child.id === nodeId);
        const object = this.findPreviewObjectById(nodeId);
        const graph = node?.graphProperties;
        if (
            !root
            || !node
            || !(object instanceof fgui.GGraph)
            || !this.onGraphPoints
            || event.button !== 0
            || this.selectedNodeIds.size !== 1
            || node.type !== "GGraph"
            || (graph?.graphType !== 3 && graph?.graphType !== 4)
            || pointIndex < 0
        ) {
            return;
        }
        const regular = graph.graphType === 4;
        const startDistances = regular
            ? Array.from({ length: graph.sides }, (_, index) => graph.distances?.[index] ?? 1)
            : null;
        const startPoints = regular
            ? this.createRegularPolygonPoints(object, graph, startDistances!)
            : [...(graph.points || [])];
        if (startPoints.length < 6 || pointIndex * 2 + 1 >= startPoints.length) return;

        event.stopPropagation();
        this.cancelCanvasInteraction(true);
        root.requestFocus();
        this.graphPointState = {
            touchId: event.touchId,
            startStagePointer: { x: event.stageX, y: event.stageY },
            nodeId,
            object,
            pointIndex,
            properties: structuredClone(graph),
            startPoints,
            targetPoints: [...startPoints],
            startDistances,
            targetDistances: startDistances ? [...startDistances] : null,
            moved: false,
        };
        this.bindCanvasInteractionEvents();
    }

    private onPreviewObjectMouseMove(event: Laya.Event): void {
        const pan = this.panState;
        if (pan && event.touchId === pan.touchId) {
            this.panX = Math.round(pan.startPan.x + event.stageX - pan.startStagePointer.x);
            this.panY = Math.round(pan.startPan.y + event.stageY - pan.startStagePointer.y);
            this.layout();
            this.emitViewChange();
            return;
        }

        const graphPoint = this.graphPointState;
        if (graphPoint && event.touchId === graphPoint.touchId) {
            if (!graphPoint.moved) {
                graphPoint.moved = hasDesktopCanvasDragMoved(
                    graphPoint.startStagePointer,
                    { x: event.stageX, y: event.stageY },
                );
                if (!graphPoint.moved) return;
            }
            const pointer = graphPoint.object.globalToLocal(event.stageX, event.stageY);
            if (graphPoint.properties.graphType === 4 && graphPoint.targetDistances) {
                graphPoint.targetDistances[graphPoint.pointIndex] = resolveDesktopCanvasRegularPolygonDistance(
                    pointer,
                    graphPoint.object.width,
                    graphPoint.object.height,
                );
                graphPoint.targetPoints = this.createRegularPolygonPoints(
                    graphPoint.object,
                    graphPoint.properties,
                    graphPoint.targetDistances,
                );
            } else {
                graphPoint.targetPoints = resolveDesktopCanvasGraphPoint(
                    graphPoint.startPoints,
                    graphPoint.pointIndex,
                    { x: pointer.x, y: pointer.y },
                    this.snapEnabled ? this.snapStep : 0,
                    this.graphShapeLocked,
                );
            }
            this.drawGraphObject(graphPoint.object, {
                ...graphPoint.properties,
                ...(graphPoint.properties.graphType === 4
                    ? { distances: graphPoint.targetDistances }
                    : { points: graphPoint.targetPoints }),
            });
            this.updateSelectionFrame();
            return;
        }

        const pivot = this.pivotState;
        const root = this.previewRoot;
        if (pivot && root && event.touchId === pivot.touchId) {
            if (!pivot.moved) {
                pivot.moved = hasDesktopCanvasDragMoved(
                    pivot.startStagePointer,
                    { x: event.stageX, y: event.stageY },
                );
                if (!pivot.moved) return;
            }
            const pointer = root.globalToLocal(event.stageX, event.stageY);
            const target = resolveDesktopCanvasPivot(
                pivot.startPosition,
                pivot.startPivot,
                pivot.size,
                pivot.scale,
                pivot.rotation,
                pivot.pivotAsAnchor,
                { x: pointer.x, y: pointer.y },
            );
            pivot.target = { nodeId: pivot.nodeId, ...target };
            pivot.object.setPivot(target.pivotX, target.pivotY, pivot.pivotAsAnchor);
            pivot.object.setXY(target.x, target.y);
            this.updateSelectionFrame();
            return;
        }

        const rotate = this.rotateState;
        if (rotate && event.touchId === rotate.touchId) {
            if (!rotate.moved) {
                rotate.moved = hasDesktopCanvasDragMoved(
                    rotate.startStagePointer,
                    { x: event.stageX, y: event.stageY },
                );
                if (!rotate.moved) return;
            }
            const primary = rotate.items.find((item) => item.nodeId === this.selectedNodeId)
                || rotate.items[0];
            const primaryRotation = resolveDesktopCanvasRotation(
                primary.startObjectRotation,
                rotate.centerStage,
                rotate.startStagePointer,
                { x: event.stageX, y: event.stageY },
                event.shiftKey ? 15 : 1,
            );
            rotate.targets = resolveDesktopCanvasGroupRotation(
                rotate.items.map((item) => ({
                    id: item.nodeId,
                    x: item.startObjectPosition.x,
                    y: item.startObjectPosition.y,
                    rotation: item.startObjectRotation,
                })),
                rotate.centerProject,
                primaryRotation - primary.startObjectRotation,
            ).map((target) => ({
                nodeId: target.id,
                x: target.x,
                y: target.y,
                rotation: target.rotation,
            }));
            for (let index = 0; index < rotate.items.length; index += 1) {
                const item = rotate.items[index];
                const target = rotate.targets[index];
                item.object.setXY(target.x, target.y);
                item.object.rotation = target.rotation;
            }
            this.updateSelectionFrame();
            return;
        }

        const resize = this.resizeState;
        if (resize && root && event.touchId === resize.touchId) {
            if (!resize.moved) {
                resize.moved = hasDesktopCanvasDragMoved(
                    resize.startStagePointer,
                    { x: event.stageX, y: event.stageY },
                );
                if (!resize.moved) return;
            }
            const localPointer = root.globalToLocal(event.stageX, event.stageY);
            let targetSize = resolveDesktopCanvasResize(
                { width: resize.startBounds.width, height: resize.startBounds.height },
                resize.startLocalPointer,
                { x: localPointer.x, y: localPointer.y },
            );
            if (this.snapEnabled) {
                targetSize = {
                    width: Math.max(1, snapDesktopCanvasValue(targetSize.width, this.snapStep)),
                    height: Math.max(1, snapDesktopCanvasValue(targetSize.height, this.snapStep)),
                };
            }
            resize.targets = resolveDesktopCanvasGroupResize(
                resize.items.map((item) => ({
                    id: item.nodeId,
                    x: item.x,
                    y: item.y,
                    width: item.width,
                    height: item.height,
                })),
                targetSize,
            ).map((target) => ({
                nodeId: target.id,
                x: target.x,
                y: target.y,
                width: target.width,
                height: target.height,
            }));
            for (let index = 0; index < resize.items.length; index += 1) {
                const item = resize.items[index];
                const target = resize.targets[index];
                item.object.setXY(target.x, target.y);
                item.object.setSize(target.width, target.height);
            }
            this.updateSelectionFrame();
            return;
        }

        const state = this.dragState;
        if (state && root && event.touchId === state.touchId) {
            if (!state.moved) {
                state.moved = hasDesktopCanvasDragMoved(
                    state.startStagePointer,
                    { x: event.stageX, y: event.stageY },
                );
                if (!state.moved) return;
            }

            const localPointer = root.globalToLocal(event.stageX, event.stageY);
            const currentPointer = { x: localPointer.x, y: localPointer.y };
            const first = state.items[0];
            const rawTarget = resolveDesktopCanvasDragPosition(
                first.startProjectPosition,
                state.startLocalPointer,
                currentPointer,
            );
            const target = this.snapEnabled
                ? {
                    x: snapDesktopCanvasValue(rawTarget.x, this.snapStep),
                    y: snapDesktopCanvasValue(rawTarget.y, this.snapStep),
                }
                : rawTarget;
            const dx = target.x - first.startProjectPosition.x;
            const dy = target.y - first.startProjectPosition.y;
            for (const item of state.items) {
                item.targetPosition = {
                    x: item.startProjectPosition.x + dx,
                    y: item.startProjectPosition.y + dy,
                };
                item.object.setXY(
                    item.startObjectPosition.x + dx,
                    item.startObjectPosition.y + dy,
                );
            }
            this.updateSelectionFrame();
            return;
        }

        const marquee = this.marqueeState;
        if (!marquee || event.touchId !== marquee.touchId) return;
        marquee.currentStagePointer = { x: event.stageX, y: event.stageY };
        if (!marquee.moved) {
            marquee.moved = hasDesktopCanvasDragMoved(
                marquee.startStagePointer,
                marquee.currentStagePointer,
            );
            if (!marquee.moved) return;
        }
        this.updateMarqueeFrame(marquee);
    }

    private onPreviewObjectMouseUp(event: Laya.Event): void {
        const pan = this.panState;
        if (pan && event.touchId === pan.touchId) {
            this.panState = null;
            this.unbindCanvasInteractionEvents();
            this.emitViewChange();
            return;
        }

        const graphPoint = this.graphPointState;
        if (graphPoint && event.touchId === graphPoint.touchId) {
            this.graphPointState = null;
            this.unbindCanvasInteractionEvents();
            if (!graphPoint.moved) return;

            void this.commitGraphPoints(graphPoint);
            return;
        }

        const pivot = this.pivotState;
        if (pivot && event.touchId === pivot.touchId) {
            this.pivotState = null;
            this.unbindCanvasInteractionEvents();
            if (!pivot.moved) return;

            void this.commitNodePivot(pivot);
            return;
        }

        const rotate = this.rotateState;
        if (rotate && event.touchId === rotate.touchId) {
            this.rotateState = null;
            this.unbindCanvasInteractionEvents();
            if (!rotate.moved) return;

            void this.commitNodeRotation(rotate);
            return;
        }

        const resize = this.resizeState;
        if (resize && event.touchId === resize.touchId) {
            this.resizeState = null;
            this.unbindCanvasInteractionEvents();
            if (!resize.moved) return;

            void this.commitNodeResize(resize);
            return;
        }

        const state = this.dragState;
        if (state && event.touchId === state.touchId) {
            this.dragState = null;
            this.unbindCanvasInteractionEvents();
            if (!state.moved) return;

            void this.commitNodeDrag(state);
            return;
        }

        const marquee = this.marqueeState;
        if (!marquee || event.touchId !== marquee.touchId) return;
        this.marqueeState = null;
        this.unbindCanvasInteractionEvents();
        this.marqueeFrame.visible = false;
        this.hideSnapGuides();
        this.commitMarqueeSelection(marquee);
    }

    private async commitNodeDrag(state: RuntimePreviewDragState): Promise<void> {
        let committed = false;
        try {
            committed = await this.onMoveNode!(
                state.items.map((item) => ({
                    nodeId: item.nodeId,
                    x: item.targetPosition.x,
                    y: item.targetPosition.y,
                })),
            );
        } catch (error) {
            console.error("[DesktopCanvas] node move failed", error);
        }

        if (!committed && !this.disposed) {
            for (const item of state.items) {
                if (this.previewObjects.get(item.nodeId) === item.object) {
                    item.object.setXY(item.startObjectPosition.x, item.startObjectPosition.y);
                }
            }
        }
        if (!this.disposed) this.updateSelectionFrame();
    }

    private async commitNodeResize(state: RuntimePreviewResizeState): Promise<void> {
        let committed = false;
        try {
            committed = await this.onResizeNode!(state.targets);
        } catch (error) {
            console.error("[DesktopCanvas] node resize failed", error);
        }

        if (!committed && !this.disposed) {
            for (const item of state.items) {
                if (this.previewObjects.get(item.nodeId) !== item.object) continue;
                item.object.setXY(item.startObjectPosition.x, item.startObjectPosition.y);
                item.object.setSize(item.startObjectSize.width, item.startObjectSize.height);
            }
        }
        if (!this.disposed) this.updateSelectionFrame();
    }

    private async commitNodeRotation(state: RuntimePreviewRotateState): Promise<void> {
        let committed = false;
        try {
            committed = await this.onRotateNode!(state.targets);
        } catch (error) {
            console.error("[DesktopCanvas] node rotation failed", error);
        }
        if (!committed && !this.disposed) {
            for (const item of state.items) {
                if (this.previewObjects.get(item.nodeId) !== item.object) continue;
                item.object.setXY(item.startObjectPosition.x, item.startObjectPosition.y);
                item.object.rotation = item.startObjectRotation;
            }
        }
        if (!this.disposed) this.updateSelectionFrame();
    }

    private async commitNodePivot(state: RuntimePreviewPivotState): Promise<void> {
        let committed = false;
        try {
            committed = await this.onPivotNode!(state.target);
        } catch (error) {
            console.error("[DesktopCanvas] node pivot failed", error);
        }
        if (!committed && !this.disposed && this.previewObjects.get(state.nodeId) === state.object) {
            state.object.setPivot(
                state.startPivot.x,
                state.startPivot.y,
                state.pivotAsAnchor,
            );
            state.object.setXY(state.startPosition.x, state.startPosition.y);
        }
        if (!this.disposed) this.updateSelectionFrame();
    }

    private async commitGraphPoints(state: RuntimePreviewGraphPointState): Promise<void> {
        let committed = false;
        try {
            committed = await this.onGraphPoints!({
                nodeId: state.nodeId,
                points: state.properties.graphType === 3 ? state.targetPoints : null,
                distances: state.properties.graphType === 4 ? state.targetDistances : null,
            });
        } catch (error) {
            console.error("[DesktopCanvas] graph point move failed", error);
        }
        if (!committed && !this.disposed && this.previewObjects.get(state.nodeId) === state.object) {
            this.drawGraphObject(state.object, {
                ...state.properties,
                ...(state.properties.graphType === 4
                    ? { distances: state.startDistances }
                    : { points: state.startPoints }),
            });
        }
        if (!this.disposed) this.updateSelectionFrame();
    }

    private cancelCanvasInteraction(restoreObjects: boolean): void {
        const state = this.dragState;
        const resize = this.resizeState;
        const rotate = this.rotateState;
        const pivot = this.pivotState;
        const graphPoint = this.graphPointState;
        const pan = this.panState;
        this.dragState = null;
        this.marqueeState = null;
        this.resizeState = null;
        this.rotateState = null;
        this.pivotState = null;
        this.graphPointState = null;
        this.panState = null;
        this.marqueeFrame.visible = false;
        this.unbindCanvasInteractionEvents();
        if (restoreObjects && state) {
            for (const item of state.items) {
                if (this.previewObjects.get(item.nodeId) === item.object) {
                    item.object.setXY(item.startObjectPosition.x, item.startObjectPosition.y);
                }
            }
        }
        if (restoreObjects && resize) {
            for (const item of resize.items) {
                if (this.previewObjects.get(item.nodeId) !== item.object) continue;
                item.object.setXY(item.startObjectPosition.x, item.startObjectPosition.y);
                item.object.setSize(item.startObjectSize.width, item.startObjectSize.height);
            }
        }
        if (restoreObjects && rotate) {
            for (const item of rotate.items) {
                if (this.previewObjects.get(item.nodeId) !== item.object) continue;
                item.object.setXY(item.startObjectPosition.x, item.startObjectPosition.y);
                item.object.rotation = item.startObjectRotation;
            }
        }
        if (
            restoreObjects
            && pivot
            && this.previewObjects.get(pivot.nodeId) === pivot.object
        ) {
            pivot.object.setPivot(
                pivot.startPivot.x,
                pivot.startPivot.y,
                pivot.pivotAsAnchor,
            );
            pivot.object.setXY(pivot.startPosition.x, pivot.startPosition.y);
        }
        if (
            restoreObjects
            && graphPoint
            && this.previewObjects.get(graphPoint.nodeId) === graphPoint.object
        ) {
            this.drawGraphObject(graphPoint.object, {
                ...graphPoint.properties,
                ...(graphPoint.properties.graphType === 4
                    ? { distances: graphPoint.startDistances }
                    : { points: graphPoint.startPoints }),
            });
        }
        if (restoreObjects && pan) {
            this.panX = pan.startPan.x;
            this.panY = pan.startPan.y;
            this.layout();
            this.emitViewChange();
        }
    }

    private bindCanvasInteractionEvents(): void {
        Laya.stage.on(Laya.Event.MOUSE_MOVE, this, this.onPreviewObjectMouseMove);
        Laya.stage.on(Laya.Event.MOUSE_UP, this, this.onPreviewObjectMouseUp);
    }

    private unbindCanvasInteractionEvents(): void {
        Laya.stage.off(Laya.Event.MOUSE_MOVE, this, this.onPreviewObjectMouseMove);
        Laya.stage.off(Laya.Event.MOUSE_UP, this, this.onPreviewObjectMouseUp);
    }

    private emitViewChange(): void {
        this.onViewChange?.(this.zoom, this.panX, this.panY);
    }

    private updateMarqueeFrame(state: RuntimePreviewMarqueeState): void {
        const rect = resolveDesktopCanvasRect(state.startStagePointer, state.currentStagePointer);
        const topLeft = this.owner.globalToLocal(rect.x, rect.y);
        this.marqueeFrame.visible = true;
        this.marqueeFrame.setXY(Math.round(topLeft.x), Math.round(topLeft.y));
        this.marqueeFrame.setSize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
        this.marqueeFrame.drawRect(1, "#8ac6ff", "rgba(109,184,255,0.12)");
        this.owner.setChildIndex(this.marqueeFrame, this.owner.numChildren - 1);
    }

    private commitMarqueeSelection(state: RuntimePreviewMarqueeState): void {
        if (!state.moved) {
            if (!state.additive) {
                this.selectNodes([]);
                this.onSelectNode([], "");
            }
            return;
        }

        const marquee = resolveDesktopCanvasRect(
            state.startStagePointer,
            state.currentStagePointer,
        );
        const selected = getDesktopCanvasMarqueeSelection(
            [...this.previewObjects].flatMap(([id, object]) => {
                if (!object.visible) return [];
                const bounds = object.localToGlobalRect(0, 0, object.width, object.height);
                return [{
                    id,
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                }];
            }),
            marquee,
        );
        const nodeIds = state.additive
            ? [...new Set([...this.selectedNodeIds, ...selected])]
            : selected;
        const primaryNodeId = selected[selected.length - 1]
            || (state.additive ? this.selectedNodeId : "");
        this.selectNodes(nodeIds, primaryNodeId);
        this.onSelectNode(nodeIds, primaryNodeId);
    }

    private updateSelectionFrame(): void {
        if (!this.previewRoot || this.selectedNodeIds.size === 0) {
            this.selectionFrame.visible = false;
            this.resizeHandle.visible = false;
            this.rotateHandle.visible = false;
            this.pivotHandle.visible = false;
            this.hideGraphPointHandles();
            return;
        }

        const objects = [...this.selectedNodeIds]
            .map((nodeId) => this.findPreviewObjectById(nodeId))
            .filter((object): object is fgui.GObject => !!object && object.visible);
        if (objects.length === 0) {
            this.selectionFrame.visible = false;
            this.resizeHandle.visible = false;
            this.rotateHandle.visible = false;
            this.pivotHandle.visible = false;
            this.hideGraphPointHandles();
            return;
        }

        const globalRect = objects.length > 1
            ? (() => {
                const bounds = getDesktopCanvasBounds(objects.map((object, index) => ({
                    id: String(index),
                    x: object.x,
                    y: object.y,
                    width: object.width,
                    height: object.height,
                })))!;
                return this.previewRoot!.localToGlobalRect(
                    bounds.x,
                    bounds.y,
                    bounds.width,
                    bounds.height,
                );
            })()
            : objects[0].localToGlobalRect(0, 0, objects[0].width, objects[0].height);
        const localRect = this.owner.globalToLocalRect(
            globalRect.x,
            globalRect.y,
            globalRect.width,
            globalRect.height,
        );
        this.selectionFrame.visible = true;
        this.selectionFrame.setXY(Math.round(localRect.x), Math.round(localRect.y));
        this.selectionFrame.setSize(Math.max(1, Math.round(localRect.width)), Math.max(1, Math.round(localRect.height)));
        this.selectionFrame.drawRect(1, "#6db8ff", "rgba(0,0,0,0)");
        this.resizeHandle.visible = !!this.onResizeNode;
        if (this.resizeHandle.visible) {
            this.resizeHandle.setXY(
                Math.round(localRect.x + localRect.width - this.resizeHandle.width / 2),
                Math.round(localRect.y + localRect.height - this.resizeHandle.height / 2),
            );
            this.owner.setChildIndex(this.resizeHandle, this.owner.numChildren - 1);
        }
        this.rotateHandle.visible = !!this.onRotateNode;
        if (this.rotateHandle.visible) {
            this.rotateHandle.setXY(
                Math.round(localRect.x + localRect.width / 2 - this.rotateHandle.width / 2),
                Math.round(localRect.y - 24),
            );
            this.owner.setChildIndex(this.rotateHandle, this.owner.numChildren - 1);
        }
        const pivotNode = objects.length === 1
            ? this.projectedComponent?.children.find((node) => node.id === this.selectedNodeId)
            : null;
        this.pivotHandle.visible = !!this.onPivotNode
            && !!pivotNode
            && this.supportsPivot(pivotNode);
        if (this.pivotHandle.visible && pivotNode) {
            const target = this.pivotState?.nodeId === pivotNode.id
                ? this.pivotState.target
                : {
                    x: pivotNode.x,
                    y: pivotNode.y,
                    pivotX: pivotNode.pivotX,
                    pivotY: pivotNode.pivotY,
                };
            const pivotProject = pivotNode.pivotAsAnchor
                ? { x: target.x, y: target.y }
                : {
                    x: target.x + target.pivotX * objects[0].width,
                    y: target.y + target.pivotY * objects[0].height,
                };
            const pivotStage = this.previewRoot.localToGlobal(pivotProject.x, pivotProject.y);
            const pivotLocal = this.owner.globalToLocal(pivotStage.x, pivotStage.y);
            this.pivotHandle.setXY(
                Math.round(pivotLocal.x - this.pivotHandle.width / 2),
                Math.round(pivotLocal.y - this.pivotHandle.height / 2),
            );
            this.owner.setChildIndex(this.pivotHandle, this.owner.numChildren - 1);
        }
        this.updateGraphPointHandles();
        if (this.snapEnabled && this.canvasSettings.alignmentGuides && (this.dragState || this.resizeState)) {
            const viewportX = this.viewport === this.owner ? 0 : this.viewport.x;
            const viewportY = this.viewport === this.owner ? 0 : this.viewport.y;
            const guideX = this.resizeState
                ? localRect.x + localRect.width
                : localRect.x;
            const guideY = this.resizeState
                ? localRect.y + localRect.height
                : localRect.y;
            this.snapVerticalGuide.visible = true;
            this.snapVerticalGuide.setXY(Math.round(guideX), viewportY);
            this.snapVerticalGuide.setSize(1, Math.max(1, this.viewport.height));
            this.snapVerticalGuide.drawRect(0, "#57d6ff", "#57d6ff");
            this.snapHorizontalGuide.visible = true;
            this.snapHorizontalGuide.setXY(viewportX, Math.round(guideY));
            this.snapHorizontalGuide.setSize(Math.max(1, this.viewport.width), 1);
            this.snapHorizontalGuide.drawRect(0, "#57d6ff", "#57d6ff");
            this.owner.setChildIndex(this.snapVerticalGuide, this.owner.numChildren - 1);
            this.owner.setChildIndex(this.snapHorizontalGuide, this.owner.numChildren - 1);
        } else {
            this.hideSnapGuides();
        }
    }

    private updateGraphPointHandles(): void {
        const node = this.selectedNodeIds.size === 1
            ? this.projectedComponent?.children.find((child) => child.id === this.selectedNodeId)
            : null;
        const object = node ? this.findPreviewObjectById(node.id) : null;
        const properties = node?.graphProperties;
        const activeState = this.graphPointState;
        const points = activeState && activeState.nodeId === node?.id
            ? activeState.targetPoints
            : properties?.graphType === 4 && object instanceof fgui.GGraph
                ? this.createRegularPolygonPoints(
                    object,
                    properties,
                    Array.from({ length: properties.sides }, (_, index) => properties.distances?.[index] ?? 1),
                )
                : properties?.points;
        if (
            !this.onGraphPoints
            || !this.graphPointEditing
            || node?.type !== "GGraph"
            || !(object instanceof fgui.GGraph)
            || (properties?.graphType !== 3 && properties?.graphType !== 4)
            || !points
            || points.length < 6
            || points.length % 2 !== 0
        ) {
            this.hideGraphPointHandles();
            return;
        }

        const pointCount = points.length / 2;
        while (this.graphPointHandles.length < pointCount) {
            const pointIndex = this.graphPointHandles.length;
            const handle = new fgui.GGraph();
            handle.name = `${GRAPH_POINT_HANDLE_NAME}${pointIndex}`;
            handle.touchable = true;
            handle.setSize(9, 9);
            handle.drawRect(1, "#ffffff", "#28b779");
            handle.on(
                Laya.Event.MOUSE_DOWN,
                this,
                this.onGraphPointHandleMouseDown,
                [pointIndex],
            );
            this.owner.addChild(handle);
            this.graphPointHandles.push(handle);
        }
        for (let index = 0; index < this.graphPointHandles.length; index += 1) {
            const handle = this.graphPointHandles[index];
            handle.visible = index < pointCount;
            if (!handle.visible) continue;
            const point = object.localToGlobal(points[index * 2], points[index * 2 + 1]);
            const local = this.owner.globalToLocal(point.x, point.y);
            handle.setXY(
                Math.round(local.x - handle.width / 2),
                Math.round(local.y - handle.height / 2),
            );
            this.owner.setChildIndex(handle, this.owner.numChildren - 1);
        }
    }

    private hideGraphPointHandles(): void {
        for (const handle of this.graphPointHandles) handle.visible = false;
    }

    private createRegularPolygonPoints(
        object: fgui.GGraph,
        properties: GraphEditableProperties,
        distances: number[],
    ): number[] {
        const radius = Math.min(object.width, object.height) / 2;
        return Array.from({ length: Math.max(3, properties.sides) }, (_, index) => {
            const radians = (properties.startAngle + index * 360 / properties.sides) * Math.PI / 180;
            const distance = distances[index] ?? 1;
            return [
                object.width / 2 + radius * distance * Math.cos(radians),
                object.height / 2 + radius * distance * Math.sin(radians),
            ];
        }).flat();
    }

    private hideSnapGuides(): void {
        this.snapVerticalGuide.visible = false;
        this.snapHorizontalGuide.visible = false;
    }

    private findPreviewObjectById(nodeId: string): fgui.GObject | null {
        return this.previewObjects.get(nodeId) || null;
    }

    private supportsPivot(node: ProjectSnapshotDisplayNode): boolean {
        return node.type !== "GGroup" && node.type !== "GLoader3D";
    }

    private findPreviewNodeAt(
        component: ProjectSnapshotComponent,
        stageX: number,
        stageY: number,
    ): ProjectSnapshotDisplayNode | null {
        for (let index = component.children.length - 1; index >= 0; index -= 1) {
            const node = component.children[index];
            const object = this.previewObjects.get(node.id);
            if (!object || !object.visible) continue;

            const point = object.globalToLocal(stageX, stageY);
            if (point.x >= 0 && point.y >= 0 && point.x <= object.width && point.y <= object.height) {
                return node;
            }
        }

        return null;
    }

    private setPlaceholderVisible(visible: boolean): void {
        if (this.placeholder) {
            this.placeholder.visible = visible;
        }
    }

    private layoutBackground(): void {
        const viewportWidth = Math.max(1, this.viewport.width);
        const viewportHeight = Math.max(1, this.viewport.height);
        const viewportX = this.viewport === this.owner ? 0 : this.viewport.x;
        const viewportY = this.viewport === this.owner ? 0 : this.viewport.y;

        this.canvasBackground.setXY(viewportX, viewportY);
        this.canvasBackground.setSize(viewportWidth, viewportHeight);
        this.canvasBackground.drawRect(0, "#000000", this.canvasSettings.backgroundColor);
        this.owner.setChildIndex(this.canvasBackground, 0);
    }

    private layoutComponentCanvas(x: number, y: number, width: number, height: number): void {
        const componentColor = this.projectedComponent?.bgColorEnabled
            && /^#[0-9a-f]{6}$/i.test(this.projectedComponent.bgColor || "")
            ? this.projectedComponent.bgColor!
            : this.canvasSettings.canvasColor;
        if (componentColor === this.canvasSettings.backgroundColor && !this.canvasSettings.showGrid) {
            this.componentCanvasBackground.visible = false;
            return;
        }

        this.componentCanvasBackground.visible = true;
        this.componentCanvasBackground.setXY(Math.round(x), Math.round(y));
        this.componentCanvasBackground.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
        this.componentCanvasBackground.drawRect(0, "#000000", componentColor);
        const graphics = (this.componentCanvasBackground.displayObject as Laya.Sprite).graphics;
        if (this.canvasSettings.showGrid) {
            const step = Math.max(2, this.canvasSettings.gridSize * this.zoom);
            const shade = Math.round(255 * this.canvasSettings.gridBrightness / 100)
                .toString(16).padStart(2, "0");
            const color = `#${shade}${shade}${shade}`;
            for (let gridX = step; gridX < width; gridX += step) {
                graphics.drawLine(Math.round(gridX), 0, Math.round(gridX), height, color, 1);
            }
            for (let gridY = step; gridY < height; gridY += step) {
                graphics.drawLine(0, Math.round(gridY), width, Math.round(gridY), color, 1);
            }
        }
        if (this.canvasSettings.componentEdge) {
            const segment = 5;
            for (let offset = 0; offset < width; offset += segment * 2) {
                graphics.drawLine(offset, 0, Math.min(width, offset + segment), 0, "#d8d8d8", 1);
                graphics.drawLine(offset, height - 1, Math.min(width, offset + segment), height - 1, "#d8d8d8", 1);
            }
            for (let offset = 0; offset < height; offset += segment * 2) {
                graphics.drawLine(0, offset, 0, Math.min(height, offset + segment), "#d8d8d8", 1);
                graphics.drawLine(width - 1, offset, width - 1, Math.min(height, offset + segment), "#d8d8d8", 1);
            }
        }
    }
}
