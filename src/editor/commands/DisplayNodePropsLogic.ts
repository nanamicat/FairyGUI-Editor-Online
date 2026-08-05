import type {
    DisplayNodeEditableProps,
    EditorCommandError,
    EditorCommandNodeState,
    EditorCommandOperation,
    EditorDisplayNodeSelector,
    SetDisplayNodePropsCommand,
    SetDisplayNodePropsOperation,
} from "../model/EditorCommand";
import type {
    EditorProjectSnapshot,
    ProjectSnapshotComponent,
    ProjectSnapshotDisplayNode,
    ProjectSnapshotPackage,
} from "../model/ProjectSnapshot";

export function isSetDisplayNodePropsOperation(
    operation: EditorCommandOperation,
): operation is SetDisplayNodePropsOperation {
    return operation.kind === "setDisplayNodeProps";
}

export function createInverseSetDisplayNodePropsOperation(
    operation: SetDisplayNodePropsOperation,
    before: EditorCommandNodeState,
    revision: number,
): SetDisplayNodePropsOperation {
    return {
        opId: `live-undo-display-node-props-${revision + 1}`,
        kind: "setDisplayNodeProps",
        selector: operation.selector,
        props: createInverseDisplayNodeProps(before, operation.props),
    };
}

export function createSetDisplayNodePropsOperation(
    command: SetDisplayNodePropsCommand,
    opId: string,
): SetDisplayNodePropsOperation {
    return {
        opId,
        kind: "setDisplayNodeProps",
        selector: command.selector,
        props: command.props,
    };
}

export interface CommonDisplayNodePropsValues {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    alpha?: number;
    rotation?: number;
    visible?: boolean;
    touchable?: boolean;
    grayed?: boolean;
}

export function createCommonDisplayNodePropsCommands(
    packageId: string,
    componentResourceId: string,
    nodes: ProjectSnapshotDisplayNode[],
    values: CommonDisplayNodePropsValues,
): { commands: SetDisplayNodePropsCommand[]; changedFields: string[] } {
    const changedFields = new Set<string>();
    const commands = nodes.flatMap((node): SetDisplayNodePropsCommand[] => {
        const props: DisplayNodeEditableProps = {};
        const targetX = values.x ?? node.x;
        const targetY = values.y ?? node.y;
        const targetWidth = values.width ?? node.width;
        const targetHeight = values.height ?? node.height;
        if (targetX !== node.x || targetY !== node.y) {
            props.position = { x: targetX, y: targetY };
            if (targetX !== node.x) changedFields.add("x");
            if (targetY !== node.y) changedFields.add("y");
        }
        if (targetWidth !== node.width || targetHeight !== node.height) {
            props.size = { width: targetWidth, height: targetHeight };
            if (targetWidth !== node.width) changedFields.add("width");
            if (targetHeight !== node.height) changedFields.add("height");
        }
        if (values.alpha !== undefined && values.alpha !== node.alpha) {
            props.alpha = values.alpha;
            changedFields.add("alpha");
        }
        if (values.rotation !== undefined && values.rotation !== node.rotation) {
            props.rotation = values.rotation;
            changedFields.add("rotation");
        }
        if (values.visible !== undefined && values.visible !== node.visible) {
            props.visible = values.visible;
            changedFields.add("visible");
        }
        if (values.touchable !== undefined && values.touchable !== node.touchable) {
            props.touchable = values.touchable;
            changedFields.add("touchable");
        }
        if (values.grayed !== undefined && values.grayed !== node.grayed) {
            props.grayed = values.grayed;
            changedFields.add("grayed");
        }
        if (Object.keys(props).length === 0) return [];
        return [{
            kind: "setDisplayNodeProps",
            selector: { packageId, componentResourceId, displayNodeId: node.id },
            props,
        }];
    });
    return { commands, changedFields: [...changedFields] };
}

