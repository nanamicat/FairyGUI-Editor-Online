import {
    TRANSITION_ACTIONS,
    TRANSITION_EASES,
    createTransitionItemModel,
    prepareAddTransitionItemModel,
    prepareUpdateTransitionItemModel,
    transitionActionSupportsTween,
    type HighRiskTransactionPreparation,
    type TransitionItemModel,
} from "../commands/HighRiskAuthoringTransactions";
import type { EditorComponentSelector } from "../model/EditorCommand";
import type { ProjectSnapshotComponent, ProjectSnapshotResource } from "../model/ProjectSnapshot";
import { createDefaultCustomEasePath, createDefaultTimelinePath } from "../model/TimelinePathData";
import { showTimelinePathEditor } from "../TimelinePathEditor";
import {
    addInspectorLine,
    createInspectorButton,
    createInspectorCheckButton,
    createInspectorTextInput,
    createTimelineComboBox,
    setActionEnabled,
} from "../ui/EditorFormControls";

export type TimelineItemEditorContext = {
    selector: EditorComponentSelector | null;
    component: ProjectSnapshotComponent | null;
    transitionName: string;
    soundResources: ProjectSnapshotResource[];
    getWorkingProject(): unknown | null;
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    applyPreparation(preparation: HighRiskTransactionPreparation): Promise<boolean>;
    onApplied(itemIndex: number): void;
    setStatus(message: string): void;
    setDebugAttribute(name: string, value: string): void;
    eventOwner: object;
};

