import {
    readGraphProperties,
    readImageProperties,
    readMovieClipProperties,
    readTextInputProperties,
    readTextProperties,
} from "../commands/HighRiskAuthoringTransactions";
import { findComponent } from "../commands/AuthoringTransactionSupport";
import type {
    GraphEditableProperties,
    ImageEditableProperties,
    MovieClipEditableProperties,
    TextEditableProperties,
    TextInputEditableProperties,
} from "../model/EditorCommand";
import {
    addDialogBackground,
    createInspectorButton,
    createInspectorTextInput,
} from "../ui/EditorFormControls";
import type { PropertyEditorContext } from "./PropertyEditorContext";

function bindColorPicker(
    button: fgui.GButton,
    initial: string,
    owner: object,
    ariaLabel: string,
): { read: () => string; dispose: () => void } {
    let value = /^#[0-9a-f]{6}$/i.test(initial) ? initial : "#FFFFFF";
    let input: HTMLInputElement | null = null;
    const swatch = button.getChild("n1").asGraph;
    const sync = (): void => {
        swatch.fillColor = value;
        button.tooltips = `${ariaLabel}: ${value}`;
    };
    const dispose = (): void => {
        input?.remove();
        input = null;
    };
    sync();
    button.onClick(owner, () => {
        dispose();
        input = document.createElement("input");
        input.type = "color";
        input.value = value;
        input.setAttribute("aria-label", ariaLabel);
        input.style.position = "fixed";
        input.style.left = "-100px";
        input.style.top = "-100px";
        input.addEventListener("input", () => {
            value = input!.value;
            sync();
        });
        input.addEventListener("change", dispose, { once: true });
        document.body.appendChild(input);
        input.click();
    });
    return { read: () => value, dispose };
}

export function showImagePropertiesEditor(options: PropertyEditorContext): void {
    const { selector, selectedNode } = options;
    const findLiveNode = () => selector
        ? findComponent(options.getWorkingProject(), selector)
            ?.displayList?.find((node) => node.id === selector.displayNodeId) || null
        : null;
    const liveNode = findLiveNode();
    if (!selector || !selectedNode || liveNode?.kind !== "image") {
        options.setStatus("Image properties unavailable: select an image node.");
        return;
    }
    const current = readImageProperties(liveNode);
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopImagePropertiesDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(310, 300);
    addDialogBackground(content);
    content.getChild("frame").asLabel.title = `${selectedNode.name || selectedNode.id} - Image`;
    content.getChild("n2").visible = false;
    const panel = fgui.UIPackage.createObject("Builder", "ImagePropsPanel").asCom;
    panel.name = "imagePropertiesPanel";
    panel.setXY(20, 34);
    panel.getChild("brightness").visible = false;
    panel.getChild("n75").visible = false;
    panel.getChild("flipHZ").asButton.selected = Boolean(current.flip & 1);
    panel.getChild("flipVT").asButton.selected = Boolean(current.flip & 2);
    const fillMethod = panel.getChild("fillMethod").asComboBox;
    fillMethod.items = ["None", "Horizontal", "Vertical", "Radial 90", "Radial 180", "Radial 360"];
    fillMethod.values = ["0", "1", "2", "3", "4", "5"];
    fillMethod.selectedIndex = current.fillMethod;
    const fillOrigin = panel.getChild("fillOrigin").asComboBox;
    fillOrigin.items = ["Top / Left", "Bottom / Right", "Center", "Alternate"];
    fillOrigin.values = ["0", "1", "2", "3"];
    fillOrigin.selectedIndex = current.fillOrigin;
    panel.getChild("fillClockwise").asButton.selected = current.fillClockwise;
    panel.getChild("fillAmount").asLabel.title = String(current.fillMethod === 0 ? 100 : current.fillAmount * 100);
    content.addChild(panel);
    const color = bindColorPicker(panel.getChild("color").asButton, current.color, options.eventOwner, "Image color");
    const applyButton = createInspectorButton(content, "imagePropertiesApply", "Apply", 20, 260, 80);
    const saveButton = content.getChild("n1").asButton;
    saveButton.title = "Save";
    saveButton.setXY(115, 260);
    saveButton.setSize(80, 22);
    const closeButton = content.getChild("n3").asButton;
    closeButton.title = "Close";
    closeButton.setXY(210, 260);
    closeButton.setSize(80, 22);
    let busy = false;
    const apply = async (close: boolean): Promise<void> => {
        if (busy) return;
        const method = fillMethod.selectedIndex;
        const amountPercent = Number(panel.getChild("fillAmount").asLabel.title.trim());
        const updated: ImageEditableProperties = {
            color: color.read(),
            flip: (panel.getChild("flipHZ").asButton.selected ? 1 : 0)
                | (panel.getChild("flipVT").asButton.selected ? 2 : 0),
            fillMethod: method,
            fillOrigin: method === 0 ? 0 : fillOrigin.selectedIndex,
            fillClockwise: method === 0 || panel.getChild("fillClockwise").asButton.selected,
            fillAmount: method === 0 ? 100 : amountPercent / 100,
        };
        if (!Number.isFinite(amountPercent) || amountPercent < 0 || amountPercent > 100) {
            options.setStatus("Image fill amount must be between 0 and 100.");
            return;
        }
        if (JSON.stringify(readImageProperties(findLiveNode()!)) === JSON.stringify(updated)) {
            options.setStatus("Image properties are unchanged.");
            if (close) dialog.dispose();
            return;
        }
        busy = true;
        try {
            const applied = await options.applyCommand({
                kind: "setDisplayNodeProps",
                selector,
                props: { imageProperties: updated },
            }, `image properties ${selector.displayNodeId}`);
            if (applied && close) dialog.dispose();
        } finally {
            busy = false;
        }
    };
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => {
        color.dispose();
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    });
    applyButton.onClick(options.eventOwner, () => void apply(false));
    saveButton.onClick(options.eventOwner, () => void apply(true));
    closeButton.onClick(options.eventOwner, () => dialog.dispose());
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setStatus(`Editing image properties for ${selectedNode.name || selectedNode.id}.`);
}

