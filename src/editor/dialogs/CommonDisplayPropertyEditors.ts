import { findComponent } from "../commands/AuthoringTransactionSupport";
import {
    readCommonDisplayProperties,
    readGroupProperties,
} from "../commands/DisplayListReaders";
import type {
    DisplayNodeCommonEditableProperties,
    GroupEditableProperties,
} from "../model/EditorCommand";
import {
    addInspectorLine,
    createInspectorButton,
    createInspectorCheckButton,
    createInspectorTextInput,
    createTimelineComboBox,
} from "../ui/EditorFormControls";
import type { EditorNumericInput } from "../ui/EditorUiExtensions";
import type { PropertyEditorContext } from "./PropertyEditorContext";

const BLEND_MODES = ["normal", "none", "add", "multiply", "screen", "erase"] as const;

export function showCommonDisplayPropertiesEditor(options: PropertyEditorContext): void {
    const { selector, selectedNode } = options;
    const findLiveNode = () => selector
        ? findComponent(options.getWorkingProject(), selector)
            ?.displayList?.find((node) => node.id === selector.displayNodeId) || null
        : null;
    const liveNode = findLiveNode();
    if (!selector || !selectedNode || !liveNode) {
        options.setStatus("Common properties unavailable: select a display node.");
        return;
    }

    const current = readCommonDisplayProperties(liveNode);
    options.getActiveDialog()?.dispose();
    const dialog = createDialog(`${selectedNode.name || selectedNode.id} - Common`, 480);
    const content = dialog.contentPane!;
    const pair = (name: string, label: string, y: number, x: number, yValue: number) => {
        addInspectorLine(content, `${name}Label`, label, 20, y + 4, 76, "#bdbdbd");
        return {
            x: createInspectorTextInput(content, `${name}X`, 100, y, 82, String(x), true),
            y: createInspectorTextInput(content, `${name}Y`, 192, y, 92, String(yValue), true),
        };
    };
    const scale = pair("commonScale", "Scale X / Y", 44, current.scale.x, current.scale.y);
    const skew = pair("commonSkew", "Skew X / Y", 72, current.skew.x, current.skew.y);
    const minSize = pair("commonMinSize", "Min W / H", 100, current.minSize.width, current.minSize.height);
    const maxSize = pair("commonMaxSize", "Max W / H", 128, current.maxSize.width, current.maxSize.height);
    const locked = createInspectorCheckButton(
        content, "commonLocked", "Editor locked", 20, 158, 126, current.locked,
        () => { locked.button.selected = !locked.button.selected; }, options.eventOwner,
    );
    const aspect = createInspectorCheckButton(
        content, "commonAspect", "Aspect lock", 158, 158, 126, current.aspect,
        () => { aspect.button.selected = !aspect.button.selected; }, options.eventOwner,
    );
    addInspectorLine(content, "commonTooltipsLabel", "Tooltips", 20, 188, 70, "#bdbdbd");
    const tooltips = createInspectorTextInput(content, "commonTooltips", 94, 184, 190, current.tooltips, true);
    addInspectorLine(content, "commonBlendLabel", "Blend", 20, 216, 70, "#bdbdbd");
    const blendMode = createTimelineComboBox(
        content, "commonBlendMode", 94, 212, 190,
        ["Normal", "None", "Add", "Multiply", "Screen", "Erase"],
        [...BLEND_MODES], Math.max(0, BLEND_MODES.indexOf(current.blendMode)),
    );
    addInspectorLine(content, "commonFilterLabel", "Filter", 20, 244, 70, "#bdbdbd");
    const filter = createTimelineComboBox(
        content, "commonFilter", 94, 240, 190,
        ["None", "Color"], ["", "color"], current.filter === "color" ? 1 : 0,
    );
    addInspectorLine(content, "commonFilterDataLabel", "Filter data", 20, 272, 70, "#bdbdbd");
    const filterPanel = fgui.UIPackage.createObject("Builder", "FilterPropsPanel").asCom;
    filterPanel.name = "commonFilterData";
    filterPanel.setXY(94, 268);
    content.addChild(filterPanel);
    const parsedFilterValues = current.filterData.split(",").map((value) => Number(value.trim()));
    const initialFilterValues = parsedFilterValues.length === 4 && parsedFilterValues.every(Number.isFinite)
        ? parsedFilterValues
        : [0, 0, 0, 0];
    const filterInputs = (["brightness", "contrast", "saturation", "hue"] as const).map((name, index) => {
        const input = filterPanel.getChild(name) as EditorNumericInput;
        input.configure();
        input.text = String(initialFilterValues[index]);
        return input;
    });
    const readFilterValues = (): number[] => filterInputs.map((input) => input.numberValue);
    const setFilterValues = (values: number[]): void => {
        for (let index = 0; index < filterInputs.length; index += 1) filterInputs[index].text = String(values[index]);
    };
    const syncFilterPanel = (): void => {
        const enabled = filter.value === "color";
        filterPanel.grayed = !enabled;
        filterPanel.touchable = enabled;
    };
    filter.on(fgui.Events.STATE_CHANGED, options.eventOwner, syncFilterPanel);
    syncFilterPanel();
    filterPanel.getChild("reset").asButton.onClick(options.eventOwner, () => setFilterValues([0, 0, 0, 0]));
    filterPanel.getChild("copy").asButton.onClick(options.eventOwner, () => {
        const values = readFilterValues();
        if (values.some((value) => !Number.isFinite(value))) {
            options.setStatus("Color filter values must be finite numbers.");
            return;
        }
        if (!navigator.clipboard) {
            options.setStatus("Color filter copy is unavailable in this browser context.");
            return;
        }
        void navigator.clipboard.writeText(values.join(",")).then(
            () => options.setStatus("Color filter copied."),
            () => options.setStatus("Color filter copy failed: clipboard permission was denied."),
        );
    });
    filterPanel.getChild("paste").asButton.onClick(options.eventOwner, () => {
        if (!navigator.clipboard) {
            options.setStatus("Color filter paste is unavailable in this browser context.");
            return;
        }
        void navigator.clipboard.readText().then((text) => {
            const values = text.split(",").map((value) => Number(value.trim()));
            if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
                options.setStatus("Clipboard must contain brightness,contrast,saturation,hue.");
                return;
            }
            setFilterValues(values);
            options.setStatus("Color filter pasted.");
        }, () => options.setStatus("Color filter paste failed: clipboard permission was denied."));
    });
    const readPair = (value: { x: fgui.GTextInput; y: fgui.GTextInput }) => ({
        x: Number(value.x.text.trim()),
        y: Number(value.y.text.trim()),
    });
    const readProperties = (): DisplayNodeCommonEditableProperties | null => {
        const filterValues = readFilterValues();
        const updated: DisplayNodeCommonEditableProperties = {
            locked: locked.button.selected,
            aspect: aspect.button.selected,
            scale: readPair(scale),
            skew: readPair(skew),
            minSize: { width: Number(minSize.x.text.trim()), height: Number(minSize.y.text.trim()) },
            maxSize: { width: Number(maxSize.x.text.trim()), height: Number(maxSize.y.text.trim()) },
            tooltips: tooltips.text,
            blendMode: BLEND_MODES.includes(blendMode.value as typeof BLEND_MODES[number])
                ? blendMode.value as typeof BLEND_MODES[number]
                : "normal",
            filter: filter.value === "color" ? "color" : "",
            filterData: filter.value === "color" ? filterValues.join(",") : "",
        };
        const numbers = [
            updated.scale.x, updated.scale.y, updated.skew.x, updated.skew.y,
            updated.minSize.width, updated.minSize.height, updated.maxSize.width, updated.maxSize.height,
        ];
        if (
            numbers.some((value) => !Number.isFinite(value))
            || [updated.minSize.width, updated.minSize.height, updated.maxSize.width, updated.maxSize.height]
                .some((value) => value < 0)
            || (updated.maxSize.width > 0 && updated.maxSize.width < updated.minSize.width)
            || (updated.maxSize.height > 0 && updated.maxSize.height < updated.minSize.height)
            || (updated.filter === "color" && (
                filterValues.length !== 4 || filterValues.some((value) => !Number.isFinite(value))
            ))
        ) {
            options.setStatus("Common scale, skew, min/max size, or color filter data is invalid.");
            return null;
        }
        return updated;
    };
    bindDialogActions(options, dialog, "common", 442, async (close) => {
        const updated = readProperties();
        const node = findLiveNode();
        if (!updated || !node) return false;
        if (JSON.stringify(readCommonDisplayProperties(node)) === JSON.stringify(updated)) {
            options.setStatus("Common display properties are unchanged.");
            return true;
        }
        const applied = await options.applyCommand({ kind: "setDisplayNodeProps", selector, props: updated }, `common display properties ${selector.displayNodeId}`);
        if (applied) {
            options.setDebugAttribute("data-fairy-editor-common-properties", `${selector.displayNodeId}:${updated.blendMode}:${updated.filter || "none"}`);
            if (close) dialog.dispose();
        }
        return applied;
    });
    showDialog(options, dialog, "data-fairy-editor-common-properties-editor", selector.displayNodeId, `Editing common properties for ${selectedNode.name || selectedNode.id}.`);
}

