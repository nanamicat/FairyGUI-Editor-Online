import type {
    EditorComponentSelector,
    EditorDisplayNodeSelector,
    EditorResourceSelector,
} from "../model/EditorCommand";
import type {
    HighRiskTransactionPreparation,
    DisplayNodeClipboard,
    DisplayNodeClipboardPreparation,
    DisplayNodeRelationModel,
} from "./AuthoringTransactionTypes";
import { readTextInputProperties, readTextProperties } from "./DisplayListReaders";
import {
    SUPPORTED_ATTACHABLE_NODE_KINDS,
    createDefaultUamDisplayNodeBase,
    UamResourceLike,
    UamComponentLike,
    UamDisplayNodeLike,
    findPackage,
    findResource,
    findComponent,
    readComponentReference,
    findDisplayNode,
    findNamedController,
    createCopyId,
    createDisplayNodeCopy,
    createCopyName,
    createOpId,
    copySourcePackageDisplayDependencies,
    cloneJson,
    missingResource,
    missingDisplayNode,
} from "./AuthoringTransactionSupport";

export * from "./DisplayListReaders";

export type PrimitiveDisplayNodeKind =
    | "text"
    | "richText"
    | "textInput"
    | "graph"
    | "list"
    | "loader"
    | "loader3D";

export type DisplayNodeReplacementTarget = PrimitiveDisplayNodeKind | EditorResourceSelector;

function componentDependsOn(
    projectValue: unknown,
    selector: EditorComponentSelector,
    target: EditorComponentSelector,
    visited = new Set<string>(),
): boolean {
    if (
        selector.packageId === target.packageId
        && selector.componentResourceId === target.componentResourceId
    ) return true;
    const key = `${selector.packageId}\0${selector.componentResourceId}`;
    if (visited.has(key)) return false;
    visited.add(key);
    return (findComponent(projectValue, selector)?.displayList || []).some((node) => {
        const reference = readComponentReference(node, selector.packageId);
        return reference ? componentDependsOn(projectValue, reference, target, visited) : false;
    });
}

export function prepareAddPrimitiveDisplayNode(
    projectValue: unknown,
    selector: EditorComponentSelector,
    kind: PrimitiveDisplayNodeKind,
    position: { x: number; y: number },
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    if (!component) {
        return {
            ok: false,
            code: "target_component_not_found",
            message: `Component ${selector.componentResourceId} is not in the selected package.`,
        };
    }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
        return { ok: false, code: "invalid_placement_position", message: "Choose a finite canvas position." };
    }
    const displayList = component.displayList || [];
    const id = createCopyId(displayList, `${kind}_node`);
    const textKind = kind === "text" || kind === "richText" || kind === "textInput";
    const common = {
        kind,
        id,
        name: createCopyName(displayList, textKind ? "Text" : kind === "graph" ? "Graph" : kind),
        position: { x: Math.round(position.x), y: Math.round(position.y) },
        size: kind === "text"
            ? { width: 160, height: 30 }
            : kind === "richText"
                ? { width: 240, height: 100 }
                : kind === "textInput"
                    ? { width: 200, height: 30 }
                    : kind === "list"
                        ? { width: 240, height: 160 }
                        : kind === "loader"
                            ? { width: 160, height: 120 }
                            : kind === "loader3D"
                                ? { width: 200, height: 160 }
                                : { width: 100, height: 100 },
        ...createDefaultUamDisplayNodeBase(),
    };
    let node: UamDisplayNodeLike & Record<string, unknown>;
    if (textKind) {
        const textProperties = readTextProperties({ kind });
        node = {
            ...common,
            text: kind === "richText" ? "[b]Rich Text[/b]" : kind === "text" ? "Text" : "",
            font: "",
            fontSize: 24,
            color: "#000000",
            ...textProperties,
            ...(kind === "textInput" ? {
                ...readTextInputProperties({}),
                promptText: "Input",
            } : {}),
        };
    } else if (kind === "graph") {
        node = {
            ...common,
            locked: false,
            minWidth: 0,
            maxWidth: 0,
            minHeight: 0,
            maxHeight: 0,
            pivot: { x: 0, y: 0 },
            pivotAsAnchor: false,
            group: "",
            skew: { x: 0, y: 0 },
            graphType: 1,
            lineSize: 1,
            lineColor: "#000000",
            fillColor: "#FFFFFF",
            cornerRadius: null,
            points: null,
            sides: 0,
            startAngle: 0,
            distances: null,
        };
    } else if (kind === "list") {
        node = {
            ...common,
            group: "",
            layout: 0,
            align: 0,
            vAlign: 0,
            lineGap: 0,
            columnGap: 0,
            lineCount: 0,
            columnCount: 0,
            selectionMode: 0,
            defaultItem: "",
            autoResizeItem: true,
            childrenRenderOrder: 0,
            apexIndex: 0,
            src: "",
            overflow: 0,
            scrollType: 1,
            scrollBarFlags: 0,
            scrollBarMargin: { top: 0, bottom: 0, left: 0, right: 0 },
            vtScrollBarRes: "",
            hzScrollBarRes: "",
            headerRes: "",
            footerRes: "",
            margin: { top: 0, bottom: 0, left: 0, right: 0 },
            clipSoftness: { x: 0, y: 0 },
            scrollItemToViewOnClick: true,
            foldInvisibleItems: false,
            autoClearItems: false,
            listItems: [],
            pageController: "",
            controllerOverrides: "",
            selectionController: "",
        };
    } else if (kind === "loader") {
        node = {
            ...common,
            pivot: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            url: "",
            filter: "",
            filterData: "",
            fill: 0,
            shrinkOnly: false,
            autoSize: false,
            useResize: false,
            align: 0,
            vAlign: 0,
            frame: 0,
            playing: true,
            color: "#FFFFFF",
            fillMethod: 0,
            fillOrigin: 0,
            fillClockwise: true,
            fillAmount: 100,
            clearOnPublish: false,
        };
    } else {
        node = {
            ...common,
            url: "",
            fill: 0,
            shrinkOnly: false,
            autoSize: false,
            align: 0,
            vAlign: 0,
            animationName: "",
            skinName: "",
            playing: true,
            frame: 0,
            loop: true,
            color: "#FFFFFF",
        };
    }
    return {
        ok: true,
        transaction: {
            summary: `Add ${kind} display node ${node.name}`,
            operation: {
                opId: createOpId(`attach-${kind}-node`),
                kind: "attachDisplayNode",
                selector,
                atIndex: displayList.length,
                node,
            },
            inverseOperation: {
                opId: createOpId(`detach-${kind}-node-undo`),
                kind: "detachDisplayNode",
                selector: { ...selector, displayNodeId: id },
            },
        },
    };
}

