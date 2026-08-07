import { AuthoringRuntimePackageLoader, type AuthoringRuntimePackageLoadResult } from "../runtime/AuthoringRuntimePackageLoader";
import { PROJECT_SELECTION_STORAGE_KEY } from "../EditorShellConfig";
import { DEFAULT_BROWSER_WORKSPACE_ID } from "../runtime/BrowserWorkspaceRegistry";
import type {
    RuntimePreviewController,
    RuntimePreviewGraphPoints,
    RuntimePreviewNodePivot,
    RuntimePreviewNodePosition,
    RuntimePreviewNodeRotation,
    RuntimePreviewNodeTransform,
} from "../runtime/RuntimePreviewController";
import {
    ActiveDocumentController,
    type ActiveDocumentSelection,
    type PersistedEditorSelection,
} from "../ui/ActiveDocumentController";
import { DocumentWorkspaceController } from "../ui/DocumentWorkspaceController";
import {
    getDesktopDocumentTabId,
    resolveDesktopReferencedComponentTab,
    type DesktopDocumentTab,
} from "../runtime/DesktopDocumentTabs";
import type {
    EditorProjectSnapshot,
    ProjectSnapshotComponent,
    ProjectSnapshotDisplayNode,
    ProjectSnapshotPackage,
} from "../model/ProjectSnapshot";
import type { EditorDisplayNodeSelector, SetDisplayNodePropsCommand } from "../model/EditorCommand";
import {
    createDesktopCanvasPositionCommands,
    createDesktopCanvasRotationCommands,
    createDesktopCanvasTransformCommands,
} from "../runtime/DesktopCanvasInteraction";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import {
    AUTHORING_PREVIEW_FACTORY_SERVICE,
    type AuthoringPreviewControllerFactory,
} from "./AuthoringPreviewModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const DOCUMENT_AUTHORING_SERVICE = "fairygui.document-authoring";

export type DocumentAuthoringEvents = {
    activateDocument(tab: DesktopDocumentTab): void;
    closeDocument(tab: DesktopDocumentTab, event?: Laya.Event): void;
    changeGroupPathDepth(depth: number): void;
    selectPreviewNodes(nodeIds: string[], primaryNodeId: string): void;
    runtimePackageLoaded(result: AuthoringRuntimePackageLoadResult): void;
    previewViewChanged(zoom: number, panX: number, panY: number): void;
    createNode(point: { x: number; y: number }): Promise<boolean>;
    openNode(nodeId: string): void;
    showCanvasContextMenu(): void;
    refreshPreview(): void;
};

export class EditorDocumentAuthoring {
    readonly workspace: DocumentWorkspaceController;
    readonly activeDocument: ActiveDocumentController;
    readonly preview: RuntimePreviewController;

    private events: DocumentAuthoringEvents | null = null;
    private runtimeBundleRevision = 0;
    private readonly session: EditorProjectSession;
    private readonly chrome: EditorShellChrome;
    private perDocumentViewEnabled = false;
    private readonly viewByDocument = new Map<string, { zoom: number; panX: number; panY: number }>();