export function validateSetDisplayNodeProps(snapshot: EditorProjectSnapshot | null, command: SetDisplayNodePropsCommand): EditorCommandError | null {
    if (!snapshot) {
        return {
            code: "project_snapshot_missing",
            message: "Project snapshot is not loaded.",
        };
    }

    if (command.kind !== "setDisplayNodeProps") {
        return {
            code: "unsupported_command",
            message: `Unsupported editor command: ${command.kind}.`,
        };
    }

    const position = command.props.position;
    if (position && (!Number.isFinite(position.x) || !Number.isFinite(position.y))) {
        return {
            code: "invalid_number",
            field: "position",
            message: "Display node x/y must be finite numbers.",
        };
    }

    const size = command.props.size;
    if (size && (!Number.isFinite(size.width) || !Number.isFinite(size.height))) {
        return {
            code: "invalid_number",
            field: "size",
            message: "Display node width/height must be finite numbers.",
        };
    }

    if (size && (size.width < 0 || size.height < 0)) {
        return {
            code: "invalid_size",
            field: "size",
            message: "Display node width/height must be non-negative.",
        };
    }

    for (const [field, value] of [
        ["locked", command.props.locked],
        ["aspect", command.props.aspect],
    ] as const) {
        if (value !== undefined && typeof value !== "boolean") {
            return { code: "invalid_boolean", field, message: `Display node ${field} must be a boolean.` };
        }
    }

    const minSize = command.props.minSize;
    const maxSize = command.props.maxSize;
    for (const [field, value] of [["minSize", minSize], ["maxSize", maxSize]] as const) {
        if (value && (
            !Number.isFinite(value.width)
            || !Number.isFinite(value.height)
            || value.width < 0
            || value.height < 0
        )) {
            return { code: "invalid_size", field, message: `${field} must contain finite non-negative values.` };
        }
    }
    if (minSize && maxSize && (
        (maxSize.width > 0 && maxSize.width < minSize.width)
        || (maxSize.height > 0 && maxSize.height < minSize.height)
    )) {
        return { code: "invalid_size", field: "maxSize", message: "Maximum size must be zero or at least the minimum size." };
    }
    for (const [field, value] of [["scale", command.props.scale], ["skew", command.props.skew]] as const) {
        if (value && (!Number.isFinite(value.x) || !Number.isFinite(value.y))) {
            return { code: "invalid_number", field, message: `${field} must contain finite x/y values.` };
        }
    }

    if (command.props.visible !== undefined && typeof command.props.visible !== "boolean") {
        return {
            code: "invalid_boolean",
            field: "visible",
            message: "Display node visible must be a boolean.",
        };
    }

    if (command.props.touchable !== undefined && typeof command.props.touchable !== "boolean") {
        return {
            code: "invalid_boolean",
            field: "touchable",
            message: "Display node touchable must be a boolean.",
        };
    }

    if (command.props.grayed !== undefined && typeof command.props.grayed !== "boolean") {
        return {
            code: "invalid_boolean",
            field: "grayed",
            message: "Display node grayed must be a boolean.",
        };
    }

    if (command.props.alpha !== undefined && (!Number.isFinite(command.props.alpha) || command.props.alpha < 0 || command.props.alpha > 1)) {
        return {
            code: "invalid_alpha",
            field: "alpha",
            message: "Display node alpha must be a finite number from 0 to 1.",
        };
    }

    if (command.props.rotation !== undefined && !Number.isFinite(command.props.rotation)) {
        return {
            code: "invalid_rotation",
            field: "rotation",
            message: "Display node rotation must be a finite number.",
        };
    }

    for (const [field, value] of [
        ["tooltips", command.props.tooltips],
        ["filter", command.props.filter],
        ["filterData", command.props.filterData],
    ] as const) {
        if (value !== undefined && typeof value !== "string") {
            return { code: "invalid_text", field, message: `Display node ${field} must be a string.` };
        }
    }
    if (
        command.props.blendMode !== undefined
        && !["normal", "none", "add", "multiply", "screen", "erase"].includes(command.props.blendMode)
    ) {
        return { code: "invalid_blend_mode", field: "blendMode", message: "Display node blend mode is invalid." };
    }
    const filter = command.props.filter;
    const filterData = command.props.filterData;
    if (filter !== undefined && filter !== "" && filter !== "color") {
        return { code: "invalid_filter", field: "filter", message: "Display node filter must be empty or color." };
    }
    if (filter === "" && filterData) {
        return { code: "invalid_filter", field: "filterData", message: "Filter data must be empty when no filter is selected." };
    }
    if (filter === "color" && filterData !== undefined) {
        const values = filterData.split(",").map((value) => Number(value.trim()));
        if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
            return { code: "invalid_filter", field: "filterData", message: "Color filter data needs four finite comma-separated numbers." };
        }
    }

    const pivot = command.props.pivot;
    if (pivot && (!Number.isFinite(pivot.x) || !Number.isFinite(pivot.y))) {
        return {
            code: "invalid_number",
            field: "pivot",
            message: "Display node pivot x/y must be finite numbers.",
        };
    }

    if (command.props.pivotAsAnchor !== undefined && typeof command.props.pivotAsAnchor !== "boolean") {
        return {
            code: "invalid_boolean",
            field: "pivotAsAnchor",
            message: "Display node pivotAsAnchor must be a boolean.",
        };
    }

    if (command.props.customData !== undefined && typeof command.props.customData !== "string") {
        return {
            code: "invalid_custom_data",
            field: "customData",
            message: "Display node customData must be a string.",
        };
    }

    if (command.props.text !== undefined && typeof command.props.text !== "string") {
        return {
            code: "invalid_text",
            field: "text",
            message: "Display node text must be a string.",
        };
    }

    if (command.props.font !== undefined && typeof command.props.font !== "string") {
        return {
            code: "invalid_font",
            field: "font",
            message: "Display node font must be a string.",
        };
    }

    if (command.props.fontSize !== undefined && (!Number.isFinite(command.props.fontSize) || command.props.fontSize <= 0)) {
        return {
            code: "invalid_font_size",
            field: "fontSize",
            message: "Display node font size must be a finite number greater than zero.",
        };
    }

    if (command.props.color !== undefined && !/^#[0-9a-f]{6}$/i.test(command.props.color)) {
        return {
            code: "invalid_color",
            field: "color",
            message: "Display node color must use #RRGGBB.",
        };
    }
    if (command.props.textProperties !== undefined) {
        const properties = command.props.textProperties;
        if (
            !Number.isFinite(properties.leading)
            || !Number.isFinite(properties.letterSpacing)
            || !Number.isInteger(properties.autoSize)
            || properties.autoSize < 0
            || properties.autoSize > 4
            || !Number.isInteger(properties.align)
            || properties.align < 0
            || properties.align > 2
            || !Number.isInteger(properties.vAlign)
            || properties.vAlign < 0
            || properties.vAlign > 2
        ) {
            return {
                code: "invalid_text_properties",
                field: "textProperties",
                message: "Text alignment, spacing, or auto-size values are invalid.",
            };
        }
    }
    if (command.props.textInputProperties !== undefined) {
        const properties = command.props.textInputProperties;
        if (
            !Number.isInteger(properties.maxLength)
            || properties.maxLength < 0
            || !Number.isInteger(properties.keyboardType)
            || properties.keyboardType < 0
        ) {
            return {
                code: "invalid_text_input_properties",
                field: "textInputProperties",
                message: "Text input max length or keyboard type is invalid.",
            };
        }
    }
    if (command.props.graphProperties !== undefined) {
        const properties = command.props.graphProperties;
        const finiteArray = (value: number[] | null): boolean => (
            value === null || value.every((entry) => Number.isFinite(entry))
        );
        const validColor = (value: string): boolean => /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value);
        if (
            !Number.isInteger(properties.graphType)
            || properties.graphType < 0
            || properties.graphType > 4
            || !Number.isInteger(properties.lineSize)
            || properties.lineSize < 0
            || !validColor(properties.lineColor)
            || !validColor(properties.fillColor)
            || (properties.cornerRadius !== null && (
                properties.cornerRadius.length !== 4
                || properties.cornerRadius.some((radius) => !Number.isFinite(radius) || radius < 0)
            ))
            || !finiteArray(properties.points)
            || (properties.points !== null && properties.points.length % 2 !== 0)
            || !Number.isInteger(properties.sides)
            || properties.sides < 0
            || properties.sides > 100
            || !Number.isFinite(properties.startAngle)
            || !finiteArray(properties.distances)
            || (properties.distances !== null && properties.distances.some((distance) => distance < 0 || distance > 1))
            || (properties.graphType === 3 && (!properties.points || properties.points.length < 6))
            || (properties.graphType === 4 && (
                properties.sides < 3
                || (properties.distances !== null
                    && properties.distances.length > 0
                    && properties.distances.length !== properties.sides)
            ))
        ) {
            return {
                code: "invalid_graph_properties",
                field: "graphProperties",
                message: "Graph shape, color, geometry, or regular polygon values are invalid.",
            };
        }
    }
    if (command.props.loaderProperties !== undefined) {
        const properties = command.props.loaderProperties;
        const validColor = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(properties.color);
        if (
            !Number.isInteger(properties.fill)
            || properties.fill < 0
            || properties.fill > 5
            || !Number.isInteger(properties.align)
            || properties.align < 0
            || properties.align > 2
            || !Number.isInteger(properties.vAlign)
            || properties.vAlign < 0
            || properties.vAlign > 2
            || !Number.isInteger(properties.frame)
            || properties.frame < 0
            || !validColor
            || !Number.isInteger(properties.fillMethod)
            || properties.fillMethod < 0
            || properties.fillMethod > 5
            || !Number.isInteger(properties.fillOrigin)
            || properties.fillOrigin < 0
            || properties.fillOrigin > 3
            || !Number.isFinite(properties.fillAmount)
            || properties.fillAmount < 0
            || properties.fillAmount > 100
        ) {
            return {
                code: "invalid_loader_properties",
                field: "loaderProperties",
                message: "Loader fill, alignment, frame, color, or fill amount is invalid.",
            };
        }
    }
    if (command.props.groupProperties !== undefined) {
        const properties = command.props.groupProperties;
        const valid = Number.isInteger(properties.layout)
            && properties.layout >= 0
            && properties.layout <= 2
            && Number.isFinite(properties.lineGap)
            && Number.isFinite(properties.columnGap)
            && typeof properties.advanced === "boolean"
            && typeof properties.excludeInvisibles === "boolean"
            && typeof properties.autoSizeDisabled === "boolean"
            && Number.isInteger(properties.mainGridIndex)
            && properties.mainGridIndex >= -1
            && ((properties.advanced && properties.layout !== 0) || (
                properties.layout === 0
                && properties.lineGap === 0
                && properties.columnGap === 0
                && !properties.excludeInvisibles
                && !properties.autoSizeDisabled
                && properties.mainGridIndex === -1
            ));
        if (!valid) {
            return { code: "invalid_group_properties", field: "groupProperties", message: "Group properties must be a complete valid advanced layout snapshot." };
        }
    }
    if (command.props.loader3DProperties !== undefined) {
        const properties = command.props.loader3DProperties;
        if (
            !Number.isInteger(properties.fill)
            || properties.fill < 0
            || properties.fill > 5
            || !Number.isInteger(properties.align)
            || properties.align < 0
            || properties.align > 2
            || !Number.isInteger(properties.vAlign)
            || properties.vAlign < 0
            || properties.vAlign > 2
            || !Number.isInteger(properties.frame)
            || properties.frame < 0
            || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(properties.color)
        ) {
            return {
                code: "invalid_loader3d_properties",
                field: "loader3DProperties",
                message: "Loader3D fill, alignment, frame, or color is invalid.",
            };
        }
    }
    if (command.props.listProperties !== undefined) {
        const properties = command.props.listProperties;
        const finiteInsets = (value: { top: number; bottom: number; left: number; right: number }): boolean => (
            [value.top, value.bottom, value.left, value.right].every(Number.isFinite)
        );
        const validItems = properties.listItems.every((item) => (
            Number.isInteger(item.level)
            && item.level >= 0
            && (item.isFolder === null || typeof item.isFolder === "boolean")
        ));
        if (
            !Number.isInteger(properties.layout)
            || properties.layout < 0
            || properties.layout > 4
            || !Number.isInteger(properties.align)
            || properties.align < 0
            || properties.align > 2
            || !Number.isInteger(properties.vAlign)
            || properties.vAlign < 0
            || properties.vAlign > 2
            || !Number.isInteger(properties.lineGap)
            || !Number.isInteger(properties.columnGap)
            || !Number.isInteger(properties.lineCount)
            || properties.lineCount < 0
            || !Number.isInteger(properties.columnCount)
            || properties.columnCount < 0
            || !Number.isInteger(properties.selectionMode)
            || properties.selectionMode < 0
            || properties.selectionMode > 3
            || !Number.isInteger(properties.childrenRenderOrder)
            || properties.childrenRenderOrder < 0
            || properties.childrenRenderOrder > 2
            || !Number.isInteger(properties.apexIndex)
            || properties.apexIndex < 0
            || !Number.isInteger(properties.overflow)
            || properties.overflow < 0
            || properties.overflow > 2
            || !Number.isInteger(properties.scrollType)
            || properties.scrollType < 0
            || properties.scrollType > 2
            || !Number.isInteger(properties.scrollBarFlags)
            || properties.scrollBarFlags < 0
            || !finiteInsets(properties.scrollBarMargin)
            || !finiteInsets(properties.margin)
            || !Number.isFinite(properties.clipSoftness.x)
            || !Number.isFinite(properties.clipSoftness.y)
            || typeof properties.autoClearItems !== "boolean"
            || !validItems
            || ("treeView" in properties && (
                typeof properties.treeView !== "boolean"
                || !Number.isInteger(properties.indent)
                || properties.indent < 0
                || !Number.isInteger(properties.clickToExpand)
                || properties.clickToExpand < 0
                || properties.clickToExpand > 1
            ))
        ) {
            return {
                code: "invalid_list_properties",
                field: "listProperties",
                message: "List layout, scrolling, items, or tree options are invalid.",
            };
        }
    }
    if (command.props.componentInstanceProperties !== undefined && command.props.componentInstanceProperties !== null) {
        const properties = command.props.componentInstanceProperties;
        const strings = (values: unknown[]): boolean => values.every((value) => typeof value === "string");
        const nonNegativeInteger = (value: unknown): boolean => Number.isInteger(value) && Number(value) >= 0;
        const finite = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);
        const valid = (() => {
            switch (properties.extensionType) {
                case "Button":
                    return strings([
                        properties.title,
                        properties.selectedTitle,
                        properties.icon,
                        properties.selectedIcon,
                        properties.titleColor,
                        properties.controller,
                        properties.page,
                        properties.sound,
                    ])
                        && nonNegativeInteger(properties.titleFontSize)
                        && typeof properties.checked === "boolean"
                        && finite(properties.soundVolumeScale)
                        && properties.soundVolumeScale >= 0;
                case "Label":
                    return strings([
                        properties.title,
                        properties.icon,
                        properties.titleColor,
                        properties.promptText,
                    ]) && nonNegativeInteger(properties.titleFontSize);
                case "ComboBox":
                    return strings([properties.title, properties.icon, properties.selectionController])
                        && nonNegativeInteger(properties.visibleItemCount)
                        && typeof properties.autoClearItems === "boolean"
                        && properties.items.every((item) => (
                            [item.title, item.value, item.icon]
                                .every((value) => value === null || typeof value === "string")
                        ));
                case "ProgressBar":
                case "Slider":
                    return [properties.value, properties.max, properties.min].every(finite);
                case "ScrollBar":
                    return true;
            }
        })();
        if (!valid) {
            return {
                code: "invalid_component_instance_properties",
                field: "componentInstanceProperties",
                message: "Component instance extension properties are invalid.",
            };
        }
    }
    if (command.props.componentCustomPropertyValues !== undefined && command.props.componentCustomPropertyValues !== null) {
        const keys = new Set<string>();
        const valid = command.props.componentCustomPropertyValues.every((property) => {
            const key = `${property.target}\0${property.propertyId}`;
            if (
                !property.target
                || (property.propertyId !== 0 && property.propertyId !== 1)
                || typeof property.value !== "string"
                || keys.has(key)
            ) return false;
            keys.add(key);
            return true;
        });
        if (!valid) {
            return {
                code: "invalid_component_custom_property_values",
                field: "componentCustomPropertyValues",
                message: "Component custom property values must be unique valid Text or Icon overrides.",
            };
        }
    }
    if (command.props.componentControllerPageOverrides !== undefined && command.props.componentControllerPageOverrides !== null) {
        const names = new Set<string>();
        const valid = command.props.componentControllerPageOverrides.every((override) => {
            if (!override.controllerName || !override.pageId || names.has(override.controllerName)) return false;
            names.add(override.controllerName);
            return true;
        });
        if (!valid) {
            return {
                code: "invalid_component_controller_page_overrides",
                field: "componentControllerPageOverrides",
                message: "Component controller page overrides must contain unique non-empty controller/page pairs.",
            };
        }
    }
    if (command.props.group !== undefined && typeof command.props.group !== "string") {
        return {
            code: "invalid_group",
            field: "group",
            message: "Display node group must be a string.",
        };
    }

    const node = findSnapshotDisplayNode(snapshot, command.selector);
    if (!node) return null;

    if ((pivot || command.props.pivotAsAnchor !== undefined) && (node.type === "GGroup" || node.type === "GLoader3D")) {
        return {
            code: "unsupported_pivot_target",
            field: "pivot",
            message: `${node.type} does not support pivot editing.`,
        };
    }

    if (command.props.pivotAsAnchor !== undefined && node.type === "GMovieClip") {
        return {
            code: "unsupported_pivot_anchor_target",
            field: "pivotAsAnchor",
            message: "GMovieClip supports pivot coordinates but not pivotAsAnchor.",
        };
    }

    if (hasTextProps(command.props) && !isTextEditable(node)) {
        return {
            code: "unsupported_text_target",
            field: "text",
            message: "Text, font, font size, and color edits are only enabled for text display nodes.",
        };
    }
    if (command.props.graphProperties !== undefined && node.type !== "GGraph") {
        return {
            code: "unsupported_graph_target",
            field: "graphProperties",
            message: "Graph properties are only enabled for graph display nodes.",
        };
    }
    if (command.props.groupProperties !== undefined && node.type !== "GGroup") {
        return {
            code: "unsupported_group_properties_target",
            field: "groupProperties",
            message: "Group properties are only enabled for GGroup display nodes.",
        };
    }
    if (command.props.loaderProperties !== undefined && node.type !== "GLoader") {
        return {
            code: "unsupported_loader_target",
            field: "loaderProperties",
            message: "Loader properties are only enabled for GLoader display nodes.",
        };
    }
    if (command.props.loader3DProperties !== undefined && node.type !== "GLoader3D") {
        return {
            code: "unsupported_loader3d_target",
            field: "loader3DProperties",
            message: "Loader3D properties are only enabled for GLoader3D display nodes.",
        };
    }
    if (command.props.listProperties !== undefined) {
        const treePayload = "treeView" in command.props.listProperties;
        if (
            (node.type !== "GList" && node.type !== "GTree")
            || (node.type === "GTree" && !treePayload)
            || (node.type === "GList" && treePayload)
        ) {
            return {
                code: "unsupported_list_target",
                field: "listProperties",
                message: "List properties must match the selected GList or GTree node.",
            };
        }
    }
    if (command.props.componentInstanceProperties !== undefined) {
        const expectedType = node.componentInstanceProperties?.extensionType;
        const actualType = command.props.componentInstanceProperties?.extensionType;
        if (
            node.type !== "GComponent"
            || (!expectedType && command.props.componentInstanceProperties !== null)
            || (actualType && expectedType && actualType !== expectedType)
        ) {
            return {
                code: "unsupported_component_instance_target",
                field: "componentInstanceProperties",
                message: "Component instance properties must match the referenced component extension type.",
            };
        }
    }
    if (
        command.props.componentCustomPropertyValues !== undefined
        && node.type !== "GComponent"
    ) {
        return {
            code: "unsupported_component_custom_property_target",
            field: "componentCustomPropertyValues",
            message: "Component custom property values are only supported on component instances.",
        };
    }
    if (
        command.props.componentControllerPageOverrides !== undefined
        && node.type !== "GComponent"
    ) {
        return {
            code: "unsupported_component_controller_page_override_target",
            field: "componentControllerPageOverrides",
            message: "Component controller page overrides are only supported on component instances.",
        };
    }
    if (command.props.group !== undefined && (node.type === "GLoader" || node.type === "GLoader3D")) {
        return {
            code: "unsupported_group_target",
            field: "group",
            message: `${node.type} does not support group membership.`,
        };
    }

    return null;
}

