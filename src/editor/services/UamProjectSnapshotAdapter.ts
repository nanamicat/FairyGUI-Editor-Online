import type {
    EditorProjectSnapshot,
    ProjectSnapshotComponent,
    ProjectSnapshotDisplayNode,
    ProjectSnapshotPackage,
    ProjectSnapshotResource,
    ProjectSnapshotResourceFolder,
    ProjectSnapshotSource,
    ProjectSnapshotTotals,
} from "../model/ProjectSnapshot";
import type {
    ComponentInstanceEditableProperties,
    ComponentCustomPropertyDefinition,
    ComponentCustomPropertyValue,
    ComponentControllerPageOverride,
    DisplayNodeBlendMode,
    GraphEditableProperties,
    GroupEditableProperties,
    ImageEditableProperties,
    ListEditableProperties,
    Loader3DEditableProperties,
    LoaderEditableProperties,
    MovieClipEditableProperties,
    TextInputEditableProperties,
    TreeEditableProperties,
} from "../model/EditorCommand";
import {
    readGraphProperties,
    readImageProperties,
    readListProperties,
    readMovieClipProperties,
    readTextInputProperties,
    readTextProperties,
} from "../commands/DisplayListReaders";
import type { UamDisplayNodeLike as AuthoringUamDisplayNodeLike } from "../commands/AuthoringTransactionSupport";

export interface UamProjectSnapshotSourceOptions {
    projectPath: string;
    openfairyguiVersion: string;
    reader: ProjectSnapshotSource["reader"];
}

interface UamProjectLike {
    projectId?: string;
    projectType?: number | string;
    version?: string;
    packages?: UamPackageLike[];
}

interface UamPackageLike {
    id?: string;
    name?: string;
    publish?: {
        name?: string;
    };
    folders?: UamResourceFolderLike[];
    resources?: UamResourceLike[];
}

interface UamResourceFolderLike {
    branch?: string;
    path?: string;
    favorite?: boolean;
    atlas?: string;
}

interface UamResourceLike {
    kind?: string;
    id?: string;
    name?: string;
    branch?: string;
    path?: string;
    exported?: boolean;
    favorite?: boolean;
    fileName?: string;
    file?: string;
    dimensions?: {
        width?: number;
        height?: number;
    };
    component?: UamComponentLike;
}

interface UamComponentLike {
    size?: {
        width?: number;
        height?: number;
    };
    displayList?: UamDisplayNodeLike[];
    controllers?: unknown[];
    transitions?: unknown[];
    properties?: {
        extensionType?: string;
        bgColor?: string;
        bgColorEnabled?: boolean;
        customProperties?: ComponentCustomPropertyDefinition[];
    };
}

interface UamDisplayNodeLike {
    kind?: string;
    id?: string;
    name?: string;
    position?: {
        x?: number;
        y?: number;
    };
    size?: {
        width?: number;
        height?: number;
    };
    locked?: boolean;
    aspect?: boolean;
    minSize?: { width?: number; height?: number };
    maxSize?: { width?: number; height?: number };
    scale?: { x?: number; y?: number };
    skew?: { x?: number; y?: number };
    visible?: boolean;
    touchable?: boolean;
    grayed?: boolean;
    alpha?: number;
    rotation?: number;
    tooltips?: string;
    blendMode?: string;
    filter?: string;
    filterData?: string;
    pivot?: {
        x?: number;
        y?: number;
    };
    pivotAsAnchor?: boolean;
    customData?: string;
    text?: string;
    font?: string;
    fontSize?: number;
    color?: string;
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
    group?: string;
    gears?: unknown[];
    relations?: unknown[];
    resource?: {
        packageId?: string;
        resourceId?: string;
    };
    instanceProperties?: unknown;
    customPropertyValues?: ComponentCustomPropertyValue[];
    controllerPageOverrides?: ComponentControllerPageOverride[];
}

