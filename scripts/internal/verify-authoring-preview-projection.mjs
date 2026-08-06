import assert from "node:assert/strict";
import {
    AUTHORING_PREVIEW_PROJECTION_MATRIX,
    planAuthoringPreviewProjection,
} from "../../src/editor/runtime/AuthoringPreviewProjection.ts";

const component = {
    id: "component",
    name: "Component",
    path: "/",
    exported: true,
    width: 100,
    height: 100,
    childCount: 1,
    controllerCount: 1,
    transitionCount: 1,
    children: [{
        id: "node",
        name: "Node",
        type: "GImage",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        src: "image",
        visible: true,
        touchable: true,
        grayed: false,
        alpha: 1,
        rotation: 0,
        text: "",
        font: "",
        fontSize: 0,
        color: "",
        group: "",
        gearCount: 0,
        relationCount: 0,
    }],
};
const selector = {
    packageId: "package",
    componentResourceId: "component",
    displayNodeId: "node",
};
function plan(operation) {
    return planAuthoringPreviewProjection([operation], "package", component);
}

assert.equal(plan({
    opId: "props",
    kind: "setDisplayNodeProps",
    selector,
    props: { position: { x: 1, y: 2 } },
}).status, "applied");
assert.equal(plan({
    opId: "loader-props",
    kind: "setDisplayNodeProps",
    selector,
    props: { loaderProperties: {} },
}).runtimeStatus, "publish-required");
assert.equal(plan({
    opId: "loader3d-props",
    kind: "setDisplayNodeProps",
    selector,
    props: { loader3DProperties: {} },
}).runtimeStatus, "publish-required");
assert.equal(plan({
    opId: "list-props",
    kind: "setDisplayNodeProps",
    selector,
    props: { listProperties: {} },
}).runtimeStatus, "publish-required");
assert.equal(plan({
    opId: "component-instance-props",
    kind: "setDisplayNodeProps",
    selector,
    props: { componentInstanceProperties: { extensionType: "Button" } },
}).runtimeStatus, "publish-required");
assert.equal(plan({
    opId: "component-custom-props",
    kind: "setDisplayNodeProps",
    selector,
    props: { componentCustomPropertyValues: [{ target: "title", propertyId: 0, value: "Apply" }] },
}).runtimeStatus, "publish-required");
assert.equal(plan({
    opId: "component-controller-page",
    kind: "setDisplayNodeProps",
    selector,
    props: { componentControllerPageOverrides: [{ controllerName: "state", pageId: "1" }] },
}).runtimeStatus, "publish-required");
assert.equal(plan({
    opId: "detach",
    kind: "detachDisplayNode",
    selector,
}).mode, "structure");
assert.equal(plan({
    opId: "attach",
    kind: "attachDisplayNode",
    selector: { packageId: "package", componentResourceId: "component" },
    atIndex: 0,
    node: { id: "node" },
}).status, "applied");
assert.equal(plan({
    opId: "attach-new",
    kind: "attachDisplayNode",
    selector: { packageId: "package", componentResourceId: "component" },
    atIndex: 0,
    node: { id: "new-node" },
}).status, "applied");
assert.equal(plan({
    opId: "attach-new",
    kind: "attachDisplayNode",
    selector: { packageId: "package", componentResourceId: "component" },
    atIndex: 0,
    node: { id: "new-node" },
}).runtimeStatus, "publish-required");
assert.deepEqual(plan({
    opId: "replace",
    kind: "replaceResourceBytes",
    selector: { packageId: "dependency-package", resourceId: "image" },
    sourceBytes: new Uint8Array([1]),
}), {
    status: "applied",
    mode: "model",
    runtimeStatus: "publish-required",
    reason: "Canvas updated; Publish is required to refresh runtime behavior.",
});
assert.equal(plan({
    opId: "replace-unrelated",
    kind: "replaceResourceBytes",
    selector: { packageId: "package", resourceId: "other-image" },
    sourceBytes: new Uint8Array([1]),
}).status, "unaffected");
assert.equal(plan({
    opId: "replace-unrelated",
    kind: "replaceResourceBytes",
    selector: { packageId: "package", resourceId: "other-image" },
    sourceBytes: new Uint8Array([1]),
}).runtimeStatus, "publish-required");
assert.equal(plan({
    opId: "image-props",
    kind: "setImageResourceProps",
    selector: { packageId: "package", resourceId: "image" },
    props: {
        textureSetMode: "alone_npot",
        qualityOption: "source",
        quality: 80,
        smoothing: false,
        duplicatePadding: true,
        scaleOption: 1,
        scale9Grid: [1, 1, 8, 8],
        tileGridIndice: 0,
    },
}).runtimeStatus, "publish-required");
assert.deepEqual(plan({
    opId: "add-font",
    kind: "addResource",
    selector: { packageId: "package" },
    resource: { id: "font", kind: "font" },
}), {
    status: "applied",
    mode: "model",
    runtimeStatus: "publish-required",
    reason: "Canvas updated; Publish is required to refresh runtime behavior.",
});
assert.equal(plan({
    opId: "controller",
    kind: "updateController",
    selector: { packageId: "package", componentResourceId: "component", controllerName: "page" },
    controller: { name: "page" },
}).status, "applied");
assert.equal(plan({
    opId: "transition",
    kind: "updateTransition",
    selector: { packageId: "package", componentResourceId: "component", transitionName: "show" },
    transition: { name: "show" },
}).mode, "model");
assert.equal(plan({
    opId: "gear",
    kind: "updateGear",
    selector: {
        ...selector,
        kind: "xy",
        controllerName: "page",
    },
    gear: { kind: "xy", controllerName: "page" },
}).runtimeStatus, "publish-required");
assert.equal(plan({
    opId: "other-component",
    kind: "updateController",
    selector: { packageId: "package", componentResourceId: "other", controllerName: "page" },
    controller: { name: "page" },
}).status, "unaffected");
for (const operation of [
    { opId: "favorite", kind: "setResourceFavorite", selector: { packageId: "package", resourceId: "resource" }, favorite: true },
    { opId: "folder-favorite", kind: "setResourceFolderFavorite", selector: { packageId: "package", path: "/folder/" }, favorite: true },
    { opId: "exported", kind: "setResourceExported", selector: { packageId: "package", resourceId: "resource" }, exported: true },
    { opId: "folder-add", kind: "addResourceFolder", selector: { packageId: "package" }, path: "/folder/" },
    { opId: "folder-rename", kind: "renameResourceFolder", selector: { packageId: "package", path: "/folder/" }, newName: "renamed" },
    { opId: "folder-move", kind: "moveResourceFolder", selector: { packageId: "package", path: "/folder/" }, toPath: "/" },
    { opId: "folder-remove", kind: "removeResourceFolder", selector: { packageId: "package", path: "/folder/" } },
]) assert.equal(plan(operation).status, "unaffected");
assert.equal(plan({
    opId: "folder-atlas",
    kind: "setResourceFolderAtlas",
    selector: { packageId: "package", path: "/folder/" },
    atlas: "0",
}).runtimeStatus, "publish-required");
assert.equal(Object.keys(AUTHORING_PREVIEW_PROJECTION_MATRIX).length, 41);

console.log(JSON.stringify({
    ok: true,
    verified: [
        "display property projection",
        "loader property runtime publish boundary",
        "list and tree property runtime publish boundary",
        "component instance property runtime publish boundary",
        "component custom property runtime publish boundary",
        "component controller page runtime publish boundary",
        "detach and attach structure projection",
        "new-node attach authoring projection",
        "referenced resource runtime publish boundary",
        "image property runtime publish boundary",
        "new resource runtime publish boundary",
        "controller, transition, and gear authoring model sync",
        "unaffected operation path",
    ],
}, null, 2));