    constructor(
        chrome: EditorShellChrome,
        session: EditorProjectSession,
        createPreview: AuthoringPreviewControllerFactory,
    ) {
        this.chrome = chrome;
        this.session = session;
        this.workspace = new DocumentWorkspaceController(chrome.panels.document, {
            activateDocument: (tab) => {
                if (this.activate(tab)) this.events?.activateDocument(tab);
            },
            closeDocument: (tab, event) => {
                event?.stopPropagation();
                this.close(tab);
                this.events?.closeDocument(tab, event);
            },
            changeGroupPathDepth: (depth) => {
                if (this.changeGroupPathDepth(depth)) this.events?.changeGroupPathDepth(depth);
            },
            setDebugAttribute: (name, value) => chrome.setDebugAttribute(name, value),
        });
        this.activeDocument = new ActiveDocumentController(
            this.workspace,
            (name, value) => chrome.setDebugAttribute(name, value),
        );

        const loader = new AuthoringRuntimePackageLoader(() => {
            const adapter = session.projectStorage.getAdapter();
            return adapter
                ? {
                    adapter,
                    revision: `${session.projectStorage.getWorkspaceName()}:${this.runtimeBundleRevision}`,
                }
                : null;
        });
        const container = chrome.panels.document.getChild("docContainer")?.asCom;
        if (!container) throw new Error("Builder/DocumentView is missing docContainer.");
        this.preview = createPreview(
            container,
            container,
            (nodeIds, primaryNodeId) => this.events?.selectPreviewNodes(nodeIds, primaryNodeId),
            null,
            (result) => this.events?.runtimePackageLoaded(result),
            loader,
            (positions) => this.commitPositions(positions),
            (transforms) => this.commitTransforms(transforms),
            (rotations) => this.commitRotations(rotations),
            (pivot) => this.commitPivot(pivot),
            (points) => this.commitGraphPoints(points),
            (zoom, panX, panY) => {
                chrome.setDebugAttribute("data-fairy-editor-canvas-zoom", zoom.toFixed(2));
                chrome.setDebugAttribute("data-fairy-editor-canvas-pan", `${panX},${panY}`);
                this.rememberView(zoom, panX, panY);
                this.events?.previewViewChanged(zoom, panX, panY);
            },
            (point) => this.events?.createNode(point) ?? Promise.resolve(false),
            (nodeId) => this.events?.openNode(nodeId),
            () => this.events?.showCanvasContextMenu(),
        );
    }

    bind(events: DocumentAuthoringEvents): () => void {
        if (this.events) throw new Error("Document authoring events are already bound.");
        this.events = events;
        return () => {
            if (this.events === events) this.events = null;
        };
    }

    get packageId(): string { return this.activeDocument.packageId; }
    get componentId(): string { return this.activeDocument.componentId; }
    get primaryNodeId(): string { return this.activeDocument.primaryNodeId; }
    get nodeIds(): string[] { return this.activeDocument.nodeIds; }
    get count(): number { return this.workspace.count; }
    get usePerDocumentView(): boolean { return this.perDocumentViewEnabled; }
    set usePerDocumentView(value: boolean) { this.perDocumentViewEnabled = value; }

    getSelectedPackage(snapshot: EditorProjectSnapshot | null = this.session.snapshot): ProjectSnapshotPackage | null {
        return this.activeDocument.getPackage(snapshot);
    }

    getSelectedComponent(snapshot: EditorProjectSnapshot | null = this.session.snapshot): ProjectSnapshotComponent | null {
        return this.activeDocument.getComponent(snapshot);
    }

    getSelectedNode(snapshot: EditorProjectSnapshot | null = this.session.snapshot): ProjectSnapshotDisplayNode | null {
        return this.getSelectedComponent(snapshot)?.children.find((node) => node.id === this.primaryNodeId) || null;
    }

    getSelectedNodeSelector(snapshot: EditorProjectSnapshot | null = this.session.snapshot): EditorDisplayNodeSelector | null {
        const tab = this.getActiveTab(snapshot);
        return tab && this.primaryNodeId
            ? {
                packageId: tab.packageId,
                componentResourceId: tab.componentId,
                displayNodeId: this.primaryNodeId,
            }
            : null;
    }

    getSelectedNodes(snapshot: EditorProjectSnapshot | null = this.session.snapshot): ProjectSnapshotDisplayNode[] {
        const selectedIds = new Set(this.nodeIds);
        return this.getSelectedComponent(snapshot)?.children.filter((node) => selectedIds.has(node.id)) || [];
    }

    getActiveTab(snapshot: EditorProjectSnapshot | null = this.session.snapshot): DesktopDocumentTab | null {
        return this.activeDocument.getActiveTab(snapshot);
    }

    getActiveGroupPath(component: ProjectSnapshotComponent | null = this.getSelectedComponent()): string[] {
        return this.workspace.getGroupPath(this.getActiveTab(), component);
    }

