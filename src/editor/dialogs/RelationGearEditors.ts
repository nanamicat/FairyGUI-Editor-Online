import {
    TRANSITION_EASES,
    createTypedGearModel,
    displayNodeSupportsGearKind,
    getDisplayNodeGearEditorModel,
    getDisplayNodeRelationModel,
    prepareUpdateDisplayNodeGears,
    prepareUpdateDisplayNodeRelations,
    type HighRiskTransactionPreparation,
    type TypedGearModel,
} from "../commands/HighRiskAuthoringTransactions";
import type { EditorDisplayNodeSelector } from "../model/EditorCommand";
import type { ProjectSnapshotDisplayNode } from "../model/ProjectSnapshot";
import {
    addInspectorLine,
    createInspectorCheckButton,
    createInspectorTextInput,
    createTimelineComboBox,
} from "../ui/EditorFormControls";

export type RelationGearEditorContext = {
    selector: EditorDisplayNodeSelector | null;
    selectedNode: ProjectSnapshotDisplayNode | null;
    getWorkingProject(): unknown | null;
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    applyPreparation(preparation: HighRiskTransactionPreparation): Promise<boolean>;
    setStatus(message: string): void;
    setDebugAttribute(name: string, value: string): void;
    eventOwner: object;
};

const DESKTOP_RELATION_LABELS = [
    "Left → Left",
    "Left → Center",
    "Left → Right",
    "Center",
    "Right → Left",
    "Right → Center",
    "Right → Right",
    "Left ext → Left",
    "Left ext → Right",
    "Right ext → Left",
    "Right ext → Right",
    "Width",
    "Top → Top",
    "Top → Middle",
    "Top → Bottom",
    "Middle",
    "Bottom → Top",
    "Bottom → Middle",
    "Bottom → Bottom",
    "Top ext → Top",
    "Top ext → Bottom",
    "Bottom ext → Top",
    "Bottom ext → Bottom",
    "Height",
] as const;
const DESKTOP_GEAR_KINDS = [
    "display", "display2", "xy", "size", "look", "color", "animation", "text", "icon", "fontSize",
] as const;
const DESKTOP_GEAR_LABELS: Record<string, string> = {
    display: "Display",
    display2: "Display 2",
    xy: "Position",
    size: "Size",
    look: "Look",
    color: "Color",
    animation: "Animation",
    text: "Text",
    icon: "Icon",
    fontSize: "Font Size",
};
const DESKTOP_GEAR_TWEEN_KINDS = new Set(["xy", "size", "look", "color"]);
interface DesktopGearValueField {
    key: string;
    label: string;
    kind: "number" | "text" | "color" | "boolean";
}
const DESKTOP_GEAR_VALUE_FIELDS: Record<string, DesktopGearValueField[]> = {
    xy: [
        { key: "x", label: "X", kind: "number" },
        { key: "y", label: "Y", kind: "number" },
    ],
    size: [
        { key: "width", label: "Width", kind: "number" },
        { key: "height", label: "Height", kind: "number" },
        { key: "scaleX", label: "Scale X", kind: "number" },
        { key: "scaleY", label: "Scale Y", kind: "number" },
    ],
    look: [
        { key: "alpha", label: "Alpha", kind: "number" },
        { key: "rotation", label: "Rotation", kind: "number" },
        { key: "grayed", label: "Grayed", kind: "boolean" },
        { key: "touchable", label: "Touchable", kind: "boolean" },
    ],
    color: [
        { key: "color", label: "Color", kind: "color" },
        { key: "outlineColor", label: "Outline", kind: "color" },
    ],
    animation: [
        { key: "frame", label: "Frame", kind: "number" },
        { key: "playing", label: "Playing", kind: "boolean" },
        { key: "animationName", label: "Animation", kind: "text" },
        { key: "skinName", label: "Skin", kind: "text" },
    ],
    text: [{ key: "text", label: "Text", kind: "text" }],
    icon: [{ key: "icon", label: "Icon URL", kind: "text" }],
    fontSize: [{ key: "fontSize", label: "Font Size", kind: "number" }],
};

