import type {
    ComponentControllerPageOverride,
    ComponentCustomPropertyDefinition,
    ComponentCustomPropertyValue,
    ComponentInstanceComboItem,
    ComponentInstanceEditableProperties,
} from "../model/EditorCommand";
import {
    addInspectorLine,
    createInspectorButton,
    createInspectorTextInput,
} from "../ui/EditorFormControls";
import type { PropertyEditorContext } from "./PropertyEditorContext";

export type ExportedControllerDefinition = {
    name: string;
    label: string;
    pages: Array<{ id: string; name: string }>;
};

export function showComponentCustomPropertyValuesEditor(
    options: PropertyEditorContext,
    definitions: ComponentCustomPropertyDefinition[],
    exportedControllers: ExportedControllerDefinition[],
): void {
    const { selector, selectedNode } = options;
    if (
        !selector
        || !selectedNode
        || selectedNode.type !== "GComponent"
        || (definitions.length === 0 && exportedControllers.length === 0)
    ) {
        options.setStatus("Component custom properties unavailable: select an instance with exposed properties.");
        return;
    }

    let draft = structuredClone(selectedNode.componentCustomPropertyValues || []);
    let controllerDraft = structuredClone(selectedNode.componentControllerPageOverrides || []);
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopComponentCustomPropertyValuesDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    const panel = fgui.UIPackage.createObject("Builder", "CustomPropsPanel").asCom;
    const panelHeight = Math.max(40, definitions.length * 36 + exportedControllers.length * 24 + 10);
    const contentHeight = panelHeight + 104;
    content.setSize(310, contentHeight);
    content.getChild("frame").asLabel.title = `${selectedNode.name || selectedNode.id} - Custom Properties`;
    content.getChild("n2").visible = false;
    panel.name = "componentCustomPropertyValuesPanel";
    panel.setXY(20, 34);
    panel.setSize(270, panelHeight);
    const list = panel.getChild("list").asList;
    list.setSize(270, panelHeight - 10);
    list.removeChildrenToPool();
    for (const definition of definitions) {
        const row = list.addItemFromPool().asCom;
        const value = draft.find((property) => (
            property.target === definition.target && property.propertyId === definition.propertyId
        ));
        row.getController("propertyId").selectedPage = String(definition.propertyId);
        const enabled = row.getChild("title").asButton;
        enabled.title = definition.label || definition.target;
        enabled.selected = Boolean(value);
        enabled.tooltips = definition.target;
        row.getChild(definition.propertyId === 0 ? "textValue" : "iconValue").asLabel.title = value?.value || "";
    }
    for (const controller of exportedControllers) {
        const row = list.addItemFromPool().asCom;
        const value = controllerDraft.find((override) => override.controllerName === controller.name);
        row.getController("propertyId").selectedPage = "-1";
        const enabled = row.getChild("title").asButton;
        enabled.title = controller.label;
        enabled.selected = Boolean(value) && controller.pages.length > 0;
        enabled.enabled = controller.pages.length > 0;
        enabled.tooltips = controller.name;
        const pages = row.getChild("pages").asComboBox;
        pages.items = controller.pages.map((page) => page.name);
        pages.values = controller.pages.map((page) => page.id);
        pages.selectedIndex = Math.max(0, pages.values.indexOf(value?.pageId || ""));
    }
    content.addChild(panel);

    const buttonY = contentHeight - 36;
    const applyButton = createInspectorButton(content, "componentCustomPropertiesApply", "Apply", 20, buttonY, 80);
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

    const readValues = (): ComponentCustomPropertyValue[] => definitions.flatMap((definition, index) => {
        const row = list.getChildAt(index).asCom;
        if (!row.getChild("title").asButton.selected) return [];
        return [{
            target: definition.target,
            propertyId: definition.propertyId,
            value: row.getChild(definition.propertyId === 0 ? "textValue" : "iconValue").asLabel.title,
        }];
    });
    const readControllerOverrides = (): ComponentControllerPageOverride[] => exportedControllers.flatMap((controller, index) => {
        const row = list.getChildAt(definitions.length + index).asCom;
        if (!row.getChild("title").asButton.selected) return [];
        const pages = row.getChild("pages").asComboBox;
        const pageId = pages.values[pages.selectedIndex] || "";
        return pageId ? [{ controllerName: controller.name, pageId }] : [];
    });
    let busy = false;
    const apply = async (close: boolean): Promise<void> => {
        if (busy) return;
        const updated = readValues();
        const controllerOverrides = readControllerOverrides();
        if (
            JSON.stringify(updated) === JSON.stringify(draft)
            && JSON.stringify(controllerOverrides) === JSON.stringify(controllerDraft)
        ) {
            options.setStatus("Component custom property values are unchanged.");
            if (close) dialog.dispose();
            return;
        }
        busy = true;
        try {
            const applied = await options.applyCommand({
                kind: "setDisplayNodeProps",
                selector,
                props: {
                    componentCustomPropertyValues: updated.length > 0 ? updated : null,
                    componentControllerPageOverrides: controllerOverrides.length > 0 ? controllerOverrides : null,
                },
            }, `component custom properties ${selector.displayNodeId}`);
            if (!applied) return;
            draft = structuredClone(updated);
            controllerDraft = structuredClone(controllerOverrides);
            options.setDebugAttribute(
                "data-fairy-editor-component-custom-property-values",
                `${selector.displayNodeId}:${updated.length}:${controllerOverrides.length}`,
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
        options.setStatus("Component custom properties edit cancelled.");
        dialog.dispose();
    });
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute(
        "data-fairy-editor-component-custom-property-values-editor",
        selector.displayNodeId,
    );
    options.setStatus(`Editing custom property values for ${selectedNode.name || selectedNode.id}.`);
}

export function showComponentInstancePropertiesEditor(options: PropertyEditorContext): void {
    const { selector, selectedNode } = options;
    const initial = selectedNode?.componentInstanceProperties;
    if (!selector || !selectedNode || selectedNode.type !== "GComponent" || !initial) {
        options.setStatus("Component instance properties unavailable: select an extended component instance.");
        return;
    }
    if (initial.extensionType === "ScrollBar") {
        options.setStatus("ScrollBar has no per-instance extension properties in the FairyGUI project format.");
        return;
    }

    let draft = structuredClone(initial);
    let comboItems = initial.extensionType === "ComboBox"
        ? structuredClone(initial.items)
        : [];
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopComponentInstancePropertiesDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    const panelName = `${initial.extensionType}PropsPanel`;
    const panel = fgui.UIPackage.createObject("Builder", panelName).asCom;
    const extraHeight = initial.extensionType === "Label" ? 42 : 0;
    const contentHeight = Math.max(180, panel.height + extraHeight + 78);
    content.setSize(310, contentHeight);
    content.getChild("frame").asLabel.title = `${selectedNode.name || selectedNode.id} - ${initial.extensionType}`;
    content.getChild("n2").visible = false;
    panel.name = "componentInstancePropertiesPanel";
    panel.setXY(20, 34);
    content.addChild(panel);
    const label = (name: string): fgui.GLabel => panel.getChild(name).asLabel;
    const setLabel = (name: string, value: string | number): void => {
        label(name).title = String(value);
    };
    let promptInput: fgui.GTextInput | null = null;

    switch (initial.extensionType) {
        case "Button":
            panel.getChild("selected").asButton.selected = initial.checked;
            setLabel("title", initial.title);
            setLabel("selectedTitle", initial.selectedTitle);
            panel.getChild("titleColorSet").asButton.selected = Boolean(initial.titleColor);
            setLabel("titleColor", initial.titleColor || "#FFFFFF");
            panel.getChild("titleFontSizeSet").asButton.selected = initial.titleFontSize > 0;
            setLabel("titleFontSize", initial.titleFontSize || 12);
            setLabel("icon", initial.icon);
            setLabel("selectedIcon", initial.selectedIcon);
            panel.getChild("soundSet").asButton.selected = Boolean(initial.sound);
            setLabel("sound", initial.sound);
            setLabel("volume", initial.soundVolumeScale * 100);
            setLabel("controller", initial.controller);
            setLabel("page", initial.page);
            break;
        case "Label":
            setLabel("title", initial.title);
            panel.getChild("titleColorSet").asButton.selected = Boolean(initial.titleColor);
            setLabel("titleColor", initial.titleColor || "#FFFFFF");
            panel.getChild("titleFontSizeSet").asButton.selected = initial.titleFontSize > 0;
            setLabel("titleFontSize", initial.titleFontSize || 12);
            setLabel("icon", initial.icon);
            for (const name of ["inputEdit", "n74", "sound", "volume", "n77"]) {
                panel.getChild(name).visible = false;
            }
            addInspectorLine(content, "componentInstancePromptLabel", "Prompt", 20, panel.y + panel.height + 4, 55, "#bdbdbd");
            promptInput = createInspectorTextInput(
                content,
                "componentInstancePrompt",
                78,
                panel.y + panel.height,
                206,
                initial.promptText,
                true,
            );
            break;
        case "ComboBox":
            setLabel("title", initial.title);
            setLabel("icon", initial.icon);
            setLabel("visibleItemCount", initial.visibleItemCount);
            setLabel("selectionController", initial.selectionController);
            for (const name of ["titleColorSet", "titleColor", "direction", "n78", "n93", "sound", "volume", "n96"]) {
                panel.getChild(name).visible = false;
            }
            panel.getChild("n77").asButton.onClick(options.eventOwner, () => {
                showComponentInstanceComboItemsEditor(options, comboItems, (items) => {
                    comboItems = items;
                    options.setDebugAttribute(
                        "data-fairy-editor-component-instance-items-draft",
                        `${selector.displayNodeId}:${items.length}`,
                    );
                });
            });
            break;
        case "ProgressBar":
            setLabel("min", initial.min);
            setLabel("max", initial.max);
            setLabel("value", initial.value);
            for (const name of ["n80", "sound", "volume", "n83"]) panel.getChild(name).visible = false;
            break;
        case "Slider":
            setLabel("min", initial.min);
            setLabel("max", initial.max);
            setLabel("value", initial.value);
            break;
    }

    const buttonY = contentHeight - 36;
    const applyButton = createInspectorButton(content, "componentInstanceApply", "Apply", 20, buttonY, 80);
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

    const number = (name: string): number => Number(label(name).title.trim());
    const readProperties = (): Exclude<
        ComponentInstanceEditableProperties,
        { extensionType: "ScrollBar" }
    > | null => {
        switch (initial.extensionType) {
            case "Button": {
                const titleFontSize = panel.getChild("titleFontSizeSet").asButton.selected
                    ? number("titleFontSize")
                    : 0;
                const soundVolumeScale = number("volume") / 100;
                if (
                    !Number.isInteger(titleFontSize)
                    || titleFontSize < 0
                    || !Number.isFinite(soundVolumeScale)
                    || soundVolumeScale < 0
                ) {
                    options.setStatus("Button font size and sound volume are invalid.");
                    return null;
                }
                return {
                    extensionType: "Button",
                    title: label("title").title,
                    selectedTitle: label("selectedTitle").title,
                    icon: label("icon").title.trim(),
                    selectedIcon: label("selectedIcon").title.trim(),
                    titleColor: panel.getChild("titleColorSet").asButton.selected
                        ? label("titleColor").title.trim()
                        : "",
                    titleFontSize,
                    controller: label("controller").title.trim(),
                    page: label("page").title.trim(),
                    checked: panel.getChild("selected").asButton.selected,
                    sound: panel.getChild("soundSet").asButton.selected
                        ? label("sound").title.trim()
                        : "",
                    soundVolumeScale,
                };
            }
            case "Label": {
                const titleFontSize = panel.getChild("titleFontSizeSet").asButton.selected
                    ? number("titleFontSize")
                    : 0;
                if (!Number.isInteger(titleFontSize) || titleFontSize < 0) {
                    options.setStatus("Label font size must be a non-negative integer.");
                    return null;
                }
                return {
                    extensionType: "Label",
                    title: label("title").title,
                    icon: label("icon").title.trim(),
                    titleColor: panel.getChild("titleColorSet").asButton.selected
                        ? label("titleColor").title.trim()
                        : "",
                    titleFontSize,
                    promptText: promptInput?.text || "",
                };
            }
            case "ComboBox": {
                const visibleItemCount = number("visibleItemCount");
                if (!Number.isInteger(visibleItemCount) || visibleItemCount < 0) {
                    options.setStatus("ComboBox visible item count must be a non-negative integer.");
                    return null;
                }
                return {
                    extensionType: "ComboBox",
                    title: label("title").title,
                    icon: label("icon").title.trim(),
                    visibleItemCount,
                    selectionController: label("selectionController").title.trim(),
                    autoClearItems: initial.autoClearItems,
                    items: structuredClone(comboItems),
                };
            }
            case "ProgressBar":
            case "Slider": {
                const min = number("min");
                const max = number("max");
                const value = number("value");
                if (![min, max, value].every(Number.isFinite)) {
                    options.setStatus(`${initial.extensionType} min, max, and value must be finite numbers.`);
                    return null;
                }
                return { extensionType: initial.extensionType, min, max, value };
            }
        }
    };

    let busy = false;
    const apply = async (close: boolean): Promise<void> => {
        if (busy) return;
        const updated = readProperties();
        if (!updated) return;
        if (JSON.stringify(updated) === JSON.stringify(draft)) {
            options.setStatus(`${initial.extensionType} instance properties are unchanged.`);
            if (close) dialog.dispose();
            return;
        }
        busy = true;
        try {
            const applied = await options.applyCommand({
                kind: "setDisplayNodeProps",
                selector,
                props: { componentInstanceProperties: updated },
            }, `${initial.extensionType.toLowerCase()} instance properties ${selector.displayNodeId}`);
            if (!applied) return;
            draft = structuredClone(updated);
            options.setDebugAttribute(
                "data-fairy-editor-component-instance-properties",
                `${selector.displayNodeId}:${updated.extensionType}`,
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
        options.setStatus(`${initial.extensionType} instance properties edit cancelled.`);
        dialog.dispose();
    });
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute(
        "data-fairy-editor-component-instance-properties-editor",
        `${selector.displayNodeId}:${initial.extensionType}`,
    );
    options.setStatus(`Editing ${initial.extensionType} instance properties for ${selectedNode.name || selectedNode.id}.`);
}

function showComponentInstanceComboItemsEditor(
    options: PropertyEditorContext,
    initialItems: ComponentInstanceComboItem[],
    onApply: (items: ComponentInstanceComboItem[]) => void,
): void {
    let items = structuredClone(initialItems);
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopComponentInstanceComboItemsDialog";
    const content = fgui.UIPackage.createObject("Builder", "ComboBoxEditDialog").asCom;
    const list = content.getChild("list").asList;
    content.getChild("clearOnPublish").visible = false;
    const readRows = (): void => {
        for (let index = 0; index < Math.min(items.length, list.numChildren); index += 1) {
            const row = list.getChildAt(index).asCom;
            items[index] = {
                title: row.getChild("text").asLabel.title || null,
                icon: row.getChild("icon").asLabel.title.trim() || null,
                value: row.getChild("value").asLabel.title || null,
            };
        }
    };
    const render = (selectedIndex = Math.min(list.selectedIndex, items.length - 1)): void => {
        list.removeChildrenToPool();
        items.forEach((item) => {
            const row = list.addItemFromPool().asCom;
            row.getChild("text").asLabel.title = item.title || "";
            row.getChild("icon").asLabel.title = item.icon || "";
            row.getChild("value").asLabel.title = item.value || "";
        });
        list.selectedIndex = Math.max(-1, Math.min(selectedIndex, items.length - 1));
    };
    const createItem = (): ComponentInstanceComboItem => ({ title: null, icon: null, value: null });
    render(items.length > 0 ? 0 : -1);
    content.getChild("addItem").onClick(options.eventOwner, () => {
        readRows();
        items.push(createItem());
        render(items.length - 1);
    });
    content.getChild("insertItem").onClick(options.eventOwner, () => {
        readRows();
        const index = list.selectedIndex < 0 ? items.length : list.selectedIndex;
        items.splice(index, 0, createItem());
        render(index);
    });
    content.getChild("removeItem").onClick(options.eventOwner, () => {
        readRows();
        if (list.selectedIndex < 0) return;
        const index = list.selectedIndex;
        items.splice(index, 1);
        render(Math.min(index, items.length - 1));
    });
    content.getChild("moveUp").onClick(options.eventOwner, () => {
        readRows();
        if (list.selectedIndex <= 0) return;
        const index = list.selectedIndex;
        [items[index - 1], items[index]] = [items[index], items[index - 1]];
        render(index - 1);
    });
    content.getChild("moveDown").onClick(options.eventOwner, () => {
        readRows();
        if (list.selectedIndex < 0 || list.selectedIndex >= items.length - 1) return;
        const index = list.selectedIndex;
        [items[index], items[index + 1]] = [items[index + 1], items[index]];
        render(index + 1);
    });
    content.getChild("save").asButton.onClick(options.eventOwner, () => {
        readRows();
        onApply(structuredClone(items));
        dialog.dispose();
    });
    content.getChild("close").asButton.onClick(options.eventOwner, () => dialog.dispose());
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
}
