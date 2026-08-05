import type {
    ComponentEditableProperties,
    EditorComponentSelector,
    EditorDisplayNodeSelector,
    EditorHighRiskTransaction,
    EditorResourceSelector,
    GraphEditableProperties,
    ImageResourceEditableProps,
    ListEditableProperties,
    LoaderEditableProperties,
    TextEditableProperties,
    TextInputEditableProperties,
} from "../model/EditorCommand";
import type { HighRiskTransactionPreparation, DisplayNodeClipboard, DisplayNodeClipboardPreparation, BinaryFileInput, ControllerOption, TransitionOption, GearOption, ComponentInspection, DisplayNodeInspection } from "./AuthoringTransactionTypes";

export const SUPPORTED_ATTACHABLE_NODE_KINDS = new Set([
    "image",
    "text",
    "richText",
    "textInput",
    "component",
    "graph",
    "group",
    "list",
    "loader",
    "loader3D",
    "movieClip",
    "button",
    "label",
    "comboBox",
    "progressBar",
    "slider",
    "scrollBar",
    "tree",
]);

export const SUPPORTED_ASSET_KINDS = new Set(["image", "sound", "font", "movieClip"]);

export function createDefaultUamDisplayNodeBase() {
    return {
        locked: false,
        aspect: false,
        minSize: { width: 0, height: 0 },
        maxSize: { width: 0, height: 0 },
        scale: { x: 1, y: 1 },
        skew: { x: 0, y: 0 },
        visible: true,
        touchable: true,
        grayed: false,
        alpha: 1,
        rotation: 0,
        tooltips: "",
        blendMode: "normal",
        filter: "",
        filterData: "",
        customData: "",
        relations: [],
        gears: [],
    };
}

export const SUPPORTED_GEAR_KINDS = new Set([
    "display",
    "display2",
    "look",
    "xy",
    "size",
    "color",
    "animation",
    "text",
    "icon",
    "fontSize",
]);

export interface UamProjectLike {
    packages?: UamPackageLike[];
    branches?: string[];
    settings?: Record<string, unknown> & { common?: { fontSize?: number; textColor?: string } };
}

export interface UamPackageLike {
    id?: string;
    name?: string;
    folders?: UamResourceFolderLike[];
    resources?: UamResourceLike[];
    compressPNG?: boolean | null;
    jpegQuality?: number | null;
    publish?: unknown;
}

export interface UamResourceFolderLike {
    branch?: string;
    path?: string;
    favorite?: boolean;
    atlas?: string;
}

export interface UamResourceLike {
    id?: string;
    kind?: string;
    name?: string;
    path?: string;
    fileName?: string;
    file?: string;
    exported?: boolean;
    favorite?: boolean;
    branch?: string;
    branchItemIds?: string[];
    metadata?: unknown;
    sourceBytes?: Uint8Array;
    sourcePath?: string;
    dimensions?: { width?: number; height?: number };
    image?: ImageResourceEditableProps | null;
    movieClip?: {
        interval: number;
        repeatDelay: number;
        swing: boolean;
        smoothing: boolean;
        frames: Array<{
            rectX: number;
            rectY: number;
            rectWidth: number;
            rectHeight: number;
            addDelay: number;
            spriteId: string;
        }>;
    };
    component?: UamComponentLike;
}

export interface UamComponentLike {
    size?: { width?: number; height?: number };
    properties?: Partial<ComponentEditableProperties>;
    customData?: string;
    displayList?: UamDisplayNodeLike[];
    controllers?: UamControllerLike[];
    transitions?: UamTransitionLike[];
}

