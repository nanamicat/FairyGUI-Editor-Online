import type {
    EditorCommandOperation,
    EditorDisplayNodeSelector,
    EditorGearSelector,
} from "../model/EditorCommand";
import type { HighRiskTransactionPreparation } from "./AuthoringTransactionTypes";
import {
    SUPPORTED_ATTACHABLE_NODE_KINDS,
    SUPPORTED_GEAR_KINDS,
    UamComponentLike,
    UamDisplayNodeLike,
    UamGearLike,
    findComponent,
    findDisplayNode,
    findNamedController,
    findNamedGear,
    findGearTemplate,
    createGearForController,
    createXyGear,
    readFirstPageId,
    createLookGear,
    createOpId,
    cloneJson,
    cloneModel,
    missingDisplayNode,
} from "./AuthoringTransactionSupport";

export type TypedGearModel = UamGearLike;

export interface DisplayNodeGearEditorModel {
    nodeKind: string;
    controllers: Array<{
        name: string;
        pages: Array<{ id: string; name: string }>;
    }>;
    gears: TypedGearModel[];
}

export type TypedGearModelPreparation =
    | { ok: true; gear: TypedGearModel }
    | { ok: false; code: string; message: string };

type HighRiskOperation = Exclude<EditorCommandOperation, { kind: "setDisplayNodeProps" }>;

export function prepareUpdateLookGear(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    controllerName: string,
    tween: boolean,
): HighRiskTransactionPreparation {
    const node = findDisplayNode(projectValue, selector);
    const gear = findNamedGear(node, "look", controllerName);
    if (!gear || !gear.controllerName) {
        return {
            ok: false,
            code: "look_gear_unavailable",
            message: "Choose an existing look gear controller on the selected display node.",
        };
    }

    const updated = cloneJson(gear) as UamGearLike;
    updated.tween = tween;
    const gearSelector = { ...selector, kind: "look" as const, controllerName: gear.controllerName };
    return {
        ok: true,
        transaction: {
            summary: `Set look gear ${gear.controllerName} tween to ${tween}`,
            operation: {
                opId: createOpId("update-look-gear"),
                kind: "updateLookGear",
                selector: gearSelector,
                gear: updated,
            },
            inverseOperation: {
                opId: createOpId("update-look-gear-undo"),
                kind: "updateLookGear",
                selector: gearSelector,
                gear: cloneJson(gear),
            },
        },
    };
}

export function prepareAddLookGear(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    controllerName: string,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const node = findDisplayNode(projectValue, selector);
    if (!component || !node) return missingDisplayNode(selector);
    if (!node.kind || !SUPPORTED_ATTACHABLE_NODE_KINDS.has(node.kind)) {
        return {
            ok: false,
            code: "unsupported_display_node_kind",
            message: `Look gear add is not enabled for ${node.kind || "unknown"}.`,
        };
    }

    const controller = findNamedController(component, controllerName);
    if (!controller || !controller.name || !controller.pages?.length) {
        return {
            ok: false,
            code: "look_gear_controller_unavailable",
            message: "Choose an unused controller with pages for the look gear.",
        };
    }
    if (findNamedGear(node, "look", controller.name)) {
        return { ok: false, code: "look_gear_exists", message: `Look gear ${controller.name} already exists on this display node.` };
    }

    const gear = createLookGear(controller.name, controller.pages || []);
    const gearSelector = { ...selector, kind: "look" as const, controllerName: controller.name };
    return {
        ok: true,
        transaction: {
            summary: `Add look gear ${controller.name}`,
            operation: {
                opId: createOpId("add-look-gear"),
                kind: "addLookGear",
                selector: gearSelector,
                gear,
            },
            inverseOperation: {
                opId: createOpId("remove-look-gear-undo"),
                kind: "removeLookGear",
                selector: gearSelector,
            },
        },
    };
}

export function prepareRemoveLookGear(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    controllerName: string,
): HighRiskTransactionPreparation {
    const node = findDisplayNode(projectValue, selector);
    const gear = findNamedGear(node, "look", controllerName);
    if (!gear || !gear.controllerName) {
        return {
            ok: false,
            code: "look_gear_unavailable",
            message: "Choose an existing look gear controller on the selected display node.",
        };
    }

    const gearSelector = { ...selector, kind: "look" as const, controllerName: gear.controllerName };
    return {
        ok: true,
        transaction: {
            summary: `Remove look gear ${gear.controllerName}`,
            operation: {
                opId: createOpId("remove-look-gear"),
                kind: "removeLookGear",
                selector: gearSelector,
            },
            inverseOperation: {
                opId: createOpId("add-look-gear-undo"),
                kind: "addLookGear",
                selector: gearSelector,
                gear: cloneJson(gear),
            },
        },
    };
}

