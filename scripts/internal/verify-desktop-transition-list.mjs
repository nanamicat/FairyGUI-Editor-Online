import assert from "node:assert/strict";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const {
    prepareCreateTransition,
    prepareRenameTransition,
} = await importTypeScriptModule(
    "src/editor/commands/HighRiskAuthoringTransactions.ts",
);

const project = {
    packages: [{
        id: "pkg",
        resources: [{
            id: "component",
            kind: "component",
            component: {
                displayList: [],
                controllers: [{
                    name: "page",
                    actions: [{ actionType: 0, transitionName: "t0" }],
                }],
                transitions: [
                    {
                        name: "t0",
                        autoPlay: false,
                        items: [{ actionType: 10, targetNodeId: "", startValue: ["t0"] }],
                    },
                    {
                        name: "t2",
                        autoPlay: true,
                        items: [{ actionType: 10, targetNodeId: "", startValue: ["t0"] }],
                    },
                ],
            },
        }],
    }, {
        id: "outer",
        resources: [{
            id: "host",
            kind: "component",
            component: {
                displayList: [{
                    id: "child",
                    kind: "component",
                    resource: { packageId: "pkg", resourceId: "component" },
                }],
                transitions: [{
                    name: "outerTransition",
                    items: [{ actionType: 10, targetNodeId: "child", startValue: ["t0"] }],
                }],
            },
        }],
    }],
};

const prepared = prepareCreateTransition(project, {
    packageId: "pkg",
    componentResourceId: "component",
});
assert.equal(prepared.ok, true);
if (!prepared.ok) throw new Error(prepared.message);
assert.equal(prepared.transaction.operation.kind, "addTransition");
assert.equal(prepared.transaction.operation.selector.transitionName, "t1");
assert.deepEqual(prepared.transaction.operation.transition, {
    name: "t1",
    autoPlay: false,
    items: [],
});
assert.equal(prepared.transaction.inverseOperation.kind, "removeTransition");
assert.equal(prepared.transaction.inverseOperation.selector.transitionName, "t1");
assert.equal(prepareCreateTransition(project, {
    packageId: "pkg",
    componentResourceId: "missing",
}).ok, false);

const renamed = prepareRenameTransition(project, {
    packageId: "pkg",
    componentResourceId: "component",
}, "t0", "renamed");
assert.equal(renamed.ok, true);
if (!renamed.ok) throw new Error(renamed.message);
assert.deepEqual(
    renamed.transaction.operations.map((operation) => operation.kind),
    ["addTransition", "updateController", "updateTransition", "updateTransition", "removeTransition"],
);
assert.equal(renamed.transaction.operations[0].transition.name, "renamed");
assert.equal(renamed.transaction.operations[0].transition.items[0].startValue[0], "renamed");
assert.equal(renamed.transaction.operations[1].controller.actions[0].transitionName, "renamed");
assert.equal(renamed.transaction.operations[2].transition.items[0].startValue[0], "renamed");
assert.equal(renamed.transaction.operations[3].transition.items[0].startValue[0], "renamed");
assert.deepEqual(
    renamed.transaction.inverseOperations.map((operation) => operation.kind),
    ["addTransition", "updateController", "updateTransition", "updateTransition", "removeTransition"],
);
assert.equal(prepareRenameTransition(project, {
    packageId: "pkg",
    componentResourceId: "component",
}, "t0", "t2").ok, false);

console.log("Desktop transition list verification passed.");
