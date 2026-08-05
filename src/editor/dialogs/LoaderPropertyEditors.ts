import { findComponent } from "../commands/AuthoringTransactionSupport";
import {
    readLoader3DProperties,
    readLoaderProperties,
} from "../commands/HighRiskAuthoringTransactions";
import type {
    Loader3DEditableProperties,
    LoaderEditableProperties,
} from "../model/EditorCommand";
import {
    addInspectorLine,
    createInspectorButton,
    createInspectorTextInput,
} from "../ui/EditorFormControls";
import type { PropertyEditorContext } from "./PropertyEditorContext";

export function showLoaderPropertiesEditor(options: PropertyEditorContext): void {
    const { selector, selectedNode } = options;
    const findLiveNode = () => selector
        ? findComponent(options.getWorkingProject(), selector)
            ?.displayList?.find((node) => node.id === selector.displayNodeId) || null
        : null;
    const liveNode = findLiveNode();
    if (!selector || !selectedNode || liveNode?.kind !== "loader") {
        options.setStatus("Loader properties unavailable: select a GLoader node.");
        return;
    }

    const current = readLoaderProperties(liveNode);
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopLoaderPropertiesDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(310, 450);
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `${selectedNode.name || selectedNode.id} - Loader`;
    content.getChild("n2").visible = false;

    const panel = fgui.UIPackage.createObject("Builder", "LoaderPropsPanel").asCom;
    panel.name = "loaderPropertiesPanel";
    panel.setXY(20, 34);
    content.addChild(panel);
    const label = (name: string): fgui.GLabel => panel.getChild(name).asLabel;
    label("url").title = current.url;
    panel.getChild("clearOnPublish").asButton.selected = current.clearOnPublish;
    panel.getChild("autoSize").asButton.selected = current.autoSize;
    const fill = panel.getChild("fill").asComboBox;
    fill.items = ["None", "Scale", "Match height", "Match width", "Free", "No border"];
    fill.selectedIndex = current.fill;
    panel.getChild("shrinkOnly").asButton.selected = current.shrinkOnly;
    panel.getController("align").selectedIndex = current.align;
    panel.getController("verticalAlign").selectedIndex = current.vAlign;
    label("frame").title = String(current.frame);
    panel.getChild("playing").asButton.selected = current.playing;
    const colorControl = panel.getChild("color");
    colorControl.enabled = false;
    colorControl.asCom.getChild("n1").asGraph.color = current.color;
    const colorInput = createInspectorTextInput(
        content,
        "loaderColorInput",
        165,
        196,
        120,
        current.color,
        true,
    );
    const fillMethod = panel.getChild("fillMethod").asComboBox;
    fillMethod.items = ["None", "Horizontal", "Vertical", "Radial 90", "Radial 180", "Radial 360"];
    fillMethod.selectedIndex = current.fillMethod;
    const fillOrigin = panel.getChild("fillOrigin").asComboBox;
    const fillClockwise = panel.getChild("fillClockwise").asButton;
    fillClockwise.selected = current.fillClockwise;
    label("fillAmount").title = String(current.fillAmount);
    const configureOrigin = (selectedIndex: number): void => {
        const method = fillMethod.selectedIndex;
        fillOrigin.items = method === 1
            ? ["Left", "Right"]
            : method === 2
                ? ["Top", "Bottom"]
                : method === 3
                    ? ["Top left", "Top right", "Bottom left", "Bottom right"]
                    : method >= 4
                        ? ["Top", "Bottom", "Left", "Right"]
                        : ["Default"];
        fillOrigin.selectedIndex = Math.min(Math.max(0, selectedIndex), fillOrigin.items.length - 1);
        fillClockwise.enabled = method >= 3;
    };
    configureOrigin(current.fillOrigin);
    fillMethod.on(fgui.Events.STATE_CHANGED, options.eventOwner, () => configureOrigin(0));

    const useResize = fgui.UIPackage.createObject("Basic", "Checkbox").asButton;
    useResize.name = "loaderUseResize";
    useResize.title = "Use resize";
    useResize.selected = current.useResize;
    useResize.setXY(105, 360);
    useResize.setSize(120, 20);
    content.addChild(useResize);
    addInspectorLine(content, "loaderCommonBoundary", "Scale and filter are edited in Common Properties.", 20, 388, 270, "#8ccf7e");

    const applyButton = createInspectorButton(content, "loaderPropertiesApply", "Apply", 20, 418, 80);
    const saveButton = content.getChild("n1").asButton;
    saveButton.title = "Save";
    saveButton.setXY(115, 418);
    saveButton.setSize(80, 22);
    const closeButton = content.getChild("n3").asButton;
    closeButton.title = "Close";
    closeButton.setXY(210, 418);
    closeButton.setSize(80, 22);
    content.setChildIndex(saveButton, content.numChildren - 1);
    content.setChildIndex(closeButton, content.numChildren - 1);

    const readProperties = (): LoaderEditableProperties | null => {
        const properties: LoaderEditableProperties = {
            url: label("url").title.trim(),
            fill: fill.selectedIndex,
            shrinkOnly: panel.getChild("shrinkOnly").asButton.selected,
            autoSize: panel.getChild("autoSize").asButton.selected,
            useResize: useResize.selected,
            align: panel.getController("align").selectedIndex,
            vAlign: panel.getController("verticalAlign").selectedIndex,
            frame: Number(label("frame").title.trim()),
            playing: panel.getChild("playing").asButton.selected,
            color: colorInput.text.trim(),
            fillMethod: fillMethod.selectedIndex,
            fillOrigin: fillOrigin.selectedIndex,
            fillClockwise: fillClockwise.selected,
            fillAmount: Number(label("fillAmount").title.trim()),
            clearOnPublish: panel.getChild("clearOnPublish").asButton.selected,
        };
        if (
            properties.fill < 0
            || properties.align < 0
            || properties.vAlign < 0
            || !Number.isInteger(properties.frame)
            || properties.frame < 0
            || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(properties.color)
            || properties.fillMethod < 0
            || properties.fillOrigin < 0
            || !Number.isFinite(properties.fillAmount)
            || properties.fillAmount < 0
            || properties.fillAmount > 100
        ) {
            options.setStatus("Loader fill, alignment, frame, color, or fill amount is invalid.");
            return null;
        }
        return properties;
    };

    let busy = false;
    const apply = async (close: boolean): Promise<void> => {
        if (busy) return;
        const updated = readProperties();
        const node = findLiveNode();
        if (!updated || node?.kind !== "loader") return;
        if (JSON.stringify(readLoaderProperties(node)) === JSON.stringify(updated)) {
            options.setStatus("Loader properties are unchanged.");
            if (close) dialog.dispose();
            return;
        }
        busy = true;
        try {
            const applied = await options.applyCommand({
                kind: "setDisplayNodeProps",
                selector,
                props: { loaderProperties: updated },
            }, `loader properties ${selector.displayNodeId}`);
            if (!applied) return;
            options.setDebugAttribute(
                "data-fairy-editor-loader-properties",
                `${selector.displayNodeId}:${updated.fill}:${updated.fillMethod}:${updated.fillAmount}`,
            );
            if (close) dialog.dispose();
        } finally {
            busy = false;
        }
    };
    const cleanup = (): void => {
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    };
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, cleanup);
    applyButton.onClick(options.eventOwner, () => void apply(false));
    saveButton.onClick(options.eventOwner, () => void apply(true));
    closeButton.onClick(options.eventOwner, () => {
        options.setStatus("Loader properties edit cancelled.");
        dialog.dispose();
    });
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute("data-fairy-editor-loader-properties-editor", selector.displayNodeId);
    options.setStatus(`Editing loader properties for ${selectedNode.name || selectedNode.id}.`);
}

