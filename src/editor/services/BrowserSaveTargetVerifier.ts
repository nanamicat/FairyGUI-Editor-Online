import type { EditorCommandNodeState, EditorCommandOperation } from "../model/EditorCommand";
import type { BrowserSaveTarget } from "../model/BrowserWorkspace";
import type { UamDisplayNodeLike } from "../commands/AuthoringTransactionSupport";
import {
    readCommonDisplayProperties,
    readGraphProperties,
    readGroupProperties,
    readImageProperties,
    readListProperties,
    readMovieClipProperties,
    readTextInputProperties,
    readTextProperties,
} from "../commands/DisplayListReaders";

function cloneJson<T>(value: T): T {
    return structuredClone(value);
}

function findDisplayNode(project: unknown, selector: { packageId: string; componentResourceId: string; displayNodeId: string }): unknown {
    const candidate = project as {
        packages?: Array<{
            id?: string;
            resources?: Array<{
                id?: string;
                component?: {
                    displayList?: unknown[];
                };
            }>;
        }>;
    };
    const pkg = candidate.packages?.find((item) => item.id === selector.packageId);
    const resource = pkg?.resources?.find((item) => item.id === selector.componentResourceId);
    return resource?.component?.displayList?.find((item) => {
        const node = item as { id?: string };
        return node.id === selector.displayNodeId;
    }) ?? null;
}

export function createDisplayNodeSaveTarget(
    project: unknown,
    selector: Extract<BrowserSaveTarget, { kind: "displayNode" }>["selector"],
): Extract<BrowserSaveTarget, { kind: "displayNode" }> | null {
    const node = findDisplayNode(project, selector);
    return node ? { kind: "displayNode", selector, expected: summarizeNode(node) } : null;
}

export function verifySaveTarget(
    project: unknown,
    target: BrowserSaveTarget,
) {
    return target.kind === "displayNode"
        ? verifyDisplayNodeTarget(project, target)
        : target.kind === "transaction"
            ? verifyTransactionTarget(project, target)
            : verifyTransactionBatchTarget(project, target);
}

interface TransactionTargetState {
    entity: "projectSettings" | "packageSettings" | "branches" | "package" | "component" | "resource" | "resourceFolder" | "resourceBytes" | "imageResource" | "displayNode" | "controller" | "transition" | "gear";
    exists: boolean;
    value?: unknown;
}

export function createTransactionSaveTarget(
    project: unknown,
    operations: EditorCommandOperation[],
): BrowserSaveTarget | null {
    const mixedTransaction = operations.some((operation) => operation.kind !== "setDisplayNodeProps");
    const targets = operations.flatMap((operation) => {
        if (operation.kind === "setDisplayNodeProps" && !mixedTransaction) return [];
        const expected = getTransactionTargetState(project, operation);
        return expected ? [{ operation, expected }] : [];
    });
    if (targets.length === 0) return null;
    if (targets.length > 1) {
        return {
            kind: "transactionBatch",
            operations: targets.map(({ operation }) => cloneJson(operation)),
            expected: targets.map(({ expected }) => expected),
            description: `transaction batch (${targets.length} operations; final ${describeTransactionOperation(targets[targets.length - 1].operation)})`,
        };
    }
    const [{ operation, expected }] = targets;
    return {
        kind: "transaction",
        operation: cloneJson(operation),
        expected,
        description: describeTransactionOperation(operation),
    };
}

function verifyDisplayNodeTarget(
    project: unknown,
    target: Extract<BrowserSaveTarget, { kind: "displayNode" }>,
): { ok: boolean; reloaded: ReturnType<typeof summarizeNode> | undefined; message: string } {
    const node = findDisplayNode(project, target.selector);
    if (!node) {
        return {
            ok: false,
            reloaded: undefined,
            message: "Reloaded project does not contain the selected display node.",
        };
    }
    const reloaded = summarizeNode(node);
    const ok = nodeStatesMatch(reloaded, target.expected);
    return {
        ok,
        reloaded,
        message: ok
            ? "Reloaded browser workspace state matches the selected display node."
            : "Reloaded browser workspace state does not match the selected display node.",
    };
}

