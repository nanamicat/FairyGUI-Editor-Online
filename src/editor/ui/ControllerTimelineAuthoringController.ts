import {
    createTransitionItemModel,
    getControllerModel,
    getTransitionItemModel,
    getTransitionModel,
    inspectComponent,
    prepareAddController,
    prepareCreateController,
    prepareAddTransition,
    prepareCreateTransition,
    prepareDuplicateTransitionItem,
    prepareRemoveController,
    prepareRemoveTransition,
    prepareRemoveTransitionItem,
    prepareRenameTransition,
    prepareUpdateController,
    prepareUpdateTransition,
    prepareUpdateTransitionItemTiming,
    type HighRiskTransactionPreparation,
    type TransitionItemModel,
} from "../commands/HighRiskAuthoringTransactions";
import type { EditorComponentSelector } from "../model/EditorCommand";
import type { ProjectSnapshotComponent } from "../model/ProjectSnapshot";
import type { RuntimePreviewController } from "../runtime/RuntimePreviewController";
import type {
    BrowserLiveSessionBridge,
    BrowserLiveSessionIdentity,
} from "../services/BrowserLiveSessionBridge";
import type { AuthoringDialogController } from "./AuthoringDialogController";
import { setActionEnabled } from "./EditorFormControls";
import {
    TimelinePanelController,
    type TimelineModel,
    type TimelineTimingChange,
    type TimelineTransitionData,
} from "./TimelinePanelController";

type ControllerPanelItemData =
    | { kind: "controller"; name: string; selectedIndex: number; pageCount: number }
    | { kind: "edit"; sourceName: string }
    | { kind: "create" }
    | { kind: "duplicate"; sourceName: string };

interface ControllerTimelineAuthoringOptions {
    documentView: fgui.GComponent;
    transitionListView: fgui.GComponent;
    timelineView: fgui.GComponent;
    liveSessionBridge: BrowserLiveSessionBridge;
    runtimePreview: RuntimePreviewController;
    dialogs: AuthoringDialogController;
    isLiveSession: () => boolean;
    getSelectedComponentSelector: () => EditorComponentSelector | null;
    getSelectedComponent: () => ProjectSnapshotComponent | null;
    getSelectedDisplayNodeId: () => string;
    applyPreparation: (
        preparation: HighRiskTransactionPreparation,
        identity?: BrowserLiveSessionIdentity | null,
    ) => Promise<boolean>;
    getTimelineVisible: () => boolean;
    setTimelineVisible: (visible: boolean) => void;
    setConsoleVisible: (visible: boolean) => void;
    getLeftDockVisible: () => boolean;
    setLeftDockVisible: (visible: boolean) => void;
    setLeftTopPanelMode: (mode: "transition") => void;
    showEditorWorkspace: () => void;
    layout: () => void;
    saveLayout: () => void;
    setStatus: (message: string) => void;
    setDebugAttribute: (name: string, value: string) => void;
}

export class ControllerTimelineAuthoringController {
    selectedControllerName = "";
    selectedTransitionName = "";

    private readonly panels: { document: fgui.GComponent };
    private readonly transitionListView: fgui.GComponent;
    private readonly liveSessionBridge: BrowserLiveSessionBridge;
    private readonly runtimePreview: RuntimePreviewController;
    private readonly authoringDialogs: AuthoringDialogController;
    private readonly timelinePanel: TimelinePanelController;

    constructor(private readonly options: ControllerTimelineAuthoringOptions) {
        this.panels = { document: options.documentView };
        this.transitionListView = options.transitionListView;
        this.liveSessionBridge = options.liveSessionBridge;
        this.runtimePreview = options.runtimePreview;
        this.authoringDialogs = options.dialogs;
        this.timelinePanel = new TimelinePanelController(options.timelineView, {
            onAdd: () => this.showAddTimelineItemEditor(),
            onEdit: () => this.showSelectedTimelineItemEditor(),
            onRemove: () => void this.removeSelectedTimelineItem(),
            onSelection: () => this.populateTimeline(),
            onTimingChange: (change) => void this.applyTimelineItemTiming(change),
            setDebugAttribute: options.setDebugAttribute,
            setStatus: options.setStatus,
        });
        options.documentView.getChild("editingTransBar").onClick(this, this.onEditingTransitionBarClick);
        this.transitionListView.getChild("list").on(
            fgui.Events.CLICK_ITEM,
            this,
            this.onTransitionListItemClick,
        );
        this.transitionListView.getChild("add").onClick(this, this.createTransitionFromList);
        this.transitionListView.getChild("rename").onClick(this, this.renameTransitionFromList);
        this.transitionListView.getChild("duplicate").onClick(this, this.duplicateTransitionFromList);
        this.transitionListView.getChild("delete").onClick(this, this.removeTransitionFromList);
    }