export interface UamDisplayNodeLike {
    id?: string;
    name?: string;
    kind?: string;
    resource?: { packageId?: string; resourceId?: string };
    instanceProperties?: unknown;
    customPropertyValues?: Array<{ target?: unknown; propertyId?: unknown; value?: unknown }>;
    controllerPageOverrides?: Array<{ controllerName?: unknown; pageId?: unknown }>;
    src?: string;
    packageId?: string;
    position?: { x?: number; y?: number };
    size?: { width?: number; height?: number };
    pivot?: { x?: number; y?: number };
    pivotAsAnchor?: boolean;
    scale?: { x?: number; y?: number };
    aspect?: boolean;
    visible?: boolean;
    alpha?: number;
    rotation?: number;
    grayed?: boolean;
    touchable?: boolean;
    customData?: string;
    locked?: boolean;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    skew?: { x?: number; y?: number };
    tooltips?: string;
    blendMode?: string;
    color?: string;
    outlineColor?: string | null;
    font?: string;
    frame?: number;
    playing?: boolean;
    animationName?: string;
    skinName?: string;
    loop?: boolean;
    text?: string;
    icon?: string;
    fontSize?: number;
    minSize?: { width?: number; height?: number };
    maxSize?: { width?: number; height?: number };
    leading?: number;
    letterSpacing?: number;
    singleLine?: boolean;
    autoClearText?: boolean;
    demoText?: string;
    templateVarsEnabled?: boolean;
    faceDilate?: number;
    underlaySoftness?: number;
    ubbEnabled?: boolean;
    underline?: boolean;
    italic?: boolean;
    bold?: boolean;
    strikethrough?: boolean;
    strokeColor?: string | null;
    strokeSize?: number;
    shadowColor?: string | null;
    shadowOffset?: Partial<TextEditableProperties["shadowOffset"]>;
    graphType?: number;
    lineSize?: number;
    lineColor?: string;
    fillColor?: string;
    cornerRadius?: GraphEditableProperties["cornerRadius"];
    points?: GraphEditableProperties["points"];
    sides?: number;
    startAngle?: number;
    distances?: GraphEditableProperties["distances"];
    url?: string;
    filter?: string;
    filterData?: string;
    fill?: number;
    shrinkOnly?: boolean;
    autoSize?: boolean | number;
    useResize?: boolean;
    align?: number;
    vAlign?: number;
    fillMethod?: number;
    fillOrigin?: number;
    fillClockwise?: boolean;
    fillAmount?: number;
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
    overflow?: number;
    scrollType?: number;
    scrollBarFlags?: number;
    scrollBarMargin?: Partial<ListEditableProperties["scrollBarMargin"]>;
    vtScrollBarRes?: string;
    hzScrollBarRes?: string;
    headerRes?: string;
    footerRes?: string;
    margin?: Partial<ListEditableProperties["margin"]>;
    clipSoftness?: Partial<ListEditableProperties["clipSoftness"]>;
    scrollItemToViewOnClick?: boolean;
    foldInvisibleItems?: boolean;
    autoClearItems?: boolean;
    listItems?: ListEditableProperties["listItems"];
    pageController?: string;
    controllerOverrides?: string;
    selectionController?: string;
    treeView?: boolean;
    indent?: number;
    clickToExpand?: number;
    advanced?: boolean;
    excludeInvisibles?: boolean;
    autoSizeDisabled?: boolean;
    mainGridIndex?: number;
    promptText?: string;
    maxLength?: number;
    restrict?: string;
    password?: boolean;
    keyboardType?: number;
    group?: string;
    relations?: UamRelationLike[];
    gears?: UamGearLike[];
}

export interface UamRelationLike {
    targetNodeId?: string;
    type?: number;
    usePercent?: boolean;
}

export interface UamControllerLike {
    name?: string;
    selectedIndex?: number;
    autoRadioGroupDepth?: boolean;
    alias?: string;
    exported?: boolean;
    homePageType?: "default" | "specific" | "branch" | "variable";
    homePage?: string;
    pages?: Array<{ id?: string; name?: string }>;
    actions?: Array<{
        name?: string;
        actionType?: number;
        fromPageIds?: string[];
        toPageIds?: string[];
        transitionName?: string;
        playTimes?: number;
        delay?: number;
        stopOnExit?: boolean;
        targetNodeId?: string;
        controllerName?: string;
        targetPage?: string;
    }>;
}

export interface UamTransitionLike {
    name?: string;
    autoPlay?: boolean;
    items?: UamTransitionItemLike[];
}