export function prepareAddNonLookGear(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    controllerName: string,
    x: number,
    y: number,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const node = findDisplayNode(projectValue, selector);
    if (!component || !node) return missingDisplayNode(selector);
    const controller = findNamedController(component, controllerName);
    if (!controller || !controller.name || !controller.pages?.length) {
        return { ok: false, code: "non_look_gear_controller_unavailable", message: "Choose an unused controller with pages for the XY gear." };
    }
    if (findNamedGear(node, "xy", controller.name)) {
        return { ok: false, code: "non_look_gear_exists", message: `XY gear ${controller.name} already exists on this display node.` };
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, code: "invalid_xy_gear_value", message: "XY gear coordinates must be finite numbers." };
    }
    const gear = createXyGear(controller.name, controller.pages, node, x, y);
    const gearSelector = { ...selector, kind: "xy", controllerName: controller.name };
    return {
        ok: true,
        transaction: {
            summary: `Add XY gear ${controller.name}`,
            operation: {
                opId: createOpId("add-xy-gear"),
                kind: "addGear",
                selector: gearSelector,
                gear,
            },
            inverseOperation: {
                opId: createOpId("remove-xy-gear-undo"),
                kind: "removeGear",
                selector: gearSelector,
            },
        },
    };
}

export function prepareUpdateNonLookGear(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    controllerName: string,
    x: number,
    y: number,
): HighRiskTransactionPreparation {
    const node = findDisplayNode(projectValue, selector);
    const gear = findNamedGear(node, "xy", controllerName);
    if (!node || !gear || !gear.controllerName) {
        return { ok: false, code: "non_look_gear_unavailable", message: "Choose an existing XY gear controller on the selected display node." };
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, code: "invalid_xy_gear_value", message: "XY gear coordinates must be finite numbers." };
    }
    const updated = cloneJson(gear) as UamGearLike;
    const states = Array.isArray(updated.states) ? updated.states : [];
    if (states.length === 0 || !readFirstPageId(gear)) {
        return { ok: false, code: "non_look_gear_state_unavailable", message: "The selected XY gear has no editable first page state." };
    }
    const firstState = states[0] as { pageId?: string; value?: unknown };
    states[0] = { ...firstState, value: { x, y } };
    updated.states = states;
    const gearSelector = { ...selector, kind: "xy", controllerName: gear.controllerName };
    return {
        ok: true,
        transaction: {
            summary: `Update XY gear ${gear.controllerName}`,
            operation: {
                opId: createOpId("update-xy-gear"),
                kind: "updateGear",
                selector: gearSelector,
                gear: updated,
            },
            inverseOperation: {
                opId: createOpId("update-xy-gear-undo"),
                kind: "updateGear",
                selector: gearSelector,
                gear: cloneJson(gear),
            },
        },
    };
}

export function prepareRemoveNonLookGear(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    controllerName: string,
): HighRiskTransactionPreparation {
    const gear = findNamedGear(findDisplayNode(projectValue, selector), "xy", controllerName);
    if (!gear || !gear.controllerName) {
        return { ok: false, code: "non_look_gear_unavailable", message: "Choose an existing XY gear controller on the selected display node." };
    }
    const gearSelector = { ...selector, kind: "xy", controllerName: gear.controllerName };
    return {
        ok: true,
        transaction: {
            summary: `Remove XY gear ${gear.controllerName}`,
            operation: {
                opId: createOpId("remove-xy-gear"),
                kind: "removeGear",
                selector: gearSelector,
            },
            inverseOperation: {
                opId: createOpId("add-xy-gear-undo"),
                kind: "addGear",
                selector: gearSelector,
                gear: cloneJson(gear),
            },
        },
    };
}

export function getGearModel(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    kind: string,
    controllerName: string,
): unknown | null {
    return cloneModel(findNamedGear(findDisplayNode(projectValue, selector), kind, controllerName));
}

