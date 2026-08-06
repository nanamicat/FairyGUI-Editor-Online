import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const {
    prepareAddButtonComponent,
    prepareAddComboBoxComponent,
    prepareAddComponent,
    prepareAddLabelComponent,
    prepareAddPopupMenuComponent,
    prepareAddProgressBarComponent,
    prepareAddScrollBarComponent,
    prepareAddSliderComponent,
    prepareAddWindowFrameComponent,
} = await importTypeScriptModule("src/editor/commands/PackageComponentTransactions.ts");

const project = {
    settings: {
        common: {
            fontSize: 18,
            textColor: "#123456",
        },
    },
    packages: [{
        id: "pkg",
        resources: [{
            id: "existing",
            kind: "component",
            name: "Existing",
            component: { size: { width: 10, height: 10 }, displayList: [], controllers: [], transitions: [] },
        }],
    }],
};

const label = prepareAddLabelComponent(project, { packageId: "pkg" }, {
    name: "StatusLabel",
    path: "/controls",
    width: 320,
    height: 48,
});
assert.equal(label.ok, true);
if (!label.ok) throw new Error(label.message);
assert.equal(label.transaction.operation.kind, "addComponent");
assert.equal(label.transaction.operation.component.path, "/controls/");
assert.equal(label.transaction.operation.component.component.properties.extensionType, "Label");
assert.deepEqual(label.transaction.operation.component.component.size, { width: 320, height: 48 });
assert.deepEqual(label.transaction.operation.component.component.displayList[0], {
    kind: "text",
    id: "n0",
    name: "title",
    position: { x: 0, y: 0 },
    size: { width: 320, height: 48 },
    locked: false,
    aspect: false,
    minSize: { width: 0, height: 0 },
    maxSize: { width: 0, height: 0 },
    scale: { x: 1, y: 1 },
    skew: { x: 0, y: 0 },
    visible: true,
    touchable: true,
    grayed: false,
    alpha: 1,
    rotation: 0,
    tooltips: "",
    blendMode: "normal",
    filter: "",
    filterData: "",
    customData: "",
    group: "",
    relations: [
        { targetNodeId: "", type: 14, usePercent: false },
        { targetNodeId: "", type: 15, usePercent: false },
    ],
    gears: [],
    pivot: { x: 0, y: 0 },
    pivotAsAnchor: false,
    text: "",
    font: "",
    fontSize: 18,
    color: "#123456",
    align: 1,
    vAlign: 1,
    leading: 3,
    letterSpacing: 0,
    autoSize: 0,
    singleLine: true,
    autoClearText: false,
    demoText: "",
    templateVarsEnabled: false,
    faceDilate: 0,
    outlineSoftness: 0,
    underlaySoftness: 0,
    ubbEnabled: false,
    underline: false,
    italic: false,
    bold: false,
    strikethrough: false,
    strokeColor: null,
    strokeSize: 1,
    shadowColor: null,
    shadowOffset: { x: 0, y: 0 },
});
assert.equal(label.transaction.inverseOperation.kind, "removeComponent");
assert.equal(
    label.transaction.inverseOperation.selector.componentResourceId,
    label.transaction.operation.component.id,
);

const button = prepareAddButtonComponent(project, { packageId: "pkg" }, {
    name: "ConfirmButton",
    path: "/controls/",
    width: 200,
    height: 60,
    buttonMode: 2,
    includeTitle: true,
    includeIcon: true,
});
assert.equal(button.ok, true);
if (!button.ok) throw new Error(button.message);
const buttonModel = button.transaction.operation.component.component;
assert.equal(buttonModel.properties.extensionType, "Button");
assert.equal(buttonModel.properties.buttonMode, 2);
assert.deepEqual(buttonModel.controllers[0].pages.map((page) => page.name), [
    "up",
    "down",
    "over",
    "selectedOver",
]);
assert.deepEqual(
    buttonModel.displayList.slice(0, 3).map((node) => node.gears[0].visibleOnPageIds),
    [["0"], ["2"], ["1", "3"]],
);
assert.deepEqual(buttonModel.displayList.map((node) => node.name), [
    "background",
    "over",
    "down",
    "title",
    "icon",
]);
assert.equal(buttonModel.displayList[4].align, 1);
assert.equal(buttonModel.displayList[4].vAlign, 1);

assert.equal(prepareAddComponent(project, { packageId: "pkg" }).ok, true);
assert.equal(prepareAddLabelComponent(project, { packageId: "pkg" }, {
    name: "Existing",
    path: "/",
    width: 100,
    height: 20,
}).code, "component_name_conflict");
assert.equal(prepareAddLabelComponent(project, { packageId: "pkg" }, {
    name: "Bad/Name",
    path: "/",
    width: 100,
    height: 20,
}).code, "invalid_component_name");
assert.equal(prepareAddLabelComponent(project, { packageId: "pkg" }, {
    name: "BadPath",
    path: "controls",
    width: 100,
    height: 20,
}).code, "invalid_component_path");
assert.equal(prepareAddButtonComponent(project, { packageId: "pkg" }, {
    name: "BadMode",
    path: "/",
    width: 100,
    height: 20,
    buttonMode: 4,
    includeTitle: false,
    includeIcon: false,
}).code, "invalid_button_mode");

