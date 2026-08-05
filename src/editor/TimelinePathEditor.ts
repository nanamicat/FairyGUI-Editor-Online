import {
    createDefaultCustomEasePath,
    isValidCustomEasePath,
    parseTimelinePathData,
    stringifyTimelinePathData,
    type TimelinePathPoint,
} from "./model/TimelinePathData";

interface TimelinePathEditorOptions {
    mode: "path" | "ease";
    value: string;
    defaultPoints: TimelinePathPoint[];
    onApply: (value: string) => void;
}

interface NumericInput {
    host: fgui.GComponent;
    input: fgui.GTextInput;
}

interface ViewBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

type DragHandle = {
    kind: "anchor" | "control1" | "control2";
    pointIndex: number;
};

interface PathPoint {
    x: number;
    y: number;
}

const PLOT_X = 16;
const PLOT_Y = 54;
const PLOT_WIDTH = 366;
const PLOT_HEIGHT = 300;
const PLOT_PADDING = 18;

function clonePoints(points: TimelinePathPoint[]): TimelinePathPoint[] {
    return points.map((point) => ({ ...point }));
}

function addLabel(parent: fgui.GComponent, name: string, text: string, x: number, y: number, width: number): fgui.GTextField {
    const label = new fgui.GTextField();
    label.name = name;
    label.text = text;
    label.fontSize = 12;
    label.color = "#bdbdbd";
    label.singleLine = true;
    label.setXY(x, y);
    label.setSize(width, 20);
    parent.addChild(label);
    return label;
}

function addInput(parent: fgui.GComponent, name: string, x: number, y: number, width: number): NumericInput {
    const host = fgui.UIPackage.createObject("Basic", "TextInput").asCom;
    host.name = name;
    host.setXY(x, y);
    host.setSize(width, 20);
    parent.addChild(host);
    const input = host.getChild("title").asTextInput;
    input.fontSize = 12;
    input.color = "#bdbdbd";
    return { host, input };
}

function addButton(parent: fgui.GComponent, name: string, title: string, x: number, y: number, width: number): fgui.GButton {
    const button = fgui.UIPackage.createObject("Basic", "TextButton").asButton;
    button.name = name;
    button.title = title;
    button.setXY(x, y);
    button.setSize(width, 22);
    parent.addChild(button);
    return button;
}

function addCombo(
    parent: fgui.GComponent,
    name: string,
    x: number,
    y: number,
    width: number,
    items: string[],
    values: string[],
): fgui.GComboBox {
    const combo = fgui.UIPackage.createObject("Basic", "ComboBox").asComboBox;
    combo.name = name;
    combo.setXY(x, y);
    combo.setSize(width, 20);
    combo.items = items;
    combo.values = values;
    combo.visibleItemCount = Math.min(12, items.length);
    parent.addChild(combo);
    return combo;
}

function finiteInput(input: fgui.GTextInput, fallback: number): number {
    const value = Number(input.text);
    return Number.isFinite(value) ? value : fallback;
}

function calculateBounds(points: TimelinePathPoint[], mode: TimelinePathEditorOptions["mode"]): ViewBounds {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const point of points) {
        xs.push(point.x);
        ys.push(point.y);
        if (point.curveType === 1 || point.curveType === 2) {
            xs.push(point.control1X);
            ys.push(point.control1Y);
        }
        if (point.curveType === 2) {
            xs.push(point.control2X);
            ys.push(point.control2Y);
        }
    }
    if (mode === "ease") {
        xs.push(0, 1);
        ys.push(0, 1);
    }
    const minX = Math.min(...xs, 0);
    const maxX = Math.max(...xs, 1);
    const minY = Math.min(...ys, 0);
    const maxY = Math.max(...ys, 1);
    const xMargin = Math.max(0.1, (maxX - minX) * 0.12);
    const yMargin = Math.max(0.1, (maxY - minY) * 0.12);
    return {
        minX: minX - xMargin,
        maxX: maxX + xMargin,
        minY: minY - yMargin,
        maxY: maxY + yMargin,
    };
}

function roundCoordinate(value: number, mode: TimelinePathEditorOptions["mode"]): number {
    const precision = mode === "ease" ? 10000 : 1000;
    return Math.round(value * precision) / precision;
}

