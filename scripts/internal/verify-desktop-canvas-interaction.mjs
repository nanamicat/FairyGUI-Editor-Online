import assert from "node:assert/strict";
import {
    createDesktopCanvasPositionCommands,
    createDesktopCanvasRotationCommands,
    createDesktopCanvasTransformCommands,
    getDesktopCanvasMarqueeSelection,
    getDesktopCanvasNudge,
    getDesktopCanvasBounds,
    hasDesktopCanvasDragMoved,
    inferDesktopCanvasColumnCount,
    inferDesktopCanvasSpacing,
    resolveDesktopCanvasDragPosition,
    resolveDesktopCanvasAlignment,
    resolveDesktopCanvasCustomArrange,
    resolveDesktopCanvasGraphPoint,
    resolveDesktopCanvasRegularPolygonDistance,
    resolveDesktopCanvasGroupRotation,
    resolveDesktopCanvasGroupResize,
    resolveDesktopCanvasPivot,
    resolveDesktopCanvasSharedValue,
    resolveDesktopCanvasRect,
    resolveDesktopCanvasResize,
    resolveDesktopCanvasRotation,
    snapDesktopCanvasValue,
} from "../../src/editor/runtime/DesktopCanvasInteraction.ts";

const commandContext = {
    packageId: "pkg",
    componentResourceId: "component",
    nodes: [
        { id: "a", x: 1, y: 2, width: 10, height: 20, rotation: 0 },
        { id: "b", x: 10, y: 20, width: 30, height: 40, rotation: 15 },
    ],
};
assert.deepEqual(
    createDesktopCanvasPositionCommands(commandContext, [
        { nodeId: "a", x: 1.4, y: 2.4 },
        { nodeId: "b", x: 12.6, y: 20.1 },
    ]),
    [{
        kind: "setDisplayNodeProps",
        selector: { packageId: "pkg", componentResourceId: "component", displayNodeId: "b" },
        props: { position: { x: 13, y: 20 } },
    }],
    "Canvas position command construction must round once and omit unchanged nodes.",
);
assert.equal(
    resolveDesktopCanvasRegularPolygonDistance({ x: 100, y: 50 }, 100, 100),
    1,
    "Regular-polygon handles must expose a normalized radius from the graph center.",
);
assert.deepEqual(
    createDesktopCanvasTransformCommands(commandContext, [
        { nodeId: "a", x: 1, y: 2, width: 10, height: 20 },
        { nodeId: "b", x: 11, y: 20, width: 0.2, height: 40 },
    ]),
    [{
        kind: "setDisplayNodeProps",
        selector: { packageId: "pkg", componentResourceId: "component", displayNodeId: "b" },
        props: { position: { x: 11, y: 20 }, size: { width: 1, height: 40 } },
    }],
    "Canvas transform command construction must preserve the positive-size contract.",
);
assert.deepEqual(
    createDesktopCanvasRotationCommands(commandContext, [
        { nodeId: "a", x: 1, y: 2, rotation: 0 },
        { nodeId: "b", x: 12, y: 21, rotation: 29.6 },
    ]),
    [{
        kind: "setDisplayNodeProps",
        selector: { packageId: "pkg", componentResourceId: "component", displayNodeId: "b" },
        props: { position: { x: 12, y: 21 }, rotation: 30 },
    }],
    "Canvas rotation command construction must keep position and rotation atomic.",
);
assert.equal(
    createDesktopCanvasPositionCommands(commandContext, [{ nodeId: "a", x: 1, y: 2 }]),
    null,
    "Canvas command construction must reject a partial selected-node target set.",
);