const baseline = JSON.parse(readFileSync("assets/resources/editor/runtime/uam-baseline.json", "utf8")).uamProject;
const baselinePackageId = baseline.packages[0].id;
const { applyUamTransaction } = await import("../../assets/resources/editor/runtime/openfairygui-backend-browser.js");
const recipes = [
    ["ComboBox", prepareAddComboBoxComponent, { name: "VerifyAlpha29ComboBox", path: "/" }, 3],
    ["ProgressBar", prepareAddProgressBarComponent, { name: "VerifyAlpha29ProgressBar", path: "/", titleType: 1, reverse: true }, 1],
    ["Slider", prepareAddSliderComponent, { name: "VerifyAlpha29Slider", path: "/", orientation: 0, titleType: 1 }, 1],
    ["ScrollBar", prepareAddScrollBarComponent, { name: "VerifyAlpha29ScrollBar", path: "/", orientation: 0, includeArrows: true }, 1],
    ["WindowFrame", prepareAddWindowFrameComponent, { name: "VerifyAlpha29WindowFrame", path: "/", titleKind: "text", includeCloseButton: true }, 1],
    ["PopupMenu", prepareAddPopupMenuComponent, { name: "VerifyAlpha29PopupMenu", path: "/" }, 2],
];
for (const [kind, prepare, input, addedCount] of recipes) {
    const prepared = prepare(baseline, { packageId: baselinePackageId }, input);
    assert.equal(prepared.ok, true, `${kind}: ${JSON.stringify(prepared)}`);
    if (!prepared.ok) continue;
    const operations = prepared.transaction.operations || [prepared.transaction.operation];
    const inverses = prepared.transaction.inverseOperations || [prepared.transaction.inverseOperation];
    const applied = applyUamTransaction(structuredClone(baseline), operations);
    const baselinePackage = baseline.packages.find((pkg) => pkg.id === baselinePackageId);
    const appliedPackage = applied.packages.find((pkg) => pkg.id === baselinePackageId);
    assert.equal(appliedPackage.resources.length, baselinePackage.resources.length + addedCount, `${kind} add count`);
    assert(appliedPackage.resources.some((resource) => resource.name === input.name), `${kind} main component missing`);
    const restored = applyUamTransaction(applied, inverses);
    const restoredPackage = restored.packages.find((pkg) => pkg.id === baselinePackageId);
    assert.equal(restoredPackage.resources.length, baselinePackage.resources.length, `${kind} inverse count`);
    assert(!restoredPackage.resources.some((resource) => resource.name === input.name), `${kind} inverse must remove the main component`);
    assert.equal(baselinePackage.resources.some((resource) => resource.name === input.name), false, `${kind} apply must be immutable`);
}

const editorShell = [
    readFileSync("src/editor/EditorShell.ts", "utf8"),
    readFileSync("src/editor/EditorShellConfig.ts", "utf8"),
    readFileSync("src/editor/dialogs/ComponentTemplateEditors.ts", "utf8"),
    readFileSync("src/editor/ui/AuthoringDialogController.ts", "utf8"),
    readFileSync("src/editor/ui/ResourceAuthoringController.ts", "utf8"),
].join("\n");
for (const snippet of [
    '{ childName: "tbCreateButton", action: "toolbar:createButton" }',
    '{ childName: "tbCreateLabel", action: "toolbar:createLabel" }',
    'dialogResource: "CreateButtonDialog"',
    'dialogResource: "CreateLabelDialog"',
    '{ childName: "tbCreateComboBox", action: "toolbar:createComboBox" }',
    '{ childName: "tbCreateProgressBar", action: "toolbar:createProgressBar" }',
    '{ childName: "tbCreateSlider", action: "toolbar:createSlider" }',
    'dialogResource: "CreateComboBoxDialog"',
    'dialogResource: "CreateProgressBarDialog"',
    'dialogResource: "CreateSliderDialog"',
    'dialogResource: "CreateScrollBarDialog"',
    'dialogResource: "CreateWindowFrameDialog"',
    'dialogResource: "CreatePopupMenuDialog"',
    'desktopMenuCreatePopupMenu',
    "if (child) child.visible = false;",
    'data-fairy-editor-component-template-dialog',
]) {
    assert(editorShell.includes(snippet), `Missing typed component toolbar wiring: ${snippet}`);
}

console.log(JSON.stringify({
    ok: true,
    verified: [
        "AIR-compatible Label title template",
        "AIR-compatible graph-backed Button states",
        "project default font and text color",
        "public addComponent inverse lifecycle",
        "name, path, size, and button-mode validation",
        "existing Builder dialogs and toolbar actions with optional FUI groups",
        "alpha29 typed ComboBox, ProgressBar, Slider, ScrollBar, WindowFrame, and PopupMenu recipes",
    ],
}, null, 2));
