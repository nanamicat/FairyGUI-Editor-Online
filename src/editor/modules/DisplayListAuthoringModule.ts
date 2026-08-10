import {
    createDisplayNodeClipboard,
    getProjectResourceUrl,
    prepareAddPrimitiveDisplayNode,
    prepareAdjustDisplayNodeDepth,
    prepareDetachDisplayNodes,
    prepareGroupDisplayNodes,
    prepareMoveDisplayNode,
    preparePasteDisplayNodes,
    preparePlaceResourceDisplayNode,
    prepareRenameDisplayNode,
    prepareReplaceDisplayNodes,
    prepareUngroupDisplayNodes,
    type DisplayNodeClipboard,
    type HighRiskTransactionPreparation,
    type PrimitiveDisplayNodeKind,
} from "../commands/HighRiskAuthoringTransactions";
import { findDisplayNode, findResource } from "../commands/AuthoringTransactionSupport";
import { requestEditorTextInput } from "../dialogs/EditorDialogs";
import { showReplaceObjectDialog as openReplaceObjectDialog } from "../dialogs/ReplaceObjectDialog";
import type { EditorResourceSelector, SetDisplayNodePropsCommand } from "../model/EditorCommand";
import {
    ALIGN_TOOLBAR_ACTIONS,
    CUSTOM_ARRANGE_ACTIONS,
} from "../EditorShellConfig";
import {
    inferDesktopCanvasColumnCount,
    inferDesktopCanvasSpacing,
    resolveDesktopCanvasAlignment,
    resolveDesktopCanvasCustomArrange,
    type DesktopCanvasAlignmentMode,
    type DesktopCanvasCustomArrangeMode,
} from "../runtime/DesktopCanvasInteraction";
import type { RuntimePreviewNodeTransform } from "../runtime/RuntimePreviewController";
import type { BrowserLiveSessionIdentity } from "../services/BrowserLiveSessionBridge";
import type {
    HierarchyDragState,
    HierarchyDropTarget,
    HierarchyItemData,
    LibraryDragState,
} from "../ui/ProjectTreeInteractionController";
import { EditorCustomArrangePanel } from "../ui/EditorUiExtensions";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { AUTHORING_DIALOGS_SERVICE, EditorAuthoringDialogs } from "./AuthoringDialogsModule";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";
import { EditorProjectExplorer, PROJECT_EXPLORER_SERVICE } from "./ProjectExplorerModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const DISPLAY_LIST_AUTHORING_SERVICE = "fairygui.display-list-authoring";

export type DisplayListAuthoringEvents = {
    refreshSelectionViews(): void;
    refreshProjectViews(): void;
};

export class EditorDisplayListAuthoring {
    private events: DisplayListAuthoringEvents | null = null;
    private readonly inFlight = new Set<Promise<unknown>>();
    private readonly viewUnbinders: Array<() => void> = [];
    private unbindExplorerActions: (() => void) | null = null;
    private unbindSnapshotReset: (() => void) | null = null;
    private displayNodeClipboard: DisplayNodeClipboard | null = null;
    private customArrangePanel: EditorCustomArrangePanel | null = null;
    private customArrangeContext: {
        identity: BrowserLiveSessionIdentity;
        packageId: string;
        componentId: string;
        nodeIds: string[];
    } | null = null;
    private active = true;

    constructor(
        private readonly chrome: EditorShellChrome,
        private readonly session: EditorProjectSession,
        private readonly document: EditorDocumentAuthoring,
        private readonly explorer: EditorProjectExplorer,
        private readonly dialogs: EditorAuthoringDialogs,
    ) {}

    activate(): void {
        this.unbindExplorerActions = this.explorer.bindDisplayListActions({
            toggleHierarchyNodeLock: (data) => this.toggleHierarchyNodeLock(data),
            applyLibraryDrop: (state, point) => this.applyLibraryDrop(state, point),
            applyHierarchyDrop: (state, target) => this.applyHierarchyDrop(state, target),
        });
        this.unbindSnapshotReset = this.session.onDidResetSnapshot(() => {
            this.displayNodeClipboard = null;
        });

        this.listenClick(this.chrome.panels.hierarchy.getChild("lock"), this.toggleAllHierarchyLocks);
        this.listenClick(this.chrome.panels.hierarchy.getChild("rename"), this.showHierarchyRenameDialog);
        const objectToolbar = this.chrome.panels.document.getChild("objToolbar").asCom;
        this.listenClick(objectToolbar.getChild("group"), this.groupSelectedDisplayNodes);
        this.listenClick(objectToolbar.getChild("ungroup"), this.ungroupSelectedDisplayNodes);
        const alignToolbar = this.chrome.panels.document.getChild("alignToolbar").asCom;
        for (const action of ALIGN_TOOLBAR_ACTIONS) {
            this.listenClick(alignToolbar.getChild(action.childName), this.onAlignToolbarAction, [action.mode]);
        }
        for (const action of CUSTOM_ARRANGE_ACTIONS) {
            const button = alignToolbar.getChild(action.childName);
            this.listenClick(button, this.showCustomArrangePanel, [action.mode, button]);
        }
    }