assert.equal(
    hasDesktopCanvasDragMoved({ x: 10, y: 10 }, { x: 12, y: 11 }),
    false,
    "Small pointer jitter must remain a click.",
);
assert.equal(
    hasDesktopCanvasDragMoved({ x: 10, y: 10 }, { x: 13, y: 10 }),
    true,
    "A three-pixel pointer move must start dragging.",
);
assert.deepEqual(
    resolveDesktopCanvasDragPosition(
        { x: 40, y: 25 },
        { x: 100.2, y: 80.4 },
        { x: 112.8, y: 74.8 },
    ),
    { x: 53, y: 19 },
    "Drag position must preserve the authoring origin and round once.",
);
assert.deepEqual(getDesktopCanvasNudge("ArrowLeft", false), { x: -1, y: 0 });
assert.deepEqual(getDesktopCanvasNudge("ArrowDown", true), { x: 0, y: 10 });
assert.equal(getDesktopCanvasNudge("Enter", false), null);
assert.deepEqual(
    resolveDesktopCanvasRect({ x: 30, y: 40 }, { x: 10, y: 15 }),
    { x: 10, y: 15, width: 20, height: 25 },
    "Marquee geometry must work in every drag direction.",
);
assert.deepEqual(
    getDesktopCanvasMarqueeSelection([
        { id: "inside", x: 12, y: 16, width: 4, height: 4 },
        { id: "crossing", x: 5, y: 20, width: 10, height: 10 },
        { id: "outside", x: 31, y: 20, width: 5, height: 5 },
        { id: "touching-edge", x: 30, y: 20, width: 5, height: 5 },
    ], { x: 10, y: 15, width: 20, height: 25 }),
    ["inside", "crossing"],
    "Marquee selection must include visual intersections but not edge-only contact.",
);
assert.deepEqual(
    resolveDesktopCanvasResize(
        { width: 100, height: 80 },
        { x: 20, y: 20 },
        { x: 35.4, y: 9.6 },
    ),
    { width: 115, height: 70 },
    "Resize must use authoring-coordinate pointer deltas.",
);
assert.deepEqual(
    resolveDesktopCanvasResize(
        { width: 10, height: 10 },
        { x: 20, y: 20 },
        { x: -50, y: -50 },
    ),
    { width: 1, height: 1 },
    "Resize must preserve the positive-size transaction contract.",
);
const group = [
    { id: "left", x: 10, y: 20, width: 20, height: 10 },
    { id: "right", x: 50, y: 40, width: 10, height: 20 },
];
assert.deepEqual(
    getDesktopCanvasBounds(group),
    { x: 10, y: 20, width: 50, height: 40 },
);
assert.deepEqual(
    resolveDesktopCanvasGroupResize(group, { width: 100, height: 80 }),
    [
        { id: "left", x: 10, y: 20, width: 40, height: 20 },
        { id: "right", x: 90, y: 60, width: 20, height: 40 },
    ],
    "Group resize must scale position and size from the shared top-left anchor.",
);
assert.equal(snapDesktopCanvasValue(13), 16);
assert.equal(snapDesktopCanvasValue(-5), -8);
assert.equal(
    resolveDesktopCanvasRotation(
        0,
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
    ),
    90,
);
assert.equal(
    resolveDesktopCanvasRotation(
        7,
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 8, y: 5 },
        15,
    ),
    45,
);
assert.deepEqual(
    resolveDesktopCanvasPivot(
        { x: 10, y: 20 },
        { x: 0, y: 0 },
        { width: 100, height: 50 },
        { x: 1, y: 1 },
        30,
        false,
        { x: 60, y: 45 },
    ),
    { x: 10, y: 20, pivotX: 0.5, pivotY: 0.5 },
    "Non-anchor pivot dragging must preserve the authoring position.",
);
assert.deepEqual(
    resolveDesktopCanvasPivot(
        { x: 100, y: 100 },
        { x: 0.5, y: 0.5 },
        { width: 100, height: 50 },
        { x: 1, y: 1 },
        90,
        true,
        { x: 75, y: 125 },
    ),
    { x: 75, y: 125, pivotX: 0.75, pivotY: 1 },
    "Anchor pivot dragging must move the anchor while preserving rotated visual geometry.",
);
assert.deepEqual(
    resolveDesktopCanvasPivot(
        { x: 100, y: 100 },
        { x: 0.5, y: 0.5 },
        { width: 100, height: 50 },
        { x: 2, y: 0.5 },
        0,
        true,
        { x: 150, y: 112.5 },
    ),
    { x: 150, y: 113, pivotX: 0.75, pivotY: 1 },
    "Anchor pivot dragging must preserve geometry for scaled display nodes.",
);
assert.deepEqual(
    resolveDesktopCanvasPivot(
        { x: 10, y: 20 },
        { x: 0, y: 0 },
        { width: 100, height: 50 },
        { x: 1, y: 1 },
        0,
        false,
        { x: 500, y: -50 },
    ),
    { x: 10, y: 20, pivotX: 1, pivotY: 0 },
    "Canvas pivot dragging must stay inside the normalized pivot range.",
);
const polygonPoints = [0, 52, 95, 52, 154, 64];
assert.deepEqual(
    resolveDesktopCanvasGraphPoint(polygonPoints, 1, { x: 101.4, y: 47.6 }),
    [0, 52, 101, 48, 154, 64],
    "Polygon point dragging must update one local point without mutating the source array.",
);
assert.deepEqual(polygonPoints, [0, 52, 95, 52, 154, 64]);
assert.deepEqual(
    resolveDesktopCanvasGraphPoint(polygonPoints, 2, { x: 149, y: 71 }, 8),
    [0, 52, 95, 52, 152, 72],
    "Polygon point dragging must reuse the canvas grid snap when enabled.",
);
assert.deepEqual(
    resolveDesktopCanvasGraphPoint(polygonPoints, 1, { x: 103, y: 60 }, 0, true),
    [8, 60, 103, 60, 162, 72],
    "Locked polygon point dragging must preserve the shape by translating every point.",
);
assert.deepEqual(
    resolveDesktopCanvasGraphPoint(polygonPoints, 9, { x: 1, y: 2 }),
    polygonPoints,
    "An invalid polygon handle index must leave the point list unchanged.",
);
assert.equal(resolveDesktopCanvasSharedValue([0.5, 0.5, 0.5]), 0.5);
assert.equal(resolveDesktopCanvasSharedValue([true, false]), undefined);
assert.equal(resolveDesktopCanvasSharedValue([]), undefined);
assert.deepEqual(
    resolveDesktopCanvasGroupRotation([
        { id: "left", x: 10, y: 20, rotation: 0 },
        { id: "right", x: 50, y: 40, rotation: 30 },
    ], { x: 30, y: 30 }, 90),
    [
        { id: "left", x: 40, y: 10, rotation: 90 },
        { id: "right", x: 20, y: 50, rotation: 120 },
    ],
    "Group rotation must rotate anchors and local rotations around the shared center.",
);
assert.deepEqual(
    resolveDesktopCanvasGroupRotation([
        { id: "single", x: 10, y: 20, rotation: 7 },
    ], { x: 30, y: 30 }, 15),
    [{ id: "single", x: 10, y: 20, rotation: 22 }],
    "Single rotation must preserve its authoring position.",
);
const alignmentItems = [
    { id: "first", x: 10, y: 20, width: 10, height: 10 },
    { id: "primary", x: 40, y: 50, width: 20, height: 20 },
    { id: "last", x: 100, y: 100, width: 10, height: 10 },
];
assert.deepEqual(
    resolveDesktopCanvasAlignment(alignmentItems, "centerX", "primary")
        .map(({ id, x }) => ({ id, x })),
    [
        { id: "first", x: 55 },
        { id: "primary", x: 50 },
        { id: "last", x: 55 },
    ],
);
assert.deepEqual(
    resolveDesktopCanvasAlignment(alignmentItems, "sameWidth", "primary")
        .map(({ id, width }) => ({ id, width })),
    [
        { id: "first", width: 20 },
        { id: "primary", width: 20 },
        { id: "last", width: 20 },
    ],
);
assert.equal(
    resolveDesktopCanvasAlignment(alignmentItems, "distributeX", "primary")[1].x,
    50,
);
const arrangeItems = [
    { id: "a", x: 10, y: 20, width: 10, height: 10 },
    { id: "b", x: 30, y: 20, width: 15, height: 10 },
    { id: "c", x: 10, y: 50, width: 10, height: 20 },
    { id: "d", x: 35, y: 50, width: 10, height: 20 },
    { id: "e", x: 70, y: 90, width: 8, height: 8 },
];
assert.equal(inferDesktopCanvasSpacing(arrangeItems, "x"), 10);
assert.equal(inferDesktopCanvasSpacing(arrangeItems, "y"), 20);
assert.equal(inferDesktopCanvasColumnCount(arrangeItems), 2);
assert.deepEqual(
    resolveDesktopCanvasCustomArrange(arrangeItems, "table", {
        columnCount: 2,
        columnSpacing: 4,
        lineSpacing: 3,
    }).map(({ id, x, y }) => ({ id, x, y })),
    [
        { id: "a", x: 10, y: 20 },
        { id: "b", x: 24, y: 20 },
        { id: "c", x: 10, y: 33 },
        { id: "d", x: 24, y: 33 },
        { id: "e", x: 10, y: 56 },
    ],
    "Table arrange must preserve top-left origin and apply row height plus configured spacing.",
);
assert.deepEqual(
    resolveDesktopCanvasCustomArrange(arrangeItems.slice(0, 3), "rows", {
        columnCount: 1,
        columnSpacing: 0,
        lineSpacing: 3,
    }).map(({ id, y }) => ({ id, y })),
    [
        { id: "a", y: 20 },
        { id: "b", y: 33 },
        { id: "c", y: 46 },
    ],
);

console.log(JSON.stringify({
    ok: true,
    verified: [
        "three-pixel drag threshold",
        "pure position, transform, and rotation command construction",
        "authoring-coordinate drag delta",
        "one-pixel keyboard nudge",
        "ten-pixel coarse keyboard nudge",
        "bidirectional marquee geometry",
        "visual-bound marquee intersection",
        "authoring-coordinate resize delta",
        "positive resize minimum",
        "shared-anchor group resize",
        "eight-pixel grid snap",
        "rotation angle and fifteen-degree snap",
        "single-node pivot drag with anchor-preserving rotation math",
        "polygon points plus regular-polygon radius handles",
        "shared and mixed multi-selection property values",
        "shared-center group rotation",
        "selection alignment, primary-size matching, and even distribution",
        "reference-compatible custom row, column, and table arrangement",
    ],
}, null, 2));
