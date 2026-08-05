import type {
    EditorComponentSelector,
} from "../model/EditorCommand";
import type { HighRiskTransactionPreparation } from "./AuthoringTransactionTypes";
import {
    UamControllerLike,
    findComponent,
    findNamedController,
    createCopyName,
    createOpId,
    cloneJson,
    cloneModel,
} from "./AuthoringTransactionSupport";

export function insertControllerPageDraft(
    controller: UamControllerLike,
    atIndex: number,
): string {
    const pages = controller.pages || (controller.pages = []);
    const ids = new Set(pages.map((page) => String(page.id || "")));
    let pageId = "0";
    while (ids.has(pageId)) pageId = String(Number(pageId) + 1);
    const index = Math.max(0, Math.min(pages.length, Math.trunc(atIndex)));
    pages.splice(index, 0, { id: pageId, name: "" });
    controller.selectedIndex = index;
    return pageId;
}

export function removeControllerPageDraft(
    controller: UamControllerLike,
    pageId: string,
): boolean {
    const pages = controller.pages || [];
    const index = pages.findIndex((page) => page.id === pageId);
    if (index < 0 || pages.length <= 1) return false;
    const selectedId = pages[Number(controller.selectedIndex || 0)]?.id;
    pages.splice(index, 1);
    controller.selectedIndex = selectedId === pageId
        ? Math.min(index, pages.length - 1)
        : Math.max(0, pages.findIndex((page) => page.id === selectedId));
    return true;
}

export function moveControllerPageDraft(
    controller: UamControllerLike,
    pageId: string,
    delta: -1 | 1,
): boolean {
    const pages = controller.pages || [];
    const index = pages.findIndex((page) => page.id === pageId);
    const targetIndex = index + delta;
    if (index < 0 || targetIndex < 0 || targetIndex >= pages.length) return false;
    const selectedId = pages[Number(controller.selectedIndex || 0)]?.id;
    const [page] = pages.splice(index, 1);
    pages.splice(targetIndex, 0, page);
    controller.selectedIndex = Math.max(0, pages.findIndex((item) => item.id === selectedId));
    return true;
}

export function createControllerActionDraft(actionType = 0) {
    return {
        name: "",
        actionType,
        fromPageIds: [] as string[],
        toPageIds: [] as string[],
        transitionName: "",
        playTimes: 1,
        delay: 0,
        stopOnExit: false,
        targetNodeId: "",
        controllerName: "",
        targetPage: "",
    };
}

export function removeControllerActionDraft(
    controller: UamControllerLike,
    actionIndex: number,
): boolean {
    const actions = controller.actions || [];
    if (!Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= actions.length) return false;
    actions.splice(actionIndex, 1);
    return true;
}

export function moveControllerActionDraft(
    controller: UamControllerLike,
    actionIndex: number,
    delta: -1 | 1,
): boolean {
    const actions = controller.actions || [];
    const targetIndex = actionIndex + delta;
    if (
        !Number.isInteger(actionIndex)
        || actionIndex < 0
        || targetIndex < 0
        || targetIndex >= actions.length
    ) return false;
    const [action] = actions.splice(actionIndex, 1);
    actions.splice(targetIndex, 0, action);
    return true;
}

export function getControllerModel(
    projectValue: unknown,
    selector: EditorComponentSelector,
    controllerName: string,
): unknown | null {
    return cloneModel(findNamedController(findComponent(projectValue, selector), controllerName));
}

