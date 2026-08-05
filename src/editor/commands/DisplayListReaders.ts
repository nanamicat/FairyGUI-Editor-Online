import type {
    DisplayNodeBlendMode,
    DisplayNodeCommonEditableProperties,
    EditorComponentSelector,
    EditorDisplayNodeSelector,
    GraphEditableProperties,
    GroupEditableProperties,
    ListEditableProperties,
    Loader3DEditableProperties,
    LoaderEditableProperties,
    TextEditableProperties,
    TextInputEditableProperties,
    TreeEditableProperties,
} from "../model/EditorCommand";
import type {
    ComponentInspection,
    DisplayNodeInspection,
    DisplayNodeRelationModel,
} from "./AuthoringTransactionTypes";
import {
    SUPPORTED_ATTACHABLE_NODE_KINDS,
    type UamDisplayNodeLike,
    findComponent,
    findDisplayNode,
    readFirstXyValue,
} from "./AuthoringTransactionSupport";

export function readTextProperties(node: UamDisplayNodeLike): TextEditableProperties {
    return {
        align: Number(node.align || 0),
        vAlign: Number(node.vAlign || 0),
        leading: Number(node.leading ?? 3),
        letterSpacing: Number(node.letterSpacing || 0),
        autoSize: Number(node.autoSize ?? 1),
        singleLine: Boolean(node.singleLine),
        autoClearText: Boolean(node.autoClearText),
        ...(node.kind !== "richText" ? {
            demoText: String(node.demoText || ""),
            templateVarsEnabled: Boolean(node.templateVarsEnabled),
            faceDilate: Number(node.faceDilate || 0),
        } : {}),
        underlaySoftness: Number(node.underlaySoftness || 0),
        ubbEnabled: Boolean(node.ubbEnabled),
        underline: Boolean(node.underline),
        italic: Boolean(node.italic),
        bold: Boolean(node.bold),
        strikethrough: Boolean(node.strikethrough),
        strokeColor: node.strokeColor == null ? null : String(node.strokeColor),
        strokeSize: Number(node.strokeSize ?? 1),
        shadowColor: node.shadowColor == null ? null : String(node.shadowColor),
        shadowOffset: {
            x: Number(node.shadowOffset?.x || 0),
            y: Number(node.shadowOffset?.y || 0),
        },
    };
}

export function readTextInputProperties(node: UamDisplayNodeLike): TextInputEditableProperties {
    return {
        promptText: String(node.promptText ?? ""),
        maxLength: Number(node.maxLength ?? 0),
        restrict: String(node.restrict ?? ""),
        password: Boolean(node.password),
        keyboardType: Number(node.keyboardType ?? 0),
    };
}

export function readGraphProperties(node: UamDisplayNodeLike): GraphEditableProperties {
    return {
        graphType: Number(node.graphType || 0),
        lineSize: Number(node.lineSize ?? 1),
        lineColor: String(node.lineColor || "#000000"),
        fillColor: String(node.fillColor || "#FFFFFF"),
        cornerRadius: node.cornerRadius ? [...node.cornerRadius] : null,
        points: node.points ? [...node.points] : null,
        sides: Number(node.sides || 0),
        startAngle: Number(node.startAngle || 0),
        distances: node.distances ? [...node.distances] : null,
    };
}

export function readLoaderProperties(node: UamDisplayNodeLike): LoaderEditableProperties {
    return {
        url: String(node.url || ""),
        fill: Number(node.fill || 0),
        shrinkOnly: Boolean(node.shrinkOnly),
        autoSize: Boolean(node.autoSize),
        useResize: Boolean(node.useResize),
        align: Number(node.align || 0),
        vAlign: Number(node.vAlign || 0),
        frame: Number(node.frame || 0),
        playing: node.playing !== false,
        color: String(node.color || "#FFFFFF"),
        fillMethod: Number(node.fillMethod || 0),
        fillOrigin: Number(node.fillOrigin || 0),
        fillClockwise: node.fillClockwise !== false,
        fillAmount: Number(node.fillAmount ?? 100),
        clearOnPublish: Boolean(node.clearOnPublish),
    };
}

