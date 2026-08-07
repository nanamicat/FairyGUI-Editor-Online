import { AuthoringRuntimePackageLoader, type AuthoringRuntimePackageLoadResult } from "../runtime/AuthoringRuntimePackageLoader";
import type {
    RuntimePreviewController,
    RuntimePreviewGraphPoints,
    RuntimePreviewNodePivot,
    RuntimePreviewNodePosition,
    RuntimePreviewNodeRotation,
    RuntimePreviewNodeTransform,
} from "../runtime/RuntimePreviewController";
import { ActiveDocumentController } from "../ui/ActiveDocumentController";
import { DocumentWorkspaceController } from "../ui/DocumentWorkspaceController";
import type { DesktopDocumentTab } from "../runtime/DesktopDocumentTabs";
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
    setDebugAttribute(name: string, value: string): void;
};

export class EditorDocumentAuthoring {
    readonly workspace: DocumentWorkspaceController;
    readonly activeDocument: ActiveDocumentController;
    readonly preview: RuntimePreviewController;

    private events: DocumentAuthoringEvents | null = null;
    private runtimeBundleRevision = 0;

    constructor(
        chrome: EditorShellChrome,
        session: EditorProjectSession,
        createPreview: AuthoringPreviewControllerFactory,
    ) {
        this.workspace = new DocumentWorkspaceController(chrome.panels.document, {
            activateDocument: (tab) => this.events?.activateDocument(tab),
            closeDocument: (tab, event) => this.events?.closeDocument(tab, event),
            changeGroupPathDepth: (depth) => this.events?.changeGroupPathDepth(depth),
            setDebugAttribute: (name, value) => this.events?.setDebugAttribute(name, value),
        });
        this.activeDocument = new ActiveDocumentController(
            this.workspace,
            (name, value) => this.events?.setDebugAttribute(name, value),
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

    resetRuntimePackages(): void {
        this.runtimeBundleRevision += 1;
        this.preview.resetRuntimePackages();
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
