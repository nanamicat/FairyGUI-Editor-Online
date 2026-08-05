import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveAuthoringProjectPath } from "../project-boundary.mjs";
import { applyUamTransaction } from "../../assets/resources/editor/runtime/openfairygui-backend-browser.js";

const {
    prepareImportBitmapFontResources,
    prepareRemoveAssetResource,
    prepareRemoveBinaryResource,
} = await importTypeScriptModule(
    "src/editor/commands/HighRiskAuthoringTransactions.ts",
);
const { createTransactionSaveTarget } = await importTypeScriptModule(
    "src/editor/services/BrowserLiveSessionBridge.ts",
);
const authoringProjectDirectory = path.dirname(resolveAuthoringProjectPath());
const fontBytes = new Uint8Array(readFileSync(path.join(authoringProjectDirectory, "assets/Basics/font/BMFontTest.fnt")));
const textureBytes = new Uint8Array(readFileSync(path.join(authoringProjectDirectory, "assets/Basics/font/BMFontTest_atlas.png")));
const uamBaseline = JSON.parse(
    readFileSync("assets/resources/editor/runtime/uam-baseline.json", "utf8"),
).uamProject;
const project = {
    packages: [{
        id: "pkg",
        resources: [{ id: "existing", kind: "image", name: "BMFontTest_atlas" }],
    }],
};

const prepared = prepareImportBitmapFontResources(
    project,
    { packageId: "pkg" },
    { fileName: "BMFontTest.fnt", sourceBytes: fontBytes },
    { fileName: "BMFontTest_atlas.png", sourceBytes: textureBytes },
    { width: 256, height: 256 },
);
assert.equal(prepared.ok, true);
if (!prepared.ok) throw new Error(prepared.message);

const added = prepared.transaction.operations?.map((operation) =>
    operation.kind === "addResource" ? operation.resource : null,
) ?? [];
const image = added.find((resource) => resource?.kind === "image");
const font = added.find((resource) => resource?.kind === "font");
assert.equal(added.length, 2);
assert.ok(image?.id);
assert.ok(font?.id);
assert.equal(font.metadata.textureId, image.id);
assert.equal(font.fileName, "BMFontTest.fnt");
assert.deepEqual(
    prepared.transaction.inverseOperations?.map((operation) =>
        operation.kind === "removeResource" ? operation.selector.resourceId : ""),
    [font.id, image.id],
);
const saveTarget = createTransactionSaveTarget(
    { packages: [{ id: "pkg", resources: [image, font] }] },
    prepared.transaction.operations,
);
assert.equal(saveTarget.kind, "transactionBatch");
assert.equal(saveTarget.expected[0].value.resource.sourceBytes.byteLength, textureBytes.byteLength);
assert.equal(saveTarget.expected[1].value.resource.sourceBytes.byteLength, fontBytes.byteLength);
assert.equal(saveTarget.expected[1].value.resource.metadata.textureId, image.id);

const importedProject = {
    packages: [{
        id: "pkg",
        resources: [
            { ...image, sourcePath: `/imported/images/${image.fileName}` },
            { ...font, sourcePath: `/imported/fonts/${font.fileName}` },
        ],
    }],
};
const removeFont = prepareRemoveAssetResource(importedProject, {
    packageId: "pkg",
    resourceId: font.id,
});
assert.equal(removeFont.ok, true);
if (!removeFont.ok) throw new Error(removeFont.message);
assert.deepEqual(
    removeFont.transaction.operations?.map((operation) => operation.selector.resourceId),
    [font.id, image.id],
);
assert.deepEqual(
    removeFont.transaction.inverseOperations?.map((operation) =>
        operation.kind === "addResource" ? operation.resource.id : ""),
    [image.id, font.id],
);
assert.equal(
    removeFont.transaction.inverseOperations?.some((operation) =>
        operation.kind === "addResource" && "sourcePath" in operation.resource),
    false,
);
const projectionProject = {
    ...uamBaseline,
    packages: [{
        ...uamBaseline.packages[0],
        id: "pkg",
        name: "Pkg",
        resources: [],
    }],
};
const projectedImport = applyUamTransaction(projectionProject, prepared.transaction.operations);
const projectedRemoval = applyUamTransaction(projectedImport, removeFont.transaction.operations);
const projectedRestore = applyUamTransaction(projectedRemoval, removeFont.transaction.inverseOperations);
assert.deepEqual(
    projectedRestore.packages[0].resources
        .filter((resource) => resource.id === image.id || resource.id === font.id)
        .map((resource) => resource.id),
    [image.id, font.id],
);

