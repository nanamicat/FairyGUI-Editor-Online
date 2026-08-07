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
    commitPositions(positions: RuntimePreviewNodePosition[]): Promise<boolean>;
    commitTransforms(transforms: RuntimePreviewNodeTransform[]): Promise<boolean>;
    commitRotations(rotations: RuntimePreviewNodeRotation[]): Promise<boolean>;
    commitPivot(pivot: RuntimePreviewNodePivot): Promise<boolean>;
    commitGraphPoints(points: RuntimePreviewGraphPoints): Promise<boolean>;
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
    private perDocumentViewEnabled = false;
    private readonly viewByDocument = new Map<string, { zoom: number; panX: number; panY: number }>();

    constructor(
        chrome: EditorShellChrome,
        session: EditorProjectSession,
        createPreview: AuthoringPreviewControllerFactory,
    ) {
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
            (positions) => this.events?.commitPositions(positions) ?? Promise.resolve(false),
            (transforms) => this.events?.commitTransforms(transforms) ?? Promise.resolve(false),
            (rotations) => this.events?.commitRotations(rotations) ?? Promise.resolve(false),
            (pivot) => this.events?.commitPivot(pivot) ?? Promise.resolve(false),
            (points) => this.events?.commitGraphPoints(points) ?? Promise.resolve(false),
            (zoom, panX, panY) => this.events?.previewViewChanged(zoom, panX, panY),
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
