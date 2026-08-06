import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { unzipSync } from "fflate";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveAuthoringProjectPath, resolveOpenFairyGuiModuleRoot } from "../project-boundary.mjs";

const moduleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const projectPath = resolveAuthoringProjectPath(process.argv[3]);
const projectDir = path.dirname(projectPath);
const fairyPath = path.basename(projectPath);
const importFile = (filePath) => import(pathToFileURL(filePath).href);
const expectedVersion = "0.2.4";
for (const packageName of ["core", "functions", "backend", "cli"]) {
    const version = JSON.parse(readFileSync(path.join(moduleRoot, packageName, "package.json"), "utf8")).version;
    assert.equal(version, expectedVersion, `${packageName} must use OpenFairyGUI ${expectedVersion}`);
}

const editorUiSource = [
    readFileSync("src/editor/EditorShell.ts", "utf8"),
    readFileSync("src/editor/dialogs/EditorDialogs.ts", "utf8"),
    readFileSync("src/editor/ui/ResourceAuthoringController.ts", "utf8"),
].join("\n");
for (const sourceContract of [
    "desktopMenuImportFairyPackageResources",
    "Import Resources into Existing Package...",
    'UIPackage.createObject("Builder", "PasteOptionDialog")',
    '["rename", "replace", "skip"]',
    'data-fairy-editor-paste-options',
    "inspectFairyPackageResourceImport(",
    "prepareImportFairyPackageResources(",
    "captureSessionIdentity()",
    "isSessionIdentityCurrent(identity)",
    "ensureFairyPackageInteractionCurrent(interactionIdentity",
]) {
    assert(editorUiSource.includes(sourceContract), `Editor UI must wire ${sourceContract}`);
}

const [core, uam, projectIo, backend, transfer, saveTargetVerifier] = await Promise.all([
    importFile(path.join(moduleRoot, "core/dist/index.js")),
    importFile(path.join(moduleRoot, "core/dist/uam/index.js")),
    importFile(path.join(moduleRoot, "core/dist/project-io.js")),
    importFile(path.join(moduleRoot, "backend/dist/index.mjs")),
    importTypeScriptModule("src/editor/services/FairyPackageTransfer.ts"),
    importTypeScriptModule("src/editor/services/BrowserSaveTargetVerifier.ts"),
]);
const transferBackend = {
    BackendRuntime: backend.BackendRuntime,
    createBackendStorageFileSystem: backend.createBackendStorageFileSystem,
    ProjectReader: projectIo.ProjectReader,
    liftDocumentToUamProject: core.liftDocumentToUamProject,
};

const sourceStorage = new MemoryBrowserStorage();
sourceStorage.importDirectory(projectDir);
const sourceFileSystem = backend.createBackendStorageFileSystem(sourceStorage);
const sourceReader = new projectIo.ProjectReader(sourceFileSystem);
const baseline = core.liftDocumentToUamProject(await sourceReader.read(fairyPath, {
    includeBinaryData: true,
    hydrateResourceBytes: true,
}));
const baselineHash = hashValue(baseline);
const bag = baseline.packages.find((pkg) => pkg.name === "Bag");
const basics = baseline.packages.find((pkg) => pkg.name === "Basics");
const bagWin = bag?.resources.find((resource) => resource.kind === "component" && resource.name === "BagWin");
assert(bag && basics && bagWin, "Bag/BagWin and Basics fixtures are required.");

const exported = await transfer.exportFairyPackageResources(transferBackend, baseline, [{
    packageId: bag.id,
    resourceId: bagWin.id,
}]);
const archiveFiles = Object.entries(unzipSync(new Uint8Array(await exported.blob.arrayBuffer())))
    .filter(([name]) => !name.endsWith("/"))
    .map(([filePath, data]) => ({ path: filePath, data }));
const importedPackage = await transfer.readFairyPackageFiles(transferBackend, archiveFiles);
importedPackage.folders.push({ path: "/empty/child/", branch: "", favorite: true, atlas: "" });
const importedHash = hashValue(importedPackage);
const incomingRoot = importedPackage.resources.find((resource) => resource.kind === "component" && resource.name === "BagWin");
assert(incomingRoot, "The BagWin subset archive must contain its selected root component.");

