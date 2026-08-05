import type {
    EditorComponentSelector,
} from "../model/EditorCommand";
import { isValidCustomEasePath, parseTimelinePathData } from "../model/TimelinePathData";
import type { HighRiskTransactionPreparation } from "./AuthoringTransactionTypes";
import {
    UamComponentLike,
    UamControllerLike,
    UamTransitionLike,
    UamTransitionItemLike,
    getHighRiskWorkingProject,
    findComponent,
    readComponentReference,
    findNamedTransition,
    createCopyName,
    createOpId,
    cloneJson,
    cloneModel,
} from "./AuthoringTransactionSupport";

export type TransitionItemModel = UamTransitionItemLike;

export const TRANSITION_ACTIONS = [
    "XY", "Size", "Scale", "Pivot", "Alpha", "Rotation", "Color", "Animation",
    "Visible", "Sound", "Transition", "Shake", "ColorFilter", "Skew", "Text", "Icon",
] as const;

export const TRANSITION_EASES = [
    "Linear", "Sine In", "Sine Out", "Sine In Out", "Quad In", "Quad Out", "Quad In Out",
    "Cubic In", "Cubic Out", "Cubic In Out", "Quart In", "Quart Out", "Quart In Out",
    "Quint In", "Quint Out", "Quint In Out", "Expo In", "Expo Out", "Expo In Out",
    "Circ In", "Circ Out", "Circ In Out", "Elastic In", "Elastic Out", "Elastic In Out",
    "Back In", "Back Out", "Back In Out", "Bounce In", "Bounce Out", "Bounce In Out", "Custom",
] as const;

export function transitionActionSupportsTween(actionType: number): boolean {
    return actionType >= 0 && actionType <= 6 || actionType === 12 || actionType === 13;
}

function defaultTransitionValue(actionType: number): string[] {
    if (actionType === 0 || actionType === 1 || actionType === 3 || actionType === 13) return ["0", "0"];
    if (actionType === 2) return ["1", "1"];
    if (actionType === 4) return ["1"];
    if (actionType === 5) return ["0"];
    if (actionType === 6) return ["#FFFFFF"];
    if (actionType === 7) return ["0", "p"];
    if (actionType === 8) return ["true"];
    if (actionType === 9) return ["", "100"];
    if (actionType === 10) return ["", "1"];
    if (actionType === 11) return ["10", "0.3"];
    if (actionType === 12) return ["0", "0", "0", "0"];
    return [""];
}

export function createTransitionItemModel(
    actionType: number,
    targetNodeId: string,
    time: number = 0,
): TransitionItemModel {
    const tween = transitionActionSupportsTween(actionType);
    const value = defaultTransitionValue(actionType);
    return {
        name: "",
        time: Math.max(0, Math.round(time)),
        actionType,
        targetNodeId,
        tween,
        duration: tween ? 24 : 0,
        startValue: value,
        endValue: tween ? [...value] : [],
        easeType: 5,
        repeat: 0,
        yoyo: false,
        label: "",
        endLabel: "",
        path: "",
        customEasePath: "",
    };
}

export function getTransitionModel(
    projectValue: unknown,
    selector: EditorComponentSelector,
    transitionName: string,
): unknown | null {
    return cloneModel(findNamedTransition(findComponent(projectValue, selector), transitionName));
}

export function getTransitionItemModel(
    projectValue: unknown,
    selector: EditorComponentSelector,
    transitionName: string,
    itemIndex: number,
): unknown | null {
    const transition = findNamedTransition(findComponent(projectValue, selector), transitionName);
    return cloneModel(transition?.items?.[itemIndex]);
}