export function readCommonDisplayProperties(node: UamDisplayNodeLike): DisplayNodeCommonEditableProperties {
    return {
        locked: node.locked === true,
        aspect: node.aspect === true,
        minSize: {
            width: Number(node.minSize?.width || node.minWidth || 0),
            height: Number(node.minSize?.height || node.minHeight || 0),
        },
        maxSize: {
            width: Number(node.maxSize?.width || node.maxWidth || 0),
            height: Number(node.maxSize?.height || node.maxHeight || 0),
        },
        scale: {
            x: Number(node.scale?.x ?? 1),
            y: Number(node.scale?.y ?? 1),
        },
        skew: {
            x: Number(node.skew?.x || 0),
            y: Number(node.skew?.y || 0),
        },
        tooltips: String(node.tooltips || ""),
        blendMode: normalizeBlendMode(node.blendMode),
        filter: String(node.filter || ""),
        filterData: String(node.filterData || ""),
    };
}

export function readGroupProperties(node: UamDisplayNodeLike): GroupEditableProperties {
    return {
        layout: Number(node.layout || 0),
        lineGap: Number(node.lineGap || 0),
        columnGap: Number(node.columnGap || 0),
        advanced: node.advanced === true,
        excludeInvisibles: node.excludeInvisibles === true,
        autoSizeDisabled: node.autoSizeDisabled === true,
        mainGridIndex: Number(node.mainGridIndex ?? -1),
    };
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

export function readLoader3DProperties(node: UamDisplayNodeLike): Loader3DEditableProperties {
    return {
        url: String(node.url || ""),
        fill: Number(node.fill || 0),
        shrinkOnly: Boolean(node.shrinkOnly),
        autoSize: Boolean(node.autoSize),
        align: Number(node.align || 0),
        vAlign: Number(node.vAlign || 0),
        animationName: String(node.animationName || ""),
        skinName: String(node.skinName || ""),
        playing: node.playing !== false,
        frame: Number(node.frame || 0),
        loop: node.loop !== false,
        color: String(node.color || "#FFFFFF"),
        clearOnPublish: Boolean(node.clearOnPublish),
    };
}

export function readListProperties(node: UamDisplayNodeLike): ListEditableProperties | TreeEditableProperties {
    const properties: ListEditableProperties = {
        layout: Number(node.layout || 0),
        align: Number(node.align || 0),
        vAlign: Number(node.vAlign || 0),
        lineGap: Number(node.lineGap || 0),
        columnGap: Number(node.columnGap || 0),
        lineCount: Number(node.lineCount || 0),
        columnCount: Number(node.columnCount || 0),
        selectionMode: Number(node.selectionMode || 0),
        defaultItem: String(node.defaultItem || ""),
        autoResizeItem: node.autoResizeItem !== false,
        childrenRenderOrder: Number(node.childrenRenderOrder || 0),
        apexIndex: Number(node.apexIndex || 0),
        src: String(node.src || ""),
        overflow: Number(node.overflow || 0),
        scrollType: Number(node.scrollType ?? 1),
        scrollBarFlags: Number(node.scrollBarFlags || 0),
        scrollBarMargin: {
            top: Number(node.scrollBarMargin?.top || 0),
            bottom: Number(node.scrollBarMargin?.bottom || 0),
            left: Number(node.scrollBarMargin?.left || 0),
            right: Number(node.scrollBarMargin?.right || 0),
        },
        vtScrollBarRes: String(node.vtScrollBarRes || ""),
        hzScrollBarRes: String(node.hzScrollBarRes || ""),
        headerRes: String(node.headerRes || ""),
        footerRes: String(node.footerRes || ""),
        margin: {
            top: Number(node.margin?.top || 0),
            bottom: Number(node.margin?.bottom || 0),
            left: Number(node.margin?.left || 0),
            right: Number(node.margin?.right || 0),
        },
        clipSoftness: {
            x: Number(node.clipSoftness?.x || 0),
            y: Number(node.clipSoftness?.y || 0),
        },
        scrollItemToViewOnClick: node.scrollItemToViewOnClick !== false,
        foldInvisibleItems: Boolean(node.foldInvisibleItems),
        autoClearItems: Boolean(node.autoClearItems),
        listItems: (node.listItems || []).map((item) => ({
            ...item,
            controllers: item.controllers ?? null,
        })),
        pageController: String(node.pageController || ""),
        controllerOverrides: String(node.controllerOverrides || ""),
        selectionController: String(node.selectionController || ""),
    };
    return node.kind === "tree"
        ? {
            ...properties,
            treeView: node.treeView !== false,
            indent: Number(node.indent || 0),
            clickToExpand: Number(node.clickToExpand || 0),
        }
        : properties;
}

export function inspectComponent(
    projectValue: unknown,
    selector: EditorComponentSelector,
): ComponentInspection | null {
    const component = findComponent(projectValue, selector);
    if (!component) return null;
    return {
        controllers: (component.controllers || []).flatMap((controller) => controller.name ? [{
            name: controller.name,
            selectedIndex: Number(controller.selectedIndex || 0),
            pageCount: controller.pages?.length || 0,
        }] : []),
        transitions: (component.transitions || []).flatMap((transition) => transition.name ? [{
            name: transition.name,
            autoPlay: Boolean(transition.autoPlay),
        }] : []),
    };
}

export function inspectDisplayNode(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
): DisplayNodeInspection | null {
    const component = findComponent(projectValue, selector);
    const node = findDisplayNode(projectValue, selector);
    if (!component || !node) return null;
    return {
        nodeKind: String(node.kind || "unknown"),
        index: component.displayList?.findIndex((item) => item.id === selector.displayNodeId) ?? -1,
        duplicateEnabled: Boolean(node.kind && SUPPORTED_ATTACHABLE_NODE_KINDS.has(node.kind)),
        relationCount: node.relations?.length || 0,
        controllers: (component.controllers || []).flatMap((controller) => controller.name ? [{
            name: controller.name,
            selectedIndex: Number(controller.selectedIndex || 0),
            pageCount: controller.pages?.length || 0,
        }] : []),
        lookGears: (node.gears || []).flatMap((gear) => gear.kind === "look" && gear.controllerName ? [{
            kind: "look",
            controllerName: gear.controllerName,
            tween: Boolean(gear.tween),
        }] : []),
        xyGears: (node.gears || []).flatMap((gear) => {
            if (gear.kind !== "xy" || !gear.controllerName) return [];
            const value = readFirstXyValue(gear, node);
            return [{ kind: "xy", controllerName: gear.controllerName, x: value.x, y: value.y }];
        }),
        gears: (node.gears || []).flatMap((gear) => gear.kind && gear.controllerName ? [{
            kind: gear.kind,
            controllerName: gear.controllerName,
            tween: Boolean(gear.tween),
        }] : []),
    };
}

export function getDisplayNodeRelationModel(
    projectValue: unknown,
    selector: EditorDisplayNodeSelector,
): DisplayNodeRelationModel | null {
    const component = findComponent(projectValue, selector);
    const node = findDisplayNode(projectValue, selector);
    if (!component || !node) return null;
    return {
        relations: (node.relations || []).map((relation) => ({
            targetNodeId: String(relation.targetNodeId || ""),
            type: Number(relation.type),
            usePercent: Boolean(relation.usePercent),
        })),
        targets: (component.displayList || []).flatMap((candidate) => {
            const id = String(candidate.id || "");
            return id && id !== selector.displayNodeId ? [{
                id,
                name: String(candidate.name || id),
                kind: String(candidate.kind || "unknown"),
            }] : [];
        }),
    };
}
