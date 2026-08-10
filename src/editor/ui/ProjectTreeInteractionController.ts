import type { ProjectSnapshotComponent, ProjectSnapshotPackage } from "../model/ProjectSnapshot";
import { resolveDesktopHierarchyDropIndex } from "../runtime/DesktopHierarchyInteraction";
import { setOverflowText } from "./EditorFormControls";

export type LibraryItemData =
    | { kind: "package"; packageId: string }
    | { kind: "folder"; packageId: string; branch: string; path: string }
    | { kind: "resource"; packageId: string; resourceId: string }
    | { kind: "component"; packageId: string; componentId: string };

export type HierarchyItemData = {
    kind: "displayNode";
    componentId: string;
    nodeId: string;
    locked: boolean;
    hidden: boolean;
};

export type HierarchyDropTarget =
    | {
        kind: "reorder";
        componentId: string;
        targetIndex: number;
        indicator: { x: number; y: number; width: number; height: number };
    }
    | {
        kind: "reparent";
        componentId: string;
        targetIndex: number;
        indicator: { x: number; y: number; width: number; height: number };
    };

export interface HierarchyDragState {
    cell: fgui.GComponent;
    nodeId: string;
    sourceComponentId: string;
    sourceIndex: number;
    startX: number;
    startY: number;
    target: HierarchyDropTarget | null;
}

export interface LibraryDragState {
    cell: fgui.GComponent;
    data: Extract<LibraryItemData, { kind: "component" | "resource" }>;
    targetPackageId: string;
    targetComponentId: string;
    startX: number;
    startY: number;
    point: { x: number; y: number } | null;
}

export type ProjectTreeInteractionContext = {
    getSelectedPackageId(): string;
    getSelectedComponentId(): string;
    getSelectedPackage(): ProjectSnapshotPackage | null;
    getSelectedComponent(): ProjectSnapshotComponent | null;
    findResourceType(packageId: string, resourceId: string): string;
    isComponentExported(packageId: string, componentId: string): boolean;
    showLibraryContextMenu(cell: fgui.GComponent, data: LibraryItemData): void;
    showHierarchyContextMenu(cell: fgui.GComponent, data: HierarchyItemData): void;
    openLibraryItem(data: Extract<LibraryItemData, { kind: "component" | "resource" }>): void;
    resolveAuthoringDropPoint(stageX: number, stageY: number): { x: number; y: number } | null;
    selectHierarchyNode(data: HierarchyItemData): void;
    toggleHierarchyNodeLock(data: HierarchyItemData): void;
    toggleHierarchyNodeHidden(data: HierarchyItemData): void;
    applyLibraryDrop(state: LibraryDragState, point: { x: number; y: number }): Promise<void>;
    applyHierarchyDrop(state: HierarchyDragState, target: HierarchyDropTarget): Promise<void>;
    setDebugAttribute(name: string, value: string): void;
    setStatus(message: string): void;
};

export class ProjectTreeInteractionController {
    private readonly nodeLabels = new WeakMap<fgui.GTreeNode, string>();
    private readonly nodeIcons = new WeakMap<fgui.GTreeNode, { closed: string; open: string }>();
    private readonly dropIndicator = new fgui.GGraph();
    private hierarchyDragState: HierarchyDragState | null = null;
    private libraryDragState: LibraryDragState | null = null;

    constructor(
        private readonly mainView: fgui.GComponent,
        private readonly libraryList: fgui.GList,
        private readonly hierarchyTree: fgui.GTree,
        private readonly context: ProjectTreeInteractionContext,
    ) {
        this.dropIndicator.name = "desktopHierarchyDropIndicator";
        this.dropIndicator.touchable = false;
        this.dropIndicator.visible = false;
        mainView.addChild(this.dropIndicator);
    }

    setNodeLabel(node: fgui.GTreeNode, label: string): void {
        this.nodeLabels.set(node, label);
    }

    setNodeIcon(node: fgui.GTreeNode, closed: string, open = closed): void {
        this.nodeIcons.set(node, { closed, open });
    }

