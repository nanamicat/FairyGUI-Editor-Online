import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const {
    createTransitionItemModel,
    getTransitionItemModel,
    prepareAddTransitionItemModel,
    prepareDuplicateTransitionItem,
    prepareRemoveTransitionItem,
    prepareUpdateTransitionItemModel,
    prepareUpdateTransitionItemTiming,
} = await importTypeScriptModule(
    "src/editor/commands/HighRiskAuthoringTransactions.ts",
);
const { applyUamTransaction } = await import(pathToFileURL(path.resolve(
    process.argv[2] ?? "assets/resources/editor/runtime/openfairygui-backend-browser.js",
)).href);
const baseline = JSON.parse(
    await readFile("assets/resources/editor/runtime/uam-baseline.json", "utf8"),
).uamProject;
const selector = { packageId: "c0hnre6o", componentResourceId: "espx1h" };
const original = structuredClone(baseline);
const prepared = prepareUpdateTransitionItemTiming(
    baseline,
    selector,
    "t0",
    1,
    { time: 12, duration: 144, tween: true },
);

assert.equal(prepared.ok, true);
assert.deepEqual(baseline, original, "preparing a drag must not mutate the live project");
assert.equal(prepared.transaction.operation.kind, "updateTransition");
assert.deepEqual(prepared.transaction.operation.selector, {
    ...selector,
    transitionName: "t0",
});
assert.deepEqual(
    prepared.transaction.operation.transition.items[1],
    {
        ...prepared.transaction.inverseOperation.transition.items[1],
        time: 12,
        duration: 144,
    },
);
assert.equal(
    prepareUpdateTransitionItemTiming(
        baseline,
        selector,
        "t0",
        1,
        { time: -1, duration: 144, tween: true },
    ).code,
    "invalid_transition_item_timing",
);
assert.equal(
    prepareUpdateTransitionItemTiming(
        baseline,
        { packageId: "c0hnre6o", componentResourceId: "lvxry" },
        "t0",
        1,
        { time: 1, duration: 12, tween: true },
    ).code,
    "transition_dangling_target",
    "editing must retain the existing dangling-target preflight guard",
);

const duplicate = prepareDuplicateTransitionItem(baseline, selector, "t0", 1);
assert.equal(duplicate.ok, true);
const duplicatedProject = applyUamTransaction(
    structuredClone(baseline),
    [duplicate.transaction.operation],
);
const findTransition = (project) => project.packages
    .find((pkg) => pkg.id === selector.packageId).resources
    .find((resource) => resource.id === selector.componentResourceId).component.transitions
    .find((transition) => transition.name === "t0");
const baselineTransition = findTransition(baseline);
const duplicatedTransition = findTransition(duplicatedProject);
assert.equal(duplicatedTransition.items.length, baselineTransition.items.length + 1);
assert.equal(
    duplicatedTransition.items[2].time,
    baselineTransition.items[1].time + Math.max(1, baselineTransition.items[1].duration),
);
const duplicateRestored = applyUamTransaction(
    duplicatedProject,
    [duplicate.transaction.inverseOperation],
);
assert.deepEqual(findTransition(duplicateRestored), baselineTransition);

const remove = prepareRemoveTransitionItem(baseline, selector, "t0", 1);
assert.equal(remove.ok, true);
assert.equal(remove.transaction.operation.transition.items.length, baselineTransition.items.length - 1);

const addedItem = createTransitionItemModel(14, baselineTransition.items[0].targetNodeId, 6);
addedItem.startValue = ["Typed timeline text"];
const add = prepareAddTransitionItemModel(baseline, selector, "t0", addedItem);
assert.equal(add.ok, true);
assert.equal(add.transaction.operation.transition.items.length, baselineTransition.items.length + 1);
assert.deepEqual(add.transaction.operation.transition.items.at(-1), addedItem);
assert.equal(
    prepareAddTransitionItemModel(baseline, selector, "t0", {
        ...addedItem,
        tween: true,
    }).code,
    "invalid_transition_item_model",
    "non-tween transition action types must reject tween state",
);

const soundItem = createTransitionItemModel(9, "", 8);
soundItem.startValue = ["ui://c0hnre6olvxrs", "75"];
const addSound = prepareAddTransitionItemModel(baseline, selector, "t0", soundItem);
assert.equal(addSound.ok, true);
assert.deepEqual(addSound.transaction.operation.transition.items.at(-1).startValue, soundItem.startValue);
assert.equal(
    prepareAddTransitionItemModel(baseline, selector, "t0", {
        ...soundItem,
        startValue: ["", "75"],
    }).code,
    "invalid_transition_item_model",
);
assert.equal(
    prepareAddTransitionItemModel(baseline, selector, "t0", {
        ...soundItem,
        startValue: ["ui://c0hnre6olvxrs", "101"],
    }).code,
    "invalid_transition_item_model",
);

const editedItem = getTransitionItemModel(baseline, selector, "t0", 1);
editedItem.startValue = ["42", "24"];
editedItem.endValue = ["84", "48"];
editedItem.easeType = 31;
editedItem.path = "2,0,0,14,8,28,16,1,0,42,24";
editedItem.customEasePath = "2,0,0,0.5375,0.28,0.7575,0.865,1,0,1,1";
const edit = prepareUpdateTransitionItemModel(baseline, selector, "t0", 1, editedItem);
assert.equal(edit.ok, true);
assert.deepEqual(edit.transaction.operation.transition.items[1].startValue, ["42", "24"]);
assert.equal(edit.transaction.operation.transition.items[1].easeType, 31);
assert.equal(edit.transaction.operation.transition.items[1].path, editedItem.path);
assert.equal(edit.transaction.operation.transition.items[1].customEasePath, editedItem.customEasePath);
assert.equal(
    prepareUpdateTransitionItemModel(baseline, selector, "t0", 1, {
        ...editedItem,
        path: "M0,0 L1,1",
    }).code,
    "invalid_transition_item_model",
    "motion paths must use FairyGUI GPathPoint data",
);
assert.equal(
    prepareUpdateTransitionItemModel(baseline, selector, "t0", 1, {
        ...editedItem,
        customEasePath: "2,0,0,0.25,0.1,0.25,1,1,0,2,1",
    }).code,
    "invalid_transition_item_model",
    "custom ease must end at 1,1",
);
assert.equal(
    prepareUpdateTransitionItemModel(baseline, selector, "t0", 1, {
        ...editedItem,
        startValue: "invalid",
    }).code,
    "invalid_transition_item_model",
);

console.log(JSON.stringify({
    ok: true,
    verified: [
        "timeline drag prepares one public updateTransition operation",
        "timeline item duplicate/remove use one reversible updateTransition",
        "typed timeline item add uses one reversible updateTransition",
        "sound actions require a FairyGUI resource URL and integer volume from 0 to 100",
        "timeline item values, FairyGUI path data, and custom ease are editable through validated UAM JSON",
        "inverse retains the original timing",
        "preparation does not mutate the live project",
        "negative timing is rejected",
        "dangling transition targets remain rejected",
    ],
}, null, 2));