    dispose(): void {
        this.timelinePanel.dispose();
        this.options.documentView.getChild("editingTransBar").offClick(this, this.onEditingTransitionBarClick);
        const transitionList = this.transitionListView.getChild("list").asList;
        transitionList.off(
            fgui.Events.CLICK_ITEM,
            this,
            this.onTransitionListItemClick,
        );
        this.transitionListView.getChild("add").offClick(this, this.createTransitionFromList);
        this.transitionListView.getChild("rename").offClick(this, this.renameTransitionFromList);
        this.transitionListView.getChild("duplicate").offClick(this, this.duplicateTransitionFromList);
        this.transitionListView.getChild("delete").offClick(this, this.removeTransitionFromList);
        transitionList.removeChildrenToPool();
        transitionList.itemPool.clear();
        const controllerList = this.options.documentView.getChild("controllerPanel").asCom.getChild("list").asList;
        controllerList.removeChildrenToPool();
        controllerList.itemPool.clear();
    }
    getSelectedTimelineItemIndex(): number { return this.timelinePanel.getSelectedItemIndex(); }
    setSelectedTimelineItemIndex(index: number): void { this.timelinePanel.setSelectedItemIndex(index); }
    setKeyboardActive(active: boolean): void { this.timelinePanel.setKeyboardActive(active); }

