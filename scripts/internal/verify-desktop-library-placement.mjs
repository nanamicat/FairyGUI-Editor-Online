import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveAuthoringProjectPath } from "../project-boundary.mjs";

const report = JSON.parse(await readFile(
    path.resolve("assets/resources/editor/runtime/uam-baseline.json"),
    "utf8",
));
const baseline = report.uamProject;
const { preparePlaceResourceDisplayNode } = await importTypeScriptModule(
    "src/editor/commands/HighRiskAuthoringTransactions.ts",
);
const {
    applyUamTransaction,
    BackendRuntime,
    createBackendStorageFileSystem,
    ProjectReader,
    liftDocumentToUamProject,
} = await import(
    pathToFileURL(path.resolve(
        process.argv[2] ?? "assets/resources/editor/runtime/openfairygui-backend-browser.js",
    )).href
);
const component = { packageId: "rbw1tv9t", componentResourceId: "kcy10" };

function prepare(resourceId, position = { x: 123, y: 234 }, packageId = component.packageId) {
    return preparePlaceResourceDisplayNode(
        baseline,
        component,
        { packageId, resourceId },
        position,
    );
}

function verifyPlacement(resourceId, kind, size, packageId = component.packageId) {
    const prepared = prepare(resourceId, { x: 123, y: 234 }, packageId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.deepEqual(baseline, original, "preparing must not mutate the working project");
    const operations = prepared.transaction.operations || [prepared.transaction.operation];
    const inverseOperations = prepared.transaction.inverseOperations || [prepared.transaction.inverseOperation];
    const operation = operations.find((candidate) => candidate.kind === "attachDisplayNode");
    assert.equal(operation.kind, "attachDisplayNode");
    assert.equal(operation.node.kind, kind);
    assert.deepEqual(operation.node.position, { x: 123, y: 234 });
    assert.deepEqual(operation.node.size, size);
    assert.equal(operation.node.resource.resourceId, resourceId);
    if (kind === "component" || kind === "movieClip") {
        assert.equal(
            operation.node.resource.packageId,
            packageId === component.packageId ? "" : packageId,
        );
    }
    if (kind === "movieClip") {
        assert.deepEqual(
            {
                fileName: operation.node.fileName,
                filter: operation.node.filter,
                filterData: operation.node.filterData,
                playing: operation.node.playing,
                frame: operation.node.frame,
                color: operation.node.color,
            },
            {
                fileName: "",
                filter: "",
                filterData: "",
                playing: true,
                frame: 0,
                color: "#FFFFFF",
            },
        );
    }

    const applied = applyUamTransaction(
        structuredClone(baseline),
        operations,
    );
    const displayList = applied.packages
        .find((pkg) => pkg.id === component.packageId).resources
        .find((resource) => resource.id === component.componentResourceId).component.displayList;
    const appliedNode = displayList.find((node) => node.id === operation.node.id);
    assert(appliedNode);
    if (kind === "movieClip") {
        assert.equal(appliedNode.resource.packageId || component.packageId, component.packageId);
    }
    const restored = applyUamTransaction(
        applied,
        inverseOperations,
    );
    const restoredDisplayList = restored.packages
        .find((pkg) => pkg.id === component.packageId).resources
        .find((resource) => resource.id === component.componentResourceId).component.displayList;
    const originalDisplayList = baseline.packages
        .find((pkg) => pkg.id === component.packageId).resources
        .find((resource) => resource.id === component.componentResourceId).component.displayList;
    assert.deepEqual(
        restoredDisplayList.map((node) => node.id),
        originalDisplayList.map((node) => node.id),
    );
}

const original = structuredClone(baseline);
verifyPlacement("thi7h", "image", { width: 122, height: 103 });
verifyPlacement("dwwc4", "component", { width: 60, height: 74 });
verifyPlacement("thi7j", "movieClip", { width: 120, height: 119 });
verifyPlacement("rpmb1b", "component", { width: 1136, height: 570 }, "9leh0eyf");
verifyPlacement("rpmbz", "component", { width: 85, height: 25 }, "9leh0eyf");

assert.equal(prepare("kcy10").code, "recursive_component_reference");
const cyclic = structuredClone(baseline);
cyclic.packages
    .find((pkg) => pkg.id === "9leh0eyf").resources
    .find((resource) => resource.id === "rpmb1b").component.displayList
    .push({
        kind: "component",
        id: "synthetic-cycle",
        resource: { packageId: "rbw1tv9t", resourceId: "kcy10" },
    });
assert.equal(preparePlaceResourceDisplayNode(
    cyclic,
    component,
    { packageId: "9leh0eyf", resourceId: "rpmb1b" },
    { x: 0, y: 0 },
).code, "recursive_component_reference");
assert.equal(preparePlaceResourceDisplayNode(
    baseline,
    component,
    { packageId: "9leh0eyf", resourceId: "rpmb1" },
    { x: 0, y: 0 },
).code, "component_dependency_bytes_unavailable");
assert.equal(preparePlaceResourceDisplayNode(
    baseline,
    component,
    { packageId: "9leh0eyf", resourceId: "hixt1v" },
    { x: 0, y: 0 },
).code, "component_dependency_bytes_unavailable");

const storage = new MemoryBrowserStorage();
const authoringProjectPath = resolveAuthoringProjectPath();
storage.importDirectory(path.dirname(authoringProjectPath));
const fileSystem = createBackendStorageFileSystem(storage);
const fairyPath = path.basename(authoringProjectPath);
const sourceProject = liftDocumentToUamProject(await new ProjectReader(fileSystem).read(
    fairyPath,
    { includeBinaryData: true, hydrateResourceBytes: true },
));
const sourceProjectOriginal = structuredClone(sourceProject);
for (const [resourceId, expectedKind] of [["rpmb1", "image"], ["hixt1v", "movieClip"]]) {
    const crossAsset = preparePlaceResourceDisplayNode(
        sourceProject,
        component,
        { packageId: "9leh0eyf", resourceId },
        { x: 123, y: 234 },
    );
    assert.equal(crossAsset.ok, true, JSON.stringify(crossAsset));
    assert.deepEqual(sourceProject, sourceProjectOriginal);
    assert.deepEqual(
        crossAsset.transaction.operations.map((operation) => operation.kind),
        ["addResource", "attachDisplayNode"],
    );
    assert.deepEqual(
        crossAsset.transaction.inverseOperations.map((operation) => operation.kind),
        ["detachDisplayNode", "removeResource"],
    );
    const addResource = crossAsset.transaction.operations[0];
    const attachNode = crossAsset.transaction.operations[1];
    assert.equal(addResource.resource.kind, expectedKind);
    assert(addResource.resource.sourceBytes instanceof Uint8Array);
    assert.deepEqual(attachNode.node.resource, {
        packageId: component.packageId,
        resourceId: addResource.resource.id,
    });
    const appliedCrossAsset = applyUamTransaction(
        structuredClone(sourceProject),
        crossAsset.transaction.operations,
    );
    const restoredCrossAsset = applyUamTransaction(
        appliedCrossAsset,
        crossAsset.transaction.inverseOperations,
    );
    assert.deepEqual(
        restoredCrossAsset.packages
            .find((pkg) => pkg.id === component.packageId).resources
            .map((resource) => resource.id),
        sourceProject.packages
            .find((pkg) => pkg.id === component.packageId).resources
            .map((resource) => resource.id),
    );
}
const persisted = preparePlaceResourceDisplayNode(
    sourceProject,
    component,
    { packageId: "9leh0eyf", resourceId: "rpmb1" },
    { x: 123, y: 234 },
);
assert.equal(persisted.ok, true, JSON.stringify(persisted));
const persistedOperations = persisted.transaction.operations;
const persistedInverseOperations = persisted.transaction.inverseOperations;
const persistedResource = persistedOperations.find((operation) => operation.kind === "addResource").resource;
const persistedAttach = persistedOperations.find((operation) => operation.kind === "attachDisplayNode");
const runtime = new BackendRuntime();
const opened = runtime.openProjectSession({
    project: sourceProject,
    storage: {
        fileSystem,
        fairyPath,
        canonicalProjectPath: "memory://desktop-library-placement",
        canonicalPathKey: "memory://desktop-library-placement",
    },
});
assert.equal(opened.ok, true, JSON.stringify(opened));
const applied = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: opened.data.revision,
    operations: persistedOperations,
});
assert.equal(applied.ok, true, JSON.stringify(applied));
const saved = await runtime.saveSession({ sessionId: opened.data.sessionId });
assert.equal(saved.ok, true, JSON.stringify(saved));
const reloadedProject = liftDocumentToUamProject(await new ProjectReader(fileSystem).read(
    fairyPath,
    { includeBinaryData: true, hydrateResourceBytes: true },
));
const reloadedNode = reloadedProject.packages
    .find((pkg) => pkg.id === component.packageId).resources
    .find((resource) => resource.id === component.componentResourceId).component.displayList
    .find((node) => node.id === persistedAttach.node.id);
