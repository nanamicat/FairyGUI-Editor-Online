import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyUamTransaction } from "../../assets/resources/editor/runtime/openfairygui-backend-browser.js";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const {
    createTypedGearModel,
    getDisplayNodeGearEditorModel,
    prepareUpdateDisplayNodeGears,
} = await importTypeScriptModule("src/editor/commands/HighRiskAuthoringTransactions.ts");
const { createTransactionSaveTarget } = await importTypeScriptModule(
    "src/editor/services/BrowserLiveSessionBridge.ts",
);
const baseline = JSON.parse(readFileSync(
    new URL("../../assets/resources/editor/runtime/uam-baseline.json", import.meta.url),
    "utf8",
)).uamProject;
const entries = baseline.packages.flatMap((pkg) => (pkg.resources || []).flatMap((resource) =>
    (resource.component?.displayList || []).map((node) => ({ pkg, resource, node })),
));
const entry = entries.find(({ resource, node }) =>
    (resource.component.controllers || []).some((controller) => controller.pages?.length)
    && (node.gears || []).some((gear) => gear.kind === "xy")
    && (node.gears || []).some((gear) => gear.kind === "size"),
);
assert(entry, "Expected a display node with XY and Size gears.");
const selector = {
    packageId: entry.pkg.id,
    componentResourceId: entry.resource.id,
    displayNodeId: entry.node.id,
};
const model = getDisplayNodeGearEditorModel(baseline, selector);
assert(model);
assert(model.controllers.length > 0);

const gears = structuredClone(model.gears);
const xy = gears.find((gear) => gear.kind === "xy");
const size = gears.find((gear) => gear.kind === "size");
assert(xy && size);
const xyValue = xy.states.find((state) => state.value)?.value || xy.defaultValue;
const sizeValue = size.states.find((state) => state.value)?.value || size.defaultValue;
xyValue.x += 3;
sizeValue.width += 4;

const removableIndex = gears.findIndex((gear) => gear.kind !== "xy" && gear.kind !== "size");
assert.notEqual(removableIndex, -1);
const removed = gears.splice(removableIndex, 1)[0];
let created;
for (const kind of ["display2", "display", "look", "color", "text", "icon", "fontSize"]) {
    const result = createTypedGearModel(baseline, selector, kind, model.controllers[0].name);
    if (result.ok) {
        created = result.gear;
        break;
    }
}
assert(created, "Expected an unused typed gear kind.");
gears.push(created);

const prepared = prepareUpdateDisplayNodeGears(baseline, selector, gears);
assert.equal(prepared.ok, true, JSON.stringify(prepared));
if (!prepared.ok) throw new Error(prepared.message);
assert(prepared.transaction.operations.some((operation) => operation.kind === "removeGear" || operation.kind === "removeLookGear"));
assert(prepared.transaction.operations.some((operation) => operation.kind === "updateGear" || operation.kind === "updateLookGear"));
assert(prepared.transaction.operations.some((operation) => operation.kind === "addGear" || operation.kind === "addLookGear"));

const updated = applyUamTransaction(baseline, prepared.transaction.operations);
const updatedNode = updated.packages
    .find((pkg) => pkg.id === selector.packageId).resources
    .find((resource) => resource.id === selector.componentResourceId).component.displayList
    .find((node) => node.id === selector.displayNodeId);
assert.equal(updatedNode.gears.some((gear) => gear.kind === removed.kind && gear.controllerName === removed.controllerName), false);
assert.equal(updatedNode.gears.some((gear) => gear.kind === created.kind && gear.controllerName === created.controllerName), true);
const saveTarget = createTransactionSaveTarget(updated, prepared.transaction.operations);
assert.equal(saveTarget.kind, "transactionBatch");
assert.equal(saveTarget.expected.every((target) => target.entity === "gear"), true);

const restored = applyUamTransaction(updated, prepared.transaction.inverseOperations);
const restoredNode = restored.packages
    .find((pkg) => pkg.id === selector.packageId).resources
    .find((resource) => resource.id === selector.componentResourceId).component.displayList
    .find((node) => node.id === selector.displayNodeId);
const sortGears = (items) => structuredClone(items).sort((left, right) =>
    `${left.kind}\u0000${left.controllerName}`.localeCompare(`${right.kind}\u0000${right.controllerName}`),
);
assert.deepEqual(sortGears(restoredNode.gears), sortGears(entry.node.gears));

assert.equal(prepareUpdateDisplayNodeGears(baseline, selector, [model.gears[0], model.gears[0]]).code, "duplicate_gear");
const badPage = structuredClone(model.gears);
badPage.find((gear) => gear.kind === "xy").states[0].pageId = "missing";
assert.equal(prepareUpdateDisplayNodeGears(baseline, selector, badPage).code, "invalid_gear_states");
const badNumber = structuredClone(model.gears);
badNumber.find((gear) => gear.kind === "xy").defaultValue.x = "1";
assert.equal(prepareUpdateDisplayNodeGears(baseline, selector, badNumber).code, "invalid_gear_value");
const badCondition = structuredClone(model.gears);
const display2 = badCondition.find((gear) => gear.kind === "display2");
if (display2) {
    display2.condition = "xor";
    assert.equal(prepareUpdateDisplayNodeGears(baseline, selector, badCondition).code, "invalid_display2_condition");
}

console.log(JSON.stringify({
    ok: true,
    selector,
    operations: prepared.transaction.operations.map((operation) => operation.kind),
    removed: `${removed.kind}:${removed.controllerName}`,
    added: `${created.kind}:${created.controllerName}`,
    inverseRestored: true,
}));
