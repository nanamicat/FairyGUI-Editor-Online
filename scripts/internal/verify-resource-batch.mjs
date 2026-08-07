import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveAuthoringProjectPath, resolveOpenFairyGuiModuleRoot } from "../project-boundary.mjs";

const moduleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const projectPath = resolveAuthoringProjectPath(process.argv[3]);
const packageVersion = JSON.parse(readFileSync(path.join(moduleRoot, "core/package.json"), "utf8")).version;
assert.equal(packageVersion, "0.2.4", "Resource batch verification requires OpenFairyGUI 0.2.4.");
const editorUiSource = [
    readFileSync("src/editor/EditorShell.ts", "utf8"),
    readFileSync("src/editor/modules/ProjectExplorerModule.ts", "utf8"),
    readFileSync("src/editor/ui/ProjectTreeInteractionController.ts", "utf8"),
    readFileSync("src/editor/ui/ResourceAuthoringController.ts", "utf8"),
].join("\n");
for (const sourceContract of [
    "prepareDuplicateResources(",
    "prepareRemoveResources(",
    "this.handleLibraryItemClick(data, itemObject.parent as fgui.GList)",
    "list.selectionMode = fgui.ListSelectionMode.Multiple",
    "_lastSelectedIndex = -1",
    "this.selectedLibraryResourceSelectors = [];",
]) {
    assert(editorUiSource.includes(sourceContract), `Editor UI must wire ${sourceContract}`);
}

const importFile = (filePath) => import(pathToFileURL(filePath).href);
const [core, uam, projectIo, backend, transactions, saveTargets] = await Promise.all([
    importFile(path.join(moduleRoot, "core/dist/index.js")),
    importFile(path.join(moduleRoot, "core/dist/uam/index.js")),
    importFile(path.join(moduleRoot, "core/dist/project-io.js")),
    importFile(path.join(moduleRoot, "backend/dist/index.mjs")),
    importTypeScriptModule("src/editor/commands/ResourceTransactions.ts"),
    importTypeScriptModule("src/editor/services/BrowserSaveTargetVerifier.ts"),
]);

const storage = new MemoryBrowserStorage();
storage.importDirectory(path.dirname(projectPath));
const fileSystem = backend.createBackendStorageFileSystem(storage);
const readProject = async () => {
    const document = await new projectIo.ProjectReader(fileSystem).read(path.basename(projectPath), {
        includeBinaryData: true,
        hydrateResourceBytes: true,
    });
    return core.liftDocumentToUamProject(document);
};
const baseline = await readProject();
const packageTemplate = baseline.packages.find((pkg) => {
    const kinds = new Set(pkg.resources.map((resource) => resource.kind));
    return ["component", "image", "sound", "font", "movieClip"].every((kind) => kinds.has(kind));
});
assert(packageTemplate, "The authoring project must contain one package with the five native resource kinds.");

const cloneResource = (resource, { id, name, path: resourcePath = "/imported/resource-batch/" }) => {
    const clone = structuredClone(resource);
    delete clone.sourcePath;
    clone.id = id;
    clone.name = name;
    clone.path = resourcePath;
    clone.branch = resource.branch || "";
    clone.branchItemIds = [];
    const fileName = String(resource.fileName || resource.file || "");
    const extensionIndex = fileName.lastIndexOf(".");
    const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
    if (resource.fileName !== undefined) clone.fileName = `${name}${extension}`;
    if (resource.file !== undefined) clone.file = `${name}${extension}`;
    return clone;
};

const requireResource = (pkg, kind) => {
    const resource = pkg.resources.find((candidate) => candidate.kind === kind);
    assert(resource, `Missing ${kind} fixture resource.`);
    return resource;
};

const findComponentReferenceFixture = (pkg) => {
    for (const resource of pkg.resources) {
        const node = resource.kind === "component"
            ? resource.component?.displayList?.find((candidate) => candidate.kind === "component")
            : null;
        if (!node?.resource?.resourceId) continue;
        const target = pkg.resources.find((candidate) => (
            candidate.kind === "component" && candidate.id === node.resource.resourceId
        ));
        if (target) return { owner: resource, node, target };
    }
    assert.fail("Missing component-owner fixture resource.");
};