export function prepareAddGenericGear(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    kind: string,
    controllerName: string,
): HighRiskTransactionPreparation {
    const normalizedKind = kind.trim();
    const component = findComponent(projectValue, selector);
    const node = findDisplayNode(projectValue, selector);
    if (!component || !node) return missingDisplayNode(selector);
    if (!SUPPORTED_GEAR_KINDS.has(normalizedKind)) {
        return { ok: false, code: "unsupported_gear_kind", message: `Gear kind ${normalizedKind || "(empty)"} is not supported.` };
    }
    const controller = findNamedController(component, controllerName);
    if (!controller || !controller.name || !controller.pages?.[0]?.id) {
        return { ok: false, code: "gear_controller_unavailable", message: "Choose an unused controller with at least one page." };
    }
    if (findNamedGear(node, normalizedKind, controller.name)) {
        return { ok: false, code: "gear_exists", message: `${normalizedKind} gear for ${controller.name} already exists on this node.` };
    }
    const template = findGearTemplate(projectValue, normalizedKind);
    if (!template) {
        return { ok: false, code: "gear_template_missing", message: `No ${normalizedKind} gear template exists in this project.` };
    }
    const gear = createGearForController(template, controller);
    const gearSelector = { ...selector, kind: normalizedKind, controllerName: controller.name };
    const addKind = normalizedKind === "look" ? "addLookGear" as const : "addGear" as const;
    const removeKind = normalizedKind === "look" ? "removeLookGear" as const : "removeGear" as const;
    return {
        ok: true,
        transaction: {
            summary: `Add ${normalizedKind} gear ${controller.name}`,
            operation: { opId: createOpId("add-gear"), kind: addKind, selector: gearSelector, gear },
            inverseOperation: { opId: createOpId("remove-gear-undo"), kind: removeKind, selector: gearSelector },
        },
    };
}

export function prepareUpdateGenericGearModel(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    kind: string,
    controllerName: string,
    model: unknown,
): HighRiskTransactionPreparation {
    const normalizedKind = kind.trim();
    const node = findDisplayNode(projectValue, selector);
    const gear = findNamedGear(node, normalizedKind, controllerName);
    const updated = cloneModel(model) as UamGearLike | null;
    if (!SUPPORTED_GEAR_KINDS.has(normalizedKind)) {
        return { ok: false, code: "unsupported_gear_kind", message: `Gear kind ${normalizedKind || "(empty)"} is not supported.` };
    }
    if (!gear || !gear.controllerName) {
        return { ok: false, code: "gear_unavailable", message: "Choose an existing gear by its exact kind and controller name." };
    }
    if (!updated || updated.kind !== normalizedKind || updated.controllerName !== gear.controllerName) {
        return { ok: false, code: "invalid_gear_model", message: "Gear JSON must preserve its exact kind and controllerName." };
    }
    const gearSelector = { ...selector, kind: normalizedKind, controllerName: gear.controllerName };
    const updateKind = normalizedKind === "look" ? "updateLookGear" as const : "updateGear" as const;
    return {
        ok: true,
        transaction: {
            summary: `Update ${normalizedKind} gear ${gear.controllerName}`,
            operation: { opId: createOpId("update-gear"), kind: updateKind, selector: gearSelector, gear: updated },
            inverseOperation: { opId: createOpId("update-gear-undo"), kind: updateKind, selector: gearSelector, gear: cloneJson(gear) },
        },
    };
}

export function prepareRemoveGenericGear(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    kind: string,
    controllerName: string,
): HighRiskTransactionPreparation {
    const normalizedKind = kind.trim();
    const gear = findNamedGear(findDisplayNode(projectValue, selector), normalizedKind, controllerName);
    if (!SUPPORTED_GEAR_KINDS.has(normalizedKind)) {
        return { ok: false, code: "unsupported_gear_kind", message: `Gear kind ${normalizedKind || "(empty)"} is not supported.` };
    }
    if (!gear || !gear.controllerName) {
        return { ok: false, code: "gear_unavailable", message: "Choose an existing gear by its exact kind and controller name." };
    }
    const gearSelector = { ...selector, kind: normalizedKind, controllerName: gear.controllerName };
    const removeKind = normalizedKind === "look" ? "removeLookGear" as const : "removeGear" as const;
    const addKind = normalizedKind === "look" ? "addLookGear" as const : "addGear" as const;
    return {
        ok: true,
        transaction: {
            summary: `Remove ${normalizedKind} gear ${gear.controllerName}`,
            operation: { opId: createOpId("remove-gear"), kind: removeKind, selector: gearSelector },
            inverseOperation: { opId: createOpId("add-gear-undo"), kind: addKind, selector: gearSelector, gear: cloneJson(gear) },
        },
    };
}