export function showMovieClipPropertiesEditor(options: PropertyEditorContext): void {
    const { selector, selectedNode } = options;
    const findLiveNode = () => selector
        ? findComponent(options.getWorkingProject(), selector)
            ?.displayList?.find((node) => node.id === selector.displayNodeId) || null
        : null;
    const liveNode = findLiveNode();
    if (!selector || !selectedNode || liveNode?.kind !== "movieClip") {
        options.setStatus("MovieClip properties unavailable: select a MovieClip node.");
        return;
    }
    const current = readMovieClipProperties(liveNode);
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopMovieClipPropertiesDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(310, 200);
    addDialogBackground(content);
    content.getChild("frame").asLabel.title = `${selectedNode.name || selectedNode.id} - MovieClip`;
    content.getChild("n2").visible = false;
    const panel = fgui.UIPackage.createObject("Builder", "MovieClipPropsPanel").asCom;
    panel.name = "movieClipPropertiesPanel";
    panel.setXY(20, 34);
    panel.getChild("brightness").visible = false;
    panel.getChild("n73").visible = false;
    panel.getChild("frame").asLabel.title = String(current.frame);
    panel.getChild("playing").asButton.selected = current.playing;
    content.addChild(panel);
    const color = bindColorPicker(panel.getChild("color").asButton, current.color, options.eventOwner, "MovieClip color");
    const applyButton = createInspectorButton(content, "movieClipPropertiesApply", "Apply", 20, 160, 80);
    const saveButton = content.getChild("n1").asButton;
    saveButton.title = "Save";
    saveButton.setXY(115, 160);
    saveButton.setSize(80, 22);
    const closeButton = content.getChild("n3").asButton;
    closeButton.title = "Close";
    closeButton.setXY(210, 160);
    closeButton.setSize(80, 22);
    let busy = false;
    const apply = async (close: boolean): Promise<void> => {
        if (busy) return;
        const updated: MovieClipEditableProperties = {
            frame: Number(panel.getChild("frame").asLabel.title.trim()),
            playing: panel.getChild("playing").asButton.selected,
            color: color.read(),
        };
        if (!Number.isInteger(updated.frame) || updated.frame < 0) {
            options.setStatus("MovieClip frame must be a non-negative integer.");
            return;
        }
        if (JSON.stringify(readMovieClipProperties(findLiveNode()!)) === JSON.stringify(updated)) {
            options.setStatus("MovieClip properties are unchanged.");
            if (close) dialog.dispose();
            return;
        }
        busy = true;
        try {
            const applied = await options.applyCommand({
                kind: "setDisplayNodeProps",
                selector,
                props: { movieClipProperties: updated },
            }, `movie clip properties ${selector.displayNodeId}`);
            if (applied && close) dialog.dispose();
        } finally {
            busy = false;
        }
    };
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => {
        color.dispose();
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    });
    applyButton.onClick(options.eventOwner, () => void apply(false));
    saveButton.onClick(options.eventOwner, () => void apply(true));
    closeButton.onClick(options.eventOwner, () => dialog.dispose());
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setStatus(`Editing MovieClip properties for ${selectedNode.name || selectedNode.id}.`);
}

