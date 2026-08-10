import { findComponent, findResource } from "../commands/AuthoringTransactionSupport";
import {
    createControllerActionDraft,
    getControllerModel,
    insertControllerPageDraft,
    moveControllerActionDraft,
    moveControllerPageDraft,
    prepareUpdateControllerModel,
    removeControllerActionDraft,
    removeControllerPageDraft,
    type HighRiskTransactionPreparation,
} from "../commands/HighRiskAuthoringTransactions";
import type { EditorComponentSelector } from "../model/EditorCommand";
import {
    addInspectorLine,
    createInspectorButton,
    createInspectorCheckButton,
    createInspectorTextInput,
    createTimelineComboBox,
    setActionEnabled,
    setOverflowButtonTitle,
    setOverflowText,
} from "../ui/EditorFormControls";

export type ControllerEditorContext = {
    getSelectedComponentSelector(): EditorComponentSelector | null;
    getWorkingProject(): unknown | null;
    getControllerDialog(): fgui.Window | null;
    setControllerDialog(dialog: fgui.Window | null): void;
    getAuxDialog(): fgui.Window | null;
    setAuxDialog(dialog: fgui.Window | null): void;
    applyPreparation(preparation: HighRiskTransactionPreparation): Promise<boolean>;
    setSelectedControllerName(name: string): void;
    createActionMenu(): fgui.PopupMenu;
    addMenuItem(menu: fgui.PopupMenu, name: string, title: string, handler: () => void): fgui.GButton;
    setStatus(message: string): void;
    setDebugAttribute(name: string, value: string): void;
    eventOwner: object;
};

interface ControllerEditorModel {
    name: string;
    selectedIndex: number;
    autoRadioGroupDepth: boolean;
    alias: string;
    exported: boolean;
    homePageType: "default" | "specific" | "branch" | "variable";
    homePage: string;
    pages: Array<{ id: string; name: string }>;
    actions: ControllerActionModel[];
}
interface ControllerActionModel {
    name: string;
    actionType: number;
    fromPageIds: string[];
    toPageIds: string[];
    transitionName: string;
    playTimes: number;
    delay: number;
    stopOnExit: boolean;
    targetNodeId: string;
    controllerName: string;
    targetPage: string;
}
interface ControllerPageRowData {
    pageId: string;
}
interface ControllerActionRowData {
    actionIndex: number;
}
interface ControllerActionTarget {
    nodeId: string;
    label: string;
    controllers: Array<{
        name: string;
        pages: Array<{ id: string; name: string }>;
    }>;
}

function getControllerActionTargets(
    options: ControllerEditorContext,
    selector: EditorComponentSelector,
    sourceControllerName: string,
): ControllerActionTarget[] {
    const project = options.getWorkingProject();
    const component = findComponent(project, selector);
    if (!component) return [];
    const readControllers = (
        target: typeof component,
        excludeControllerName = "",
    ): ControllerActionTarget["controllers"] => (target.controllers || [])
        .filter((controller) => controller.name && controller.name !== excludeControllerName)
        .map((controller) => ({
            name: String(controller.name),
            pages: (controller.pages || []).map((page) => ({
                id: String(page.id || ""),
                name: String(page.name || ""),
            })).filter((page) => page.id),
        }));
    const targets: ControllerActionTarget[] = [];
    const rootControllers = readControllers(component, sourceControllerName);
    if (rootControllers.length > 0) {
        targets.push({ nodeId: "", label: "(component root)", controllers: rootControllers });
    }
    for (const node of component.displayList || []) {
        const resourceId = String(node.resource?.resourceId || node.src || "");
        if (!resourceId) continue;
        const target = findResource(project, {
            packageId: String(node.resource?.packageId || node.packageId || selector.packageId),
            resourceId,
        })?.component;
        if (!target) continue;
        const controllers = readControllers(target);
        if (controllers.length === 0) continue;
        targets.push({
            nodeId: String(node.id || ""),
            label: String(node.name || node.id || resourceId),
            controllers,
        });
    }
    return targets;
}