const projectedProject = applyUamTransaction(
    structuredClone(sourceProject),
    persistedOperations,
);
const projectedNode = projectedProject.packages
    .find((pkg) => pkg.id === component.packageId).resources
    .find((resource) => resource.id === component.componentResourceId).component.displayList
    .find((node) => node.id === persistedAttach.node.id);
assert.deepEqual(
    {
        id: reloadedNode?.id,
        index: reloadedProject.packages
            .find((pkg) => pkg.id === component.packageId).resources
            .find((resource) => resource.id === component.componentResourceId).component.displayList
            .findIndex((node) => node.id === persistedAttach.node.id),
        resourceId: reloadedNode?.resource?.resourceId,
    },
    {
        id: persistedAttach.node.id,
        index: sourceProject.packages
            .find((pkg) => pkg.id === component.packageId).resources
            .find((resource) => resource.id === component.componentResourceId).component.displayList.length,
        resourceId: projectedNode?.resource?.resourceId,
    },
);
assert.equal(
    reloadedNode?.resource?.packageId || component.packageId,
    projectedNode?.resource?.packageId || component.packageId,
);
const reloadedCopiedResource = reloadedProject.packages
    .find((pkg) => pkg.id === component.packageId).resources
    .find((resource) => resource.id === persistedResource.id);