export function createProjectSnapshotFromUamProject(
    projectValue: unknown,
    source: UamProjectSnapshotSourceOptions,
): EditorProjectSnapshot {
    const project = projectValue as UamProjectLike;
    const extensionTypes = new Map<string, string>();
    for (const pkg of project.packages || []) {
        for (const resource of pkg.resources || []) {
            const extensionType = resource.component?.properties?.extensionType;
            if (extensionType) {
                extensionTypes.set(`${pkg.id || ""}\0${resource.id || ""}`, extensionType);
            }
        }
    }
    const packages = (project.packages || []).map((pkg) => mapPackage(pkg, extensionTypes));
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        source: {
            projectPath: source.projectPath,
            openfairyguiVersion: source.openfairyguiVersion,
            reader: source.reader,
            uamLift: { ok: true },
        },
        project: {
            id: String(project.projectId || ""),
            type: project.projectType || "",
            version: String(project.version || ""),
        },
        totals: createTotals(packages),
        packages,
        diagnostics: [
            {
                severity: "info",
                code: "BROWSER_UAM_SNAPSHOT_CREATED",
                message:
                    "Editor snapshot was created in the browser from an OpenFairyGUI UAM project.",
            },
        ],
    };
}

function mapPackage(pkg: UamPackageLike, extensionTypes: Map<string, string>): ProjectSnapshotPackage {
    const resources = (pkg.resources || []).map((resource) => mapResource(resource));
    const components = (pkg.resources || [])
        .filter((resource) => Boolean(resource.component))
        .map((resource) => mapComponent(resource, String(pkg.id || ""), extensionTypes));
    const name = String(pkg.name || pkg.id || "");

    return {
        id: String(pkg.id || ""),
        name,
        publishName: String(pkg.publish?.name || name),
        folders: (pkg.folders || []).map(mapResourceFolder),
        resources,
        components,
    };
}

function mapResourceFolder(folder: UamResourceFolderLike): ProjectSnapshotResourceFolder {
    return {
        branch: String(folder.branch || ""),
        path: String(folder.path || "/"),
        favorite: folder.favorite === true,
        atlas: String(folder.atlas || ""),
    };
}

function mapResource(resource: UamResourceLike): ProjectSnapshotResource {
    const componentSize = resource.component?.size;
    const dimensions = resource.dimensions;
    return {
        id: String(resource.id || ""),
        name: String(resource.name || resource.id || ""),
        branch: String(resource.branch || ""),
        path: String(resource.path || "/"),
        type: mapResourceType(resource.kind),
        exported: resource.exported !== false,
        favorite: resource.favorite === true,
        fileName: String(resource.fileName || resource.file || ""),
        width: toNumber(componentSize?.width ?? dimensions?.width, 0),
        height: toNumber(componentSize?.height ?? dimensions?.height, 0),
    };
}

function mapComponent(
    resource: UamResourceLike,
    packageId: string,
    extensionTypes: Map<string, string>,
): ProjectSnapshotComponent {
    const component = resource.component;
    const children = (component?.displayList || []).map((node) => mapDisplayNode(node, packageId, extensionTypes));
    return {
        id: String(resource.id || ""),
        name: String(resource.name || resource.id || ""),
        path: String(resource.path || "/"),
        exported: resource.exported !== false,
        favorite: resource.favorite === true,
        width: toNumber(component?.size?.width, 0),
        height: toNumber(component?.size?.height, 0),
        childCount: children.length,
        controllerCount: component?.controllers?.length || 0,
        transitionCount: component?.transitions?.length || 0,
        bgColor: String(component?.properties?.bgColor || ""),
        bgColorEnabled: component?.properties?.bgColorEnabled === true,
        customProperties: (component?.properties?.customProperties || []).map((property) => ({ ...property })),
        children,
    };
}