export function showTextPropertiesEditor(options: PropertyEditorContext): void {
    const { selector, selectedNode } = options;
    const findLiveNode = () => selector
        ? findComponent(options.getWorkingProject(), selector)
            ?.displayList?.find((node) => node.id === selector.displayNodeId) || null
        : null;
    const liveNode = findLiveNode();
    if (
        !selector
        || !selectedNode
        || !liveNode
        || (liveNode.kind !== "text" && liveNode.kind !== "richText" && liveNode.kind !== "textInput")
    ) {
        options.setStatus("Text properties unavailable: select a text, rich text, or text input node.");
        return;
    }

    const nodeKind = liveNode.kind;
    const isPlainText = nodeKind !== "richText";
    const currentProperties = readTextProperties(liveNode);
    const currentInputProperties = nodeKind === "textInput" ? readTextInputProperties(liveNode) : null;
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopTextPropertiesDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    const contentHeight = currentInputProperties ? 730 : 530;
    const buttonY = contentHeight - 40;
    content.setSize(310, contentHeight);
    addDialogBackground(content);
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `${selectedNode.name || selectedNode.id} - Text`;
    content.getChild("n2").visible = false;

    const panel = fgui.UIPackage.createObject("Builder", "TextPropsPanel").asCom;
    panel.name = "textPropertiesPanel";
    panel.setXY(20, 34);
    content.addChild(panel);
    const label = (name: string): fgui.GLabel => panel.getChild(name).asLabel;
    const check = (name: string): fgui.GButton => panel.getChild(name).asButton;
    label("text").title = String(liveNode.text || "");
    label("font").title = String(liveNode.font || "");
    label("fontSize").title = String(liveNode.fontSize || 12);
    label("leading").title = String(currentProperties.leading);
    label("letterSpacing").title = String(currentProperties.letterSpacing);
    check("ubbEnabled").selected = currentProperties.ubbEnabled;
    check("varsEnabled").selected = currentProperties.templateVarsEnabled === true;
    check("singleLine").selected = currentProperties.singleLine;
    check("bold").selected = currentProperties.bold;
    check("italic").selected = currentProperties.italic;
    check("underline").selected = currentProperties.underline;
    check("strike").selected = currentProperties.strikethrough;
    panel.getController("align").selectedIndex = currentProperties.align;
    panel.getController("verticalAlign").selectedIndex = currentProperties.vAlign;
    const autoSize = panel.getChild("autoSize").asComboBox;
    autoSize.items = ["None", "Both", "Height", "Shrink", "Ellipsis"];
    autoSize.values = ["0", "1", "2", "3", "4"];
    autoSize.selectedIndex = currentProperties.autoSize;

    const color = panel.getChild("color").asButton;
    const colorSwatch = color.getChild("n1").asGraph;
    let textColor = /^#[0-9a-f]{6}$/i.test(String(liveNode.color))
        ? String(liveNode.color)
        : "#000000";
    colorSwatch.fillColor = textColor;
    color.tooltips = `文本颜色：${textColor}`;
    let colorPicker: HTMLInputElement | null = null;
    const removeColorPicker = (): void => {
        colorPicker?.remove();
        colorPicker = null;
    };
    color.onClick(options.eventOwner, () => {
        removeColorPicker();
        const input = document.createElement("input");
        input.type = "color";
        input.value = textColor;
        input.setAttribute("aria-label", "Text color");
        input.setAttribute("data-fairy-editor-text-color", selector.displayNodeId);
        input.style.position = "fixed";
        input.style.left = "-100px";
        input.style.top = "-100px";
        input.addEventListener("input", () => {
            textColor = input.value;
            colorSwatch.fillColor = textColor;
            color.tooltips = `文本颜色：${textColor}`;
        });
        input.addEventListener("change", removeColorPicker, { once: true });
        document.body.appendChild(input);
        colorPicker = input;
        input.click();
    });
    const clearOnPublish = check("clearOnPublish");
    clearOnPublish.selected = currentProperties.autoClearText;
    clearOnPublish.enabled = true;
    clearOnPublish.tooltips = "发布时清除文本";
    const varsEnabled = check("varsEnabled");
    varsEnabled.enabled = isPlainText;
    if (!isPlainText) varsEnabled.tooltips = "Template variables are only persisted for plain text nodes.";
    panel.getChild("inputEdit").visible = false;
    const fontControl = panel.getChild("font").asCom;
    let fontMenu: fgui.PopupMenu | null = null;
    const showFontMenu = (anchor: fgui.GObject): void => {
        fontMenu?.dispose();
        const menu = new fgui.PopupMenu();
        fontMenu = menu;
        const systemItem = menu.addItem("系统 / 自定义（手动输入）", () => undefined);
        systemItem.enabled = false;
        for (const resource of options.selectedPackage?.resources || []) {
            if (resource.type !== "FontResource") continue;
            const item = menu.addItem(resource.name || resource.id, () => {
                label("font").title = `ui://${options.selectedPackage!.id}${resource.id}`;
                options.setDebugAttribute("data-fairy-editor-font-resource", resource.id);
            });
            item.name = `textFontResource_${resource.id}`;
        }
        menu.show(anchor);
    };
    for (const name of ["chooseFont", "preset"]) {
        const child = fontControl.getChild(name);
        if (child) child.onClick(options.eventOwner, () => showFontMenu(child));
    }

    const effectPanel = fgui.UIPackage.createObject("Builder", "TextEffectProPropsPanel").asCom;
    effectPanel.name = "textEffectPropertiesPanel";
    effectPanel.setXY(20, 294);
    content.addChild(effectPanel);
    const strokeEnabled = effectPanel.getChild("stroke").asButton;
    const shadowEnabled = effectPanel.getChild("shadow").asButton;
    strokeEnabled.selected = currentProperties.strokeColor !== null;
    shadowEnabled.selected = currentProperties.shadowColor !== null;
    effectPanel.getChild("faceDilate").asLabel.title = String(currentProperties.faceDilate || 0);
    effectPanel.getChild("outlineSoftness").asLabel.title = String(currentProperties.outlineSoftness);
    effectPanel.getChild("strokeSize").asLabel.title = String(currentProperties.strokeSize);
    effectPanel.getChild("shadowX").asLabel.title = String(currentProperties.shadowOffset.x);
    effectPanel.getChild("shadowY").asLabel.title = String(currentProperties.shadowOffset.y);
    effectPanel.getChild("underlaySoftness").asLabel.title = String(currentProperties.underlaySoftness);
    const effectPickers: HTMLInputElement[] = [];
    const bindEffectColor = (name: "strokeColor" | "shadowColor", initial: string | null): (() => string) => {
        const button = effectPanel.getChild(name).asButton;
        const swatch = button.getChild("n1").asGraph;
        let value = /^#[0-9a-f]{6}$/i.test(initial || "") ? initial! : "#000000";
        swatch.fillColor = value;
        button.tooltips = `${name === "strokeColor" ? "描边" : "阴影"}颜色：${value}`;
        button.onClick(options.eventOwner, () => {
            const input = document.createElement("input");
            input.type = "color";
            input.value = value;
            input.setAttribute("aria-label", name === "strokeColor" ? "Stroke color" : "Shadow color");
            input.style.position = "fixed";
            input.style.left = "-100px";
            input.style.top = "-100px";
            input.addEventListener("input", () => {
                value = input.value;
                swatch.fillColor = value;
                button.tooltips = `${name === "strokeColor" ? "描边" : "阴影"}颜色：${value}`;
            });
            input.addEventListener("change", () => input.remove(), { once: true });
            document.body.appendChild(input);
            effectPickers.push(input);
            input.click();
        });
        return () => value;
    };
    const readStrokeColor = bindEffectColor("strokeColor", currentProperties.strokeColor);
    const readShadowColor = bindEffectColor("shadowColor", currentProperties.shadowColor);

    let inputPanel: fgui.GComponent | null = null;
    if (currentInputProperties) {
        inputPanel = fgui.UIPackage.createObject("Builder", "InputPropsPanel").asCom;
        inputPanel.name = "textInputPropertiesPanel";
        inputPanel.setXY(22, 484);
        content.addChild(inputPanel);
        inputPanel.getChild("promptText").asLabel.title = currentInputProperties.promptText;
        inputPanel.getChild("maxLength").asLabel.title = String(currentInputProperties.maxLength);
        inputPanel.getChild("restrict").asLabel.title = currentInputProperties.restrict;
        inputPanel.getChild("password").asButton.selected = currentInputProperties.password;
        const keyboard = inputPanel.getChild("keyboardType").asComboBox;
        keyboard.items = ["Default", "ASCII", "Numbers and punctuation", "URL", "Number", "Phone", "Email"];
        keyboard.values = ["0", "1", "2", "3", "4", "5", "6"];
        keyboard.selectedIndex = Math.min(6, Math.max(0, currentInputProperties.keyboardType));
    }

    const applyButton = createInspectorButton(content, "textPropertiesApply", "Apply", 20, buttonY, 80);
    const saveButton = content.getChild("n1").asButton;
    saveButton.title = "Save";
    saveButton.setXY(115, buttonY);
    saveButton.setSize(80, 22);
    const closeButton = content.getChild("n3").asButton;
    closeButton.title = "Close";
    closeButton.setXY(210, buttonY);
    closeButton.setSize(80, 22);
    content.setChildIndex(saveButton, content.numChildren - 1);
    content.setChildIndex(closeButton, content.numChildren - 1);

    let busy = false;
    const readProperties = (): {
        text: string;
        font: string;
        fontSize: number;
        color: string;
        properties: TextEditableProperties;
        inputProperties: TextInputEditableProperties | null;
    } | null => {
        const fontSize = Number(label("fontSize").title.trim());
        const leading = Number(label("leading").title.trim());
        const letterSpacing = Number(label("letterSpacing").title.trim());
        if (!Number.isFinite(fontSize) || fontSize <= 0 || !Number.isFinite(leading) || !Number.isFinite(letterSpacing)) {
            options.setStatus("Text font size, leading, and letter spacing must be valid numbers.");
            return null;
        }
        const faceDilate = Number(effectPanel.getChild("faceDilate").asLabel.title.trim());
        const strokeSize = Number(effectPanel.getChild("strokeSize").asLabel.title.trim());
        const shadowX = Number(effectPanel.getChild("shadowX").asLabel.title.trim());
        const shadowY = Number(effectPanel.getChild("shadowY").asLabel.title.trim());
        const outlineSoftness = Number(effectPanel.getChild("outlineSoftness").asLabel.title.trim());
        const underlaySoftness = Number(effectPanel.getChild("underlaySoftness").asLabel.title.trim());
        if ([faceDilate, strokeSize, shadowX, shadowY, outlineSoftness, underlaySoftness].some((value) => !Number.isFinite(value)) || strokeSize < 0) {
            options.setStatus("Text effect values must be valid numbers and stroke size cannot be negative.");
            return null;
        }
        let inputProperties: TextInputEditableProperties | null = null;
        if (currentInputProperties && inputPanel) {
            const maxLength = Number(inputPanel.getChild("maxLength").asLabel.title.trim());
            if (!Number.isInteger(maxLength) || maxLength < 0) {
                options.setStatus("Text input maximum length must be a non-negative integer.");
                return null;
            }
            inputProperties = {
                promptText: inputPanel.getChild("promptText").asLabel.title,
                maxLength,
                restrict: inputPanel.getChild("restrict").asLabel.title,
                password: inputPanel.getChild("password").asButton.selected,
                keyboardType: inputPanel.getChild("keyboardType").asComboBox.selectedIndex,
            };
        }
        const updated: TextEditableProperties = {
            ...structuredClone(currentProperties),
            text: label("text").title,
            font: label("font").title.trim(),
            fontSize,
            color: textColor,
            align: panel.getController("align").selectedIndex,
            vAlign: panel.getController("verticalAlign").selectedIndex,
            leading,
            letterSpacing,
            autoSize: autoSize.selectedIndex,
            singleLine: check("singleLine").selected,
            autoClearText: clearOnPublish.selected,
            templateVarsEnabled: isPlainText
                ? check("varsEnabled").selected
                : currentProperties.templateVarsEnabled,
            ubbEnabled: check("ubbEnabled").selected,
            underline: check("underline").selected,
            italic: check("italic").selected,
            bold: check("bold").selected,
            strikethrough: check("strike").selected,
            faceDilate,
            outlineSoftness,
            underlaySoftness,
            strokeColor: strokeEnabled.selected ? readStrokeColor() : null,
            strokeSize,
            shadowColor: shadowEnabled.selected ? readShadowColor() : null,
            shadowOffset: { x: shadowX, y: shadowY },
        };
        return {
            text: label("text").title,
            font: label("font").title.trim(),
            fontSize,
            color: textColor,
            properties: updated,
            inputProperties,
        };
    };
    const apply = async (close: boolean): Promise<void> => {
        if (busy) return;
        const updated = readProperties();
        const current = findLiveNode();
        if (!updated || !current) return;
        if (
            String(current.text || "") === updated.text
            && String(current.font || "") === updated.font
            && Number(current.fontSize || 12) === updated.fontSize
            && String(current.color || "#000000").toLowerCase() === updated.color.toLowerCase()
            && JSON.stringify(readTextProperties(current)) === JSON.stringify(updated.properties)
            && JSON.stringify(currentInputProperties ? readTextInputProperties(current) : null) === JSON.stringify(updated.inputProperties)
        ) {
            options.setStatus("Text properties are unchanged.");
            if (close) dialog.dispose();
            return;
        }
        busy = true;
        try {
            const applied = await options.applyCommand({
                kind: "setDisplayNodeProps",
                selector,
                props: {
                    text: updated.text,
                    font: updated.font,
                    fontSize: updated.fontSize,
                    color: updated.color,
                    textProperties: updated.properties,
                    ...(updated.inputProperties ? { textInputProperties: updated.inputProperties } : {}),
                },
            }, `text properties ${selector.displayNodeId}`);
            if (!applied) return;
            options.setDebugAttribute(
                "data-fairy-editor-text-properties",
                `${selector.displayNodeId}:${updated.properties.align}:${updated.properties.vAlign}:${updated.properties.autoSize}:${updated.properties.bold}:${updated.properties.ubbEnabled}`,
            );
            if (close) dialog.dispose();
        } finally {
            busy = false;
        }
    };
    const cleanup = (): void => {
        removeColorPicker();
        for (const input of effectPickers) input.remove();
        fontMenu?.dispose();
        fontMenu = null;
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    };
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, cleanup);
    applyButton.onClick(options.eventOwner, () => void apply(false));
    saveButton.onClick(options.eventOwner, () => void apply(true));
    closeButton.onClick(options.eventOwner, () => {
        options.setStatus("Text properties edit cancelled.");
        dialog.dispose();
    });
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute(
        "data-fairy-editor-text-properties-editor",
        `${selector.displayNodeId}:${nodeKind}`,
    );
    options.setStatus(`Editing ${nodeKind} properties for ${selectedNode.name || selectedNode.id}.`);
}