export interface UamTransitionItemLike {
    name?: string;
    targetNodeId?: string;
    actionType?: number;
    time?: number;
    duration?: number;
    tween?: boolean;
    startValue?: unknown[];
    endValue?: unknown[];
    easeType?: number;
    repeat?: number;
    yoyo?: boolean;
    label?: string;
    endLabel?: string;
    path?: string;
    customEasePath?: string;
}

export interface UamGearLike {
    kind?: string;
    name?: string;
    controllerName?: string;
    states?: unknown[];
    defaultValue?: unknown;
    condition?: string;
    positionsInPercent?: boolean;
    tween?: boolean;
    tweenDuration?: number;
    tweenDelay?: number;
    easeType?: number;
    customEasePath?: string;
    visibleOnPageIds?: string[];
}

export type NormalizedBinaryFileInput =
    | { ok: true; fileName: string; sourceBytes: Uint8Array }
    | { ok: false; code: string; message: string };

export function getHighRiskWorkingProject(projectValue: unknown): UamProjectLike | null {
    return projectValue && typeof projectValue === "object" ? projectValue as UamProjectLike : null;
}

export function findPackage(projectValue: unknown, packageId: string): UamPackageLike | null {
    return getHighRiskWorkingProject(projectValue)?.packages?.find((item) => item.id === packageId) || null;
}

export function findResource(projectValue: unknown, selector: EditorResourceSelector): UamResourceLike | null {
    const pkg = findPackage(projectValue, selector.packageId);
    return pkg?.resources?.find((item) => item.id === selector.resourceId) || null;
}

export function findComponent(projectValue: unknown, selector: EditorComponentSelector): UamComponentLike | null {
    return findResource(projectValue, {
        packageId: selector.packageId,
        resourceId: selector.componentResourceId,
    })?.component || null;
}

export function hasUnsupportedIncomingComponentReference(projectValue: unknown, selector: EditorComponentSelector): boolean {
    for (const pkg of getHighRiskWorkingProject(projectValue)?.packages || []) {
        if (!pkg.id) continue;
        for (const resource of pkg.resources || []) {
            if (resource.kind !== "component") continue;
            for (const node of resource.component?.displayList || []) {
                if (
                    referencesComponent(node, pkg.id, selector)
                    && !isRetargetableComponentReference(node, pkg.id, selector)
                ) {
                    return true;
                }
            }
        }
    }
    return false;
}

export function findComponentMoveReferenceRewrites(
    projectValue: unknown,
    selector: EditorComponentSelector,
    toPackageId: string,
): Array<{
    selector: EditorComponentSelector;
    inverseSelector: EditorComponentSelector;
    atIndex: number;
    node: UamDisplayNodeLike;
    rewrittenNode: UamDisplayNodeLike;
}> {
    const rewrites: Array<{
        selector: EditorComponentSelector;
        inverseSelector: EditorComponentSelector;
        atIndex: number;
        node: UamDisplayNodeLike;
        rewrittenNode: UamDisplayNodeLike;
    }> = [];
    for (const pkg of getHighRiskWorkingProject(projectValue)?.packages || []) {
        if (!pkg.id) continue;
        for (const resource of pkg.resources || []) {
            if (resource.kind !== "component" || !resource.id) continue;
            for (const [atIndex, node] of (resource.component?.displayList || []).entries()) {
                if (!isRetargetableComponentReference(node, pkg.id, selector)) continue;
                const nodeId = String(node.id || "");
                if (!nodeId) continue;
                const originalNode = cloneJson(node);
                const rewrittenNode = rewriteComponentReference(originalNode, toPackageId, selector.componentResourceId);
                rewrites.push({
                    selector: { packageId: pkg.id, componentResourceId: resource.id },
                    inverseSelector: {
                        packageId: pkg.id === selector.packageId && resource.id === selector.componentResourceId
                            ? toPackageId
                            : pkg.id,
                        componentResourceId: resource.id,
                    },
                    atIndex,
                    node: originalNode,
                    rewrittenNode,
                });
            }
        }
    }
    return rewrites;
}

