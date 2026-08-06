import {
    componentCustomPropertyTargetExists,
    prepareSetComponentProperties,
    readComponentProperties,
    type HighRiskTransactionPreparation,
} from "../commands/HighRiskAuthoringTransactions";
import { findResource } from "../commands/AuthoringTransactionSupport";
import type {
    ComponentCustomPropertyDefinition,
    ComponentEditableProperties,
    EditorComponentSelector,
} from "../model/EditorCommand";
import type { ProjectSnapshotComponent } from "../model/ProjectSnapshot";
import {
    addInspectorLine,
    addDialogBackground,
    createInspectorButton,
    createInspectorTextInput,
    createTimelineComboBox,
} from "../ui/EditorFormControls";

export type ComponentPropertyEditorContext = {
    getSelectedComponentSelector(): EditorComponentSelector | null;
    getSelectedComponent(): ProjectSnapshotComponent | null;
    getWorkingProject(): unknown | null;
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    applyPreparation(preparation: HighRiskTransactionPreparation): Promise<boolean>;
    setStatus(message: string): void;
    setDebugAttribute(name: string, value: string): void;
    eventOwner: object;
};

export function showComponentCustomPropertyDefinitionsEditor(options: ComponentPropertyEditorContext): void {
    const selector = options.getSelectedComponentSelector();
    const selectedComponent = options.getSelectedComponent();
    const project = options.getWorkingProject();
    const resource = selector
        ? findResource(project, {
            packageId: selector.packageId,
            resourceId: selector.componentResourceId,
        })
        : null;
    if (!selector || !selectedComponent || resource?.kind !== "component" || !resource.component) {
        options.setStatus("Component custom properties unavailable: no component selected.");
        return;
    }

    const current = readComponentProperties(resource.component);
    let properties = structuredClone(current.customProperties);
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopComponentCustomPropertyDefinitionsDialog";
    const content = fgui.UIPackage.createObject("Builder", "ComPropertyEditDialog").asCom;
    content.getChild("frame").asLabel.title = `${selectedComponent.name} - Custom Properties`;
    const list = content.getChild("list").asList;
    const rowInput = (row: fgui.GComponent, name: string): fgui.GTextInput => {
        const host = row.getChild(name).asCom;
        host.getController("c1").selectedIndex = 1;
        const input = host.getChild("input").asTextInput;
        input.editable = true;
        return input;
    };
    const readRows = (): ComponentCustomPropertyDefinition[] => {
        const rows: ComponentCustomPropertyDefinition[] = [];
        for (let index = 0; index < list.numChildren; index += 1) {
            const row = list.getChildAt(index).asCom;
            rows.push({
                target: rowInput(row, "target").text.trim(),
                propertyId: row.getController("propertyId").selectedIndex as 0 | 1,
                label: rowInput(row, "label").text.trim(),
            });
        }
        return rows;
    };
    const render = (selectedIndex = Math.min(list.selectedIndex, properties.length - 1)): void => {
        list.removeChildrenToPool();
        for (const property of properties) {
            const row = list.addItemFromPool().asCom;
            rowInput(row, "target").text = property.target;
            row.getController("propertyId").selectedIndex = property.propertyId;
            rowInput(row, "label").text = property.label;
        }
        list.selectedIndex = Math.max(-1, Math.min(selectedIndex, properties.length - 1));
    };
    render(properties.length > 0 ? 0 : -1);
    content.getChild("addItem").onClick(options.eventOwner, () => {
        properties = readRows();
        properties.push({ target: "", propertyId: 0, label: "" });
        render(properties.length - 1);
    });
    content.getChild("insertItem").onClick(options.eventOwner, () => {
        properties = readRows();
        const index = list.selectedIndex < 0 ? properties.length : list.selectedIndex;
        properties.splice(index, 0, { target: "", propertyId: 0, label: "" });
        render(index);
    });
    content.getChild("removeItem").onClick(options.eventOwner, () => {
        properties = readRows();
        if (list.selectedIndex < 0) return;
        properties.splice(list.selectedIndex, 1);
        render(Math.min(list.selectedIndex, properties.length - 1));
    });
    content.getChild("moveUp").onClick(options.eventOwner, () => {
        properties = readRows();
        const index = list.selectedIndex;
        if (index <= 0) return;
        [properties[index - 1], properties[index]] = [properties[index], properties[index - 1]];
        render(index - 1);
    });
    content.getChild("moveDown").onClick(options.eventOwner, () => {
        properties = readRows();
        const index = list.selectedIndex;
        if (index < 0 || index >= properties.length - 1) return;
        [properties[index], properties[index + 1]] = [properties[index + 1], properties[index]];
        render(index + 1);
    });

    let busy = false;
    content.getChild("save").onClick(options.eventOwner, async () => {
        if (busy) return;
        properties = readRows();
        const keys = new Set<string>();
        for (const property of properties) {
            const key = `${property.target}\0${property.propertyId}`;
            if (
                !property.target
                || keys.has(key)
                || !componentCustomPropertyTargetExists(project, selector, property.target)
            ) {
                options.setStatus(`Invalid or duplicate custom property target: ${property.target || "(empty)"}.`);
                return;
            }
            keys.add(key);
        }
        if (JSON.stringify(properties) === JSON.stringify(current.customProperties)) {
            options.setStatus("Component custom properties are unchanged.");
            dialog.dispose();
            return;
        }
        busy = true;
        try {
            const applied = await options.applyPreparation(prepareSetComponentProperties(
                options.getWorkingProject(),
                selector,
                {
                    width: Number(resource.component?.size?.width || selectedComponent.width),
                    height: Number(resource.component?.size?.height || selectedComponent.height),
                },
                { ...current, customProperties: properties },
            ));
            if (!applied) return;
            options.setDebugAttribute(
                "data-fairy-editor-component-custom-properties",
                `${selector.componentResourceId}:${properties.length}`,
            );
            dialog.dispose();
        } finally {
            busy = false;
        }
    });
    content.getChild("close").onClick(options.eventOwner, () => {
        options.setStatus("Component custom properties edit cancelled.");
        dialog.dispose();
    });
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => {
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    });
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute(
        "data-fairy-editor-component-custom-properties-editor",
        selector.componentResourceId,
    );
    options.setStatus(`Editing custom properties for ${selectedComponent.name}.`);
}