function mapDisplayNode(
    node: UamDisplayNodeLike,
    packageId: string,
    extensionTypes: Map<string, string>,
): ProjectSnapshotDisplayNode {
    const uamNode = node as unknown as AuthoringUamDisplayNodeLike;
    const textProperties = readTextProperties(uamNode);
    const textInputProperties: TextInputEditableProperties | undefined = node.kind === "textInput"
        ? readTextInputProperties(uamNode)
        : undefined;
    const graphProperties: GraphEditableProperties | undefined = node.kind === "graph"
        ? readGraphProperties(uamNode)
        : undefined;
    const imageProperties: ImageEditableProperties | undefined = node.kind === "image"
        ? readImageProperties(uamNode)
        : undefined;
    const movieClipProperties: MovieClipEditableProperties | undefined = node.kind === "movieClip"
        ? readMovieClipProperties(uamNode)
        : undefined;
    const loaderProperties: LoaderEditableProperties | undefined = node.kind === "loader"
        ? {
            url: String(node.url || ""),
            fill: toNumber(node.fill, 0),
            shrinkOnly: node.shrinkOnly === true,
            autoSize: node.autoSize === true,
            useResize: node.useResize === true,
            align: toNumber(node.align, 0),
            vAlign: toNumber(node.vAlign, 0),
            frame: toNumber(node.frame, 0),
            playing: node.playing !== false,
            color: String(node.color || "#FFFFFF"),
            fillMethod: toNumber(node.fillMethod, 0),
            fillOrigin: toNumber(node.fillOrigin, 0),
            fillClockwise: node.fillClockwise !== false,
            fillAmount: toNumber(node.fillAmount, 100),
            clearOnPublish: node.clearOnPublish === true,
        }
        : undefined;
    const groupProperties: GroupEditableProperties | undefined = node.kind === "group"
        ? {
            layout: toNumber(node.layout, 0),
            lineGap: toNumber(node.lineGap, 0),
            columnGap: toNumber(node.columnGap, 0),
            advanced: node.advanced === true,
            excludeInvisibles: node.excludeInvisibles === true,
            autoSizeDisabled: node.autoSizeDisabled === true,
            mainGridIndex: toNumber(node.mainGridIndex, -1),
        }
        : undefined;
    const loader3DProperties: Loader3DEditableProperties | undefined = node.kind === "loader3D"
        ? {
            url: String(node.url || ""),
            fill: toNumber(node.fill, 0),
            shrinkOnly: node.shrinkOnly === true,
            autoSize: node.autoSize === true,
            align: toNumber(node.align, 0),
            vAlign: toNumber(node.vAlign, 0),
            animationName: String(node.animationName || ""),
            skinName: String(node.skinName || ""),
            playing: node.playing !== false,
            frame: toNumber(node.frame, 0),
            loop: node.loop !== false,
            color: String(node.color || "#FFFFFF"),
            clearOnPublish: node.clearOnPublish === true,
        }
        : undefined;
    const listProperties: ListEditableProperties | TreeEditableProperties | undefined = node.kind === "list" || node.kind === "tree"
        ? readListProperties(uamNode)
        : undefined;
    const targetPackageId = node.resource?.packageId || packageId;
    const inferredExtensionType = extensionTypes.get(
        `${targetPackageId}\0${node.resource?.resourceId || ""}`,
    );
    const componentInstanceProperties = node.kind === "component"
        ? mapComponentInstanceProperties(node.instanceProperties, inferredExtensionType)
        : undefined;
    return {
        id: String(node.id || ""),
        name: String(node.name || node.id || ""),
        type: mapDisplayNodeType(node.kind),
        x: toNumber(node.position?.x, 0),
        y: toNumber(node.position?.y, 0),
        width: toNumber(node.size?.width, 0),
        height: toNumber(node.size?.height, 0),
        locked: node.locked === true,
        aspect: node.aspect === true,
        minSize: {
            width: toNumber(node.minSize?.width, 0),
            height: toNumber(node.minSize?.height, 0),
        },
        maxSize: {
            width: toNumber(node.maxSize?.width, 0),
            height: toNumber(node.maxSize?.height, 0),
        },
        scale: {
            x: toNumber(node.scale?.x, 1),
            y: toNumber(node.scale?.y, 1),
        },
        skew: {
            x: toNumber(node.skew?.x, 0),
            y: toNumber(node.skew?.y, 0),
        },
        src: String(node.resource?.resourceId || ""),
        visible: node.visible !== false,
        touchable: node.touchable !== false,
        grayed: node.grayed === true,
        alpha: toNumber(node.alpha, 1),
        rotation: toNumber(node.rotation, 0),
        tooltips: String(node.tooltips || ""),
        blendMode: normalizeBlendMode(node.blendMode),
        filter: String(node.filter || ""),
        filterData: String(node.filterData || ""),
        pivotX: toNumber(node.pivot?.x, 0),
        pivotY: toNumber(node.pivot?.y, 0),
        pivotAsAnchor: node.pivotAsAnchor === true,
        customData: String(node.customData || ""),
        text: String(node.text || ""),
        font: String(node.font || ""),
        fontSize: toNumber(node.fontSize, 0),
        color: String(node.color || ""),
        textProperties,
        ...(imageProperties ? { imageProperties } : {}),
        ...(movieClipProperties ? { movieClipProperties } : {}),
        ...(textInputProperties ? { textInputProperties } : {}),
        ...(graphProperties ? { graphProperties } : {}),
        ...(groupProperties ? { groupProperties } : {}),
        ...(loaderProperties ? { loaderProperties } : {}),
        ...(loader3DProperties ? { loader3DProperties } : {}),
        ...(listProperties ? { listProperties } : {}),
        ...(componentInstanceProperties ? { componentInstanceProperties } : {}),
        ...(componentInstanceProperties
            ? { componentInstancePropertiesExplicit: Boolean(node.instanceProperties) }
            : {}),
        ...(node.kind === "component" && node.customPropertyValues?.length
            ? { componentCustomPropertyValues: node.customPropertyValues.map((property) => ({ ...property })) }
            : {}),
        ...(node.kind === "component"
            ? { componentCustomPropertyValuesExplicit: Boolean(node.customPropertyValues) }
            : {}),
        ...(node.kind === "component" && node.controllerPageOverrides?.length
            ? { componentControllerPageOverrides: node.controllerPageOverrides.map((override) => ({ ...override })) }
            : {}),
        ...(node.kind === "component"
            ? { componentControllerPageOverridesExplicit: Boolean(node.controllerPageOverrides) }
            : {}),
        group: String(node.group || ""),
        gearCount: node.gears?.length || 0,
        relationCount: node.relations?.length || 0,
    };
}