export function showGroupPropertiesEditor(options: PropertyEditorContext): void {
    const { selector, selectedNode } = options;
    const findLiveNode = () => selector
        ? findComponent(options.getWorkingProject(), selector)
            ?.displayList?.find((node) => node.id === selector.displayNodeId) || null
        : null;
    const liveNode = findLiveNode();
    if (!selector || !selectedNode || liveNode?.kind !== "group") {
        options.setStatus("Group properties unavailable: select a GGroup node.");
        return;
    }
    const current = readGroupProperties(liveNode);
    options.getActiveDialog()?.dispose();
    const dialog = createDialog(`${selectedNode.name || selectedNode.id} - Group`, 340);
    const content = dialog.contentPane!;
    addInspectorLine(content, "groupLayoutLabel", "Layout", 20, 48, 70, "#bdbdbd");
    const layout = createTimelineComboBox(content, "groupLayout", 94, 44, 190, ["None", "Horizontal", "Vertical"], ["0", "1", "2"], current.layout);
    addInspectorLine(content, "groupLineGapLabel", "Line gap", 20, 80, 70, "#bdbdbd");
    const lineGap = createInspectorTextInput(content, "groupLineGap", 94, 76, 72, String(current.lineGap), true);
    addInspectorLine(content, "groupColumnGapLabel", "Column gap", 174, 80, 78, "#bdbdbd");
    const columnGap = createInspectorTextInput(content, "groupColumnGap", 252, 76, 32, String(current.columnGap), true);
    const advanced = createInspectorCheckButton(content, "groupAdvanced", "Advanced", 20, 108, 126, current.advanced, () => { advanced.button.selected = !advanced.button.selected; }, options.eventOwner);
    const exclude = createInspectorCheckButton(content, "groupExclude", "Exclude invisible", 158, 108, 126, current.excludeInvisibles, () => { exclude.button.selected = !exclude.button.selected; }, options.eventOwner);
    const autoSizeDisabled = createInspectorCheckButton(content, "groupAutoSizeDisabled", "Disable auto size", 20, 138, 126, current.autoSizeDisabled, () => { autoSizeDisabled.button.selected = !autoSizeDisabled.button.selected; }, options.eventOwner);
    addInspectorLine(content, "groupMainGridLabel", "Main grid index", 158, 142, 88, "#bdbdbd");
    const mainGridIndex = createInspectorTextInput(content, "groupMainGridIndex", 248, 138, 36, String(current.mainGridIndex), true);
    addInspectorLine(content, "groupBoundary", "Non-advanced or None layout normalizes dependent fields.", 20, 178, 270, "#8ccf7e");

    const readProperties = (): GroupEditableProperties | null => {
        const updated: GroupEditableProperties = {
            layout: Number(layout.value),
            lineGap: Number(lineGap.text.trim()),
            columnGap: Number(columnGap.text.trim()),
            advanced: advanced.button.selected,
            excludeInvisibles: exclude.button.selected,
            autoSizeDisabled: autoSizeDisabled.button.selected,
            mainGridIndex: Number(mainGridIndex.text.trim()),
        };
        if (!updated.advanced || updated.layout === 0) {
            updated.layout = 0;
            updated.lineGap = 0;
            updated.columnGap = 0;
            updated.excludeInvisibles = false;
            updated.autoSizeDisabled = false;
            updated.mainGridIndex = -1;
        }
        if (
            !Number.isInteger(updated.layout) || updated.layout < 0 || updated.layout > 2
            || !Number.isFinite(updated.lineGap) || !Number.isFinite(updated.columnGap)
            || !Number.isInteger(updated.mainGridIndex) || updated.mainGridIndex < -1
        ) {
            options.setStatus("Group layout, gaps, or main grid index is invalid.");
            return null;
        }
        return updated;
    };
    bindDialogActions(options, dialog, "group", 282, async (close) => {
        const updated = readProperties();
        const node = findLiveNode();
        if (!updated || node?.kind !== "group") return false;
        if (JSON.stringify(readGroupProperties(node)) === JSON.stringify(updated)) {
            options.setStatus("Group properties are unchanged.");
            return true;
        }
        const applied = await options.applyCommand({ kind: "setDisplayNodeProps", selector, props: { groupProperties: updated } }, `group properties ${selector.displayNodeId}`);
        if (applied) {
            options.setDebugAttribute("data-fairy-editor-group-properties", `${selector.displayNodeId}:${updated.layout}:${updated.mainGridIndex}`);
            if (close) dialog.dispose();
        }
        return applied;
    });
    showDialog(options, dialog, "data-fairy-editor-group-properties-editor", selector.displayNodeId, `Editing group properties for ${selectedNode.name || selectedNode.id}.`);
}

