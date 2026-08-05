import type {
    DisplayNodeEditableProps,
    SetDisplayNodePropsCommand,
} from "../model/EditorCommand";
import type { ProjectSnapshotDisplayNode } from "../model/ProjectSnapshot";

export interface DesktopCanvasPoint {
    x: number;
    y: number;
}

export interface DesktopCanvasRect extends DesktopCanvasPoint {
    width: number;
    height: number;
}

export type DesktopCanvasAlignmentMode =
    | "left"
    | "centerX"
    | "right"
    | "top"
    | "centerY"
    | "bottom"
    | "sameWidth"
    | "sameHeight"
    | "distributeX"
    | "distributeY";

export type DesktopCanvasCustomArrangeMode = "rows" | "columns" | "table";

export interface DesktopCanvasCustomArrangeOptions {
    columnCount: number;
    columnSpacing: number;
    lineSpacing: number;
}

export interface DesktopCanvasSelectableRect extends DesktopCanvasRect {
    id: string;
}

export type DesktopCanvasTransformRect = DesktopCanvasSelectableRect;

export interface DesktopCanvasRotationTransform extends DesktopCanvasPoint {
    id: string;
    rotation: number;
}

export interface DesktopCanvasPivotTransform extends DesktopCanvasPoint {
    pivotX: number;
    pivotY: number;
}

export const DESKTOP_CANVAS_DRAG_THRESHOLD = 3;
export const DESKTOP_CANVAS_SNAP_GRID = 8;

export interface DesktopCanvasCommandContext {
    packageId: string;
    componentResourceId: string;
    nodes: ProjectSnapshotDisplayNode[];
}

function createDesktopCanvasCommand(
    context: DesktopCanvasCommandContext,
    displayNodeId: string,
    props: DisplayNodeEditableProps,
): SetDisplayNodePropsCommand {
    return {
        kind: "setDisplayNodeProps",
        selector: {
            packageId: context.packageId,
            componentResourceId: context.componentResourceId,
            displayNodeId,
        },
        props,
    };
}

export function createDesktopCanvasPositionCommands(
    context: DesktopCanvasCommandContext,
    positions: Array<{ nodeId: string; x: number; y: number }>,
): SetDisplayNodePropsCommand[] | null {
    const targets = new Map(positions.map((position) => [position.nodeId, {
        x: Math.round(position.x),
        y: Math.round(position.y),
    }]));
    if (context.nodes.some((node) => !targets.has(node.id))) return null;
    return context.nodes.flatMap((node) => {
        const position = targets.get(node.id)!;
        return node.x === position.x && node.y === position.y
            ? []
            : [createDesktopCanvasCommand(context, node.id, { position })];
    });
}

export function createDesktopCanvasTransformCommands(
    context: DesktopCanvasCommandContext,
    transforms: Array<{ nodeId: string; x: number; y: number; width: number; height: number }>,
): SetDisplayNodePropsCommand[] | null {
    const targets = new Map(transforms.map((transform) => [transform.nodeId, {
        x: Math.round(transform.x),
        y: Math.round(transform.y),
        width: Math.max(1, Math.round(transform.width)),
        height: Math.max(1, Math.round(transform.height)),
    }]));
    if (context.nodes.some((node) => !targets.has(node.id))) return null;
    return context.nodes.flatMap((node) => {
        const target = targets.get(node.id)!;
        const positionChanged = node.x !== target.x || node.y !== target.y;
        const sizeChanged = node.width !== target.width || node.height !== target.height;
        if (!positionChanged && !sizeChanged) return [];
        return [createDesktopCanvasCommand(context, node.id, {
            ...(positionChanged ? { position: { x: target.x, y: target.y } } : {}),
            ...(sizeChanged ? { size: { width: target.width, height: target.height } } : {}),
        })];
    });
}

export function createDesktopCanvasRotationCommands(
    context: DesktopCanvasCommandContext,
    transforms: Array<{ nodeId: string; x: number; y: number; rotation: number }>,
): SetDisplayNodePropsCommand[] | null {
    const targets = new Map(transforms.map((transform) => [transform.nodeId, {
        x: Math.round(transform.x),
        y: Math.round(transform.y),
        rotation: Math.round(transform.rotation),
    }]));
    if (context.nodes.some((node) => !targets.has(node.id))) return null;
    return context.nodes.flatMap((node) => {
        const target = targets.get(node.id)!;
        const positionChanged = node.x !== target.x || node.y !== target.y;
        const rotationChanged = node.rotation !== target.rotation;
        if (!positionChanged && !rotationChanged) return [];
        return [createDesktopCanvasCommand(context, node.id, {
            ...(positionChanged ? { position: { x: target.x, y: target.y } } : {}),
            ...(rotationChanged ? { rotation: target.rotation } : {}),
        })];
    });
}