export function prepareUpdateControllerModel(
    projectValue: unknown,
    selector: EditorComponentSelector,
    controllerName: string,
    model: unknown,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const controller = findNamedController(component, controllerName);
    const updated = cloneModel(model) as UamControllerLike | null;
    if (!controller || !controller.name) {
        return { ok: false, code: "controller_unavailable", message: "Choose an existing controller by its exact name." };
    }
    if (
        !updated
        || updated.name !== controller.name
        || typeof updated.autoRadioGroupDepth !== "boolean"
        || typeof updated.alias !== "string"
        || typeof updated.exported !== "boolean"
        || !["default", "specific", "branch", "variable"].includes(String(updated.homePageType || ""))
        || typeof updated.homePage !== "string"
        || !Array.isArray(updated.pages)
        || !Array.isArray(updated.actions)
    ) {
        return {
            ok: false,
            code: "invalid_controller_model",
            message: "Controller model must preserve its exact name, metadata, pages, and actions.",
        };
    }
    const pageIds = updated.pages.map((page) => String(page?.id || ""));
    if (pageIds.some((id) => !id) || new Set(pageIds).size !== pageIds.length) {
        return { ok: false, code: "invalid_controller_pages", message: "Controller pages require unique non-empty IDs." };
    }
    if (updated.pages.some((page) => typeof page.name !== "string")) {
        return { ok: false, code: "invalid_controller_pages", message: "Every controller page requires a string name." };
    }
    if (updated.actions.some((action) => (
        !action
        || typeof action.name !== "string"
        || !Number.isInteger(action.actionType)
        || Number(action.actionType) < 0
        || Number(action.actionType) > 1
        || !Array.isArray(action.fromPageIds)
        || !Array.isArray(action.toPageIds)
        || [...action.fromPageIds, ...action.toPageIds].some((pageId) => typeof pageId !== "string")
        || new Set(action.fromPageIds).size !== action.fromPageIds.length
        || new Set(action.toPageIds).size !== action.toPageIds.length
        || typeof action.transitionName !== "string"
        || !Number.isInteger(action.playTimes)
        || !Number.isFinite(action.delay)
        || typeof action.stopOnExit !== "boolean"
        || typeof action.targetNodeId !== "string"
        || typeof action.controllerName !== "string"
        || typeof action.targetPage !== "string"
    ))) {
        return {
            ok: false,
            code: "invalid_controller_actions",
            message: "Controller actions must match the complete Play Transition or Change Page UAM shape.",
        };
    }
    const selectedIndex = Number(updated.selectedIndex || 0);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= pageIds.length) {
        return { ok: false, code: "invalid_controller_page", message: `Controller selectedIndex must be an integer from 0 to ${Math.max(0, pageIds.length - 1)}.` };
    }
    const pageIdSet = new Set(pageIds);
    if (updated.homePageType === "specific" && !pageIdSet.has(updated.homePage || "")) {
        return { ok: false, code: "invalid_controller_home_page", message: "Specific home page must reference an existing page." };
    }
    if (updated.homePageType === "variable" && !updated.homePage) {
        return { ok: false, code: "invalid_controller_home_page", message: "Variable home page requires a custom property key." };
    }
    if ((updated.homePageType === "default" || updated.homePageType === "branch") && updated.homePage) {
        return { ok: false, code: "invalid_controller_home_page", message: `${updated.homePageType} home page must not carry a value.` };
    }
    const invalidActionPageId = updated.actions
        .flatMap((action) => [...(action.fromPageIds || []), ...(action.toPageIds || [])])
        .find((pageId) => pageId && !pageIdSet.has(pageId));
    if (invalidActionPageId) {
        return {
            ok: false,
            code: "invalid_controller_action_pages",
            message: `Controller action references missing page ${invalidActionPageId}.`,
        };
    }
    const displayNodeIds = new Set((component?.displayList || []).map((node) => String(node.id || "")));
    const invalidActionTarget = updated.actions.find((action) => (
        action.targetNodeId && !displayNodeIds.has(action.targetNodeId)
    ));
    if (invalidActionTarget) {
        return {
            ok: false,
            code: "invalid_controller_action_target",
            message: `Controller action references missing display node ${invalidActionTarget.targetNodeId}.`,
        };
    }
    const removedPageIds = new Set(
        (controller.pages || [])
            .map((page) => String(page.id || ""))
            .filter((pageId) => pageId && !pageIdSet.has(pageId)),
    );
    const referencedRemovedPage = (component?.displayList || [])
        .flatMap((node) => node.gears || [])
        .filter((gear) => gear.controllerName === controller.name)
        .flatMap((gear) => [
            ...(gear.visibleOnPageIds || []),
            ...(gear.states || []).map((state) => (
                state && typeof state === "object" && "pageId" in state
                    ? String((state as { pageId?: string }).pageId || "")
                    : ""
            )),
        ])
        .find((pageId) => removedPageIds.has(pageId));
    if (referencedRemovedPage) {
        return {
            ok: false,
            code: "controller_page_in_use",
            message: `Controller page ${referencedRemovedPage} is still referenced by a display-node gear.`,
        };
    }
    const controllerSelector = { ...selector, controllerName: controller.name };
    return {
        ok: true,
        transaction: {
            summary: `Update controller model ${controller.name}`,
            operation: { opId: createOpId("update-controller"), kind: "updateController", selector: controllerSelector, controller: updated },
            inverseOperation: { opId: createOpId("update-controller-undo"), kind: "updateController", selector: controllerSelector, controller: cloneJson(controller) },
        },
    };
}

export function prepareUpdateController(
    projectValue: unknown,
    selector: EditorComponentSelector,
    controllerName: string,
    selectedIndex: number,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const controller = findNamedController(component, controllerName);
    const pageCount = controller?.pages?.length || 0;
    if (!controller || !controller.name || pageCount === 0) {
        return {
            ok: false,
            code: "controller_unavailable",
            message: "Choose a controller on the selected component with at least one page.",
        };
    }
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= pageCount) {
        return { ok: false, code: "invalid_controller_page", message: `Controller page must be an integer from 0 to ${pageCount - 1}.` };
    }

    const updated = cloneJson(controller) as UamControllerLike;
    updated.selectedIndex = selectedIndex;
    const controllerSelector = { ...selector, controllerName: controller.name };
    return {
        ok: true,
        transaction: {
            summary: `Set controller ${controller.name} page to ${selectedIndex}`,
            operation: {
                opId: createOpId("update-controller"),
                kind: "updateController",
                selector: controllerSelector,
                controller: updated,
            },
            inverseOperation: {
                opId: createOpId("update-controller-undo"),
                kind: "updateController",
                selector: controllerSelector,
                controller: cloneJson(controller),
            },
        },
    };
}