export function displayNodeSupportsGearKind(nodeKind: string, kind: string): boolean {
    if (!SUPPORTED_GEAR_KINDS.has(kind)) return false;
    if (kind === "look") return nodeKind !== "group";
    if (kind === "color") return nodeKind !== "group" && nodeKind !== "component";
    if (kind === "animation") return nodeKind === "movieClip" || nodeKind === "loader" || nodeKind === "loader3D";
    if (kind === "fontSize") {
        return nodeKind === "text"
            || nodeKind === "richText"
            || nodeKind === "textInput"
            || nodeKind === "button"
            || nodeKind === "label";
    }
    return true;
}

export function getDisplayNodeGearEditorModel(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
): DisplayNodeGearEditorModel | null {
    const component = findComponent(projectValue, selector);
    const node = findDisplayNode(projectValue, selector);
    if (!component || !node) return null;
    return {
        nodeKind: String(node.kind || ""),
        controllers: (component.controllers || []).flatMap((controller) => {
            if (!controller.name) return [];
            const pages = (controller.pages || []).flatMap((page) => page.id
                ? [{ id: String(page.id), name: String(page.name || "") }]
                : []);
            return pages.length > 0 ? [{ name: controller.name, pages }] : [];
        }),
        gears: cloneJson(node.gears || []),
    };
}

export function createTypedGearModel(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    kind: string,
    controllerName: string,
): TypedGearModelPreparation {
    const component = findComponent(projectValue, selector);
    const node = findDisplayNode(projectValue, selector);
    if (!component || !node) return missingDisplayNode(selector);
    const normalizedKind = kind.trim();
    if (!displayNodeSupportsGearKind(String(node.kind || ""), normalizedKind)) {
        return {
            ok: false,
            code: "unsupported_gear_kind",
            message: `${normalizedKind || "(empty)"} gear is not supported by ${node.kind || "unknown"} nodes.`,
        };
    }
    if ((node.gears || []).some((gear) => gear.kind === normalizedKind)) {
        return { ok: false, code: "gear_kind_exists", message: `${normalizedKind} gear already exists on this node.` };
    }
    const controller = findNamedController(component, controllerName);
    const pageId = controller?.pages?.[0]?.id;
    if (!controller?.name || !pageId) {
        return { ok: false, code: "gear_controller_unavailable", message: "Choose a controller with at least one page." };
    }
    if (normalizedKind === "display" || normalizedKind === "display2") {
        return {
            ok: true,
            gear: {
                kind: normalizedKind,
                name: "",
                controllerName: controller.name,
                visibleOnPageIds: [pageId],
                ...(normalizedKind === "display2" ? { condition: "0" } : {}),
            },
        };
    }

    const defaultValue = createTypedGearDefaultValue(normalizedKind, node);
    if (!defaultValue) {
        return { ok: false, code: "unsupported_gear_kind", message: `No typed value editor exists for ${normalizedKind}.` };
    }
    return {
        ok: true,
        gear: {
            kind: normalizedKind,
            name: "",
            controllerName: controller.name,
            states: [{ pageId, value: cloneJson(defaultValue) }],
            defaultValue,
            condition: "",
            positionsInPercent: false,
            tween: false,
            tweenDuration: 0.3,
            tweenDelay: 0,
            easeType: 5,
            customEasePath: "",
        },
    };
}