export function showLoader3DPropertiesEditor(options: PropertyEditorContext): void {
    const { selector, selectedNode } = options;
    const findLiveNode = () => selector
        ? findComponent(options.getWorkingProject(), selector)
            ?.displayList?.find((node) => node.id === selector.displayNodeId) || null
        : null;
    const liveNode = findLiveNode();
    if (!selector || !selectedNode || liveNode?.kind !== "loader3D") {
        options.setStatus("Loader3D properties unavailable: select a GLoader3D node.");
        return;
    }

    const current = readLoader3DProperties(liveNode);
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopLoader3DPropertiesDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(310, 348);
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `${selectedNode.name || selectedNode.id} - Loader3D`;
    content.getChild("n2").visible = false;

    const panel = fgui.UIPackage.createObject("Builder", "Loader3DPropsPanel").asCom;
    panel.name = "loader3DPropertiesPanel";
    panel.setXY(20, 34);
    content.addChild(panel);
    panel.getChild("clearOnPublish").asButton.selected = current.clearOnPublish;
    panel.getChild("autoSize").asButton.selected = current.autoSize;
    const fill = panel.getChild("fill").asComboBox;
    fill.items = ["None", "Scale", "Match height", "Match width", "Free", "No border"];
    fill.selectedIndex = current.fill;
    panel.getChild("shrinkOnly").asButton.selected = current.shrinkOnly;
    panel.getController("align").selectedIndex = current.align;
    panel.getController("verticalAlign").selectedIndex = current.vAlign;
    panel.getChild("playing").asButton.selected = current.playing;
    panel.getChild("loop").asButton.selected = current.loop;
    for (const name of ["url", "color", "animationName", "frame", "skinName"]) {
        panel.getChild(name).visible = false;
    }
    const urlInput = createInspectorTextInput(content, "loader3DUrl", 107, 41, 152, current.url, true);
    const colorInput = createInspectorTextInput(content, "loader3DColor", 107, 172, 152, current.color, true);
    const animationInput = createInspectorTextInput(
        content,
        "loader3DAnimationName",
        107,
        198,
        152,
        current.animationName,
        true,
    );
    const frameInput = createInspectorTextInput(content, "loader3DFrame", 107, 227, 58, String(current.frame), true);
    const skinInput = createInspectorTextInput(content, "loader3DSkinName", 107, 257, 152, current.skinName, true);

    const applyButton = createInspectorButton(content, "loader3DPropertiesApply", "Apply", 20, 308, 80);
    const saveButton = content.getChild("n1").asButton;
    saveButton.title = "Save";
    saveButton.setXY(115, 308);
    saveButton.setSize(80, 22);
    const closeButton = content.getChild("n3").asButton;
    closeButton.title = "Close";
    closeButton.setXY(210, 308);
    closeButton.setSize(80, 22);
    content.setChildIndex(saveButton, content.numChildren - 1);
    content.setChildIndex(closeButton, content.numChildren - 1);

    const readProperties = (): Loader3DEditableProperties | null => {
        const properties: Loader3DEditableProperties = {
            url: urlInput.text.trim(),
            fill: fill.selectedIndex,
            shrinkOnly: panel.getChild("shrinkOnly").asButton.selected,
            autoSize: panel.getChild("autoSize").asButton.selected,
            align: panel.getController("align").selectedIndex,
            vAlign: panel.getController("verticalAlign").selectedIndex,
            animationName: animationInput.text.trim(),
            skinName: skinInput.text.trim(),
            playing: panel.getChild("playing").asButton.selected,
            frame: Number(frameInput.text.trim()),
            loop: panel.getChild("loop").asButton.selected,
            color: colorInput.text.trim(),
            clearOnPublish: panel.getChild("clearOnPublish").asButton.selected,
        };
        if (
            properties.fill < 0
            || properties.align < 0
            || properties.vAlign < 0
            || !Number.isInteger(properties.frame)
            || properties.frame < 0
            || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(properties.color)
        ) {
            options.setStatus("Loader3D fill, alignment, frame, or color is invalid.");
            return null;
        }
        return properties;
    };

    let busy = false;
    const apply = async (close: boolean): Promise<void> => {
        if (busy) return;
        const updated = readProperties();
        const node = findLiveNode();
        if (!updated || node?.kind !== "loader3D") return;
        if (JSON.stringify(readLoader3DProperties(node)) === JSON.stringify(updated)) {
            options.setStatus("Loader3D properties are unchanged.");
            if (close) dialog.dispose();
            return;
        }
        busy = true;
        try {
            const applied = await options.applyCommand({
                kind: "setDisplayNodeProps",
                selector,
                props: { loader3DProperties: updated },
            }, `Loader3D properties ${selector.displayNodeId}`);
            if (!applied) return;
            options.setDebugAttribute(
                "data-fairy-editor-loader3d-properties",
                `${selector.displayNodeId}:${updated.fill}:${updated.animationName}:${updated.frame}:${updated.clearOnPublish}`,
            );
            if (close) dialog.dispose();
        } finally {
            busy = false;
        }
    };
    const cleanup = (): void => {
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    };
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, cleanup);
    applyButton.onClick(options.eventOwner, () => void apply(false));
    saveButton.onClick(options.eventOwner, () => void apply(true));
    closeButton.onClick(options.eventOwner, () => {
        options.setStatus("Loader3D properties edit cancelled.");
        dialog.dispose();
    });
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute("data-fairy-editor-loader3d-properties-editor", selector.displayNodeId);
    options.setStatus(`Editing Loader3D properties for ${selectedNode.name || selectedNode.id}.`);
}