const createMiscResource = () => ({
    kind: "misc",
    id: "batch_misc",
    name: "BatchMisc",
    path: "/imported/resource-batch/",
    exported: false,
    favorite: false,
    branch: "",
    branchItemIds: [],
    file: "BatchMisc.bin",
    metadata: null,
    sourceBytes: new Uint8Array([0x46, 0x47, 0x55, 0x49]),
});

const createMixedFixture = () => {
    const project = structuredClone(baseline);
    const pkg = project.packages.find((candidate) => candidate.id === packageTemplate.id);
    assert(pkg);
    const relationFixture = findComponentReferenceFixture(pkg);
    const image = cloneResource(requireResource(pkg, "image"), { id: "batch_image", name: "BatchImage" });
    const sound = cloneResource(requireResource(pkg, "sound"), { id: "batch_sound", name: "BatchSound" });
    const font = cloneResource(requireResource(pkg, "font"), { id: "batch_font", name: "BatchFont" });
    font.metadata = { ...(font.metadata || {}), textureId: image.id };
    const movieClip = cloneResource(requireResource(pkg, "movieClip"), {
        id: "batch_movie_clip",
        name: "BatchMovieClip",
    });
    const misc = createMiscResource();
    const target = cloneResource(relationFixture.target, {
        id: "batch_target_component",
        name: "BatchTargetComponent",
    });
    const owner = cloneResource(relationFixture.owner, {
        id: "batch_owner_component",
        name: "BatchOwnerComponent",
    });
    const ownerNode = structuredClone(relationFixture.node);
    ownerNode.id = "batch_owner_node";
    ownerNode.name = "batch_owner_node";
    ownerNode.resource = { packageId: "", resourceId: target.id };
    owner.component.controllers = [];
    owner.component.transitions = [];
    owner.component.displayList = [ownerNode];
    const selectedResources = [image, sound, font, movieClip, misc, target, owner];
    pkg.resources.push(...selectedResources);
    return {
        project,
        packageId: pkg.id,
        selectedResources,
        selectors: selectedResources.map((resource) => ({ packageId: pkg.id, resourceId: resource.id })),
    };
};

const transactionOperations = (transaction) => transaction.operations || [transaction.operation];
const transactionInverseOperations = (transaction) => transaction.inverseOperations || [transaction.inverseOperation];
const findPackage = (project, packageId) => project.packages.find((pkg) => pkg.id === packageId);
const findResource = (project, packageId, resourceId) => (
    findPackage(project, packageId)?.resources.find((resource) => resource.id === resourceId)
);
const canonicalResource = (resource) => {
    const value = structuredClone(resource);
    delete value.sourcePath;
    return value;
};
const canonicalResources = (project, packageId, resourceIds) => resourceIds
    .map((resourceId) => canonicalResource(findResource(project, packageId, resourceId)))
    .sort((left, right) => left.id.localeCompare(right.id));