export function prepareUpdateDisplayNodeGears(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    models: unknown,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const node = findDisplayNode(projectValue, selector);
    if (!component || !node) return missingDisplayNode(selector);
    if (!Array.isArray(models)) {
        return { ok: false, code: "invalid_gear_models", message: "Gear editor must submit an array." };
    }
    const gears = cloneModel(models) as UamGearLike[] | null;
    if (!gears) {
        return { ok: false, code: "invalid_gear_models", message: "Gear models must be structured data." };
    }
    const identities = new Set<string>();
    for (const gear of gears) {
        const validation = validateTypedGearModel(component, node, gear);
        if (validation) return validation;
        const identity = gearIdentity(gear);
        if (identities.has(identity)) {
            return { ok: false, code: "duplicate_gear", message: `Duplicate ${gear.kind} gear for ${gear.controllerName}.` };
        }
        identities.add(identity);
    }

    const previous = cloneJson(node.gears || []);
    const previousByIdentity = new Map(previous.map((gear) => [gearIdentity(gear), gear]));
    const nextByIdentity = new Map(gears.map((gear) => [gearIdentity(gear), gear]));
    const operations: HighRiskOperation[] = [];
    const inverseOperations: HighRiskOperation[] = [];
    const append = (operation: HighRiskOperation, inverse: HighRiskOperation): void => {
        operations.push(operation);
        inverseOperations.unshift(inverse);
    };

    for (const gear of previous) {
        const identity = gearIdentity(gear);
        const next = nextByIdentity.get(identity);
        const gearSelector = createTypedGearSelector(selector, gear);
        if (!next) {
            append(
                createTypedGearOperation("remove", gearSelector),
                createTypedGearOperation("add", gearSelector, gear),
            );
        } else if (JSON.stringify(next) !== JSON.stringify(gear)) {
            append(
                createTypedGearOperation("update", gearSelector, next),
                createTypedGearOperation("update", gearSelector, gear),
            );
        }
    }
    for (const gear of gears) {
        if (previousByIdentity.has(gearIdentity(gear))) continue;
        const gearSelector = createTypedGearSelector(selector, gear);
        append(
            createTypedGearOperation("add", gearSelector, gear),
            createTypedGearOperation("remove", gearSelector),
        );
    }
    if (operations.length === 0) {
        return { ok: false, code: "gears_unchanged", message: "Gear models did not change." };
    }
    return {
        ok: true,
        transaction: {
            summary: `Update ${selector.displayNodeId} gears`,
            operation: operations[0],
            inverseOperation: inverseOperations[0],
            operations,
            inverseOperations,
        },
    };
}

function createTypedGearDefaultValue(kind: string, node: UamDisplayNodeLike): Record<string, unknown> | null {
    switch (kind) {
        case "look":
            return {
                alpha: finiteOr(node.alpha, 1),
                rotation: finiteOr(node.rotation, 0),
                grayed: Boolean(node.grayed),
                touchable: node.touchable !== false,
            };
        case "xy":
            return { x: finiteOr(node.position?.x, 0), y: finiteOr(node.position?.y, 0) };
        case "size":
            return {
                width: finiteOr(node.size?.width, 0),
                height: finiteOr(node.size?.height, 0),
                scaleX: finiteOr(node.scale?.x, 1),
                scaleY: finiteOr(node.scale?.y, 1),
            };
        case "color":
            return { color: node.color || "#ffffff", outlineColor: node.outlineColor || null };
        case "animation":
            return {
                frame: Math.max(0, Math.trunc(finiteOr(node.frame, 0))),
                playing: node.playing !== false,
                animationName: String(node.animationName || ""),
                skinName: String(node.skinName || ""),
            };
        case "text":
            return { text: String(node.text || "") };
        case "icon":
            return { icon: String(node.icon || "") };
        case "fontSize":
            return { fontSize: Math.max(1, finiteOr(node.fontSize, 12)) };
        default:
            return null;
    }
}