export function referencesSourcePackage(node: UamDisplayNodeLike, packageId: string): boolean {
    return referencesPackage(node, packageId, packageId);
}

export function referencesPackage(
    node: UamDisplayNodeLike,
    ownerPackageId: string,
    packageId: string,
): boolean {
    return Boolean(node.resource?.resourceId && (node.resource.packageId || ownerPackageId) === packageId)
        || Boolean(node.src && (node.packageId || ownerPackageId) === packageId)
        || containsPackageResourceUri(node, packageId);
}

function containsPackageResourceUri(value: unknown, packageId: string): boolean {
    if (typeof value === "string") return value.includes(`ui://${packageId}`);
    if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return false;
    if (Array.isArray(value)) return value.some((item) => containsPackageResourceUri(item, packageId));
    return Object.values(value).some((item) => containsPackageResourceUri(item, packageId));
}

export function referencesComponent(node: UamDisplayNodeLike, ownerPackageId: string, selector: EditorComponentSelector): boolean {
    const reference = readComponentReference(node, ownerPackageId);
    return reference?.componentResourceId === selector.componentResourceId
        && reference.packageId === selector.packageId;
}

export function readComponentReference(
    node: UamDisplayNodeLike,
    ownerPackageId: string,
): EditorComponentSelector | null {
    if (node.kind === "component" && node.resource?.resourceId) {
        return {
            packageId: node.resource.packageId || ownerPackageId,
            componentResourceId: node.resource.resourceId,
        };
    }
    if (!node.src) return null;
    return {
        packageId: node.packageId || ownerPackageId,
        componentResourceId: node.src,
    };
}

export function rewriteComponentReference(
    node: UamDisplayNodeLike,
    packageId: string,
    componentResourceId: string,
): UamDisplayNodeLike {
    const rewritten = cloneJson(node);
    if (rewritten.kind === "component") {
        rewritten.resource = { ...rewritten.resource, packageId, resourceId: componentResourceId };
    } else {
        rewritten.packageId = packageId;
        rewritten.src = componentResourceId;
    }
    return rewritten;
}

export type DisplayDependencyCopyPlan =
    | {
        ok: true;
        nodes: UamDisplayNodeLike[];
        binaryDependencies: UamResourceLike[];
        componentDependencies: UamResourceLike[];
        componentProperties?: ComponentEditableProperties;
        transitions?: UamTransitionLike[];
    }
    | { ok: false; code: string; message: string };

