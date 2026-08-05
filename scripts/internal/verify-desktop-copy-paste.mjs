import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveAuthoringProjectPath } from "../project-boundary.mjs";

const transactionModulePath = path.resolve(
    process.argv[2] ?? "assets/resources/editor/runtime/openfairygui-backend-browser.js",
);
const {
    createDisplayNodeClipboard,
    prepareDetachDisplayNodes,
    preparePasteDisplayNodes,
    readComponentProperties,
    readGraphProperties,
    readTextProperties,
} = await importTypeScriptModule("src/editor/commands/HighRiskAuthoringTransactions.ts");
const {
    applyUamTransaction,
    BackendRuntime,
    createBackendStorageFileSystem,
    ProjectReader,
    liftDocumentToUamProject,
} = await import(pathToFileURL(transactionModulePath).href);

const project = {
    projectId: "desktop-copy-paste",
    projectType: 0,
    version: "3.0",
    branches: [],
    settings: { publish: {}, common: {}, adaptation: {} },
    packages: [{
        id: "pkg",
        name: "Source",
        publish: null,
        resources: [
            {
                id: "source",
                name: "SourceComponent",
                kind: "component",
                path: "/",
                exported: false,
                branch: "",
                branchItemIds: [],
                component: {
                    displayList: [
                        { id: "n1", name: "one", kind: "graph", position: { x: 1, y: 2 } },
                        {
                            id: "n2",
                            name: "two",
                            kind: "text",
                            position: { x: 3, y: 4 },
                            relations: [{ targetNodeId: "n1", type: 0, usePercent: false }],
                        },
                    ],
                },
            },
            {
                id: "target",
                name: "TargetComponent",
                kind: "component",
                path: "/",
                exported: false,
                branch: "",
                branchItemIds: [],
                component: { displayList: [], controllers: [], transitions: [] },
            },
            {
                id: "cross-source",
                name: "CrossSource",
                kind: "component",
                path: "/",
                exported: false,
                branch: "",
                branchItemIds: [],
                component: {
                    displayList: [
                        {
                            id: "image-node",
                            name: "image",
                            kind: "image",
                            gears: [],
                            resource: { resourceId: "source-image" },
                            position: { x: 5, y: 6 },
                        },
                        {
                            id: "component-node",
                            name: "component",
                            kind: "component",
                            gears: [],
                            resource: { resourceId: "source-nested" },
                            position: { x: 7, y: 8 },
                        },
                    ],
                },
            },
            {
                id: "source-nested",
                name: "Nested",
                kind: "component",
                path: "/components/",
                exported: false,
                branch: "",
                branchItemIds: [],
                component: {
                    size: { width: 10, height: 10 },
                    displayList: [{
                        id: "nested-image",
                        kind: "image",
                        gears: [],
                        resource: { resourceId: "source-image" },
                    }],
                    controllers: [],
                    transitions: [],
                },
            },
            {
                id: "source-image",
                name: "source",
                kind: "image",
                fileName: "source.png",
                path: "/images/",
                exported: false,
                branch: "",
                branchItemIds: [],
                dimensions: { width: 2, height: 3 },
                metadata: { scaleMode: "default" },
                sourceBytes: new Uint8Array([1, 2, 3]),
            },
        ],
    }, {
        id: "other",
        name: "Target",
        publish: null,
        resources: [
            {
                id: "target",
                name: "TargetComponent",
                kind: "component",
                path: "/",
                exported: false,
                branch: "",
                branchItemIds: [],
                component: { displayList: [], controllers: [], transitions: [] },
            },
        ],
    }],
};
for (const pkg of project.packages) {
    for (const resource of pkg.resources) {
        resource.favorite ??= false;
        if (resource.kind === "image") {
            resource.image ??= {
                textureSetMode: "",
                qualityOption: "",
                quality: 80,
                smoothing: true,
                duplicatePadding: false,
                scaleOption: 0,
                scale9Grid: null,
                tileGridIndice: 0,
            };
        }
        if (!resource.component) continue;
        resource.component.size ??= { width: 0, height: 0 };
        resource.component.properties = readComponentProperties(resource.component);
        resource.component.customData ??= "";
        resource.component.controllers ??= [];
        resource.component.transitions ??= [];
        for (const displayNode of resource.component.displayList) {
            displayNode.name ??= displayNode.id;
            displayNode.position ??= { x: 0, y: 0 };
            displayNode.size ??= { width: 0, height: 0 };
            displayNode.visible ??= true;
            displayNode.touchable ??= true;
            displayNode.grayed ??= false;
            displayNode.alpha ??= 1;
            displayNode.rotation ??= 0;
            displayNode.customData ??= "";
            displayNode.group ??= "";
            displayNode.relations ??= [];
            displayNode.gears ??= [];
            if (displayNode.kind === "text") {
                Object.assign(displayNode, {
                    text: "",
                    font: "",
                    fontSize: 12,
                    color: "#000000",
                    ...readTextProperties({ kind: "text", ...displayNode }),
                });
            } else if (displayNode.kind === "graph") {
                Object.assign(displayNode, {
                    pivot: { x: 0, y: 0 },
                    pivotAsAnchor: false,
                    ...readGraphProperties(displayNode),
                });
            }
        }
    }
}
const originalProject = structuredClone(project);