    resetTree(tree: fgui.GTree): void {
        tree.rootNode.removeChildren();
        tree.removeChildrenToPool();
        tree.treeNodeRender = (node, cell) => this.setCellLabel(cell, this.nodeLabels.get(node) || "");
    }

    configureLibraryTree(tree: fgui.GTree): void {
        this.resetLibrarySelection(tree);
        tree.treeNodeRender = (node, cell) => {
            this.setCellLabel(cell, this.nodeLabels.get(node) || "");
            const icon = this.nodeIcons.get(node);
            cell.icon = icon ? fgui.UIPackage.getItemURL("Builder", node.expanded ? icon.open : icon.closed) : "";
            this.configureLibraryCell(cell, node.data as LibraryItemData | null);
        };
    }

    configureHierarchyTree(tree: fgui.GTree): void {
        tree.treeNodeRender = (node, cell) => {
            this.setCellLabel(cell, this.nodeLabels.get(node) || "");
            const icon = this.nodeIcons.get(node);
            cell.icon = icon ? fgui.UIPackage.getItemURL("Builder", node.expanded ? icon.open : icon.closed) : "";
            cell.off(fgui.Events.DRAG_START, this, this.onHierarchyDragStart);
            cell.off(fgui.Events.DRAG_MOVE, this, this.onHierarchyDragMove);
            cell.off(fgui.Events.DRAG_END, this, this.onHierarchyDragEnd);
            cell.off(Laya.Event.RIGHT_MOUSE_DOWN, this, this.onHierarchyRightMouseDown);
            const data = node.data as HierarchyItemData | null;
            const status = cell.getChild("status")?.asButton;
            if (status) {
                status.offClick(this, this.onHierarchyStatusClick);
                status.changeStateOnClick = false;
                status.visible = Boolean(data);
                status.selected = data?.hidden === true;
                if (data) status.onClick(this, this.onHierarchyStatusClick, [cell]);
            }
            const lock = cell.getChild("lock")?.asButton;
            if (lock) {
                lock.offClick(this, this.onHierarchyLockClick);
                lock.changeStateOnClick = false;
                lock.visible = Boolean(data);
                lock.selected = data?.locked === true;
                if (data) lock.onClick(this, this.onHierarchyLockClick, [cell]);
            }
            cell.draggable = Boolean(data);
            if (data) cell.on(Laya.Event.RIGHT_MOUSE_DOWN, this, this.onHierarchyRightMouseDown, [cell]);
            if (!cell.draggable) return;
            cell.on(fgui.Events.DRAG_START, this, this.onHierarchyDragStart, [cell]);
            cell.on(fgui.Events.DRAG_MOVE, this, this.onHierarchyDragMove, [cell]);
            cell.on(fgui.Events.DRAG_END, this, this.onHierarchyDragEnd, [cell]);
        };
    }

    private onHierarchyRightMouseDown(cell: fgui.GComponent, event: Laya.Event): void {
        const data = cell.treeNode?.data as HierarchyItemData | null;
        if (!data) return;
        event.stopPropagation();
        this.context.selectHierarchyNode(data);
        this.context.showHierarchyContextMenu(cell, data);
    }

    private onHierarchyLockClick(cell: fgui.GComponent, event: Laya.Event): void {
        event.stopPropagation();
        const data = cell.treeNode?.data as HierarchyItemData | null;
        if (!data) return;
        this.context.selectHierarchyNode(data);
        this.context.toggleHierarchyNodeLock(data);
    }

    private onHierarchyStatusClick(cell: fgui.GComponent, event: Laya.Event): void {
        event.stopPropagation();
        const data = cell.treeNode?.data as HierarchyItemData | null;
        if (!data) return;
        this.context.selectHierarchyNode(data);
        this.context.toggleHierarchyNodeHidden(data);
    }