export function copySourcePackageDisplayDependencies(
    projectValue: unknown,
    sourcePackageId: string,
    targetPackageId: string,
    nodes: UamDisplayNodeLike[],
    targetResources: UamResourceLike[],
    excludedComponent?: EditorComponentSelector,
    componentState?: {
        properties: ComponentEditableProperties;
        transitions: UamTransitionLike[];
    },
): DisplayDependencyCopyPlan {
    const occupiedTargetResources = [...targetResources];
    const dependencyCopies = new Map<string, UamResourceLike>();
    const binaryDependencies: UamResourceLike[] = [];
    const componentDependencies: UamResourceLike[] = [];
    const sourceResources = findPackage(projectValue, sourcePackageId)?.resources || [];
    const uriResources = sourceResources.filter((resource) => resource.id);
    let failure: { code: string; message: string } | null = null;

    function fail(code: string, message: string): null {
        failure ||= { code, message };
        return null;
    }

    function rewriteResourceUris<T>(value: T): T {
        if (typeof value === "string") {
            const rewritten = String(value);
            const resource = uriResources.find((candidate) =>
                rewritten === `ui://${sourcePackageId}${candidate.id}`,
            );
            if (resource) {
                const copied = excludedComponent
                    && resource.kind === "component"
                    && resource.id === excludedComponent.componentResourceId
                    ? resource
                    : copyDependency(String(resource.id), String(resource.kind || ""));
                if (!copied) return rewritten as T;
                return `ui://${targetPackageId}${copied.id}` as T;
            }
            if (rewritten.includes(`ui://${sourcePackageId}`)) {
                fail(
                    "component_dependency_not_found",
                    `A ui://${sourcePackageId} dependency does not match a source-package resource.`,
                );
            }
            return value;
        }
        if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
        if (Array.isArray(value)) {
            for (const [index, item] of value.entries()) value[index] = rewriteResourceUris(item);
            return value;
        }
        const record = value as Record<string, unknown>;
        for (const [key, item] of Object.entries(record)) record[key] = rewriteResourceUris(item);
        return value;
    }

    function rewriteNode(node: UamDisplayNodeLike): UamDisplayNodeLike | null {
        if (!referencesSourcePackage(node, sourcePackageId)) return cloneJson(node);
        const componentReference = readComponentReference(node, sourcePackageId);
        let rewritten = cloneJson(node);
        if (componentReference?.packageId === sourcePackageId) {
            if (
                excludedComponent
                && componentReference.componentResourceId === excludedComponent.componentResourceId
                && componentReference.packageId === excludedComponent.packageId
            ) {
                return rewriteResourceUris(rewriteComponentReference(
                    rewritten,
                    targetPackageId,
                    excludedComponent.componentResourceId,
                ));
            }
            const copiedComponent = copyDependency(componentReference.componentResourceId, "component");
            if (!copiedComponent) return null;
            rewritten = rewriteComponentReference(node, targetPackageId, String(copiedComponent.id || ""));
        } else if (node.resource?.resourceId || node.src) {
            const dependencyId = String(node.resource?.resourceId || "");
            if (!dependencyId || (node.kind !== "image" && node.kind !== "movieClip")) {
                return fail(
                    "component_has_package_dependencies",
                    "Cross-package copy supports component, derived-control, image, MovieClip, font and sound display dependencies; other dependency shapes remain closed.",
                );
            }
            const copiedAsset = copyDependency(dependencyId, node.kind);
            if (!copiedAsset) return null;
            rewritten.resource = {
                ...rewritten.resource,
                packageId: targetPackageId,
                resourceId: copiedAsset.id,
            };
        }
        return rewriteResourceUris(rewritten);
    }

    function copyDependency(
        dependencyId: string,
        expectedKind: string,
    ): UamResourceLike | null {
        if (expectedKind !== "component" && !SUPPORTED_ASSET_KINDS.has(expectedKind)) {
            return fail(
                "component_dependency_kind_unsupported",
                `Dependency ${dependencyId} has unsupported kind ${expectedKind || "unknown"}.`,
            );
        }
        const existing = dependencyCopies.get(dependencyId);
        if (existing) {
            return existing.kind === expectedKind
                ? existing
                : fail("component_dependency_kind_mismatch", `Dependency ${dependencyId} does not match ${expectedKind}.`);
        }
        const dependency = findResource(projectValue, {
            packageId: sourcePackageId,
            resourceId: dependencyId,
        });
        if (!dependency) {
            return fail("component_dependency_not_found", `Dependency ${dependencyId} was not found in the source package.`);
        }
        if (dependency.kind !== expectedKind) {
            return fail(
                "component_dependency_kind_mismatch",
                `Dependency ${dependency.name || dependency.id || dependencyId} is ${dependency.kind || "unknown"}, not ${expectedKind}.`,
            );
        }

        if (dependency.kind === "component") {
            if (!dependency.component) {
                return fail("component_dependency_not_found", `Component dependency ${dependencyId} has no component model.`);
            }
            const copy = cloneJson(dependency);
            copy.id = createCopyId(occupiedTargetResources, `${dependency.id || "component"}_dependency`);
            copy.name = createCopyName(
                occupiedTargetResources,
                `${dependency.name || dependency.id || "Component"}_dependency`,
            );
            dependencyCopies.set(dependencyId, copy);
            componentDependencies.push(copy);
            occupiedTargetResources.push(copy);
            copy.component!.displayList = (dependency.component.displayList || [])
                .map((child) => rewriteNode(child) || cloneJson(child));
            rewriteResourceUris(copy);
            copy.branchItemIds = (dependency.branchItemIds || []).map((branchItemId) => {
                if (!branchItemId) return branchItemId;
                return String(copyDependency(branchItemId, "component")?.id || branchItemId);
            });
            return copy;
        }

        if (!(dependency.sourceBytes instanceof Uint8Array)) {
            return fail(
                "component_dependency_bytes_unavailable",
                `Dependency ${dependency.name || dependency.id || dependencyId} has no hydrated source bytes.`,
            );
        }
        const sourceFileName = String(dependency.fileName || dependency.file || "");
        if (!sourceFileName) {
            return fail(
                "component_dependency_file_unavailable",
                `Dependency ${dependency.name || dependency.id || dependencyId} has no source file name.`,
            );
        }
        const identity = createBinaryResourceIdentity(occupiedTargetResources, sourceFileName);
        const copy = createAddResourceSnapshot(dependency);
        copy.id = createCopyId(occupiedTargetResources, `${dependency.id || dependency.kind || "asset"}_dependency`);
        copy.name = identity.name;
        copy.fileName = identity.fileName;
        copy.path = `/imported/${dependency.kind}/`;
        copy.sourceBytes = new Uint8Array(dependency.sourceBytes);
        dependencyCopies.set(dependencyId, copy);
        occupiedTargetResources.push(copy);
        if (dependency.kind === "sound" && !dependency.fileName) {
            delete copy.fileName;
            copy.file = identity.fileName;
        }
        if (dependency.kind === "font") {
            const metadata = copy.metadata as { textureId?: unknown } | null | undefined;
            const textureId = String(metadata?.textureId || "");
            if (textureId) {
                const copiedTexture = copyDependency(textureId, "image");
                if (!copiedTexture) return null;
                copy.metadata = { ...metadata, textureId: copiedTexture.id };
            }
        }
        copy.branchItemIds = (dependency.branchItemIds || []).map((branchItemId) => {
            if (!branchItemId) return branchItemId;
            return String(copyDependency(branchItemId, expectedKind)?.id || branchItemId);
        });
        binaryDependencies.push(copy);
        return copy;
    }

    const rewrittenNodes = nodes.map((node) => rewriteNode(node) || cloneJson(node));
    const componentProperties = componentState
        ? rewriteResourceUris(cloneJson(componentState.properties))
        : undefined;
    const transitions = componentState
        ? rewriteResourceUris(cloneJson(componentState.transitions))
        : undefined;
    const dependencyFailure = failure as { code: string; message: string } | null;
    return dependencyFailure
        ? { ok: false, code: dependencyFailure.code, message: dependencyFailure.message }
        : {
            ok: true,
            nodes: rewrittenNodes,
            binaryDependencies,
            componentDependencies,
            componentProperties,
            transitions,
        };
}

