import type {
    EditorProjectSnapshot,
    ProjectSnapshotComponent,
    ProjectSnapshotPackage,
} from "../model/ProjectSnapshot";
import type { DesktopDocumentTab } from "../runtime/DesktopDocumentTabs";
import type {
    DocumentWorkspaceController,
    PersistedDocumentGroupPath,
} from "./DocumentWorkspaceController";

export interface ActiveDocumentSelection {
    packageId: string;
    componentId: string;
    nodeIds: string[];
    primaryNodeId: string;
}

export interface ActiveDocumentCommandTarget {
    packageId: string;
    componentResourceId: string;
    displayNodeId: string;
}

export interface PersistedEditorSelection {
    projectId: string;
    packageId: string;
    componentId: string;
    displayNodeId: string;
    openDocuments?: DesktopDocumentTab[];
    groupPaths?: PersistedDocumentGroupPath[];
}

export class ActiveDocumentController {
    private selection: ActiveDocumentSelection = {
        packageId: "",
        componentId: "",
        nodeIds: [],
        primaryNodeId: "",
    };

    constructor(
        private readonly workspace: DocumentWorkspaceController,
        private readonly setDebugAttribute: (name: string, value: string) => void,
    ) {}

    get packageId(): string { return this.selection.packageId; }
    get componentId(): string { return this.selection.componentId; }
    get primaryNodeId(): string { return this.selection.primaryNodeId; }
    get nodeIds(): string[] { return this.selection.nodeIds.slice(); }

    setActiveSelection(
        snapshot: EditorProjectSnapshot | null,
        packageId: string,
        componentId: string,
        nodeIds: string[] = [],
        primaryNodeId = "",
    ): void {
        this.selection = this.normalizeSelection(
            snapshot,
            packageId,
            componentId,
            nodeIds,
            primaryNodeId,
        );
        this.updateSelectionDebugState();
    }

    reset(): void {
        this.selection = {
            packageId: "",
            componentId: "",
            nodeIds: [],
            primaryNodeId: "",
        };
        this.updateSelectionDebugState();
    }

    getPackage(snapshot: EditorProjectSnapshot | null): ProjectSnapshotPackage | null {
        return snapshot?.packages.find((pkg) => pkg.id === this.packageId) || null;
    }

    getComponent(snapshot: EditorProjectSnapshot | null): ProjectSnapshotComponent | null {
        return this.getPackage(snapshot)?.components.find((component) => component.id === this.componentId) || null;
    }

    getActiveTab(snapshot: EditorProjectSnapshot | null): DesktopDocumentTab | null {
        const pkg = this.getPackage(snapshot);
        const component = this.getComponent(snapshot);
        return pkg && component ? { packageId: pkg.id, componentId: component.id } : null;
    }

    rememberSelection(snapshot: EditorProjectSnapshot | null): void {
        this.workspace.rememberSelection(this.getActiveTab(snapshot), {
            nodeIds: this.nodeIds,
            primaryNodeId: this.primaryNodeId,
        });
    }

    setNodeSelection(snapshot: EditorProjectSnapshot | null, nodeIds: string[], primaryNodeId = ""): void {
        this.selection = this.normalizeSelection(
            snapshot,
            this.packageId,
            this.componentId,
            nodeIds,
            primaryNodeId,
        );
        this.updateSelectionDebugState();
    }

    resolveCommandTargetSelection(
        snapshot: EditorProjectSnapshot,
        targets: ActiveDocumentCommandTarget[],
    ): ActiveDocumentSelection | null {
        if (targets.length === 0) return null;
        const current = this.normalizeSelection(
            snapshot,
            this.packageId,
            this.componentId,
            this.nodeIds,
            this.primaryNodeId,
        );
        const keepCurrent = this.nodeIds.length > 0
            && targets.every((target) => (
                target.packageId === this.packageId
                && target.componentResourceId === this.componentId
                && this.nodeIds.includes(target.displayNodeId)
            ))
            && current.nodeIds.length === this.nodeIds.length;
        if (keepCurrent) return current;

        const lastTarget = targets[targets.length - 1];
        const firstTarget = targets[0];
        const shareComponent = targets.length > 1 && targets.every((target) => (
            target.packageId === firstTarget.packageId
            && target.componentResourceId === firstTarget.componentResourceId
        ));
        const selectedTargets = shareComponent ? targets : [lastTarget];
        return this.normalizeSelection(
            snapshot,
            selectedTargets[0].packageId,
            selectedTargets[0].componentResourceId,
            selectedTargets.map((target) => target.displayNodeId),
            selectedTargets[selectedTargets.length - 1].displayNodeId,
        );
    }

    clearNodeSelection(): void {
        this.selection = {
            ...this.selection,
            primaryNodeId: "",
            nodeIds: [],
        };
        this.updateSelectionDebugState();
    }