    dispose(): void {
        this.restoreDraggedCell(this.libraryDragState);
        this.restoreDraggedCell(this.hierarchyDragState);
        this.libraryDragState = null;
        this.hierarchyDragState = null;
        this.dropIndicator.removeFromParent();
        this.dropIndicator.dispose();
    }

    resetLibrarySelection(list: fgui.GList): void {
        list.selectionMode = fgui.ListSelectionMode.Multiple;
        list.clearSelection();
        // ponytail: frozen FairyGUI has no public selection-anchor reset; remove this cast when it does.
        (list as unknown as { _lastSelectedIndex: number })._lastSelectedIndex = -1;
    }

    configureLibraryCell(cell: fgui.GComponent, data: LibraryItemData | null): void {
        if (cell.text) this.setCellLabel(cell, cell.text);
        cell.off(fgui.Events.DRAG_START, this, this.onLibraryDragStart);
        cell.off(fgui.Events.DRAG_MOVE, this, this.onLibraryDragMove);
        cell.off(fgui.Events.DRAG_END, this, this.onLibraryDragEnd);
        cell.off(Laya.Event.RIGHT_MOUSE_DOWN, this, this.onLibraryRightMouseDown);
        cell.off(Laya.Event.DOUBLE_CLICK, this, this.onLibraryDoubleClick);
        const sign = cell.getChild("sign");
        if (sign) {
            const loader = sign.asLoader;
            loader.fill = fgui.LoaderFillType.Scale;
            loader.shrinkOnly = true;
            loader.url = data?.kind === "component"
                && this.context.isComponentExported(data.packageId, data.componentId)
                ? fgui.UIPackage.getItemURL("Builder", "bullet_red")
                : "";
        }
        if (data) cell.on(Laya.Event.RIGHT_MOUSE_DOWN, this, this.onLibraryRightMouseDown, [cell]);
        if (data?.kind === "component" || data?.kind === "resource") {
            cell.on(Laya.Event.DOUBLE_CLICK, this, this.onLibraryDoubleClick, [cell]);
        }
        cell.draggable = this.isPlaceableLibraryItem(data);
        if (!cell.draggable) return;
        cell.on(fgui.Events.DRAG_START, this, this.onLibraryDragStart, [cell]);
        cell.on(fgui.Events.DRAG_MOVE, this, this.onLibraryDragMove, [cell]);
        cell.on(fgui.Events.DRAG_END, this, this.onLibraryDragEnd, [cell]);
    }

    private setCellLabel(cell: fgui.GComponent, value: string): void {
        cell.text = value;
        cell.tooltips = value;
        const title = cell.getChild("title")?.asTextField;
        if (title) setOverflowText(title, value);
    }

    private isPlaceableLibraryItem(
        data: LibraryItemData | null,
    ): data is Extract<LibraryItemData, { kind: "component" | "resource" }> {
        const selectedComponentId = this.context.getSelectedComponentId();
        if (!data || data.kind === "package" || data.kind === "folder" || !selectedComponentId) return false;
        if (data.kind === "component") {
            return data.packageId !== this.context.getSelectedPackageId() || data.componentId !== selectedComponentId;
        }
        return ["ImageResource", "MovieClipResource"].includes(
            this.context.findResourceType(data.packageId, data.resourceId),
        );
    }

    private getLibraryCellData(cell: fgui.GComponent): LibraryItemData | null {
        return (cell.treeNode?.data || cell.data) as LibraryItemData | null;
    }

    private onLibraryRightMouseDown(cell: fgui.GComponent, event: Laya.Event): void {
        const data = this.getLibraryCellData(cell);
        if (!data) return;
        event.stopPropagation();
        this.context.showLibraryContextMenu(cell, data);
    }

    private onLibraryDoubleClick(cell: fgui.GComponent, event: Laya.Event): void {
        const data = this.getLibraryCellData(cell);
        if (data?.kind !== "component" && data?.kind !== "resource") return;
        event.stopPropagation();
        this.context.openLibraryItem(data);
    }