export function preparePlaceResourceDisplayNode(
    projectValue: unknown,
    selector: EditorComponentSelector,
    resourceSelector: EditorResourceSelector,
    position: { x: number; y: number },
): HighRiskTransactionPreparation {
    const targetPackage = findPackage(projectValue, selector.packageId);
    const component = findComponent(projectValue, selector);
    const resource = findResource(projectValue, resourceSelector);
    if (!targetPackage || !component) {
        return {
            ok: false,
            code: "target_component_not_found",
            message: `Component ${selector.componentResourceId} is not in the selected package.`,
        };
    }
    if (!resource || !resource.id) return missingResource(resourceSelector);
    if (resource.kind !== "image" && resource.kind !== "component" && resource.kind !== "movieClip") {
        return {
            ok: false,
            code: "resource_placement_unsupported",
            message: `Library placement is not enabled for ${resource.kind || "unknown"} resources.`,
        };
    }
    if (resource.kind === "component" && componentDependsOn(projectValue, {
        packageId: resourceSelector.packageId,
        componentResourceId: resource.id,
    }, selector)) {
        return {
            ok: false,
            code: "recursive_component_reference",
            message: "A component cannot contain a direct or indirect instance of itself.",
        };
    }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
        return { ok: false, code: "invalid_placement_position", message: "Choose a finite canvas position." };
    }

    const displayList = component.displayList || [];
    const size = resource.kind === "component" ? resource.component?.size : resource.dimensions;
    const node: UamDisplayNodeLike & Record<string, unknown> = {
        kind: resource.kind,
        id: createCopyId(displayList, `${resource.id}_node`),
        name: createCopyName(displayList, resource.name || resource.id),
        position: { x: Math.round(position.x), y: Math.round(position.y) },
        size: {
            width: Math.max(1, Math.round(Number(size?.width || 64))),
            height: Math.max(1, Math.round(Number(size?.height || 64))),
        },
        visible: true,
        touchable: true,
        grayed: false,
        alpha: 1,
        rotation: 0,
        customData: "",
        relations: [],
        gears: [],
        resource: resource.kind === "component" || resource.kind === "movieClip"
            ? {
                packageId: resourceSelector.packageId === selector.packageId
                    ? ""
                    : resourceSelector.packageId,
                resourceId: resource.id,
            }
            : { resourceId: resource.id },
        ...(resource.kind === "movieClip" ? {
            fileName: "",
            filter: "",
            filterData: "",
            playing: true,
            frame: 0,
            color: "#FFFFFF",
        } : {}),
    };
    const crossPackageAsset = selector.packageId !== resourceSelector.packageId
        && (resource.kind === "image" || resource.kind === "movieClip");
    const dependencyPlan = crossPackageAsset
        ? copySourcePackageDisplayDependencies(
            projectValue,
            resourceSelector.packageId,
            selector.packageId,
            [node],
            targetPackage.resources || [],
        )
        : {
            ok: true as const,
            nodes: [node],
            binaryDependencies: [] as UamResourceLike[],
            componentDependencies: [] as UamResourceLike[],
        };
    if (dependencyPlan.ok === false) return dependencyPlan;
    const placedNode = dependencyPlan.nodes[0];
    const displayNodeId = String(placedNode.id);
    const attachOperation = {
        opId: createOpId("attach-library-resource"),
        kind: "attachDisplayNode" as const,
        selector,
        atIndex: displayList.length,
        node: placedNode,
    };
    const detachOperation = {
        opId: createOpId("detach-library-resource-undo"),
        kind: "detachDisplayNode" as const,
        selector: { ...selector, displayNodeId },
    };
    const copiedResource = dependencyPlan.binaryDependencies[0];
    const addResourceOperation = copiedResource ? {
        opId: createOpId("copy-library-resource"),
        kind: "addResource" as const,
        selector: { packageId: selector.packageId },
        resource: copiedResource,
    } : null;
    const removeResourceOperation = copiedResource ? {
        opId: createOpId("remove-library-resource-undo"),
        kind: "removeResource" as const,
        selector: { packageId: selector.packageId, resourceId: String(copiedResource.id || "") },
    } : null;
    return {
        ok: true,
        transaction: {
            summary: `Place ${resource.kind} resource ${resource.name || resource.id}`
                + `${copiedResource ? ` by copying it into package ${selector.packageId}` : ""}`,
            operation: addResourceOperation || attachOperation,
            inverseOperation: detachOperation,
            ...(addResourceOperation && removeResourceOperation ? {
                operations: [addResourceOperation, attachOperation],
                inverseOperations: [detachOperation, removeResourceOperation],
            } : {}),
        },
    };
}

export function prepareDuplicateDisplayNode(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const node = component?.displayList?.find((item) => item.id === selector.displayNodeId);
    if (!component || !node) return missingDisplayNode(selector);
    if (!node.kind || !SUPPORTED_ATTACHABLE_NODE_KINDS.has(node.kind)) {
        return {
            ok: false,
            code: "unsupported_display_node_kind",
            message: `Display-list duplicate is not enabled for ${node.kind || "unknown"}.`,
        };
    }

    const copy = createDisplayNodeCopy(node, component.displayList || []);
    const id = String(copy.id || "");
    const componentSelector: EditorComponentSelector = {
        packageId: selector.packageId,
        componentResourceId: selector.componentResourceId,
    };

    return {
        ok: true,
        transaction: {
            summary: `Duplicate display node ${node.name || node.id}`,
            operation: {
                opId: createOpId("attach-display-node"),
                kind: "attachDisplayNode",
                selector: componentSelector,
                atIndex: component.displayList?.length || 0,
                node: copy,
            },
            inverseOperation: {
                opId: createOpId("detach-display-node-undo"),
                kind: "detachDisplayNode",
                selector: { ...componentSelector, displayNodeId: id },
            },
        },
    };
}