    activate(snapshot: EditorProjectSnapshot | null, documentTab: DesktopDocumentTab): boolean {
        const pkg = snapshot?.packages.find((candidate) => candidate.id === documentTab.packageId);
        const component = pkg?.components.find((candidate) => candidate.id === documentTab.componentId);
        if (!snapshot || !pkg || !component) return false;
        this.rememberSelection(snapshot);
        this.workspace.open(documentTab);
        const selection = this.workspace.getSelection(documentTab);
        this.setActiveSelection(
            snapshot,
            pkg.id,
            component.id,
            selection?.nodeIds || [],
            selection?.primaryNodeId || "",
        );
        return true;
    }

    close(snapshot: EditorProjectSnapshot | null, documentTab: DesktopDocumentTab): DesktopDocumentTab | null {
        this.rememberSelection(snapshot);
        const activeDocument = this.workspace.close(documentTab, this.getActiveTab(snapshot));
        if (activeDocument) {
            const selection = this.workspace.getSelection(activeDocument);
            this.setActiveSelection(
                snapshot,
                activeDocument.packageId,
                activeDocument.componentId,
                selection?.nodeIds || [],
                selection?.primaryNodeId || "",
            );
        } else {
            this.setActiveSelection(snapshot, this.packageId, "");
        }
        return activeDocument;
    }

    cycle(snapshot: EditorProjectSnapshot | null, delta: number): DesktopDocumentTab | null {
        const target = this.workspace.cycle(this.getActiveTab(snapshot), delta);
        return target && this.activate(snapshot, target) ? target : null;
    }

    restore(snapshot: EditorProjectSnapshot, selection: PersistedEditorSelection): boolean {
        const selectedPackage = snapshot.packages.find((pkg) => pkg.id === selection.packageId);
        const selectedComponent = selectedPackage?.components.find(
            (component) => component.id === selection.componentId,
        );
        const activeDocument = this.workspace.restore(
            snapshot,
            selection.openDocuments || [],
            selection.groupPaths || [],
            selectedPackage && selectedComponent
                ? { packageId: selectedPackage.id, componentId: selectedComponent.id }
                : null,
        );
        if (!selectedPackage && !activeDocument) return false;
        if (!activeDocument) {
            if (selection.openDocuments === undefined) return false;
            this.setActiveSelection(snapshot, selectedPackage!.id, "");
            return true;
        }

        const activeComponent = snapshot.packages
            .find((pkg) => pkg.id === activeDocument.packageId)?.components
            .find((component) => component.id === activeDocument.componentId);
        if (!activeComponent) return false;
        this.setActiveSelection(
            snapshot,
            activeDocument.packageId,
            activeDocument.componentId,
            activeComponent.children.some((node) => node.id === selection.displayNodeId)
                ? [selection.displayNodeId]
                : [],
            selection.displayNodeId,
        );
        return true;
    }

    createPersistedSelection(
        snapshot: EditorProjectSnapshot | null,
    ): PersistedEditorSelection | null {
        const selectedPackage = this.getPackage(snapshot);
        const selectedComponent = this.getComponent(snapshot);
        if (!selectedPackage) return null;
        this.rememberSelection(snapshot);
        return {
            projectId: snapshot?.project.id || "",
            packageId: selectedPackage.id,
            componentId: selectedComponent?.id || "",
            displayNodeId: selectedComponent ? this.primaryNodeId : "",
            openDocuments: this.workspace.getOpenTabs(),
            groupPaths: this.workspace.getPersistedGroupPaths(),
        };
    }

    private updateSelectionDebugState(): void {
        this.setDebugAttribute("data-fairy-editor-selected-node-ids", this.nodeIds.join(","));
        this.setDebugAttribute("data-fairy-editor-selection-count", String(this.nodeIds.length));
    }

    private normalizeSelection(
        snapshot: EditorProjectSnapshot | null,
        packageId: string,
        componentId: string,
        nodeIds: string[],
        primaryNodeId: string,
    ): ActiveDocumentSelection {
        const pkg = snapshot?.packages.find((candidate) => candidate.id === packageId);
        const component = pkg?.components.find((candidate) => candidate.id === componentId);
        const validPackageId = pkg?.id || "";
        const validComponentId = component?.id || "";
        const documentTab = pkg && component
            ? { packageId: validPackageId, componentId: validComponentId }
            : null;
        const availableIds = new Set(component
            ? this.workspace.getScopedNodeIds(documentTab, component)
            : []);
        const survivingNodeIds = [...new Set(nodeIds)].filter((nodeId) => availableIds.has(nodeId));
        return {
            packageId: validPackageId,
            componentId: validComponentId,
            nodeIds: survivingNodeIds,
            primaryNodeId: primaryNodeId && survivingNodeIds.includes(primaryNodeId)
                ? primaryNodeId
                : survivingNodeIds[0] || "",
        };
    }
}