export function applyDisplayNodeProps(node: ProjectSnapshotDisplayNode, props: DisplayNodeEditableProps): void {
    if (props.position) {
        node.x = props.position.x;
        node.y = props.position.y;
    }
    if (props.size) {
        node.width = props.size.width;
        node.height = props.size.height;
    }
    if (props.locked !== undefined) node.locked = props.locked;
    if (props.aspect !== undefined) node.aspect = props.aspect;
    if (props.minSize) node.minSize = structuredClone(props.minSize);
    if (props.maxSize) node.maxSize = structuredClone(props.maxSize);
    if (props.scale) node.scale = structuredClone(props.scale);
    if (props.skew) node.skew = structuredClone(props.skew);
    if (props.visible !== undefined) node.visible = props.visible;
    if (props.touchable !== undefined) node.touchable = props.touchable;
    if (props.grayed !== undefined) node.grayed = props.grayed;
    if (props.alpha !== undefined) node.alpha = props.alpha;
    if (props.rotation !== undefined) node.rotation = props.rotation;
    if (props.tooltips !== undefined) node.tooltips = props.tooltips;
    if (props.blendMode !== undefined) node.blendMode = props.blendMode;
    if (props.filter !== undefined) node.filter = props.filter;
    if (props.filterData !== undefined) node.filterData = props.filterData;
    if (props.pivot) {
        node.pivotX = props.pivot.x;
        node.pivotY = props.pivot.y;
    }
    if (props.pivotAsAnchor !== undefined) node.pivotAsAnchor = props.pivotAsAnchor;
    if (props.customData !== undefined) node.customData = props.customData;
    if (props.text !== undefined) node.text = props.text;
    if (props.font !== undefined) node.font = props.font;
    if (props.fontSize !== undefined) node.fontSize = props.fontSize;
    if (props.color !== undefined) node.color = props.color;
    if (props.textProperties !== undefined) node.textProperties = structuredClone(props.textProperties);
    if (props.textInputProperties !== undefined) node.textInputProperties = structuredClone(props.textInputProperties);
    if (props.graphProperties !== undefined) node.graphProperties = structuredClone(props.graphProperties);
    if (props.groupProperties !== undefined) node.groupProperties = structuredClone(props.groupProperties);
    if (props.loaderProperties !== undefined) node.loaderProperties = structuredClone(props.loaderProperties);
    if (props.loader3DProperties !== undefined) node.loader3DProperties = structuredClone(props.loader3DProperties);
    if (props.listProperties !== undefined) node.listProperties = structuredClone(props.listProperties);
    if (props.componentInstanceProperties !== undefined) {
        if (props.componentInstanceProperties === null) {
            const extensionType = node.componentInstanceProperties?.extensionType;
            if (extensionType === "Button") {
                node.componentInstanceProperties = {
                    extensionType,
                    title: "",
                    selectedTitle: "",
                    icon: "",
                    selectedIcon: "",
                    titleColor: "",
                    titleFontSize: 0,
                    controller: "",
                    page: "",
                    checked: false,
                    sound: "",
                    soundVolumeScale: 1,
                };
            } else if (extensionType === "Label") {
                node.componentInstanceProperties = {
                    extensionType,
                    title: "",
                    icon: "",
                    titleColor: "",
                    titleFontSize: 0,
                    promptText: "",
                };
            } else if (extensionType === "ComboBox") {
                node.componentInstanceProperties = {
                    extensionType,
                    title: "",
                    icon: "",
                    visibleItemCount: 0,
                    selectionController: "",
                    autoClearItems: false,
                    items: [],
                };
            } else if (extensionType === "ProgressBar" || extensionType === "Slider") {
                node.componentInstanceProperties = {
                    extensionType,
                    value: 0,
                    max: 100,
                    min: 0,
                };
            }
            node.componentInstancePropertiesExplicit = false;
        } else {
            node.componentInstanceProperties = structuredClone(props.componentInstanceProperties);
            node.componentInstancePropertiesExplicit = true;
        }
    }
    if (props.componentCustomPropertyValues !== undefined) {
        if (props.componentCustomPropertyValues === null) {
            node.componentCustomPropertyValues = undefined;
            node.componentCustomPropertyValuesExplicit = false;
        } else {
            node.componentCustomPropertyValues = structuredClone(props.componentCustomPropertyValues);
            node.componentCustomPropertyValuesExplicit = true;
        }
    }
    if (props.componentControllerPageOverrides !== undefined) {
        if (props.componentControllerPageOverrides === null) {
            node.componentControllerPageOverrides = undefined;
            node.componentControllerPageOverridesExplicit = false;
        } else {
            node.componentControllerPageOverrides = structuredClone(props.componentControllerPageOverrides);
            node.componentControllerPageOverridesExplicit = true;
        }
    }
    if (props.group !== undefined) node.group = props.group;
}

