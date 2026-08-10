import {
    createInspectorButton,
    setActionEnabled,
} from "./EditorFormControls";

export interface TimelineTransitionData {
    name: string;
    autoPlay: boolean;
    itemCount: number;
}

export interface TimelineItemData {
    transitionName: string;
    itemIndex: number;
    targetNodeId: string;
    actionType: number;
    time: number;
    duration: number;
    tween: boolean;
}

export interface TimelineModel {
    fps?: number;
    items?: Array<{
        targetNodeId?: string;
        actionType?: number;
        time?: number;
        duration?: number;
        tween?: boolean;
    }>;
}

export interface TimelineTimingChange {
    item: TimelineItemData;
    targetTime: number;
    targetDuration: number;
}

type TimelinePanelCallbacks = {
    onAdd: () => void;
    onEdit: () => void;
    onRemove: () => void;
    onSelection: () => void;
    onTimingChange: (change: TimelineTimingChange) => void;
    setDebugAttribute: (name: string, value: string) => void;
    setStatus: (message: string) => void;
};

type TimelineDragState = TimelineTimingChange & {
    row: fgui.GButton;
    range: fgui.GObject;
    mode: "time" | "duration";
    startStageX: number;
    moved: boolean;
};

const TIMELINE_PIXELS_PER_FRAME = 4;

export class TimelinePanelController {
    private selectedItemIndex = -1;
    private keyboardActive = false;
    private dragState: TimelineDragState | null = null;
    private liveSession = false;

    constructor(
        private readonly view: fgui.GComponent,
        private readonly callbacks: TimelinePanelCallbacks,
    ) {
        this.configureActionBar();
        this.view.getChild("nameList").on(
            fgui.Events.CLICK_ITEM,
            this,
            this.onTimelineNameItemClick,
        );
        this.view.getChild("list").on(
            fgui.Events.CLICK_ITEM,
            this,
            this.onTimelineRowItemClick,
        );
    }

    dispose(): void {
        this.cancelDrag(true);
        Laya.stage.off(Laya.Event.MOUSE_MOVE, this, this.onTimelineDragMouseMove);
        Laya.stage.off(Laya.Event.MOUSE_UP, this, this.onTimelineDragMouseUp);
        this.view.getChild("nameList").off(
            fgui.Events.CLICK_ITEM,
            this,
            this.onTimelineNameItemClick,
        );
        this.view.getChild("list").off(
            fgui.Events.CLICK_ITEM,
            this,
            this.onTimelineRowItemClick,
        );
        for (const [name, handler] of [
            ["timelineAddAction", this.callbacks.onAdd],
            ["timelineEditAction", this.callbacks.onEdit],
            ["timelineRemoveAction", this.callbacks.onRemove],
        ] as const) {
            const button = this.view.getChild(name);
            if (!button) continue;
            button.offClick(this, handler);
            this.view.removeChild(button, true);
        }
        for (const name of ["nameList", "list", "timeTitles"] as const) {
            const list = this.view.getChild(name).asList;
            list.removeChildrenToPool();
            list.itemPool.clear();
        }
        this.keyboardActive = false;
        this.liveSession = false;
    }

    getSelectedItemIndex(): number {
        return this.selectedItemIndex;
    }

    setSelectedItemIndex(index: number): void {
        this.selectedItemIndex = index;
    }

    setKeyboardActive(active: boolean): void {
        this.keyboardActive = active;
    }

    isFocused(visible: boolean, canvasFocused: boolean): boolean {
        return visible && this.keyboardActive && !canvasFocused;
    }

    cancelDrag(restore: boolean): boolean {
        const state = this.dragState;
        if (!state) return false;
        this.dragState = null;
        Laya.stage.off(Laya.Event.MOUSE_MOVE, this, this.onTimelineDragMouseMove);
        Laya.stage.off(Laya.Event.MOUSE_UP, this, this.onTimelineDragMouseUp);
        if (restore) {
            state.range.x = state.item.time * TIMELINE_PIXELS_PER_FRAME;
            state.range.width = state.item.tween
                ? Math.max(8, state.item.duration * TIMELINE_PIXELS_PER_FRAME)
                : 8;
        }
        return true;
    }

