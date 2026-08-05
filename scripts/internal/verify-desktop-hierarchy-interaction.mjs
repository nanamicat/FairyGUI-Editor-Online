import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveDesktopHierarchyDropIndex } from "../../src/editor/runtime/DesktopHierarchyInteraction.ts";
import {
    getDesktopGroupPath,
    getDesktopGroupScopeNodeIds,
    reconcileDesktopGroupPath,
} from "../../src/editor/runtime/DesktopGroupIsolation.ts";

assert.equal(resolveDesktopHierarchyDropIndex(0, 2, true, 4), 2);
assert.equal(resolveDesktopHierarchyDropIndex(3, 1, false, 4), 1);
assert.equal(resolveDesktopHierarchyDropIndex(1, 2, true, 4), 2);
assert.equal(resolveDesktopHierarchyDropIndex(2, 1, false, 4), 1);
assert.equal(resolveDesktopHierarchyDropIndex(0, 1, false, 4), null);
assert.equal(resolveDesktopHierarchyDropIndex(2, 1, true, 4), null);
assert.equal(resolveDesktopHierarchyDropIndex(0, 0, true, 4), null);

const report = JSON.parse(await readFile(
    path.resolve("assets/resources/editor/runtime/uam-baseline.json"),
    "utf8",
));
const baseline = report.uamProject;
const owner = { packageId: "rbw1tv9t", componentResourceId: "kcy10" };
const selectors = ["n8", "n10"].map((displayNodeId) => ({ ...owner, displayNodeId }));
const { prepareAdjustDisplayNodeDepth, prepareRenameDisplayNode, prepareReplaceDisplayNodes } = await importTypeScriptModule(
    "src/editor/commands/HighRiskAuthoringTransactions.ts",
);
const { applyUamTransaction } = await import(pathToFileURL(path.resolve(
    process.argv[2] ?? "assets/resources/editor/runtime/openfairygui-backend-browser.js",
)).href);
const displayIds = (project) => project.packages
    .find((pkg) => pkg.id === owner.packageId).resources
    .find((resource) => resource.id === owner.componentResourceId).component.displayList
    .map((node) => node.id);

for (const [direction, expected] of [
    ["forward", ["n7", "n9", "n8", "n11", "n10", "n12", "n13", "n25_osdo"]],
    ["backward", ["n8", "n7", "n10", "n9", "n11", "n12", "n13", "n25_osdo"]],
    ["top", ["n7", "n9", "n11", "n12", "n13", "n25_osdo", "n8", "n10"]],
    ["bottom", ["n8", "n10", "n7", "n9", "n11", "n12", "n13", "n25_osdo"]],
]) {
    const prepared = prepareAdjustDisplayNodeDepth(baseline, selectors, direction);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const moved = applyUamTransaction(structuredClone(baseline), prepared.transaction.operations);
    assert.deepEqual(displayIds(moved), expected);
    const restored = applyUamTransaction(moved, prepared.transaction.inverseOperations);
    assert.deepEqual(displayIds(restored), displayIds(baseline));
}
assert.equal(
    prepareAdjustDisplayNodeDepth(baseline, [{ ...owner, displayNodeId: "n25_osdo" }], "forward").code,
    "display_node_depth_unchanged",
);

const renameSelector = { ...owner, displayNodeId: "n12" };
const originalRenameName = baseline.packages.find((pkg) => pkg.id === owner.packageId).resources
    .find((resource) => resource.id === owner.componentResourceId).component.displayList
    .find((node) => node.id === renameSelector.displayNodeId).name;
const renamed = prepareRenameDisplayNode(baseline, renameSelector, "renamed-node");
assert.equal(renamed.ok, true, JSON.stringify(renamed));
const renamedProject = applyUamTransaction(structuredClone(baseline), renamed.transaction.operations);
const findRenamedNode = (project) => project.packages.find((pkg) => pkg.id === owner.packageId).resources
    .find((resource) => resource.id === owner.componentResourceId).component.displayList
    .find((node) => node.id === renameSelector.displayNodeId);
assert.equal(findRenamedNode(renamedProject).name, "renamed-node");
assert.equal(findRenamedNode(applyUamTransaction(renamedProject, renamed.transaction.inverseOperations)).name, originalRenameName);