export function createInverseDisplayNodeProps(
    before: EditorCommandNodeState,
    edited: DisplayNodeEditableProps,
): DisplayNodeEditableProps {
    const inverse: DisplayNodeEditableProps = {};
    if (edited.position) inverse.position = { x: before.x, y: before.y };
    if (edited.size) inverse.size = { width: before.width, height: before.height };
    if (edited.locked !== undefined) inverse.locked = before.locked;
    if (edited.aspect !== undefined) inverse.aspect = before.aspect;
    if (edited.minSize) inverse.minSize = structuredClone(before.minSize);
    if (edited.maxSize) inverse.maxSize = structuredClone(before.maxSize);
    if (edited.scale) inverse.scale = structuredClone(before.scale);
    if (edited.skew) inverse.skew = structuredClone(before.skew);
    if (edited.visible !== undefined) inverse.visible = before.visible;
    if (edited.touchable !== undefined) inverse.touchable = before.touchable;
    if (edited.grayed !== undefined) inverse.grayed = before.grayed;
    if (edited.alpha !== undefined) inverse.alpha = before.alpha;
    if (edited.rotation !== undefined) inverse.rotation = before.rotation;
    if (edited.tooltips !== undefined) inverse.tooltips = before.tooltips;
    if (edited.blendMode !== undefined) inverse.blendMode = before.blendMode;
    if (edited.filter !== undefined) inverse.filter = before.filter;
    if (edited.filterData !== undefined) inverse.filterData = before.filterData;
    if (edited.pivot) inverse.pivot = { x: before.pivotX, y: before.pivotY };
    if (edited.pivotAsAnchor !== undefined) inverse.pivotAsAnchor = before.pivotAsAnchor;
    if (edited.customData !== undefined) inverse.customData = before.customData;
    if (edited.text !== undefined) inverse.text = before.text;
    if (edited.font !== undefined) inverse.font = before.font;
    if (edited.fontSize !== undefined) inverse.fontSize = before.fontSize;
    if (edited.color !== undefined) inverse.color = before.color;
    if (edited.textProperties !== undefined) inverse.textProperties = structuredClone(before.textProperties);
    if (edited.textInputProperties !== undefined && before.textInputProperties) {
        inverse.textInputProperties = structuredClone(before.textInputProperties);
    }
    if (edited.graphProperties !== undefined && before.graphProperties) {
        inverse.graphProperties = structuredClone(before.graphProperties);
    }
    if (edited.groupProperties !== undefined && before.groupProperties) {
        inverse.groupProperties = structuredClone(before.groupProperties);
    }
    if (edited.loaderProperties !== undefined && before.loaderProperties) {
        inverse.loaderProperties = structuredClone(before.loaderProperties);
    }
    if (edited.loader3DProperties !== undefined && before.loader3DProperties) {
        inverse.loader3DProperties = structuredClone(before.loader3DProperties);
    }
    if (edited.listProperties !== undefined && before.listProperties) {
        inverse.listProperties = structuredClone(before.listProperties);
    }
    if (edited.componentInstanceProperties !== undefined) {
        inverse.componentInstanceProperties = before.componentInstancePropertiesExplicit
            ? structuredClone(before.componentInstanceProperties!)
            : null;
    }
    if (edited.componentCustomPropertyValues !== undefined) {
        inverse.componentCustomPropertyValues = before.componentCustomPropertyValuesExplicit
            ? structuredClone(before.componentCustomPropertyValues!)
            : null;
    }
    if (edited.componentControllerPageOverrides !== undefined) {
        inverse.componentControllerPageOverrides = before.componentControllerPageOverridesExplicit
            ? structuredClone(before.componentControllerPageOverrides!)
            : null;
    }
    if (edited.group !== undefined) inverse.group = before.group;
    return inverse;
}