    private get selectedDisplayNodeId(): string { return this.options.getSelectedDisplayNodeId(); }
    private get timelineVisible(): boolean { return this.options.getTimelineVisible(); }
    private set timelineVisible(visible: boolean) { this.options.setTimelineVisible(visible); }
    private set consoleVisible(visible: boolean) { this.options.setConsoleVisible(visible); }
    private get leftDockVisible(): boolean { return this.options.getLeftDockVisible(); }
    private set leftDockVisible(visible: boolean) { this.options.setLeftDockVisible(visible); }
    private set leftTopPanelMode(mode: "transition") { this.options.setLeftTopPanelMode(mode); }
    private getSelectedComponentSelector(): EditorComponentSelector | null {
        return this.options.getSelectedComponentSelector();
    }
    private getSelectedComponent(): ProjectSnapshotComponent | null { return this.options.getSelectedComponent(); }
    private applyAuthoringPreparation(
        preparation: HighRiskTransactionPreparation,
        identity?: BrowserLiveSessionIdentity | null,
    ): Promise<boolean> {
        return this.options.applyPreparation(preparation, identity);
    }
    private showEditorWorkspace(): void { this.options.showEditorWorkspace(); }
    private layout(): void { this.options.layout(); }
    private saveDesktopLayoutState(): void { this.options.saveLayout(); }
    private setStatus(message: string): void { this.options.setStatus(message); }
    private setDebugAttribute(name: string, value: string): void { this.options.setDebugAttribute(name, value); }
    private setActionEnabled(item: fgui.GButton, enabled: boolean): void { setActionEnabled(item, enabled); }
    populateControllerPanel(): void {
        const list = this.panels.document.getChild("controllerPanel").asCom.getChild("list").asList;
        list.removeChildrenToPool();
        const selector = this.getSelectedComponentSelector();
        const inspection = selector
            ? inspectComponent(this.liveSessionBridge.getWorkingProject(), selector)
            : null;
        const controllers = inspection?.controllers || [];
        const liveSession = this.options.isLiveSession();
        if (!controllers.some((controller) => controller.name === this.selectedControllerName)) {
            this.selectedControllerName = controllers[0]?.name || "";
        }

        for (const controller of controllers) {
            const item = list.addItemFromPool().asButton;
            item.title = `${controller.name} ${controller.selectedIndex + 1}/${controller.pageCount}`;
            item.setSize(Math.max(82, item.title.length * 7 + 26), 23);
            item.enabled = liveSession;
            item.selected = controller.name === this.selectedControllerName;
            item.tooltips = "Click to switch to the next controller page.";
            item.data = {
                kind: "controller",
                name: controller.name,
                selectedIndex: controller.selectedIndex,
                pageCount: controller.pageCount,
            } satisfies ControllerPanelItemData;
            item.offClick(this, this.onControllerPanelItemClick);
            item.onClick(this, this.onControllerPanelItemClick, [item]);
        }

        const sourceName = this.selectedControllerName || controllers[0]?.name || "";
        if (sourceName) {
            const edit = list.addItemFromPool().asButton;
            edit.title = "Edit...";
            edit.setSize(58, 23);
            edit.enabled = liveSession;
            edit.tooltips = "Edit controller pages and actions.";
            edit.data = { kind: "edit", sourceName } satisfies ControllerPanelItemData;
            edit.offClick(this, this.onControllerPanelItemClick);
            edit.onClick(this, this.onControllerPanelItemClick, [edit]);
        }
        const add = list.addItemFromPool().asButton;
        add.title = controllers.length > 0 ? "+ Controller" : "+ Controller";
        add.setSize(94, 23);
        add.enabled = liveSession && Boolean(selector);
        add.tooltips = controllers.length > 0
            ? "Duplicate the selected controller."
            : "Create a controller with two pages.";
        add.data = sourceName
            ? { kind: "duplicate", sourceName } satisfies ControllerPanelItemData
            : { kind: "create" } satisfies ControllerPanelItemData;
        add.offClick(this, this.onControllerPanelItemClick);
        add.onClick(this, this.onControllerPanelItemClick, [add]);
        this.setDebugAttribute(
            "data-fairy-editor-controller-panel",
            controllers.map((controller) => (
                `${controller.name}:${controller.selectedIndex}/${controller.pageCount}`
            )).join("|") || "none",
        );
        const selectedModel = selector && sourceName
            ? getControllerModel(
                this.liveSessionBridge.getWorkingProject(),
                selector,
                sourceName,
            ) as {
                pages?: Array<{ id?: string }>;
                actions?: Array<{ actionType?: number }>;
            } | null
            : null;
        this.setDebugAttribute(
            "data-fairy-editor-controller-pages",
            selectedModel?.pages
                ? `${sourceName}:${selectedModel.pages.map((page) => page.id).join(",")}`
                : "none",
        );
        this.setDebugAttribute(
            "data-fairy-editor-controller-actions",
            selectedModel?.actions
                ? `${sourceName}:${selectedModel.actions.map((action) => action.actionType).join(",") || "none"}`
                : "none",
        );
    }

    populateTransitionList(): void {
        const selector = this.getSelectedComponentSelector();
        const transitions = selector
            ? inspectComponent(
                this.liveSessionBridge.getWorkingProject(),
                selector,
            )?.transitions || []
            : [];
        if (!transitions.some((transition) => transition.name === this.selectedTransitionName)) {
            this.selectedTransitionName = transitions[0]?.name || "";
        }
        const list = this.transitionListView.getChild("list").asList;
        list.removeChildrenToPool();
        for (const transition of transitions) {
            const item = list.addItemFromPool().asButton;
            const title = item.getChild("title").asCom;
            title.getChild("title").asTextField.text = transition.name;
            title.getChild("input").asTextInput.text = transition.name;
            title.touchable = false;
            item.data = { name: transition.name };
            item.selected = transition.name === this.selectedTransitionName;
            item.tooltips = "Double-click to edit this transition timeline.";
            item.off(Laya.Event.DOUBLE_CLICK, this, this.openTransitionFromList);
            item.on(Laya.Event.DOUBLE_CLICK, this, this.openTransitionFromList, [transition.name]);
        }
        list.selectedIndex = transitions.findIndex(
            (transition) => transition.name === this.selectedTransitionName,
        );
        const liveSession = this.options.isLiveSession();
        this.setActionEnabled(this.transitionListView.getChild("add").asButton, liveSession && Boolean(selector));
        this.setActionEnabled(
            this.transitionListView.getChild("duplicate").asButton,
            liveSession && Boolean(this.selectedTransitionName),
        );
        this.setActionEnabled(
            this.transitionListView.getChild("delete").asButton,
            liveSession && Boolean(this.selectedTransitionName),
        );
        const rename = this.transitionListView.getChild("rename").asButton;
        this.setActionEnabled(rename, liveSession && Boolean(this.selectedTransitionName));
        rename.tooltips = "Rename this transition and retarget its references.";
        this.setDebugAttribute("data-fairy-editor-transition-list-count", String(transitions.length));
        this.setDebugAttribute(
            "data-fairy-editor-transition-list-selection",
            this.selectedTransitionName || "",
        );
    }