const strategies = {};
for (const strategy of ["rename", "replace", "skip"]) {
    const fixture = createConflictFixture(baseline, basics.id, incomingRoot.name, importedPackage);
    const fixtureHash = hashValue(fixture.project);
    const options = {
        targetPackageId: basics.id,
        targetPath: "/air-import/",
        targetBranch: "",
        conflictStrategy: strategy,
    };
    const inspection = transfer.inspectFairyPackageResourceImport(fixture.project, importedPackage, options);
    assert(inspection.conflicts.length >= 2, `${strategy} must report component and binary conflicts.`);
    const rootConflict = inspection.conflicts.find((conflict) => conflict.incomingName === "BagWin");
    assert.equal(rootConflict?.targetResourceId, fixture.existingId);
    const preparation = transfer.prepareImportFairyPackageResources(fixture.project, importedPackage, options);
    assert.equal(preparation.ok, true, JSON.stringify(preparation));
    assert.equal(
        preparation.counts.added + preparation.counts.replaced + preparation.counts.skipped,
        inspection.resourceCount,
        `${strategy} actual resource counts must cover every planned resource.`,
    );
    assert.equal(preparation.counts.replaced, strategy === "replace" ? inspection.conflicts.length : 0);
    assert.equal(preparation.counts.skipped, strategy === "skip" ? inspection.conflicts.length : 0);
    assert(preparation.transaction.operations.length > 1, `${strategy} must use an atomic operation group.`);
    assert.equal(preparation.transaction.operation, preparation.transaction.operations[0]);
    assert.equal(preparation.transaction.inverseOperation, preparation.transaction.inverseOperations[0]);
    assertFoldersParentFirst(preparation.transaction.operations);

    const projected = uam.applyUamTransaction(fixture.project, preparation.transaction.operations);
    const projectedTarget = projected.packages.find((pkg) => pkg.id === basics.id);
    assert(projectedTarget, `${strategy} projected target package is missing.`);
    const nestedFolder = projectedTarget.folders.find((folder) => folder.path === "/air-import/empty/child/" && !folder.branch);
    assert(nestedFolder, `${strategy} must create the missing nested import folder.`);
    assert.equal(nestedFolder.favorite, true, `${strategy} must preserve imported folder metadata.`);
    assertAddedBinaryBytes(importedPackage, preparation.transaction.operations);
    assertNoImportedPackageReferences(projectedTarget, importedPackage.id);

    const conflictIndex = projectedTarget.resources.findIndex((resource) => resource.id === fixture.existingId);
    if (strategy === "rename") {
        assert.equal(conflictIndex, fixture.existingIndex, "Rename must preserve the existing conflict index.");
        assert.equal(projectedTarget.resources[fixture.existingIndex].component?.properties?.remark, "existing-target-component");
        const renamed = projectedTarget.resources.find((resource) => resource.name === "BagWin_copy");
        assert(renamed?.kind === "component", "Rename must add BagWin_copy.");
        const renamedBinary = projectedTarget.resources.find((resource) => (
            (resource.fileName || resource.file) === fixture.binaryRenamedFileName
        ));
        assert.equal(hashBytes(renamedBinary?.sourceBytes), fixture.binaryIncomingHash);
        assert.equal(hashBytes(projectedTarget.resources.find((resource) => resource.id === fixture.binaryExistingId)?.sourceBytes), fixture.binaryExistingHash);
    } else if (strategy === "replace") {
        assert.equal(conflictIndex, fixture.existingIndex, "Replace must reuse the existing id at the existing index.");
        assert.notEqual(projectedTarget.resources[conflictIndex].component?.properties?.remark, "existing-target-component");
        const removeIndex = preparation.transaction.operations.findIndex((operation) => (
            operation.kind === "removeComponent" && operation.selector.componentResourceId === fixture.existingId
        ));
        const addOperation = preparation.transaction.operations[removeIndex + 1];
        assert(removeIndex >= 0 && addOperation?.kind === "addComponent");
        assert.equal(addOperation.atIndex, fixture.existingIndex);
        assert.equal(addOperation.component.id, fixture.existingId);
        const replacedBinary = projectedTarget.resources.find((resource) => resource.id === fixture.binaryExistingId);
        assert.equal(projectedTarget.resources.indexOf(replacedBinary), fixture.binaryExistingIndex);
        assert.equal(hashBytes(replacedBinary.sourceBytes), fixture.binaryIncomingHash);
    } else {
        assert.equal(conflictIndex, fixture.existingIndex, "Skip must map to and preserve the existing conflict.");
        assert.equal(projectedTarget.resources[conflictIndex].component?.properties?.remark, "existing-target-component");
        assert(!preparation.transaction.operations.some((operation) => (
            (operation.kind === "addComponent" && operation.component.name === "BagWin")
            || (operation.kind === "removeComponent" && operation.selector.componentResourceId === fixture.existingId)
        )), "Skip must not replace or duplicate the conflicting component.");
        assert.equal(hashBytes(projectedTarget.resources.find((resource) => resource.id === fixture.binaryExistingId)?.sourceBytes), fixture.binaryExistingHash);
    }

    const undone = uam.applyUamTransaction(projected, preparation.transaction.inverseOperations);
    assertFixtureRestored(fixture.project, undone, basics.id, strategy);
    assert.equal(hashValue(fixture.project), fixtureHash, `${strategy} planning/apply must not mutate its source project.`);
    assert.equal(hashValue(importedPackage), importedHash, `${strategy} planning/apply must not mutate the parsed archive.`);

    await verifyRuntimeLifecycle(
        fixture.project,
        preparation.transaction.operations,
        preparation.transaction.inverseOperations,
        strategy,
    );
    strategies[strategy] = {
        conflicts: inspection.conflicts.length,
        operations: preparation.transaction.operations.length,
        inverseOperations: preparation.transaction.inverseOperations.length,
    };
}