function samplePath(points: TimelinePathPoint[], stepsPerSegment: number): PathPoint[] {
    if (points.length === 0) return [];
    const runtimePath = new fgui.GPath();
    runtimePath.create(points.map((point) => {
        if (point.curveType === 1) {
            return fgui.GPathPoint.newBezierPoint(point.x, point.y, point.control1X, point.control1Y);
        }
        if (point.curveType === 2) {
            return fgui.GPathPoint.newCubicBezierPoint(
                point.x,
                point.y,
                point.control1X,
                point.control1Y,
                point.control2X,
                point.control2Y,
            );
        }
        return fgui.GPathPoint.newPoint(point.x, point.y, point.curveType);
    }));
    const steps = Math.max(2, Math.floor(stepsPerSegment) * Math.max(1, points.length - 1));
    return Array.from({ length: steps + 1 }, (_, index) => runtimePath.getPointAt(index / steps));
}

export function showTimelinePathEditor(options: TimelinePathEditorOptions): fgui.Window {
    const parsed = parseTimelinePathData(options.value);
    let points = parsed && parsed.length >= 2 ? parsed : clonePoints(options.defaultPoints);
    let selectedIndex = 0;
    let bounds = calculateBounds(points, options.mode);
    let dragHandle: DragHandle | null = null;

    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = options.mode === "ease" ? "timelineEaseCurveEditorDialog" : "timelineMotionPathEditorDialog";
    const content = fgui.UIPackage.createObject("Builder", "ConfirmDialog").asCom;
    content.setSize(660, 438);
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = options.mode === "ease" ? "Custom Ease Curve" : "Motion Path";
    const hint = content.getChild("n2").asTextField;
    hint.setXY(16, 32);
    hint.setSize(628, 18);
    hint.color = parsed === null ? "#ef9f3f" : "#8ccf7e";
    hint.text = parsed === null
        ? "The current value is invalid. Apply replaces it with the visual draft."
        : "Drag anchors or control handles. Changes remain local until the outer Timeline action is applied.";

    const plotHost = new fgui.GComponent();
    plotHost.name = "timelineCurvePlot";
    plotHost.opaque = true;
    plotHost.setXY(PLOT_X, PLOT_Y);
    plotHost.setSize(PLOT_WIDTH, PLOT_HEIGHT);
    content.addChild(plotHost);
    const background = new fgui.GGraph();
    background.setSize(PLOT_WIDTH, PLOT_HEIGHT);
    background.drawRect(1, "#555555", "#242424");
    plotHost.addChild(background);
    const plot = new fgui.GGraph();
    plot.touchable = false;
    plot.setSize(PLOT_WIDTH, PLOT_HEIGHT);
    plotHost.addChild(plot);

    addLabel(content, "timelineCurvePointLabel", "Point", 400, 58, 42);
    const pointCombo = addCombo(content, "timelineCurvePoint", 446, 54, 198, [], []);
    addLabel(content, "timelineCurveTypeLabel", "Type", 400, 86, 42);
    const typeCombo = addCombo(
        content,
        "timelineCurveType",
        446,
        82,
        198,
        ["CR Spline", "Bezier", "Cubic Bezier", "Straight"],
        ["0", "1", "2", "3"],
    );
    addLabel(content, "timelineCurveXLabel", "X", 400, 116, 16);
    const xInput = addInput(content, "timelineCurveX", 420, 112, 96);
    addLabel(content, "timelineCurveYLabel", "Y", 528, 116, 16);
    const yInput = addInput(content, "timelineCurveY", 548, 112, 96);
    addLabel(content, "timelineCurveC1XLabel", "C1 X", 400, 146, 36);
    const c1xInput = addInput(content, "timelineCurveC1X", 442, 142, 74);
    addLabel(content, "timelineCurveC1YLabel", "Y", 528, 146, 16);
    const c1yInput = addInput(content, "timelineCurveC1Y", 548, 142, 96);
    addLabel(content, "timelineCurveC2XLabel", "C2 X", 400, 176, 36);
    const c2xInput = addInput(content, "timelineCurveC2X", 442, 172, 74);
    addLabel(content, "timelineCurveC2YLabel", "Y", 528, 176, 16);
    const c2yInput = addInput(content, "timelineCurveC2Y", 548, 172, 96);

    const addPointButton = addButton(content, "timelineCurveAddPoint", "Add Point", 400, 210, 78);
    const removePointButton = addButton(content, "timelineCurveRemovePoint", "Remove", 486, 210, 72);
    const fitButton = addButton(content, "timelineCurveFit", "Fit", 566, 210, 78);
    const resetButton = addButton(content, "timelineCurveReset", "Reset", 400, 240, 78);
    const clearButton = addButton(content, "timelineCurveClear", "No Path", 486, 240, 72);
    clearButton.visible = options.mode === "path";

    const toCanvas = (point: PathPoint): PathPoint => ({
        x: PLOT_PADDING + (point.x - bounds.minX) / (bounds.maxX - bounds.minX) * (PLOT_WIDTH - PLOT_PADDING * 2),
        y: PLOT_HEIGHT - PLOT_PADDING - (point.y - bounds.minY) / (bounds.maxY - bounds.minY) * (PLOT_HEIGHT - PLOT_PADDING * 2),
    });
    const fromCanvas = (point: PathPoint): PathPoint => ({
        x: bounds.minX + (point.x - PLOT_PADDING) / (PLOT_WIDTH - PLOT_PADDING * 2) * (bounds.maxX - bounds.minX),
        y: bounds.minY + (PLOT_HEIGHT - PLOT_PADDING - point.y) / (PLOT_HEIGHT - PLOT_PADDING * 2) * (bounds.maxY - bounds.minY),
    });

    const redraw = (): void => {
        const graphics = plot.displayObject.graphics;
        graphics.clear();
        const zero = toCanvas({ x: 0, y: 0 });
        if (zero.x >= 0 && zero.x <= PLOT_WIDTH) graphics.drawLine(zero.x, 0, zero.x, PLOT_HEIGHT, "#3b3b3b", 1);
        if (zero.y >= 0 && zero.y <= PLOT_HEIGHT) graphics.drawLine(0, zero.y, PLOT_WIDTH, zero.y, "#3b3b3b", 1);
        const samples = samplePath(points, 28);
        for (let index = 1; index < samples.length; index++) {
            const from = toCanvas(samples[index - 1]);
            const to = toCanvas(samples[index]);
            graphics.drawLine(from.x, from.y, to.x, to.y, "#57d6ff", 2);
        }
        const selected = points[selectedIndex];
        if (selected && (selected.curveType === 1 || selected.curveType === 2)) {
            const anchor = toCanvas(selected);
            const control1 = toCanvas({ x: selected.control1X, y: selected.control1Y });
            graphics.drawLine(anchor.x, anchor.y, control1.x, control1.y, "#8b8b8b", 1);
            graphics.drawCircle(control1.x, control1.y, 5, "#ef9f3f", "#ffffff", 1);
            if (selected.curveType === 2) {
                const control2 = toCanvas({ x: selected.control2X, y: selected.control2Y });
                const next = toCanvas(points[Math.min(points.length - 1, selectedIndex + 1)]);
                graphics.drawLine(next.x, next.y, control2.x, control2.y, "#8b8b8b", 1);
                graphics.drawCircle(control2.x, control2.y, 5, "#ef9f3f", "#ffffff", 1);
            }
        }
        points.forEach((point, index) => {
            const value = toCanvas(point);
            graphics.drawCircle(value.x, value.y, index === selectedIndex ? 6 : 4, index === selectedIndex ? "#57d6ff" : "#bdbdbd", "#ffffff", 1);
        });
    };

    const setInputEnabled = (value: NumericInput, enabled: boolean): void => {
        value.host.grayed = !enabled;
        value.host.touchable = enabled;
        value.input.editable = enabled;
    };
    const refreshPointCombo = (): void => {
        pointCombo.items = points.map((_, index) => `Point ${index + 1}`);
        pointCombo.values = points.map((_, index) => String(index));
        pointCombo.selectedIndex = Math.max(0, Math.min(selectedIndex, points.length - 1));
    };
    const loadSelectedPoint = (): void => {
        const point = points[selectedIndex];
        if (!point) return;
        typeCombo.selectedIndex = point.curveType;
        xInput.input.text = String(point.x);
        yInput.input.text = String(point.y);
        c1xInput.input.text = String(point.control1X);
        c1yInput.input.text = String(point.control1Y);
        c2xInput.input.text = String(point.control2X);
        c2yInput.input.text = String(point.control2Y);
        const endpointLocked = options.mode === "ease" && (selectedIndex === 0 || selectedIndex === points.length - 1);
        setInputEnabled(xInput, !endpointLocked);
        setInputEnabled(yInput, !endpointLocked);
        setInputEnabled(c1xInput, point.curveType === 1 || point.curveType === 2);
        setInputEnabled(c1yInput, point.curveType === 1 || point.curveType === 2);
        setInputEnabled(c2xInput, point.curveType === 2);
        setInputEnabled(c2yInput, point.curveType === 2);
        removePointButton.grayed = points.length <= 2 || endpointLocked;
        removePointButton.touchable = !removePointButton.grayed;
        redraw();
    };
    const updateSelectedPoint = (): void => {
        const point = points[selectedIndex];
        if (!point) return;
        point.curveType = Math.max(0, Math.min(3, Number(typeCombo.value))) as TimelinePathPoint["curveType"];
        const endpointLocked = options.mode === "ease" && (selectedIndex === 0 || selectedIndex === points.length - 1);
        if (!endpointLocked) {
            point.x = finiteInput(xInput.input, point.x);
            point.y = finiteInput(yInput.input, point.y);
        }
        point.control1X = finiteInput(c1xInput.input, point.control1X);
        point.control1Y = finiteInput(c1yInput.input, point.control1Y);
        point.control2X = finiteInput(c2xInput.input, point.control2X);
        point.control2Y = finiteInput(c2yInput.input, point.control2Y);
        loadSelectedPoint();
    };

    const stopDrag = (): void => {
        dragHandle = null;
        Laya.stage.off(Laya.Event.MOUSE_MOVE, dialog, onStageMouseMove);
        Laya.stage.off(Laya.Event.MOUSE_UP, dialog, stopDrag);
    };
    const onStageMouseMove = (): void => {
        if (!dragHandle) return;
        const local = plotHost.globalToLocal(Laya.stage.mouseX, Laya.stage.mouseY);
        const value = fromCanvas(local);
        const point = points[dragHandle.pointIndex];
        if (!point) return;
        const x = roundCoordinate(value.x, options.mode);
        const y = roundCoordinate(value.y, options.mode);
        if (dragHandle.kind === "anchor") {
            if (options.mode === "ease" && (dragHandle.pointIndex === 0 || dragHandle.pointIndex === points.length - 1)) return;
            const deltaX = x - point.x;
            const deltaY = y - point.y;
            point.x = x;
            point.y = y;
            if (point.curveType === 1 || point.curveType === 2) {
                point.control1X = roundCoordinate(point.control1X + deltaX, options.mode);
                point.control1Y = roundCoordinate(point.control1Y + deltaY, options.mode);
            }
            if (point.curveType === 2) {
                point.control2X = roundCoordinate(point.control2X + deltaX, options.mode);
                point.control2Y = roundCoordinate(point.control2Y + deltaY, options.mode);
            }
        } else if (dragHandle.kind === "control1") {
            point.control1X = x;
            point.control1Y = y;
        } else {
            point.control2X = x;
            point.control2Y = y;
        }
        selectedIndex = dragHandle.pointIndex;
        loadSelectedPoint();
    };
    const findHandle = (local: { x: number; y: number }): DragHandle | null => {
        const candidates: Array<{ handle: DragHandle; point: PathPoint }> = points.map((point, pointIndex) => ({
            handle: { kind: "anchor", pointIndex },
            point: toCanvas(point),
        }));
        const selected = points[selectedIndex];
        if (selected?.curveType === 1 || selected?.curveType === 2) {
            candidates.push({
                handle: { kind: "control1", pointIndex: selectedIndex },
                point: toCanvas({ x: selected.control1X, y: selected.control1Y }),
            });
        }
        if (selected?.curveType === 2) {
            candidates.push({
                handle: { kind: "control2", pointIndex: selectedIndex },
                point: toCanvas({ x: selected.control2X, y: selected.control2Y }),
            });
        }
        let match: { handle: DragHandle; distance: number } | null = null;
        for (const candidate of candidates) {
            const distance = Math.hypot(local.x - candidate.point.x, local.y - candidate.point.y);
            if (distance <= 10 && (!match || distance < match.distance)) match = { handle: candidate.handle, distance };
        }
        return match?.handle || null;
    };
    const onPlotMouseDown = (): void => {
        const local = plotHost.globalToLocal(Laya.stage.mouseX, Laya.stage.mouseY);
        const match = findHandle(local);
        if (!match) return;
        selectedIndex = match.pointIndex;
        refreshPointCombo();
        loadSelectedPoint();
        dragHandle = match;
        Laya.stage.on(Laya.Event.MOUSE_MOVE, dialog, onStageMouseMove);
        Laya.stage.on(Laya.Event.MOUSE_UP, dialog, stopDrag);
    };

    pointCombo.on(fgui.Events.STATE_CHANGED, dialog, () => {
        selectedIndex = Math.max(0, Number(pointCombo.value) || 0);
        loadSelectedPoint();
    });
    typeCombo.on(fgui.Events.STATE_CHANGED, dialog, updateSelectedPoint);
    for (const value of [xInput, yInput, c1xInput, c1yInput, c2xInput, c2yInput]) {
        value.input.on(Laya.Event.INPUT, dialog, updateSelectedPoint);
    }
    plotHost.on(Laya.Event.MOUSE_DOWN, dialog, onPlotMouseDown);
    addPointButton.onClick(dialog, () => {
        const insertIndex = options.mode === "ease"
            ? Math.min(points.length - 1, selectedIndex + 1)
            : selectedIndex + 1;
        const before = points[Math.max(0, insertIndex - 1)];
        const after = points[Math.min(points.length - 1, insertIndex)];
        const x = after && after !== before ? (before.x + after.x) / 2 : before.x + 100;
        const y = after && after !== before ? (before.y + after.y) / 2 : before.y;
        points.splice(insertIndex, 0, {
            curveType: 3,
            x,
            y,
            control1X: x,
            control1Y: y,
            control2X: x,
            control2Y: y,
            smooth: true,
        });
        selectedIndex = insertIndex;
        refreshPointCombo();
        bounds = calculateBounds(points, options.mode);
        loadSelectedPoint();
    });
    removePointButton.onClick(dialog, () => {
        const endpointLocked = options.mode === "ease" && (selectedIndex === 0 || selectedIndex === points.length - 1);
        if (points.length <= 2 || endpointLocked) return;
        points.splice(selectedIndex, 1);
        selectedIndex = Math.min(selectedIndex, points.length - 1);
        refreshPointCombo();
        bounds = calculateBounds(points, options.mode);
        loadSelectedPoint();
    });
    fitButton.onClick(dialog, () => {
        bounds = calculateBounds(points, options.mode);
        redraw();
    });
    resetButton.onClick(dialog, () => {
        points = clonePoints(options.defaultPoints);
        selectedIndex = 0;
        bounds = calculateBounds(points, options.mode);
        refreshPointCombo();
        loadSelectedPoint();
        hint.color = "#8ccf7e";
        hint.text = "Visual draft reset. Apply here, then apply the outer Timeline action to save it.";
    });
    clearButton.onClick(dialog, () => {
        points = [];
        options.onApply("");
        dialog.dispose();
    });

    const confirm = content.getChild("n1").asButton;
    const cancel = content.getChild("n3").asButton;
    confirm.title = "Apply Curve";
    confirm.setXY(448, 394);
    confirm.setSize(94, 22);
    cancel.title = "Cancel";
    cancel.setXY(550, 394);
    cancel.setSize(94, 22);
    confirm.onClick(dialog, () => {
        if (points.length < 2) {
            hint.color = "#ef6f6f";
            hint.text = "A path needs at least two points.";
            return;
        }
        if (options.mode === "ease" && !isValidCustomEasePath(points)) {
            hint.color = "#ef6f6f";
            hint.text = "Custom ease must start at 0,0 and end at 1,1.";
            return;
        }
        options.onApply(stringifyTimelinePathData(points));
        stopDrag();
        dialog.dispose();
    });
    cancel.onClick(dialog, () => {
        stopDrag();
        dialog.dispose();
    });
    dialog.on(Laya.Event.UNDISPLAY, dialog, stopDrag);

    refreshPointCombo();
    loadSelectedPoint();
    dialog.contentPane = content;
    dialog.show();
    return dialog;
}

export { createDefaultCustomEasePath };