function showControllerActionEditor(
    options: ControllerEditorContext,
    selector: EditorComponentSelector,
    controllerName: string,
    controllerModel: ControllerEditorModel,
    actionIndex: number | null,
    onApply: (action: ControllerActionModel) => void,
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
    const component = findComponent(options.getWorkingProject(), selector);
    if (!component) return;
    const source = structuredClone(
        actionIndex === null
            ? createControllerActionDraft(0)
            : controllerModel.actions[actionIndex],
    ) as ControllerActionModel;
    const targets = getControllerActionTargets(options, selector, controllerName);
    const transitions = (component.transitions || [])
        .map((transition) => String(transition.name || ""))
        .filter(Boolean);

    options.getAuxDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "controllerActionEditorDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(640, 274);
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `${actionIndex === null ? "Add" : "Edit"} controller action`;
    const hint = content.getChild("n2").asTextField;
    hint.setXY(16, 34);
    hint.setSize(608, 18);
    hint.color = "#8ccf7e";

    addInspectorLine(content, "controllerActionTypeLabel", "Action", 16, 62, 52, "#bdbdbd");
    const actionTypeInput = createTimelineComboBox(
        content,
        "controllerActionType",
        70,
        58,
        170,
        ["Play Transition", "Change Page"],
        ["0", "1"],
        source.actionType === 1 ? 1 : 0,
    );
    let fromPageIds = [...source.fromPageIds];
    let toPageIds = [...source.toPageIds];
    const formatPageSet = (pageIds: string[]): string => pageIds.length > 0
        ? pageIds.map((pageId) => (
            controllerModel.pages.find((page) => page.id === pageId)?.name || pageId
        )).join(", ")
        : "Any page";
    addInspectorLine(content, "controllerActionFromLabel", "From", 16, 90, 52, "#bdbdbd");
    const fromPageButton = createInspectorButton(
        content,
        "controllerActionFromPages",
        formatPageSet(fromPageIds),
        70,
        86,
        236,
    );
    setOverflowButtonTitle(fromPageButton, formatPageSet(fromPageIds));
    addInspectorLine(content, "controllerActionToLabel", "To", 320, 90, 40, "#bdbdbd");
    const toPageButton = createInspectorButton(
        content,
        "controllerActionToPages",
        formatPageSet(toPageIds),
        364,
        86,
        260,
    );
    setOverflowButtonTitle(toPageButton, formatPageSet(toPageIds));
    const showPageSetMenu = (
        anchor: fgui.GButton,
        selected: string[],
        update: (pageIds: string[]) => void,
    ): void => {
        const menu = options.createActionMenu();
        const any = options.addMenuItem(
            menu,
            "controllerActionAnyPage",
            "Any page",
            () => update([]),
        );
        menu.setItemCheckable(any.name, true);
        menu.setItemChecked(any.name, selected.length === 0);
        for (let index = 0; index < controllerModel.pages.length; index += 1) {
            const page = controllerModel.pages[index];
            const item = options.addMenuItem(
                menu,
                `controllerActionPage-${index}`,
                `${page.name || "(unnamed)"} (${page.id})`,
                () => {
                const next = selected.includes(page.id)
                    ? selected.filter((pageId) => pageId !== page.id)
                    : [...selected, page.id];
                update(next);
                },
            );
            menu.setItemCheckable(item.name, true);
            menu.setItemChecked(item.name, selected.includes(page.id));
        }
        menu.contentPane.setSize(236, menu.contentPane.height);
        menu.show(anchor);
    };
    fromPageButton.onClick(options.eventOwner, () => {
        showPageSetMenu(fromPageButton, fromPageIds, (pageIds) => {
            fromPageIds = pageIds;
            setOverflowButtonTitle(fromPageButton, formatPageSet(fromPageIds));
        });
    });
    toPageButton.onClick(options.eventOwner, () => {
        showPageSetMenu(toPageButton, toPageIds, (pageIds) => {
            toPageIds = pageIds;
            setOverflowButtonTitle(toPageButton, formatPageSet(toPageIds));
        });
    });

    const playObjects: fgui.GObject[] = [];
    playObjects.push(addInspectorLine(
        content,
        "controllerActionTransitionLabel",
        "Transition",
        16,
        122,
        66,
        "#bdbdbd",
    ));
    const transitionInput = createTimelineComboBox(
        content,
        "controllerActionTransition",
        84,
        118,
        222,
        transitions.length > 0 ? transitions : ["(no transition)"],
        transitions.length > 0 ? transitions : [""],
        Math.max(0, transitions.indexOf(source.transitionName)),
    );
    playObjects.push(transitionInput);
    playObjects.push(addInspectorLine(
        content,
        "controllerActionRepeatLabel",
        "Repeat",
        320,
        122,
        46,
        "#bdbdbd",
    ));
    const repeatInput = createInspectorTextInput(
        content,
        "controllerActionRepeat",
        368,
        118,
        64,
        String(source.playTimes ?? 1),
        true,
    );
    playObjects.push(repeatInput);
    playObjects.push(addInspectorLine(
        content,
        "controllerActionDelayLabel",
        "Delay",
        446,
        122,
        40,
        "#bdbdbd",
    ));
    const delayInput = createInspectorTextInput(
        content,
        "controllerActionDelay",
        488,
        118,
        64,
        String(source.delay ?? 0),
        true,
    );
    playObjects.push(delayInput);
    let stopControl!: ReturnType<typeof createCheckButton>;
    stopControl = createCheckButton(
        content,
        "controllerActionStopOnExit",
        "Stop on exit",
        16,
        146,
        130,
        Boolean(source.stopOnExit),
        () => {
            stopControl.button.selected = !stopControl.button.selected;
        },
    );
    playObjects.push(stopControl.host);

    const changeObjects: fgui.GObject[] = [];
    changeObjects.push(addInspectorLine(
        content,
        "controllerActionTargetLabel",
        "Target",
        16,
        122,
        52,
        "#bdbdbd",
    ));
    const targetInput = createTimelineComboBox(
        content,
        "controllerActionTarget",
        70,
        118,
        236,
        targets.length > 0 ? targets.map((target) => target.label) : ["(no controller target)"],
        targets.length > 0 ? targets.map((target) => target.nodeId) : [""],
        Math.max(0, targets.findIndex((target) => target.nodeId === source.targetNodeId)),
    );
    changeObjects.push(targetInput);
    changeObjects.push(addInspectorLine(
        content,
        "controllerActionControllerLabel",
        "Controller",
        320,
        122,
        66,
        "#bdbdbd",
    ));
    const targetControllerInput = createTimelineComboBox(
        content,
        "controllerActionController",
        388,
        118,
        236,
        ["(controller)"],
        [""],
        0,
    );
    changeObjects.push(targetControllerInput);
    changeObjects.push(addInspectorLine(
        content,
        "controllerActionTargetPageLabel",
        "Page",
        16,
        150,
        52,
        "#bdbdbd",
    ));
    const targetPageInput = createTimelineComboBox(
        content,
        "controllerActionTargetPage",
        70,
        146,
        236,
        ["(page)"],
        [""],
        0,
    );
    changeObjects.push(targetPageInput);
    const setComboOptions = (
        combo: fgui.GComboBox,
        items: string[],
        values: string[],
        preferred: string,
    ): void => {
        combo.items = items.length > 0 ? items : ["(none)"];
        combo.values = values.length > 0 ? values : [""];
        combo.selectedIndex = Math.max(0, combo.values.indexOf(preferred));
    };
    const updateTargetPages = (preferred = ""): void => {
        const target = targets.find((item) => item.nodeId === targetInput.value);
        const controller = target?.controllers.find((item) => item.name === targetControllerInput.value);
        const pages = controller?.pages || [];
        setComboOptions(
            targetPageInput,
            [
                "Same index (~1)",
                "Same name (~2)",
                ...pages.map((page) => `${page.name || "(unnamed)"} (${page.id})`),
            ],
            ["~1", "~2", ...pages.map((page) => page.id)],
            preferred,
        );
    };
    const updateTargetControllers = (
        preferredController = "",
        preferredPage = "",
    ): void => {
        const target = targets.find((item) => item.nodeId === targetInput.value);
        const controllers = target?.controllers || [];
        setComboOptions(
            targetControllerInput,
            controllers.map((controller) => controller.name),
            controllers.map((controller) => controller.name),
            preferredController,
        );
        updateTargetPages(preferredPage);
    };
    targetInput.on(fgui.Events.STATE_CHANGED, options.eventOwner, () => updateTargetControllers());
    targetControllerInput.on(fgui.Events.STATE_CHANGED, options.eventOwner, () => updateTargetPages());
    updateTargetControllers(source.controllerName, source.targetPage);

    const updateActionType = (): void => {
        const play = Number(actionTypeInput.value) === 0;
        for (const object of playObjects) object.visible = play;
        for (const object of changeObjects) object.visible = !play;
        hint.text = play
            ? "Play Transition runs after the selected From/To page change."
            : "Change Page targets another controller on this component or a direct child component.";
    };
    actionTypeInput.on(fgui.Events.STATE_CHANGED, options.eventOwner, updateActionType);
    updateActionType();

    const confirm = content.getChild("n1").asButton;
    const cancel = content.getChild("n3").asButton;
    confirm.title = actionIndex === null ? "Add Action" : "Apply";
    confirm.setXY(430, 226);
    confirm.setSize(92, 22);
    cancel.title = "Cancel";
    cancel.setXY(532, 226);
    cancel.setSize(92, 22);
    confirm.onClick(options.eventOwner, () => {
        const actionType = Number(actionTypeInput.value);
        const playTimes = Number(repeatInput.text);
        const delay = Number(delayInput.text);
        if (actionType === 0 && !transitionInput.value) {
            options.setStatus("Controller action unavailable: choose an existing transition.");
            return;
        }
        if (
            actionType === 0
            && (!Number.isInteger(playTimes) || playTimes === 0 || playTimes < -1 || !Number.isFinite(delay) || delay < 0)
        ) {
            options.setStatus("Controller action unavailable: Repeat must be -1 or a positive integer; Delay must be non-negative.");
            return;
        }
        if (
            actionType === 1
            && (!targetControllerInput.value || !targetPageInput.value)
        ) {
            options.setStatus("Controller action unavailable: choose a target controller and page.");
            return;
        }
        const action: ControllerActionModel = {
            ...source,
            actionType,
            fromPageIds: [...fromPageIds],
            toPageIds: [...toPageIds],
            transitionName: actionType === 0 ? transitionInput.value : "",
            playTimes: actionType === 0 ? playTimes : 1,
            delay: actionType === 0 ? delay : 0,
            stopOnExit: actionType === 0 && stopControl.button.selected,
            targetNodeId: actionType === 1 ? targetInput.value : "",
            controllerName: actionType === 1 ? targetControllerInput.value : "",
            targetPage: actionType === 1 ? targetPageInput.value : "",
        };
        const candidate = structuredClone(controllerModel);
        if (actionIndex === null) candidate.actions.push(action);
        else candidate.actions[actionIndex] = action;
        const prepared = prepareUpdateControllerModel(
            options.getWorkingProject(),
            selector,
            controllerName,
            candidate,
        );
        if (prepared.ok === false) {
            options.setStatus(`Controller action unavailable: ${prepared.code}. ${prepared.message}`);
            return;
        }
        onApply(action);
        options.setDebugAttribute(
            "data-fairy-editor-controller-action-editor",
            `${controllerName}:${actionIndex === null ? "add" : actionIndex}:${actionType}`,
        );
        dialog.dispose();
        if (options.getAuxDialog() === dialog) options.setAuxDialog(null);
    });
    cancel.onClick(options.eventOwner, () => {
        dialog.dispose();
        if (options.getAuxDialog() === dialog) options.setAuxDialog(null);
        options.setStatus("Controller action edit cancelled.");
    });
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setAuxDialog(dialog);
    options.setStatus(`${actionIndex === null ? "Adding" : "Editing"} ${controllerName} controller action.`);
}