const mismatchedFixture = createConflictFixture(baseline, basics.id, incomingRoot.name, importedPackage);
const mismatchTarget = mismatchedFixture.project.packages
    .find((pkg) => pkg.id === basics.id).resources[mismatchedFixture.existingIndex];
mismatchTarget.kind = "image";
mismatchTarget.fileName = `${incomingRoot.name}.xml`;
delete mismatchTarget.component;
mismatchTarget.sourceBytes = new Uint8Array([1, 2, 3]);
for (const strategy of ["replace", "skip"]) {
    const rejected = transfer.prepareImportFairyPackageResources(mismatchedFixture.project, importedPackage, {
        targetPackageId: basics.id,
        targetPath: "/air-import/",
        conflictStrategy: strategy,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "fairy_package_import_kind_mismatch");
}

const skeletonImportedPackage = structuredClone(importedPackage);
const skeletonRequiredResource = skeletonImportedPackage.resources.find((resource) => resource.kind !== "component");
assert(skeletonRequiredResource, "A skeleton dependency fixture resource is required.");
const skeletonAtlasName = String(skeletonRequiredResource.fileName || skeletonRequiredResource.file).replace(/\.[^.]+$/, "");
const skeletonImportedResource = {
    kind: "dragonBones",
    id: "skelimp1",
    name: "import_skeleton_fixture",
    path: "/skeleton/",
    exported: false,
    favorite: false,
    branch: "",
    branchItemIds: [],
    file: "import_skeleton_fixture.json",
    sourceBytes: new TextEncoder().encode('{"armature":[]}'),
    dimensions: { width: 0, height: 0 },
    metadata: { requireIds: [skeletonRequiredResource.id], atlasNames: [skeletonAtlasName], anchorX: 0, anchorY: 0 },
};
skeletonImportedPackage.resources.push(skeletonImportedResource);
skeletonImportedPackage.folders.push({ path: "/skeleton/", branch: "", favorite: false, atlas: "" });
const skeletonTargetFixture = createConflictFixture(baseline, basics.id, incomingRoot.name, importedPackage);
const skeletonTargetPackage = skeletonTargetFixture.project.packages.find((pkg) => pkg.id === basics.id);
assert(!skeletonTargetPackage.resources.some((resource) => resource.id === skeletonRequiredResource.id));
const idCollision = structuredClone(skeletonTargetPackage.resources.find((resource) => resource.kind === "image"));
idCollision.id = skeletonRequiredResource.id;
idCollision.name = "skeleton_id_collision_fixture";
idCollision.fileName = "skeleton_id_collision_fixture.png";
idCollision.path = "/images/";
delete idCollision.sourcePath;
skeletonTargetPackage.resources.push(idCollision);
const skeletonPreparation = transfer.prepareImportFairyPackageResources(
    skeletonTargetFixture.project,
    skeletonImportedPackage,
    {
        targetPackageId: basics.id,
        targetPath: "/air-import/",
        conflictStrategy: "rename",
    },
);
assert.equal(skeletonPreparation.ok, true, JSON.stringify(skeletonPreparation));
const addedSkeleton = skeletonPreparation.transaction.operations
    .filter((operation) => operation.kind === "addResource")
    .map((operation) => operation.resource)
    .find((resource) => resource.name === skeletonImportedResource.name);
const addedRequiredResource = skeletonPreparation.transaction.operations
    .filter((operation) => operation.kind === "addResource")
    .map((operation) => operation.resource)
    .find((resource) => (
        resource.name !== skeletonImportedResource.name
        && hashBytes(resource.sourceBytes) === hashBytes(skeletonRequiredResource.sourceBytes)
    ));
assert(addedSkeleton && addedRequiredResource, "Skeleton import operations are incomplete.");
assert.notEqual(addedRequiredResource.id, skeletonRequiredResource.id, "Incoming dependency id collision was not remapped.");
assert.deepEqual(addedSkeleton.metadata.requireIds, [addedRequiredResource.id], "Skeleton requireIds did not use the prebuilt target id map.");
assert.deepEqual(
    addedSkeleton.metadata.atlasNames,
    [String(addedRequiredResource.fileName || addedRequiredResource.file).replace(/\.[^.]+$/, "")],
    "Skeleton atlasNames did not follow the imported dependency rename.",
);
uam.applyUamTransaction(skeletonTargetFixture.project, skeletonPreparation.transaction.operations);

const branchTargetProject = structuredClone(baseline);
branchTargetProject.branches = [...new Set([...(branchTargetProject.branches || []), "dark"])].sort();
const branchTargetPackage = branchTargetProject.packages.find((pkg) => pkg.id === basics.id);
branchTargetPackage.branchNames = [...new Set([...(branchTargetPackage.branchNames || []), "dark"])];
const branchPreparation = transfer.prepareImportFairyPackageResources(branchTargetProject, importedPackage, {
    targetPackageId: basics.id,
    targetPath: "/",
    targetBranch: "dark",
    conflictStrategy: "rename",
});
assert.equal(branchPreparation.ok, true, JSON.stringify(branchPreparation));
assert(branchPreparation.transaction.operations
    .filter((operation) => operation.kind === "addResource" || operation.kind === "addComponent")
    .every((operation) => (operation.resource || operation.component).branch === "dark"));

const incompatibleAtlasPackage = structuredClone(importedPackage);
const namedAtlasFolder = incompatibleAtlasPackage.folders.find((folder) => !folder.branch)
    || { path: "/atlas-fixture/", branch: "", favorite: false, atlas: "" };
if (!incompatibleAtlasPackage.folders.includes(namedAtlasFolder)) incompatibleAtlasPackage.folders.push(namedAtlasFolder);
namedAtlasFolder.atlas = "incoming-named-atlas";
incompatibleAtlasPackage.publish = { ...(incompatibleAtlasPackage.publish || {}), name: "incompatible-import-publish" };
const atlasPreparation = transfer.prepareImportFairyPackageResources(baseline, incompatibleAtlasPackage, {
    targetPackageId: basics.id,
    targetPath: "/",
    targetBranch: "",
    conflictStrategy: "rename",
});
assert.equal(atlasPreparation.ok, true, JSON.stringify(atlasPreparation));

const portableDemoText = basics.resources.find((resource) => resource.kind === "component" && resource.name === "Demo_Text");
const portableImageFont = basics.resources.find((resource) => resource.kind === "font" && resource.name === "HitNumber");
assert(portableDemoText && portableImageFont, "RichText and image-based font import fixtures are required.");
const portableExport = await transfer.exportFairyPackageResources(transferBackend, baseline, [
    { packageId: basics.id, resourceId: portableDemoText.id },
    { packageId: basics.id, resourceId: portableImageFont.id },
]);
const portableImported = await transfer.readFairyPackageFiles(
    transferBackend,
    Object.entries(unzipSync(new Uint8Array(await portableExport.blob.arrayBuffer())))
        .filter(([name]) => !name.endsWith("/"))
        .map(([filePath, data]) => ({ path: filePath, data })),
);
const importedImageFont = portableImported.resources.find((resource) => resource.name === portableImageFont.name);
const importedFntText = new TextDecoder().decode(importedImageFont?.sourceBytes);
const importedGlyphId = /\simg=([A-Za-z0-9_-]+)/.exec(importedFntText)?.[1];
const importedGlyph = portableImported.resources.find((resource) => resource.id === importedGlyphId);
assert(importedImageFont && importedGlyphId && importedGlyph, "Portable image-based font archive is missing its first glyph.");
const portableTargetProject = structuredClone(baseline);
const portableTargetBag = portableTargetProject.packages.find((pkg) => pkg.id === bag.id);
portableTargetBag.folders.push({ path: "/portable-import/", branch: "", favorite: false, atlas: "" });
const targetCollisionDonor = portableTargetBag.resources.find((resource) => resource.kind === "image" && resource.sourceBytes instanceof Uint8Array);
assert(targetCollisionDonor && !portableTargetBag.resources.some((resource) => resource.id === importedGlyphId));
const targetCollision = structuredClone(targetCollisionDonor);
targetCollision.id = importedGlyphId;
targetCollision.name = "portable_font_collision_fixture";
targetCollision.path = "/";
targetCollision.fileName = "portable_font_collision_fixture.png";
delete targetCollision.sourcePath;
portableTargetBag.resources.push(targetCollision);
const portablePreparation = transfer.prepareImportFairyPackageResources(portableTargetProject, portableImported, {
    targetPackageId: bag.id,
    targetPath: "/portable-import/",
    targetBranch: "",
    conflictStrategy: "rename",
});
assert.equal(portablePreparation.ok, true, JSON.stringify(portablePreparation));
const importedFontOperation = portablePreparation.transaction.operations.find((operation) => (
    operation.kind === "addResource" && operation.resource.name === importedImageFont.name
));
const importedGlyphOperation = portablePreparation.transaction.operations.find((operation) => (
    operation.kind === "addResource" && operation.resource.name === importedGlyph.name
));
assert(importedFontOperation && importedGlyphOperation, "Portable font import operations are incomplete.");
assert.notEqual(importedGlyphOperation.resource.id, importedGlyphId, "Target glyph id collision was not remapped.");
assert(
    new TextDecoder().decode(importedFontOperation.resource.sourceBytes).includes(`img=${importedGlyphOperation.resource.id}`),
    "Imported FNT sourceBytes did not use the target glyph id.",
);
const portableProjected = uam.applyUamTransaction(portableTargetProject, portablePreparation.transaction.operations);
const projectedDemoText = portableProjected.packages.find((pkg) => pkg.id === bag.id).resources
    .find((resource) => resource.name === portableDemoText.name);
const projectedRichText = projectedDemoText?.component?.displayList.find((node) => node.kind === "richText" && node.text?.includes("[img]ui://"));
assert(projectedRichText?.text.includes(`[img]ui://${bag.id}`), "Imported RichText image URI was not rewritten to the target package.");
assert(!projectedRichText.text.includes(`ui://${portableImported.id}`), "Imported RichText retained the archive package id.");

assert.equal(hashValue(baseline), baselineHash, "Archive export/import verification must not mutate the source project.");
assert.equal(hashValue(importedPackage), importedHash, "Conflict strategy verification must not mutate the parsed archive.");

console.log(JSON.stringify({
    ok: true,
    version: expectedVersion,
    archiveFiles: archiveFiles.length,
    importedResources: importedPackage.resources.length,
    strategies,
    kindMismatchRejected: true,
    skeletonRequireIdsRemapped: true,
    targetBranchSupported: true,
    namedAtlasFolderSupported: true,
    skeletonAtlasNamesSupported: true,
    richTextImportRemapped: true,
    imageBasedFontImportRemapped: true,
    actualCountsReported: true,
    applySaveReloadInverse: true,
    sourceUnchanged: true,
}));

function createConflictFixture(sourceProject, targetPackageId, incomingName, incomingPackage) {
    const project = structuredClone(sourceProject);
    const target = project.packages.find((pkg) => pkg.id === targetPackageId);
    const donor = target.resources.find((resource) => resource.kind === "component" && resource.component);
    assert(donor, "A target component donor is required.");
    const existing = structuredClone(donor);
    existing.id = "imptgt01";
    existing.name = incomingName;
    existing.path = "/air-import/";
    existing.branch = "";
    existing.component.properties = {
        ...(existing.component.properties || {}),
        remark: "existing-target-component",
    };
    delete existing.sourcePath;
    target.folders.push(
        { path: "/air-import/", branch: "", favorite: false, atlas: "" },
        { path: "/air-import/images/", branch: "", favorite: false, atlas: "" },
    );
    const existingIndex = Math.min(5, target.resources.length);
    target.resources.splice(existingIndex, 0, existing);
    const incomingBinary = incomingPackage.resources.find((resource) => resource.kind !== "component");
    const binaryDonor = target.resources.find((resource) => resource.kind === incomingBinary.kind && resource.sourceBytes instanceof Uint8Array);
    assert(incomingBinary && binaryDonor, "A binary conflict donor is required.");
    const binaryExisting = structuredClone(binaryDonor);
    binaryExisting.id = "imptgt02";
    binaryExisting.name = incomingBinary.name;
    binaryExisting.path = incomingBinary.path === "/" ? "/air-import/" : `/air-import/${incomingBinary.path.slice(1)}`;
    if (typeof incomingBinary.fileName === "string") binaryExisting.fileName = incomingBinary.fileName;
    else binaryExisting.file = incomingBinary.file;
    binaryExisting.sourceBytes[0] ^= 0xff;
    delete binaryExisting.sourcePath;
    const binaryExistingIndex = Math.min(existingIndex + 2, target.resources.length);
    target.resources.splice(binaryExistingIndex, 0, binaryExisting);
    const incomingFileName = incomingBinary.fileName || incomingBinary.file;
    const extensionIndex = incomingFileName.lastIndexOf(".");
    const binaryRenamedFileName = extensionIndex > 0
        ? `${incomingFileName.slice(0, extensionIndex)}_copy${incomingFileName.slice(extensionIndex)}`
        : `${incomingFileName}_copy`;
    return {
        project,
        existingId: existing.id,
        existingIndex,
        binaryExistingId: binaryExisting.id,
        binaryExistingIndex,
        binaryExistingHash: hashBytes(binaryExisting.sourceBytes),
        binaryIncomingHash: hashBytes(incomingBinary.sourceBytes),
        binaryRenamedFileName,
    };
}

async function verifyRuntimeLifecycle(project, operations, inverseOperations, strategy) {
    const storage = new MemoryBrowserStorage();
    storage.importDirectory(projectDir);
    const fileSystem = backend.createBackendStorageFileSystem(storage);
    const runtime = new backend.BackendRuntime();
    const opened = runtime.openProjectSession({ project, storage: { fileSystem, fairyPath } });
    assert.equal(opened.ok, true, `${strategy} open failed: ${JSON.stringify(opened)}`);
    const applied = await runtime.applyTransaction({
        sessionId: opened.data.sessionId,
        expectedRevision: opened.data.revision,
        operations,
    });
    assert.equal(applied.ok, true, `${strategy} apply failed: ${JSON.stringify(applied)}`);
    const projected = uam.applyUamTransaction(project, operations);
    const saveTarget = saveTargetVerifier.createTransactionSaveTarget(projected, operations);
    assert(saveTarget, `${strategy} save target is missing.`);
    await assertSaved(runtime, opened.data.sessionId, applied.data.revision, strategy);
    const reader = new projectIo.ProjectReader(fileSystem);
    let reloaded = core.liftDocumentToUamProject(await reader.read(fairyPath, {
        includeBinaryData: true,
        hydrateResourceBytes: true,
    }));
    const verified = saveTargetVerifier.verifySaveTarget(reloaded, saveTarget);
    assert.equal(verified.ok, true, `${strategy} reload verification failed: ${JSON.stringify(verified)}`);

    const inverted = await runtime.applyTransaction({
        sessionId: opened.data.sessionId,
        expectedRevision: applied.data.revision,
        operations: inverseOperations,
    });
    assert.equal(inverted.ok, true, `${strategy} inverse failed: ${JSON.stringify(inverted)}`);
    const restored = uam.applyUamTransaction(projected, inverseOperations);
    const inverseTarget = saveTargetVerifier.createTransactionSaveTarget(restored, inverseOperations);
    assert(inverseTarget, `${strategy} inverse save target is missing.`);
    await assertSaved(runtime, opened.data.sessionId, inverted.data.revision, `${strategy} inverse`);
    reloaded = core.liftDocumentToUamProject(await reader.read(fairyPath, {
        includeBinaryData: true,
        hydrateResourceBytes: true,
    }));
    const inverseVerified = saveTargetVerifier.verifySaveTarget(reloaded, inverseTarget);
    assert.equal(inverseVerified.ok, true, `${strategy} inverse reload verification failed: ${JSON.stringify(inverseVerified)}`);
}

async function assertSaved(runtime, sessionId, revision, label) {
    const saved = await runtime.saveSession({ sessionId, expectedRevision: revision });
    assert.equal(saved.ok, true, `${label} save failed: ${JSON.stringify(saved)}`);
}

function assertFoldersParentFirst(operations) {
    const folderPaths = operations
        .filter((operation) => operation.kind === "addResourceFolder")
        .map((operation) => operation.path);
    assert.deepEqual(folderPaths, [...folderPaths].sort((left, right) => depth(left) - depth(right) || left.localeCompare(right)));
}

function assertAddedBinaryBytes(incoming, operations) {
    const incomingHashes = new Set(incoming.resources
        .filter((resource) => resource.kind !== "component")
        .map((resource) => hashBytes(resource.sourceBytes)));
    const added = operations.filter((operation) => operation.kind === "addResource");
    assert(added.length > 0, "No binary addResource operations were generated.");
    for (const operation of added) {
        assert(incomingHashes.has(hashBytes(operation.resource.sourceBytes)), `Imported binary ${operation.resource.id} bytes changed.`);
    }
}

function assertNoImportedPackageReferences(value, incomingPackageId) {
    const encoded = JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? undefined : item);
    assert(!encoded.includes(`ui://${incomingPackageId}`), "Imported typed URI still targets the archive package id.");
    assert(!encoded.includes(`\"packageId\":\"${incomingPackageId}\"`), "Imported direct reference still targets the archive package id.");
}