    render(
        transitions: TimelineTransitionData[],
        selectedTransitionName: string,
        selectedModel: TimelineModel | undefined,
        liveSession: boolean,
        visible: boolean,
        editingBar: fgui.GLabel,
    ): void {
        this.cancelDrag(true);
        this.liveSession = liveSession;
        const nameList = this.view.getChild("nameList").asList;
        const timelineList = this.view.getChild("list").asList;
        const timeTitles = this.view.getChild("timeTitles").asList;
        nameList.removeChildrenToPool();
        timelineList.removeChildrenToPool();
        timeTitles.removeChildrenToPool();

        const items = (selectedModel?.items || []).map((item, itemIndex) => ({
            transitionName: selectedTransitionName,
            itemIndex,
            targetNodeId: String(item.targetNodeId || ""),
            actionType: Number(item.actionType || 0),
            time: Math.max(0, Math.round(Number(item.time || 0))),
            duration: Math.max(0, Math.round(Number(item.duration || 0))),
            tween: Boolean(item.tween),
        } satisfies TimelineItemData));
        if (this.selectedItemIndex < 0 || this.selectedItemIndex >= items.length) {
            this.selectedItemIndex = items.length > 0 ? 0 : -1;
        }
        const maxFrame = items.reduce(
            (maximum, item) => Math.max(
                maximum,
                item.time + (item.tween ? item.duration : 0),
            ),
            0,
        );
        const rowWidth = Math.max(400, (maxFrame + 10) * TIMELINE_PIXELS_PER_FRAME);
        for (const item of items) {
            const nameItem = nameList.addItemFromPool().asButton;
            nameItem.title = item.targetNodeId || "(root)";
            nameItem.selected = item.itemIndex === this.selectedItemIndex;
            nameItem.data = item;
            nameItem.tooltips = "Select this item. Insert duplicates, Delete removes, Enter edits its values.";
            const type = nameItem.getChild("type");
            if (type) type.text = `${item.tween ? "tween" : "key"} #${item.actionType}`;

            const row = timelineList.addItemFromPool().asButton;
            row.width = rowWidth;
            row.selected = item.itemIndex === this.selectedItemIndex;
            row.data = item;
            row.tooltips = item.tween
                ? "Drag to move; drag the right edge for duration. Insert/Delete/Enter edit the selected item."
                : "Drag to move the key frame. Insert/Delete/Enter edit the selected item.";
            const range = row.getChild("range");
            if (range) {
                range.x = item.time * TIMELINE_PIXELS_PER_FRAME;
                range.width = item.tween
                    ? Math.max(8, item.duration * TIMELINE_PIXELS_PER_FRAME)
                    : 8;
            }
            row.off(Laya.Event.MOUSE_DOWN, this, this.onTimelineRowMouseDown);
            row.on(Laya.Event.MOUSE_DOWN, this, this.onTimelineRowMouseDown, [row]);
        }

        const titleMaxFrame = Math.max(60, Math.ceil(maxFrame / 10) * 10);
        for (let frame = 0; frame <= titleMaxFrame; frame += 10) {
            const title = timeTitles.addItemFromPool().asCom;
            title.width = TIMELINE_PIXELS_PER_FRAME * 10;
            const label = title.getChild("t0");
            if (label) label.text = String(frame);
        }
        const fps = Math.max(1, Math.round(Number(selectedModel?.fps || 24)));
        this.view.getChild("fps").text = String(fps);
        this.view.getChild("frame").text = String(maxFrame);
        this.view.getChild("time").text = `${(maxFrame / fps).toFixed(2)}s`;
        this.view.getController("status").selectedIndex = items.length > 0 ? 2 : 0;
        this.setActionState("timelineAddAction", liveSession && Boolean(selectedTransitionName));
        this.setActionState("timelineEditAction", liveSession && this.selectedItemIndex >= 0);
        this.setActionState("timelineRemoveAction", liveSession && this.selectedItemIndex >= 0);
        const prompt = this.view.getChild("prompt");
        if (prompt) {
            prompt.text = transitions.length > 0
                ? "当前过渡没有时间轴动作。"
                : "当前组件没有可用的过渡。";
        }
        this.fitEditingBar(editingBar, selectedTransitionName || "无过渡");
        this.callbacks.setDebugAttribute(
            "data-fairy-editor-timeline-model",
            `${selectedTransitionName || "none"}:${items.map((item) => (
                `${item.itemIndex}@${item.time}+${item.duration}:${item.tween ? "tween" : "key"}`
            )).join("|") || "empty"}`,
        );
        this.callbacks.setDebugAttribute(
            "data-fairy-editor-timeline",
            `${visible ? "open" : "closed"}:${selectedTransitionName || "none"}`,
        );
    }