function verifyTransactionTarget(
    project: unknown,
    target: Extract<BrowserSaveTarget, { kind: "transaction" }>,
): { ok: boolean; reloaded: TransactionTargetState | undefined; message: string } {
    const expected = target.expected as TransactionTargetState;
    const reloaded = getTransactionTargetState(project, target.operation);
    const ok = transactionStatesMatch(reloaded, expected);
    return {
        ok,
        reloaded: reloaded || undefined,
        message: ok
            ? `Reloaded browser workspace state matches ${target.description}.`
            : `Reloaded browser workspace state does not match ${target.description}.`,
    };
}

function verifyTransactionBatchTarget(
    project: unknown,
    target: Extract<BrowserSaveTarget, { kind: "transactionBatch" }>,
): { ok: boolean; reloaded: Array<TransactionTargetState | null>; message: string } {
    const expected = target.expected as TransactionTargetState[];
    const reloaded = target.operations.map((operation) => getTransactionTargetState(project, operation));
    const ok = reloaded.length === expected.length
        && reloaded.every((state, index) => transactionStatesMatch(state, expected[index]));
    return {
        ok,
        reloaded,
        message: ok
            ? `Reloaded browser workspace state matches all ${target.operations.length} transaction batch operations.`
            : "Reloaded browser workspace state does not match the transaction batch.",
    };
}

function transactionStatesMatch(
    reloaded: TransactionTargetState | null,
    expected: TransactionTargetState,
): boolean {
    return reloaded !== null
        && reloaded.entity === expected.entity
        && reloaded.exists === expected.exists
        && stableJson(reloaded.value) === stableJson(expected.value);
}