const removeReferencedTexture = prepareRemoveAssetResource(importedProject, {
    packageId: "pkg",
    resourceId: image.id,
});
assert.equal(removeReferencedTexture.ok, false);
assert.equal(removeReferencedTexture.code, "resource_in_use");

const sharedProject = structuredClone(importedProject);
sharedProject.packages[0].resources.push({
    ...structuredClone(font),
    id: "shared_font",
    metadata: { ...structuredClone(font.metadata), textureId: image.id },
});
const removeSharedFont = prepareRemoveAssetResource(sharedProject, {
    packageId: "pkg",
    resourceId: font.id,
});
assert.equal(removeSharedFont.ok, true);
assert.equal(removeSharedFont.transaction.operations?.length, 1);

const referencedProject = structuredClone(importedProject);
referencedProject.packages[0].resources.push({
    kind: "component",
    id: "component",
    component: {
        displayList: [{
            kind: "image",
            id: "node",
            resource: { resourceId: image.id },
        }],
    },
});
const removeDisplayedTexture = prepareRemoveAssetResource(referencedProject, {
    packageId: "pkg",
    resourceId: image.id,
});
assert.equal(removeDisplayedTexture.ok, false);
assert.equal(removeDisplayedTexture.code, "resource_in_use");
const removeFontWithDisplayedTexture = prepareRemoveAssetResource(referencedProject, {
    packageId: "pkg",
    resourceId: font.id,
});
assert.equal(removeFontWithDisplayedTexture.ok, true);
assert.equal(removeFontWithDisplayedTexture.transaction.operations?.length, 1);

referencedProject.packages[0].resources[2].component.displayList.push({
    kind: "text",
    id: "font-node",
    font: `ui://pkg${font.id}`,
});
const removeDisplayedFont = prepareRemoveAssetResource(referencedProject, {
    packageId: "pkg",
    resourceId: font.id,
});
assert.equal(removeDisplayedFont.ok, false);
assert.equal(removeDisplayedFont.code, "resource_in_use");

const removeSavedBinary = prepareRemoveBinaryResource({
    packages: [{
        id: "pkg",
        resources: [{
            kind: "misc",
            id: "binary",
            name: "binary",
            path: "/phase9-user/misc/",
            sourceBytes: new Uint8Array([1]),
            sourcePath: "/phase9-user/misc/binary.bin",
        }],
    }],
}, { packageId: "pkg", resourceId: "binary" });
assert.equal(removeSavedBinary.ok, true);
assert.equal(
    removeSavedBinary.transaction.inverseOperation.kind === "addResource"
        && "sourcePath" in removeSavedBinary.transaction.inverseOperation.resource,
    false,
);

const invalidPages = prepareImportBitmapFontResources(
    project,
    { packageId: "pkg" },
    {
        fileName: "multi.fnt",
        sourceBytes: new TextEncoder().encode(
            'info face="test" size=16\ncommon lineHeight=16 pages=2\n'
            + 'page id=0 file="a.png"\npage id=1 file="b.png"\n'
            + "chars count=1\nchar id=65 x=0 y=0 width=1 height=1\n",
        ),
    },
    { fileName: "a.png", sourceBytes: textureBytes },
    { width: 1, height: 1 },
);
assert.equal(invalidPages.ok, false);
assert.equal(invalidPages.code, "unsupported_bitmap_font_pages");

console.log(JSON.stringify({
    ok: true,
    verified: [
        "text BMFont validation",
        "atomic image and font add",
        "font textureId binding",
        "reverse-order inverse remove",
        "batch save target bytes and dependency metadata",
        "atomic font and unused texture removal",
        "browser UAM projection remove and restore",
        "saved sourcePath stripping for addResource inverse",
        "misc binary inverse sourcePath stripping",
        "shared texture preservation",
        "display-node and ui URL dependency rejection",
        "multi-page rejection",
    ],
}, null, 2));