export function showComponentPropertiesEditor(options: ComponentPropertyEditorContext): void {
    const selector = options.getSelectedComponentSelector();
    const selectedComponent = options.getSelectedComponent();
    const resource = selector
        ? findResource(options.getWorkingProject(), {
            packageId: selector.packageId,
            resourceId: selector.componentResourceId,
        })
        : null;
    if (!selector || !selectedComponent || resource?.kind !== "component" || !resource.component) {
        options.setStatus("Component properties unavailable: no component selected.");
        return;
    }

    const current = readComponentProperties(resource.component);
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopComponentPropertiesDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(600, 450);
    addDialogBackground(content);
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `${selectedComponent.name} - Component`;
    content.getChild("n2").visible = false;
    const panel = fgui.UIPackage.createObject("Builder", "ComPropsPanel").asCom;
    panel.name = "componentPropertiesPanel";
    panel.setXY(20, 34);
    content.addChild(panel);

    const label = (name: string): fgui.GLabel => panel.getChild(name).asLabel;
    label("width").title = String(selectedComponent.width);
    label("height").title = String(selectedComponent.height);
    label("minWidth").title = String(current.minSize.width);
    label("minHeight").title = String(current.minSize.height);
    label("maxWidth").title = String(current.maxSize.width);
    label("maxHeight").title = String(current.maxSize.height);
    label("pivotX").title = String(current.pivot.x);
    label("pivotY").title = String(current.pivot.y);
    label("initName").title = current.initName;
    label("margin").title = [
        current.margin.top,
        current.margin.bottom,
        current.margin.left,
        current.margin.right,
    ].join(",");
    panel.getChild("anchor").asButton.selected = current.pivotAsAnchor;
    panel.getChild("opaque").asButton.selected = !current.opaque;
    const bgColorEnabled = panel.getChild("bgColorEnabled").asButton;
    bgColorEnabled.selected = current.bgColorEnabled;

    const overflow = panel.getChild("overflow2").asComboBox;
    overflow.items = ["Visible", "Hidden", "Scroll horizontal", "Scroll vertical", "Scroll both"];
    overflow.values = ["visible", "hidden", "scroll-horizontal", "scroll-vertical", "scroll-both"];
    overflow.selectedIndex = current.overflow === 2 ? current.scrollType + 2 : current.overflow;

    const extensionType = panel.getChild("extentionId").asComboBox;
    extensionType.items = [current.extensionType || "None"];
    extensionType.values = [current.extensionType];
    extensionType.selectedIndex = 0;
    extensionType.enabled = false;
    extensionType.tooltips = "Changing a component extension type requires a structural migration; its current value is preserved.";
    let pivotPresetMenu: fgui.PopupMenu | null = null;
    const pivotPreset = panel.getChild("n92").asButton;
    pivotPreset.enabled = true;
    pivotPreset.tooltips = "选择轴心预设";
    pivotPreset.onClick(options.eventOwner, () => {
        pivotPresetMenu?.dispose();
        const menu = new fgui.PopupMenu();
        pivotPresetMenu = menu;
        for (const [title, x, y] of [
            ["左上", 0, 0], ["上中", 0.5, 0], ["右上", 1, 0],
            ["左中", 0, 0.5], ["中心", 0.5, 0.5], ["右中", 1, 0.5],
            ["左下", 0, 1], ["下中", 0.5, 1], ["右下", 1, 1],
        ] as const) {
            menu.addItem(title, () => {
                label("pivotX").title = String(x);
                label("pivotY").title = String(y);
            });
        }
        menu.show(pivotPreset);
    });
    panel.getChild("fitSize").enabled = true;
    panel.getChild("fitSize").asButton.onClick(options.eventOwner, () => {
        const bounds = (resource.component?.displayList || []).reduce((value, node) => ({
            width: Math.max(value.width, Number(node.position?.x || 0) + Number(node.size?.width || 0)),
            height: Math.max(value.height, Number(node.position?.y || 0) + Number(node.size?.height || 0)),
        }), { width: 0, height: 0 });
        label("width").title = String(Math.max(1, Math.ceil(bounds.width)));
        label("height").title = String(Math.max(1, Math.ceil(bounds.height)));
    });

    let scrollDraft = structuredClone(current);
    panel.getChild("scrollEdit").enabled = true;
    panel.getChild("scrollEdit").asButton.onClick(options.eventOwner, () => {
        const scrollDialog = new fgui.Window();
        scrollDialog.modal = true;
        const scrollContent = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
        scrollContent.setSize(284, 590);
        scrollContent.getChild("n2").visible = false;
        const scrollFrame = scrollContent.getChild("frame");
        if (scrollFrame) scrollFrame.asLabel.title = "Scroll settings";
        const scrollPanel = fgui.UIPackage.createObject("Builder", "ScrollPropsPanel").asCom;
        scrollPanel.setXY(20, 30);
        scrollContent.addChild(scrollPanel);
        const scrollLabel = (name: string): fgui.GLabel => scrollPanel.getChild(name).asLabel;
        const display = scrollPanel.getChild("scrollBarDisplay").asComboBox;
        display.items = ["Default", "Visible", "Auto", "Hidden"];
        display.values = ["0", "1", "2", "3"];
        display.selectedIndex = scrollDraft.scrollBarDisplay;
        const bounce = scrollPanel.getChild("scrollBounceBackEffect").asComboBox;
        bounce.items = ["Default", "Enabled", "Disabled"];
        bounce.values = ["0", "1", "2"];
        bounce.selectedIndex = scrollDraft.scrollBarFlags & 64 ? 1 : scrollDraft.scrollBarFlags & 128 ? 2 : 0;
        const touch = scrollPanel.getChild("scrollTouchEffect").asComboBox;
        touch.items = ["Default", "Enabled", "Disabled"];
        touch.values = ["0", "1", "2"];
        touch.selectedIndex = scrollDraft.scrollBarFlags & 16 ? 1 : scrollDraft.scrollBarFlags & 32 ? 2 : 0;
        for (const [name, value] of [
            ["vtScrollBarRes", scrollDraft.vtScrollBarRes],
            ["hzScrollBarRes", scrollDraft.hzScrollBarRes],
            ["scrollBarMarginTop", scrollDraft.scrollBarMargin.top],
            ["scrollBarMarginBottom", scrollDraft.scrollBarMargin.bottom],
            ["scrollBarMarginLeft", scrollDraft.scrollBarMargin.left],
            ["scrollBarMarginRight", scrollDraft.scrollBarMargin.right],
            ["headerRes", scrollDraft.headerRes],
            ["footerRes", scrollDraft.footerRes],
        ] as const) scrollLabel(name).title = String(value);
        const flagControls = [
            ["scrollBarOnLeft", 1], ["scrollSnapping", 2], ["scrollBarInDemand", 4],
            ["scrollPageMode", 8], ["inertiaDisabled", 256], ["maskDisabled", 512],
            ["floating", 1024], ["dontClipMargin", 2048],
        ] as const;
        for (const [name, bit] of flagControls) scrollPanel.getChild(name).asButton.selected = Boolean(scrollDraft.scrollBarFlags & bit);
        scrollPanel.getChild("globalSettings").enabled = false;
        const saveScroll = scrollContent.getChild("n1").asButton;
        saveScroll.title = "Save";
        saveScroll.setXY(92, 550);
        const closeScroll = scrollContent.getChild("n3").asButton;
        closeScroll.title = "Close";
        closeScroll.setXY(180, 550);
        saveScroll.onClick(options.eventOwner, () => {
            const margins = ["scrollBarMarginTop", "scrollBarMarginBottom", "scrollBarMarginLeft", "scrollBarMarginRight"]
                .map((name) => Number(scrollLabel(name).title));
            if (margins.some((value) => !Number.isFinite(value))) {
                options.setStatus("Scroll bar margins must be numeric.");
                return;
            }
            let flags = 0;
            for (const [name, bit] of flagControls) if (scrollPanel.getChild(name).asButton.selected) flags |= bit;
            if (touch.selectedIndex === 1) flags |= 16;
            if (touch.selectedIndex === 2) flags |= 32;
            if (bounce.selectedIndex === 1) flags |= 64;
            if (bounce.selectedIndex === 2) flags |= 128;
            scrollDraft = {
                ...scrollDraft,
                scrollBarDisplay: display.selectedIndex,
                scrollBarFlags: flags,
                scrollBarMargin: { top: margins[0], bottom: margins[1], left: margins[2], right: margins[3] },
                vtScrollBarRes: scrollLabel("vtScrollBarRes").title.trim(),
                hzScrollBarRes: scrollLabel("hzScrollBarRes").title.trim(),
                headerRes: scrollLabel("headerRes").title.trim(),
                footerRes: scrollLabel("footerRes").title.trim(),
            };
            scrollDialog.dispose();
        });
        closeScroll.onClick(options.eventOwner, () => scrollDialog.dispose());
        scrollDialog.contentPane = scrollContent;
        scrollDialog.show();
        scrollDialog.centerOn(fgui.GRoot.inst, true);
    });

    const advancedInputs = {
        remark: createInspectorTextInput(content, "componentRemark", 390, 52, 180, current.remark, true),
        designImageAlpha: createInspectorTextInput(content, "componentDesignAlpha", 390, 86, 80, String(current.designImageAlpha), true),
        designImageLayer: createInspectorTextInput(content, "componentDesignLayer", 490, 86, 80, String(current.designImageLayer), true),
        designImageX: createInspectorTextInput(content, "componentDesignX", 390, 140, 80, String(current.designImageOffset.x), true),
        designImageY: createInspectorTextInput(content, "componentDesignY", 490, 140, 80, String(current.designImageOffset.y), true),
        clipX: createInspectorTextInput(content, "componentClipX", 390, 194, 80, String(current.clipSoftness.x), true),
        clipY: createInspectorTextInput(content, "componentClipY", 490, 194, 80, String(current.clipSoftness.y), true),
        idNum: createInspectorTextInput(content, "componentIdNum", 390, 248, 80, String(current.idNum), true),
    };
    addInspectorLine(content, "componentRemarkLabel", "Remark", 320, 32, 180, "#bdbdbd");
    addInspectorLine(content, "componentDesignLabel", "Design overlay alpha / layer", 320, 66, 250, "#bdbdbd");
    addInspectorLine(content, "componentOffsetLabel", "Design overlay offset X / Y", 320, 120, 250, "#bdbdbd");
    addInspectorLine(content, "componentClipLabel", "Clip softness X / Y", 320, 174, 250, "#bdbdbd");
    addInspectorLine(content, "componentIdNumLabel", "Generated ID number", 320, 228, 180, "#bdbdbd");

    const targetNodes = (resource.component.displayList || [])
        .filter((node) => node.kind === "image" || node.kind === "graph")
        .filter((node) => Boolean(node.id));
    const createTargetInput = (name: string, y: number, value: string): fgui.GComboBox => {
        const items = ["(none)", ...targetNodes.map((node) => (
            `${node.name || node.id} (${node.kind}, ${node.id})`
        ))];
        const values = ["", ...targetNodes.map((node) => String(node.id))];
        if (value && !values.includes(value)) {
            items.push(`Current unsupported (${value})`);
            values.push(value);
        }
        return createTimelineComboBox(
            panel,
            name,
            87,
            y,
            152,
            items,
            values,
            Math.max(0, values.indexOf(value)),
        );
    };
    panel.getChild("mask").visible = false;
    panel.getChild("hitTestSource").visible = false;
    const maskInput = createTargetInput("componentMaskTarget", 201, current.mask);
    const hitTestInput = createTargetInput("componentHitTestTarget", 254, current.hitTest);
    const reversedMask = panel.getChild("reversedMask").asButton;
    reversedMask.selected = current.reversedMask;
    const syncMaskState = (): void => {
        reversedMask.grayed = !maskInput.value;
        reversedMask.touchable = Boolean(maskInput.value);
        if (!maskInput.value) reversedMask.selected = false;
    };
    maskInput.on(fgui.Events.STATE_CHANGED, options.eventOwner, syncMaskState);
    syncMaskState();

    const bgColorButton = panel.getChild("bgColor").asButton;
    const colorSwatch = bgColorButton.getChild("n1").asGraph;
    let bgColorValue = current.bgColor;
    const pickerColor = /^#[0-9a-f]{6}$/i.test(bgColorValue) ? bgColorValue : "#383838";
    colorSwatch.fillColor = pickerColor;
    bgColorButton.tooltips = `Background color: ${bgColorValue || "(default)"}. Click to pick.`;
    let colorPicker: HTMLInputElement | null = null;
    const removeColorPicker = (): void => {
        colorPicker?.remove();
        colorPicker = null;
    };
    bgColorButton.onClick(options.eventOwner, () => {
        removeColorPicker();
        const input = document.createElement("input");
        input.type = "color";
        input.value = /^#[0-9a-f]{6}$/i.test(bgColorValue) ? bgColorValue : pickerColor;
        input.setAttribute("aria-label", "Component background color");
        input.setAttribute("data-fairy-editor-component-background-color", selector.componentResourceId);
        input.style.position = "fixed";
        input.style.left = "-100px";
        input.style.top = "-100px";
        input.addEventListener("input", () => {
            bgColorValue = input.value;
            colorSwatch.fillColor = bgColorValue;
            bgColorButton.tooltips = `Background color: ${bgColorValue}. Click to pick.`;
            bgColorEnabled.selected = true;
            options.setDebugAttribute("data-fairy-editor-component-background-color-draft", bgColorValue);
        });
        input.addEventListener("change", removeColorPicker, { once: true });
        document.body.appendChild(input);
        colorPicker = input;
        input.click();
    });
    const clearBackgroundColor = createInspectorButton(
        panel,
        "componentBackgroundColorClear",
        "Clear",
        166,
        333,
        72,
    );
    clearBackgroundColor.onClick(options.eventOwner, () => {
        removeColorPicker();
        bgColorValue = "";
        colorSwatch.fillColor = "#383838";
        bgColorButton.tooltips = "Background color: (default). Click to pick.";
        bgColorEnabled.selected = false;
        options.setDebugAttribute("data-fairy-editor-component-background-color-draft", "cleared");
    });

    const applyButton = createInspectorButton(content, "componentPropertiesApply", "Apply", 20, 410, 80);
    const saveButton = content.getChild("n1").asButton;
    saveButton.title = "Save";
    saveButton.setXY(260, 410);
    saveButton.setSize(80, 22);
    const closeButton = content.getChild("n3").asButton;
    closeButton.title = "Close";
    closeButton.setXY(500, 410);
    closeButton.setSize(80, 22);

    let busy = false;
    const readNumber = (name: string): number => Number(label(name).title.trim());
    const readProperties = (): { size: { width: number; height: number }; properties: ComponentEditableProperties } | null => {
        const margin = label("margin").title.split(",").map((value) => Number(value.trim()));
        if (margin.length !== 4 || margin.some((value) => !Number.isFinite(value))) {
            options.setStatus("Component margin must contain top,bottom,left,right.");
            return null;
        }
        const selectedOverflow = overflow.selectedIndex;
        const backgroundEnabled = bgColorEnabled.selected;
        const designImageAlpha = Number(advancedInputs.designImageAlpha.text);
        const designImageLayer = Number(advancedInputs.designImageLayer.text);
        const designImageX = Number(advancedInputs.designImageX.text);
        const designImageY = Number(advancedInputs.designImageY.text);
        const clipX = Number(advancedInputs.clipX.text);
        const clipY = Number(advancedInputs.clipY.text);
        const idNum = Number(advancedInputs.idNum.text);
        if (![designImageAlpha, designImageLayer, designImageX, designImageY, clipX, clipY, idNum].every(Number.isFinite)) {
            options.setStatus("Advanced component properties must be numeric.");
            return null;
        }
        return {
            size: {
                width: readNumber("width"),
                height: readNumber("height"),
            },
            properties: {
                ...scrollDraft,
                minSize: { width: readNumber("minWidth"), height: readNumber("minHeight") },
                maxSize: { width: readNumber("maxWidth"), height: readNumber("maxHeight") },
                pivot: { x: readNumber("pivotX"), y: readNumber("pivotY") },
                pivotAsAnchor: panel.getChild("anchor").asButton.selected,
                overflow: selectedOverflow < 2 ? selectedOverflow : 2,
                scrollType: selectedOverflow < 2 ? current.scrollType : selectedOverflow - 2,
                margin: { top: margin[0], bottom: margin[1], left: margin[2], right: margin[3] },
                initName: label("initName").title,
                opaque: !panel.getChild("opaque").asButton.selected,
                mask: maskInput.value,
                reversedMask: Boolean(maskInput.value) && reversedMask.selected,
                hitTest: hitTestInput.value,
                bgColor: backgroundEnabled ? (bgColorValue || pickerColor) : bgColorValue,
                bgColorEnabled: backgroundEnabled,
                designImageAlpha,
                designImageLayer,
                designImageOffset: { x: designImageX, y: designImageY },
                clipSoftness: { x: clipX, y: clipY },
                idNum: Math.trunc(idNum),
                remark: advancedInputs.remark.text,
            },
        };
    };
    const apply = async (close: boolean): Promise<void> => {
        if (busy) return;
        const updated = readProperties();
        if (!updated) return;
        busy = true;
        try {
            const preparation = prepareSetComponentProperties(
                options.getWorkingProject(),
                selector,
                updated.size,
                updated.properties,
            );
            if (preparation.ok === false && preparation.code === "component_properties_unchanged") {
                options.setStatus("Component properties are unchanged.");
                if (close) dialog.dispose();
                return;
            }
            const applied = await options.applyPreparation(preparation);
            if (!applied) return;
            options.setDebugAttribute(
                "data-fairy-editor-component-properties",
                `${selector.componentResourceId}:${updated.size.width}x${updated.size.height}:${updated.properties.overflow}:${updated.properties.scrollType}:${updated.properties.pivot.x},${updated.properties.pivot.y}:${updated.properties.opaque}:${updated.properties.initName}:${updated.properties.mask}:${updated.properties.hitTest}:${updated.properties.bgColorEnabled ? updated.properties.bgColor : "disabled"}`,
            );
            if (close) dialog.dispose();
        } finally {
            busy = false;
        }
    };
    const cleanup = (): void => {
        removeColorPicker();
        pivotPresetMenu?.dispose();
        pivotPresetMenu = null;
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    };
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, cleanup);
    applyButton.onClick(options.eventOwner, () => void apply(false));
    saveButton.onClick(options.eventOwner, () => void apply(true));
    closeButton.onClick(options.eventOwner, () => {
        options.setStatus("Component properties edit cancelled.");
        dialog.dispose();
    });
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute(
        "data-fairy-editor-component-properties-editor",
        `${selector.componentResourceId}:${selectedComponent.width}x${selectedComponent.height}`,
    );
    options.setStatus(`Editing component ${selectedComponent.name}.`);
}