    get canPaste(): boolean {
        return Boolean(this.displayNodeClipboard && this.document.getSelectedComponent());
    }

    bind(events: DisplayListAuthoringEvents): () => void {
        if (this.events) throw new Error("Display-list authoring events are already bound.");
        this.events = events;
        return () => {
            if (this.events === events) this.events = null;
        };
    }

    documentHasCanvasFocus(): boolean {
        return this.document.preview.hasCanvasFocus();
    }

    selectAllDisplayNodes(): void {
        const component = this.document.getSelectedComponent();
        if (!component) return;
        const nodeIds = this.document.getScopedNodeIds(component);
        this.document.setSelection(nodeIds, nodeIds[nodeIds.length - 1] || "");
        this.events?.refreshSelectionViews();
        this.chrome.setDebugAttribute("data-fairy-editor-document-selection", `all:${nodeIds.length}`);
        this.chrome.setStatus(`Selected all ${nodeIds.length} display nodes.`);
    }

    selectNoDisplayNodes(): void {
        this.document.clearSelection();
        this.events?.refreshSelectionViews();
        this.chrome.setDebugAttribute("data-fairy-editor-document-selection", "none");
        this.chrome.setStatus("Display-node selection cleared.");
    }

    async adjustSelectedDisplayNodeDepth(
        direction: "forward" | "backward" | "top" | "bottom",
    ): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        const selectedIds = this.document.nodeIds.slice();
        const primaryId = this.document.primaryNodeId;
        if (!selector || selectedIds.length === 0) return;
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        const preparation = prepareAdjustDisplayNodeDepth(
            this.session.liveSessionBridge.getWorkingProject(),
            selectedIds.map((displayNodeId) => ({ ...selector, displayNodeId })),
            direction,
        );
        if (!await this.applyPreparation(preparation, identity) || !this.active) return;
        this.restoreOperationSelection(selector, selectedIds, primaryId, false);
        this.chrome.setDebugAttribute("data-fairy-editor-document-depth", `${direction}:${selectedIds.join(",")}`);
        this.chrome.setStatus(
            `Moved ${selectedIds.length} display node${selectedIds.length === 1 ? "" : "s"} ${direction}; `
            + "Publish to update the runtime preview.",
        );
    }

    async groupSelectedDisplayNodes(): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        const selectedIds = this.document.nodeIds.slice();
        if (!selector) return;
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        const preparation = prepareGroupDisplayNodes(
            this.session.liveSessionBridge.getWorkingProject(),
            selectedIds.map((displayNodeId) => ({ ...selector, displayNodeId })),
        );
        if (!preparation.ok) {
            await this.applyPreparation(preparation, identity);
            this.chrome.setDebugAttribute("data-fairy-editor-object-group", `rejected:${preparation.code}`);
            return;
        }
        const attach = (preparation.transaction.operations || [preparation.transaction.operation])
            .find((operation) => operation.kind === "attachDisplayNode");
        const groupId = String((attach?.node as { id?: unknown } | undefined)?.id || "");
        if (!await this.applyPreparation(preparation, identity) || !this.active) return;
        this.restoreOperationSelection(selector, groupId ? [groupId] : [], groupId);
        this.chrome.setDebugAttribute("data-fairy-editor-object-group", `grouped:${groupId}:${selectedIds.length}`);
        this.chrome.setStatus(
            `Grouped ${selectedIds.length} display nodes as ${groupId}; `
            + "Publish to update the runtime preview.",
        );
    }

    async ungroupSelectedDisplayNodes(): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        if (!selector) return;
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        const preparation = prepareUngroupDisplayNodes(
            this.session.liveSessionBridge.getWorkingProject(),
            this.document.nodeIds.map((displayNodeId) => ({ ...selector, displayNodeId })),
        );
        if (!preparation.ok) {
            await this.applyPreparation(preparation, identity);
            this.chrome.setDebugAttribute("data-fairy-editor-object-group", `rejected:${preparation.code}`);
            return;
        }
        const memberIds = (preparation.transaction.operations || [preparation.transaction.operation])
            .flatMap((operation) => (
                operation.kind === "setDisplayNodeProps" && operation.props.group !== undefined
                    ? [operation.selector.displayNodeId]
                    : []
            ));
        if (!await this.applyPreparation(preparation, identity) || !this.active) return;
        const primaryId = memberIds[memberIds.length - 1] || "";
        this.restoreOperationSelection(selector, memberIds, primaryId);
        this.chrome.setDebugAttribute("data-fairy-editor-object-group", `ungrouped:${memberIds.join(",") || "empty"}`);
        this.chrome.setStatus("Ungrouped selection. Publish to update the runtime preview.");
    }

    async placeDesktopPrimitive(
        kind: PrimitiveDisplayNodeKind,
        point: { x: number; y: number },
    ): Promise<boolean> {
        const selector = this.getSelectedComponentSelector();
        if (!selector || !this.active) return false;
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        const preparation = prepareAddPrimitiveDisplayNode(
            this.session.liveSessionBridge.getWorkingProject(),
            selector,
            kind,
            point,
        );
        if (preparation.ok === false) return this.applyPreparation(preparation, identity);
        const operation = (preparation.transaction.operations || [preparation.transaction.operation])
            .find((candidate) => candidate.kind === "attachDisplayNode");
        const nodeId = String((operation?.node as { id?: unknown } | null)?.id || "");
        if (!await this.applyPreparation(preparation, identity) || !this.active) return false;
        this.restoreOperationSelection(selector, nodeId ? [nodeId] : [], nodeId);
        this.chrome.setDebugAttribute(
            "data-fairy-editor-object-create",
            `${kind}:${nodeId}@${point.x},${point.y}`,
        );
        this.chrome.setStatus(
            `Created ${kind} ${nodeId} at ${point.x},${point.y}; `
            + "Publish to update the runtime preview.",
        );
        return true;
    }

    async applyLibraryDrop(
        state: LibraryDragState,
        point: { x: number; y: number },
    ): Promise<void> {
        if (!this.active) return;
        const resourceId = state.data.kind === "component"
            ? state.data.componentId
            : state.data.resourceId;
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        const preparation = preparePlaceResourceDisplayNode(
            this.session.liveSessionBridge.getWorkingProject(),
            {
                packageId: state.targetPackageId,
                componentResourceId: state.targetComponentId,
            },
            { packageId: state.data.packageId, resourceId },
            point,
        );
        if (preparation.ok === false) {
            this.chrome.setDebugAttribute("data-fairy-editor-library-drag", "failed");
            await this.applyPreparation(preparation, identity);
            return;
        }
        const operation = (preparation.transaction.operations || [preparation.transaction.operation])
            .find((candidate) => candidate.kind === "attachDisplayNode");
        const nodeId = String((operation?.node as { id?: unknown } | null)?.id || "");

        this.document.setActiveSelection(state.targetPackageId, state.targetComponentId);
        this.explorer.library.clearInspectorSelection();
        if (!await this.applyPreparation(preparation, identity)) {
            this.chrome.setDebugAttribute("data-fairy-editor-library-drag", "failed");
            return;
        }
        if (!this.active) return;
        this.restoreOperationSelection(
            { packageId: state.targetPackageId, componentResourceId: state.targetComponentId },
            nodeId ? [nodeId] : [],
            nodeId,
        );
        this.chrome.setDebugAttribute("data-fairy-editor-library-drag", "placed");
        this.chrome.setDebugAttribute(
            "data-fairy-editor-library-drop",
            `${resourceId}:${nodeId}@${point.x},${point.y}`,
        );
        this.chrome.setStatus(
            `Placed ${resourceId} as ${nodeId} at ${point.x},${point.y}; `
            + "Publish to update the runtime preview.",
        );
    }

    showHierarchyRenameDialog(): void {
        if (!this.active) return;
        const node = this.document.getSelectedNode();
        const selector = this.document.getSelectedNodeSelector();
        if (!node || !selector || this.document.nodeIds.length !== 1) {
            this.chrome.setStatus("Select one display node to rename.");
            return;
        }
        const interactionIdentity = this.session.liveSessionBridge.captureSessionIdentity();
        const interactionProject = this.session.liveSessionBridge.getWorkingProject();
        const dialogController = this.dialogs.controller;
        void requestEditorTextInput(
            {
                getActiveDialog: () => dialogController.getActiveDialog(),
                setActiveDialog: (dialog) => dialogController.setActiveDialog(dialog),
                setStatus: (message) => this.chrome.setStatus(message),
                setDebugAttribute: (name, value) => this.chrome.setDebugAttribute(name, value),
                eventOwner: this,
            },
            "desktopHierarchyRenameDialog",
            "重命名",
            "输入显示对象名称",
            node.name || node.id,
            "重命名",
            (value) => value.trim() ? null : "名称不能为空。",
        ).then(async (value) => {
            if (!this.active) return;
            const newName = value?.trim();
            if (!newName || newName === node.name) return;
            const preparation = prepareRenameDisplayNode(
                interactionProject,
                selector,
                newName,
            );
            if (!await this.applyPreparation(preparation, interactionIdentity) || !this.active) return;
            this.document.setSelection([selector.displayNodeId], selector.displayNodeId);
            this.events?.refreshSelectionViews();
            this.chrome.setDebugAttribute("data-fairy-editor-hierarchy-rename", `${selector.displayNodeId}:${newName}`);
        });
    }

    toggleHierarchyNodeLock(data: HierarchyItemData): void {
        if (!this.active) return;
        const component = this.document.getSelectedComponent();
        const node = component?.children.find((candidate) => candidate.id === data.nodeId);
        if (!component || component.id !== data.componentId || !node) return;
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        void this.applyDisplayNodeCommands([{
            kind: "setDisplayNodeProps",
            selector: {
                packageId: this.document.packageId,
                componentResourceId: component.id,
                displayNodeId: node.id,
            },
            props: { locked: !node.locked },
        }], `${node.locked ? "Unlocked" : "Locked"} ${node.name || node.id}`, identity);
    }

    toggleAllHierarchyLocks(): void {
        if (!this.active) return;
        const component = this.document.getSelectedComponent();
        if (!component || component.children.length === 0) return;
        const locked = !component.children.some((node) => node.locked);
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        const commands = component.children
            .filter((node) => node.locked !== locked)
            .map<SetDisplayNodePropsCommand>((node) => ({
                kind: "setDisplayNodeProps",
                selector: {
                    packageId: this.document.packageId,
                    componentResourceId: component.id,
                    displayNodeId: node.id,
                },
                props: { locked },
            }));
        if (commands.length > 0) {
            void this.applyDisplayNodeCommands(
                commands,
                `${locked ? "Locked" : "Unlocked"} all display nodes`,
                identity,
            );
        }
    }

    async applyHierarchyDrop(
        state: HierarchyDragState,
        target: HierarchyDropTarget,
    ): Promise<void> {
        if (!this.active) return;
        const selectedPackage = this.document.getSelectedPackage();
        if (!selectedPackage) return;
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        const preparation = prepareMoveDisplayNode(
            this.session.liveSessionBridge.getWorkingProject(),
            {
                packageId: selectedPackage.id,
                componentResourceId: state.sourceComponentId,
                displayNodeId: state.nodeId,
            },
            target.componentId,
            target.targetIndex,
        );
        if (!await this.applyPreparation(preparation, identity)) {
            this.chrome.setDebugAttribute("data-fairy-editor-hierarchy-drag", "failed");
            return;
        }
        if (!this.active) return;
        this.document.setActiveSelection(
            selectedPackage.id,
            target.componentId,
            [state.nodeId],
            state.nodeId,
        );
        this.explorer.library.clearInspectorSelection();
        this.events?.refreshProjectViews();
        this.chrome.setDebugAttribute("data-fairy-editor-hierarchy-drag", target.kind);
        this.chrome.setDebugAttribute(
            "data-fairy-editor-hierarchy-drop",
            `${state.nodeId}:${target.componentId}@${target.targetIndex}`,
        );
        this.chrome.setStatus(
            `Hierarchy ${target.kind}: ${state.nodeId} to ${target.componentId}@${target.targetIndex}.`,
        );
    }

    showReplaceObjectDialog(): void {
        const owner = this.getSelectedComponentSelector();
        const selectedIds = this.document.nodeIds.slice();
        const primaryId = this.document.primaryNodeId;
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        if (!owner || selectedIds.length === 0 || !identity) {
            this.chrome.setStatus("Replace requires at least one selected display node.");
            return;
        }
        const project = this.session.liveSessionBridge.getWorkingProject();
        const selectedLibraryTarget = this.explorer.library.resourceSelectors.length === 1
            ? this.explorer.library.resourceSelectors[0]
            : null;
        const selectedLibraryResource = selectedLibraryTarget
            ? findResource(project, selectedLibraryTarget)
            : null;
        const initialTarget = selectedLibraryTarget
            && ["image", "component", "movieClip"].includes(String(selectedLibraryResource?.kind || ""))
            ? getProjectResourceUrl(selectedLibraryTarget)
            : "text";
        const dialogController = this.dialogs.controller;
        openReplaceObjectDialog(
            {
                getActiveDialog: () => dialogController.getActiveDialog(),
                setActiveDialog: (dialog) => dialogController.setActiveDialog(dialog),
                setStatus: (message, kind) => this.chrome.setStatus(message, kind),
                setDebugAttribute: (name, value) => this.chrome.setDebugAttribute(name, value),
                eventOwner: this,
            },
            project,
            initialTarget,
            selectedIds.length,
            (target) => {
                if (!this.active || !this.session.liveSessionBridge.isSessionIdentityCurrent(identity)) {
                    this.chrome.setStatus(
                        "Replace cancelled because the project changed while the dialog was open.",
                        "warning",
                    );
                    return;
                }
                const preparation = prepareReplaceDisplayNodes(
                    this.session.liveSessionBridge.getWorkingProject(),
                    selectedIds.map((displayNodeId) => ({ ...owner, displayNodeId })),
                    target,
                );
                void this.finishReplace(preparation, identity, owner, selectedIds, primaryId, target);
            },
        );
    }

    copySelectedDisplayNodes(): boolean {
        const owner = this.getSelectedComponentSelector();
        if (!owner || this.document.nodeIds.length === 0) {
            this.chrome.setStatus("Copy skipped: no display node selected.");
            return false;
        }
        const preparation = createDisplayNodeClipboard(
            this.session.liveSessionBridge.getWorkingProject(),
            this.document.nodeIds.map((displayNodeId) => ({ ...owner, displayNodeId })),
        );
        if (preparation.ok === false) {
            this.chrome.setStatus(`Copy unavailable: ${preparation.code}. ${preparation.message}`);
            return false;
        }
        this.displayNodeClipboard = preparation.clipboard;
        this.chrome.setDebugAttribute(
            "data-fairy-editor-display-node-clipboard",
            `${preparation.clipboard.packageId}/${preparation.clipboard.componentResourceId}:${preparation.clipboard.nodes.length}`,
        );
        this.chrome.setStatus(
            `Copied ${preparation.clipboard.nodes.length} display node${preparation.clipboard.nodes.length === 1 ? "" : "s"}.`,
        );
        return true;
    }

    cutSelectedDisplayNodes(): void {
        if (this.copySelectedDisplayNodes()) void this.deleteSelectedDisplayNodes();
    }

    async pasteDisplayNodes(
        clipboard: DisplayNodeClipboard | null = this.displayNodeClipboard,
        pastTense = "Pasted",
        debugAttribute = "data-fairy-editor-display-node-paste",
    ): Promise<void> {
        const target = this.getSelectedComponentSelector();
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        if (!target || !clipboard || !identity) {
            this.chrome.setStatus("Paste skipped: select a target component after copying display nodes.");
            return;
        }
        const preparation = preparePasteDisplayNodes(
            this.session.liveSessionBridge.getWorkingProject(),
            target,
            clipboard,
        );
        if (preparation.ok === false) {
            this.chrome.setStatus(`Paste unavailable: ${preparation.code}. ${preparation.message}`);
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
        if (!await this.applyPreparation(preparation, identity) || !this.active) return;
        this.restoreOperationSelection(
            target,
            pastedNodeIds,
            pastedNodeIds[pastedNodeIds.length - 1] || "",
        );
        this.chrome.setDebugAttribute(debugAttribute, pastedNodeIds.join(","));
        this.chrome.setStatus(
            `${pastTense} ${pastedNodeIds.length} display node${pastedNodeIds.length === 1 ? "" : "s"} `
            + "Canvas updated. Publish to update the runtime preview.",
        );
    }

    async duplicateSelectedDisplayNodes(): Promise<void> {
        const owner = this.getSelectedComponentSelector();
        if (!owner || this.document.nodeIds.length === 0) return;
        const copied = createDisplayNodeClipboard(
            this.session.liveSessionBridge.getWorkingProject(),
            this.document.nodeIds.map((displayNodeId) => ({ ...owner, displayNodeId })),
        );
        if (copied.ok === false) {
            this.chrome.setStatus(`Duplicate unavailable: ${copied.code}. ${copied.message}`);
            return;
        }
        await this.pasteDisplayNodes(
            copied.clipboard,
            "Duplicated",
            "data-fairy-editor-display-node-duplicate",
        );
    }

    async applySelectedNodeSourceSize(): Promise<void> {
        const owner = this.getSelectedComponentSelector();
        const selectedNode = this.document.getSelectedNode();
        if (!owner || !selectedNode) {
            this.chrome.setStatus("Source size requires one resource-backed display node.");
            return;
        }
        const liveNode = findDisplayNode(this.session.liveSessionBridge.getWorkingProject(), {
            ...owner,
            displayNodeId: selectedNode.id,
        });
        const resourceId = String(liveNode?.resource?.resourceId || "");
        if (!resourceId) {
            this.chrome.setStatus("Source size requires one resource-backed display node.");
            return;
        }
        const packageId = String(liveNode?.resource?.packageId || owner.packageId);
        const pkg = this.session.snapshot?.packages.find((candidate) => candidate.id === packageId);
        const resource = pkg?.resources.find((candidate) => candidate.id === resourceId);
        const component = pkg?.components.find((candidate) => candidate.id === resourceId);
        const width = resource?.width ?? component?.width;
        const height = resource?.height ?? component?.height;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width! <= 0 || height! <= 0) {
            this.chrome.setStatus("Source size is unavailable for the selected resource.");
            return;
        }
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        if (!identity) return;
        await this.applyDisplayNodeCommands([{
            kind: "setDisplayNodeProps",
            selector: { ...owner, displayNodeId: selectedNode.id },
            props: { size: { width: width!, height: height! } },
        }], `source size ${selectedNode.id}`, identity);
    }

    async deleteSelectedDisplayNodes(): Promise<void> {
        const owner = this.getSelectedComponentSelector();
        const deletedIds = this.document.nodeIds.slice();
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        if (!owner || deletedIds.length === 0 || !identity) return;
        const preparation = prepareDetachDisplayNodes(
            this.session.liveSessionBridge.getWorkingProject(),
            deletedIds.map((displayNodeId) => ({ ...owner, displayNodeId })),
        );
        if (!await this.applyPreparation(preparation, identity) || !this.active) return;
        this.chrome.setDebugAttribute("data-fairy-editor-display-node-delete", deletedIds.join(","));
        this.chrome.setStatus(
            `Deleted ${deletedIds.length} display node${deletedIds.length === 1 ? "" : "s"} `
            + "Canvas updated. Publish to update the runtime preview.",
        );
    }

    onAlignToolbarAction(mode: DesktopCanvasAlignmentMode): void {
        const selectedIds = this.document.nodeIds.slice();
        const minimum = mode === "distributeX" || mode === "distributeY" ? 3 : 2;
        if (selectedIds.length < minimum) {
            this.chrome.setStatus(`Canvas ${mode} requires at least ${minimum} selected nodes.`);
            return;
        }
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        const owner = this.getSelectedComponentSelector();
        if (!identity || !owner) return;
        void this.applySelectionTransform(identity, owner, selectedIds, () => {
            const selectedNodes = this.document.getSelectedNodes();
            return resolveDesktopCanvasAlignment(
                selectedNodes.map((node) => ({
                    id: node.id,
                    x: node.x,
                    y: node.y,
                    width: node.width,
                    height: node.height,
                })),
                mode,
                this.document.primaryNodeId,
            ).map((node) => ({ ...node, nodeId: node.id }));
        }, `align ${mode}`, "data-fairy-editor-canvas-align", (transforms) => (
            `${mode}:${transforms.map((node) => (
                `${node.nodeId}@${node.x},${node.y}/${node.width}x${node.height}`
            )).join("|")}`
        ));
    }

    showCustomArrangePanel(mode: DesktopCanvasCustomArrangeMode, anchor: fgui.GObject): void {
        const selectedNodes = this.document.getSelectedNodes();
        const identity = this.session.liveSessionBridge.captureSessionIdentity();
        const owner = this.getSelectedComponentSelector();
        if (selectedNodes.length < 2 || !identity || !owner) {
            this.chrome.setStatus(`Canvas ${mode} arrange requires at least 2 selected nodes.`);
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
        this.customArrangePanel.setOptions(mode, {
            lineSpacing: inferDesktopCanvasSpacing(items, "y"),
            columnSpacing: inferDesktopCanvasSpacing(items, "x"),
            columnCount: inferDesktopCanvasColumnCount(items),
        });
        this.customArrangeContext = {
            identity,
            packageId: owner.packageId,
            componentId: owner.componentResourceId,
            nodeIds: selectedNodes.map((node) => node.id),
        };
        fgui.GRoot.inst.showPopup(this.customArrangePanel, anchor);
        this.chrome.setDebugAttribute("data-fairy-editor-canvas-arrange-panel", mode);
        this.chrome.setStatus(`Canvas ${mode} arrange options opened.`);
    }

    applyCustomArrange(): void {
        const panel = this.customArrangePanel;
        const context = this.customArrangeContext;
        if (!panel || !context) return;
        const mode = panel.mode;
        const options = panel.readOptions();
        if (!options) {
            this.chrome.setStatus("Canvas arrange requires integer spacing and a positive column count.");
            return;
        }
        fgui.GRoot.inst.hidePopup(panel);
        void this.applySelectionTransform(
            context.identity,
            { packageId: context.packageId, componentResourceId: context.componentId },
            context.nodeIds,
            () => resolveDesktopCanvasCustomArrange(
                this.document.getSelectedNodes().map((node) => ({
                    id: node.id,
                    x: node.x,
                    y: node.y,
                    width: node.width,
                    height: node.height,
                })),
                mode,
                options,
            ).map((node) => ({ ...node, nodeId: node.id })),
            `arrange ${mode}`,
            "data-fairy-editor-canvas-arrange",
            (transforms) => (
                `${mode}:${options.columnCount},${options.columnSpacing},${options.lineSpacing}:`
                + transforms.map((node) => `${node.nodeId}@${node.x},${node.y}`).join("|")
            ),
        );
    }

    async dispose(): Promise<void> {
        if (!this.active) return;
        this.active = false;
        this.events = null;
        for (const unbind of this.viewUnbinders.splice(0).reverse()) unbind();
        this.unbindExplorerActions?.();
        this.unbindExplorerActions = null;
        this.unbindSnapshotReset?.();
        this.unbindSnapshotReset = null;
        this.displayNodeClipboard = null;
        this.customArrangeContext = null;
        if (this.customArrangePanel) fgui.GRoot.inst.hidePopup(this.customArrangePanel);
        this.customArrangePanel?.dispose();
        this.customArrangePanel = null;
        this.closeOwnedDialog("desktopHierarchyRenameDialog");
        this.closeOwnedDialog("desktopReplaceObjectDialog");
        await Promise.allSettled([...this.inFlight]);
    }

    private applyPreparation(
        preparation: HighRiskTransactionPreparation,
        identity: BrowserLiveSessionIdentity | null,
    ): Promise<boolean> {
        if (!this.active) return Promise.resolve(false);
        return this.track(this.session.runExclusive(async () => {
            try {
                const outcome = await this.session.applyPreparationNow(preparation, identity);
                if (outcome.kind === "unavailable") {
                    if (this.active) this.chrome.setStatus(
                        `Operation unavailable: ${outcome.preparation.code}. ${outcome.preparation.message}`,
                    );
                    return false;
                }
                if (outcome.kind === "stale") {
                    if (this.active) this.chrome.setStatus(
                        "Operation cancelled because the project changed while it was queued. Retry the action.",
                        "warning",
                    );
                    return false;
                }
                if (!outcome.result.ok) {
                    if (this.active) this.chrome.setStatus(
                        `Operation failed: ${outcome.result.error?.code || "unknown_error"}.`,
                        "error",
                    );
                    return false;
                }
                if (this.active) this.chrome.setStatus(`${outcome.summary}.`);
                return true;
            } catch (error) {
                if (this.active) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.chrome.setStatus(`Operation failed: ${message}`, "error");
                    console.error("[Display List] apply failed", error);
                }
                return false;
            }
        }));
    }

    private async finishReplace(
        preparation: HighRiskTransactionPreparation,
        identity: BrowserLiveSessionIdentity,
        owner: { packageId: string; componentResourceId: string },
        selectedIds: string[],
        primaryId: string,
        target: PrimitiveDisplayNodeKind | EditorResourceSelector,
    ): Promise<void> {
        if (!await this.applyPreparation(preparation, identity) || !this.active) return;
        this.restoreOperationSelection(
            owner,
            selectedIds,
            selectedIds.includes(primaryId) ? primaryId : selectedIds[selectedIds.length - 1] || "",
        );
        const targetLabel = typeof target === "string" ? target : getProjectResourceUrl(target);
        this.chrome.setDebugAttribute(
            "data-fairy-editor-display-node-replace",
            `${selectedIds.join(",")}->${targetLabel}`,
        );
        this.chrome.setStatus(
            `Replaced ${selectedIds.length} display node${selectedIds.length === 1 ? "" : "s"} with ${targetLabel}; `
            + "Publish to update the runtime preview.",
        );
    }

    private applySelectionTransform(
        identity: BrowserLiveSessionIdentity,
        owner: { packageId: string; componentResourceId: string },
        selectedIds: string[],
        resolve: () => RuntimePreviewNodeTransform[],
        summary: string,
        debugAttribute: string,
        getDebugValue: (transforms: RuntimePreviewNodeTransform[]) => string,
    ): Promise<boolean> {
        return this.track(this.session.runExclusive(async () => {
            const current = this.getSelectedComponentSelector();
            if (
                !this.active
                || !this.session.liveSessionBridge.isSessionIdentityCurrent(identity)
                || current?.packageId !== owner.packageId
                || current.componentResourceId !== owner.componentResourceId
                || !this.sameSelection(selectedIds, this.document.nodeIds)
            ) {
                if (this.active) this.chrome.setStatus(
                    "Arrange cancelled because the project or selection changed.",
                    "warning",
                );
                return false;
            }
            const transforms = resolve();
            if (transforms.length !== selectedIds.length) return false;
            const applied = await this.document.applyTransforms(transforms, summary);
            if (applied && this.active) this.chrome.setDebugAttribute(debugAttribute, getDebugValue(transforms));
            return applied;
        }));
    }

    private applyDisplayNodeCommands(
        commands: SetDisplayNodePropsCommand[],
        summary: string,
        identity: BrowserLiveSessionIdentity | null,
    ): Promise<boolean> {
        if (!this.active) return Promise.resolve(false);
        return this.track(this.session.runExclusive(async () => {
            try {
                if (!identity || !this.session.liveSessionBridge.isSessionIdentityCurrent(identity)) {
                    if (this.active) this.chrome.setStatus(
                        "Command cancelled because the project changed while it was queued. Retry the action.",
                        "warning",
                    );
                    return false;
                }
                const { result } = await this.session.applyDisplayNodePropsNow(commands, summary);
                if (!result.ok) {
                    if (this.active) this.chrome.setStatus(
                        `Command failed: ${result.error?.code || "unknown_error"}.`,
                        "error",
                    );
                    return false;
                }
                if (this.active) this.chrome.setStatus(`${summary}.`);
                return true;
            } catch (error) {
                if (this.active) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.chrome.setStatus(`Command failed: ${message}`, "error");
                    console.error("[Display List] command failed", error);
                }
                return false;
            }
        }));
    }

    private track<T>(promise: Promise<T>): Promise<T> {
        this.inFlight.add(promise);
        void promise.then(
            () => this.inFlight.delete(promise),
            () => this.inFlight.delete(promise),
        );
        return promise;
    }

    private listenClick(
        target: fgui.GObject,
        listener: (...args: any[]) => unknown,
        args?: any[],
    ): void {
        target.onClick(this, listener, args);
        this.viewUnbinders.push(() => target.offClick(this, listener));
    }

    private sameSelection(left: string[], right: string[]): boolean {
        return left.length === right.length && left.every((nodeId) => right.includes(nodeId));
    }

    private restoreOperationSelection(
        owner: { packageId: string; componentResourceId: string },
        nodeIds: string[],
        primaryNodeId: string,
        refreshWhenUnchanged = true,
    ): void {
        const current = this.getSelectedComponentSelector();
        const switched = current?.packageId !== owner.packageId
            || current.componentResourceId !== owner.componentResourceId;
        this.document.setActiveSelection(
            owner.packageId,
            owner.componentResourceId,
            nodeIds,
            primaryNodeId,
        );
        if (switched) this.events?.refreshProjectViews();
        else if (refreshWhenUnchanged) this.events?.refreshSelectionViews();
    }

    private closeOwnedDialog(name: string): void {
        const dialog = this.dialogs.controller.getActiveDialog();
        if (!dialog || dialog.name !== name) return;
        this.dialogs.controller.setActiveDialog(null);
        dialog.hide();
        dialog.dispose();
    }

    private getSelectedComponentSelector(): { packageId: string; componentResourceId: string } | null {
        const tab = this.document.getActiveTab();
        return tab ? { packageId: tab.packageId, componentResourceId: tab.componentId } : null;
    }
}

