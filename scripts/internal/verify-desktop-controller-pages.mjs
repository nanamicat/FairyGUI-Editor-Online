import assert from "node:assert/strict";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const {
    createControllerActionDraft,
    insertControllerPageDraft,
    moveControllerActionDraft,
    moveControllerPageDraft,
    prepareUpdateControllerModel,
    prepareCreateController,
    removeControllerActionDraft,
    removeControllerPageDraft,
} = await importTypeScriptModule("src/editor/commands/HighRiskAuthoringTransactions.ts");

const originalController = {
    name: "page",
    selectedIndex: 1,
    autoRadioGroupDepth: false,
    alias: "",
    exported: false,
    homePageType: "default",
    homePage: "",
    pages: [
        { id: "0", name: "up" },
        { id: "1", name: "down" },
        { id: "2", name: "over" },
    ],
    actions: [],
};
const project = {
    packages: [{
        id: "pkg",
        resources: [{
            id: "component",
            kind: "component",
            component: {
                controllers: [
                    structuredClone(originalController),
                    {
                        ...structuredClone(originalController),
                        name: "target",
                        selectedIndex: 0,
                        pages: [{ id: "target-page", name: "target page" }],
                    },
                ],
                transitions: [{ name: "t0", items: [] }],
                displayList: [{
                    id: "node",
                    kind: "text",
                    gears: [{
                        kind: "xy",
                        controllerName: "page",
                        states: [{ pageId: "1", value: { x: 0, y: 0 } }],
                    }],
                }],
            },
        }],
    }],
};
const selector = { packageId: "pkg", componentResourceId: "component" };

const emptyControllerProject = structuredClone(project);
emptyControllerProject.packages[0].resources[0].component.controllers = [];
const createPrepared = prepareCreateController(emptyControllerProject, selector);
assert.equal(createPrepared.ok, true);
assert.equal(createPrepared.transaction.operation.kind, "addController");
assert.equal(createPrepared.transaction.operation.controller.pages.length, 2);
assert.equal(createPrepared.transaction.inverseOperation.kind, "removeController");

const draft = structuredClone(originalController);
const insertedId = insertControllerPageDraft(draft, 1);
assert.equal(insertedId, "3");
assert.deepEqual(draft.pages.map((page) => page.id), ["0", "3", "1", "2"]);
assert.equal(draft.selectedIndex, 1);
draft.pages[1].name = "pressed";
assert.equal(moveControllerPageDraft(draft, insertedId, 1), true);
assert.deepEqual(draft.pages.map((page) => page.id), ["0", "1", "3", "2"]);
assert.equal(draft.selectedIndex, 2);
assert.equal(removeControllerPageDraft(draft, insertedId), true);
assert.deepEqual(draft.pages.map((page) => page.id), ["0", "1", "2"]);
draft.autoRadioGroupDepth = true;

const prepared = prepareUpdateControllerModel(project, selector, "page", draft);
assert.equal(prepared.ok, true);
if (!prepared.ok) throw new Error(prepared.message);
assert.equal(prepared.transaction.operation.kind, "updateController");
assert.equal(prepared.transaction.operation.controller.autoRadioGroupDepth, true);
assert.deepEqual(prepared.transaction.inverseOperation.controller, originalController);

const referencedRemoval = structuredClone(originalController);
assert.equal(removeControllerPageDraft(referencedRemoval, "1"), true);
const rejectedRemoval = prepareUpdateControllerModel(project, selector, "page", referencedRemoval);
assert.equal(rejectedRemoval.ok, false);
assert.equal(rejectedRemoval.code, "controller_page_in_use");

const invalidAction = structuredClone(originalController);
invalidAction.actions = [{
    ...createControllerActionDraft(0),
    fromPageIds: ["missing"],
    transitionName: "t0",
}];
const rejectedAction = prepareUpdateControllerModel(project, selector, "page", invalidAction);
assert.equal(rejectedAction.ok, false);
assert.equal(rejectedAction.code, "invalid_controller_action_pages");

const actionDraft = structuredClone(originalController);
const playTransition = {
    ...createControllerActionDraft(0),
    fromPageIds: ["0"],
    toPageIds: ["1"],
    transitionName: "t0",
    playTimes: 2,
    delay: 0.25,
    stopOnExit: true,
};
const changePage = {
    ...createControllerActionDraft(1),
    controllerName: "target",
    targetPage: "target-page",
};
actionDraft.actions.push(playTransition, changePage);
assert.equal(moveControllerActionDraft(actionDraft, 1, -1), true);
assert.deepEqual(actionDraft.actions.map((action) => action.actionType), [1, 0]);
assert.equal(removeControllerActionDraft(actionDraft, 0), true);
assert.deepEqual(actionDraft.actions, [playTransition]);
const preparedAction = prepareUpdateControllerModel(project, selector, "page", actionDraft);
assert.equal(preparedAction.ok, true);
if (!preparedAction.ok) throw new Error(preparedAction.message);
assert.equal(preparedAction.transaction.operation.controller.actions[0].transitionName, "t0");

const invalidTarget = structuredClone(originalController);
invalidTarget.actions = [{
    ...createControllerActionDraft(1),
    targetNodeId: "missing",
    controllerName: "target",
    targetPage: "target-page",
}];
const rejectedTarget = prepareUpdateControllerModel(project, selector, "page", invalidTarget);
assert.equal(rejectedTarget.ok, false);
assert.equal(rejectedTarget.code, "invalid_controller_action_target");

const malformedAction = structuredClone(originalController);
malformedAction.actions = [null];
const rejectedMalformedAction = prepareUpdateControllerModel(project, selector, "page", malformedAction);
assert.equal(rejectedMalformedAction.ok, false);
assert.equal(rejectedMalformedAction.code, "invalid_controller_actions");

const singlePage = {
    ...structuredClone(originalController),
    pages: [{ id: "0", name: "only" }],
    selectedIndex: 0,
};
assert.equal(removeControllerPageDraft(singlePage, "0"), false);

console.log(JSON.stringify({
    ok: true,
    verified: [
        "page insert with unique id",
        "page reorder preserves selected page",
        "page removal keeps one-page minimum",
        "one reversible updateController model",
        "referenced page removal rejection",
        "dangling controller action page rejection",
        "typed controller action add/reorder/remove",
        "controller action target rejection",
        "malformed controller action rejection",
    ],
}, null, 2));