export function showComponentExtensionPropertiesEditor(options: ComponentPropertyEditorContext): void {
    const selector = options.getSelectedComponentSelector();
    const selectedComponent = options.getSelectedComponent();
    const resource = selector
        ? findResource(options.getWorkingProject(), {
            packageId: selector.packageId,
            resourceId: selector.componentResourceId,
        })
        : null;
    if (!selector || !selectedComponent || resource?.kind !== "component" || !resource.component) {
        options.setStatus("Component definition properties unavailable: no component selected.");
        return;
    }

    const current = readComponentProperties(resource.component);
    if (!["Button", "ComboBox", "ProgressBar", "Slider", "ScrollBar"].includes(current.extensionType)) {
        options.setStatus(`${current.extensionType || "Plain"} components have no editable definition-specific fields.`);
        return;
    }

    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopComponentExtensionPropertiesDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    const panel = fgui.UIPackage.createObject("Builder", `${current.extensionType}PropsPanel2`).asCom;
    const contentHeight = Math.max(180, panel.height + 78);
    content.setSize(310, contentHeight);
    content.getChild("frame").asLabel.title = `${selectedComponent.name} - ${current.extensionType} Definition`;
    content.getChild("n2").visible = false;
    panel.name = "componentExtensionPropertiesPanel";
    panel.setXY(20, 34);
    content.addChild(panel);
    const label = (name: string): fgui.GLabel => panel.getChild(name).asLabel;

    switch (current.extensionType) {
        case "Button": {
            const mode = panel.getChild("mode").asComboBox;
            mode.items = ["Common", "Check", "Radio"];
            mode.values = ["0", "1", "2"];
            mode.selectedIndex = current.buttonMode;
            label("baseSound").title = current.sound;
            label("baseVolume").title = String(current.soundVolumeScale * 100);
            const downEffect = panel.getChild("downEffect").asComboBox;
            downEffect.items = ["None", "Dark", "Scale"];
            downEffect.values = ["0", "1", "2"];
            downEffect.selectedIndex = current.downEffect;
            label("downEffectValue").title = String(current.downEffectValue);
            break;
        }
        case "ComboBox":
            label("dropdown").title = current.dropdown;
            break;
        case "ProgressBar": {
            const titleType = panel.getChild("titleType").asComboBox;
            titleType.items = ["Percent", "Value / Max", "Value", "Max"];
            titleType.values = ["0", "1", "2", "3"];
            titleType.selectedIndex = current.titleType;
            panel.getChild("reverse").asButton.selected = current.reverse;
            break;
        }
        case "Slider": {
            const titleType = panel.getChild("titleType").asComboBox;
            titleType.items = ["Percent", "Value / Max", "Value", "Max"];
            titleType.values = ["0", "1", "2", "3"];
            titleType.selectedIndex = current.titleType;
            panel.getChild("reverse").asButton.selected = current.reverse;
            panel.getChild("wholeNumbers").asButton.selected = current.wholeNumbers;
            panel.getChild("changeOnClick").asButton.selected = current.changeOnClick;
            break;
        }
        case "ScrollBar":
            panel.getChild("fixedGripSize").asButton.selected = current.fixedGripSize;
            break;
    }

    const buttonY = contentHeight - 36;
    const applyButton = createInspectorButton(content, "componentExtensionPropertiesApply", "Apply", 20, buttonY, 80);
    const saveButton = content.getChild("n1").asButton;
    saveButton.title = "Save";
    saveButton.setXY(115, buttonY);
    saveButton.setSize(80, 22);
    const closeButton = content.getChild("n3").asButton;
    closeButton.title = "Close";
    closeButton.setXY(210, buttonY);
    closeButton.setSize(80, 22);
    content.setChildIndex(applyButton, content.numChildren - 1);
    content.setChildIndex(saveButton, content.numChildren - 1);
    content.setChildIndex(closeButton, content.numChildren - 1);

    const readProperties = (): ComponentEditableProperties | null => {
        const updated = structuredClone(current);
        switch (current.extensionType) {
            case "Button": {
                const buttonMode = panel.getChild("mode").asComboBox.selectedIndex;
                const downEffect = panel.getChild("downEffect").asComboBox.selectedIndex;
                const volume = Number(label("baseVolume").title.trim());
                const downEffectValue = Number(label("downEffectValue").title.trim());
                if (
                    buttonMode < 0
                    || buttonMode > 2
                    || downEffect < 0
                    || downEffect > 2
                    || !Number.isFinite(volume)
                    || volume < 0
                    || volume > 100
                    || !Number.isFinite(downEffectValue)
                    || downEffectValue < 0
                ) {
                    options.setStatus("Button definition mode, volume, or down effect is invalid.");
                    return null;
                }
                updated.buttonMode = buttonMode;
                updated.sound = label("baseSound").title.trim();
                updated.soundVolumeScale = volume / 100;
                updated.downEffect = downEffect;
                updated.downEffectValue = downEffectValue;
                break;
            }
            case "ComboBox":
                updated.dropdown = label("dropdown").title.trim();
                break;
            case "ProgressBar": {
                const titleType = panel.getChild("titleType").asComboBox.selectedIndex;
                if (titleType < 0 || titleType > 3) {
                    options.setStatus("ProgressBar title type is invalid.");
                    return null;
                }
                updated.titleType = titleType;
                updated.reverse = panel.getChild("reverse").asButton.selected;
                break;
            }
            case "Slider": {
                const titleType = panel.getChild("titleType").asComboBox.selectedIndex;
                if (titleType < 0 || titleType > 3) {
                    options.setStatus("Slider title type is invalid.");
                    return null;
                }
                updated.titleType = titleType;
                updated.reverse = panel.getChild("reverse").asButton.selected;
                updated.wholeNumbers = panel.getChild("wholeNumbers").asButton.selected;
                updated.changeOnClick = panel.getChild("changeOnClick").asButton.selected;
                break;
            }
            case "ScrollBar":
                updated.fixedGripSize = panel.getChild("fixedGripSize").asButton.selected;
                break;
        }
        return updated;
    };

    let busy = false;
    const apply = async (close: boolean): Promise<void> => {
        if (busy) return;
        const updated = readProperties();
        if (!updated) return;
        busy = true;
        try {
            const preparation = prepareSetComponentProperties(
                options.getWorkingProject(),
                selector,
                {
                    width: Number(resource.component?.size?.width || selectedComponent.width),
                    height: Number(resource.component?.size?.height || selectedComponent.height),
                },
                updated,
            );
            if (preparation.ok === false && preparation.code === "component_properties_unchanged") {
                options.setStatus(`${current.extensionType} definition properties are unchanged.`);
                if (close) dialog.dispose();
                return;
            }
            const applied = await options.applyPreparation(preparation);
            if (!applied) return;
            options.setDebugAttribute(
                "data-fairy-editor-component-extension-properties",
                `${selector.componentResourceId}:${current.extensionType}`,
            );
            if (close) dialog.dispose();
        } finally {
            busy = false;
        }
    };
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => {
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    });
    applyButton.onClick(options.eventOwner, () => void apply(false));
    saveButton.onClick(options.eventOwner, () => void apply(true));
    closeButton.onClick(options.eventOwner, () => {
        options.setStatus(`${current.extensionType} definition properties edit cancelled.`);
        dialog.dispose();
    });
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute(
        "data-fairy-editor-component-extension-properties-editor",
        `${selector.componentResourceId}:${current.extensionType}`,
    );
    options.setStatus(`Editing ${current.extensionType} definition properties for ${selectedComponent.name}.`);
}
