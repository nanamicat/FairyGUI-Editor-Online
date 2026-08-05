import assert from "node:assert/strict";
import {
    createDefaultCustomEasePath,
    isValidCustomEasePath,
    parseTimelinePathData,
    stringifyTimelinePathData,
} from "../../src/editor/model/TimelinePathData.ts";

const source = "2,0,0,0.5375,0.28,0.7575,0.865,1,0,1,1";
const points = parseTimelinePathData(source);
assert(points);
assert.equal(stringifyTimelinePathData(points), source);
assert.equal(points.length, 2);
assert.equal(points[0].control2Y, 0.865);
assert(isValidCustomEasePath(points));

const defaults = createDefaultCustomEasePath();
assert(isValidCustomEasePath(defaults));
assert.equal(parseTimelinePathData("2,0,0,broken"), null);
assert.equal(parseTimelinePathData("4,0,0"), null);

console.log(JSON.stringify({ ok: true, points: points.length }));