export function createDisplayNodeClipboard(
    projectValue: unknown,
    selectors: EditorDisplayNodeSelector[],
): DisplayNodeClipboardPreparation {
    if (selectors.length === 0) {
        return { ok: false, code: "display_node_selection_required", message: "Select at least one display node." };
    }
    const owner = selectors[0];
    const nodes: UamDisplayNodeLike[] = [];
    for (const selector of selectors) {
        if (
            selector.packageId !== owner.packageId
            || selector.componentResourceId !== owner.componentResourceId
        ) {
            return { ok: false, code: "cross_component_selection_unsupported", message: "Copied display nodes must belong to one component." };
        }
        const node = findDisplayNode(projectValue, selector);
        if (!node) {
            return {
                ok: false,
                code: "display_node_not_found",
                message: `Display node ${selector.displayNodeId} was not found.`,
            };
        }
        if (!node.kind || !SUPPORTED_ATTACHABLE_NODE_KINDS.has(node.kind)) {
            return {
                ok: false,
                code: "unsupported_display_node_kind",
                message: `Display-list copy is not enabled for ${node.kind || "unknown"}.`,
            };
        }
        nodes.push(cloneJson(node));
    }
    return {
        ok: true,
        clipboard: {
            packageId: owner.packageId,
            componentResourceId: owner.componentResourceId,
            nodes,
        },
    };
}

export function preparePasteDisplayNodes(
    projectValue: unknown,
    selector: EditorComponentSelector,
    clipboard: DisplayNodeClipboard,
): HighRiskTransactionPreparation {
    const targetPackage = findPackage(projectValue, selector.packageId);
    const component = findComponent(projectValue, selector);
    if (!targetPackage || !component) {
        return {
            ok: false,
            code: "target_component_not_found",
            message: `Component ${selector.componentResourceId} is not in the selected package.`,
        };
    }
    if (clipboard.nodes.length === 0) {
        return { ok: false, code: "clipboard_empty", message: "The display-node clipboard is empty." };
    }

    const sourceNodes = clipboard.nodes.map((value) => cloneJson(value) as UamDisplayNodeLike);
    const sameComponent = clipboard.packageId === selector.packageId
        && clipboard.componentResourceId === selector.componentResourceId;
    if (!sameComponent) {
        const copiedIds = new Set(sourceNodes.map((node) => String(node.id || "")).filter(Boolean));
        const missingGroup = sourceNodes.find((node) => node.group && !copiedIds.has(node.group));
        if (missingGroup) {
            return {
                ok: false,
                code: "display_node_group_dependency_missing",
                message: `Copy group ${missingGroup.group} with ${missingGroup.name || missingGroup.id || "the selected node"}.`,
            };
        }
        const missingRelation = sourceNodes.find((node) =>
            node.relations?.some((relation) => relation.targetNodeId && !copiedIds.has(relation.targetNodeId)),
        );
        if (missingRelation) {
            return {
                ok: false,
                code: "display_node_relation_dependency_missing",
                message: `Copy related nodes with ${missingRelation.name || missingRelation.id || "the selected node"}.`,
            };
        }
        for (const node of sourceNodes) {
            for (const gear of node.gears || []) {
                const controllerName = String(gear.controllerName || "");
                const controller = findNamedController(component, controllerName);
                const targetPageIds = new Set(controller?.pages?.map((page) => String(page.id || "")).filter(Boolean));
                const statePageIds = Array.isArray(gear.states)
                    ? gear.states.flatMap((state) => {
                        const pageId = state && typeof state === "object"
                            ? String((state as { pageId?: unknown }).pageId || "")
                            : "";
                        return pageId ? [pageId] : [];
                    })
                    : [];
                const referencedPageIds = [...(gear.visibleOnPageIds || []), ...statePageIds];
                if (
                    !controller
                    || referencedPageIds.some((pageId) => !targetPageIds.has(pageId))
                ) {
                    return {
                        ok: false,
                        code: "display_node_controller_dependency_missing",
                        message: `Target component needs controller ${controllerName || "(unnamed)"} with the referenced pages.`,
                    };
                }
            }
            const reference = readComponentReference(node, clipboard.packageId);
            if (reference && componentDependsOn(projectValue, reference, selector)) {
                return {
                    ok: false,
                    code: "recursive_component_reference",
                    message: "Paste would create a direct or indirect recursive component reference.",
                };
            }
        }
    }

    const dependencyPlan = clipboard.packageId === selector.packageId
        ? {
            ok: true as const,
            nodes: sourceNodes,
            binaryDependencies: [] as UamResourceLike[],
            componentDependencies: [] as UamResourceLike[],
        }
        : copySourcePackageDisplayDependencies(
            projectValue,
            clipboard.packageId,
            selector.packageId,
            sourceNodes,
            targetPackage.resources || [],
        );
    if (dependencyPlan.ok === false) return dependencyPlan;

    const occupied = [...(component.displayList || [])];
    const copies = dependencyPlan.nodes.map((source) => {
        const copy = createDisplayNodeCopy(source, occupied);
        occupied.push(copy);
        return copy;
    });
    const copiedIds = new Map(dependencyPlan.nodes.map((node, index) => [
        String(node.id || ""),
        String(copies[index].id || ""),
    ]));
    for (const [index, copy] of copies.entries()) {
        const source = dependencyPlan.nodes[index];
        if (source.group && copiedIds.has(source.group)) copy.group = copiedIds.get(source.group);
        copy.relations = (source.relations || []).map((relation) => ({
            ...relation,
            ...(relation.targetNodeId && copiedIds.has(relation.targetNodeId)
                ? { targetNodeId: copiedIds.get(relation.targetNodeId) }
                : {}),
        }));
    }

    const startIndex = component.displayList?.length || 0;
    const dependencyOperations = [
        ...dependencyPlan.binaryDependencies.map((resource) => ({
            opId: createOpId("copy-display-dependency"),
            kind: "addResource" as const,
            selector: { packageId: selector.packageId },
            resource,
        })),
        ...dependencyPlan.componentDependencies.map((dependency, index) => ({
            opId: createOpId("copy-display-dependency"),
            kind: "addComponent" as const,
            selector: { packageId: selector.packageId },
            component: dependency,
            atIndex: (targetPackage.resources?.length || 0) + dependencyPlan.binaryDependencies.length + index,
        })),
    ];
    const attachOperations = copies.map((node, index) => ({
        opId: createOpId("attach-display-node"),
        kind: "attachDisplayNode" as const,
        selector,
        atIndex: startIndex + index,
        node,
    }));
    const operations = [...dependencyOperations, ...attachOperations];
    const inverseOperations = [
        ...[...copies].reverse().map((node) => ({
            opId: createOpId("detach-display-node-undo"),
            kind: "detachDisplayNode" as const,
            selector: { ...selector, displayNodeId: String(node.id || "") },
        })),
        ...[...dependencyPlan.componentDependencies].reverse().map((dependency) => ({
            opId: createOpId("remove-display-dependency-undo"),
            kind: "removeComponent" as const,
            selector: {
                packageId: selector.packageId,
                componentResourceId: String(dependency.id || ""),
            },
        })),
        ...[...dependencyPlan.binaryDependencies].reverse().map((resource) => ({
            opId: createOpId("remove-display-dependency-undo"),
            kind: "removeResource" as const,
            selector: { packageId: selector.packageId, resourceId: String(resource.id || "") },
        })),
    ];
    return {
        ok: true,
        transaction: {
            summary: `Paste ${copies.length} display node${copies.length === 1 ? "" : "s"}`,
            operation: operations[0],
            inverseOperation: inverseOperations[0],
            operations,
            inverseOperations,
        },
    };
}

