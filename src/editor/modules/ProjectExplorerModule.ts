import type { ProjectSnapshotResource } from "../model/ProjectSnapshot";
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
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const PROJECT_EXPLORER_SERVICE = "fairygui.project-explorer";

export type ProjectExplorerEvents = {
    editPackageGroups(): void;
    applyLibrarySelection(data: LibraryItemData, preserveResourceSelection: boolean): void;
    clearLibrarySelection(): void;
    resourceViewStateChanged(): void;
    showLibraryContextMenu(cell: fgui.GComponent, data: LibraryItemData): void;
    showHierarchyContextMenu(cell: fgui.GComponent, data: HierarchyItemData): void;
    openLibraryItem(data: Extract<LibraryItemData, { kind: "component" | "resource" }>): void;
    selectHierarchyNode(data: HierarchyItemData): void;
    toggleHierarchyNodeLock(data: HierarchyItemData): void;
    toggleHierarchyNodeHidden(data: HierarchyItemData): void;
    applyLibraryDrop(state: LibraryDragState, point: { x: number; y: number }): Promise<void>;
    applyHierarchyDrop(state: HierarchyDragState, target: HierarchyDropTarget): Promise<void>;
    getComponentPreviewEnabled(): boolean;
    setComponentPreviewEnabled(enabled: boolean): void;
};

export class EditorProjectExplorer {
    readonly library: LibraryController;
    readonly treeInteraction: ProjectTreeInteractionController;
    readonly resourcePreview: ResourcePreviewController;

    private events: ProjectExplorerEvents | null = null;

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
                selectHierarchyNode: (data) => this.events?.selectHierarchyNode(data),
                toggleHierarchyNodeLock: (data) => this.events?.toggleHierarchyNodeLock(data),
                toggleHierarchyNodeHidden: (data) => this.events?.toggleHierarchyNodeHidden(data),
                applyLibraryDrop: (state, point) => this.events?.applyLibraryDrop(state, point) ?? Promise.resolve(),
                applyHierarchyDrop: (state, target) => this.events?.applyHierarchyDrop(state, target) ?? Promise.resolve(),
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
    }

    bind(events: ProjectExplorerEvents): () => void {
        if (this.events) throw new Error("Project explorer events are already bound.");
        this.events = events;
        return () => {
            if (this.events === events) this.events = null;
        };
    }

    findResource(packageId: string, resourceId: string): ProjectSnapshotResource | null {
        return this.session.snapshot?.packages.find((pkg) => pkg.id === packageId)
            ?.resources.find((resource) => resource.id === resourceId) || null;
    }

    dispose(): void {
        this.events = null;
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