    private configureActionBar(): void {
        const actions = [
            { name: "timelineAddAction", title: "+ 动作", x: 4, handler: this.callbacks.onAdd },
            { name: "timelineEditAction", title: "编辑", x: 62, handler: this.callbacks.onEdit },
            { name: "timelineRemoveAction", title: "删除", x: 112, handler: this.callbacks.onRemove },
        ];
        for (const action of actions) {
            const button = createInspectorButton(
                this.view,
                action.name,
                action.title,
                action.x,
                1,
                action.name === "timelineAddAction" ? 54 : 46,
            );
            button.setSize(button.width, 20);
            button.onClick(this, action.handler);
        }
    }

    private setActionState(name: string, enabled: boolean): void {
        const button = this.view.getChild(name)?.asButton;
        if (button) setActionEnabled(button, enabled);
    }

    private fitEditingBar(editingBar: fgui.GLabel, value: string): void {
        const right = editingBar.x + editingBar.width;
        editingBar.title = value;
        const title = editingBar.getTextField();
        title.ensureSizeCorrect();
        const naturalTextWidth = Math.max(
            Math.ceil(title.textWidth),
            Array.from(value).length * title.fontSize,
        );
        const width = Math.max(79, Math.min(280, naturalTextWidth + 58));
        editingBar.setSize(width, editingBar.height);
        editingBar.x = right - width;
        title.setSize(Math.max(15, width - 58), title.height);
        title.displayObject.overflow = Laya.Text.ELLIPSIS;
        editingBar.tooltips = `编辑过渡：${value}\n点击退出时间轴编辑。`;
    }

    private onTimelineNameItemClick(itemObject: fgui.GObject): void {
        const data = itemObject.data as TimelineItemData | null;
        if (!data) return;
        this.select(data);
    }

    private onTimelineRowItemClick(itemObject: fgui.GObject): void {
        const data = itemObject.data as TimelineItemData | null;
        if (data) this.select(data);
    }

    private select(data: TimelineItemData): void {
        this.selectedItemIndex = data.itemIndex;
        this.keyboardActive = true;
        this.callbacks.setDebugAttribute("data-fairy-editor-timeline-keyboard", "active");
        this.callbacks.setDebugAttribute(
            "data-fairy-editor-timeline-selection",
            `${data.transitionName}:${data.itemIndex}`,
        );
        this.callbacks.onSelection();
    }

    private onTimelineRowMouseDown(row: fgui.GButton, event: Laya.Event): void {
        if (event.button !== 0 || !this.liveSession) return;
        const item = row.data as TimelineItemData | null;
        const range = row.getChild("range");
        if (!item || !range) return;
        const rangeStart = range.localToGlobal(0, 0).x;
        const rangeEnd = range.localToGlobal(range.width, 0).x;
        if (event.stageX < rangeStart - 4 || event.stageX > rangeEnd + 10) return;
        event.stopPropagation();
        this.cancelDrag(true);
        this.selectedItemIndex = item.itemIndex;
        this.dragState = {
            row,
            range,
            item,
            mode: item.tween && Math.abs(event.stageX - rangeEnd) <= 10 ? "duration" : "time",
            startStageX: event.stageX,
            targetTime: item.time,
            targetDuration: item.duration,
            moved: false,
        };
        Laya.stage.on(Laya.Event.MOUSE_MOVE, this, this.onTimelineDragMouseMove);
        Laya.stage.on(Laya.Event.MOUSE_UP, this, this.onTimelineDragMouseUp);
    }

    private onTimelineDragMouseMove(event: Laya.Event): void {
        const state = this.dragState;
        if (!state) return;
        const frameDelta = Math.round(
            (event.stageX - state.startStageX) / TIMELINE_PIXELS_PER_FRAME,
        );
        if (state.mode === "time") {
            state.targetTime = Math.max(0, state.item.time + frameDelta);
            state.range.x = state.targetTime * TIMELINE_PIXELS_PER_FRAME;
        } else {
            state.targetDuration = Math.max(1, state.item.duration + frameDelta);
            state.range.width = Math.max(
                8,
                state.targetDuration * TIMELINE_PIXELS_PER_FRAME,
            );
        }
        state.moved = state.targetTime !== state.item.time
            || state.targetDuration !== state.item.duration;
    }

    private onTimelineDragMouseUp(): void {
        const state = this.dragState;
        if (!state) return;
        this.dragState = null;
        Laya.stage.off(Laya.Event.MOUSE_MOVE, this, this.onTimelineDragMouseMove);
        Laya.stage.off(Laya.Event.MOUSE_UP, this, this.onTimelineDragMouseUp);
        if (state.moved) this.callbacks.onTimingChange(state);
    }
}