const mixed = createMixedFixture();
const mixedBefore = structuredClone(mixed.project);
const duplicatePreparation = transactions.prepareDuplicateResources(mixed.project, mixed.selectors);
assert.equal(duplicatePreparation.ok, true, JSON.stringify(duplicatePreparation));
assert.deepEqual(mixed.project, mixedBefore, "Duplicate planning must not mutate the source project.");
const duplicateOperations = transactionOperations(duplicatePreparation.transaction);
assert.equal(duplicateOperations.length, mixed.selectors.length);
assert.equal(duplicateOperations.filter((operation) => operation.kind === "addComponent").length, 2);
assert.equal(duplicateOperations.filter((operation) => operation.kind === "addResource").length, 5);
assert.deepEqual(
    [...new Set(duplicateOperations.map((operation) => (
        operation.kind === "addComponent" ? operation.component.kind : operation.resource.kind
    )))].sort(),
    ["component", "font", "image", "misc", "movieClip", "sound"],
);
for (const [index, operation] of duplicateOperations.entries()) {
    const copy = operation.kind === "addComponent" ? operation.component : operation.resource;
    const source = mixed.selectedResources[index];
    assert.equal(copy.path, source.path, `${source.kind} duplicate must preserve its Library path.`);
    assert.equal(copy.branch || "", source.branch || "", `${source.kind} duplicate must preserve its branch.`);
}
const duplicated = uam.applyUamTransaction(mixed.project, duplicateOperations);
assert.deepEqual(mixed.project, mixedBefore, "OpenFairyGUI transaction apply must keep the source project immutable.");
const duplicateIds = duplicateOperations.map((operation) => (
    operation.kind === "addComponent" ? operation.component.id : operation.resource.id
));
for (const resourceId of duplicateIds) assert(findResource(duplicated, mixed.packageId, resourceId));
const duplicateRestored = uam.applyUamTransaction(
    duplicated,
    transactionInverseOperations(duplicatePreparation.transaction),
);
for (const resourceId of duplicateIds) assert.equal(findResource(duplicateRestored, mixed.packageId, resourceId), undefined);
assert.equal(findPackage(duplicateRestored, mixed.packageId).resources.length, findPackage(mixed.project, mixed.packageId).resources.length);

const removeBefore = structuredClone(mixed.project);
const removePreparation = transactions.prepareRemoveResources(mixed.project, mixed.selectors);
assert.equal(removePreparation.ok, true, JSON.stringify(removePreparation));
assert.deepEqual(mixed.project, removeBefore, "Delete planning must not mutate the source project.");
const removeOperations = transactionOperations(removePreparation.transaction);
assert.equal(removeOperations.length, mixed.selectors.length);
assert.deepEqual(removeOperations.slice(0, 2).map((operation) => operation.kind), ["removeComponent", "removeComponent"]);
assert(
    removeOperations.findIndex((operation) => operation.selector.resourceId === "batch_font")
        < removeOperations.findIndex((operation) => operation.selector.resourceId === "batch_image"),
    "Font deletion must precede its selected texture deletion.",
);
const removed = uam.applyUamTransaction(mixed.project, removeOperations);
for (const selector of mixed.selectors) assert.equal(findResource(removed, selector.packageId, selector.resourceId), undefined);
const restored = uam.applyUamTransaction(removed, transactionInverseOperations(removePreparation.transaction));
const normalizedMixed = uam.applyUamTransaction(mixed.project, []);
const inverseOperations = transactionInverseOperations(removePreparation.transaction);
const inverseSaveTarget = saveTargets.createTransactionSaveTarget(restored, inverseOperations);
assert(inverseSaveTarget, "Mixed inverse must create a SaveTarget.");
assert.equal(saveTargets.verifySaveTarget(restored, inverseSaveTarget).ok, true);
const wrongOrder = structuredClone(restored);
const wrongOrderPackage = findPackage(wrongOrder, mixed.packageId);
const movedIndex = wrongOrderPackage.resources.findIndex((resource) => resource.id === mixed.selectors[0].resourceId);
const [movedResource] = wrongOrderPackage.resources.splice(movedIndex, 1);
wrongOrderPackage.resources.unshift(movedResource);
assert.equal(
    saveTargets.verifySaveTarget(wrongOrder, inverseSaveTarget).ok,
    false,
    "SaveTarget must reject a reloaded package with the wrong resource order.",
);
const corruptComponent = structuredClone(restored);
findResource(corruptComponent, mixed.packageId, "batch_owner_component").component.displayList[0].name = "corrupt";
assert.equal(
    saveTargets.verifySaveTarget(corruptComponent, inverseSaveTarget).ok,
    false,
    "SaveTarget must reject a reloaded component whose body was corrupted.",
);
assert.deepEqual(
    findPackage(restored, mixed.packageId).resources.map((resource) => resource.id),
    findPackage(normalizedMixed, mixed.packageId).resources.map((resource) => resource.id),
    "Inverse must restore the exact package resource order.",
);
assert.deepEqual(
    canonicalResources(restored, mixed.packageId, mixed.selectors.map((selector) => selector.resourceId)),
    canonicalResources(normalizedMixed, mixed.packageId, mixed.selectors.map((selector) => selector.resourceId)),
    "Inverse must restore every selected component and asset snapshot.",
);