function hasTextProps(props: DisplayNodeEditableProps): boolean {
    return props.text !== undefined
        || props.font !== undefined
        || props.fontSize !== undefined
        || props.color !== undefined
        || props.textProperties !== undefined
        || props.textInputProperties !== undefined;
}

export function findSnapshotDisplayNode(snapshot: EditorProjectSnapshot | null, selector: EditorDisplayNodeSelector): ProjectSnapshotDisplayNode | null {
    const component = findSnapshotComponent(snapshot, selector);
    if (!component) return null;

    for (const child of component.children) {
        if (child.id === selector.displayNodeId) return child;
    }
    return null;
}

function findSnapshotComponent(snapshot: EditorProjectSnapshot | null, selector: EditorDisplayNodeSelector): ProjectSnapshotComponent | null {
    const pkg = findSnapshotPackage(snapshot, selector.packageId);
    if (!pkg) return null;

    for (const component of pkg.components) {
        if (component.id === selector.componentResourceId) return component;
    }
    return null;
}

function findSnapshotPackage(snapshot: EditorProjectSnapshot | null, packageId: string): ProjectSnapshotPackage | null {
    if (!snapshot) return null;

    for (const pkg of snapshot.packages) {
        if (pkg.id === packageId) return pkg;
    }
    return null;
}