export function prepareUpdateTransitionModel(
    projectValue: unknown,
    selector: EditorComponentSelector,
    transitionName: string,
    model: unknown,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const transition = findNamedTransition(component, transitionName);
    const updated = cloneModel(model) as UamTransitionLike | null;
    if (!component || !transition || !transition.name) {
        return { ok: false, code: "transition_unavailable", message: "Choose an existing transition by its exact name." };
    }
    if (!updated || updated.name !== transition.name || !Array.isArray(updated.items)) {
        return { ok: false, code: "invalid_transition_model", message: "Transition JSON must preserve its exact name and items array." };
    }
    const nodeIds = new Set((component.displayList || []).map((node) => node.id));
    const missingTargetIds = [...new Set(updated.items
        .map((item) => String(item?.targetNodeId || ""))
        .filter((nodeId) => nodeId && !nodeIds.has(nodeId)))];
    if (missingTargetIds.length > 0) {
        return {
            ok: false,
            code: "transition_dangling_target",
            message: `Transition references missing display node ${missingTargetIds.join(", ")} and cannot be edited.`,
        };
    }
    const transitionSelector = { ...selector, transitionName: transition.name };
    return {
        ok: true,
        transaction: {
            summary: `Update transition model ${transition.name}`,
            operation: { opId: createOpId("update-transition"), kind: "updateTransition", selector: transitionSelector, transition: updated },
            inverseOperation: { opId: createOpId("update-transition-undo"), kind: "updateTransition", selector: transitionSelector, transition: cloneJson(transition) },
        },
    };
}

export function prepareUpdateTransition(
    projectValue: unknown,
    selector: EditorComponentSelector,
    transitionName: string,
    autoPlay: boolean,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const transition = findNamedTransition(component, transitionName);
    if (!transition || !transition.name) {
        return {
            ok: false,
            code: "transition_unavailable",
            message: "Choose a transition on the selected component.",
        };
    }

    const updated = cloneJson(transition) as UamTransitionLike;
    updated.autoPlay = autoPlay;
    return prepareUpdateTransitionModel(projectValue, selector, transition.name, updated);
}

export function prepareUpdateTransitionItemTiming(
    projectValue: unknown,
    selector: EditorComponentSelector,
    transitionName: string,
    itemIndex: number,
    timing: { time: number; duration: number; tween: boolean },
): HighRiskTransactionPreparation {
    const transition = getTransitionModel(
        projectValue,
        selector,
        transitionName,
    ) as UamTransitionLike | null;
    const item = transition?.items?.[itemIndex];
    if (!transition || !item) {
        return {
            ok: false,
            code: "transition_item_unavailable",
            message: "Choose an existing transition timeline item.",
        };
    }
    if (
        !Number.isInteger(timing.time)
        || timing.time < 0
        || !Number.isInteger(timing.duration)
        || timing.duration < 0
    ) {
        return {
            ok: false,
            code: "invalid_transition_item_timing",
            message: "Transition item time and duration must be non-negative integers.",
        };
    }
    if (
        Number(item.time || 0) === timing.time
        && Number(item.duration || 0) === timing.duration
        && Boolean(item.tween) === timing.tween
    ) {
        return {
            ok: false,
            code: "transition_item_timing_unchanged",
            message: "Transition item timing is unchanged.",
        };
    }

    item.time = timing.time;
    item.duration = timing.duration;
    item.tween = timing.tween;
    return prepareUpdateTransitionModel(
        projectValue,
        selector,
        transitionName,
        transition,
    );
}

export function prepareDuplicateTransitionItem(
    projectValue: unknown,
    selector: EditorComponentSelector,
    transitionName: string,
    itemIndex: number,
): HighRiskTransactionPreparation {
    const transition = getTransitionModel(projectValue, selector, transitionName) as UamTransitionLike | null;
    const item = transition?.items?.[itemIndex];
    if (!transition || !item || !transition.items) {
        return { ok: false, code: "transition_item_unavailable", message: "Choose an existing transition timeline item." };
    }
    const copy = cloneJson(item) as UamTransitionItemLike;
    copy.time = Math.max(0, Math.round(Number(item.time || 0)))
        + Math.max(1, item.tween ? Math.round(Number(item.duration || 0)) : 1);
    transition.items.splice(itemIndex + 1, 0, copy);
    const prepared = prepareUpdateTransitionModel(projectValue, selector, transitionName, transition);
    if (prepared.ok) prepared.transaction.summary = `Duplicate transition item ${transitionName} #${itemIndex}`;
    return prepared;
}