export function isRetargetableComponentReference(
    node: UamDisplayNodeLike,
    ownerPackageId: string,
    selector: EditorComponentSelector,
): boolean {
    return referencesComponent(node, ownerPackageId, selector);
}

export function findDisplayNode(projectValue: unknown, selector: EditorDisplayNodeSelector): UamDisplayNodeLike | null {
    return findComponent(projectValue, selector)?.displayList?.find((item) => item.id === selector.displayNodeId) || null;
}

export function findNamedController(component: UamComponentLike | null, name: string): UamControllerLike | null {
    const normalizedName = name.trim();
    return normalizedName
        ? component?.controllers?.find((item) => item.name === normalizedName) || null
        : null;
}

export function findNamedTransition(component: UamComponentLike | null, name: string): UamTransitionLike | null {
    const normalizedName = name.trim();
    return normalizedName
        ? component?.transitions?.find((item) => item.name === normalizedName) || null
        : null;
}

export function findNamedGear(node: UamDisplayNodeLike | null, kind: string, controllerName: string): UamGearLike | null {
    const normalizedName = controllerName.trim();
    return normalizedName
        ? node?.gears?.find((item) => item.kind === kind && item.controllerName === normalizedName) || null
        : null;
}

export function normalizeResourcePath(value: string): string | null {
    const trimmed = value.trim().replaceAll("\\", "/");
    if (!trimmed.startsWith("/")) return null;
    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export function normalizeBinaryFileInput(input: BinaryFileInput): NormalizedBinaryFileInput {
    const segments = String(input?.fileName || "").trim().replaceAll("\\", "/").split("/").filter(Boolean);
    const fileName = segments[segments.length - 1]?.trim() || "";
    if (!fileName || fileName === "." || fileName === "..") {
        return { ok: false, code: "invalid_binary_file_name", message: "Choose a file with a valid file name." };
    }
    if (!(input?.sourceBytes instanceof Uint8Array)) {
        return { ok: false, code: "invalid_binary_file_bytes", message: "Selected file bytes are unavailable." };
    }
    return { ok: true, fileName, sourceBytes: input.sourceBytes };
}

export function createBinaryResourceIdentity(
    resources: UamResourceLike[],
    selectedFileName: string,
): { name: string; fileName: string } {
    const extensionIndex = selectedFileName.lastIndexOf(".");
    const baseName = extensionIndex > 0 ? selectedFileName.slice(0, extensionIndex) : selectedFileName;
    const extension = extensionIndex > 0 ? selectedFileName.slice(extensionIndex) : "";
    const normalizedNames = new Set(resources.map((resource) => String(resource.name || "").toLowerCase()));
    const normalizedFileNames = new Set(resources.map((resource) =>
        String(resource.fileName || resource.file || "").toLowerCase(),
    ));
    let suffix = 1;
    let name = baseName;
    let fileName = selectedFileName;
    while (normalizedNames.has(name.toLowerCase()) || normalizedFileNames.has(fileName.toLowerCase())) {
        suffix += 1;
        name = `${baseName}-${suffix}`;
        fileName = `${baseName}-${suffix}${extension}`;
    }
    return { name, fileName };
}

export function createCopyId(values: Array<{ id?: string }>, base: string): string {
    const ids = new Set(values.map((value) => value.id));
    let suffix = 1;
    let candidate = `${base}_copy`;
    while (ids.has(candidate)) {
        suffix += 1;
        candidate = `${base}_copy${suffix}`;
    }
    return candidate;
}

export function createDisplayNodeCopy(
    node: UamDisplayNodeLike,
    existingNodes: UamDisplayNodeLike[],
): UamDisplayNodeLike {
    const copy = cloneJson(node);
    copy.id = createCopyId(existingNodes, String(node.id || "node"));
    copy.name = createCopyName(existingNodes, String(node.name || node.id || "node"));
    if (copy.position) {
        copy.position = {
            x: Number(copy.position.x || 0) + 10,
            y: Number(copy.position.y || 0) + 10,
        };
    }
    return copy;
}

export function createAssetCopy(resource: UamResourceLike, resources: UamResourceLike[]): UamResourceLike {
    const copy = createAddResourceSnapshot(resource);
    const id = createCopyId(resources, `${resource.id || resource.kind || "asset"}_copy`);
    const name = createCopyName(resources, `${resource.name || resource.id || resource.kind || "asset"}_copy`);
    const originalFileName = String(resource.fileName || resource.file || "");
    const extensionIndex = originalFileName.lastIndexOf(".");
    const extension = extensionIndex > 0 ? originalFileName.slice(extensionIndex) : "";
    copy.id = id;
    copy.name = name;
    copy.path = `/imported/${resource.kind || "asset"}/`;
    if (copy.fileName || resource.kind === "image" || resource.kind === "font" || resource.kind === "movieClip") {
        copy.fileName = `${name}${extension}`;
    } else {
        copy.file = `${name}${extension}`;
    }
    copy.sourceBytes = new Uint8Array(resource.sourceBytes || []);
    return copy;
}

export function createAddResourceSnapshot(resource: UamResourceLike): UamResourceLike {
    const snapshot = cloneJson(resource);
    delete snapshot.sourcePath;
    snapshot.favorite ??= false;
    if (snapshot.kind === "image" && snapshot.image) snapshot.image.quality ??= 80;
    return snapshot;
}

export function findGearTemplate(projectValue: unknown, kind: string): UamGearLike | null {
    for (const pkg of getHighRiskWorkingProject(projectValue)?.packages || []) {
        for (const resource of pkg.resources || []) {
            for (const node of resource.component?.displayList || []) {
                const gear = node.gears?.find((item) => item.kind === kind);
                if (gear) return gear;
            }
        }
    }
    return null;
}

export function createGearForController(template: UamGearLike, controller: UamControllerLike): UamGearLike {
    const page = controller.pages?.[0];
    const gear = cloneJson(template);
    const state = Array.isArray(gear.states) ? gear.states[0] as { value?: unknown } | undefined : undefined;
    gear.name = "";
    gear.controllerName = controller.name;
    if (gear.kind === "display" || gear.kind === "display2") {
        gear.visibleOnPageIds = page?.id ? [page.id] : [];
        return gear;
    }
    gear.states = page?.id ? [{ pageId: page.id, value: cloneJson(state?.value ?? gear.defaultValue) }] : [];
    return gear;
}

export function createXyGear(
    controllerName: string,
    pages: Array<{ id?: string }>,
    node: UamDisplayNodeLike,
    x: number,
    y: number,
): Record<string, unknown> {
    const value = { x: Number(node.position?.x || 0), y: Number(node.position?.y || 0) };
    return {
        kind: "xy",
        name: "",
        controllerName,
        states: pages.slice(0, 1).map((page) => ({ pageId: page.id, value: { x, y } })),
        defaultValue: value,
        condition: "",
        positionsInPercent: false,
        tween: false,
        tweenDuration: 0.3,
        tweenDelay: 0,
        easeType: 5,
        customEasePath: "",
    };
}

export function readFirstPageId(gear: UamGearLike): string {
    const firstState = Array.isArray(gear.states) ? gear.states[0] as { pageId?: string } | undefined : undefined;
    return String(firstState?.pageId || "");
}

export function readFirstXyValue(gear: UamGearLike, node: UamDisplayNodeLike): { x: number; y: number } {
    const firstState = Array.isArray(gear.states) ? gear.states[0] as { value?: unknown } | undefined : undefined;
    const value = firstState?.value && typeof firstState.value === "object"
        ? firstState.value as { x?: unknown; y?: unknown }
        : null;
    const fallbackX = Number(node.position?.x || 0);
    const fallbackY = Number(node.position?.y || 0);
    const x = Number(value?.x);
    const y = Number(value?.y);
    return { x: Number.isFinite(x) ? x : fallbackX, y: Number.isFinite(y) ? y : fallbackY };
}

export function createCopyName(values: Array<{ name?: string }>, base: string): string {
    const names = new Set(values.map((value) => value.name));
    let suffix = 1;
    let candidate = `${base}_copy`;
    while (names.has(candidate)) {
        suffix += 1;
        candidate = `${base}_copy${suffix}`;
    }
    return candidate;
}

export function createLookGear(
    controllerName: string,
    pages: Array<{ id?: string }>,
): Record<string, unknown> {
    const value = { alpha: 1, rotation: 0, grayed: false, touchable: true };
    return {
        kind: "look",
        name: "",
        controllerName,
        states: pages.map((page) => ({ pageId: page.id, value: { ...value } })),
        defaultValue: value,
        condition: "",
        positionsInPercent: false,
        tween: false,
        tweenDuration: 0,
        tweenDelay: 0,
        easeType: 0,
        customEasePath: "",
    };
}

export function createOpId(kind: string): string {
    return `editor-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function cloneJson<T>(value: T): T {
    return structuredClone(value) as T;
}

export function cloneModel(value: unknown): unknown | null {
    return value && typeof value === "object" ? cloneJson(value) : null;
}

export function missingResource(selector: EditorResourceSelector): HighRiskTransactionPreparation {
    return {
        ok: false,
        code: "resource_not_found",
        message: `Resource ${selector.resourceId} is not present in the current UAM working project.`,
    };
}

export function missingDisplayNode(
    selector: EditorDisplayNodeSelector,
): Extract<HighRiskTransactionPreparation, { ok: false }> {
    return {
        ok: false,
        code: "display_node_not_found",
        message: `Display node ${selector.displayNodeId} is not present in the current UAM working project.`,
    };
}