    populateTimeline(): void {
        const selector = this.getSelectedComponentSelector();
        const project = this.liveSessionBridge.getWorkingProject();
        const inspection = selector ? inspectComponent(project, selector) : null;
        const transitionModels = new Map<string, TimelineModel>();
        const transitions = (inspection?.transitions || []).map((transition) => {
            const model = selector
                ? getTransitionModel(project, selector, transition.name) as TimelineModel | null
                : null;
            if (model) transitionModels.set(transition.name, model);
            return {
                ...transition,
                itemCount: model?.items?.length || 0,
            } satisfies TimelineTransitionData;
        });
        if (!transitions.some((transition) => transition.name === this.selectedTransitionName)) {
            this.selectedTransitionName = transitions[0]?.name || "";
        }
        this.timelinePanel.render(
            transitions,
            this.selectedTransitionName,
            transitionModels.get(this.selectedTransitionName),
            this.options.isLiveSession(),
            this.timelineVisible,
            this.panels.document.getChild("editingTransBar").asLabel,
        );
    }

    playRuntimePreviewTransition(): void {
        const result = this.selectedTransitionName
            ? this.runtimePreview.playTransition(this.selectedTransitionName)
            : this.runtimePreview.playFirstTransition();
        this.setDebugAttribute("data-fairy-editor-preview-transition", result.ok ? "played" : "unavailable");
        this.setStatus(
            result.ok
                ? `Runtime preview transition played: ${result.transitionName}.`
                : "Runtime preview has no published transition to play.",
        );
    }

    showTransitionList(): void {
        this.showEditorWorkspace();
        if (!this.leftDockVisible) {
            this.leftDockVisible = true;
            this.saveDesktopLayoutState();
        }
        this.leftTopPanelMode = "transition";
        this.populateTransitionList();
        this.layout();
    }

    private onTransitionListItemClick(itemObject: fgui.GObject): void {
        const item = itemObject.data as { name: string } | null;
        if (!item) return;
        this.selectedTransitionName = item.name;
        this.timelinePanel.setSelectedItemIndex(0);
        this.setDebugAttribute("data-fairy-editor-transition-list-selection", item.name);
        this.populateTimeline();
    }

    private openTransitionFromList(transitionName: string): void {
        const selector = this.getSelectedComponentSelector();
        const exists = selector && inspectComponent(
            this.liveSessionBridge.getWorkingProject(),
            selector,
        )?.transitions.some((transition) => transition.name === transitionName);
        if (!exists) return;
        this.selectedTransitionName = transitionName;
        this.timelinePanel.setSelectedItemIndex(0);
        this.timelineVisible = true;
        this.consoleVisible = false;
        this.populateTransitionList();
        this.populateTimeline();
        this.layout();
        this.saveDesktopLayoutState();
    }