export function prepareAddTransitionItemModel(
    projectValue: unknown,
    selector: EditorComponentSelector,
    transitionName: string,
    model: unknown,
): HighRiskTransactionPreparation {
    const transition = getTransitionModel(projectValue, selector, transitionName) as UamTransitionLike | null;
    const item = cloneModel(model) as UamTransitionItemLike | null;
    if (!transition?.items) {
        return { ok: false, code: "transition_unavailable", message: "Choose an existing transition." };
    }
    const validation = validateTransitionItemModel(item);
    if (validation) return validation;
    transition.items.push(item!);
    const prepared = prepareUpdateTransitionModel(projectValue, selector, transitionName, transition);
    if (prepared.ok) prepared.transaction.summary = `Add transition item ${transitionName} #${transition.items.length - 1}`;
    return prepared;
}

export function prepareRemoveTransitionItem(
    projectValue: unknown,
    selector: EditorComponentSelector,
    transitionName: string,
    itemIndex: number,
): HighRiskTransactionPreparation {
    const transition = getTransitionModel(projectValue, selector, transitionName) as UamTransitionLike | null;
    if (!transition?.items?.[itemIndex]) {
        return { ok: false, code: "transition_item_unavailable", message: "Choose an existing transition timeline item." };
    }
    transition.items.splice(itemIndex, 1);
    const prepared = prepareUpdateTransitionModel(projectValue, selector, transitionName, transition);
    if (prepared.ok) prepared.transaction.summary = `Remove transition item ${transitionName} #${itemIndex}`;
    return prepared;
}

export function prepareUpdateTransitionItemModel(
    projectValue: unknown,
    selector: EditorComponentSelector,
    transitionName: string,
    itemIndex: number,
    model: unknown,
): HighRiskTransactionPreparation {
    const transition = getTransitionModel(projectValue, selector, transitionName) as UamTransitionLike | null;
    const item = cloneModel(model) as UamTransitionItemLike | null;
    if (!transition?.items?.[itemIndex]) {
        return { ok: false, code: "transition_item_unavailable", message: "Choose an existing transition timeline item." };
    }
    const validation = validateTransitionItemModel(item);
    if (validation) return validation;
    transition.items[itemIndex] = item!;
    const prepared = prepareUpdateTransitionModel(projectValue, selector, transitionName, transition);
    if (prepared.ok) prepared.transaction.summary = `Edit transition item ${transitionName} #${itemIndex}`;
    return prepared;
}

function validateTransitionItemModel(
    item: UamTransitionItemLike | null,
): HighRiskTransactionPreparation | null {
    if (
        !item
        || !Number.isInteger(item.actionType)
        || Number(item.actionType) < 0
        || Number(item.actionType) >= TRANSITION_ACTIONS.length
        || !Number.isInteger(item.time)
        || Number(item.time) < 0
        || !Number.isInteger(item.duration)
        || Number(item.duration) < 0
        || typeof item.targetNodeId !== "string"
        || typeof item.tween !== "boolean"
        || !Array.isArray(item.startValue)
        || !Array.isArray(item.endValue)
        || !Number.isInteger(item.easeType)
        || Number(item.easeType) < 0
        || Number(item.easeType) >= TRANSITION_EASES.length
        || !Number.isInteger(item.repeat)
        || Number(item.repeat) < -1
        || typeof item.yoyo !== "boolean"
        || typeof item.label !== "string"
        || typeof item.endLabel !== "string"
        || typeof item.path !== "string"
        || typeof item.customEasePath !== "string"
        || !isValidTransitionPathFields(item)
        || Boolean(item.tween) && !transitionActionSupportsTween(Number(item.actionType))
        || !isTransitionActionValue(Number(item.actionType), item.startValue)
        || (Boolean(item.tween)
            ? !isTransitionActionValue(Number(item.actionType), item.endValue)
            : item.endValue.length !== 0)
    ) {
        return {
            ok: false,
            code: "invalid_transition_item_model",
            message: "Transition item must preserve a supported action, target, timing, values, ease, repeat, labels, and path fields.",
        };
    }
    return null;
}