export function prepareAddController(
    projectValue: unknown,
    selector: EditorComponentSelector,
    sourceControllerName: string,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const controller = findNamedController(component, sourceControllerName);
    if (!controller || !controller.name) {
        return {
            ok: false,
            code: "controller_unavailable",
            message: "Choose a controller on the selected component to duplicate.",
        };
    }

    const added = cloneJson(controller) as UamControllerLike;
    added.name = createCopyName(component?.controllers || [], controller.name);
    const controllerSelector = { ...selector, controllerName: added.name };
    return {
        ok: true,
        transaction: {
            summary: `Duplicate controller ${controller.name} as ${added.name}`,
            operation: {
                opId: createOpId("add-controller"),
                kind: "addController",
                selector: controllerSelector,
                controller: added,
            },
            inverseOperation: {
                opId: createOpId("remove-controller-undo"),
                kind: "removeController",
                selector: controllerSelector,
            },
        },
    };
}

export function prepareCreateController(
    projectValue: unknown,
    selector: EditorComponentSelector,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    if (!component) {
        return {
            ok: false,
            code: "component_unavailable",
            message: "Choose a component before creating a controller.",
        };
    }

    const name = createCopyName(component.controllers || [], "controller");
    const controller: UamControllerLike = {
        name,
        selectedIndex: 0,
        autoRadioGroupDepth: false,
        alias: "",
        exported: false,
        homePageType: "default",
        homePage: "",
        pages: [
            { id: "0", name: "page1" },
            { id: "1", name: "page2" },
        ],
        actions: [],
    };
    const controllerSelector = { ...selector, controllerName: name };
    return {
        ok: true,
        transaction: {
            summary: `Create controller ${name}`,
            operation: {
                opId: createOpId("add-controller"),
                kind: "addController",
                selector: controllerSelector,
                controller,
            },
            inverseOperation: {
                opId: createOpId("remove-controller-undo"),
                kind: "removeController",
                selector: controllerSelector,
            },
        },
    };
}

export function prepareRemoveController(
    projectValue: unknown,
    selector: EditorComponentSelector,
    controllerName: string,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const controller = findNamedController(component, controllerName);
    if (!controller || !controller.name) {
        return {
            ok: false,
            code: "controller_unavailable",
            message: "Choose a controller on the selected component to remove.",
        };
    }

    const normalizedControllerName = controller.name;
    const controllerSelector = { ...selector, controllerName: normalizedControllerName };
    const dependentGears = (component?.displayList || []).flatMap((node) => (node.gears || [])
        .filter((gear) => gear.controllerName === normalizedControllerName && gear.kind)
        .map((gear) => ({ node, gear })));
    const removeGears = dependentGears.map(({ node, gear }) => gear.kind === "look" ? ({
        opId: createOpId("remove-controller-gear"),
        kind: "removeLookGear" as const,
        selector: {
            ...selector,
            displayNodeId: String(node.id || ""),
            kind: String(gear.kind),
            controllerName: normalizedControllerName,
        },
    }) : ({
        opId: createOpId("remove-controller-gear"),
        kind: "removeGear" as const,
        selector: {
            ...selector,
            displayNodeId: String(node.id || ""),
            kind: String(gear.kind),
            controllerName: normalizedControllerName,
        },
    }));
    const restoreGears = dependentGears.map(({ node, gear }) => gear.kind === "look" ? ({
        opId: createOpId("restore-controller-gear"),
        kind: "addLookGear" as const,
        selector: {
            ...selector,
            displayNodeId: String(node.id || ""),
            kind: String(gear.kind),
            controllerName: normalizedControllerName,
        },
        gear: cloneJson(gear),
    }) : ({
        opId: createOpId("restore-controller-gear"),
        kind: "addGear" as const,
        selector: {
            ...selector,
            displayNodeId: String(node.id || ""),
            kind: String(gear.kind),
            controllerName: normalizedControllerName,
        },
        gear: cloneJson(gear),
    }));
    return {
        ok: true,
        transaction: {
            summary: dependentGears.length > 0
                ? `Remove controller ${normalizedControllerName} with ${dependentGears.length} dependent gear(s)`
                : `Remove controller ${normalizedControllerName}`,
            operation: {
                opId: createOpId("remove-controller"),
                kind: "removeController",
                selector: controllerSelector,
            },
            inverseOperation: {
                opId: createOpId("add-controller-undo"),
                kind: "addController",
                selector: controllerSelector,
                controller: cloneJson(controller),
            },
            ...(dependentGears.length > 0 ? {
                operations: [
                    ...removeGears,
                    { opId: createOpId("remove-controller"), kind: "removeController" as const, selector: controllerSelector },
                ],
                inverseOperations: [
                    { opId: createOpId("add-controller-undo"), kind: "addController" as const, selector: controllerSelector, controller: cloneJson(controller) },
                    ...restoreGears,
                ],
            } : {}),
        },
    };
}