export function hasDesktopCanvasDragMoved(
    start: DesktopCanvasPoint,
    current: DesktopCanvasPoint,
): boolean {
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    return dx * dx + dy * dy >= DESKTOP_CANVAS_DRAG_THRESHOLD * DESKTOP_CANVAS_DRAG_THRESHOLD;
}

export function resolveDesktopCanvasDragPosition(
    startPosition: DesktopCanvasPoint,
    startPointer: DesktopCanvasPoint,
    currentPointer: DesktopCanvasPoint,
): DesktopCanvasPoint {
    return {
        x: Math.round(startPosition.x + currentPointer.x - startPointer.x),
        y: Math.round(startPosition.y + currentPointer.y - startPointer.y),
    };
}

export function resolveDesktopCanvasRect(
    start: DesktopCanvasPoint,
    current: DesktopCanvasPoint,
): DesktopCanvasRect {
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    return {
        x,
        y,
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y),
    };
}

export function resolveDesktopCanvasResize(
    startSize: { width: number; height: number },
    startPointer: DesktopCanvasPoint,
    currentPointer: DesktopCanvasPoint,
): { width: number; height: number } {
    return {
        width: Math.max(1, Math.round(startSize.width + currentPointer.x - startPointer.x)),
        height: Math.max(1, Math.round(startSize.height + currentPointer.y - startPointer.y)),
    };
}

export function getDesktopCanvasBounds(
    items: DesktopCanvasTransformRect[],
): DesktopCanvasRect | null {
    if (items.length === 0) return null;
    const x = Math.min(...items.map((item) => item.x));
    const y = Math.min(...items.map((item) => item.y));
    const right = Math.max(...items.map((item) => item.x + item.width));
    const bottom = Math.max(...items.map((item) => item.y + item.height));
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function resolveDesktopCanvasGroupResize(
    items: DesktopCanvasTransformRect[],
    targetSize: { width: number; height: number },
): DesktopCanvasTransformRect[] {
    const bounds = getDesktopCanvasBounds(items);
    if (!bounds) return [];
    const width = Math.max(1, targetSize.width);
    const height = Math.max(1, targetSize.height);
    const scaleX = width / bounds.width;
    const scaleY = height / bounds.height;
    return items.map((item) => ({
        id: item.id,
        x: Math.round(bounds.x + (item.x - bounds.x) * scaleX),
        y: Math.round(bounds.y + (item.y - bounds.y) * scaleY),
        width: Math.max(1, Math.round(item.width * scaleX)),
        height: Math.max(1, Math.round(item.height * scaleY)),
    }));
}

export function snapDesktopCanvasValue(
    value: number,
    step: number = DESKTOP_CANVAS_SNAP_GRID,
): number {
    return step > 0 ? Math.round(value / step) * step : value;
}

export function resolveDesktopCanvasAlignment(
    items: DesktopCanvasTransformRect[],
    mode: DesktopCanvasAlignmentMode,
    primaryId: string,
): DesktopCanvasTransformRect[] {
    if (items.length < 2) return items.map((item) => ({ ...item }));
    const bounds = getDesktopCanvasBounds(items)!;
    const primary = items.find((item) => item.id === primaryId) || items[0];
    const result = new Map(items.map((item) => [item.id, { ...item }]));
    if (mode === "distributeX" || mode === "distributeY") {
        if (items.length < 3) return [...result.values()];
        const horizontal = mode === "distributeX";
        const sorted = [...items].sort((left, right) => (
            (horizontal ? left.x - right.x : left.y - right.y) || left.id.localeCompare(right.id)
        ));
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const totalSize = sorted.reduce(
            (sum, item) => sum + (horizontal ? item.width : item.height),
            0,
        );
        const span = horizontal
            ? last.x + last.width - first.x
            : last.y + last.height - first.y;
        const gap = (span - totalSize) / (sorted.length - 1);
        let cursor = horizontal ? first.x + first.width : first.y + first.height;
        for (const item of sorted.slice(1, -1)) {
            const target = result.get(item.id)!;
            if (horizontal) target.x = Math.round(cursor + gap);
            else target.y = Math.round(cursor + gap);
            cursor = (horizontal ? target.x + item.width : target.y + item.height);
        }
        return items.map((item) => result.get(item.id)!);
    }

    for (const item of items) {
        const target = result.get(item.id)!;
        if (mode === "left") target.x = bounds.x;
        if (mode === "centerX") target.x = Math.round(bounds.x + (bounds.width - item.width) / 2);
        if (mode === "right") target.x = bounds.x + bounds.width - item.width;
        if (mode === "top") target.y = bounds.y;
        if (mode === "centerY") target.y = Math.round(bounds.y + (bounds.height - item.height) / 2);
        if (mode === "bottom") target.y = bounds.y + bounds.height - item.height;
        if (mode === "sameWidth") target.width = primary.width;
        if (mode === "sameHeight") target.height = primary.height;
    }
    return items.map((item) => result.get(item.id)!);
}

export function inferDesktopCanvasSpacing(
    items: DesktopCanvasTransformRect[],
    axis: "x" | "y",
): number {
    if (items.length < 2) return 0;
    const horizontal = axis === "x";
    const sorted = [...items].sort((left, right) => (
        (horizontal ? left.x - right.x : left.y - right.y) || left.id.localeCompare(right.id)
    ));
    for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        const gap = horizontal
            ? current.x - previous.x - previous.width
            : current.y - previous.y - previous.height;
        if (gap > 0) return Math.round(gap);
    }
    return 0;
}