    private onLibraryDragStart(cell: fgui.GComponent, event: Laya.Event): void {
        const data = this.getLibraryCellData(cell);
        if (!this.isPlaceableLibraryItem(data)) return;
        event.stopPropagation();
        this.libraryDragState = {
            cell,
            data,
            targetPackageId: this.context.getSelectedPackageId(),
            targetComponentId: this.context.getSelectedComponentId(),
            startX: cell.x,
            startY: cell.y,
            point: null,
        };
        cell.alpha = 0.7;
        this.context.setDebugAttribute("data-fairy-editor-library-drag", "active");
        this.context.setStatus(`Dragging Library resource ${data.kind === "component" ? data.componentId : data.resourceId}.`);
    }

    private onLibraryDragMove(cell: fgui.GComponent, event: Laya.Event): void {
        const state = this.libraryDragState;
        if (!state || state.cell !== cell) return;
        event.stopPropagation();
        state.point = this.context.resolveAuthoringDropPoint(Laya.stage.mouseX, Laya.stage.mouseY);
        this.showLibraryDropIndicator(state.point, Laya.stage.mouseX, Laya.stage.mouseY);
    }

    private onLibraryDragEnd(cell: fgui.GComponent, event: Laya.Event): void {
        const state = this.libraryDragState;
        if (!state || state.cell !== cell) return;
        event.stopPropagation();
        const point = this.context.resolveAuthoringDropPoint(Laya.stage.mouseX, Laya.stage.mouseY) || state.point;
        this.libraryDragState = null;
        this.restoreDraggedCell(state);
        this.dropIndicator.visible = false;
        if (!point) {
            this.context.setDebugAttribute("data-fairy-editor-library-drag", "cancelled");
            this.context.setStatus("Library drag cancelled: drop inside the component canvas.");
            return;
        }
        void this.context.applyLibraryDrop(state, point);
    }

    private showLibraryDropIndicator(point: { x: number; y: number } | null, stageX: number, stageY: number): void {
        if (!point) {
            this.dropIndicator.visible = false;
            return;
        }
        const local = this.mainView.globalToLocal(stageX - 6, stageY - 6);
        this.dropIndicator.setXY(local.x, local.y);
        this.dropIndicator.setSize(12, 12);
        this.dropIndicator.drawRect(1, "#d8efff", "rgba(87,214,255,0.45)");
        this.showDropIndicator();
    }

    private onHierarchyDragStart(cell: fgui.GComponent, event: Laya.Event): void {
        const data = cell.treeNode?.data as HierarchyItemData | null;
        const component = this.context.getSelectedComponent();
        if (!data || !component) return;
        const sourceIndex = component.children.findIndex((node) => node.id === data.nodeId);
        if (sourceIndex < 0) return;
        event.stopPropagation();
        this.context.selectHierarchyNode(data);
        this.hierarchyDragState = {
            cell,
            nodeId: data.nodeId,
            sourceComponentId: data.componentId,
            sourceIndex,
            startX: cell.x,
            startY: cell.y,
            target: null,
        };
        cell.alpha = 0.7;
        this.context.setDebugAttribute("data-fairy-editor-hierarchy-drag", "active");
        this.context.setStatus(`Dragging hierarchy node ${data.nodeId}.`);
    }

    private onHierarchyDragMove(cell: fgui.GComponent): void {
        const state = this.hierarchyDragState;
        if (!state || state.cell !== cell) return;
        state.target = this.resolveHierarchyDropTarget(state, Laya.stage.mouseX, Laya.stage.mouseY);
        this.showHierarchyDropIndicator(state.target);
    }

    private onHierarchyDragEnd(cell: fgui.GComponent): void {
        const state = this.hierarchyDragState;
        if (!state || state.cell !== cell) return;
        const target = this.resolveHierarchyDropTarget(state, Laya.stage.mouseX, Laya.stage.mouseY) || state.target;
        this.hierarchyDragState = null;
        this.restoreDraggedCell(state);
        this.dropIndicator.visible = false;
        if (!target) {
            this.context.setDebugAttribute("data-fairy-editor-hierarchy-drag", "cancelled");
            this.context.setStatus(`Hierarchy drag cancelled for ${state.nodeId}.`);
            return;
        }
        void this.context.applyHierarchyDrop(state, target);
    }