assert.equal(reloadedCopiedResource?.kind, "image");
assert.deepEqual([...reloadedCopiedResource.sourceBytes], [...persistedResource.sourceBytes]);

const undone = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: applied.data.revision,
    operations: persistedInverseOperations,
});
assert.equal(undone.ok, true, JSON.stringify(undone));
const undoSaved = await runtime.saveSession({ sessionId: opened.data.sessionId });
assert.equal(undoSaved.ok, true, JSON.stringify(undoSaved));
const restoredProject = liftDocumentToUamProject(await new ProjectReader(fileSystem).read(
    fairyPath,
    { includeBinaryData: true, hydrateResourceBytes: true },
));
assert.equal(
    restoredProject.packages
        .find((pkg) => pkg.id === component.packageId).resources
        .find((resource) => resource.id === component.componentResourceId).component.displayList
        .some((node) => node.id === persistedAttach.node.id),
    false,
);
assert.equal(
    restoredProject.packages
        .find((pkg) => pkg.id === component.packageId).resources
        .some((resource) => resource.id === persistedResource.id),
    false,
);

console.log(JSON.stringify({
    ok: true,
    verified: [
        "same-package image, movieClip, and component placement",
        "cross-package plain and derived component placement",
        "cross-package image and MovieClip dependency copy",
        "natural resource sizes and local or explicit cross-package references",
        "atomic apply/inverse",
        "cross-package image save, ProjectReader reload, inverse save, and cleanup",
        "direct and indirect recursion plus unhydrated asset guards",
    ],
}, null, 2));