function getTransactionTargetState(
    project: unknown,
    operation: EditorCommandOperation,
): TransactionTargetState | null {
    switch (operation.kind) {
        case "updateProjectSettings": {
            const candidate = project as { settings?: unknown };
            return { entity: "projectSettings", exists: Boolean(candidate.settings), value: cloneJson(candidate.settings) };
        }
        case "updatePackageSettings": {
            const pkg = findPackage(project, operation.selector.packageId);
            return {
                entity: "packageSettings",
                exists: Boolean(pkg),
                value: pkg ? cloneJson({
                    compressPNG: pkg.compressPNG ?? null,
                    jpegQuality: pkg.jpegQuality ?? null,
                    publish: pkg.publish ?? null,
                }) : undefined,
            };
        }
        case "addBranch":
        case "renameBranch":
        case "removeBranch": {
            const candidate = project as { branches?: string[] };
            return { entity: "branches", exists: Array.isArray(candidate.branches), value: cloneJson(candidate.branches || []) };
        }
        case "addPackage": {
            const packageId = readPackageId(operation.package);
            const pkg = packageId ? findPackage(project, packageId) : null;
            return {
                entity: "package",
                exists: Boolean(pkg),
                value: pkg ? summarizePackage(pkg) : undefined,
            };
        }
        case "renamePackage":
        case "removePackage": {
            const pkg = findPackage(project, operation.selector.packageId);
            return {
                entity: "package",
                exists: Boolean(pkg),
                value: pkg ? summarizePackage(pkg) : undefined,
            };
        }
        case "addComponent": {
            const componentId = readResourceId(operation.component);
            const component = componentId ? findResource(project, {
                packageId: operation.selector.packageId,
                resourceId: componentId,
            }) : null;
            return {
                entity: "component",
                exists: Boolean(component),
                value: component
                    ? summarizeResourcePlacement(project, operation.selector.packageId, component)
                    : undefined,
            };
        }
        case "setComponentProps": {
            const component = findComponent(project, operation.selector);
            return {
                entity: "component",
                exists: Boolean(component),
                value: component ? {
                    size: cloneJson(component.size),
                    properties: cloneJson(component.properties),
                } : undefined,
            };
        }
        case "moveComponent": {
            const component = findResource(project, {
                packageId: operation.toPackageId,
                resourceId: operation.selector.componentResourceId,
            });
            return {
                entity: "component",
                exists: Boolean(component),
                value: component
                    ? summarizeResourcePlacement(project, operation.toPackageId, component)
                    : undefined,
            };
        }
        case "removeComponent": {
            const component = findResource(project, {
                packageId: operation.selector.packageId,
                resourceId: operation.selector.componentResourceId,
            });
            return {
                entity: "component",
                exists: Boolean(component),
                value: component ? summarizeResource(component) : undefined,
            };
        }
        case "renameResource":
        case "moveResource": {
            const resource = findResource(project, operation.selector);
            return {
                entity: "resource",
                exists: Boolean(resource),
                value: resource ? {
                    id: String(resource.id || ""),
                    kind: String(resource.kind || ""),
                    name: String(resource.name || ""),
                    path: String(resource.path || "/"),
                } : undefined,
            };
        }
        case "setResourceFavorite":
        case "setResourceExported": {
            const resource = findResource(project, operation.selector);
            return {
                entity: "resource",
                exists: Boolean(resource),
                value: resource ? {
                    id: String(resource.id || ""),
                    favorite: resource.favorite === true,
                    exported: resource.exported !== false,
                } : undefined,
            };
        }
        case "setResourceFolderFavorite":
        case "addResourceFolder":
        case "renameResourceFolder":
        case "moveResourceFolder":
        case "removeResourceFolder": {
            const selector = getResourceFolderTargetSelector(operation);
            const folder = findResourceFolder(project, selector);
            return {
                entity: "resourceFolder",
                exists: Boolean(folder),
                value: folder ? {
                    branch: String(folder.branch || ""),
                    path: String(folder.path || ""),
                    favorite: folder.favorite === true,
                    atlas: String(folder.atlas || ""),
                } : undefined,
            };
        }
        case "addResource": {
            const resourceId = readResourceId(operation.resource);
            const resource = resourceId ? findResource(project, { packageId: operation.selector.packageId, resourceId }) : null;
            return {
                entity: "resource",
                exists: Boolean(resource),
                value: resource
                    ? summarizeResourcePlacement(project, operation.selector.packageId, resource)
                    : undefined,
            };
        }
        case "setImageResourceProps": {
            const resource = findResource(project, operation.selector);
            return {
                entity: "imageResource",
                exists: Boolean(resource),
                value: resource ? cloneJson(resource.image || null) : undefined,
            };
        }
        case "replaceResourceBytes": {
            const resource = findResource(project, operation.selector);
            return {
                entity: "resourceBytes",
                exists: Boolean(resource),
                value: resource ? summarizeResourceBytes(resource) : undefined,
            };
        }
        case "removeResource": {
            const resource = findResource(project, operation.selector);
            return {
                entity: "resource",
                exists: Boolean(resource),
                value: resource ? summarizeResource(resource) : undefined,
            };
        }
        case "attachDisplayNode": {
            const nodeId = readNodeId(operation.node);
            const displayList = findComponent(project, operation.selector)?.displayList as Array<Record<string, unknown>> | undefined;
            const index = nodeId ? displayList?.findIndex((node) => node.id === nodeId) ?? -1 : -1;
            const node = index >= 0 ? displayList?.[index] || null : null;
            return {
                entity: "displayNode",
                exists: Boolean(node),
                value: node ? {
                    id: String((node as { id?: string }).id || ""),
                    index,
                    resource: summarizeNodeResourceReference(node, operation.selector.packageId),
                    relations: summarizeNodeRelations(node),
                } : undefined,
            };
        }
        case "detachDisplayNode": {
            const node = findDisplayNode(project, operation.selector);
            return {
                entity: "displayNode",
                exists: Boolean(node),
                value: node ? { id: String((node as { id?: string }).id || "") } : undefined,
            };
        }
        case "addController":
        case "updateController":
        case "removeController": {
            const controller = findController(project, operation.selector);
            return {
                entity: "controller",
                exists: Boolean(controller),
                value: controller ? normalizeControllerForComparison(controller) : undefined,
            };
        }
        case "addTransition":
        case "updateTransition":
        case "removeTransition": {
            const transition = findTransition(project, operation.selector);
            return {
                entity: "transition",
                exists: Boolean(transition),
                value: transition ? cloneJson(transition) : undefined,
            };
        }
        case "addLookGear":
        case "updateLookGear":
        case "removeLookGear":
        case "addGear":
        case "updateGear":
        case "removeGear": {
            const gear = findGear(project, operation.selector);
            return {
                entity: "gear",
                exists: Boolean(gear),
                value: gear ? normalizeGearForComparison(gear) : undefined,
            };
        }
        case "setDisplayNodeProps": {
            const node = findDisplayNode(project, operation.selector) as Record<string, unknown> | null;
            return {
                entity: "displayNode",
                exists: Boolean(node),
                value: node ? Object.fromEntries(
                    Object.keys(operation.props).map((key) => [
                        key,
                        cloneJson(node[
                            key === "componentInstanceProperties"
                                ? "instanceProperties"
                                : key === "componentCustomPropertyValues"
                                    ? "customPropertyValues"
                                    : key === "componentControllerPageOverrides"
                                        ? "controllerPageOverrides"
                                        : key
                        ]),
                    ]),
                ) : undefined,
            };
        }
    }
}