const copied = createDisplayNodeClipboard(project, [
    { packageId: "pkg", componentResourceId: "source", displayNodeId: "n1" },
    { packageId: "pkg", componentResourceId: "source", displayNodeId: "n2" },
]);
assert.equal(copied.ok, true);
if (!copied.ok) throw new Error(copied.message);

const pasted = preparePasteDisplayNodes(
    project,
    { packageId: "pkg", componentResourceId: "target" },
    copied.clipboard,
);
assert.equal(pasted.ok, true);
if (!pasted.ok) throw new Error(pasted.message);
assert.equal(pasted.transaction.operations?.length, 2);
assert.deepEqual(
    pasted.transaction.operations?.map((operation) => operation.kind === "attachDisplayNode"
        ? {
            id: operation.node.id,
            atIndex: operation.atIndex,
            position: operation.node.position,
        }
        : null),
    [
        { id: "n1_copy", atIndex: 0, position: { x: 11, y: 12 } },
        { id: "n2_copy", atIndex: 1, position: { x: 13, y: 14 } },
    ],
);
assert.equal(pasted.transaction.operations?.[1].node.relations[0].targetNodeId, "n1_copy");
assert.deepEqual(
    pasted.transaction.inverseOperations?.map((operation) =>
        operation.kind === "detachDisplayNode" ? operation.selector.displayNodeId : ""),
    ["n2_copy", "n1_copy"],
);
assert.equal(
    preparePasteDisplayNodes(
        project,
        { packageId: "pkg", componentResourceId: "target" },
        {
            packageId: "pkg",
            componentResourceId: "source",
            nodes: [project.packages[0].resources[0].component.displayList[1]],
        },
    ).code,
    "display_node_relation_dependency_missing",
);
assert.equal(
    preparePasteDisplayNodes(
        project,
        { packageId: "other", componentResourceId: "target" },
        {
            packageId: "pkg",
            componentResourceId: "source",
            nodes: [{ id: "geared", kind: "graph", gears: [{ controllerName: "missing" }] }],
        },
    ).code,
    "display_node_controller_dependency_missing",
);

const crossCopied = createDisplayNodeClipboard(project, [
    { packageId: "pkg", componentResourceId: "cross-source", displayNodeId: "image-node" },
    { packageId: "pkg", componentResourceId: "cross-source", displayNodeId: "component-node" },
]);
assert.equal(crossCopied.ok, true);
if (!crossCopied.ok) throw new Error(crossCopied.message);
const crossPasted = preparePasteDisplayNodes(
    project,
    { packageId: "other", componentResourceId: "target" },
    crossCopied.clipboard,
);
assert.equal(crossPasted.ok, true);
if (!crossPasted.ok) throw new Error(crossPasted.message);
assert.deepEqual(
    crossPasted.transaction.operations.map((operation) => operation.kind),
    ["addResource", "addComponent", "attachDisplayNode", "attachDisplayNode"],
);
const copiedAsset = crossPasted.transaction.operations[0].resource;
const copiedComponent = crossPasted.transaction.operations[1].component;
const crossNodes = crossPasted.transaction.operations.slice(2).map((operation) => operation.node);
assert.deepEqual([...copiedAsset.sourceBytes], [1, 2, 3]);
assert.deepEqual(copiedComponent.component.displayList[0].resource, {
    packageId: "other",
    resourceId: copiedAsset.id,
});
assert.deepEqual(crossNodes.map((node) => node.resource), [
    { packageId: "other", resourceId: copiedAsset.id },
    { packageId: "other", resourceId: copiedComponent.id },
]);
assert.deepEqual(
    crossPasted.transaction.inverseOperations.map((operation) => operation.kind),
    ["detachDisplayNode", "detachDisplayNode", "removeComponent", "removeResource"],
);
const applied = applyUamTransaction(structuredClone(project), crossPasted.transaction.operations);
const restored = applyUamTransaction(applied, crossPasted.transaction.inverseOperations);
assert.deepEqual(project, originalProject);
assert.deepEqual(
    restored.packages.find((pkg) => pkg.id === "other").resources.map((resource) => resource.id),
    ["target"],
);
assert.equal(
    restored.packages.find((pkg) => pkg.id === "other")
        .resources.find((resource) => resource.id === "target").component.displayList.length,
    0,
);

const deleted = prepareDetachDisplayNodes(project, [
    { packageId: "pkg", componentResourceId: "source", displayNodeId: "n1" },
    { packageId: "pkg", componentResourceId: "source", displayNodeId: "n2" },
]);
assert.equal(deleted.ok, true);
if (!deleted.ok) throw new Error(deleted.message);
assert.deepEqual(
    deleted.transaction.operations?.map((operation) =>
        operation.kind === "detachDisplayNode" ? operation.selector.displayNodeId : ""),
    ["n2", "n1"],
);
assert.deepEqual(
    deleted.transaction.inverseOperations?.map((operation) =>
        operation.kind === "attachDisplayNode"
            ? { id: operation.node.id, atIndex: operation.atIndex }
            : null),
    [
        { id: "n1", atIndex: 0 },
        { id: "n2", atIndex: 1 },
    ],
);