export function showDesktopRelationEditor(options: RelationGearEditorContext): void {
    const selector = options.selector;
    const selectedNode = options.selectedNode;
    const model = selector
        ? getDisplayNodeRelationModel(options.getWorkingProject(), selector)
        : null;
    if (!selector || !selectedNode || !model) {
        options.setStatus("Relations skipped: select one editable display node.");
        return;
    }

    options.getActiveDialog()?.dispose();
    const draftRelations = model.relations.map((relation) => ({ ...relation }));
    const draftTargets = new Set(["", ...draftRelations.map((relation) => relation.targetNodeId)]);
    const targetById = new Map(model.targets.map((target) => [target.id, target]));
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopRelationEditorDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(370, 430);
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `${selectedNode.name || selectedNode.id} - Relations`;
    const hint = content.getChild("n2");
    hint.text = "Relations are staged here and saved as one atomic history group.";
    hint.setXY(16, 32);
    hint.setSize(338, 20);

    const panel = fgui.UIPackage.createObject("Builder", "RelationPropsPanel").asCom;
    panel.name = "desktopRelationPropsPanel";
    panel.setXY(50, 56);
    panel.setSize(270, 318);
    const list = panel.getChild("list").asList;
    list.setSize(270, 280);
    const addTarget = panel.getChild("add").asButton;
    addTarget.setXY(10, 286);
    addTarget.title = "Add target";
    content.addChild(panel);

    const confirm = content.getChild("n1").asButton;
    const cancel = content.getChild("n3").asButton;
    confirm.title = "Save";
    confirm.setXY(166, 392);
    confirm.setSize(86, 22);
    cancel.title = "Cancel";
    cancel.setXY(268, 392);
    cancel.setSize(86, 22);

    let typePopup: fgui.GComponent | null = null;
    let targetMenu: fgui.PopupMenu | null = null;
    const relationsForTarget = (targetNodeId: string) => (
        draftRelations.filter((relation) => relation.targetNodeId === targetNodeId)
    );
    const relationSummary = (targetNodeId: string) => (
        relationsForTarget(targetNodeId)
            .map((relation) => `${DESKTOP_RELATION_LABELS[relation.type]}${relation.usePercent ? " %" : ""}`)
            .join(", ") || "(none)"
    );
    const setRelation = (targetNodeId: string, type: number, usePercent: boolean): void => {
        const index = draftRelations.findIndex((relation) => (
            relation.targetNodeId === targetNodeId && relation.type === type
        ));
        if (index >= 0 && draftRelations[index].usePercent === usePercent) {
            draftRelations.splice(index, 1);
        } else if (index >= 0) {
            draftRelations[index] = { targetNodeId, type, usePercent };
        } else {
            draftRelations.push({ targetNodeId, type, usePercent });
        }
    };
    const replaceTargetRelations = (
        targetNodeId: string,
        replacements: Array<{ type: number; usePercent: boolean }>,
    ): void => {
        const retained = draftRelations.filter((relation) => relation.targetNodeId !== targetNodeId);
        draftRelations.splice(
            0,
            draftRelations.length,
            ...retained,
            ...replacements.map((relation) => ({ targetNodeId, ...relation })),
        );
    };
    const closeDialog = (): void => {
        if (typePopup) {
            fgui.GRoot.inst.hidePopup(typePopup);
            typePopup.dispose();
            typePopup = null;
        }
        targetMenu?.dispose();
        targetMenu = null;
        dialog.dispose();
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    };
    const showTypes = (targetNodeId: string, anchor: fgui.GObject): void => {
        if (typePopup) {
            fgui.GRoot.inst.hidePopup(typePopup);
            typePopup.dispose();
        }
        const popup = fgui.UIPackage.createObject("Builder", "RelationTypePopup").asCom;
        popup.name = "desktopRelationTypePopup";
        typePopup = popup;
        const syncPopup = (): void => {
            const active = new Map(
                relationsForTarget(targetNodeId).map((relation) => [relation.type, relation.usePercent]),
            );
            for (let type = 0; type < DESKTOP_RELATION_LABELS.length; type += 1) {
                const relationLabel = popup.getChild(String(type));
                if (!relationLabel) continue;
                const titleButton = relationLabel.asCom.getChild("title").asButton;
                const percentButton = relationLabel.asCom.getChild("percent").asButton;
                titleButton.selected = active.get(type) === false;
                percentButton.selected = active.get(type) === true;
            }
        };
        for (let type = 0; type < DESKTOP_RELATION_LABELS.length; type += 1) {
            const relationLabel = popup.getChild(String(type));
            if (!relationLabel) continue;
            const titleButton = relationLabel.asCom.getChild("title").asButton;
            const percentButton = relationLabel.asCom.getChild("percent").asButton;
            titleButton.onClick(options.eventOwner, () => {
                setRelation(targetNodeId, type, false);
                anchor.asLabel.title = relationSummary(targetNodeId);
                syncPopup();
            });
            percentButton.onClick(options.eventOwner, () => {
                setRelation(targetNodeId, type, true);
                anchor.asLabel.title = relationSummary(targetNodeId);
                syncPopup();
            });
        }
        popup.getChild("finish").onClick(options.eventOwner, () => fgui.GRoot.inst.hidePopup(popup));
        syncPopup();
        fgui.GRoot.inst.showPopup(popup, anchor);
    };
    const renderRows = (): void => {
        list.removeChildren(0, -1, true);
        for (const targetNodeId of draftTargets) {
            const row = fgui.UIPackage.createObject("Builder", "RelationPropsItem").asCom;
            row.name = `desktopRelationTarget_${targetNodeId || "container"}`;
            row.getController("c1").selectedIndex = targetNodeId ? 0 : 1;
            row.getController("valid").selectedIndex = 1;
            const targetInput = row.getChild("target").asCom;
            if (targetNodeId) {
                const target = targetById.get(targetNodeId);
                targetInput.asLabel.title = target ? `${target.name} (${target.id})` : targetNodeId;
                targetInput.getController("c1").selectedIndex = 0;
            }
            const relationButton = row.getChild("relations");
            relationButton.asLabel.title = relationSummary(targetNodeId);
            relationButton.onClick(options.eventOwner, () => showTypes(targetNodeId, relationButton));
            row.getChild("clear").onClick(options.eventOwner, () => {
                replaceTargetRelations(targetNodeId, []);
                if (targetNodeId) draftTargets.delete(targetNodeId);
                renderRows();
            });
            row.getChild("sizeRelation").onClick(options.eventOwner, () => {
                replaceTargetRelations("", [
                    { type: 11, usePercent: false },
                    { type: 23, usePercent: false },
                ]);
                relationButton.asLabel.title = relationSummary("");
            });
            row.getChild("centerRelation").onClick(options.eventOwner, () => {
                replaceTargetRelations("", [
                    { type: 3, usePercent: false },
                    { type: 15, usePercent: false },
                ]);
                relationButton.asLabel.title = relationSummary("");
            });
            list.addChild(row);
        }
    };

    addTarget.onClick(options.eventOwner, () => {
        targetMenu?.dispose();
        const menu = new fgui.PopupMenu();
        targetMenu = menu;
        const available = model.targets.filter((target) => !draftTargets.has(target.id));
        for (const target of available) {
            const item = menu.addItem(`${target.name} (${target.kind}, ${target.id})`, () => {
                draftTargets.add(target.id);
                renderRows();
            });
            item.name = `desktopRelationTargetOption_${target.id}`;
            const shortcut = item.getChild("shortcut");
            if (shortcut) shortcut.text = "";
        }
        if (available.length === 0) {
            const item = menu.addItem("No other targets", () => undefined);
            const shortcut = item.getChild("shortcut");
            if (shortcut) shortcut.text = "";
            item.enabled = false;
        }
        menu.contentPane.setSize(260, menu.contentPane.height);
        menu.show(addTarget);
    });
    confirm.onClick(options.eventOwner, () => {
        const preparation = prepareUpdateDisplayNodeRelations(
            options.getWorkingProject(),
            selector,
            draftRelations,
        );
        if (!preparation.ok && preparation.code === "relations_unchanged") {
            closeDialog();
            options.setStatus("Relations unchanged.");
            return;
        }
        if (!preparation.ok) {
            options.setStatus(`Relations unavailable: ${preparation.code}. ${preparation.message}`);
            return;
        }
        closeDialog();
        void options.applyPreparation(preparation).then((ok) => {
            if (!ok) return;
            options.setDebugAttribute(
                "data-fairy-editor-relations",
                `${selector.displayNodeId}:${draftRelations.length}`,
            );
        });
    });
    cancel.onClick(options.eventOwner, () => {
        closeDialog();
        options.setStatus("Relation edit cancelled.");
    });
    dialog.contentPane = content;
    dialog.show();
    options.setActiveDialog(dialog);
    renderRows();
    options.setDebugAttribute("data-fairy-editor-relations-dialog", "open");
    options.setStatus(`Editing relations for ${selectedNode.name || selectedNode.id}.`);
}

