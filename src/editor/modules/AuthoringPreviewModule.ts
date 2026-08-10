import {
    AuthoringRuntimePackageLoader,
    type AuthoringRuntimePackageLoadResult,
} from "../runtime/AuthoringRuntimePackageLoader";
import {
    RuntimePreviewController,
    type RuntimePreviewGraphPoints,
    type RuntimePreviewNodePivot,
    type RuntimePreviewNodePosition,
    type RuntimePreviewNodeRotation,
    type RuntimePreviewNodeTransform,
} from "../runtime/RuntimePreviewController";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const AUTHORING_PREVIEW_MODULE_ID = "fairygui.authoring-preview";
export const AUTHORING_PREVIEW_SERVICE = AUTHORING_PREVIEW_MODULE_ID;

export type AuthoringPreviewEvents = {
    selectNodes(nodeIds: string[], primaryNodeId: string): void;
    runtimePackageLoaded(result: AuthoringRuntimePackageLoadResult): void;
    commitPositions(positions: RuntimePreviewNodePosition[]): Promise<boolean>;
    commitTransforms(transforms: RuntimePreviewNodeTransform[]): Promise<boolean>;
    commitRotations(rotations: RuntimePreviewNodeRotation[]): Promise<boolean>;
    commitPivot(pivot: RuntimePreviewNodePivot): Promise<boolean>;
    commitGraphPoints(points: RuntimePreviewGraphPoints): Promise<boolean>;
    viewChanged(zoom: number, panX: number, panY: number): void;
    createNode(point: { x: number; y: number }): Promise<boolean>;
    openNode(nodeId: string): void;
    showContextMenu(): void;
};

export class EditorAuthoringPreview {
    readonly controller: RuntimePreviewController;

    private events: AuthoringPreviewEvents | null = null;
    private readonly loader: AuthoringRuntimePackageLoader;
    private runtimeBundleRevision = 0;

    constructor(chrome: EditorShellChrome, session: EditorProjectSession) {
        this.loader = new AuthoringRuntimePackageLoader(() => {
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
        this.controller = new RuntimePreviewController(
            container,
            container,
            (nodeIds, primaryNodeId) => this.events?.selectNodes(nodeIds, primaryNodeId),
            null,
            (result) => this.events?.runtimePackageLoaded(result),
            this.loader,
            (positions) => this.events?.commitPositions(positions) ?? Promise.resolve(false),
            (transforms) => this.events?.commitTransforms(transforms) ?? Promise.resolve(false),
            (rotations) => this.events?.commitRotations(rotations) ?? Promise.resolve(false),
            (pivot) => this.events?.commitPivot(pivot) ?? Promise.resolve(false),
            (points) => this.events?.commitGraphPoints(points) ?? Promise.resolve(false),
            (zoom, panX, panY) => this.events?.viewChanged(zoom, panX, panY),
            (point) => this.events?.createNode(point) ?? Promise.resolve(false),
            (nodeId) => this.events?.openNode(nodeId),
            () => this.events?.showContextMenu(),
        );
    }

    bind(events: AuthoringPreviewEvents): () => void {
        if (this.events) throw new Error("Authoring preview events are already bound.");
        this.events = events;
        return () => {
            if (this.events === events) this.events = null;
        };
    }

    resetRuntimePackages(): void {
        this.runtimeBundleRevision += 1;
        this.controller.resetRuntimePackages();
    }

    dispose(): void {
        this.events = null;
        this.controller.dispose();
    }
}

export function createAuthoringPreviewModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: AUTHORING_PREVIEW_MODULE_ID,
        hotReloadable: false,
        activate(context) {
            const preview = new EditorAuthoringPreview(
                context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE),
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
            );
            context.provideService(AUTHORING_PREVIEW_SERVICE, preview);
            return () => preview.dispose();
        },
    };
}
