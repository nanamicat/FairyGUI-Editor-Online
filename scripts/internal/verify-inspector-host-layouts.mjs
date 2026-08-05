import assert from "node:assert/strict";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const { InspectorController } = await importTypeScriptModule("src/editor/ui/InspectorController.ts");
const { normalizeProjectSnapshot } = await importTypeScriptModule("src/editor/services/ProjectSnapshotLoader.ts");

const legacySnapshot = {
    project: {},
    packages: [{ components: [{ children: [{ type: "GTextField" }] }] }],
};
normalizeProjectSnapshot(legacySnapshot);
assert.deepEqual(legacySnapshot.packages[0].components[0].children[0].textProperties.leading, 3);

const inspector = new InspectorController({}, () => undefined, () => undefined);
Object.assign(inspector.fields, {
    x: { numberValue: 11, optionalNumber: 11 },
    y: { numberValue: 12, optionalNumber: 12 },
    width: { numberValue: 30, optionalNumber: 30 },
    height: { numberValue: 40, optionalNumber: 40 },
    minWidth: { numberValue: 2 },
    minHeight: { numberValue: 3 },
    maxWidth: { numberValue: 80 },
    maxHeight: { numberValue: 90 },
    scaleX: { numberValue: 1.5 },
    scaleY: { numberValue: 0.5 },
    skewX: { numberValue: 3 },
    skewY: { numberValue: 4 },
    aspect: { selected: true },
    alpha: { numberValue: 0.5, optionalNumber: 0.5 },
    rotation: { numberValue: 15, optionalNumber: 15 },
    visible: { selected: true },
    touchable: { selected: false },
    grayed: { selected: true },
    multiVisible: { value: "false" },
    multiTouchable: { value: "true" },
    multiGrayed: { value: "" },
    pivotX: { numberValue: 0.25 },
    pivotY: { numberValue: 0.75 },
    pivotAnchor: { selected: true },
    tooltips: { text: "tip" },
    customData: { text: "custom" },
    blendMode: { value: "add" },
    filter: { value: "color" },
});
assert.deepEqual(inspector.readMultiSelectionValues(), {
    ok: true,
    values: {
        x: 11,
        y: 12,
        width: 30,
        height: 40,
        alpha: 0.5,
        rotation: 15,
        visible: false,
        touchable: true,
        grayed: undefined,
    },
});
const textNode = {
    id: "node",
    type: "GTextField",
    x: 1,
    y: 2,
    width: 20,
    height: 10,
    visible: true,
    touchable: false,
    grayed: false,
    alpha: 1,
    rotation: 0,
    aspect: false,
    minSize: { width: 0, height: 0 },
    maxSize: { width: 0, height: 0 },
    scale: { x: 1, y: 1 },
    skew: { x: 0, y: 0 },
    tooltips: "",
    blendMode: "normal",
    filter: "",
    filterData: "1,0,0,0",
    pivotX: 0,
    pivotY: 0,
    pivotAsAnchor: false,
    customData: "",
    text: "Original",
    font: "",
    fontSize: 12,
    color: "#000000",
    textProperties: {
        align: 0,
        vAlign: 0,
        leading: 0,
        letterSpacing: 0,
        autoSize: 0,
        singleLine: false,
        autoClearText: false,
        underlaySoftness: 0,
        ubbEnabled: false,
        underline: false,
        italic: false,
        bold: false,
        strikethrough: false,
        strokeColor: null,
        strokeSize: 0,
        shadowColor: null,
        shadowOffset: { x: 0, y: 0 },
    },
};
assert.deepEqual(
    inspector.createDisplayNodeCommand({ id: "package" }, { id: "component" }, textNode),
    {
        kind: "setDisplayNodeProps",
        selector: {
            packageId: "package",
            componentResourceId: "component",
            displayNodeId: "node",
        },
        props: {
            position: { x: 11, y: 12 },
            size: { width: 30, height: 40 },
            minSize: { width: 2, height: 3 },
            maxSize: { width: 80, height: 90 },
            scale: { x: 1.5, y: 0.5 },
            skew: { x: 3, y: 4 },
            aspect: true,
            visible: false,
            touchable: true,
            grayed: true,
            alpha: 0.5,
            rotation: 15,
            tooltips: "tip",
            blendMode: "add",
            filter: "color",
            filterData: "1,0,0,0",
            customData: "custom",
            pivot: { x: 0.25, y: 0.75 },
            pivotAsAnchor: true,
        },
    },
);
inspector.fields.textEditor = {
    text: { title: "Updated" },
    font: { title: "Arial" },
    fontSize: { title: "18" },
    color: "#123456",
    leading: { numberValue: 3 },
    letterSpacing: { numberValue: 2 },
    align: { selectedIndex: 1 },
    verticalAlign: { selectedIndex: 2 },
    autoSize: { selectedIndex: 3 },
    ubbEnabled: { selected: true },
    varsEnabled: { selected: true },
    singleLine: { selected: true },
    bold: { selected: true },
    italic: { selected: false },
    underline: { selected: true },
    strike: { selected: false },
    clearOnPublish: { selected: false },
};
const textCommand = inspector.createDisplayNodeCommand({ id: "package" }, { id: "component" }, textNode);
assert.deepEqual(textCommand.props.text, "Updated");
assert.deepEqual(textCommand.props.font, "Arial");
assert.deepEqual(textCommand.props.fontSize, 18);
assert.deepEqual(textCommand.props.color, "#123456");
assert.deepEqual(textCommand.props.textProperties, {
    ...textNode.textProperties,
    align: 1,
    vAlign: 2,
    leading: 3,
    letterSpacing: 2,
    autoSize: 3,
    singleLine: true,
    templateVarsEnabled: true,
    ubbEnabled: true,
    underline: true,
    italic: false,
    bold: true,
    strikethrough: false,
});
inspector.fields.width.optionalNumber = 0;
assert.deepEqual(inspector.readMultiSelectionValues(), {
    ok: false,
    message: "Multi-selection width and height must be greater than zero.",
});

console.log(JSON.stringify({
    ok: true,
    inspectorReaders: 4,
}));