function isValidTransitionPathFields(item: UamTransitionItemLike): boolean {
    const pathValue = item.path || "";
    const customEasePath = item.customEasePath || "";
    if (pathValue) {
        const path = parseTimelinePathData(pathValue);
        if (!item.tween || item.actionType !== 0 || !path || path.length < 2) return false;
    }
    if (item.easeType === 31) {
        const customEase = parseTimelinePathData(customEasePath);
        return Boolean(item.tween && customEase && isValidCustomEasePath(customEase));
    }
    return customEasePath === "";
}

function isTransitionActionValue(actionType: number, values: unknown[]): boolean {
    if (!values.every((value) => typeof value === "string")) return false;
    const parts = values as string[];
    const numeric = (value: string): boolean => value.trim() !== "" && Number.isFinite(Number(value));
    const optionalNumeric = (value: string): boolean => value === "-" || numeric(value);
    if (actionType === 0) return (parts.length === 2 || parts.length === 4) && parts.every(optionalNumeric);
    if (actionType === 1 || actionType === 3 || actionType === 13) {
        return parts.length === 2 && parts.every(optionalNumeric);
    }
    if (actionType === 2 || actionType === 11) return parts.length === 2 && parts.every(numeric);
    if (actionType === 4 || actionType === 5) return parts.length === 1 && numeric(parts[0]);
    if (actionType === 6) return parts.length === 1 && /^#[0-9A-Fa-f]{6}$/.test(parts[0]);
    if (actionType === 7) {
        return (parts.length === 2 || parts.length === 4)
            && (parts[0] === "-" || Number.isInteger(Number(parts[0])))
            && (parts[1] === "p" || parts[1] === "s");
    }
    if (actionType === 8) return parts.length === 1 && (parts[0] === "true" || parts[0] === "false");
    if (actionType === 9) {
        const volume = Number(parts[1] ?? 100);
        return (parts.length === 1 || parts.length === 2)
            && parts[0].startsWith("ui://")
            && Number.isInteger(volume)
            && volume >= 0
            && volume <= 100;
    }
    if (actionType === 10) {
        return (parts.length === 1 || parts.length === 2)
            && (parts.length === 1 || Number.isInteger(Number(parts[1])));
    }
    if (actionType === 12) return parts.length === 4 && parts.every(numeric);
    return (actionType === 14 || actionType === 15) && parts.length === 1;
}

export function prepareAddTransition(
    projectValue: unknown,
    selector: EditorComponentSelector,
    sourceTransitionName: string,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const transition = findNamedTransition(component, sourceTransitionName);
    if (!transition || !transition.name) {
        return {
            ok: false,
            code: "transition_unavailable",
            message: "Choose a transition on the selected component to duplicate.",
        };
    }

    const added = cloneJson(transition) as UamTransitionLike;
    added.name = createCopyName(component?.transitions || [], transition.name);
    const transitionSelector = { ...selector, transitionName: added.name };
    return {
        ok: true,
        transaction: {
            summary: `Duplicate transition ${transition.name} as ${added.name}`,
            operation: {
                opId: createOpId("add-transition"),
                kind: "addTransition",
                selector: transitionSelector,
                transition: added,
            },
            inverseOperation: {
                opId: createOpId("remove-transition-undo"),
                kind: "removeTransition",
                selector: transitionSelector,
            },
        },
    };
}