type ResolvedDisplayNodeSelection =
    | { ok: false; code: string; message: string }
    | {
        ok: true;
        owner: EditorDisplayNodeSelector;
        component: UamComponentLike;
        entries: Array<{
            selector: EditorDisplayNodeSelector;
            atIndex: number;
            node: UamDisplayNodeLike;
        }>;
    };

function resolveDisplayNodeSelection(
    projectValue: unknown,
    selectors: EditorDisplayNodeSelector[],
): ResolvedDisplayNodeSelection {
    if (selectors.length === 0) {
        return { ok: false as const, code: "display_node_selection_required", message: "Select at least one display node." };
    }
    const owner = selectors[0];
    if (selectors.some((selector) => (
        selector.packageId !== owner.packageId
        || selector.componentResourceId !== owner.componentResourceId
    ))) {
        return {
            ok: false as const,
            code: "cross_component_selection_unsupported",
            message: "Selected display nodes must belong to one component.",
        };
    }
    const component = findComponent(projectValue, owner);
    if (!component) return missingDisplayNode(owner);
    const selectedIds = new Set(selectors.map((selector) => selector.displayNodeId));
    if (selectedIds.size !== selectors.length) {
        return {
            ok: false as const,
            code: "duplicate_display_node_selector",
            message: "Display node selection contains duplicates.",
        };
    }
    const entries = selectors.map((selector) => {
        const atIndex = component.displayList?.findIndex((node) => node.id === selector.displayNodeId) ?? -1;
        return { selector, atIndex, node: atIndex >= 0 ? component.displayList?.[atIndex] : null };
    });
    const missing = entries.find((entry) => !entry.node);
    if (missing) return missingDisplayNode(missing.selector);
    return {
        ok: true,
        owner,
        component,
        entries: entries.map((entry) => ({ ...entry, node: entry.node! })),
    };
}

export function prepareReplaceDisplayNodes(
    projectValue: unknown,
    selectors: EditorDisplayNodeSelector[],
    target: DisplayNodeReplacementTarget,
): HighRiskTransactionPreparation {
    const selection = resolveDisplayNodeSelection(projectValue, selectors);
    if (!selection.ok) return selection;
    const componentSelector: EditorComponentSelector = {
        packageId: selection.owner.packageId,
        componentResourceId: selection.owner.componentResourceId,
    };
    const templatePreparation = typeof target === "string"
        ? prepareAddPrimitiveDisplayNode(projectValue, componentSelector, target, { x: 0, y: 0 })
        : preparePlaceResourceDisplayNode(projectValue, componentSelector, target, { x: 0, y: 0 });
    if (!templatePreparation.ok) return templatePreparation;

    const templateOperations = templatePreparation.transaction.operations
        || [templatePreparation.transaction.operation];
    const templateAttach = templateOperations.find((operation) => operation.kind === "attachDisplayNode");
    if (!templateAttach) {
        return {
            ok: false,
            code: "replacement_target_unsupported",
            message: "The selected replacement target cannot create a display node.",
        };
    }
    const templateNode = cloneJson(templateAttach.node) as UamDisplayNodeLike & Record<string, unknown>;
    if (
        (templateNode.kind === "loader" || templateNode.kind === "loader3D")
        && selection.entries.some(({ node }) => Boolean(node.group))
    ) {
        return {
            ok: false,
            code: "display_node_group_unsupported",
            message: `${templateNode.kind} cannot replace a display node that belongs to a group.`,
        };
    }

    const commonKeys = [
        "id", "name", "position", "size", "locked", "aspect", "minSize", "maxSize",
        "scale", "skew", "visible", "touchable", "grayed", "alpha", "rotation",
        "tooltips", "blendMode", "filter", "filterData", "customData", "relations", "gears",
    ] as const;
    const replacements = selection.entries.map(({ node, atIndex }) => {
        const replacement = cloneJson(templateNode) as UamDisplayNodeLike & Record<string, unknown>;
        const source = node as UamDisplayNodeLike & Record<string, unknown>;
        for (const key of commonKeys) {
            if (key in source) (replacement as Record<string, unknown>)[key] = cloneJson(source[key]);
        }
        if (templateNode.kind !== "loader3D") {
            if ("pivot" in source) replacement.pivot = cloneJson(source.pivot);
            if ("pivotAsAnchor" in source) replacement.pivotAsAnchor = source.pivotAsAnchor;
        }
        if (templateNode.kind !== "loader" && templateNode.kind !== "loader3D" && "group" in source) {
            replacement.group = String(source.group || "");
        }
        return { atIndex, node: replacement };
    });
    const forwardDependencies = templateOperations.filter((operation) => (
        operation.kind !== "attachDisplayNode" && operation.kind !== "setDisplayNodeProps"
    ));
    const inverseDependencies = (templatePreparation.transaction.inverseOperations
        || [templatePreparation.transaction.inverseOperation])
        .filter((operation) => operation.kind !== "detachDisplayNode");
    const detachOriginals = [...selection.entries]
        .sort((left, right) => right.atIndex - left.atIndex)
        .map(({ selector }) => ({
            opId: createOpId("detach-replaced-display-node"),
            kind: "detachDisplayNode" as const,
            selector,
        }));
    const attachReplacements = [...replacements]
        .sort((left, right) => left.atIndex - right.atIndex)
        .map(({ node, atIndex }) => ({
            opId: createOpId("attach-replacement-display-node"),
            kind: "attachDisplayNode" as const,
            selector: componentSelector,
            atIndex,
            node,
        }));
    const detachReplacements = [...replacements]
        .sort((left, right) => right.atIndex - left.atIndex)
        .map(({ node }) => ({
            opId: createOpId("detach-replacement-display-node-undo"),
            kind: "detachDisplayNode" as const,
            selector: { ...componentSelector, displayNodeId: String(node.id || "") },
        }));
    const attachOriginals = [...selection.entries]
        .sort((left, right) => left.atIndex - right.atIndex)
        .map(({ node, atIndex }) => ({
            opId: createOpId("attach-replaced-display-node-undo"),
            kind: "attachDisplayNode" as const,
            selector: componentSelector,
            atIndex,
            node: cloneJson(node),
        }));
    const operations = [...forwardDependencies, ...detachOriginals, ...attachReplacements];
    const inverseOperations = [...detachReplacements, ...attachOriginals, ...inverseDependencies];
    return {
        ok: true,
        transaction: {
            summary: `Replace ${replacements.length} display node${replacements.length === 1 ? "" : "s"} with ${templateNode.kind}`,
            operation: operations[0],
            inverseOperation: inverseOperations[0],
            operations,
            inverseOperations,
        },
    };
}