export function inferDesktopCanvasColumnCount(items: DesktopCanvasTransformRect[]): number {
    if (items.length < 2) return 1;
    const sorted = [...items].sort((left, right) => (
        left.y - right.y || left.x - right.x || left.id.localeCompare(right.id)
    ));
    for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index].y - sorted[index - 1].y - sorted[index - 1].height > 0) {
            return index;
        }
    }
    return sorted.length;
}

export function resolveDesktopCanvasCustomArrange(
    items: DesktopCanvasTransformRect[],
    mode: DesktopCanvasCustomArrangeMode,
    options: DesktopCanvasCustomArrangeOptions,
): DesktopCanvasTransformRect[] {
    if (items.length < 2) return items.map((item) => ({ ...item }));
    const result = new Map(items.map((item) => [item.id, { ...item }]));
    if (mode === "rows" || mode === "columns") {
        const horizontal = mode === "columns";
        const sorted = [...items].sort((left, right) => (
            (horizontal ? left.x - right.x : left.y - right.y) || left.id.localeCompare(right.id)
        ));
        for (let index = 1; index < sorted.length; index += 1) {
            const previous = result.get(sorted[index - 1].id)!;
            const current = result.get(sorted[index].id)!;
            if (horizontal) current.x = previous.x + previous.width + Math.round(options.columnSpacing);
            else current.y = previous.y + previous.height + Math.round(options.lineSpacing);
        }
        return items.map((item) => result.get(item.id)!);
    }

    const columnCount = Math.max(1, Math.min(items.length, Math.round(options.columnCount) || 1));
    const baseX = Math.min(...items.map((item) => item.x));
    let rowY = Math.min(...items.map((item) => item.y));
    const pending = [...items].sort((left, right) => (
        left.y - right.y || left.x - right.x || left.id.localeCompare(right.id)
    ));
    while (pending.length > 0) {
        const row = pending.splice(0, columnCount).sort((left, right) => (
            left.x - right.x || left.id.localeCompare(right.id)
        ));
        let columnX = baseX;
        let rowHeight = 0;
        for (const item of row) {
            const target = result.get(item.id)!;
            target.x = columnX;
            target.y = rowY;
            columnX += item.width + Math.round(options.columnSpacing);
            rowHeight = Math.max(rowHeight, item.height);
        }
        rowY += rowHeight + Math.round(options.lineSpacing);
    }
    return items.map((item) => result.get(item.id)!);
}

export function resolveDesktopCanvasRotation(
    startRotation: number,
    center: DesktopCanvasPoint,
    startPointer: DesktopCanvasPoint,
    currentPointer: DesktopCanvasPoint,
    snapStep: number = 1,
): number {
    const startAngle = Math.atan2(startPointer.y - center.y, startPointer.x - center.x);
    const currentAngle = Math.atan2(currentPointer.y - center.y, currentPointer.x - center.x);
    let delta = (currentAngle - startAngle) * 180 / Math.PI;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return snapDesktopCanvasValue(startRotation + delta, snapStep);
}