export function showGraphPropertiesEditor(options: PropertyEditorContext): void {
    const { selector, selectedNode } = options;
    const findLiveNode = () => selector
        ? findComponent(options.getWorkingProject(), selector)
            ?.displayList?.find((node) => node.id === selector.displayNodeId) || null
        : null;
    const liveNode = findLiveNode();
    if (!selector || !selectedNode || liveNode?.kind !== "graph") {
        options.setStatus("Graph properties unavailable: select a graph node.");
        return;
    }

    const currentProperties = readGraphProperties(liveNode);
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopGraphPropertiesDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(310, 310);
    addDialogBackground(content);
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `${selectedNode.name || selectedNode.id} - Graph`;
    content.getChild("n2").visible = false;

    const panel = fgui.UIPackage.createObject("Builder", "GraphPropsPanel").asCom;
    panel.name = "graphPropertiesPanel";
    panel.setXY(20, 34);
    panel.setSize(270, 214);
    content.addChild(panel);
    const label = (name: string): fgui.GLabel => panel.getChild(name).asLabel;
    const shapePages = ["blank", "rect", "ellipse", "polygon", "regular_polygon"];
    const type = panel.getChild("type").asComboBox;
    type.items = ["Blank", "Rectangle", "Ellipse", "Polygon", "Regular polygon"];
    type.values = ["0", "1", "2", "3", "4"];
    type.selectedIndex = currentProperties.graphType;
    const shape = panel.getController("shape");
    shape.selectedPage = shapePages[currentProperties.graphType] || "blank";
    type.on(fgui.Events.STATE_CHANGED, options.eventOwner, () => {
        shape.selectedPage = shapePages[type.selectedIndex] || "blank";
    });
    label("lineSize").title = String(currentProperties.lineSize);
    label("cornerRadius").title = currentProperties.cornerRadius?.join(",") || "";
    label("sides").title = String(currentProperties.sides);
    label("startAngle").title = String(currentProperties.startAngle);

    for (const [name, color] of [
        ["lineColor", currentProperties.lineColor],
        ["fillColor", currentProperties.fillColor],
    ] as const) {
        const colorControl = panel.getChild(name);
        colorControl.enabled = false;
        colorControl.tooltips = "Edit the hexadecimal value beside this swatch.";
        colorControl.asCom.getChild("n1").asGraph.color = color;
    }
    let points = currentProperties.points ? [...currentProperties.points] : [];
    let distances = currentProperties.distances ? [...currentProperties.distances] : [];
    let pointIndex = 0;
    const pointX = label("pointX");
    const pointY = label("pointY");
    const distance = label("distance");
    const pointLabel = panel.getChild("pointIndex").asTextField;
    const writeCurrentPoint = (): boolean => {
        if (type.selectedIndex === 3 && points.length >= 2) {
            const x = Number(pointX.title);
            const y = Number(pointY.title);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
            points[pointIndex * 2] = x;
            points[pointIndex * 2 + 1] = y;
        } else if (type.selectedIndex === 4 && distances.length) {
            const value = Number(distance.title);
            if (!Number.isFinite(value) || value < 0 || value > 1) return false;
            distances[pointIndex] = value;
        }
        return true;
    };
    const renderCurrentPoint = (): void => {
        const count = type.selectedIndex === 3 ? points.length / 2 : Math.max(3, Number(label("sides").title) || 3);
        pointIndex = Math.max(0, Math.min(pointIndex, Math.max(0, count - 1)));
        pointLabel.text = `点 ${pointIndex + 1}/${count}`;
        pointX.title = String(points[pointIndex * 2] ?? 0);
        pointY.title = String(points[pointIndex * 2 + 1] ?? 0);
        if (type.selectedIndex === 4) {
            if (distances.length !== count) distances = Array.from({ length: count }, (_, index) => distances[index] ?? 1);
            distance.title = String(distances[pointIndex] ?? 1);
        }
    };
    const advancePoint = (): boolean => {
        if (!writeCurrentPoint()) return false;
        const count = type.selectedIndex === 3 ? points.length / 2 : Math.max(3, Number(label("sides").title) || 3);
        pointIndex = count ? (pointIndex + 1) % count : 0;
        renderCurrentPoint();
        return true;
    };
    panel.getChild("polygonEdit").enabled = true;
    panel.getChild("polygonEdit").tooltips = options.isGraphPointEditing() ? "退出画布顶点编辑" : "进入画布顶点编辑";
    panel.getChild("polygonEdit").asButton.onClick(options.eventOwner, () => {
        const enabled = !options.isGraphPointEditing();
        options.setGraphPointEditing(enabled, panel.getChild("shapeLocked").asButton.selected);
        options.setDebugAttribute("data-fairy-editor-graph-point-editing", enabled ? "active" : "inactive");
        options.setStatus(enabled ? "Polygon point editing active; drag green handles, press Escape to exit." : "Polygon point editing exited.");
        if (enabled) dialog.dispose();
    });
    pointLabel.touchable = true;
    pointLabel.tooltips = "点击切换数值编辑的顶点";
    pointLabel.onClick(options.eventOwner, () => {
        if (!advancePoint()) options.setStatus("Graph point values are invalid.");
    });
    panel.getChild("resetAll").enabled = true;
    panel.getChild("resetAll").asButton.onClick(options.eventOwner, () => {
        distances = Array.from({ length: Math.max(3, Number(label("sides").title) || 3) }, () => 1);
        renderCurrentPoint();
    });
    panel.getChild("shapeLocked").enabled = true;
    panel.getChild("shapeLocked").asButton.selected = options.isGraphShapeLocked();
    panel.getChild("shapeLocked").tooltips = "锁定后拖动一个顶点会整体平移所有顶点";
    renderCurrentPoint();

    const lineColorInput = createInspectorTextInput(
        content,
        "graphLineColorInput",
        166,
        92,
        120,
        currentProperties.lineColor,
        true,
    );
    const fillColorInput = createInspectorTextInput(
        content,
        "graphFillColorInput",
        166,
        120,
        120,
        currentProperties.fillColor,
        true,
    );
    const applyButton = createInspectorButton(content, "graphPropertiesApply", "应用", 20, 260, 80);
    const saveButton = content.getChild("n1").asButton;
    saveButton.title = "保存";
    saveButton.setXY(115, 260);
    saveButton.setSize(80, 22);
    const closeButton = content.getChild("n3").asButton;
    closeButton.title = "关闭";
    closeButton.setXY(210, 260);
    closeButton.setSize(80, 22);
    content.setChildIndex(saveButton, content.numChildren - 1);
    content.setChildIndex(closeButton, content.numChildren - 1);

    const readProperties = (): GraphEditableProperties | null => {
        const graphType = type.selectedIndex;
        const lineSize = Number(label("lineSize").title.trim());
        const lineColor = lineColorInput.text.trim();
        const fillColor = fillColorInput.text.trim();
        const cornerSource = label("cornerRadius").title.trim();
        const cornerRadius = cornerSource
            ? cornerSource.split(",").map((value) => Number(value.trim()))
            : null;
        if (!writeCurrentPoint()) {
            options.setStatus("Graph point values are invalid.");
            return null;
        }
        const normalizedPoints = graphType === 3 ? points : currentProperties.points;
        const sides = Number(label("sides").title.trim());
        const startAngle = Number(label("startAngle").title.trim());
        const normalizedDistances = graphType === 4 ? distances : currentProperties.distances;
        if (
            !Number.isInteger(lineSize)
            || lineSize < 0
            || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(lineColor)
            || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(fillColor)
            || (cornerRadius !== null && (
                cornerRadius.length !== 4
                || cornerRadius.some((radius) => !Number.isFinite(radius) || radius < 0)
            ))
            || !Number.isInteger(sides)
            || sides < 0
            || sides > 100
            || !Number.isFinite(startAngle)
            || (normalizedPoints !== null && normalizedPoints.length % 2 !== 0)
            || (graphType === 3 && (!normalizedPoints || normalizedPoints.length < 6))
            || (normalizedDistances !== null && normalizedDistances.some((distance) => distance < 0 || distance > 1))
            || (graphType === 4 && (
                sides < 3
                || (normalizedDistances !== null && normalizedDistances.length > 0 && normalizedDistances.length !== sides)
            ))
        ) {
            options.setStatus("Graph shape, colors, corners, points, sides, or distances are invalid.");
            return null;
        }
        return {
            ...currentProperties,
            graphType,
            lineSize,
            lineColor,
            fillColor,
            cornerRadius: cornerRadius as GraphEditableProperties["cornerRadius"],
            points: normalizedPoints,
            sides,
            startAngle,
            distances: normalizedDistances,
        };
    };

    let busy = false;
    const apply = async (close: boolean): Promise<void> => {
        if (busy) return;
        const updated = readProperties();
        const current = findLiveNode();
        if (!updated || current?.kind !== "graph") return;
        if (JSON.stringify(readGraphProperties(current)) === JSON.stringify(updated)) {
            options.setStatus("Graph properties are unchanged.");
            if (close) dialog.dispose();
            return;
        }
        busy = true;
        try {
            const applied = await options.applyCommand({
                kind: "setDisplayNodeProps",
                selector,
                props: { graphProperties: updated },
            }, `graph properties ${selector.displayNodeId}`);
            if (!applied) return;
            options.setDebugAttribute(
                "data-fairy-editor-graph-properties",
                `${selector.displayNodeId}:${updated.graphType}:${updated.lineSize}:${updated.sides}`,
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
        options.setStatus("Graph properties edit cancelled.");
        dialog.dispose();
    });
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute("data-fairy-editor-graph-properties-editor", selector.displayNodeId);
    options.setStatus(`Editing graph properties for ${selectedNode.name || selectedNode.id}.`);
}
