import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyUamTransaction } from "../../assets/resources/editor/runtime/openfairygui-backend-browser.js";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const { prepareGroupDisplayNodes, prepareUngroupDisplayNodes } = await importTypeScriptModule(
    "src/editor/commands/HighRiskAuthoringTransactions.ts",
);
const { createTransactionSaveTarget } = await importTypeScriptModule(
    "src/editor/services/BrowserLiveSessionBridge.ts",
);

const baseline = JSON.parse(
    readFileSync("assets/resources/editor/runtime/uam-baseline.json", "utf8"),
).uamProject;
const componentSelector = { packageId: "rbw1tv9t", componentResourceId: "kcy10" };
const selectors = ["n12", "n13"].map((displayNodeId) => ({ ...componentSelector, displayNodeId }));
const displayList = (project) => project.packages
    .find((pkg) => pkg.id === componentSelector.packageId).resources
    .find((resource) => resource.id === componentSelector.componentResourceId).component.displayList;

const grouped = prepareGroupDisplayNodes(baseline, selectors);
assert.equal(grouped.ok, true, JSON.stringify(grouped));
if (!grouped.ok) throw new Error(grouped.message);
assert.equal(grouped.transaction.operations.length, 3);
const groupId = grouped.transaction.operation.node.id;
const groupedProject = applyUamTransaction(structuredClone(baseline), grouped.transaction.operations);
assert.equal(displayList(groupedProject).find((node) => node.id === groupId)?.kind, "group");
assert.deepEqual(
    selectors.map(({ displayNodeId }) => displayList(groupedProject).find((node) => node.id === displayNodeId)?.group),
    [groupId, groupId],
);

const saveTarget = createTransactionSaveTarget(groupedProject, grouped.transaction.operations);
assert.equal(saveTarget.kind, "transactionBatch");
assert.equal(saveTarget.operations.length, 3);
assert.deepEqual(saveTarget.expected.slice(1).map((target) => target.value), [
    { group: groupId },
    { group: groupId },
]);

const ungrouped = prepareUngroupDisplayNodes(groupedProject, [{
    ...componentSelector,
    displayNodeId: groupId,
}]);
assert.equal(ungrouped.ok, true, JSON.stringify(ungrouped));
if (!ungrouped.ok) throw new Error(ungrouped.message);
const ungroupedProject = applyUamTransaction(groupedProject, ungrouped.transaction.operations);
assert.equal(displayList(ungroupedProject).some((node) => node.id === groupId), false);
assert.deepEqual(
    selectors.map(({ displayNodeId }) => displayList(ungroupedProject).find((node) => node.id === displayNodeId)?.group),
    ["", ""],
);
const regroupedProject = applyUamTransaction(ungroupedProject, ungrouped.transaction.inverseOperations);
assert.deepEqual(displayList(regroupedProject), displayList(groupedProject));
const restoredProject = applyUamTransaction(groupedProject, grouped.transaction.inverseOperations);
assert.equal(displayList(restoredProject).some((node) => node.id === groupId), false);
assert.deepEqual(
    selectors.map(({ displayNodeId }) => displayList(restoredProject).find((node) => node.id === displayNodeId)?.group),
    ["", ""],
);
assert.deepEqual(
    displayList(restoredProject).map((node) => node.id),
    displayList(baseline).map((node) => node.id),
);

const unsupported = prepareGroupDisplayNodes(baseline, [
    { ...componentSelector, displayNodeId: "n11" },
    selectors[0],
]);
assert.equal(unsupported.ok, false);
assert.equal(unsupported.code, "unsupported_group_member_kind");

console.log(JSON.stringify({
    ok: true,
    groupId,
    operationCount: grouped.transaction.operations.length,
    saveTargetCount: saveTarget.operations.length,
}));
