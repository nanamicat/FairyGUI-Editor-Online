import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyUamTransaction } from "../../assets/resources/editor/runtime/openfairygui-backend-browser.js";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const {
    getDisplayNodeRelationModel,
    prepareUpdateDisplayNodeRelations,
} = await importTypeScriptModule("src/editor/commands/HighRiskAuthoringTransactions.ts");
const { createTransactionSaveTarget } = await importTypeScriptModule(
    "src/editor/services/BrowserLiveSessionBridge.ts",
);
const baseline = JSON.parse(readFileSync(
    new URL("../../assets/resources/editor/runtime/uam-baseline.json", import.meta.url),
    "utf8",
)).uamProject;
const pkg = baseline.packages.find((candidate) => candidate.name === "Bag");
const component = pkg.resources.find((resource) => resource.name === "BagWin");
const selector = {
    packageId: pkg.id,
    componentResourceId: component.id,
    displayNodeId: "n12",
};
const relations = [
    { targetNodeId: "", type: 11, usePercent: true },
    { targetNodeId: "n11", type: 0, usePercent: false },
];

const model = getDisplayNodeRelationModel(baseline, selector);
assert(model);
assert.equal(model.targets.some((target) => target.id === "n11"), true);

const prepared = prepareUpdateDisplayNodeRelations(baseline, selector, relations);
assert.equal(prepared.ok, true, JSON.stringify(prepared));
if (!prepared.ok) throw new Error(prepared.message);
assert.deepEqual(prepared.transaction.operations.map((operation) => operation.kind), [
    "detachDisplayNode",
    "attachDisplayNode",
]);

const updated = applyUamTransaction(baseline, prepared.transaction.operations);
const updatedNode = updated.packages
    .find((candidate) => candidate.id === selector.packageId).resources
    .find((resource) => resource.id === selector.componentResourceId).component.displayList
    .find((node) => node.id === selector.displayNodeId);
assert.deepEqual(updatedNode.relations, relations);

const saveTarget = createTransactionSaveTarget(updated, prepared.transaction.operations);
assert.equal(saveTarget.kind, "transactionBatch");
assert.deepEqual(saveTarget.expected[1].value.relations, relations);

const restored = applyUamTransaction(updated, prepared.transaction.inverseOperations);
const restoredNode = restored.packages
    .find((candidate) => candidate.id === selector.packageId).resources
    .find((resource) => resource.id === selector.componentResourceId).component.displayList
    .find((node) => node.id === selector.displayNodeId);
assert.deepEqual(restoredNode.relations, []);

assert.equal(prepareUpdateDisplayNodeRelations(baseline, selector, [
    { targetNodeId: selector.displayNodeId, type: 0, usePercent: false },
]).code, "invalid_relation_target");
assert.equal(prepareUpdateDisplayNodeRelations(baseline, selector, [
    relations[0],
    relations[0],
]).code, "duplicate_relation");
assert.equal(prepareUpdateDisplayNodeRelations(baseline, selector, [
    { targetNodeId: "", type: 24, usePercent: false },
]).code, "invalid_relation");
assert.equal(prepareUpdateDisplayNodeRelations(baseline, selector, [
    { targetNodeId: "", type: "0", usePercent: false },
]).code, "invalid_relation");
assert.equal(prepareUpdateDisplayNodeRelations(baseline, selector, [
    { targetNodeId: 0, type: 0, usePercent: false },
]).code, "invalid_relation_target");

console.log(JSON.stringify({
    ok: true,
    selector,
    relations,
    operations: prepared.transaction.operations.map((operation) => operation.kind),
    inverseRestored: restoredNode.relations.length === 0,
}));