export function showControllerEditor(options: ControllerEditorContext, controllerName: string): void {
    const selector = options.getSelectedComponentSelector();
    const model = selector
        ? getControllerModel(
            options.getWorkingProject(),
            selector,
            controllerName,
        ) as ControllerEditorModel | null
        : null;
    if (!selector || !model || !Array.isArray(model.pages) || model.pages.length === 0) {
        options.setStatus("Controller editor unavailable: choose a controller with at least one page.");
        return;
    }
    model.alias = String(model.alias || "");
    model.exported = model.exported === true;
    model.homePageType = ["default", "specific", "branch", "variable"].includes(model.homePageType)
        ? model.homePageType
        : "default";
    model.homePage = String(model.homePage || "");

    options.getControllerDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopControllerEditDialog";
    const content = fgui.UIPackage.createObject("Builder", "ControllerEditDialog").asCom;
    dialog.contentPane = content;
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `Controller ${controllerName}`;
    content.getChild("name").asComboBox.text = controllerName;
    content.getChild("name").enabled = false;
    content.getChild("autoRadioGroupDepth").asButton.selected = model.autoRadioGroupDepth;
    const aliasInput = content.getChild("alias").asCom.getChild("title").asTextInput;
    aliasInput.editable = true;
    aliasInput.text = model.alias;
    content.getChild("exported").asButton.selected = model.exported;
    for (const childName of [
        "deleteController",
        "buttonTemplate",
    ]) {
        const child = content.getChild(childName);
        if (child) child.visible = false;
    }
    for (const childName of ["n104", "n105"]) {
        const child = content.getChild(childName);
        if (child) child.visible = false;
    }
    const pageHeader = content.getChild("n103");
    if (pageHeader) pageHeader.setSize(310, pageHeader.height);
    content.getChild("n39").text = "Alias";
    content.getChild("n115").text = "Home";
    const homePageType = content.getChild("homePageType").asComboBox;
    homePageType.items = ["First page", "Specific page", "Match branch name", "Match variable name"];
    homePageType.values = ["default", "specific", "branch", "variable"];
    homePageType.selectedIndex = Math.max(0, homePageType.values.indexOf(model.homePageType));
    const specificHomePage = content.getChild("homePage").asLabel;
    const variableHomePage = content.getChild("homePage_var").asComboBox;
    let specificHomePageId = model.homePageType === "specific"
        ? model.homePage
        : model.pages[0]?.id || "";
    let specificHomePageMenu: fgui.PopupMenu | null = null;
    const renderSpecificHomePage = (): void => {
        const page = model.pages.find((candidate) => candidate.id === specificHomePageId);
        specificHomePage.title = page?.name || page?.id || "Select page";
    };
    specificHomePage.onClick(options.eventOwner, () => {
        specificHomePageMenu?.dispose();
        const menu = new fgui.PopupMenu();
        specificHomePageMenu = menu;
        for (const page of model.pages) {
            const item = menu.addItem(page.name || page.id, () => {
                specificHomePageId = page.id;
                renderSpecificHomePage();
            });
            item.name = `desktopControllerHomePage_${page.id}`;
            const shortcut = item.getChild("shortcut");
            if (shortcut) shortcut.text = "";
        }
        menu.show(specificHomePage);
    });
    const project = options.getWorkingProject() as {
        settings?: { customProperties?: Record<string, unknown> };
    } | null;
    const customPropertyKeys = Object.keys(project?.settings?.customProperties || {});
    const renderHomePage = (): void => {
        const type = homePageType.values[homePageType.selectedIndex] as ControllerEditorModel["homePageType"];
        content.getController("homepage").selectedIndex = homePageType.selectedIndex;
        const values = type === "variable" ? [...customPropertyKeys] : [];
        const items = [...values];
        if (type === model.homePageType && model.homePage && !values.includes(model.homePage)) {
            values.push(model.homePage);
            items.push(`Current: ${model.homePage}`);
        }
        variableHomePage.items = items;
        variableHomePage.values = values;
        variableHomePage.selectedIndex = Math.max(
            0,
            values.indexOf(type === model.homePageType ? model.homePage : values[0] || ""),
        );
        renderSpecificHomePage();
    };
    homePageType.on(fgui.Events.STATE_CHANGED, options.eventOwner, renderHomePage);
    const hint = addInspectorLine(
        content,
        "desktopControllerEditorBoundary",
        "Pages and actions save as one updateController transaction.",
        410,
        62,
        392,
        "#8ccf7e",
    );
    hint.singleLine = true;

    const pageList = content.getChild("pageList").asList;
    let selectedPageId = model.pages[
        Math.max(0, Math.min(model.pages.length - 1, Number(model.selectedIndex || 0)))
    ]?.id || model.pages[0].id;
    const capturePageNames = (): void => {
        for (let index = 0; index < Math.min(pageList.numChildren, model.pages.length); index += 1) {
            model.pages[index].name = pageList.getChildAt(index).asCom
                .getChild("name").asCom.getChild("input").text;
        }
    };
    const renderPages = (): void => {
        pageList.removeChildrenToPool();
        for (let index = 0; index < model.pages.length; index += 1) {
            const page = model.pages[index];
            const row = pageList.addItemFromPool().asButton;
            row.data = { pageId: page.id } satisfies ControllerPageRowData;
            row.setSize(pageList.width - 2, 20);
            row.getChild("index").text = String(index);
            const nameHost = row.getChild("name").asCom;
            nameHost.setSize(row.width - 47, 20);
            nameHost.getController("c1").selectedIndex = 1;
            nameHost.getChild("input").asTextInput.text = page.name;
            nameHost.getChild("input").asTextInput.editable = true;
            const separator = row.getChild("n14");
            const remark = row.getChild("remark");
            if (separator) separator.visible = false;
            if (remark) remark.visible = false;
        }
        const selectedIndex = Math.max(
            0,
            model.pages.findIndex((page) => page.id === selectedPageId),
        );
        selectedPageId = model.pages[selectedIndex].id;
        model.selectedIndex = selectedIndex;
        pageList.selectedIndex = selectedIndex;
        renderHomePage();
    };
    pageList.on(fgui.Events.CLICK_ITEM, options.eventOwner, (itemObject: fgui.GObject) => {
        capturePageNames();
        const data = itemObject.data as ControllerPageRowData | null;
        if (!data) return;
        selectedPageId = data.pageId;
        model.selectedIndex = Math.max(
            0,
            model.pages.findIndex((page) => page.id === selectedPageId),
        );
    });
    content.getChild("addPage").asButton.onClick(options.eventOwner, () => {
        capturePageNames();
        selectedPageId = insertControllerPageDraft(model, model.pages.length);
        renderPages();
    });
    content.getChild("insertPage").asButton.onClick(options.eventOwner, () => {
        capturePageNames();
        selectedPageId = insertControllerPageDraft(model, pageList.selectedIndex);
        renderPages();
    });
    content.getChild("removePage").asButton.onClick(options.eventOwner, () => {
        capturePageNames();
        if (!removeControllerPageDraft(model, selectedPageId)) {
            options.setStatus("Controller page removal skipped: a controller requires at least one page.");
            return;
        }
        selectedPageId = model.pages[model.selectedIndex]?.id || model.pages[0].id;
        renderPages();
    });
    const movePage = (delta: -1 | 1): void => {
        capturePageNames();
        if (!moveControllerPageDraft(model, selectedPageId, delta)) return;
        renderPages();
    };
    content.getChild("moveUp").asButton.onClick(options.eventOwner, () => movePage(-1));
    content.getChild("moveDown").asButton.onClick(options.eventOwner, () => movePage(1));

    const actionList = content.getChild("actionList").asList;
    const addActionButton = content.getChild("addAction").asButton;
    const removeActionButton = content.getChild("removeAction").asButton;
    const moveUpActionButton = content.getChild("moveUpAction").asButton;
    const moveDownActionButton = content.getChild("moveDownAction").asButton;
    const editActionButton = createInspectorButton(
        content,
        "editControllerAction",
        "Edit",
        552,
        94,
        52,
    );
    let selectedActionIndex = model.actions.length > 0 ? 0 : -1;
    const formatPages = (pageIds: string[]): string => pageIds.length > 0
        ? pageIds.map((pageId) => (
            model.pages.find((page) => page.id === pageId)?.name || pageId
        )).join(", ")
        : "Any";
    const updateActionButtons = (): void => {
        const selected = selectedActionIndex >= 0 && selectedActionIndex < model.actions.length;
        setActionEnabled(editActionButton, selected);
        setActionEnabled(removeActionButton, selected);
        setActionEnabled(moveUpActionButton, selected && selectedActionIndex > 0);
        setActionEnabled(
            moveDownActionButton,
            selected && selectedActionIndex < model.actions.length - 1,
        );
    };
    const renderActions = (): void => {
        actionList.removeChildrenToPool();
        const setRowLabel = (label: fgui.GLabel, value: string): void => {
            label.title = value;
            label.tooltips = value;
            setOverflowText(label.getTextField(), value);
        };
        for (let index = 0; index < model.actions.length; index += 1) {
            const action = model.actions[index];
            const row = actionList.addItemFromPool().asButton;
            row.data = { actionIndex: index } satisfies ControllerActionRowData;
            row.getController("type").selectedIndex = action.actionType === 1 ? 1 : 0;
            setRowLabel(row.getChild("fromPage").asLabel, formatPages(action.fromPageIds));
            setRowLabel(row.getChild("toPage").asLabel, formatPages(action.toPageIds));
            setRowLabel(row.getChild("transitionName").asLabel, action.transitionName || "(transition)");
            setRowLabel(row.getChild("controllerName").asLabel, [
                action.targetNodeId,
                action.controllerName,
            ].filter(Boolean).join(".") || "(controller)");
            setRowLabel(row.getChild("targetPage").asLabel, action.targetPage || "(page)");
            for (const childName of [
                "fromPage",
                "toPage",
                "transitionName",
                "edit",
                "controllerName",
                "targetPage",
            ]) {
                row.getChild(childName).touchable = false;
            }
        }
        selectedActionIndex = model.actions.length === 0
            ? -1
            : Math.max(0, Math.min(selectedActionIndex, model.actions.length - 1));
        actionList.selectedIndex = selectedActionIndex;
        updateActionButtons();
        options.setDebugAttribute(
            "data-fairy-editor-controller-action-draft",
            `${controllerName}:${model.actions.map((action) => action.actionType).join(",") || "none"}`,
        );
    };
    const editAction = (actionIndex: number | null): void => {
        showControllerActionEditor(options, 
            selector,
            controllerName,
            model,
            actionIndex,
            (action) => {
                if (actionIndex === null) {
                    model.actions.push(action);
                    selectedActionIndex = model.actions.length - 1;
                } else {
                    model.actions[actionIndex] = action;
                    selectedActionIndex = actionIndex;
                }
                renderActions();
                options.setStatus(
                    `Controller action draft ${actionIndex === null ? "added" : "updated"}; controller is unchanged until Save.`,
                );
            },
        );
    };
    actionList.on(fgui.Events.CLICK_ITEM, options.eventOwner, (itemObject: fgui.GObject) => {
        const data = itemObject.data as ControllerActionRowData | null;
        if (!data) return;
        selectedActionIndex = data.actionIndex;
        updateActionButtons();
    });
    addActionButton.onClick(options.eventOwner, () => editAction(null));
    editActionButton.onClick(options.eventOwner, () => {
        if (selectedActionIndex >= 0) editAction(selectedActionIndex);
    });
    removeActionButton.onClick(options.eventOwner, () => {
        if (!removeControllerActionDraft(model, selectedActionIndex)) return;
        selectedActionIndex = Math.min(selectedActionIndex, model.actions.length - 1);
        renderActions();
    });
    const moveAction = (delta: -1 | 1): void => {
        if (!moveControllerActionDraft(model, selectedActionIndex, delta)) return;
        selectedActionIndex += delta;
        renderActions();
    };
    moveUpActionButton.onClick(options.eventOwner, () => moveAction(-1));
    moveDownActionButton.onClick(options.eventOwner, () => moveAction(1));

    content.getChild("save").asButton.onClick(options.eventOwner, () => {
        capturePageNames();
        model.autoRadioGroupDepth = content.getChild("autoRadioGroupDepth").asButton.selected;
        model.alias = aliasInput.text;
        model.exported = content.getChild("exported").asButton.selected;
        model.homePageType = homePageType.values[homePageType.selectedIndex] as ControllerEditorModel["homePageType"];
        model.homePage = model.homePageType === "specific"
            ? specificHomePageId
            : model.homePageType === "variable"
                ? variableHomePage.values[variableHomePage.selectedIndex] || ""
                : "";
        void options.applyPreparation(prepareUpdateControllerModel(
            options.getWorkingProject(),
            selector,
            controllerName,
            model,
        )).then((applied) => {
            if (!applied) return;
            options.setSelectedControllerName(controllerName);
            options.setDebugAttribute("data-fairy-editor-controller-editor", "applied");
            dialog.dispose();
            if (options.getControllerDialog() === dialog) options.setControllerDialog(null);
        });
    });
    content.getChild("cancel").asButton.onClick(options.eventOwner, () => {
        options.setDebugAttribute("data-fairy-editor-controller-editor", "cancelled");
        dialog.dispose();
        if (options.getControllerDialog() === dialog) options.setControllerDialog(null);
        options.setStatus("Controller edit cancelled.");
    });
    renderPages();
    renderActions();
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setControllerDialog(dialog);
    options.setDebugAttribute("data-fairy-editor-controller-editor", controllerName);
    options.setStatus(`Editing controller ${controllerName} pages and actions.`);
}