const storage = new MemoryBrowserStorage();
const authoringProjectPath = resolveAuthoringProjectPath();
storage.importDirectory(path.dirname(authoringProjectPath));
const fileSystem = createBackendStorageFileSystem(storage);
const fairyPath = path.basename(authoringProjectPath);
const sourceProject = liftDocumentToUamProject(await new ProjectReader(fileSystem).read(
    fairyPath,
    { includeBinaryData: true, hydrateResourceBytes: true },
));
const basics = sourceProject.packages.find((pkg) => pkg.id === "9leh0eyf");
const demoText = basics.resources.find((resource) => resource.name === "Demo_Text");
const sourceFontNode = demoText.component.displayList.find((displayNode) => displayNode.id === "n11");
assert.equal(sourceFontNode.font, "ui://9leh0eyfwa8u2r");
const realCopied = createDisplayNodeClipboard(sourceProject, [{
    packageId: basics.id,
    componentResourceId: demoText.id,
    displayNodeId: sourceFontNode.id,
}]);
assert.equal(realCopied.ok, true, JSON.stringify(realCopied));
const realPasted = preparePasteDisplayNodes(
    sourceProject,
    { packageId: "rbw1tv9t", componentResourceId: "kcy10" },
    realCopied.clipboard,
);
assert.equal(realPasted.ok, true, JSON.stringify(realPasted));
assert.deepEqual(
    realPasted.transaction.operations.map((operation) => operation.kind),
    ["addResource", "addResource", "attachDisplayNode"],
);
const realCopiedTexture = realPasted.transaction.operations[0].resource;
const realCopiedFont = realPasted.transaction.operations[1].resource;
const realPastedNode = realPasted.transaction.operations[2].node;
assert.equal(realCopiedTexture.kind, "image");
assert.equal(realCopiedFont.kind, "font");
assert.equal(realCopiedFont.metadata.textureId, realCopiedTexture.id);
assert.equal(realPastedNode.font, `ui://rbw1tv9t${realCopiedFont.id}`);

const runtime = new BackendRuntime();
const opened = runtime.openProjectSession({
    project: sourceProject,
    storage: {
        fileSystem,
        fairyPath,
        canonicalProjectPath: "memory://desktop-copy-paste",
        canonicalPathKey: "memory://desktop-copy-paste",
    },
});
assert.equal(opened.ok, true, JSON.stringify(opened));
const realApplied = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: opened.data.revision,
    operations: realPasted.transaction.operations,
});
assert.equal(realApplied.ok, true, JSON.stringify(realApplied));
assert.equal((await runtime.saveSession({ sessionId: opened.data.sessionId })).ok, true);
const realReloaded = liftDocumentToUamProject(await new ProjectReader(fileSystem).read(
    fairyPath,
    { includeBinaryData: true, hydrateResourceBytes: true },
));
const reloadedBag = realReloaded.packages.find((pkg) => pkg.id === "rbw1tv9t");
assert.equal(
    reloadedBag.resources.find((resource) => resource.id === realCopiedFont.id).metadata.textureId,
    realCopiedTexture.id,
);
assert.equal(
    reloadedBag.resources
        .find((resource) => resource.id === "kcy10").component.displayList
        .find((displayNode) => displayNode.id === realPastedNode.id).font,
    `ui://rbw1tv9t${realCopiedFont.id}`,
);
const realUndone = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: realApplied.data.revision,
    operations: realPasted.transaction.inverseOperations,
});
assert.equal(realUndone.ok, true, JSON.stringify(realUndone));
assert.equal((await runtime.saveSession({ sessionId: opened.data.sessionId })).ok, true);
const realRestored = liftDocumentToUamProject(await new ProjectReader(fileSystem).read(
    fairyPath,
    { includeBinaryData: true, hydrateResourceBytes: true },
));
const restoredBag = realRestored.packages.find((pkg) => pkg.id === "rbw1tv9t");
assert.equal(restoredBag.resources.some((resource) =>
    resource.id === realCopiedFont.id || resource.id === realCopiedTexture.id
), false);
assert.equal(
    restoredBag.resources
        .find((resource) => resource.id === "kcy10").component.displayList
        .some((displayNode) => displayNode.id === realPastedNode.id),
    false,
);

console.log(JSON.stringify({
    ok: true,
    verified: [
        "multi-node clipboard clone",
        "one atomic paste transaction",
        "unique ids and relative offset",
        "internal relation remap",
        "external relation and controller dependency gates",
        "reverse-order inverse detach",
        "cross-package recursive component and binary asset dependency copy",
        "structured reference rewrite",
        "cross-package inverse restoration",
        "real bitmap-font paste save, ProjectReader reload, inverse save, and cleanup",
        "multi-node delete with ascending inverse attach",
    ],
}, null, 2));