function summarizeResource(resource: Record<string, unknown>): unknown {
    return {
        id: String(resource.id || ""),
        kind: String(resource.kind || ""),
        name: String(resource.name || ""),
        path: String(resource.path || "/"),
        fileName: String(resource.fileName || resource.file || ""),
        exported: resource.exported === true,
        favorite: resource.favorite === true,
        branch: String(resource.branch || ""),
        branchItemIds: Array.isArray(resource.branchItemIds) ? [...resource.branchItemIds] : [],
        dimensions: resource.dimensions || null,
        metadata: resource.metadata || null,
        image: resource.image || null,
        movieClip: resource.movieClip || null,
    };
}

function summarizeNodeResourceReference(node: unknown, ownerPackageId: string): unknown {
    const resource = (node as { resource?: { packageId?: unknown; resourceId?: unknown } }).resource;
    if (!resource || typeof resource.resourceId !== "string") return undefined;
    const packageId = typeof resource.packageId === "string" ? resource.packageId : "";
    return {
        packageId: !packageId || packageId === ownerPackageId ? undefined : packageId,
        resourceId: resource.resourceId,
    };
}

function summarizeNodeRelations(node: unknown): unknown {
    const relations = (node as {
        relations?: Array<{ targetNodeId?: unknown; type?: unknown; usePercent?: unknown }>;
    }).relations;
    return Array.isArray(relations) ? relations.map((relation) => ({
        targetNodeId: String(relation.targetNodeId || ""),
        type: Number(relation.type),
        usePercent: relation.usePercent === true,
    })) : [];
}

function summarizePackage(pkg: Record<string, unknown>): unknown {
    return summarizePersistentValue(pkg, String(pkg.id || ""));
}

function summarizeResourcePlacement(
    project: unknown,
    packageId: string,
    resource: Record<string, unknown>,
): unknown {
    const pkg = findPackage(project, packageId);
    const resources = Array.isArray(pkg?.resources) ? pkg.resources as Array<Record<string, unknown>> : [];
    return {
        index: resources.findIndex((candidate) => candidate.id === resource.id),
        resource: summarizePersistentValue(resource, packageId),
    };
}

function summarizePersistentValue(value: unknown, ownerPackageId: string): unknown {
    if (value instanceof Uint8Array) {
        let hash = 0xcbf29ce484222325n;
        for (const byte of value) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
        return { byteLength: value.byteLength, fnv1a64: hash.toString(16).padStart(16, "0") };
    }
    if (Array.isArray(value)) return value.map((item) => summarizePersistentValue(item, ownerPackageId));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([childKey]) => childKey !== "sourcePath" && childKey !== "binaryData")
        .filter(([, item]) => item !== null && item !== undefined)
        .filter(([childKey, item]) => childKey !== "packageId" || (item !== "" && item !== undefined && item !== ownerPackageId))
        .map(([childKey, item]) => [childKey, summarizePersistentValue(item, ownerPackageId)]));
}

function summarizeResourceBytes(resource: Record<string, unknown>): unknown {
    const bytes = resource.sourceBytes;
    return {
        ...summarizeResource(resource) as Record<string, unknown>,
        bytes: bytes instanceof Uint8Array
            ? summarizePersistentValue(bytes, "")
            : { byteLength: 0, fnv1a64: "0000000000000000" },
    };
}

function readResourceId(value: unknown): string {
    return String((value as { id?: unknown } | null)?.id || "");
}

function readPackageId(value: unknown): string {
    return String((value as { id?: unknown } | null)?.id || "");
}

function findPackage(project: unknown, packageId: string): Record<string, unknown> | null {
    const candidate = project as { packages?: Array<Record<string, unknown>> };
    return candidate.packages?.find((item) => item.id === packageId) || null;
}

