export type TimelineCurveType = 0 | 1 | 2 | 3;

export interface TimelinePathPoint {
    curveType: TimelineCurveType;
    x: number;
    y: number;
    control1X: number;
    control1Y: number;
    control2X: number;
    control2Y: number;
    smooth: boolean;
}

function finite(value: number): boolean {
    return Number.isFinite(value);
}

export function parseTimelinePathData(value: string): TimelinePathPoint[] | null {
    const source = value.trim();
    if (!source) return [];
    const values = source.split(",").map((part) => Number(part.trim()));
    if (values.some((entry) => !finite(entry))) return null;

    const points: TimelinePathPoint[] = [];
    for (let index = 0; index < values.length;) {
        const curveType = values[index++];
        if (!Number.isInteger(curveType) || curveType < 0 || curveType > 3 || index + 1 >= values.length) return null;
        const point: TimelinePathPoint = {
            curveType: curveType as TimelineCurveType,
            x: values[index++],
            y: values[index++],
            control1X: 0,
            control1Y: 0,
            control2X: 0,
            control2Y: 0,
            smooth: true,
        };
        if (curveType === 1) {
            if (index + 1 >= values.length) return null;
            point.control1X = values[index++];
            point.control1Y = values[index++];
        } else if (curveType === 2) {
            if (index + 4 >= values.length) return null;
            point.control1X = values[index++];
            point.control1Y = values[index++];
            point.control2X = values[index++];
            point.control2Y = values[index++];
            point.smooth = values[index++] !== 0;
        }
        points.push(point);
    }
    return points;
}

function formatNumber(value: number): string {
    return Object.is(value, -0) ? "0" : String(value);
}

export function stringifyTimelinePathData(points: TimelinePathPoint[]): string {
    const values: Array<number | string> = [];
    for (const point of points) {
        values.push(point.curveType, formatNumber(point.x), formatNumber(point.y));
        if (point.curveType === 1) {
            values.push(formatNumber(point.control1X), formatNumber(point.control1Y));
        } else if (point.curveType === 2) {
            values.push(
                formatNumber(point.control1X),
                formatNumber(point.control1Y),
                formatNumber(point.control2X),
                formatNumber(point.control2Y),
                point.smooth ? 1 : 0,
            );
        }
    }
    return values.join(",");
}

export function createDefaultTimelinePath(endX: number, endY: number): TimelinePathPoint[] {
    return [
        {
            curveType: 2,
            x: 0,
            y: 0,
            control1X: endX / 3,
            control1Y: endY / 3,
            control2X: endX * 2 / 3,
            control2Y: endY * 2 / 3,
            smooth: true,
        },
        {
            curveType: 0,
            x: endX,
            y: endY,
            control1X: 0,
            control1Y: 0,
            control2X: 0,
            control2Y: 0,
            smooth: true,
        },
    ];
}

export function createDefaultCustomEasePath(): TimelinePathPoint[] {
    return [
        {
            curveType: 2,
            x: 0,
            y: 0,
            control1X: 0.25,
            control1Y: 0.1,
            control2X: 0.25,
            control2Y: 1,
            smooth: true,
        },
        {
            curveType: 0,
            x: 1,
            y: 1,
            control1X: 0,
            control1Y: 0,
            control2X: 0,
            control2Y: 0,
            smooth: true,
        },
    ];
}

export function isValidCustomEasePath(points: TimelinePathPoint[]): boolean {
    if (points.length < 2) return false;
    const first = points[0];
    const last = points[points.length - 1];
    return first.x === 0 && first.y === 0 && last.x === 1 && last.y === 1;
}