export function resolveDesktopCanvasPivot(
    startPosition: DesktopCanvasPoint,
    startPivot: DesktopCanvasPoint,
    size: { width: number; height: number },
    scale: DesktopCanvasPoint,
    rotation: number,
    asAnchor: boolean,
    pointer: DesktopCanvasPoint,
): DesktopCanvasPivotTransform {
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    let pivotX: number;
    let pivotY: number;
    if (asAnchor) {
        const radians = rotation * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const dx = pointer.x - startPosition.x;
        const dy = pointer.y - startPosition.y;
        pivotX = startPivot.x + (dx * cos + dy * sin) / (width * scale.x);
        pivotY = startPivot.y + (-dx * sin + dy * cos) / (height * scale.y);
    } else {
        pivotX = (pointer.x - startPosition.x) / width;
        pivotY = (pointer.y - startPosition.y) / height;
    }
    pivotX = Math.round(Math.min(1, Math.max(0, pivotX)) * 10_000) / 10_000;
    pivotY = Math.round(Math.min(1, Math.max(0, pivotY)) * 10_000) / 10_000;
    if (!asAnchor) {
        return { x: startPosition.x, y: startPosition.y, pivotX, pivotY };
    }

    const radians = rotation * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const localX = (pivotX - startPivot.x) * width * scale.x;
    const localY = (pivotY - startPivot.y) * height * scale.y;
    return {
        x: Math.round(startPosition.x + localX * cos - localY * sin),
        y: Math.round(startPosition.y + localX * sin + localY * cos),
        pivotX,
        pivotY,
    };
}

export function resolveDesktopCanvasGraphPoint(
    points: number[],
    pointIndex: number,
    pointer: DesktopCanvasPoint,
    snapStep: number = 0,
    shapeLocked = false,
): number[] {
    const result = [...points];
    const offset = pointIndex * 2;
    if (
        !Number.isInteger(pointIndex)
        || pointIndex < 0
        || offset + 1 >= result.length
    ) {
        return result;
    }
    const x = snapStep > 0
        ? snapDesktopCanvasValue(pointer.x, snapStep)
        : Math.round(pointer.x);
    const y = snapStep > 0
        ? snapDesktopCanvasValue(pointer.y, snapStep)
        : Math.round(pointer.y);
    if (shapeLocked) {
        const deltaX = x - result[offset];
        const deltaY = y - result[offset + 1];
        for (let index = 0; index < result.length; index += 2) {
            result[index] += deltaX;
            result[index + 1] += deltaY;
        }
    } else {
        result[offset] = x;
        result[offset + 1] = y;
    }
    return result;
}

export function resolveDesktopCanvasRegularPolygonDistance(
    pointer: DesktopCanvasPoint,
    width: number,
    height: number,
): number {
    const radius = Math.max(1, Math.min(width, height) / 2);
    const distance = Math.hypot(pointer.x - width / 2, pointer.y - height / 2) / radius;
    return Math.round(Math.min(1, Math.max(0, distance)) * 10_000) / 10_000;
}

export function resolveDesktopCanvasSharedValue<T>(values: T[]): T | undefined {
    if (values.length === 0) return undefined;
    const first = values[0];
    return values.every((value) => value === first) ? first : undefined;
}

export function resolveDesktopCanvasGroupRotation(
    items: DesktopCanvasRotationTransform[],
    center: DesktopCanvasPoint,
    deltaDegrees: number,
): DesktopCanvasRotationTransform[] {
    if (items.length === 1) {
        return [{ ...items[0], rotation: items[0].rotation + deltaDegrees }];
    }
    const radians = deltaDegrees * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return items.map((item) => {
        const dx = item.x - center.x;
        const dy = item.y - center.y;
        return {
            id: item.id,
            x: Math.round(center.x + dx * cos - dy * sin),
            y: Math.round(center.y + dx * sin + dy * cos),
            rotation: item.rotation + deltaDegrees,
        };
    });
}

export function getDesktopCanvasMarqueeSelection(
    bounds: DesktopCanvasSelectableRect[],
    marquee: DesktopCanvasRect,
): string[] {
    const right = marquee.x + marquee.width;
    const bottom = marquee.y + marquee.height;
    return bounds
        .filter((item) => (
            item.x < right
            && item.x + item.width > marquee.x
            && item.y < bottom
            && item.y + item.height > marquee.y
        ))
        .map((item) => item.id);
}

export function getDesktopCanvasNudge(
    key: string,
    coarse: boolean,
): DesktopCanvasPoint | null {
    const step = coarse ? 10 : 1;
    if (key === "ArrowLeft") return { x: -step, y: 0 };
    if (key === "ArrowRight") return { x: step, y: 0 };
    if (key === "ArrowUp") return { x: 0, y: -step };
    if (key === "ArrowDown") return { x: 0, y: step };
    return null;
}