function createDialog(title: string, height: number): fgui.Window {
    const dialog = new fgui.Window();
    dialog.modal = true;
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(310, height);
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = title;
    content.getChild("n2").visible = false;
    dialog.contentPane = content;
    return dialog;
}

function bindDialogActions(
    options: PropertyEditorContext,
    dialog: fgui.Window,
    prefix: string,
    y: number,
    apply: (close: boolean) => Promise<boolean>,
): void {
    const content = dialog.contentPane!;
    const applyButton = createInspectorButton(content, `${prefix}PropertiesApply`, "Apply", 20, y, 80);
    const saveButton = content.getChild("n1").asButton;
    saveButton.title = "Save";
    saveButton.setXY(115, y);
    saveButton.setSize(80, 22);
    const closeButton = content.getChild("n3").asButton;
    closeButton.title = "Close";
    closeButton.setXY(210, y);
    closeButton.setSize(80, 22);
    let busy = false;
    const run = async (close: boolean): Promise<void> => {
        if (busy) return;
        busy = true;
        try { await apply(close); } finally { busy = false; }
    };
    applyButton.onClick(options.eventOwner, () => void run(false));
    saveButton.onClick(options.eventOwner, () => void run(true));
    closeButton.onClick(options.eventOwner, () => dialog.dispose());
}

function showDialog(
    options: PropertyEditorContext,
    dialog: fgui.Window,
    debugName: string,
    debugValue: string,
    status: string,
): void {
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => {
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    });
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute(debugName, debugValue);
    options.setStatus(status);
}