export function prepareGroupDisplayNodes(
    projectValue: unknown,
    selectors: EditorDisplayNodeSelector[],
): HighRiskTransactionPreparation {
    if (selectors.length < 2) {
        return { ok: false, code: "group_selection_too_small", message: "Select at least two display nodes to group." };
    }
    const selection = resolveDisplayNodeSelection(projectValue, selectors);
    if (!selection.ok) return selection;
    const unsupported = selection.entries.find(({ node }) => (
        !node?.kind
        || !SUPPORTED_ATTACHABLE_NODE_KINDS.has(node.kind)
        || node.kind === "loader"
        || node.kind === "loader3D"
    ));
    if (unsupported) {
        return {
            ok: false,
            code: "unsupported_group_member_kind",
            message: `Group membership is not supported for ${unsupported.node?.kind || "unknown"}.`,
        };
    }
    const parentGroups = new Set(selection.entries.map(({ node }) => String(node?.group || "")));
    if (parentGroups.size !== 1) {
        return {
            ok: false,
            code: "mixed_group_parent",
            message: "Selected display nodes must share the same current group.",
        };
    }

    const displayList = selection.component.displayList || [];
    const groupId = createCopyId(displayList, "group");
    const groupNode = {
        kind: "group",
        id: groupId,
        name: createCopyName(displayList, "Group"),
        position: {
            x: Math.min(...selection.entries.map(({ node }) => Number(node?.position?.x || 0))),
            y: Math.min(...selection.entries.map(({ node }) => Number(node?.position?.y || 0))),
        },
        size: {
            width: Math.max(...selection.entries.map(({ node }) => (
                Number(node?.position?.x || 0) + Number(node?.size?.width || 0)
            ))) - Math.min(...selection.entries.map(({ node }) => Number(node?.position?.x || 0))),
            height: Math.max(...selection.entries.map(({ node }) => (
                Number(node?.position?.y || 0) + Number(node?.size?.height || 0)
            ))) - Math.min(...selection.entries.map(({ node }) => Number(node?.position?.y || 0))),
        },
        visible: true,
        touchable: true,
        grayed: false,
        alpha: 1,
        rotation: 0,
        customData: "",
        group: [...parentGroups][0],
        relations: [],
        gears: [],
        locked: false,
        layout: 0,
        lineGap: 0,
        columnGap: 0,
        advanced: true,
        excludeInvisibles: false,
        autoSizeDisabled: false,
        mainGridIndex: -1,
    };
    const componentSelector: EditorComponentSelector = {
        packageId: selection.owner.packageId,
        componentResourceId: selection.owner.componentResourceId,
    };
    const attach = {
        opId: createOpId("attach-group-node"),
        kind: "attachDisplayNode" as const,
        selector: componentSelector,
        atIndex: Math.max(...selection.entries.map(({ atIndex }) => atIndex)) + 1,
        node: groupNode,
    };
    const detach = {
        opId: createOpId("detach-group-node-undo"),
        kind: "detachDisplayNode" as const,
        selector: { ...componentSelector, displayNodeId: groupId },
    };
    const memberOperations = selection.entries.map(({ selector }) => ({
        opId: createOpId("set-group-member"),
        kind: "setDisplayNodeProps" as const,
        selector,
        props: { group: groupId },
    }));
    const inverseMemberOperations = selection.entries.map(({ selector }) => ({
        opId: createOpId("restore-group-member"),
        kind: "setDisplayNodeProps" as const,
        selector,
        props: { group: groupNode.group },
    }));
    return {
        ok: true,
        transaction: {
            summary: `Group ${selection.entries.length} display nodes as ${groupNode.name}`,
            operation: attach,
            inverseOperation: detach,
            operations: [attach, ...memberOperations],
            inverseOperations: [...inverseMemberOperations, detach],
        },
    };
}