function findResource(
    project: unknown,
    selector: { packageId: string; resourceId: string },
): Record<string, unknown> | null {
    const candidate = project as {
        packages?: Array<{ id?: string; resources?: Array<Record<string, unknown>> }>;
    };
    const pkg = candidate.packages?.find((item) => item.id === selector.packageId);
    return pkg?.resources?.find((item) => item.id === selector.resourceId) || null;
}

function findResourceFolder(
    project: unknown,
    selector: { packageId: string; branch?: string; path: string },
): Record<string, unknown> | null {
    const pkg = findPackage(project, selector.packageId);
    const folders = Array.isArray(pkg?.folders) ? pkg.folders as Array<Record<string, unknown>> : [];
    return folders.find((folder) => (
        String(folder.branch || "") === (selector.branch || "")
        && folder.path === selector.path
    )) || null;
}

function getResourceFolderTargetSelector(
    operation: Extract<EditorCommandOperation, {
        kind: "setResourceFolderFavorite" | "addResourceFolder" | "renameResourceFolder" | "moveResourceFolder" | "removeResourceFolder";
    }>,
): { packageId: string; branch?: string; path: string } {
    if (operation.kind === "addResourceFolder") {
        return { packageId: operation.selector.packageId, branch: operation.branch, path: operation.path };
    }
    if (operation.kind === "renameResourceFolder") {
        return {
            packageId: operation.selector.packageId,
            branch: operation.selector.branch,
            path: `${resourceFolderParentPath(operation.selector.path)}${operation.newName}/`,
        };
    }
    if (operation.kind === "moveResourceFolder") {
        return {
            packageId: operation.selector.packageId,
            branch: operation.selector.branch,
            path: `${operation.toPath}${resourceFolderName(operation.selector.path)}/`,
        };
    }
    return operation.selector;
}

function resourceFolderParentPath(path: string): string {
    const segments = path.split("/").filter(Boolean);
    segments.pop();
    return segments.length ? `/${segments.join("/")}/` : "/";
}

function resourceFolderName(path: string): string {
    return path.split("/").filter(Boolean).pop() || "";
}

function findComponent(
    project: unknown,
    selector: { packageId: string; componentResourceId: string },
): Record<string, unknown> | null {
    const resource = findResource(project, {
        packageId: selector.packageId,
        resourceId: selector.componentResourceId,
    });
    return (resource?.component as Record<string, unknown> | undefined) || null;
}

function findController(
    project: unknown,
    selector: { packageId: string; componentResourceId: string; controllerName: string },
): Record<string, unknown> | null {
    const controllers = findComponent(project, selector)?.controllers as Array<Record<string, unknown>> | undefined;
    return controllers?.find((item) => item.name === selector.controllerName) || null;
}

function findTransition(
    project: unknown,
    selector: { packageId: string; componentResourceId: string; transitionName: string },
): Record<string, unknown> | null {
    const transitions = findComponent(project, selector)?.transitions as Array<Record<string, unknown>> | undefined;
    return transitions?.find((item) => item.name === selector.transitionName) || null;
}

function findGear(
    project: unknown,
    selector: { packageId: string; componentResourceId: string; displayNodeId: string; controllerName: string; kind?: string },
): Record<string, unknown> | null {
    const gears = findDisplayNode(project, selector) as { gears?: Array<Record<string, unknown>> } | null;
    return gears?.gears?.find((item) =>
        item.kind === (selector.kind || "look") && item.controllerName === selector.controllerName,
    ) || null;
}

function normalizeGearForComparison(gear: Record<string, unknown>): unknown {
    const value = cloneJson(gear) as Record<string, unknown>;
    delete value.name;
    if (value.tween !== true) {
        delete value.tweenDuration;
        delete value.tweenDelay;
        delete value.easeType;
        delete value.customEasePath;
    }
    return value;
}

function normalizeControllerForComparison(controller: Record<string, unknown>): unknown {
    const value = cloneJson(controller) as {
        actions?: Array<Record<string, unknown>>;
    };
    for (const action of value.actions || []) delete action.name;
    return value;
}

function readNodeId(value: unknown): string {
    return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
        ? value.id
        : "";
}