const replaceSelectors = ["n12", "n13"].map((displayNodeId) => ({ ...owner, displayNodeId }));
const replaced = prepareReplaceDisplayNodes(baseline, replaceSelectors, "graph");
assert.equal(replaced.ok, true, JSON.stringify(replaced));
assert.deepEqual(
    replaced.transaction.operations.map((operation) => operation.kind),
    ["detachDisplayNode", "detachDisplayNode", "attachDisplayNode", "attachDisplayNode"],
);
const replacedProject = applyUamTransaction(structuredClone(baseline), replaced.transaction.operations);
const replacedNodes = replacedProject.packages.find((pkg) => pkg.id === owner.packageId).resources
    .find((resource) => resource.id === owner.componentResourceId).component.displayList
    .filter((node) => ["n12", "n13"].includes(node.id));
assert.deepEqual(replacedNodes.map((node) => node.kind), ["graph", "graph"]);
assert.deepEqual(replacedNodes.map((node) => node.position), [{ x: 205, y: 461 }, { x: 336, y: 461 }]);
const restoredReplace = applyUamTransaction(replacedProject, replaced.transaction.inverseOperations);
const restoredNodes = restoredReplace.packages.find((pkg) => pkg.id === owner.packageId).resources
    .find((resource) => resource.id === owner.componentResourceId).component.displayList
    .filter((node) => ["n12", "n13"].includes(node.id));
assert.deepEqual(restoredNodes.map((node) => node.kind), ["text", "text"]);
assert.deepEqual(restoredNodes.map((node) => node.position), [{ x: 205, y: 461 }, { x: 336, y: 461 }]);

const replacedWithResource = prepareReplaceDisplayNodes(
    baseline,
    [{ ...owner, displayNodeId: "n12" }],
    { packageId: owner.packageId, resourceId: "thi7g" },
);
assert.equal(replacedWithResource.ok, true, JSON.stringify(replacedWithResource));
const resourceProject = applyUamTransaction(structuredClone(baseline), replacedWithResource.transaction.operations);
const resourceNode = resourceProject.packages.find((pkg) => pkg.id === owner.packageId).resources
    .find((resource) => resource.id === owner.componentResourceId).component.displayList
    .find((node) => node.id === "n12");
assert.equal(resourceNode.kind, "image");
assert.equal(resourceNode.resource.resourceId, "thi7g");
assert.equal(resourceNode.resource.packageId, undefined);

const groupedBaseline = structuredClone(baseline);
groupedBaseline.packages.find((pkg) => pkg.id === owner.packageId).resources
    .find((resource) => resource.id === owner.componentResourceId).component.displayList
    .find((node) => node.id === "n12").group = "some-group";
assert.equal(
    prepareReplaceDisplayNodes(groupedBaseline, [{ ...owner, displayNodeId: "n12" }], "loader").code,
    "display_node_group_unsupported",
);

const groupNodes = [
    { id: "root-group", type: "GGroup", group: "" },
    { id: "nested-group", type: "GGroup", group: "root-group" },
    { id: "root-member", type: "GImage", group: "root-group" },
    { id: "nested-member", type: "GTextField", group: "nested-group" },
    { id: "outside", type: "GImage", group: "" },
];
assert.deepEqual(getDesktopGroupPath(groupNodes, "nested-group"), ["root-group", "nested-group"]);
assert.deepEqual(
    reconcileDesktopGroupPath(groupNodes, ["root-group", "nested-group", "missing"]),
    ["root-group", "nested-group"],
);
assert.deepEqual(
    getDesktopGroupScopeNodeIds(groupNodes, ["root-group"]),
    ["nested-group", "root-member"],
);
assert.deepEqual(getDesktopGroupScopeNodeIds(groupNodes, []), groupNodes.map((node) => node.id));

console.log(JSON.stringify({
    ok: true,
    verified: [
        "forward reorder index",
        "backward reorder index",
        "adjacent no-op rejection",
        "atomic multi-selection depth forward/inverse",
        "atomic multi-selection depth backward/inverse",
        "atomic multi-selection depth top/bottom",
        "depth boundary no-op rejection",
        "atomic display-node rename forward/inverse",
        "atomic primitive/resource replace with stable IDs and inverse",
        "replace group compatibility preflight",
        "nested group path reconstruction and reconciliation",
        "direct-member group-isolation scope",
    ],
}, null, 2));