export function prepareCreateTransition(
    projectValue: unknown,
    selector: EditorComponentSelector,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    if (!component) {
        return {
            ok: false,
            code: "component_unavailable",
            message: "Choose a component before creating a transition.",
        };
    }
    const names = new Set((component.transitions || []).map((transition) => transition.name));
    let index = 0;
    while (names.has(`t${index}`)) index += 1;
    const transition = { name: `t${index}`, autoPlay: false, items: [] };
    const transitionSelector = { ...selector, transitionName: transition.name };
    return {
        ok: true,
        transaction: {
            summary: `Create transition ${transition.name}`,
            operation: {
                opId: createOpId("create-transition"),
                kind: "addTransition",
                selector: transitionSelector,
                transition,
            },
            inverseOperation: {
                opId: createOpId("create-transition-undo"),
                kind: "removeTransition",
                selector: transitionSelector,
            },
        },
    };
}

export function prepareRenameTransition(
    projectValue: unknown,
    selector: EditorComponentSelector,
    transitionName: string,
    newName: string,
): HighRiskTransactionPreparation {
    const project = getHighRiskWorkingProject(projectValue);
    const component = findComponent(projectValue, selector);
    const transition = findNamedTransition(component, transitionName);
    const normalizedName = newName.trim();
    if (!project || !component || !transition?.name) {
        return {
            ok: false,
            code: "transition_unavailable",
            message: "Choose an existing transition to rename.",
        };
    }
    if (!normalizedName) {
        return { ok: false, code: "invalid_transition_name", message: "Transition name cannot be empty." };
    }
    if (normalizedName === transition.name) {
        return { ok: false, code: "transition_name_unchanged", message: "Transition name is unchanged." };
    }
    if ((component.transitions || []).some((item) => item.name === normalizedName)) {
        return { ok: false, code: "transition_name_conflict", message: `Transition ${normalizedName} already exists.` };
    }

    let referenceError = "";
    const rewriteTransitionReferences = (
        model: UamTransitionLike,
        ownerPackageId: string,
        ownerComponentResourceId: string,
        ownerComponent: UamComponentLike,
    ): boolean => {
        let changed = false;
        for (const item of model.items || []) {
            if (Number(item.actionType) !== 10 || item.startValue?.[0] !== transition.name) continue;
            const targetNodeId = String(item.targetNodeId || "");
            let targetMatches = ownerPackageId === selector.packageId
                && ownerComponentResourceId === selector.componentResourceId;
            if (targetNodeId) {
                const targetNode = (ownerComponent.displayList || []).find((node) => node.id === targetNodeId);
                const reference = targetNode ? readComponentReference(targetNode, ownerPackageId) : null;
                if (!reference) {
                    referenceError = `Transition action target ${targetNodeId} cannot be resolved safely.`;
                    return false;
                }
                targetMatches = reference.packageId === selector.packageId
                    && reference.componentResourceId === selector.componentResourceId;
            }
            if (!targetMatches) continue;
            item.startValue = [...(item.startValue || [])];
            item.startValue[0] = normalizedName;
            changed = true;
        }
        return changed;
    };

    const renamed = cloneJson(transition) as UamTransitionLike;
    renamed.name = normalizedName;
    rewriteTransitionReferences(
        renamed,
        selector.packageId,
        selector.componentResourceId,
        component,
    );
    if (referenceError) {
        return { ok: false, code: "transition_reference_unavailable", message: referenceError };
    }

    const forwardUpdates = [];
    const inverseUpdates = [];
    for (const controller of component.controllers || []) {
        const updated = cloneJson(controller) as UamControllerLike;
        let changed = false;
        for (const action of updated.actions || []) {
            if (Number(action.actionType) === 0 && action.transitionName === transition.name) {
                action.transitionName = normalizedName;
                changed = true;
            }
        }
        if (!changed) continue;
        if (!controller.name) {
            return {
                ok: false,
                code: "transition_reference_unavailable",
                message: "A controller transition reference has no stable controller name.",
            };
        }
        const controllerSelector = { ...selector, controllerName: controller.name };
        forwardUpdates.push({
            opId: createOpId("rename-transition-controller-reference"),
            kind: "updateController" as const,
            selector: controllerSelector,
            controller: updated,
        });
        inverseUpdates.push({
            opId: createOpId("rename-transition-controller-reference-undo"),
            kind: "updateController" as const,
            selector: controllerSelector,
            controller: cloneJson(controller),
        });
    }

    for (const pkg of project.packages || []) {
        if (!pkg.id) continue;
        for (const resource of pkg.resources || []) {
            const ownerComponent = resource.component;
            if (resource.kind !== "component" || !resource.id || !ownerComponent) continue;
            for (const ownerTransition of ownerComponent.transitions || []) {
                if (
                    pkg.id === selector.packageId
                    && resource.id === selector.componentResourceId
                    && ownerTransition.name === transition.name
                ) {
                    continue;
                }
                const updated = cloneJson(ownerTransition) as UamTransitionLike;
                if (!rewriteTransitionReferences(updated, pkg.id, resource.id, ownerComponent)) {
                    if (referenceError) {
                        return { ok: false, code: "transition_reference_unavailable", message: referenceError };
                    }
                    continue;
                }
                if (!ownerTransition.name) {
                    return {
                        ok: false,
                        code: "transition_reference_unavailable",
                        message: "A transition reference has no stable owner transition name.",
                    };
                }
                const transitionSelector = {
                    packageId: pkg.id,
                    componentResourceId: resource.id,
                    transitionName: ownerTransition.name,
                };
                forwardUpdates.push({
                    opId: createOpId("rename-transition-reference"),
                    kind: "updateTransition" as const,
                    selector: transitionSelector,
                    transition: updated,
                });
                inverseUpdates.push({
                    opId: createOpId("rename-transition-reference-undo"),
                    kind: "updateTransition" as const,
                    selector: transitionSelector,
                    transition: cloneJson(ownerTransition),
                });
            }
        }
    }

    const newSelector = { ...selector, transitionName: normalizedName };
    const oldSelector = { ...selector, transitionName: transition.name };
    const addRenamed = {
        opId: createOpId("rename-transition-add"),
        kind: "addTransition" as const,
        selector: newSelector,
        transition: renamed,
    };
    const removeRenamed = {
        opId: createOpId("rename-transition-remove-undo"),
        kind: "removeTransition" as const,
        selector: newSelector,
    };
    return {
        ok: true,
        transaction: {
            summary: `Rename transition ${transition.name} to ${normalizedName}`
                + `${forwardUpdates.length ? ` and retarget ${forwardUpdates.length} reference model(s)` : ""}`,
            operation: addRenamed,
            inverseOperation: removeRenamed,
            operations: [
                addRenamed,
                ...forwardUpdates,
                {
                    opId: createOpId("rename-transition-remove"),
                    kind: "removeTransition",
                    selector: oldSelector,
                },
            ],
            inverseOperations: [
                {
                    opId: createOpId("rename-transition-add-undo"),
                    kind: "addTransition",
                    selector: oldSelector,
                    transition: cloneJson(transition),
                },
                ...inverseUpdates,
                removeRenamed,
            ],
        },
    };
}

export function prepareRemoveTransition(
    projectValue: unknown,
    selector: EditorComponentSelector,
    transitionName: string,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const transition = findNamedTransition(component, transitionName);
    if (!transition || !transition.name) {
        return {
            ok: false,
            code: "transition_unavailable",
            message: "Choose a transition on the selected component to remove.",
        };
    }

    const transitionSelector = { ...selector, transitionName: transition.name };
    return {
        ok: true,
        transaction: {
            summary: `Remove transition ${transition.name}`,
            operation: {
                opId: createOpId("remove-transition"),
                kind: "removeTransition",
                selector: transitionSelector,
            },
            inverseOperation: {
                opId: createOpId("add-transition-undo"),
                kind: "addTransition",
                selector: transitionSelector,
                transition: cloneJson(transition),
            },
        },
    };
}