    private resolveHierarchyDropTarget(
        state: HierarchyDragState,
        stageX: number,
        stageY: number,
    ): HierarchyDropTarget | null {
        for (let index = 0; index < this.libraryList.numChildren; index += 1) {
            const item = this.libraryList.getChildAt(index);
            const data = item.data as LibraryItemData | null;
            if (!data || data.kind !== "component") continue;
            const bounds = item.localToGlobalRect(0, 0, item.width, item.height);
            if (!this.pointInsideRect(stageX, stageY, bounds)) continue;
            const targetComponent = this.context.getSelectedPackage()?.components.find(
                (component) => component.id === data.componentId,
            );
            if (!targetComponent) return null;
            return {
                kind: "reparent",
                componentId: data.componentId,
                targetIndex: data.componentId === state.sourceComponentId
                    ? Math.max(0, targetComponent.children.length - 1)
                    : targetComponent.children.length,
                indicator: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
            };
        }

        const component = this.context.getSelectedComponent();
        const treeBounds = this.hierarchyTree.localToGlobalRect(0, 0, this.hierarchyTree.width, this.hierarchyTree.height);
        if (!component || !this.pointInsideRect(stageX, stageY, treeBounds)) return null;
        let closest: { targetIndex: number; after: boolean; bounds: Laya.Rectangle } | null = null;
        let closestDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < this.hierarchyTree.numChildren; index += 1) {
            const item = this.hierarchyTree.getChildAt(index);
            const data = item.treeNode?.data as HierarchyItemData | null;
            if (!data || data.nodeId === state.nodeId) continue;
            const targetIndex = component.children.findIndex((node) => node.id === data.nodeId);
            if (targetIndex < 0) continue;
            const bounds = item.localToGlobalRect(0, 0, item.width, item.height);
            const centerY = bounds.y + bounds.height / 2;
            const distance = Math.abs(stageY - centerY);
            if (distance >= closestDistance) continue;
            closestDistance = distance;
            closest = { targetIndex, after: stageY >= centerY, bounds };
        }
        if (!closest) return null;
        const targetIndex = resolveDesktopHierarchyDropIndex(
            state.sourceIndex,
            closest.targetIndex,
            closest.after,
            component.children.length,
        );
        if (targetIndex === null) return null;
        return {
            kind: "reorder",
            componentId: state.sourceComponentId,
            targetIndex,
            indicator: {
                x: treeBounds.x + 4,
                y: closest.bounds.y + (closest.after ? closest.bounds.height : 0) - 1,
                width: Math.max(1, treeBounds.width - 8),
                height: 2,
            },
        };
    }

    private pointInsideRect(x: number, y: number, rect: Laya.Rectangle): boolean {
        return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height;
    }

    private showHierarchyDropIndicator(target: HierarchyDropTarget | null): void {
        if (!target) {
            this.dropIndicator.visible = false;
            return;
        }
        const point = this.mainView.globalToLocal(target.indicator.x, target.indicator.y);
        this.dropIndicator.setXY(point.x, point.y);
        this.dropIndicator.setSize(target.indicator.width, target.indicator.height);
        this.dropIndicator.drawRect(
            target.kind === "reorder" ? 0 : 2,
            "#57d6ff",
            target.kind === "reorder" ? "#57d6ff" : "rgba(87,214,255,0.08)",
        );
        this.showDropIndicator();
    }

    private showDropIndicator(): void {
        this.dropIndicator.visible = true;
        this.mainView.setChildIndex(this.dropIndicator, this.mainView.numChildren - 1);
    }

    private restoreDraggedCell(state: { cell: fgui.GComponent; startX: number; startY: number } | null): void {
        if (!state) return;
        state.cell.alpha = 1;
        state.cell.setXY(state.startX, state.startY);
    }
}