function mapComponentInstanceProperties(
    value: unknown,
    inferredExtensionType: string | undefined,
): ComponentInstanceEditableProperties | undefined {
    const source = value && typeof value === "object"
        ? value as Record<string, unknown>
        : {};
    const extensionType = String(source.extensionType || inferredExtensionType || "");
    switch (extensionType) {
        case "Button":
            return {
                extensionType,
                title: String(source.title || ""),
                selectedTitle: String(source.selectedTitle || ""),
                icon: String(source.icon || ""),
                selectedIcon: String(source.selectedIcon || ""),
                titleColor: String(source.titleColor || ""),
                titleFontSize: toNumber(source.titleFontSize, 0),
                controller: String(source.controller || ""),
                page: String(source.page || ""),
                checked: source.checked === true,
                sound: String(source.sound || ""),
                soundVolumeScale: toNumber(source.soundVolumeScale, 1),
            };
        case "Label":
            return {
                extensionType,
                title: String(source.title || ""),
                icon: String(source.icon || ""),
                titleColor: String(source.titleColor || ""),
                titleFontSize: toNumber(source.titleFontSize, 0),
                promptText: String(source.promptText || ""),
                sound: String(source.sound || ""),
                soundVolumeScale: toNumber(source.soundVolumeScale, 1),
            };
        case "ComboBox":
            return {
                extensionType,
                title: String(source.title || ""),
                icon: String(source.icon || ""),
                titleColor: String(source.titleColor || ""),
                popupDirection: toNumber(source.popupDirection, 0),
                sound: String(source.sound || ""),
                soundVolumeScale: toNumber(source.soundVolumeScale, 1),
                visibleItemCount: toNumber(source.visibleItemCount, 0),
                selectionController: String(source.selectionController || ""),
                autoClearItems: source.autoClearItems === true,
                items: Array.isArray(source.items)
                    ? source.items.map((item) => {
                        const typed = item as Record<string, unknown>;
                        return {
                            title: typed.title == null ? null : String(typed.title),
                            value: typed.value == null ? null : String(typed.value),
                            icon: typed.icon == null ? null : String(typed.icon),
                        };
                    })
                    : [],
            };
        case "ProgressBar":
            return {
                extensionType,
                value: toNumber(source.value, 0),
                max: toNumber(source.max, 100),
                min: toNumber(source.min, 0),
                sound: String(source.sound || ""),
                soundVolumeScale: toNumber(source.soundVolumeScale, 1),
            };
        case "Slider":
            return {
                extensionType,
                value: toNumber(source.value, 0),
                max: toNumber(source.max, 100),
                min: toNumber(source.min, 0),
            };
        case "ScrollBar":
            return { extensionType };
        default:
            return undefined;
    }
}