const runtime = new backend.BackendRuntime();
const opened = runtime.openProjectSession({
    project: structuredClone(mixed.project),
    storage: {
        fileSystem,
        fairyPath: path.basename(projectPath),
        canonicalProjectPath: "opfs://resource-batch",
        canonicalPathKey: "opfs://resource-batch",
    },
});
assert.equal(opened.ok, true, JSON.stringify(opened));
const applied = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: opened.data.revision,
    operations: removeOperations,
});
assert.equal(applied.ok, true, JSON.stringify(applied));
assert.equal(applied.data.revision, opened.data.revision + 1, "A mixed batch must create one session revision.");
const saved = await runtime.saveSession({
    sessionId: opened.data.sessionId,
    expectedRevision: applied.data.revision,
});
assert.equal(saved.ok, true, JSON.stringify(saved));
const removalReloaded = await readProject();
for (const selector of mixed.selectors) {
    assert.equal(findResource(removalReloaded, selector.packageId, selector.resourceId), undefined);
}
const undone = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: saved.data.revision,
    operations: transactionInverseOperations(removePreparation.transaction),
});
assert.equal(undone.ok, true, JSON.stringify(undone));
assert.equal(undone.data.revision, saved.data.revision + 1, "A mixed inverse must create one session revision.");
const undoSaved = await runtime.saveSession({
    sessionId: opened.data.sessionId,
    expectedRevision: undone.data.revision,
});
assert.equal(undoSaved.ok, true, JSON.stringify(undoSaved));
const undoReloaded = await readProject();
assert.equal(
    saveTargets.verifySaveTarget(undoReloaded, inverseSaveTarget).ok,
    true,
    "SaveTarget must accept the exact batch inverse after Save/ProjectReader reload.",
);
assert.deepEqual(
    findPackage(undoReloaded, mixed.packageId).resources.map((resource) => resource.id),
    findPackage(normalizedMixed, mixed.packageId).resources.map((resource) => resource.id),
    "Save/reload must preserve the exact restored package resource order.",
);
for (const source of mixed.selectedResources) {
    const reloaded = findResource(undoReloaded, mixed.packageId, source.id);
    assert(reloaded, `Save/reload must restore ${source.kind} ${source.id}.`);
    assert.equal(reloaded.kind, source.kind);
    assert.equal(reloaded.path, source.path);
    assert.equal(reloaded.branch || "", source.branch || "");
    if (source.kind !== "component") assert.deepEqual(reloaded.sourceBytes, source.sourceBytes);
}
assert.equal(
    findResource(undoReloaded, mixed.packageId, "batch_owner_component")
        .component.displayList[0].resource.resourceId,
    "batch_target_component",
    "Save/reload must preserve the selected component owner-to-target dependency.",
);

const createFontTextureFixture = () => {
    const project = structuredClone(baseline);
    const pkg = project.packages.find((candidate) => candidate.id === packageTemplate.id);
    assert(pkg);
    const texture = cloneResource(requireResource(pkg, "image"), { id: "batch_shared_texture", name: "BatchSharedTexture" });
    const fontA = cloneResource(requireResource(pkg, "font"), { id: "batch_font_a", name: "BatchFontA" });
    const fontB = cloneResource(requireResource(pkg, "font"), { id: "batch_font_b", name: "BatchFontB" });
    fontA.metadata = { ...(fontA.metadata || {}), textureId: texture.id };
    fontB.metadata = { ...(fontB.metadata || {}), textureId: texture.id };
    pkg.resources.push(texture, fontA, fontB);
    return { project, packageId: pkg.id, texture, fonts: [fontA, fontB] };
};