    private async createTransitionFromList(): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        if (!selector) {
            this.setStatus("Create transition requires a selected component.");
            return;
        }
        const preparation = prepareCreateTransition(
            this.liveSessionBridge.getWorkingProject(),
            selector,
        );
        const operation = preparation.ok ? preparation.transaction.operation : null;
        const transitionName = operation?.kind === "addTransition"
            ? operation.selector.transitionName
            : "";
        if (await this.applyAuthoringPreparation(preparation) && transitionName) {
            this.openTransitionFromList(transitionName);
        }
    }

    private async duplicateTransitionFromList(): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        if (!selector || !this.selectedTransitionName) return;
        const preparation = prepareAddTransition(
            this.liveSessionBridge.getWorkingProject(),
            selector,
            this.selectedTransitionName,
        );
        const operation = preparation.ok ? preparation.transaction.operation : null;
        const transitionName = operation?.kind === "addTransition"
            ? operation.selector.transitionName
            : "";
        if (await this.applyAuthoringPreparation(preparation) && transitionName) {
            this.openTransitionFromList(transitionName);
        }
    }

    private async renameTransitionFromList(): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        const transitionName = this.selectedTransitionName;
        if (!selector || !transitionName) return;
        this.setDebugAttribute("data-fairy-editor-transition-list-rename", "open");
        this.setStatus(`Rename transition ${transitionName}.`);
        const renamedValue = await this.authoringDialogs.requestTextInput(
            "desktopRenameTransitionDialog",
            "Rename transition",
            `Rename ${transitionName}`,
            "",
            "Rename",
            (value) => {
                const candidate = prepareRenameTransition(
                    this.liveSessionBridge.getWorkingProject(),
                    selector,
                    transitionName,
                    value,
                );
                if (candidate.ok === false) {
                    this.setStatus(`Transition rename unavailable: ${candidate.code}. ${candidate.message}`);
                    return candidate.message;
                }
                return null;
            },
        );
        if (renamedValue === null) {
            this.setDebugAttribute("data-fairy-editor-transition-list-rename", "cancelled");
            this.setStatus("Transition rename cancelled.");
            return;
        }
        const preparation = prepareRenameTransition(
            this.liveSessionBridge.getWorkingProject(),
            selector,
            transitionName,
            renamedValue,
        );
        this.setDebugAttribute("data-fairy-editor-transition-list-rename", "confirmed");
        if (!(await this.applyAuthoringPreparation(preparation))) return;
        this.selectedTransitionName = renamedValue.trim();
        this.timelinePanel.setSelectedItemIndex(0);
        this.populateTransitionList();
        this.populateTimeline();
        this.layout();
    }

    private removeTransitionFromList(): void {
        const selector = this.getSelectedComponentSelector();
        if (!selector || !this.selectedTransitionName) return;
        const preparation = prepareRemoveTransition(
            this.liveSessionBridge.getWorkingProject(),
            selector,
            this.selectedTransitionName,
        );
        const preparationIdentity = this.liveSessionBridge.captureSessionIdentity();
        if (preparation.ok === false) {
            this.setStatus(`Operation unavailable: ${preparation.code}. ${preparation.message}`);
            return;
        }
        this.authoringDialogs.showConfirmation(
            "desktopRemoveTransitionConfirmDialog",
            "Remove transition",
            `Remove ${this.selectedTransitionName}? This change is undoable before Save.`,
            "Remove",
            "data-fairy-editor-transition-list-remove-confirmation",
            "Confirm transition removal.",
            "Transition removal cancelled.",
            () => void this.applyAuthoringPreparation(preparation, preparationIdentity),
        );
    }

    private onControllerPanelItemClick(itemObject: fgui.GObject): void {
        const data = itemObject.data as ControllerPanelItemData | null;
        const selector = this.getSelectedComponentSelector();
        if (!data || !selector) return;
        if (data.kind === "edit") {
            this.selectedControllerName = data.sourceName;
            this.authoringDialogs.showControllerEditor(data.sourceName);
            return;
        }
        if (data.kind === "duplicate") {
            void this.applyAuthoringPreparation(prepareAddController(
                this.liveSessionBridge.getWorkingProject(),
                selector,
                data.sourceName,
            ));
            return;
        }
        if (data.kind === "create") {
            const preparation = prepareCreateController(
                this.liveSessionBridge.getWorkingProject(),
                selector,
            );
            const operation = preparation.ok ? preparation.transaction.operation : null;
            if (operation?.kind === "addController") this.selectedControllerName = operation.selector.controllerName;
            void this.applyAuthoringPreparation(preparation);
            return;
        }

        this.selectedControllerName = data.name;
        this.populateControllerPanel();
        if (data.pageCount < 2) {
            this.setStatus(`Controller ${data.name} has only one page.`);
            return;
        }
        const nextIndex = (data.selectedIndex + 1) % data.pageCount;
        this.setDebugAttribute(
            "data-fairy-editor-controller-action",
            `${data.name}:${data.selectedIndex}->${nextIndex}`,
        );
        void this.applyAuthoringPreparation(prepareUpdateController(
            this.liveSessionBridge.getWorkingProject(),
            selector,
            data.name,
            nextIndex,
        ));
    }

    isTimelineFocused(): boolean {
        return this.timelinePanel.isFocused(
            this.timelineVisible,
            this.runtimePreview.hasCanvasFocus(),
        );
    }

    showAddTimelineItemEditor(): void {
        const selector = this.getSelectedComponentSelector();
        const component = this.getSelectedComponent();
        if (!selector || !component || !this.selectedTransitionName) return;
        const transition = getTransitionModel(
            this.liveSessionBridge.getWorkingProject(),
            selector,
            this.selectedTransitionName,
        ) as { items?: Array<{ time?: number; duration?: number; tween?: boolean }> } | null;
        if (!transition?.items) return;
        const last = transition.items.reduce(
            (frame, item) => Math.max(
                frame,
                Math.max(0, Math.round(Number(item.time || 0)))
                    + (item.tween ? Math.max(0, Math.round(Number(item.duration || 0))) : 0),
            ),
            0,
        );
        const targetNodeId = this.selectedDisplayNodeId || component.children[0]?.id || "";
        this.authoringDialogs.showTimelineItemEditor(
            "add",
            createTransitionItemModel(0, targetNodeId, last),
            transition.items.length,
        );
    }

    showSelectedTimelineItemEditor(): void {
        const selector = this.getSelectedComponentSelector();
        const itemIndex = this.timelinePanel.getSelectedItemIndex();
        if (!selector || !this.selectedTransitionName || itemIndex < 0) return;
        const model = getTransitionItemModel(
            this.liveSessionBridge.getWorkingProject(),
            selector,
            this.selectedTransitionName,
            itemIndex,
        ) as TransitionItemModel | null;
        if (model) this.authoringDialogs.showTimelineItemEditor("edit", model, itemIndex);
    }

    async duplicateSelectedTimelineItem(): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        const itemIndex = this.timelinePanel.getSelectedItemIndex();
        if (!selector || !this.selectedTransitionName || itemIndex < 0) return;
        const applied = await this.applyAuthoringPreparation(prepareDuplicateTransitionItem(
            this.liveSessionBridge.getWorkingProject(),
            selector,
            this.selectedTransitionName,
            itemIndex,
        ));
        if (!applied) return;
        this.timelinePanel.setSelectedItemIndex(itemIndex + 1);
        this.populateTimeline();
        this.setDebugAttribute(
            "data-fairy-editor-timeline-item",
            `${this.selectedTransitionName}:${itemIndex}:duplicate`,
        );
    }

    async removeSelectedTimelineItem(): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        const itemIndex = this.timelinePanel.getSelectedItemIndex();
        if (!selector || !this.selectedTransitionName || itemIndex < 0) return;
        const applied = await this.applyAuthoringPreparation(prepareRemoveTransitionItem(
            this.liveSessionBridge.getWorkingProject(),
            selector,
            this.selectedTransitionName,
            itemIndex,
        ));
        if (!applied) return;
        this.timelinePanel.setSelectedItemIndex(Math.max(0, itemIndex - 1));
        this.populateTimeline();
        this.setDebugAttribute(
            "data-fairy-editor-timeline-item",
            `${this.selectedTransitionName}:${itemIndex}:remove`,
        );
    }

    private onEditingTransitionBarClick(): void {
        if (!this.timelineVisible) return;
        this.timelineVisible = false;
        this.timelinePanel.setKeyboardActive(false);
        this.layout();
        this.saveDesktopLayoutState();
    }

    cancelTimelineDrag(restore: boolean): boolean {
        return this.timelinePanel.cancelDrag(restore);
    }

    private async applyTimelineItemTiming(change: TimelineTimingChange): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        if (!selector) {
            this.populateTimeline();
            return;
        }
        const preparation = prepareUpdateTransitionItemTiming(
            this.liveSessionBridge.getWorkingProject(),
            selector,
            change.item.transitionName,
            change.item.itemIndex,
            {
                time: change.targetTime,
                duration: change.targetDuration,
                tween: change.item.tween,
            },
        );
        this.setDebugAttribute(
            "data-fairy-editor-timeline-action",
            `${change.item.transitionName}:${change.item.itemIndex}:`
            + `${change.item.time}->${change.targetTime}:`
            + `${change.item.duration}->${change.targetDuration}`,
        );
        if (!(await this.applyAuthoringPreparation(preparation))) this.populateTimeline();
    }
}