export function snapshotDisplayNode(node: ProjectSnapshotDisplayNode): EditorCommandNodeState {
    return {
        id: node.id,
        name: node.name,
        type: node.type,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        locked: node.locked,
        aspect: node.aspect,
        minSize: structuredClone(node.minSize),
        maxSize: structuredClone(node.maxSize),
        scale: structuredClone(node.scale),
        skew: structuredClone(node.skew),
        text: node.text,
        visible: node.visible,
        touchable: node.touchable,
        grayed: node.grayed,
        alpha: node.alpha,
        rotation: node.rotation,
        tooltips: node.tooltips,
        blendMode: node.blendMode,
        filter: node.filter,
        filterData: node.filterData,
        pivotX: node.pivotX,
        pivotY: node.pivotY,
        pivotAsAnchor: node.pivotAsAnchor,
        customData: node.customData,
        font: node.font,
        fontSize: node.fontSize,
        color: node.color,
        textProperties: structuredClone(node.textProperties),
        ...(node.textInputProperties
            ? { textInputProperties: structuredClone(node.textInputProperties) }
            : {}),
        ...(node.graphProperties
            ? { graphProperties: structuredClone(node.graphProperties) }
            : {}),
        ...(node.groupProperties
            ? { groupProperties: structuredClone(node.groupProperties) }
            : {}),
        ...(node.loaderProperties
            ? { loaderProperties: structuredClone(node.loaderProperties) }
            : {}),
        ...(node.loader3DProperties
            ? { loader3DProperties: structuredClone(node.loader3DProperties) }
            : {}),
        ...(node.listProperties
            ? { listProperties: structuredClone(node.listProperties) }
            : {}),
        ...(node.componentInstanceProperties
            ? {
                componentInstanceProperties: structuredClone(node.componentInstanceProperties),
                componentInstancePropertiesExplicit: node.componentInstancePropertiesExplicit === true,
            }
            : {}),
        ...(node.componentCustomPropertyValues
            ? {
                componentCustomPropertyValues: structuredClone(node.componentCustomPropertyValues),
                componentCustomPropertyValuesExplicit: node.componentCustomPropertyValuesExplicit === true,
            }
            : {}),
        ...(node.componentControllerPageOverrides
            ? {
                componentControllerPageOverrides: structuredClone(node.componentControllerPageOverrides),
                componentControllerPageOverridesExplicit: node.componentControllerPageOverridesExplicit === true,
            }
            : {}),
        group: node.group,
    };
}

function isTextEditable(node: ProjectSnapshotDisplayNode): boolean {
    return node.type.toLowerCase().indexOf("text") >= 0 || node.text.length > 0;
}