function validateTypedGearModel(
    component: UamComponentLike,
    node: UamDisplayNodeLike,
    gear: UamGearLike,
): { ok: false; code: string; message: string } | null {
    if (!gear || typeof gear !== "object" || Array.isArray(gear)) {
        return { ok: false, code: "invalid_gear_model", message: "Each gear must be an object." };
    }
    const kind = typeof gear.kind === "string" ? gear.kind : "";
    const controllerName = typeof gear.controllerName === "string" ? gear.controllerName : "";
    if (!displayNodeSupportsGearKind(String(node.kind || ""), kind)) {
        return { ok: false, code: "unsupported_gear_kind", message: `${kind || "(empty)"} gear is not supported by ${node.kind || "unknown"} nodes.` };
    }
    const controller = findNamedController(component, controllerName);
    if (!controller?.name || controllerName !== controller.name || !controller.pages?.length) {
        return { ok: false, code: "gear_controller_unavailable", message: `Controller ${controllerName || "(empty)"} is unavailable.` };
    }
    if (typeof gear.name !== "string") {
        return { ok: false, code: "invalid_gear_name", message: "Gear name must be a string." };
    }
    const pageIds = new Set((controller.pages || []).flatMap((page) => page.id ? [page.id] : []));
    if (kind === "display" || kind === "display2") {
        if (!Array.isArray(gear.visibleOnPageIds)) {
            return { ok: false, code: "invalid_gear_pages", message: `${kind} gear pages must be an array.` };
        }
        const seen = new Set<string>();
        for (const pageId of gear.visibleOnPageIds) {
            if (typeof pageId !== "string" || !pageIds.has(pageId) || seen.has(pageId)) {
                return { ok: false, code: "invalid_gear_pages", message: `${kind} gear contains an unknown or duplicate page.` };
            }
            seen.add(pageId);
        }
        if (kind === "display2" && gear.condition !== "0" && gear.condition !== "1") {
            return { ok: false, code: "invalid_display2_condition", message: "Display2 condition must be AND (0) or OR (1)." };
        }
        return null;
    }
    if (!Array.isArray(gear.states) || !isRecord(gear.defaultValue)) {
        return { ok: false, code: "invalid_gear_states", message: `${kind} gear requires page states and a default value.` };
    }
    const seen = new Set<string>();
    for (const state of gear.states) {
        if (!isRecord(state) || typeof state.pageId !== "string" || !pageIds.has(state.pageId) || seen.has(state.pageId)) {
            return { ok: false, code: "invalid_gear_states", message: `${kind} gear contains an unknown or duplicate page state.` };
        }
        seen.add(state.pageId);
        if (state.value !== null && validateTypedGearValue(kind, state.value)) {
            return { ok: false, code: "invalid_gear_value", message: `${kind} gear contains an invalid page value.` };
        }
    }
    if (validateTypedGearValue(kind, gear.defaultValue)) {
        return { ok: false, code: "invalid_gear_value", message: `${kind} gear contains an invalid default value.` };
    }
    const easeType = gear.easeType;
    if (
        typeof gear.condition !== "string"
        || typeof gear.positionsInPercent !== "boolean"
        || typeof gear.tween !== "boolean"
        || !isFiniteNumber(gear.tweenDuration) || gear.tweenDuration < 0
        || !isFiniteNumber(gear.tweenDelay) || gear.tweenDelay < 0
        || typeof easeType !== "number" || !Number.isInteger(easeType) || easeType < 0 || easeType > 31
        || typeof gear.customEasePath !== "string"
    ) {
        return { ok: false, code: "invalid_gear_settings", message: `${kind} gear has invalid tween or position settings.` };
    }
    return null;
}

function validateTypedGearValue(kind: string, value: unknown): boolean {
    if (!isRecord(value)) return true;
    switch (kind) {
        case "look":
            return !isFiniteNumber(value.alpha) || value.alpha < 0 || value.alpha > 1
                || !isFiniteNumber(value.rotation)
                || typeof value.grayed !== "boolean"
                || typeof value.touchable !== "boolean";
        case "xy":
            return !isFiniteNumber(value.x) || !isFiniteNumber(value.y);
        case "size":
            return !isFiniteNumber(value.width) || value.width < 0
                || !isFiniteNumber(value.height) || value.height < 0
                || !isFiniteNumber(value.scaleX) || !isFiniteNumber(value.scaleY);
        case "color":
            return !isColor(value.color)
                || value.outlineColor !== null && !isColor(value.outlineColor);
        case "animation": {
            const frame = value.frame;
            return typeof frame !== "number" || !Number.isInteger(frame) || frame < 0
                || typeof value.playing !== "boolean"
                || typeof value.animationName !== "string"
                || typeof value.skinName !== "string";
        }
        case "text":
            return typeof value.text !== "string";
        case "icon":
            return typeof value.icon !== "string";
        case "fontSize":
            return !isFiniteNumber(value.fontSize) || value.fontSize <= 0;
        default:
            return true;
    }
}

function createTypedGearSelector(
    selector: EditorDisplayNodeSelector,
    gear: UamGearLike,
): EditorGearSelector {
    return {
        ...selector,
        kind: String(gear.kind || ""),
        controllerName: String(gear.controllerName || ""),
    };
}

function createTypedGearOperation(
    action: "add" | "update" | "remove",
    selector: EditorGearSelector,
    gear?: UamGearLike,
): HighRiskOperation {
    const look = selector.kind === "look";
    if (action === "remove") {
        return {
            opId: createOpId("typed-gear-remove"),
            kind: look ? "removeLookGear" : "removeGear",
            selector,
        };
    }
    return {
        opId: createOpId(`typed-gear-${action}`),
        kind: look
            ? action === "add" ? "addLookGear" : "updateLookGear"
            : action === "add" ? "addGear" : "updateGear",
        selector,
        gear: cloneJson(gear),
    };
}

function gearIdentity(gear: UamGearLike): string {
    return `${gear.kind || ""}\u0000${gear.controllerName || ""}`;
}

function finiteOr(value: unknown, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isColor(value: unknown): value is string {
    return typeof value === "string" && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value);
}