export function prepareUngroupDisplayNodes(
    projectValue: unknown,
    selectors: EditorDisplayNodeSelector[],
): HighRiskTransactionPreparation {
    const selection = resolveDisplayNodeSelection(projectValue, selectors);
    if (!selection.ok) return selection;
    const nonGroup = selection.entries.find(({ node }) => node?.kind !== "group");
    if (nonGroup) {
        return {
            ok: false,
            code: "ungroup_requires_group_nodes",
            message: "Ungroup requires one or more selected group nodes.",
        };
    }
    const selectedIds = new Set(selectors.map((selector) => selector.displayNodeId));
    if (selection.entries.some(({ node }) => node?.group && selectedIds.has(node.group))) {
        return {
            ok: false,
            code: "nested_group_selection_unsupported",
            message: "Ungroup nested selections one level at a time.",
        };
    }

    const componentSelector: EditorComponentSelector = {
        packageId: selection.owner.packageId,
        componentResourceId: selection.owner.componentResourceId,
    };
    const memberOperations = selection.entries.flatMap(({ node }) => (
        (selection.component.displayList || [])
            .filter((candidate) => candidate.group === node?.id)
            .map((candidate) => ({
                opId: createOpId("clear-group-member"),
                kind: "setDisplayNodeProps" as const,
                selector: { ...componentSelector, displayNodeId: String(candidate.id || "") },
                props: { group: String(node?.group || "") },
            }))
    ));
    const inverseMemberOperations = selection.entries.flatMap(({ node }) => (
        (selection.component.displayList || [])
            .filter((candidate) => candidate.group === node?.id)
            .map((candidate) => ({
                opId: createOpId("restore-group-member"),
                kind: "setDisplayNodeProps" as const,
                selector: { ...componentSelector, displayNodeId: String(candidate.id || "") },
                props: { group: String(node?.id || "") },
            }))
    ));
    const detachOperations = [...selection.entries]
        .sort((left, right) => right.atIndex - left.atIndex)
        .map(({ selector }) => ({
            opId: createOpId("detach-group-node"),
            kind: "detachDisplayNode" as const,
            selector,
        }));
    const attachOperations = [...selection.entries]
        .sort((left, right) => left.atIndex - right.atIndex)
        .map(({ node, atIndex }) => ({
            opId: createOpId("attach-group-node-undo"),
            kind: "attachDisplayNode" as const,
            selector: componentSelector,
            atIndex,
            node: cloneJson(node),
        }));
    return {
        ok: true,
        transaction: {
            summary: `Ungroup ${selection.entries.length} group${selection.entries.length === 1 ? "" : "s"}`,
            operation: detachOperations[0],
            inverseOperation: attachOperations[0],
            operations: [...memberOperations, ...detachOperations],
            inverseOperations: [...attachOperations, ...inverseMemberOperations],
        },
    };
}

export function prepareDetachDisplayNode(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const atIndex = component?.displayList?.findIndex((item) => item.id === selector.displayNodeId) ?? -1;
    const node = atIndex >= 0 ? component?.displayList?.[atIndex] : null;
    if (!component || !node) return missingDisplayNode(selector);
    if (!node.kind || !SUPPORTED_ATTACHABLE_NODE_KINDS.has(node.kind)) {
        return {
            ok: false,
            code: "unsupported_display_node_kind",
            message: `Display-list detach is not enabled for ${node.kind || "unknown"}.`,
        };
    }

    const componentSelector: EditorComponentSelector = {
        packageId: selector.packageId,
        componentResourceId: selector.componentResourceId,
    };
    return {
        ok: true,
        transaction: {
            summary: `Detach display node ${node.name || node.id}`,
            operation: {
                opId: createOpId("detach-display-node"),
                kind: "detachDisplayNode",
                selector,
            },
            inverseOperation: {
                opId: createOpId("attach-display-node-undo"),
                kind: "attachDisplayNode",
                selector: componentSelector,
                atIndex,
                node: cloneJson(node),
            },
        },
    };
}

export function prepareRenameDisplayNode(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    newName: string,
): HighRiskTransactionPreparation {
    const preparation = prepareDetachDisplayNode(projectValue, selector);
    if (!preparation.ok) return preparation;
    const original = preparation.transaction.inverseOperation;
    if (original.kind !== "attachDisplayNode") {
        return { ok: false, code: "display_node_rename_unsupported", message: "Display node cannot be renamed." };
    }
    const originalNode = cloneJson(original.node) as UamDisplayNodeLike;
    const renamed = cloneJson(originalNode);
    renamed.name = newName;
    const componentSelector = original.selector;
    const detachRenamed = {
        opId: createOpId("detach-renamed-display-node-undo"),
        kind: "detachDisplayNode" as const,
        selector,
    };
    const attachRenamed = {
        opId: createOpId("attach-renamed-display-node"),
        kind: "attachDisplayNode" as const,
        selector: componentSelector,
        atIndex: original.atIndex,
        node: renamed,
    };
    return {
        ok: true,
        transaction: {
            summary: `Rename display node ${String(originalNode.name || selector.displayNodeId)} to ${newName}`,
            operation: preparation.transaction.operation,
            inverseOperation: detachRenamed,
            operations: [preparation.transaction.operation, attachRenamed],
            inverseOperations: [detachRenamed, original],
        },
    };
}

export function prepareDetachDisplayNodes(
    projectValue: unknown,
    selectors: EditorDisplayNodeSelector[],
): HighRiskTransactionPreparation {
    if (selectors.length === 0) {
        return { ok: false, code: "display_node_selection_required", message: "Select at least one display node." };
    }
    const owner = selectors[0];
    if (selectors.some((selector) => (
        selector.packageId !== owner.packageId
        || selector.componentResourceId !== owner.componentResourceId
    ))) {
        return {
            ok: false,
            code: "cross_component_selection_unsupported",
            message: "Delete requires display nodes from one component.",
        };
    }
    const component = findComponent(projectValue, owner);
    if (!component) return missingDisplayNode(owner);
    const selectedIds = new Set(selectors.map((selector) => selector.displayNodeId));
    if (selectedIds.size !== selectors.length) {
        return { ok: false, code: "duplicate_display_node_selector", message: "Delete selection contains duplicate nodes." };
    }
    const entries = selectors.map((selector) => {
        const atIndex = component.displayList?.findIndex((node) => node.id === selector.displayNodeId) ?? -1;
        const node = atIndex >= 0 ? component.displayList?.[atIndex] : null;
        return { selector, atIndex, node };
    });
    const missing = entries.find((entry) => !entry.node);
    if (missing) return missingDisplayNode(missing.selector);
    const unsupported = entries.find((entry) => (
        !entry.node?.kind || !SUPPORTED_ATTACHABLE_NODE_KINDS.has(entry.node.kind)
    ));
    if (unsupported) {
        return {
            ok: false,
            code: "unsupported_display_node_kind",
            message: `Display-list detach is not enabled for ${unsupported.node?.kind || "unknown"}.`,
        };
    }
    const componentSelector: EditorComponentSelector = {
        packageId: owner.packageId,
        componentResourceId: owner.componentResourceId,
    };
    const operations = [...entries]
        .sort((left, right) => right.atIndex - left.atIndex)
        .map((entry) => ({
            opId: createOpId("detach-display-node"),
            kind: "detachDisplayNode" as const,
            selector: entry.selector,
        }));
    const inverseOperations = [...entries]
        .sort((left, right) => left.atIndex - right.atIndex)
        .map((entry) => ({
            opId: createOpId("attach-display-node-undo"),
            kind: "attachDisplayNode" as const,
            selector: componentSelector,
            atIndex: entry.atIndex,
            node: cloneJson(entry.node),
        }));
    return {
        ok: true,
        transaction: {
            summary: `Delete ${entries.length} display node${entries.length === 1 ? "" : "s"}`,
            operation: operations[0],
            inverseOperation: inverseOperations[0],
            operations,
            inverseOperations,
        },
    };
}