    getScopedNodeIds(component: ProjectSnapshotComponent): string[] {
        return this.workspace.getScopedNodeIds(this.getActiveTab(), component);
    }

    setSelection(
        nodeIds: string[],
        primaryNodeId = "",
        snapshot: EditorProjectSnapshot | null = this.session.snapshot,
    ): void {
        this.activeDocument.setNodeSelection(snapshot, nodeIds, primaryNodeId);
        this.activeDocument.rememberSelection(snapshot);
        this.persist(snapshot);
    }

    setActiveSelection(
        packageId: string,
        componentId: string,
        nodeIds: string[] = [],
        primaryNodeId = "",
        snapshot: EditorProjectSnapshot | null = this.session.snapshot,
    ): void {
        this.activeDocument.setActiveSelection(snapshot, packageId, componentId, nodeIds, primaryNodeId);
        this.persist(snapshot);
    }

    clearSelection(snapshot: EditorProjectSnapshot | null = this.session.snapshot): void {
        this.activeDocument.clearNodeSelection();
        this.activeDocument.rememberSelection(snapshot);
        this.persist(snapshot);
    }

    activate(tab: DesktopDocumentTab, snapshot: EditorProjectSnapshot | null = this.session.snapshot): boolean {
        if (!this.activeDocument.activate(snapshot, tab)) return false;
        if (this.perDocumentViewEnabled) {
            const view = this.viewByDocument.get(getDesktopDocumentTabId(tab)) || { zoom: 1, panX: 0, panY: 0 };
            this.preview.setViewState(view.zoom, view.panX, view.panY);
        }
        this.persist(snapshot);
        return true;
    }

    rememberView(zoom: number, panX: number, panY: number): void {
        const tab = this.getActiveTab();
        if (tab && this.perDocumentViewEnabled) {
            this.viewByDocument.set(getDesktopDocumentTabId(tab), { zoom, panX, panY });
        }
    }

    nudgeSelectedNodes(dx: number, dy: number): void {
        const selectedIds = this.nodeIds;
        if (selectedIds.length === 0) return;
        void this.session.runExclusive(async () => {
            if (!this.sameSelection(selectedIds)) return false;
            const selectedNodes = this.getSelectedNodes();
            if (selectedNodes.length !== selectedIds.length) return false;
            return this.applyPositions(
                selectedNodes.map((node) => ({ nodeId: node.id, x: node.x + dx, y: node.y + dy })),
                "keyboard nudge",
            );
        });
    }

