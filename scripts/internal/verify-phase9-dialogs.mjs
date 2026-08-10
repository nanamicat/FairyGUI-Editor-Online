import assert from "node:assert/strict";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

class FakeNode {
    constructor(name = "") {
        this.name = name;
        this.children = [];
        this.text = "";
        this.title = "";
    }

    get asCom() {
        return this;
    }

    get asLabel() {
        return this;
    }

    get asButton() {
        return this;
    }

    get asTextInput() {
        return this;
    }

    getChild(name) {
        return this.children.find((child) => child.name === name) || null;
    }

    addChild(child) {
        this.children.push(child);
        return child;
    }

    setXY(x, y) {
        this.x = x;
        this.y = y;
    }

    setSize(width, height) {
        this.width = width;
        this.height = height;
    }

    onClick(owner, handler) {
        this.owner = owner;
        this.handler = handler;
    }

    click() {
        this.handler?.call(this.owner);
    }
}

class FakeWindow {
    static instances = [];

    constructor() {
        this.disposed = false;
        this.shown = false;
        FakeWindow.instances.push(this);
    }

    dispose() {
        this.disposed = true;
        this.undisplay?.handler.call(this.undisplay.owner);
    }

    show() {
        this.shown = true;
    }

    on(type, owner, handler) {
        assert.equal(type, "undisplay");
        this.undisplay = { owner, handler };
    }
}

function createObject(pkg, name) {
    assert.equal(pkg, "Builder");
    assert.equal(name, "ConfirmDialog");
    const content = new FakeNode();
    for (const childName of ["frame", "n1", "n2", "n3"]) {
        content.addChild(new FakeNode(childName));
    }
    return content;
}

globalThis.fgui = {
    Window: FakeWindow,
    UIPackage: { createObject },
};
globalThis.Laya = { Event: { UNDISPLAY: "undisplay" } };

const { showEditorConfirmation } = await importTypeScriptModule("src/editor/dialogs/EditorDialogs.ts");

const state = {
    active: null,
    statuses: [],
    debug: [],
};
const context = {
    getActiveDialog: () => state.active,
    setActiveDialog: (dialog) => { state.active = dialog; },
    setStatus: (message) => { state.statuses.push(message); },
    setDebugAttribute: (name, value) => { state.debug.push([name, value]); },
    eventOwner: {},
};

const replacementDialog = new FakeWindow();
state.active = replacementDialog;

let confirmed = 0;
showEditorConfirmation(
    context,
    "confirmDialog",
    "Confirm",
    "Message",
    "Apply",
    "debug-confirm",
    "Pending",
    "Cancelled",
    () => { confirmed += 1; },
);
const confirmDialog = FakeWindow.instances.at(-1);
assert.equal(replacementDialog.disposed, true);
assert.equal(state.active, confirmDialog);
confirmDialog.contentPane.getChild("n1").click();
assert.equal(confirmed, 1);
assert.equal(confirmDialog.disposed, true);
assert.equal(state.active, null);
assert.deepEqual(state.debug.at(-1), ["debug-confirm", "confirmed"]);

showEditorConfirmation(
    context,
    "cancelConfirmDialog",
    "Confirm",
    "Message",
    "Apply",
    "debug-cancel",
    "Pending",
    "Cancelled",
    () => { confirmed += 1; },
);
const cancelConfirmDialog = FakeWindow.instances.at(-1);
assert.equal(state.active, cancelConfirmDialog);
cancelConfirmDialog.contentPane.getChild("n3").click();
assert.equal(confirmed, 1);
assert.equal(cancelConfirmDialog.disposed, true);
assert.equal(state.active, null);
assert.equal(state.statuses.at(-1), "Cancelled");
assert.deepEqual(state.debug.at(-1), ["debug-cancel", "cancelled"]);

console.log(JSON.stringify({
    ok: true,
    verified: [
        "confirmation success and cancel lifecycle",
        "confirmation replaces and releases the shared active dialog",
    ],
}));