export function prepareMoveDisplayNode(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    targetComponentResourceId: string,
    targetIndex: number,
): HighRiskTransactionPreparation {
    const sourceComponent = findComponent(projectValue, selector);
    const sourceIndex = sourceComponent?.displayList?.findIndex((item) => item.id === selector.displayNodeId) ?? -1;
    const node = sourceIndex >= 0 ? sourceComponent?.displayList?.[sourceIndex] : null;
    const normalizedTargetId = targetComponentResourceId.trim();
    if (!sourceComponent || !node) return missingDisplayNode(selector);
    if (!node.kind || !SUPPORTED_ATTACHABLE_NODE_KINDS.has(node.kind)) {
        return {
            ok: false,
            code: "unsupported_display_node_kind",
            message: `Reorder/reparent is not enabled for ${node.kind || "unknown"}.`,
        };
    }
    if (!normalizedTargetId) {
        return { ok: false, code: "target_component_required", message: "Enter a target component resource ID." };
    }
    const targetSelector: EditorComponentSelector = {
        packageId: selector.packageId,
        componentResourceId: normalizedTargetId,
    };
    const targetComponent = findComponent(projectValue, targetSelector);
    if (!targetComponent) {
        return { ok: false, code: "target_component_not_found", message: `Component ${normalizedTargetId} is not in the selected package.` };
    }
    const targetLength = targetComponent.displayList?.length || 0;
    const targetIsSource = normalizedTargetId === selector.componentResourceId;
    const maxIndex = targetIsSource ? Math.max(0, targetLength - 1) : targetLength;
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > maxIndex) {
        return { ok: false, code: "invalid_display_node_index", message: `Target index must be an integer from 0 to ${maxIndex}.` };
    }
    if (targetIsSource && targetIndex === sourceIndex) {
        return { ok: false, code: "display_node_index_unchanged", message: "Display node is already at that index." };
    }
    if (!targetIsSource && targetComponent.displayList?.some((item) => item.id === node.id)) {
        return { ok: false, code: "display_node_id_conflict", message: `Target component already has display node ${node.id}.` };
    }
    const targetNodeSelector = { ...targetSelector, displayNodeId: String(node.id || "") };
    const sourceComponentSelector: EditorComponentSelector = {
        packageId: selector.packageId,
        componentResourceId: selector.componentResourceId,
    };
    const copiedNode = cloneJson(node);
    return {
        ok: true,
        transaction: {
            summary: targetIsSource
                ? `Reorder display node ${node.name || node.id} to ${targetIndex}`
                : `Reparent display node ${node.name || node.id} to ${normalizedTargetId}@${targetIndex}`,
            operation: {
                opId: createOpId("attach-display-node"),
                kind: "attachDisplayNode",
                selector: targetSelector,
                atIndex: targetIndex,
                node: copiedNode,
            },
            inverseOperation: {
                opId: createOpId("attach-display-node-undo"),
                kind: "attachDisplayNode",
                selector: sourceComponentSelector,
                atIndex: sourceIndex,
                node: cloneJson(node),
            },
            operations: [
                { opId: createOpId("detach-display-node"), kind: "detachDisplayNode", selector },
                {
                    opId: createOpId("attach-display-node"),
                    kind: "attachDisplayNode",
                    selector: targetSelector,
                    atIndex: targetIndex,
                    node: copiedNode,
                },
            ],
            inverseOperations: [
                { opId: createOpId("detach-display-node-undo"), kind: "detachDisplayNode", selector: targetNodeSelector },
                {
                    opId: createOpId("attach-display-node-undo"),
                    kind: "attachDisplayNode",
                    selector: sourceComponentSelector,
                    atIndex: sourceIndex,
                    node: cloneJson(node),
                },
            ],
        },
    };
}