    async applyPositions(
        positions: RuntimePreviewNodePosition[],
        source: "canvas drag" | "keyboard nudge",
    ): Promise<boolean> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedNodes = this.getSelectedNodes();
        if (!selectedPackage || !selectedComponent || selectedNodes.length !== this.nodeIds.length) return false;
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
        if (!await this.applyCommands(commands, summary)) return false;
        this.chrome.setDebugAttribute("data-fairy-editor-canvas-interaction", source);
        this.chrome.setDebugAttribute("data-fairy-editor-canvas-selection-count", String(commands.length));
        this.chrome.setDebugAttribute(
            "data-fairy-editor-canvas-position",
            commands.map((command) => (
                `${command.selector.displayNodeId}:${command.props.position!.x},${command.props.position!.y}`
            )).join("|"),
        );
        return true;
    }

    async applyTransforms(
        transforms: RuntimePreviewNodeTransform[],
        source?: string,
    ): Promise<boolean> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedNodes = this.getSelectedNodes();
        if (!selectedPackage || !selectedComponent || selectedNodes.length !== this.nodeIds.length) return false;
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
        if (!await this.applyCommands(commands, summary)) return false;
        this.chrome.setDebugAttribute("data-fairy-editor-canvas-interaction", interaction);
        this.chrome.setDebugAttribute("data-fairy-editor-canvas-selection-count", String(commands.length));
        this.chrome.setDebugAttribute(
            "data-fairy-editor-canvas-size",
            commands.map((command) => {
                const node = nodeById.get(command.selector.displayNodeId)!;
                const size = command.props.size || node;
                return `${command.selector.displayNodeId}:${size.width},${size.height}`;
            }).join("|"),
        );
        this.chrome.setDebugAttribute(
            "data-fairy-editor-canvas-position",
            commands.map((command) => {
                const node = nodeById.get(command.selector.displayNodeId)!;
                const position = command.props.position || node;
                return `${command.selector.displayNodeId}:${position.x},${position.y}`;
            }).join("|"),
        );
        return true;
    }

    async applyRotations(transforms: RuntimePreviewNodeRotation[]): Promise<boolean> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedNodes = this.getSelectedNodes();
        if (!selectedPackage || !selectedComponent || selectedNodes.length !== this.nodeIds.length) return false;
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
        if (!await this.applyCommands(commands, summary)) return false;
        this.chrome.setDebugAttribute("data-fairy-editor-canvas-interaction", interaction);
        this.chrome.setDebugAttribute("data-fairy-editor-canvas-selection-count", String(commands.length));
        this.chrome.setDebugAttribute(
            "data-fairy-editor-canvas-rotation",
            commands.map((command) => {
                const node = nodeById.get(command.selector.displayNodeId)!;
                return `${command.selector.displayNodeId}:${command.props.rotation ?? node.rotation}`;
            }).join("|"),
        );
        this.chrome.setDebugAttribute(
            "data-fairy-editor-canvas-position",
            commands.map((command) => {
                const node = nodeById.get(command.selector.displayNodeId)!;
                const position = command.props.position || node;
                return `${command.selector.displayNodeId}:${position.x},${position.y}`;
            }).join("|"),
        );
        return true;
    }

    async applyPivot(transform: RuntimePreviewNodePivot): Promise<boolean> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedNode = this.getSelectedNode();
        if (
            !selectedPackage
            || !selectedComponent
            || !selectedNode
            || selectedNode.id !== transform.nodeId
            || selectedNode.type === "GGroup"
            || selectedNode.type === "GLoader3D"
        ) return false;
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
        if (!await this.applyCommands(
            [command],
            `canvas pivot ${selectedNode.name || selectedNode.id} to ${pivot.x},${pivot.y}`,
        )) return false;
        this.chrome.setDebugAttribute("data-fairy-editor-canvas-interaction", "pivot");
        this.chrome.setDebugAttribute(
            "data-fairy-editor-canvas-pivot",
            `${selectedNode.id}:${pivot.x},${pivot.y}@${position.x},${position.y}`,
        );
        return true;
    }

    async applyGraphPoints(transform: RuntimePreviewGraphPoints): Promise<boolean> {
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = this.getSelectedComponent();
        const selectedNode = this.getSelectedNode();
        const graph = selectedNode?.graphProperties;
        if (
            !selectedPackage
            || !selectedComponent
            || !selectedNode
            || selectedNode.id !== transform.nodeId
            || selectedNode.type !== "GGraph"
            || (graph?.graphType !== 3 && graph?.graphType !== 4)
        ) return false;
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
        const before = graph.graphType === 3
            ? graph.points!
            : Array.from({ length: graph.sides }, (_, index) => graph.distances?.[index] ?? 1);
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
        if (!await this.applyCommands(
            [command],
            `canvas ${graph.graphType === 3 ? "polygon point" : "regular polygon radius"} ${selectedNode.name || selectedNode.id}`,
        )) return false;
        const changedIndex = after.findIndex((value, index) => value !== before[index]);
        const pointIndex = graph.graphType === 3 ? Math.max(0, Math.floor(changedIndex / 2)) : Math.max(0, changedIndex);
        this.chrome.setDebugAttribute("data-fairy-editor-canvas-interaction", "graph-point");
        this.chrome.setDebugAttribute(
            "data-fairy-editor-canvas-graph-point",
            graph.graphType === 3
                ? `${selectedNode.id}:${pointIndex}:${polygonPoints![pointIndex * 2]},${polygonPoints![pointIndex * 2 + 1]}`
                : `${selectedNode.id}:${pointIndex}:distance=${regularDistances![pointIndex]}`,
        );
        return true;
    }

    private commitPositions(positions: RuntimePreviewNodePosition[]): Promise<boolean> {
        return this.commitSelection(positions, (value) => value.nodeId, () => this.applyPositions(positions, "canvas drag"));
    }

    private commitTransforms(transforms: RuntimePreviewNodeTransform[]): Promise<boolean> {
        return this.commitSelection(transforms, (value) => value.nodeId, () => this.applyTransforms(transforms));
    }

    private commitRotations(rotations: RuntimePreviewNodeRotation[]): Promise<boolean> {
        return this.commitSelection(rotations, (value) => value.nodeId, () => this.applyRotations(rotations));
    }

    private commitPivot(pivot: RuntimePreviewNodePivot): Promise<boolean> {
        return this.commitSingle(pivot.nodeId, () => this.applyPivot(pivot));
    }

    private commitGraphPoints(points: RuntimePreviewGraphPoints): Promise<boolean> {
        return this.commitSingle(points.nodeId, () => this.applyGraphPoints(points));
    }

    private commitSelection<T>(values: T[], getNodeId: (value: T) => string, apply: () => Promise<boolean>): Promise<boolean> {
        const selectedIds = new Set(this.nodeIds);
        if (selectedIds.size === 0 || values.length !== selectedIds.size || values.some((value) => !selectedIds.has(getNodeId(value)))) {
            return Promise.resolve(false);
        }
        return this.session.runExclusive(apply);
    }

    private commitSingle(nodeId: string, apply: () => Promise<boolean>): Promise<boolean> {
        return this.nodeIds.length === 1 && this.nodeIds[0] === nodeId
            ? this.session.runExclusive(apply)
            : Promise.resolve(false);
    }

    private sameSelection(expected: string[]): boolean {
        const current = this.nodeIds;
        return expected.length === current.length && expected.every((nodeId) => current.includes(nodeId));
    }

    private async applyCommands(commands: SetDisplayNodePropsCommand[], summary: string): Promise<boolean> {
        try {
            const { result } = await this.session.applyDisplayNodePropsNow(commands, summary);
            if (result.ok) {
                this.chrome.setStatus(`${summary}.`);
                return true;
            }
            this.refreshPreview();
            this.chrome.setStatus(`Command failed: ${result.error?.code || "unknown_error"}.`);
            return false;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.refreshPreview();
            this.chrome.setStatus(`Command failed: ${message}`, "error");
            console.error("[Editor Session] canvas command apply failed", error);
            return false;
        }
    }

    close(tab: DesktopDocumentTab, snapshot: EditorProjectSnapshot | null = this.session.snapshot): DesktopDocumentTab | null {
        const active = this.activeDocument.close(snapshot, tab);
        this.persist(snapshot);
        return active;
    }

    closeOthers(snapshot: EditorProjectSnapshot | null = this.session.snapshot): boolean {
        const active = this.getActiveTab(snapshot);
        if (!active) return false;
        for (const tab of this.workspace.getOpenTabs()) {
            if (getDesktopDocumentTabId(tab) !== getDesktopDocumentTabId(active)) this.workspace.close(tab, active);
        }
        this.persist(snapshot);
        return true;
    }

    closeAll(snapshot: EditorProjectSnapshot | null = this.session.snapshot): void {
        this.workspace.clear();
        this.activeDocument.setActiveSelection(snapshot, this.packageId, "");
        this.persist(snapshot);
    }

    cycle(delta: number, snapshot: EditorProjectSnapshot | null = this.session.snapshot): DesktopDocumentTab | null {
        const target = this.activeDocument.cycle(snapshot, delta);
        if (target) this.persist(snapshot);
        return target;
    }

    changeGroupPathDepth(targetDepth: number): boolean {
        const path = this.getActiveGroupPath();
        if (!Number.isInteger(targetDepth) || targetDepth < 0 || targetDepth >= path.length) return false;
        this.workspace.setGroupPath(this.getActiveTab(), path.slice(0, targetDepth));
        this.clearSelection();
        return true;
    }

    openGroup(nodeId: string = this.primaryNodeId): string[] | null {
        const component = this.getSelectedComponent();
        const group = component?.children.find((node) => node.id === nodeId);
        if (!component || group?.type !== "GGroup") return null;
        const path = this.workspace.getPathForGroup(component, group.id);
        if (path.length === 0) return null;
        this.workspace.setGroupPath(this.getActiveTab(), path);
        this.clearSelection();
        return path;
    }

    closeGroup(): string | null {
        const path = this.getActiveGroupPath();
        if (path.length === 0) return null;
        this.workspace.setGroupPath(this.getActiveTab(), path.slice(0, -1));
        this.clearSelection();
        return path[path.length - 1];
    }

    getReferencedComponentTab(nodeId: string = this.primaryNodeId): DesktopDocumentTab | null {
        const owner = this.getActiveTab();
        if (!owner || !nodeId) return null;
        return resolveDesktopReferencedComponentTab(
            this.session.liveSessionBridge.getWorkingProject(),
            owner,
            nodeId,
        );
    }

    resolveCommandTargetSelection(
        snapshot: EditorProjectSnapshot,
        targets: Parameters<ActiveDocumentController["resolveCommandTargetSelection"]>[1],
    ): ActiveDocumentSelection | null {
        return this.activeDocument.resolveCommandTargetSelection(snapshot, targets);
    }

    render(snapshot: EditorProjectSnapshot): void {
        this.workspace.render(snapshot, this.getActiveTab(snapshot));
        this.persist(snapshot);
    }

    reset(): void {
        this.workspace.clear();
        this.activeDocument.reset();
        this.viewByDocument.clear();
    }

    restore(snapshot: EditorProjectSnapshot): boolean {
        const selection = this.readPersistedSelection();
        return Boolean(selection?.projectId === snapshot.project.id && this.activeDocument.restore(snapshot, selection));
    }

    persist(snapshot: EditorProjectSnapshot | null = this.session.snapshot): void {
        if (typeof window === "undefined") return;
        const selection = this.activeDocument.createPersistedSelection(snapshot);
        if (!selection) return;
        try {
            window.localStorage.setItem(this.storageKey, JSON.stringify(selection));
        } catch {
            // Local storage is optional UI state; project persistence remains in browser workspace storage.
        }
    }

    private get storageKey(): string {
        return `${PROJECT_SELECTION_STORAGE_KEY}:${this.session.projectStorage.getWorkspaceName()}`;
    }

    private readPersistedSelection(): PersistedEditorSelection | null {
        if (typeof window === "undefined") return null;
        try {
            const scoped = window.localStorage.getItem(this.storageKey);
            const raw = scoped ?? (
                this.session.projectStorage.getWorkspaceName() === DEFAULT_BROWSER_WORKSPACE_ID
                    ? window.localStorage.getItem(PROJECT_SELECTION_STORAGE_KEY)
                    : null
            );
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
                    !!tab && typeof tab.packageId === "string" && typeof tab.componentId === "string"
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

    resetRuntimePackages(): void {
        this.runtimeBundleRevision += 1;
        this.preview.resetRuntimePackages();
    }

    refreshPreview(): void {
        this.events?.refreshPreview();
    }

    dispose(): void {
        this.events = null;
        this.workspace.dispose();
        this.preview.dispose();
    }
}

export function createDocumentAuthoringModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.document-authoring",
        hotReloadable: false,
        activate(context) {
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const session = context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE);
            const createPreview = context.requireService<AuthoringPreviewControllerFactory>(
                AUTHORING_PREVIEW_FACTORY_SERVICE,
            );
            const document = new EditorDocumentAuthoring(chrome, session, createPreview);
            context.provideService(DOCUMENT_AUTHORING_SERVICE, document);
            return () => document.dispose();
        },
    };
}