function createTotals(packages: ProjectSnapshotPackage[]): ProjectSnapshotTotals {
    const totals: ProjectSnapshotTotals = {
        packages: packages.length,
        images: 0,
        sounds: 0,
        fonts: 0,
        movieClips: 0,
        components: 0,
        displayObjects: 0,
        gears: 0,
        controllers: 0,
        transitions: 0,
    };

    for (const pkg of packages) {
        for (const resource of pkg.resources) {
            if (resource.type === "ImageResource") totals.images += 1;
            if (resource.type === "SoundResource") totals.sounds += 1;
            if (resource.type === "FontResource") totals.fonts += 1;
            if (resource.type === "MovieClipResource") totals.movieClips += 1;
        }
        totals.components += pkg.components.length;
        for (const component of pkg.components) {
            totals.displayObjects += component.children.length;
            totals.controllers += component.controllerCount;
            totals.transitions += component.transitionCount;
            for (const child of component.children) {
                totals.gears += child.gearCount;
            }
        }
    }

    return totals;
}

function mapResourceType(kind: string | undefined): string {
    if (kind === "component") return "Component";
    if (kind === "image") return "ImageResource";
    if (kind === "sound") return "SoundResource";
    if (kind === "font") return "FontResource";
    if (kind === "movieClip") return "MovieClipResource";
    if (!kind) return "Resource";
    return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}Resource`;
}

function mapDisplayNodeType(kind: string | undefined): string {
    switch (kind) {
        case "component":
            return "GComponent";
        case "graph":
            return "GGraph";
        case "image":
            return "GImage";
        case "text":
            return "GTextField";
        case "richText":
            return "GRichTextField";
        case "textInput":
            return "GTextInput";
        case "list":
            return "GList";
        case "loader":
            return "GLoader";
        case "group":
            return "GGroup";
        case "movieClip":
            return "GMovieClip";
        default:
            return kind ? `G${kind.charAt(0).toUpperCase()}${kind.slice(1)}` : "GObject";
    }
}

function toNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeBlendMode(value: unknown): DisplayNodeBlendMode {
    return value === "none"
        || value === "add"
        || value === "multiply"
        || value === "screen"
        || value === "erase"
        ? value
        : "normal";
}