function describeTransactionOperation(operation: EditorCommandOperation): string {
    switch (operation.kind) {
        case "updateProjectSettings": return "project settings update";
        case "updatePackageSettings": return `package settings update ${operation.selector.packageId}`;
        case "addBranch": return `branch add ${operation.branch}`;
        case "renameBranch": return `branch rename ${operation.selector.branch}`;
        case "removeBranch": return `branch remove ${operation.selector.branch}`;
        case "addPackage": return `package add ${readPackageId(operation.package)}`;
        case "renamePackage": return `package rename ${operation.selector.packageId}`;
        case "removePackage": return `package remove ${operation.selector.packageId}`;
        case "addComponent": return `component add ${readResourceId(operation.component)}`;
        case "setComponentProps": return `component props ${operation.selector.componentResourceId}`;
        case "moveComponent": return `component move ${operation.selector.componentResourceId}`;
        case "removeComponent": return `component remove ${operation.selector.componentResourceId}`;
        case "renameResource": return `resource rename ${operation.selector.resourceId}`;
        case "moveResource": return `resource move ${operation.selector.resourceId}`;
        case "setResourceFavorite": return `resource favorite ${operation.selector.resourceId}`;
        case "setResourceFolderFavorite": return `resource folder favorite ${operation.selector.path}`;
        case "setResourceExported": return `resource exported ${operation.selector.resourceId}`;
        case "addResourceFolder": return `resource folder add ${operation.path}`;
        case "renameResourceFolder": return `resource folder rename ${operation.selector.path}`;
        case "moveResourceFolder": return `resource folder move ${operation.selector.path}`;
        case "removeResourceFolder": return `resource folder remove ${operation.selector.path}`;
        case "addResource": return `resource add ${readResourceId(operation.resource)}`;
        case "setImageResourceProps": return `image props ${operation.selector.resourceId}`;
        case "replaceResourceBytes": return `resource bytes replace ${operation.selector.resourceId}`;
        case "removeResource": return `resource remove ${operation.selector.resourceId}`;
        case "attachDisplayNode": return `display-node attach ${readNodeId(operation.node)}`;
        case "detachDisplayNode": return `display-node detach ${operation.selector.displayNodeId}`;
        case "addController": return `controller add ${operation.selector.controllerName}`;
        case "updateController": return `controller update ${operation.selector.controllerName}`;
        case "removeController": return `controller remove ${operation.selector.controllerName}`;
        case "addTransition": return `transition add ${operation.selector.transitionName}`;
        case "updateTransition": return `transition update ${operation.selector.transitionName}`;
        case "removeTransition": return `transition remove ${operation.selector.transitionName}`;
        case "addLookGear": return `look gear add ${operation.selector.controllerName}`;
        case "updateLookGear": return `look gear update ${operation.selector.controllerName}`;
        case "removeLookGear": return `look gear remove ${operation.selector.controllerName}`;
        case "addGear": return `${operation.selector.kind} gear add ${operation.selector.controllerName}`;
        case "updateGear": return `${operation.selector.kind} gear update ${operation.selector.controllerName}`;
        case "removeGear": return `${operation.selector.kind} gear remove ${operation.selector.controllerName}`;
        case "setDisplayNodeProps": return `display-node props ${operation.selector.displayNodeId}`;
    }
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
    if (!value || typeof value !== "object") return JSON.stringify(value) || "undefined";
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function summarizeNode(node: unknown): EditorCommandNodeState {
    const value = node as {
        id?: string;
        name?: string;
        kind?: string;
        position?: { x?: number; y?: number };
        size?: { width?: number; height?: number };
        text?: string;
        visible?: boolean;
        touchable?: boolean;
        grayed?: boolean;
        alpha?: number;
        rotation?: number;
        pivot?: { x?: number; y?: number };
        pivotAsAnchor?: boolean;
        font?: string;
        fontSize?: number;
        color?: string;
        graphType?: number;
        lineSize?: number;
        lineColor?: string;
        fillColor?: string;
        cornerRadius?: unknown;
        points?: unknown;
        sides?: number;
        startAngle?: number;
        distances?: unknown;
        scale?: { x?: number; y?: number };
        url?: string;
        filter?: string;
        filterData?: string;
        fill?: number;
        shrinkOnly?: boolean;
        autoSize?: boolean;
        useResize?: boolean;
        align?: number;
        vAlign?: number;
        frame?: number;
        playing?: boolean;
        animationName?: string;
        skinName?: string;
        loop?: boolean;
        fillMethod?: number;
        fillOrigin?: number;
        fillClockwise?: boolean;
        fillAmount?: number;
        flip?: number;
        clearOnPublish?: boolean;
        layout?: number;
        lineGap?: number;
        columnGap?: number;
        lineCount?: number;
        columnCount?: number;
        selectionMode?: number;
        defaultItem?: string;
        autoResizeItem?: boolean;
        childrenRenderOrder?: number;
        apexIndex?: number;
        src?: string;
        overflow?: number;
        scrollType?: number;
        scrollBarDisplay?: number;
        scrollBarFlags?: number;
        scrollBarMargin?: { top?: number; bottom?: number; left?: number; right?: number };
        vtScrollBarRes?: string;
        hzScrollBarRes?: string;
        headerRes?: string;
        footerRes?: string;
        margin?: { top?: number; bottom?: number; left?: number; right?: number };
        clipSoftness?: { x?: number; y?: number };
        scrollItemToViewOnClick?: boolean;
        foldInvisibleItems?: boolean;
        listItems?: Array<Record<string, unknown>>;
        pageController?: string;
        controllerOverrides?: string;
        selectionController?: string;
        treeView?: boolean;
        indent?: number;
        clickToExpand?: number;
        instanceProperties?: unknown;
        customPropertyValues?: unknown[];
        controllerPageOverrides?: unknown[];
        group?: string;
        customData?: string;
    };
    const uamNode = value as UamDisplayNodeLike;
    return {
        id: String(value.id ?? ""),
        name: String(value.name ?? value.id ?? ""),
        type: String(value.kind ?? ""),
        x: Number(value.position?.x ?? 0),
        y: Number(value.position?.y ?? 0),
        width: Number(value.size?.width ?? 0),
        height: Number(value.size?.height ?? 0),
        ...readCommonDisplayProperties(uamNode),
        text: String(value.text ?? ""),
        visible: value.visible !== false,
        touchable: value.touchable !== false,
        grayed: value.grayed === true,
        alpha: Number(value.alpha ?? 1),
        rotation: Number(value.rotation ?? 0),
        pivotX: Number(value.pivot?.x ?? 0),
        pivotY: Number(value.pivot?.y ?? 0),
        pivotAsAnchor: value.pivotAsAnchor === true,
        customData: String(value.customData ?? ""),
        font: String(value.font ?? ""),
        fontSize: Number(value.fontSize ?? 0),
        color: String(value.color ?? ""),
        ...(value.kind === "image"
            ? { imageProperties: readImageProperties(uamNode) }
            : {}),
        ...(value.kind === "movieClip"
            ? { movieClipProperties: readMovieClipProperties(uamNode) }
            : {}),
        textProperties: readTextProperties(uamNode),
        ...(value.kind === "textInput"
            ? { textInputProperties: readTextInputProperties(uamNode) }
            : {}),
        ...(value.kind === "graph"
            ? {
                graphProperties: readGraphProperties(uamNode),
            }
            : {}),
        ...(value.kind === "group"
            ? { groupProperties: readGroupProperties(uamNode) }
            : {}),
        ...(value.kind === "loader"
            ? {
                loaderProperties: {
                    url: String(value.url ?? ""),
                    fill: Number(value.fill ?? 0),
                    shrinkOnly: value.shrinkOnly === true,
                    autoSize: value.autoSize === true,
                    useResize: value.useResize === true,
                    align: Number(value.align ?? 0),
                    vAlign: Number(value.vAlign ?? 0),
                    frame: Number(value.frame ?? 0),
                    playing: value.playing !== false,
                    color: String(value.color ?? "#FFFFFF"),
                    fillMethod: Number(value.fillMethod ?? 0),
                    fillOrigin: Number(value.fillOrigin ?? 0),
                    fillClockwise: value.fillClockwise !== false,
                    fillAmount: Number(value.fillAmount ?? 100),
                    clearOnPublish: value.clearOnPublish === true,
                } as EditorCommandNodeState["loaderProperties"],
            }
            : {}),
        ...(value.kind === "loader3D"
            ? {
                loader3DProperties: {
                    url: String(value.url ?? ""),
                    fill: Number(value.fill ?? 0),
                    shrinkOnly: value.shrinkOnly === true,
                    autoSize: value.autoSize === true,
                    align: Number(value.align ?? 0),
                    vAlign: Number(value.vAlign ?? 0),
                    animationName: String(value.animationName ?? ""),
                    skinName: String(value.skinName ?? ""),
                    playing: value.playing !== false,
                    frame: Number(value.frame ?? 0),
                    loop: value.loop !== false,
                    color: String(value.color ?? "#FFFFFF"),
                    clearOnPublish: value.clearOnPublish === true,
                } as EditorCommandNodeState["loader3DProperties"],
            }
            : {}),
        ...(value.kind === "list" || value.kind === "tree"
            ? {
                listProperties: readListProperties(uamNode),
            }
            : {}),
        ...(value.kind === "component" && value.instanceProperties
            ? {
                componentInstanceProperties: cloneJson(
                    value.instanceProperties,
                ) as EditorCommandNodeState["componentInstanceProperties"],
                componentInstancePropertiesExplicit: true,
            }
            : {}),
        ...(value.kind === "component" && Array.isArray(value.customPropertyValues)
            ? {
                componentCustomPropertyValues: cloneJson(
                    value.customPropertyValues,
                ) as EditorCommandNodeState["componentCustomPropertyValues"],
                componentCustomPropertyValuesExplicit: true,
            }
            : {}),
        ...(value.kind === "component" && Array.isArray(value.controllerPageOverrides)
            ? {
                componentControllerPageOverrides: cloneJson(
                    value.controllerPageOverrides,
                ) as EditorCommandNodeState["componentControllerPageOverrides"],
                componentControllerPageOverridesExplicit: true,
            }
            : {}),
        group: String(value.group ?? ""),
    };
}

function nodeStatesMatch(
    actual: EditorCommandNodeState,
    expected: EditorCommandNodeState,
): boolean {
    return (
        actual.x === expected.x &&
        actual.y === expected.y &&
        actual.width === expected.width &&
        actual.height === expected.height &&
        actual.locked === expected.locked &&
        actual.aspect === expected.aspect &&
        stableJson(actual.minSize) === stableJson(expected.minSize) &&
        stableJson(actual.maxSize) === stableJson(expected.maxSize) &&
        stableJson(actual.scale) === stableJson(expected.scale) &&
        stableJson(actual.skew) === stableJson(expected.skew) &&
        actual.text === expected.text &&
        actual.visible === expected.visible &&
        actual.touchable === expected.touchable &&
        actual.grayed === expected.grayed &&
        actual.alpha === expected.alpha &&
        actual.rotation === expected.rotation &&
        actual.tooltips === expected.tooltips &&
        actual.blendMode === expected.blendMode &&
        actual.filter === expected.filter &&
        actual.filterData === expected.filterData &&
        actual.pivotX === expected.pivotX &&
        actual.pivotY === expected.pivotY &&
        actual.pivotAsAnchor === expected.pivotAsAnchor &&
        actual.customData === expected.customData &&
        actual.font === expected.font &&
        actual.fontSize === expected.fontSize &&
        actual.color === expected.color &&
        stableJson(actual.imageProperties) === stableJson(expected.imageProperties) &&
        stableJson(actual.movieClipProperties) === stableJson(expected.movieClipProperties) &&
        stableJson(actual.textProperties) === stableJson(expected.textProperties) &&
        stableJson(actual.textInputProperties) === stableJson(expected.textInputProperties) &&
        stableJson(actual.graphProperties) === stableJson(expected.graphProperties) &&
        stableJson(actual.groupProperties) === stableJson(expected.groupProperties) &&
        stableJson(actual.loaderProperties) === stableJson(expected.loaderProperties) &&
        stableJson(actual.loader3DProperties) === stableJson(expected.loader3DProperties) &&
        stableJson(actual.listProperties) === stableJson(expected.listProperties) &&
        stableJson(actual.componentInstanceProperties) === stableJson(expected.componentInstanceProperties) &&
        stableJson(actual.componentCustomPropertyValues) === stableJson(expected.componentCustomPropertyValues) &&
        stableJson(actual.componentControllerPageOverrides) === stableJson(expected.componentControllerPageOverrides) &&
        actual.group === expected.group
    );
}