const fontTexture = createFontTextureFixture();
const fontTextureBefore = structuredClone(fontTexture.project);
const fontTexturePreparation = transactions.prepareRemoveResources(
    fontTexture.project,
    fontTexture.fonts.map((font) => ({ packageId: fontTexture.packageId, resourceId: font.id })),
);
assert.equal(fontTexturePreparation.ok, true, JSON.stringify(fontTexturePreparation));
assert.deepEqual(fontTexture.project, fontTextureBefore);
const fontTextureOperations = transactionOperations(fontTexturePreparation.transaction);
assert.equal(
    fontTextureOperations.filter((operation) => operation.selector.resourceId === fontTexture.texture.id).length,
    1,
    "Two selected fonts sharing one texture must schedule that texture exactly once.",
);
const fontsRemoved = uam.applyUamTransaction(fontTexture.project, fontTextureOperations);
for (const resource of [fontTexture.texture, ...fontTexture.fonts]) {
    assert.equal(findResource(fontsRemoved, fontTexture.packageId, resource.id), undefined);
}
const fontsRestored = uam.applyUamTransaction(
    fontsRemoved,
    transactionInverseOperations(fontTexturePreparation.transaction),
);
const normalizedFontTexture = uam.applyUamTransaction(fontTexture.project, []);
assert.deepEqual(
    canonicalResources(fontsRestored, fontTexture.packageId, [fontTexture.texture.id, ...fontTexture.fonts.map((font) => font.id)]),
    canonicalResources(normalizedFontTexture, fontTexture.packageId, [fontTexture.texture.id, ...fontTexture.fonts.map((font) => font.id)]),
);

const blocked = createMixedFixture();
const blockedPackage = findPackage(blocked.project, blocked.packageId);
const relationFixture = findComponentReferenceFixture(blockedPackage);
const externalOwner = cloneResource(relationFixture.owner, {
    id: "batch_external_owner",
    name: "BatchExternalOwner",
});
const externalNode = structuredClone(relationFixture.node);
externalNode.id = "batch_external_node";
externalNode.name = "batch_external_node";
externalNode.resource = { packageId: "", resourceId: "batch_target_component" };
externalOwner.component.controllers = [];
externalOwner.component.transitions = [];
externalOwner.component.displayList = [externalNode];
blockedPackage.resources.push(externalOwner);
const blockedBefore = structuredClone(blocked.project);
const blockedPreparation = transactions.prepareRemoveResources(blocked.project, blocked.selectors);
assert.equal(blockedPreparation.ok, false);
assert.equal(blockedPreparation.code, "resource_in_use");
assert.equal("transaction" in blockedPreparation, false, "A blocked batch must not expose a partial transaction.");
assert.deepEqual(blocked.project, blockedBefore, "A blocked batch must not mutate the source project.");

const unavailable = createMixedFixture();
delete findResource(unavailable.project, unavailable.packageId, "batch_sound").sourceBytes;
const unavailableBefore = structuredClone(unavailable.project);
const unavailablePreparation = transactions.prepareRemoveResources(unavailable.project, unavailable.selectors);
assert.equal(unavailablePreparation.ok, false);
assert.equal(unavailablePreparation.code, "unavailable_resource_source_bytes");
assert.equal("transaction" in unavailablePreparation, false);
assert.deepEqual(unavailable.project, unavailableBefore);

console.log(JSON.stringify({
    ok: true,
    packageVersion,
    packageId: mixed.packageId,
    duplicate: {
        resources: mixed.selectors.length,
        operations: duplicateOperations.length,
        inverseOperations: transactionInverseOperations(duplicatePreparation.transaction).length,
    },
    remove: {
        resources: mixed.selectors.length,
        operations: removeOperations.length,
        inverseOperations: transactionInverseOperations(removePreparation.transaction).length,
        applyRevisionDelta: applied.data.revision - opened.data.revision,
        undoRevisionDelta: undone.data.revision - saved.data.revision,
        saveReload: "verified",
    },
    fontTexture: {
        selectedFonts: fontTexture.fonts.length,
        textureRemovals: 1,
    },
    externalReferenceGuard: blockedPreparation.code,
    unavailableBytesGuard: unavailablePreparation.code,
    sourceUnchanged: true,
}, null, 2));