export function showDesktopGearEditor(options: RelationGearEditorContext): void {
    const selector = options.selector;
    const selectedNode = options.selectedNode;
    if (!selector || !selectedNode) {
        options.setStatus("Gear edit skipped: no display node selected.");
        return;
    }
    const project = options.getWorkingProject();
    const model = getDisplayNodeGearEditorModel(project, selector);
    if (!model) {
        options.setStatus("Gear edit skipped: live display node model is unavailable.");
        return;
    }
    if (model.controllers.length === 0) {
        options.setStatus("Gear edit unavailable: this component has no controller with pages.");
        return;
    }

    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopGearEditorDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(760, 500);
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `Gears — ${selectedNode.name || selectedNode.id}`;
    const hint = content.getChild("n2").asTextField;
    hint.setXY(16, 34);
    hint.setSize(728, 20);
    hint.text = "Controller pages and typed values are staged locally; Save submits one atomic history group.";

    const gearPanel = fgui.UIPackage.createObject("Builder", "GearPropsPanel").asCom;
    gearPanel.name = "desktopGearPropsPanel";
    gearPanel.setXY(16, 60);
    gearPanel.setSize(270, 382);
    content.addChild(gearPanel);
    const gearList = gearPanel.getChild("list").asList;
    gearList.removeChildrenToPool();
    gearList.setSize(270, 344);
    const addGear = gearPanel.getChild("add").asButton;
    addGear.title = "Add gear";
    addGear.setXY(10, 350);

    const editorHost = new fgui.GComponent();
    editorHost.name = "desktopGearEditorHost";
    editorHost.setXY(300, 60);
    editorHost.setSize(444, 382);
    content.addChild(editorHost);
    const confirm = content.getChild("n1").asButton;
    const cancel = content.getChild("n3").asButton;
    confirm.title = "Save";
    confirm.setXY(544, 458);
    confirm.setSize(96, 24);
    cancel.title = "Cancel";
    cancel.setXY(648, 458);
    cancel.setSize(96, 24);

    const draftGears = structuredClone(model.gears) as TypedGearModel[];
    let selectedIndex = draftGears.length > 0 ? 0 : -1;
    let activeMode = "default";
    let commitEditor = (): void => undefined;
    let addMenu: fgui.PopupMenu | null = null;
    const closeDialog = (): void => {
        addMenu?.dispose();
        addMenu = null;
        dialog.dispose();
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
        options.setDebugAttribute("data-fairy-editor-gears-dialog", "closed");
    };
    const findController = (name: string) => model.controllers.find((controller) => controller.name === name)
        || model.controllers[0];
    const normalizeController = (gear: TypedGearModel, controllerName: string): void => {
        const controller = findController(controllerName);
        gear.controllerName = controller.name;
        const pageIds = new Set(controller.pages.map((page) => page.id));
        if (gear.kind === "display" || gear.kind === "display2") {
            gear.visibleOnPageIds = (gear.visibleOnPageIds || []).filter((pageId) => pageIds.has(pageId));
            if (gear.visibleOnPageIds.length === 0) gear.visibleOnPageIds.push(controller.pages[0].id);
        } else {
            gear.states = (gear.states || []).filter((state) => {
                const pageId = (state as { pageId?: unknown }).pageId;
                return typeof pageId === "string" && pageIds.has(pageId);
            });
            if (gear.states.length === 0) {
                gear.states.push({
                    pageId: controller.pages[0].id,
                    value: structuredClone(gear.defaultValue),
                });
            }
        }
        activeMode = gear.kind === "display" || gear.kind === "display2"
            ? controller.pages[0].id
            : "default";
    };
    const gearLabel = (gear: TypedGearModel): string =>
        `${DESKTOP_GEAR_LABELS[String(gear.kind)] || gear.kind} · ${gear.controllerName}`;
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
    const renderEditor = (): void => {
        editorHost.removeChildren(0, -1, true);
        commitEditor = (): void => undefined;
        const gear = draftGears[selectedIndex];
        if (!gear) {
            addInspectorLine(editorHost, "desktopGearEmpty", "No gears. Use Add gear.", 8, 8, 420, "#bdbdbd");
            return;
        }
        const controller = findController(String(gear.controllerName || ""));
        const controllerIndex = Math.max(0, model.controllers.findIndex((item) => item.name === controller.name));
        addInspectorLine(
            editorHost,
            "desktopGearKind",
            DESKTOP_GEAR_LABELS[String(gear.kind)] || String(gear.kind),
            8,
            2,
            200,
            "#ffffff",
        );
        addInspectorLine(editorHost, "desktopGearControllerLabel", "Controller", 8, 30, 68, "#bdbdbd");
        const controllerInput = createTimelineComboBox(
            editorHost,
            "desktopGearController",
            82,
            26,
            218,
            model.controllers.map((item) => item.name),
            model.controllers.map((item) => item.name),
            controllerIndex,
        );
        const pageItems = controller.pages.map((page) => page.name || page.id);
        const pageValues = controller.pages.map((page) => page.id);
        const valueBound = gear.kind !== "display" && gear.kind !== "display2";
        const modeItems = valueBound ? ["Default", ...pageItems] : pageItems;
        const modeValues = valueBound ? ["default", ...pageValues] : pageValues;
        if (!modeValues.includes(activeMode)) activeMode = modeValues[0];
        addInspectorLine(editorHost, "desktopGearPageLabel", valueBound ? "Value" : "Page", 8, 58, 68, "#bdbdbd");
        const modeInput = createTimelineComboBox(
            editorHost,
            "desktopGearPage",
            82,
            54,
            218,
            modeItems,
            modeValues,
            Math.max(0, modeValues.indexOf(activeMode)),
        );
        let y = 84;
        if (!valueBound) {
            let visibleControl!: ReturnType<typeof createCheckButton>;
            visibleControl = createCheckButton(
                editorHost,
                "desktopGearPageVisible",
                "Visible on this page",
                8,
                y,
                220,
                (gear.visibleOnPageIds || []).includes(activeMode),
                () => {
                    visibleControl.button.selected = !visibleControl.button.selected;
                },
            );
            y += 28;
            let conditionInput: fgui.GComboBox | null = null;
            if (gear.kind === "display2") {
                addInspectorLine(editorHost, "desktopGearConditionLabel", "Combine", 8, y + 4, 68, "#bdbdbd");
                conditionInput = createTimelineComboBox(
                    editorHost,
                    "desktopGearCondition",
                    82,
                    y,
                    146,
                    ["AND", "OR"],
                    ["0", "1"],
                    gear.condition === "1" ? 1 : 0,
                );
                y += 28;
            }
            commitEditor = (): void => {
                const pageSet = new Set(gear.visibleOnPageIds || []);
                if (visibleControl.button.selected) pageSet.add(activeMode);
                else pageSet.delete(activeMode);
                gear.visibleOnPageIds = controller.pages
                    .map((page) => page.id)
                    .filter((pageId) => pageSet.has(pageId));
                if (conditionInput) gear.condition = conditionInput.value || "0";
            };
        } else {
            const states = gear.states as Array<{ pageId?: string; value?: unknown }>;
            let state = activeMode === "default"
                ? null
                : states.find((item) => item.pageId === activeMode) || null;
            let overrideControl: ReturnType<typeof createCheckButton> | null = null;
            if (activeMode !== "default") {
                overrideControl = createCheckButton(
                    editorHost,
                    "desktopGearPageOverride",
                    "Override this page",
                    8,
                    y,
                    220,
                    Boolean(state?.value),
                    () => {
                        if (state?.value) {
                            gear.states = states.filter((item) => item.pageId !== activeMode);
                        } else {
                            state = { pageId: activeMode, value: structuredClone(gear.defaultValue) };
                            gear.states = [...states.filter((item) => item.pageId !== activeMode), state];
                        }
                        renderEditor();
                        renderRows();
                    },
                );
                y += 28;
            }
            const targetValue = activeMode === "default"
                ? gear.defaultValue
                : state?.value;
            const value = targetValue && typeof targetValue === "object"
                ? targetValue as Record<string, unknown>
                : null;
            const textInputs = new Map<string, fgui.GTextInput>();
            const booleanInputs = new Map<string, fgui.GButton>();
            if (value) {
                for (const field of DESKTOP_GEAR_VALUE_FIELDS[String(gear.kind)] || []) {
                    addInspectorLine(
                        editorHost,
                        `desktopGearValueLabel_${field.key}`,
                        field.label,
                        8,
                        y + 4,
                        78,
                        "#bdbdbd",
                    );
                    if (field.kind === "boolean") {
                        let control!: ReturnType<typeof createCheckButton>;
                        control = createCheckButton(
                            editorHost,
                            `desktopGearValue_${field.key}`,
                            "",
                            88,
                            y,
                            80,
                            Boolean(value[field.key]),
                            () => {
                                control.button.selected = !control.button.selected;
                            },
                        );
                        booleanInputs.set(field.key, control.button);
                    } else {
                        const rawValue = value[field.key];
                        textInputs.set(field.key, createInspectorTextInput(
                            editorHost,
                            `desktopGearValue_${field.key}`,
                            88,
                            y,
                            212,
                            rawValue === null || rawValue === undefined ? "" : String(rawValue),
                            true,
                        ));
                    }
                    y += 28;
                }
            }

            let percentControl: ReturnType<typeof createCheckButton> | null = null;
            if (gear.kind === "xy") {
                percentControl = createCheckButton(
                    editorHost,
                    "desktopGearPositionsInPercent",
                    "Position in percent",
                    8,
                    y,
                    220,
                    Boolean(gear.positionsInPercent),
                    () => {
                        if (percentControl) percentControl.button.selected = !percentControl.button.selected;
                    },
                );
                y += 28;
            }
            let tweenControl: ReturnType<typeof createCheckButton> | null = null;
            let durationInput: fgui.GTextInput | null = null;
            let delayInput: fgui.GTextInput | null = null;
            let easeInput: fgui.GComboBox | null = null;
            let customEaseInput: fgui.GTextInput | null = null;
            if (DESKTOP_GEAR_TWEEN_KINDS.has(String(gear.kind))) {
                tweenControl = createCheckButton(
                    editorHost,
                    "desktopGearTween",
                    "Tween",
                    8,
                    y,
                    120,
                    Boolean(gear.tween),
                    () => {
                        if (!tweenControl) return;
                        commitEditor();
                        tweenControl.button.selected = !tweenControl.button.selected;
                        gear.tween = tweenControl.button.selected;
                        renderEditor();
                    },
                );
                y += 28;
                if (gear.tween) {
                    addInspectorLine(editorHost, "desktopGearDurationLabel", "Duration", 8, y + 4, 78, "#bdbdbd");
                    durationInput = createInspectorTextInput(editorHost, "desktopGearDuration", 88, y, 80, String(gear.tweenDuration ?? 0.3), true);
                    addInspectorLine(editorHost, "desktopGearDelayLabel", "Delay", 180, y + 4, 44, "#bdbdbd");
                    delayInput = createInspectorTextInput(editorHost, "desktopGearDelay", 228, y, 72, String(gear.tweenDelay ?? 0), true);
                    y += 28;
                    addInspectorLine(editorHost, "desktopGearEaseLabel", "Ease", 8, y + 4, 78, "#bdbdbd");
                    easeInput = createTimelineComboBox(
                        editorHost,
                        "desktopGearEase",
                        88,
                        y,
                        212,
                        [...TRANSITION_EASES],
                        TRANSITION_EASES.map((_, index) => String(index)),
                        Math.max(0, Math.min(TRANSITION_EASES.length - 1, Number(gear.easeType ?? 5))),
                    );
                    y += 28;
                    if (easeInput.selectedIndex === TRANSITION_EASES.length - 1) {
                        addInspectorLine(editorHost, "desktopGearCustomEaseLabel", "Curve", 8, y + 4, 78, "#bdbdbd");
                        customEaseInput = createInspectorTextInput(
                            editorHost,
                            "desktopGearCustomEase",
                            88,
                            y,
                            212,
                            String(gear.customEasePath || ""),
                            true,
                        );
                    }
                }
            }
            commitEditor = (): void => {
                if (value) {
                    for (const field of DESKTOP_GEAR_VALUE_FIELDS[String(gear.kind)] || []) {
                        if (field.kind === "boolean") value[field.key] = Boolean(booleanInputs.get(field.key)?.selected);
                        else {
                            const text = textInputs.get(field.key)?.text ?? "";
                            value[field.key] = field.kind === "number"
                                ? Number(text)
                                : field.kind === "color" && field.key === "outlineColor" && !text.trim()
                                    ? null
                                    : text;
                        }
                    }
                }
                if (percentControl) gear.positionsInPercent = percentControl.button.selected;
                if (tweenControl) gear.tween = tweenControl.button.selected;
                if (durationInput) gear.tweenDuration = Number(durationInput.text);
                if (delayInput) gear.tweenDelay = Number(delayInput.text);
                if (easeInput) gear.easeType = Number(easeInput.value);
                if (customEaseInput) gear.customEasePath = customEaseInput.text;
            };
        }
        controllerInput.on(fgui.Events.STATE_CHANGED, options.eventOwner, () => {
            commitEditor();
            normalizeController(gear, controllerInput.value);
            renderRows();
            renderEditor();
        });
        modeInput.on(fgui.Events.STATE_CHANGED, options.eventOwner, () => {
            commitEditor();
            activeMode = modeInput.value;
            renderEditor();
        });
    };
    const renderRows = (): void => {
        gearList.removeChildrenToPool();
        for (const [index, gear] of draftGears.entries()) {
            const displayGear = gear.kind === "display" || gear.kind === "display2";
            const row = gearList.addItemFromPool("ui://Builder/GearPropsItem").asCom;
            row.name = `desktopGearRow_${gear.kind}_${index}`;
            row.data = index;
            row.alpha = selectedIndex === index ? 1 : 0.72;
            row.getChild("controller").asLabel.title = String(gear.controllerName || "");
            const image = row.getChild("image")?.asLoader;
            if (image) {
                image.fill = fgui.LoaderFillType.Scale;
                image.shrinkOnly = true;
                image.tooltips = gearLabel(gear);
            }
            row.getController("gearType").selectedPage = String(gear.kind);
            if (!displayGear) {
                row.getChild("tween").asButton.selected = Boolean(gear.tween);
                row.getChild("positionsInPercent").asButton.selected = Boolean(gear.positionsInPercent);
            }
            const deleteButton = row.getChild("delete");
            const select = (): void => {
                commitEditor();
                selectedIndex = index;
                activeMode = displayGear
                    ? findController(String(gear.controllerName || "")).pages[0].id
                    : "default";
                renderRows();
                renderEditor();
            };
            row.onClick(options.eventOwner, select);
            for (const childName of ["controller", "tween", "gearSettings", "positionsInPercent"]) {
                row.getChild(childName)?.onClick(options.eventOwner, select);
            }
            deleteButton.onClick(options.eventOwner, (event: Laya.Event) => {
                event.stopPropagation();
                commitEditor();
                draftGears.splice(index, 1);
                selectedIndex = Math.min(index, draftGears.length - 1);
                activeMode = "default";
                renderRows();
                renderEditor();
            });
        }
        gearList.resizeToFit(344);
    };

    addGear.onClick(options.eventOwner, () => {
        commitEditor();
        addMenu?.dispose();
        const menu = new fgui.PopupMenu();
        addMenu = menu;
        const usedKinds = new Set(draftGears.map((gear) => gear.kind));
        const availableKinds = DESKTOP_GEAR_KINDS.filter((kind) =>
            !usedKinds.has(kind) && displayNodeSupportsGearKind(model.nodeKind, kind),
        );
        for (const kind of availableKinds) {
            const item = menu.addItem(DESKTOP_GEAR_LABELS[kind], () => {
                const existing = model.gears.find((gear) => gear.kind === kind);
                const preparation = existing
                    ? { ok: true as const, gear: structuredClone(existing) }
                    : createTypedGearModel(project, selector, kind, model.controllers[0].name);
                if (!preparation.ok) {
                    options.setStatus(`Gear unavailable: ${preparation.code}. ${preparation.message}`);
                    return;
                }
                draftGears.push(preparation.gear);
                selectedIndex = draftGears.length - 1;
                activeMode = preparation.gear.kind === "display" || preparation.gear.kind === "display2"
                    ? findController(String(preparation.gear.controllerName || "")).pages[0].id
                    : "default";
                renderRows();
                renderEditor();
            });
            item.name = `desktopGearAdd_${kind}`;
            const shortcut = item.getChild("shortcut");
            if (shortcut) shortcut.text = "";
        }
        if (availableKinds.length === 0) {
            const item = menu.addItem("No compatible gear types", () => undefined);
            item.enabled = false;
            const shortcut = item.getChild("shortcut");
            if (shortcut) shortcut.text = "";
        }
        menu.contentPane.setSize(220, menu.contentPane.height);
        menu.show(addGear);
    });
    confirm.onClick(options.eventOwner, () => {
        commitEditor();
        const preparation = prepareUpdateDisplayNodeGears(
            options.getWorkingProject(),
            selector,
            draftGears,
        );
        if (!preparation.ok && preparation.code === "gears_unchanged") {
            closeDialog();
            options.setStatus("Gears unchanged.");
            return;
        }
        if (!preparation.ok) {
            options.setStatus(`Gear update unavailable: ${preparation.code}. ${preparation.message}`);
            return;
        }
        closeDialog();
        void options.applyPreparation(preparation).then((ok) => {
            if (!ok) return;
            options.setDebugAttribute("data-fairy-editor-gears", `${selector.displayNodeId}:${draftGears.length}`);
        });
    });
    cancel.onClick(options.eventOwner, () => {
        closeDialog();
        options.setStatus("Gear edit cancelled.");
    });
    dialog.contentPane = content;
    dialog.show();
    options.setActiveDialog(dialog);
    renderRows();
    renderEditor();
    options.setDebugAttribute("data-fairy-editor-gears-dialog", "open");
    options.setStatus(`Editing gears for ${selectedNode.name || selectedNode.id}.`);
}