export function createDisplayListAuthoringModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: DISPLAY_LIST_AUTHORING_SERVICE,
        hotReloadable: false,
        activate(context) {
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const displayList = new EditorDisplayListAuthoring(
                chrome,
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
                context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE),
                context.requireService<EditorProjectExplorer>(PROJECT_EXPLORER_SERVICE),
                context.requireService<EditorAuthoringDialogs>(AUTHORING_DIALOGS_SERVICE),
            );
            context.onDeactivate(() => displayList.dispose());
            context.provideService(DISPLAY_LIST_AUTHORING_SERVICE, displayList);
            displayList.activate();
            context.onDeactivate(chrome.registerActions(["cut"], () => displayList.cutSelectedDisplayNodes()));
            context.onDeactivate(chrome.registerActions(["copy"], () => displayList.copySelectedDisplayNodes()));
            context.onDeactivate(chrome.registerActions(["paste"], () => { void displayList.pasteDisplayNodes(); }));
            context.onDeactivate(chrome.registerActions(["selectAll"], () => {
                if (displayList.documentHasCanvasFocus()) displayList.selectAllDisplayNodes();
            }));
            context.onDeactivate(chrome.registerActions(["selectNone"], () => {
                if (displayList.documentHasCanvasFocus()) displayList.selectNoDisplayNodes();
            }));
            context.onDeactivate(chrome.registerActions(["group"], () => {
                if (displayList.documentHasCanvasFocus()) void displayList.groupSelectedDisplayNodes();
            }));
            context.onDeactivate(chrome.registerActions(["ungroup"], () => {
                if (displayList.documentHasCanvasFocus()) void displayList.ungroupSelectedDisplayNodes();
            }));
            context.onDeactivate(chrome.registerActions(["moveForward"], () => {
                if (displayList.documentHasCanvasFocus()) void displayList.adjustSelectedDisplayNodeDepth("forward");
            }));
            context.onDeactivate(chrome.registerActions(["moveBackward"], () => {
                if (displayList.documentHasCanvasFocus()) void displayList.adjustSelectedDisplayNodeDepth("backward");
            }));
        },
    };
}
