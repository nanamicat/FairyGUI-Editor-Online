import { findComponent } from "../commands/AuthoringTransactionSupport";
import { readListProperties } from "../commands/HighRiskAuthoringTransactions";
import type {
    ListEditableProperties,
    ListItemEditableProperties,
    TreeEditableProperties,
} from "../model/EditorCommand";
import {
    addInspectorLine,
    createInspectorButton,
    createInspectorTextInput,
} from "../ui/EditorFormControls";
import type { PropertyEditorContext } from "./PropertyEditorContext";

export function showListPropertiesEditor(options: PropertyEditorContext): void {
    const { selector, selectedNode } = options;
    const findLiveNode = () => selector
        ? findComponent(options.getWorkingProject(), selector)
            ?.displayList?.find((node) => node.id === selector.displayNodeId) || null
        : null;
    const liveNode = findLiveNode();
    if (!selector || !selectedNode || (liveNode?.kind !== "list" && liveNode?.kind !== "tree")) {
        options.setStatus("List properties unavailable: select a GList or GTree node.");
        return;
    }

    const isTree = liveNode.kind === "tree";
    const current = readListProperties(liveNode);
    let listItems = structuredClone(current.listItems);
    let autoClearItems = current.autoClearItems;
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopListPropertiesDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(600, 610);
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `${selectedNode.name || selectedNode.id} - ${isTree ? "Tree" : "List"}`;
    content.getChild("n2").visible = false;

    const panel = fgui.UIPackage.createObject("Builder", "ListPropsPanel").asCom;
    panel.name = "listPropertiesPanel";
    panel.setXY(20, 34);
    content.addChild(panel);
    const label = (owner: fgui.GComponent, name: string): fgui.GLabel => owner.getChild(name).asLabel;
    const layout = panel.getChild("layout").asComboBox;
    layout.items = ["Single column", "Single row", "Flow horizontal", "Flow vertical", "Pagination"];
    layout.values = ["0", "1", "2", "3", "4"];
    layout.selectedIndex = current.layout;
    label(panel, "repeatY").title = String(current.lineCount);
    label(panel, "repeatX").title = String(current.columnCount);
    label(panel, "lineGap").title = String(current.lineGap);
    label(panel, "columnGap").title = String(current.columnGap);
    panel.getController("align").selectedIndex = current.align;
    panel.getController("verticalAlign").selectedIndex = current.vAlign;
    const overflow = panel.getChild("overflow2").asComboBox;
    overflow.items = ["Visible", "Hidden", "Scroll horizontal", "Scroll vertical", "Scroll both"];
    overflow.values = ["0", "1", "2:0", "2:1", "2:2"];
    overflow.selectedIndex = current.overflow === 2 ? current.scrollType + 2 : current.overflow;
    const renderOrder = panel.getChild("childrenRenderOrder").asComboBox;
    renderOrder.items = ["Ascent", "Descent", "Arch"];
    renderOrder.values = ["0", "1", "2"];
    renderOrder.selectedIndex = current.childrenRenderOrder;
    label(panel, "apexIndex").title = String(current.apexIndex);
    const selectionMode = panel.getChild("selectionMode").asComboBox;
    selectionMode.items = ["Single", "Multiple", "Multiple single click", "None"];
    selectionMode.values = ["0", "1", "2", "3"];
    selectionMode.selectedIndex = current.selectionMode;
    label(panel, "selectionController").title = current.selectionController;
    label(panel, "pageController").title = current.pageController;
    label(panel, "margin").title = [
        current.margin.top,
        current.margin.bottom,
        current.margin.left,
        current.margin.right,
    ].join(",");
    panel.getChild("margin").touchable = false;
    panel.getChild("margin").tooltips = "Edit margins in the details pane.";
    panel.getController("c1").selectedIndex = isTree ? 1 : 0;
    const treeEnabled = panel.getChild("treeViewEnabled").asButton;
    treeEnabled.selected = isTree;
    treeEnabled.enabled = false;
    treeEnabled.tooltips = "Changing GList into GTree is a structural operation.";
    label(panel, "defaultItem").title = current.defaultItem;

    const layoutPanel = fgui.UIPackage.createObject("Builder", "ListLayoutPropsPanel").asCom;
    layoutPanel.name = "listLayoutPropertiesPanel";
    layoutPanel.setXY(300, 46);
    content.addChild(layoutPanel);
    layoutPanel.getChild("autoResizeItem").asButton.selected = current.autoResizeItem;
    layoutPanel.getChild("foldInvisibleItems").asButton.selected = current.foldInvisibleItems;
    layoutPanel.getChild("scrollItemToViewOnClick").asButton.selected = current.scrollItemToViewOnClick;

    const marginPanel = fgui.UIPackage.createObject("Builder", "MarginPropsPanel").asCom;
    marginPanel.name = "listMarginPropertiesPanel";
    marginPanel.setXY(300, 157);
    content.addChild(marginPanel);
    label(marginPanel, "marginTop").title = String(current.margin.top);
    label(marginPanel, "marginBottom").title = String(current.margin.bottom);
    label(marginPanel, "marginLeft").title = String(current.margin.left);
    label(marginPanel, "marginRight").title = String(current.margin.right);
    label(marginPanel, "clipSoftnessX").title = String(current.clipSoftness.x);
    label(marginPanel, "clipSoftnessY").title = String(current.clipSoftness.y);

    const treePanel = fgui.UIPackage.createObject("Builder", "TreeSettingsPanel").asCom;
    treePanel.name = "treeSettingsPanel";
    treePanel.setXY(300, 328);
    treePanel.visible = isTree;
    content.addChild(treePanel);
    label(treePanel, "indent").title = String("indent" in current ? current.indent : 0);
    const clickToExpand = treePanel.getChild("clickToExpand").asComboBox;
    clickToExpand.items = ["No", "Click"];
    clickToExpand.values = ["0", "1"];
    clickToExpand.selectedIndex = "clickToExpand" in current ? current.clickToExpand : 0;

    addInspectorLine(content, "listControllerOverridesLabel", "Controller overrides", 300, isTree ? 420 : 328, 130, "#bdbdbd");
    const controllerOverridesInput = createInspectorTextInput(
        content,
        "listControllerOverrides",
        300,
        isTree ? 440 : 348,
        244,
        current.controllerOverrides,
        true,
    );

    const scrollPanel = fgui.UIPackage.createObject("Builder", "ScrollPropsPanel").asCom;
    scrollPanel.name = "listScrollPropertiesPanel";
    scrollPanel.setXY(320, 40);
    scrollPanel.visible = false;
    content.addChild(scrollPanel);
    const scrollBarDisplay = scrollPanel.getChild("scrollBarDisplay").asComboBox;
    scrollBarDisplay.items = ["Default", "Visible", "Auto", "Hidden"];
    scrollBarDisplay.values = ["0", "1", "2", "3"];
    scrollBarDisplay.selectedIndex = 0;
    scrollBarDisplay.enabled = false;
    scrollBarDisplay.tooltips = "Scroll bar display mode is read-only in this editor version.";
    const bounceEffect = scrollPanel.getChild("scrollBounceBackEffect").asComboBox;
    bounceEffect.items = ["Default", "Enabled", "Disabled"];
    bounceEffect.values = ["0", "1", "2"];
    bounceEffect.selectedIndex = current.scrollBarFlags & 64 ? 1 : current.scrollBarFlags & 128 ? 2 : 0;
    const touchEffect = scrollPanel.getChild("scrollTouchEffect").asComboBox;
    touchEffect.items = ["Default", "Enabled", "Disabled"];
    touchEffect.values = ["0", "1", "2"];
    touchEffect.selectedIndex = current.scrollBarFlags & 16 ? 1 : current.scrollBarFlags & 32 ? 2 : 0;
    label(scrollPanel, "vtScrollBarRes").title = current.vtScrollBarRes;
    label(scrollPanel, "hzScrollBarRes").title = current.hzScrollBarRes;
    label(scrollPanel, "scrollBarMarginTop").title = String(current.scrollBarMargin.top);
    label(scrollPanel, "scrollBarMarginBottom").title = String(current.scrollBarMargin.bottom);
    label(scrollPanel, "scrollBarMarginLeft").title = String(current.scrollBarMargin.left);
    label(scrollPanel, "scrollBarMarginRight").title = String(current.scrollBarMargin.right);
    label(scrollPanel, "headerRes").title = current.headerRes;
    label(scrollPanel, "footerRes").title = current.footerRes;
    for (const [name, bit] of [
        ["scrollBarOnLeft", 1],
        ["scrollSnapping", 2],
        ["scrollBarInDemand", 4],
        ["scrollPageMode", 8],
        ["inertiaDisabled", 256],
        ["maskDisabled", 512],
        ["floating", 1024],
        ["dontClipMargin", 2048],
    ] as const) {
        scrollPanel.getChild(name).asButton.selected = Boolean(current.scrollBarFlags & bit);
    }
    scrollPanel.getChild("globalSettings").enabled = false;

    const showDetails = (scroll: boolean): void => {
        layoutPanel.visible = !scroll;
        marginPanel.visible = !scroll;
        treePanel.visible = !scroll && isTree;
        controllerOverridesInput.parent.visible = !scroll;
        content.getChild("listControllerOverridesLabel").visible = !scroll;
        scrollPanel.visible = scroll;
        options.setDebugAttribute("data-fairy-editor-list-properties-page", scroll ? "scroll" : "layout");
    };
    panel.getChild("layoutEdit").onClick(options.eventOwner, () => showDetails(false));
    panel.getChild("treeOption").onClick(options.eventOwner, () => showDetails(false));
    panel.getChild("scrollEdit").onClick(options.eventOwner, () => showDetails(true));
    panel.getChild("editItems").onClick(options.eventOwner, () => {
        showListItemsEditor(options, listItems, autoClearItems, isTree, (items, clearOnPublish) => {
            listItems = items;
            autoClearItems = clearOnPublish;
            options.setDebugAttribute("data-fairy-editor-list-items-draft", `${selector.displayNodeId}:${items.length}`);
        });
    });

    const applyButton = createInspectorButton(content, "listPropertiesApply", "Apply", 165, 570, 80);
    const saveButton = content.getChild("n1").asButton;
    saveButton.title = "Save";
    saveButton.setXY(260, 570);
    saveButton.setSize(80, 22);
    const closeButton = content.getChild("n3").asButton;
    closeButton.title = "Close";
    closeButton.setXY(355, 570);
    closeButton.setSize(80, 22);
    content.setChildIndex(saveButton, content.numChildren - 1);
    content.setChildIndex(closeButton, content.numChildren - 1);

    const number = (owner: fgui.GComponent, name: string): number => Number(label(owner, name).title.trim());
    const readProperties = (): ListEditableProperties | TreeEditableProperties | null => {
        const selectedLayout = layout.selectedIndex;
        const selectedOverflow = overflow.selectedIndex;
        const lineCount = selectedLayout === 3 || selectedLayout === 4 ? number(panel, "repeatY") : 0;
        const columnCount = selectedLayout === 2 || selectedLayout === 4 ? number(panel, "repeatX") : 0;
        let scrollBarFlags = 0;
        for (const [name, bit] of [
            ["scrollBarOnLeft", 1],
            ["scrollSnapping", 2],
            ["scrollBarInDemand", 4],
            ["scrollPageMode", 8],
            ["inertiaDisabled", 256],
            ["maskDisabled", 512],
            ["floating", 1024],
            ["dontClipMargin", 2048],
        ] as const) {
            if (scrollPanel.getChild(name).asButton.selected) scrollBarFlags |= bit;
        }
        if (touchEffect.selectedIndex === 1) scrollBarFlags |= 16;
        if (touchEffect.selectedIndex === 2) scrollBarFlags |= 32;
        if (bounceEffect.selectedIndex === 1) scrollBarFlags |= 64;
        if (bounceEffect.selectedIndex === 2) scrollBarFlags |= 128;
        const properties: ListEditableProperties = {
            layout: selectedLayout,
            align: panel.getController("align").selectedIndex,
            vAlign: panel.getController("verticalAlign").selectedIndex,
            lineGap: number(panel, "lineGap"),
            columnGap: number(panel, "columnGap"),
            lineCount,
            columnCount,
            selectionMode: selectionMode.selectedIndex,
            defaultItem: label(panel, "defaultItem").title.trim(),
            autoResizeItem: layoutPanel.getChild("autoResizeItem").asButton.selected,
            childrenRenderOrder: renderOrder.selectedIndex,
            apexIndex: renderOrder.selectedIndex === 2 ? number(panel, "apexIndex") : 0,
            src: current.src,
            overflow: selectedOverflow < 2 ? selectedOverflow : 2,
            scrollType: selectedOverflow < 2 ? 1 : selectedOverflow - 2,
            scrollBarFlags,
            scrollBarMargin: {
                top: number(scrollPanel, "scrollBarMarginTop"),
                bottom: number(scrollPanel, "scrollBarMarginBottom"),
                left: number(scrollPanel, "scrollBarMarginLeft"),
                right: number(scrollPanel, "scrollBarMarginRight"),
            },
            vtScrollBarRes: label(scrollPanel, "vtScrollBarRes").title.trim(),
            hzScrollBarRes: label(scrollPanel, "hzScrollBarRes").title.trim(),
            headerRes: label(scrollPanel, "headerRes").title.trim(),
            footerRes: label(scrollPanel, "footerRes").title.trim(),
            margin: {
                top: number(marginPanel, "marginTop"),
                bottom: number(marginPanel, "marginBottom"),
                left: number(marginPanel, "marginLeft"),
                right: number(marginPanel, "marginRight"),
            },
            clipSoftness: {
                x: number(marginPanel, "clipSoftnessX"),
                y: number(marginPanel, "clipSoftnessY"),
            },
            scrollItemToViewOnClick: layoutPanel.getChild("scrollItemToViewOnClick").asButton.selected,
            foldInvisibleItems: layoutPanel.getChild("foldInvisibleItems").asButton.selected,
            autoClearItems,
            listItems: structuredClone(listItems),
            pageController: label(panel, "pageController").title.trim(),
            controllerOverrides: controllerOverridesInput.text.trim(),
            selectionController: label(panel, "selectionController").title.trim(),
        };
        const numericValues = [
            properties.lineGap,
            properties.columnGap,
            properties.lineCount,
            properties.columnCount,
            properties.apexIndex,
            ...Object.values(properties.scrollBarMargin),
            ...Object.values(properties.margin),
            properties.clipSoftness.x,
            properties.clipSoftness.y,
        ];
        if (
            numericValues.some((value) => !Number.isFinite(value))
            || !numericValues.slice(0, 5).every(Number.isInteger)
            || properties.lineCount < 0
            || properties.columnCount < 0
            || properties.apexIndex < 0
        ) {
            options.setStatus("List layout, counts, margins, or scrolling values are invalid.");
            return null;
        }
        if (!isTree) return properties;
        const indent = number(treePanel, "indent");
        if (!Number.isInteger(indent) || indent < 0) {
            options.setStatus("Tree indent must be a non-negative integer.");
            return null;
        }
        return {
            ...properties,
            treeView: true,
            indent,
            clickToExpand: clickToExpand.selectedIndex,
        };
    };

    let busy = false;
    const apply = async (close: boolean): Promise<void> => {
        if (busy) return;
        const updated = readProperties();
        const node = findLiveNode();
        if (!updated || (node?.kind !== "list" && node?.kind !== "tree")) return;
        if (JSON.stringify(readListProperties(node)) === JSON.stringify(updated)) {
            options.setStatus(`${isTree ? "Tree" : "List"} properties are unchanged.`);
            if (close) dialog.dispose();
            return;
        }
        busy = true;
        try {
            const applied = await options.applyCommand({
                kind: "setDisplayNodeProps",
                selector,
                props: { listProperties: updated },
            }, `${isTree ? "tree" : "list"} properties ${selector.displayNodeId}`);
            if (!applied) return;
            options.setDebugAttribute(
                "data-fairy-editor-list-properties",
                `${selector.displayNodeId}:${updated.layout}:${updated.listItems.length}:${updated.scrollBarFlags}`,
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
        options.setStatus(`${isTree ? "Tree" : "List"} properties edit cancelled.`);
        dialog.dispose();
    });
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute("data-fairy-editor-list-properties-editor", selector.displayNodeId);
    options.setStatus(`Editing ${isTree ? "tree" : "list"} properties for ${selectedNode.name || selectedNode.id}.`);
}

function showListItemsEditor(
    options: PropertyEditorContext,
    initialItems: ListItemEditableProperties[],
    initialAutoClearItems: boolean,
    isTree: boolean,
    onApply: (items: ListItemEditableProperties[], autoClearItems: boolean) => void,
): void {
    let items = structuredClone(initialItems);
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopListItemsDialog";
    const content = fgui.UIPackage.createObject("Builder", "ListItemsEditDialog").asCom;
    const list = content.getChild("list").asList;
    const clearOnPublish = content.getChild("clearOnPublish").asButton;
    clearOnPublish.selected = initialAutoClearItems;
    clearOnPublish.enabled = true;
    clearOnPublish.tooltips = "发布时清除列表项目";
    content.getChild("indentColumn").visible = isTree;

    const readRows = (): boolean => {
        for (let index = 0; index < Math.min(items.length, list.numChildren); index += 1) {
            const row = list.getChildAt(index).asCom;
            const level = Number(row.getChild("level").asLabel.title.trim() || "0");
            if (!Number.isInteger(level) || level < 0) {
                options.setStatus(`List item ${index + 1} level must be a non-negative integer.`);
                return false;
            }
            items[index] = {
                ...items[index],
                url: row.getChild("url").asLabel.title.trim() || null,
                title: row.getChild("title").asLabel.title || null,
                icon: row.getChild("icon").asLabel.title.trim() || null,
                name: row.getChild("name").asLabel.title.trim() || null,
                level: isTree ? level : 0,
                isFolder: isTree ? items[index].isFolder : null,
                controllers: items[index].controllers ?? null,
            };
        }
        return true;
    };
    const render = (selectedIndex = Math.min(list.selectedIndex, items.length - 1)): void => {
        list.removeChildrenToPool();
        items.forEach((item, index) => {
            const row = list.addItemFromPool().asCom;
            row.getChild("index").text = String(index + 1);
            row.getChild("url").asLabel.title = item.url || "";
            row.getChild("title").asLabel.title = item.title || "";
            row.getChild("icon").asLabel.title = item.icon || "";
            row.getChild("name").asLabel.title = item.name || "";
            row.getChild("level").asLabel.title = String(item.level);
            row.getChild("level").visible = isTree;
        });
        list.selectedIndex = Math.max(-1, Math.min(selectedIndex, items.length - 1));
    };
    const createItem = (): ListItemEditableProperties => ({
        title: null,
        icon: null,
        url: null,
        name: null,
        selectedTitle: null,
        selectedIcon: null,
        level: 0,
        isFolder: isTree ? false : null,
        controllers: null,
    });
    render(items.length > 0 ? 0 : -1);

    content.getChild("addItem").onClick(options.eventOwner, () => {
        if (!readRows()) return;
        items.push(createItem());
        render(items.length - 1);
    });
    content.getChild("insertItem").onClick(options.eventOwner, () => {
        if (!readRows()) return;
        const index = list.selectedIndex < 0 ? items.length : list.selectedIndex;
        items.splice(index, 0, createItem());
        render(index);
    });
    content.getChild("removeItem").onClick(options.eventOwner, () => {
        if (!readRows() || list.selectedIndex < 0) return;
        const index = list.selectedIndex;
        items.splice(index, 1);
        render(Math.min(index, items.length - 1));
    });
    content.getChild("moveUp").onClick(options.eventOwner, () => {
        if (!readRows() || list.selectedIndex <= 0) return;
        const index = list.selectedIndex;
        [items[index - 1], items[index]] = [items[index], items[index - 1]];
        render(index - 1);
    });
    content.getChild("moveDown").onClick(options.eventOwner, () => {
        if (!readRows() || list.selectedIndex < 0 || list.selectedIndex >= items.length - 1) return;
        const index = list.selectedIndex;
        [items[index], items[index + 1]] = [items[index + 1], items[index]];
        render(index + 1);
    });

    const apply = (close: boolean): void => {
        if (!readRows()) return;
        onApply(structuredClone(items), clearOnPublish.selected);
        options.setStatus(`${items.length} ${isTree ? "tree" : "list"} items updated in the property draft.`);
        if (close) dialog.dispose();
    };
    content.getChild("apply").asButton.onClick(options.eventOwner, () => apply(false));
    content.getChild("save").asButton.onClick(options.eventOwner, () => apply(true));
    content.getChild("cancel").asButton.onClick(options.eventOwner, () => dialog.dispose());
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
}