function assertFixtureRestored(expectedProject, actualProject, targetPackageId, label) {
    const expected = expectedProject.packages.find((pkg) => pkg.id === targetPackageId);
    const actual = actualProject.packages.find((pkg) => pkg.id === targetPackageId);
    assert(expected && actual, `${label} inverse target package is missing.`);
    const resourceShape = (pkg) => pkg.resources.map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        name: resource.name,
        path: resource.path,
        branch: resource.branch || "",
        fileName: resource.fileName || resource.file || "",
    }));
    assert.deepEqual(resourceShape(actual), resourceShape(expected), `${label} inverse resource order/identity changed.`);
    assert.deepEqual(
        actual.folders.map((folder) => ({ path: folder.path, branch: folder.branch || "", favorite: !!folder.favorite, atlas: folder.atlas || "" })),
        expected.folders.map((folder) => ({ path: folder.path, branch: folder.branch || "", favorite: !!folder.favorite, atlas: folder.atlas || "" })),
        `${label} inverse folder state changed.`,
    );
    assert.deepEqual(binaryHashes(actual), binaryHashes(expected), `${label} inverse binary bytes changed.`);
    assert.equal(
        actual.resources.find((resource) => resource.id === "imptgt01")?.component?.properties?.remark,
        "existing-target-component",
        `${label} inverse did not restore the replaced component snapshot.`,
    );
}

function depth(resourcePath) {
    return resourcePath.split("/").filter(Boolean).length;
}

function hashBytes(value) {
    assert(value instanceof Uint8Array, "Expected hydrated Uint8Array bytes.");
    return createHash("sha256").update(value).digest("hex");
}

function binaryHashes(pkg) {
    return Object.fromEntries(pkg.resources
        .filter((resource) => resource.kind !== "component")
        .map((resource) => [resource.id, hashBytes(resource.sourceBytes)]));
}

function hashValue(value) {
    return createHash("sha256").update(JSON.stringify(value, (_key, item) => (
        item instanceof Uint8Array ? { bytes: Buffer.from(item).toString("base64") } : item
    ))).digest("hex");
}