export function showTimelineItemEditor(
    options: TimelineItemEditorContext,
    mode: "add" | "edit",
    sourceModel: TransitionItemModel,
    itemIndex: number,
): void {
    const createCheckButton = (
        list: fgui.GComponent,
        controlName: string,
        title: string,
        x: number,
        y: number,
        width: number,
        selected: boolean,
        onToggle: () => void,
    ) => createInspectorCheckButton(
        list,
        controlName,
        title,
        x,
        y,
        width,
        selected,
        onToggle,
        options.eventOwner,
    );
    const selector = options.selector;
    const component = options.component;
    const transitionName = options.transitionName;
    if (!selector || !component || !transitionName) return;
    const soundResources = options.soundResources;
    const sourceSoundUrl = Number(sourceModel.actionType) === 9
        ? String(sourceModel.startValue?.[0] ?? "")
        : "";
    const soundItems = ["(select sound)", ...soundResources.map((resource) => resource.name || resource.id)];
    const soundValues = ["", ...soundResources.map((resource) => `ui://${selector.packageId}${resource.id}`)];
    if (sourceSoundUrl && !soundValues.includes(sourceSoundUrl)) {
        soundItems.push(`Current: ${sourceSoundUrl}`);
        soundValues.push(sourceSoundUrl);
    }

    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "timelineItemEditorDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(640, 390);
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `${mode === "add" ? "Add" : "Edit"} ${transitionName} action`;
    const hint = content.getChild("n2").asTextField;
    hint.setXY(16, 34);
    hint.setSize(608, 18);
    hint.color = "#8ccf7e";

    addInspectorLine(content, "timelineActionTypeLabel", "Action", 16, 62, 52, "#bdbdbd");
    const actionInput = createTimelineComboBox(
        content,
        "timelineActionType",
        70,
        58,
        150,
        [...TRANSITION_ACTIONS],
        TRANSITION_ACTIONS.map((_, index) => String(index)),
        Math.max(0, Math.min(TRANSITION_ACTIONS.length - 1, Number(sourceModel.actionType || 0))),
    );
    addInspectorLine(content, "timelineActionTargetLabel", "Target", 236, 62, 48, "#bdbdbd");
    const targetItems = ["(component root)", ...component.children.map((node) => node.name || node.id)];
    const targetValues = ["", ...component.children.map((node) => node.id)];
    const targetInput = createTimelineComboBox(
        content,
        "timelineActionTarget",
        284,
        58,
        340,
        targetItems,
        targetValues,
        Math.max(0, targetValues.indexOf(String(sourceModel.targetNodeId || ""))),
    );

    addInspectorLine(content, "timelineActionTimeLabel", "Time", 16, 90, 40, "#bdbdbd");
    const timeInput = createInspectorTextInput(content, "timelineActionTime", 58, 86, 62, String(sourceModel.time ?? 0), true);
    addInspectorLine(content, "timelineActionDurationLabel", "Duration", 132, 90, 54, "#bdbdbd");
    const durationInput = createInspectorTextInput(content, "timelineActionDuration", 188, 86, 62, String(sourceModel.duration ?? 0), true);
    let tweenControl!: ReturnType<typeof createCheckButton>;
    tweenControl = createCheckButton(
        content,
        "timelineActionTween",
        "Tween",
        270,
        86,
        96,
        Boolean(sourceModel.tween),
        () => {
            if (!transitionActionSupportsTween(Number(actionInput.value))) return;
            tweenControl.button.selected = !tweenControl.button.selected;
            durationInput.editable = tweenControl.button.selected;
            durationInput.grayed = !tweenControl.button.selected;
        },
    );

    const startValueLabel = addInspectorLine(content, "timelineActionStartLabel", "Start value", 16, 118, 72, "#bdbdbd");
    const startInput = createInspectorTextInput(
        content,
        "timelineActionStart",
        90,
        114,
        534,
        formatTransitionActionValue(Number(sourceModel.actionType || 0), sourceModel.startValue || []),
        true,
    );
    const soundInput = createTimelineComboBox(
        content,
        "timelineActionSound",
        90,
        114,
        354,
        soundItems,
        soundValues,
        Math.max(0, soundValues.indexOf(sourceSoundUrl)),
    );
    const soundVolumeLabel = addInspectorLine(content, "timelineActionSoundVolumeLabel", "Volume", 456, 118, 48, "#bdbdbd");
    const soundVolumeInput = createInspectorTextInput(
        content,
        "timelineActionSoundVolume",
        506,
        114,
        118,
        String(sourceModel.startValue?.[1] ?? 100),
        true,
    );
    addInspectorLine(content, "timelineActionEndLabel", "End value", 16, 146, 72, "#bdbdbd");
    const endInput = createInspectorTextInput(
        content,
        "timelineActionEnd",
        90,
        142,
        534,
        formatTransitionActionValue(Number(sourceModel.actionType || 0), sourceModel.endValue || []),
        Boolean(sourceModel.tween),
    );

    addInspectorLine(content, "timelineActionEaseLabel", "Ease", 16, 174, 40, "#bdbdbd");
    const easeInput = createTimelineComboBox(
        content,
        "timelineActionEase",
        58,
        170,
        150,
        [...TRANSITION_EASES],
        TRANSITION_EASES.map((_, index) => String(index)),
        Math.max(0, Math.min(TRANSITION_EASES.length - 1, Number(sourceModel.easeType || 0))),
    );
    addInspectorLine(content, "timelineActionRepeatLabel", "Repeat", 222, 174, 46, "#bdbdbd");
    const repeatInput = createInspectorTextInput(content, "timelineActionRepeat", 270, 170, 62, String(sourceModel.repeat ?? 0), true);
    let yoyoControl!: ReturnType<typeof createCheckButton>;
    yoyoControl = createCheckButton(
        content,
        "timelineActionYoyo",
        "Yoyo",
        350,
        170,
        90,
        Boolean(sourceModel.yoyo),
        () => {
            yoyoControl.button.selected = !yoyoControl.button.selected;
        },
    );

    addInspectorLine(content, "timelineActionLabelLabel", "Label", 16, 202, 40, "#bdbdbd");
    const labelInput = createInspectorTextInput(content, "timelineActionLabel", 58, 198, 248, String(sourceModel.label || ""), true);
    addInspectorLine(content, "timelineActionEndLabelLabel", "End label", 320, 202, 62, "#bdbdbd");
    const endLabelInput = createInspectorTextInput(content, "timelineActionEndLabel", 384, 198, 240, String(sourceModel.endLabel || ""), true);
    addInspectorLine(content, "timelineActionPathLabel", "Path", 16, 230, 40, "#bdbdbd");
    const pathInput = createInspectorTextInput(content, "timelineActionPath", 58, 226, 486, String(sourceModel.path || ""), true);
    const pathEditButton = createInspectorButton(content, "timelineActionPathEdit", "Edit...", 552, 225, 72);
    addInspectorLine(content, "timelineActionCustomEaseLabel", "Custom ease", 16, 258, 76, "#bdbdbd");
    const customEaseInput = createInspectorTextInput(content, "timelineActionCustomEase", 94, 254, 450, String(sourceModel.customEasePath || ""), true);
    const customEaseEditButton = createInspectorButton(content, "timelineActionCustomEaseEdit", "Edit...", 552, 253, 72);
    pathEditButton.onClick(options.eventOwner, () => {
        const startX = Number(startInput.text.split(",")[0]) || 0;
        const startY = Number(startInput.text.split(",")[1]) || 0;
        const endX = Number(endInput.text.split(",")[0]) || 0;
        const endY = Number(endInput.text.split(",")[1]) || 0;
        showTimelinePathEditor({
            mode: "path",
            value: pathInput.text,
            defaultPoints: createDefaultTimelinePath(endX - startX, endY - startY),
            onApply: (value) => {
                pathInput.text = value;
                options.setDebugAttribute("data-fairy-editor-timeline-curve-draft", value ? "path" : "path-cleared");
                hint.text = "Motion path draft updated. Apply the outer Timeline action to save it.";
            },
        });
    });
    customEaseEditButton.onClick(options.eventOwner, () => {
        showTimelinePathEditor({
            mode: "ease",
            value: customEaseInput.text,
            defaultPoints: createDefaultCustomEasePath(),
            onApply: (value) => {
                customEaseInput.text = value;
                options.setDebugAttribute("data-fairy-editor-timeline-curve-draft", "ease");
                hint.text = "Custom ease draft updated. Apply the outer Timeline action to save it.";
            },
        });
    });

    const updateActionState = (resetValues: boolean): void => {
        const actionType = Number(actionInput.value);
        const tweenEnabled = transitionActionSupportsTween(actionType);
        if (resetValues) {
            const defaults = createTransitionItemModel(actionType, targetInput.value, readTimelineInteger(timeInput));
            tweenControl.button.selected = Boolean(defaults.tween);
            durationInput.text = String(defaults.duration);
            startInput.text = formatTransitionActionValue(actionType, defaults.startValue || []);
            endInput.text = formatTransitionActionValue(actionType, defaults.endValue || []);
            if (actionType === 9) {
                targetInput.selectedIndex = 0;
                soundInput.selectedIndex = 0;
                soundVolumeInput.text = "100";
            }
        }
        const soundAction = actionType === 9;
        startValueLabel.text = soundAction ? "Sound" : "Start value";
        startInput.visible = !soundAction;
        soundInput.visible = soundAction;
        soundVolumeLabel.visible = soundAction;
        soundVolumeInput.visible = soundAction;
        targetInput.grayed = soundAction;
        targetInput.touchable = !soundAction;
        tweenControl.host.grayed = !tweenEnabled;
        tweenControl.host.touchable = tweenEnabled;
        if (!tweenEnabled) tweenControl.button.selected = false;
        durationInput.editable = tweenEnabled && tweenControl.button.selected;
        durationInput.grayed = !durationInput.editable;
        endInput.editable = tweenEnabled && tweenControl.button.selected;
        endInput.grayed = !endInput.editable;
        easeInput.grayed = !tweenEnabled;
        easeInput.touchable = tweenEnabled;
        repeatInput.editable = tweenEnabled;
        repeatInput.grayed = !tweenEnabled;
        yoyoControl.host.grayed = !tweenEnabled;
        yoyoControl.host.touchable = tweenEnabled;
        pathInput.editable = tweenEnabled && actionType === 0;
        pathInput.grayed = !pathInput.editable;
        pathEditButton.grayed = !pathInput.editable;
        pathEditButton.touchable = pathInput.editable;
        customEaseInput.editable = tweenEnabled && Number(easeInput.value) === 31;
        customEaseInput.grayed = !customEaseInput.editable;
        customEaseEditButton.grayed = !customEaseInput.editable;
        customEaseEditButton.touchable = customEaseInput.editable;
        hint.text = soundAction && soundResources.length === 0
            ? "Sound value: import a sound into this package first."
            : `${TRANSITION_ACTIONS[actionType]} value: ${describeTransitionActionValue(actionType)}. One Apply creates one reversible updateTransition.`;
    };
    actionInput.on(fgui.Events.STATE_CHANGED, options.eventOwner, () => updateActionState(true));
    easeInput.on(fgui.Events.STATE_CHANGED, options.eventOwner, () => updateActionState(false));
    updateActionState(false);

    const confirm = content.getChild("n1").asButton;
    const cancel = content.getChild("n3").asButton;
    confirm.title = mode === "add" ? "Add Action" : "Apply";
    confirm.setXY(430, 342);
    confirm.setSize(92, 22);
    cancel.title = "Cancel";
    cancel.setXY(532, 342);
    cancel.setSize(92, 22);
    confirm.onClick(options.eventOwner, () => {
        const actionType = Number(actionInput.value);
        const tween = transitionActionSupportsTween(actionType) && tweenControl.button.selected;
        const item: TransitionItemModel = {
            ...sourceModel,
            actionType,
            targetNodeId: actionType === 9 ? "" : targetInput.value,
            time: readTimelineInteger(timeInput),
            duration: tween ? readTimelineInteger(durationInput) : 0,
            tween,
            startValue: actionType === 9
                ? [soundInput.value, String(readTimelineInteger(soundVolumeInput))]
                : parseTransitionActionValue(actionType, startInput.text),
            endValue: tween ? parseTransitionActionValue(actionType, endInput.text) : [],
            easeType: Number(easeInput.value),
            repeat: tween ? readTimelineInteger(repeatInput) : 0,
            yoyo: tween && yoyoControl.button.selected,
            label: labelInput.text,
            endLabel: endLabelInput.text,
            path: tween && actionType === 0 ? pathInput.text : "",
            customEasePath: tween && Number(easeInput.value) === 31 ? customEaseInput.text : "",
        };
        const preparation = mode === "add"
            ? prepareAddTransitionItemModel(
                options.getWorkingProject(),
                selector,
                transitionName,
                item,
            )
            : prepareUpdateTransitionItemModel(
                options.getWorkingProject(),
                selector,
                transitionName,
                itemIndex,
                item,
            );
        if (preparation.ok === false) {
            options.setStatus(`Timeline action unavailable: ${preparation.code}. ${preparation.message}`);
            return;
        }
        setActionEnabled(confirm, false);
        void options.applyPreparation(preparation).then((applied) => {
            if (!applied) {
                setActionEnabled(confirm, true);
                return;
            }
            options.onApplied(itemIndex);
            options.setDebugAttribute(
                "data-fairy-editor-timeline-item",
                `${transitionName}:${itemIndex}:${mode}`,
            );
            dialog.dispose();
            if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
        });
    });
    cancel.onClick(options.eventOwner, () => {
        dialog.dispose();
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
        options.setStatus("Timeline action edit cancelled.");
    });
    dialog.contentPane = content;
    dialog.show();
    options.setActiveDialog(dialog);
    options.setDebugAttribute("data-fairy-editor-timeline-editor", `${transitionName}:${itemIndex}:${mode}`);
    options.setStatus(`${mode === "add" ? "Adding" : "Editing"} ${transitionName} action ${itemIndex}.`);
}

function formatTransitionActionValue(actionType: number, values: unknown[]): string {
    if (actionType === 14 || actionType === 15) return String(values[0] ?? "");
    return values.map((value) => String(value)).join(",");
}

function parseTransitionActionValue(actionType: number, text: string): string[] {
    if (actionType === 14 || actionType === 15) return [text];
    return text.split(",").map((value) => value.trim());
}

function describeTransitionActionValue(actionType: number): string {
    return [
        "x,y or x,y,percentX,percentY", "width,height", "scaleX,scaleY", "pivotX,pivotY",
        "alpha", "degrees", "#RRGGBB", "frame,p|s[,animation,skin]",
        "true|false", "ui-url[,volume]", "transition[,playTimes]", "amplitude,duration",
        "brightness,contrast,saturation,hue", "skewX,skewY", "text", "ui-url",
    ][actionType] || "encoded values";
}

function readTimelineInteger(input: fgui.GTextInput): number {
    const text = input.text.trim();
    return text ? Number(text) : Number.NaN;
}