export function prepareAdjustDisplayNodeDepth(
    projectValue: unknown,
    selectors: EditorDisplayNodeSelector[],
    direction: "forward" | "backward" | "top" | "bottom",
): HighRiskTransactionPreparation {
    const selection = resolveDisplayNodeSelection(projectValue, selectors);
    if (!selection.ok) return selection;
    const displayList = selection.component.displayList || [];
    const selectedIds = new Set(selection.entries.map(({ selector }) => selector.displayNodeId));
    const parentGroups = new Set(selection.entries.map(({ node }) => String(node.group || "")));
    if (parentGroups.size !== 1) {
        return {
            ok: false,
            code: "mixed_group_parent",
            message: "Selected display nodes must share the same current group.",
        };
    }
    const parentGroup = [...parentGroups][0];
    const scoped = displayList.filter((node) => String(node.group || "") === parentGroup);
    const reorderedScope = [...scoped];
    if (direction === "top" || direction === "bottom") {
        const selected = reorderedScope.filter((node) => selectedIds.has(String(node.id || "")));
        const unselected = reorderedScope.filter((node) => !selectedIds.has(String(node.id || "")));
        reorderedScope.splice(0, reorderedScope.length, ...(direction === "top"
            ? [...unselected, ...selected]
            : [...selected, ...unselected]));
    } else if (direction === "forward") {
        for (let index = reorderedScope.length - 2; index >= 0; index -= 1) {
            if (selectedIds.has(String(reorderedScope[index].id || ""))
                && !selectedIds.has(String(reorderedScope[index + 1].id || ""))) {
                [reorderedScope[index], reorderedScope[index + 1]] = [reorderedScope[index + 1], reorderedScope[index]];
            }
        }
    } else {
        for (let index = 1; index < reorderedScope.length; index += 1) {
            if (selectedIds.has(String(reorderedScope[index].id || ""))
                && !selectedIds.has(String(reorderedScope[index - 1].id || ""))) {
                [reorderedScope[index], reorderedScope[index - 1]] = [reorderedScope[index - 1], reorderedScope[index]];
            }
        }
    }
    let scopedIndex = 0;
    const reordered = displayList.map((node) => (
        String(node.group || "") === parentGroup ? reorderedScope[scopedIndex++] : node
    ));
    if (reordered.every((node, index) => node.id === displayList[index]?.id)) {
        return {
            ok: false,
            code: "display_node_depth_unchanged",
            message: `Selected display nodes cannot move ${direction} any further.`,
        };
    }

    const componentSelector: EditorComponentSelector = {
        packageId: selection.owner.packageId,
        componentResourceId: selection.owner.componentResourceId,
    };
    const makeOperations = (
        source: UamDisplayNodeLike[],
        target: UamDisplayNodeLike[],
        suffix: string,
    ) => {
        const sourceIndex = new Map(source.map((node, index) => [String(node.id || ""), index]));
        const targetIndex = new Map(target.map((node, index) => [String(node.id || ""), index]));
        const selected = source.filter((node) => selectedIds.has(String(node.id || "")));
        return [
            ...selected
                .sort((left, right) => (
                    sourceIndex.get(String(right.id || ""))! - sourceIndex.get(String(left.id || ""))!
                ))
                .map((node) => ({
                    opId: createOpId(`detach-depth-${suffix}`),
                    kind: "detachDisplayNode" as const,
                    selector: { ...componentSelector, displayNodeId: String(node.id || "") },
                })),
            ...selected
                .sort((left, right) => (
                    targetIndex.get(String(left.id || ""))! - targetIndex.get(String(right.id || ""))!
                ))
                .map((node) => ({
                    opId: createOpId(`attach-depth-${suffix}`),
                    kind: "attachDisplayNode" as const,
                    selector: componentSelector,
                    atIndex: targetIndex.get(String(node.id || ""))!,
                    node: cloneJson(node),
                })),
        ];
    };
    const operations = makeOperations(displayList, reordered, "forward");
    const inverseOperations = makeOperations(reordered, displayList, "undo");
    return {
        ok: true,
        transaction: {
            summary: `Move ${selection.entries.length} display node${selection.entries.length === 1 ? "" : "s"} ${direction}`,
            operation: operations[0],
            inverseOperation: inverseOperations[0],
            operations,
            inverseOperations,
        },
    };
}

export function prepareUpdateDisplayNodeRelations(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
    relationsValue: unknown,
): HighRiskTransactionPreparation {
    const component = findComponent(projectValue, selector);
    const node = findDisplayNode(projectValue, selector);
    if (!component || !node) return missingDisplayNode(selector);
    if (!node.kind || !SUPPORTED_ATTACHABLE_NODE_KINDS.has(node.kind)) {
        return {
            ok: false,
            code: "unsupported_relation_target_kind",
            message: `Relations are not editable on ${node.kind || "unknown"}.`,
        };
    }
    if (!Array.isArray(relationsValue)) {
        return { ok: false, code: "invalid_relations", message: "Relations must be an array." };
    }

    const knownTargets = new Set(
        (component.displayList || [])
            .map((candidate) => String(candidate.id || ""))
            .filter((id) => id && id !== selector.displayNodeId),
    );
    const seen = new Set<string>();
    const relations: DisplayNodeRelationModel["relations"] = [];
    for (const [index, value] of relationsValue.entries()) {
        if (!value || typeof value !== "object") {
            return { ok: false, code: "invalid_relation", message: `Relation ${index} must be an object.` };
        }
        const relation = value as { targetNodeId?: unknown; type?: unknown; usePercent?: unknown };
        if (typeof relation.targetNodeId !== "string") {
            return {
                ok: false,
                code: "invalid_relation_target",
                message: `Relation ${index} must define a string target node id.`,
            };
        }
        const targetNodeId = relation.targetNodeId;
        const type = relation.type;
        if (targetNodeId === selector.displayNodeId || (targetNodeId && !knownTargets.has(targetNodeId))) {
            return {
                ok: false,
                code: "invalid_relation_target",
                message: `Relation ${index} targets an unavailable display node.`,
            };
        }
        if (
            typeof type !== "number"
            || !Number.isInteger(type)
            || type < 0
            || type > 23
            || typeof relation.usePercent !== "boolean"
        ) {
            return {
                ok: false,
                code: "invalid_relation",
                message: `Relation ${index} must use type 0..23 and a boolean percent flag.`,
            };
        }
        const key = `${targetNodeId}\0${type}`;
        if (seen.has(key)) {
            return {
                ok: false,
                code: "duplicate_relation",
                message: `Relation ${index} duplicates target "${targetNodeId || "container"}" type ${type}.`,
            };
        }
        seen.add(key);
        relations.push({ targetNodeId, type, usePercent: relation.usePercent });
    }

    const previous = (node.relations || []).map((relation) => ({
        targetNodeId: String(relation.targetNodeId || ""),
        type: Number(relation.type),
        usePercent: Boolean(relation.usePercent),
    }));
    if (JSON.stringify(previous) === JSON.stringify(relations)) {
        return { ok: false, code: "relations_unchanged", message: "Relations did not change." };
    }

    const displayList = component.displayList || [];
    const atIndex = displayList.findIndex((candidate) => candidate.id === selector.displayNodeId);
    const updatedNode = cloneJson(node) as UamDisplayNodeLike;
    const originalNode = cloneJson(node);
    updatedNode.relations = relations;
    const detach = {
        opId: createOpId("replace-relations-detach"),
        kind: "detachDisplayNode" as const,
        selector,
    };
    const attach = {
        opId: createOpId("replace-relations-attach"),
        kind: "attachDisplayNode" as const,
        selector: {
            packageId: selector.packageId,
            componentResourceId: selector.componentResourceId,
        },
        atIndex,
        node: updatedNode,
    };
    const inverseDetach = {
        opId: createOpId("restore-relations-detach"),
        kind: "detachDisplayNode" as const,
        selector,
    };
    const inverseAttach = {
        opId: createOpId("restore-relations-attach"),
        kind: "attachDisplayNode" as const,
        selector: attach.selector,
        atIndex,
        node: originalNode,
    };
    return {
        ok: true,
        transaction: {
            summary: `Update ${node.name || selector.displayNodeId} relations`,
            operation: attach,
            inverseOperation: inverseAttach,
            operations: [detach, attach],
            inverseOperations: [inverseDetach, inverseAttach],
        },
    };
}
