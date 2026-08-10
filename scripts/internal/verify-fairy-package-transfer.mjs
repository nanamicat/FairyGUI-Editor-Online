import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
const versions = Object.fromEntries(["core", "functions", "backend", "cli"].map((name) => [
    name,
    JSON.parse(readFileSync(path.join(moduleRoot, name, "package.json"), "utf8")).version,
]));
for (const [name, version] of Object.entries(versions)) {
    assert.equal(version, "0.2.4", `${name} must use OpenFairyGUI 0.2.4`);
}
const editorShellSource = [
    readFileSync("src/editor/EditorShell.ts", "utf8"),
    readFileSync("src/editor/modules/ProjectTransferModules.ts", "utf8"),
    readFileSync("src/editor/ui/ResourceAuthoringController.ts", "utf8"),
].join("\n");
for (const sourceContract of [
    "desktopMenuImportFairyPackage",
    "desktopMenuExportFairyPackage",
    "readFairyPackageFiles(",
    "exportFairyPackage(",
    "prepareImportPackage(",
]) {
    assert(editorShellSource.includes(sourceContract), `Editor product must wire ${sourceContract}`);
}

const [core, uam, projectIo, backend, transfer, transactions, saveTargetVerifier] = await Promise.all([
    importFile(path.join(moduleRoot, "core/dist/index.js")),
    importFile(path.join(moduleRoot, "core/dist/uam/index.js")),
    importFile(path.join(moduleRoot, "core/dist/project-io.js")),
    importFile(path.join(moduleRoot, "backend/dist/index.mjs")),
    importTypeScriptModule("src/editor/services/FairyPackageTransfer.ts"),
    importTypeScriptModule("src/editor/commands/PackageComponentTransactions.ts"),
    importTypeScriptModule("src/editor/services/BrowserSaveTargetVerifier.ts"),
]);
const transferBackend = {
    BackendRuntime: backend.BackendRuntime,
    createBackendStorageFileSystem: backend.createBackendStorageFileSystem,
    ProjectReader: projectIo.ProjectReader,
    liftDocumentToUamProject: core.liftDocumentToUamProject,
};

const storage = new MemoryBrowserStorage();
storage.importDirectory(projectDir);
const fileSystem = backend.createBackendStorageFileSystem(storage);
const reader = new projectIo.ProjectReader(fileSystem);
const readProject = async () => core.liftDocumentToUamProject(await reader.read(fairyPath, {
    includeBinaryData: true,
    hydrateResourceBytes: true,
}));
const baseline = await readProject();
const baselineHash = hashValue(baseline);
const bag = baseline.packages.find((pkg) => pkg.name === "Bag");
assert(bag, "The real Bag package fixture is required.");

const exported = await transfer.exportFairyPackage(transferBackend, baseline, bag.id);
assert.equal(exported.fileName, "Bag.fairypackage");
if (process.env.FAIRY_PACKAGE_FIXTURE) {
    writeFileSync(process.env.FAIRY_PACKAGE_FIXTURE, new Uint8Array(await exported.blob.arrayBuffer()));
}
assert(exported.files.some((file) => file.path === "package.xml"));
const unzipped = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
const archiveFiles = Object.entries(unzipped)
    .filter(([name]) => !name.endsWith("/"))
    .map(([filePath, data]) => ({ path: filePath, data }));
assert.equal(archiveFiles.length, exported.files.length);
const parsedPackage = await transfer.readFairyPackageFiles(transferBackend, archiveFiles);
assert.equal(parsedPackage.id, bag.id);
assert.equal(parsedPackage.resources.length, bag.resources.length);
assert.deepEqual(resourceByteHashes(parsedPackage), resourceByteHashes(bag));
assert.equal(hashValue(baseline), baselineHash, "Export and read must not mutate the source project.");

await expectTransferError(
    () => transfer.readFairyPackageFiles(transferBackend, [{ path: "readme.txt", data: new Uint8Array([1]) }]),
    "fairy_package_invalid_archive",
);
await expectTransferError(
    () => transfer.readFairyPackageFiles(transferBackend, [{ path: "../package.xml", data: new Uint8Array([1]) }]),
    "fairy_package_invalid_archive",
);

const otherPackage = baseline.packages.find((pkg) => pkg.id !== bag.id);
assert(otherPackage, "An external package fixture is required.");
const externalDependency = otherPackage.resources.find((resource) => resource.kind === "component");
assert(externalDependency, "An external component fixture is required.");
const externalBag = structuredClone(bag);
injectExternalReference(externalBag, otherPackage.id, externalDependency.id);
const externalExport = await transfer.exportFairyPackage(
    transferBackend,
    { ...baseline, packages: [externalBag, otherPackage] },
    bag.id,
);
const externalParsed = await transfer.readFairyPackageFiles(transferBackend, await readArchiveFiles(externalExport.blob));
assert(externalParsed.resources.some((resource) => resource.name === externalDependency.name));
assert.deepEqual(transfer.findTypedPackageExternalDependencyIds(externalParsed, externalParsed.id), []);
const externalImported = structuredClone(parsedPackage);
injectExternalReference(externalImported, otherPackage.id, externalDependency.id);
const externalPreparation = transactions.prepareImportPackage(baseline, externalImported, "BagExternalImport");
assert.equal(externalPreparation.ok, false);
assert.equal(externalPreparation.code, "fairy_package_external_dependencies_unsupported");
assert.equal(hashValue(baseline), baselineHash, "Rejected transfers must not mutate the source project.");

const branchProject = structuredClone(baseline);
branchProject.branches = [...new Set([...(branchProject.branches || []), "dark"])].sort();
const branchBag = branchProject.packages.find((pkg) => pkg.id === bag.id);
const baseImage = branchBag.resources.find((resource) => resource.kind === "image");
assert(branchBag && baseImage, "Branch resource fixtures are required.");
branchBag.branchNames = ["dark"];
const darkImage = structuredClone(baseImage);
darkImage.id = "darkimg1";
darkImage.branch = "dark";
darkImage.branchItemIds = [];
baseImage.branchItemIds = [darkImage.id];
branchBag.resources.push(darkImage);
const branchExport = await transfer.exportFairyPackage(transferBackend, branchProject, branchBag.id);
assert(branchExport.files.some((file) => file.path === "package_dark.xml"));
assert(branchExport.files.some((file) => file.path.startsWith("assets_dark/")));
const parsedBranchPackage = await transfer.readFairyPackageFiles(transferBackend, await readArchiveFiles(branchExport.blob));
assert.deepEqual(parsedBranchPackage.branchNames, ["dark"]);
assert(parsedBranchPackage.resources.some((resource) => resource.id === darkImage.id && resource.branch === "dark"));
const branchImport = transactions.prepareImportPackage(
    { ...baseline, branches: (baseline.branches || []).filter((branch) => branch !== "dark") },
    parsedBranchPackage,
    "BagBranchImport",
);
assert.equal(branchImport.ok, true, JSON.stringify(branchImport));
assert(branchImport.transaction.operations?.some((operation) => operation.kind === "addBranch" && operation.branch === "dark"));

const grammarImported = structuredClone(parsedPackage);
const grammarComponent = grammarImported.resources.find((resource) => resource.kind === "component" && resource.component);
const grammarNode = grammarComponent?.component?.displayList?.[0];
const grammarImage = grammarImported.resources.find((resource) => resource.kind === "image");
assert(grammarComponent && grammarNode && grammarImage, "Whole-package reference grammar fixture is unavailable.");
const opaqueOwnerText = `literal ui://${grammarImported.id}opaque-resource remains documentation`;
const opaqueExternalText = `literal ui://${otherPackage.id}external-resource remains documentation`;
grammarComponent.component.properties = {
    ...(grammarComponent.component.properties || {}),
    remark: opaqueOwnerText,
    externalRemark: opaqueExternalText,
};
grammarNode.customData = opaqueOwnerText;
grammarNode.kind = "richText";
grammarNode.text = `[img]ui://${grammarImported.id}${grammarImage.id}[/img]`;
const grammarPreparation = transactions.prepareImportPackage(baseline, grammarImported, "BagGrammarImport");
assert.equal(grammarPreparation.ok, true, JSON.stringify(grammarPreparation));
const grammarPackage = grammarPreparation.transaction.operation.package;
const grammarImportedComponent = grammarPackage.resources.find((resource) => resource.id === grammarComponent.id);
const grammarImportedNode = grammarImportedComponent.component.displayList.find((node) => node.id === grammarNode.id);
assert.equal(grammarImportedComponent.component.properties.remark, opaqueOwnerText, "Whole-package import rewrote owner-like opaque text.");
assert.equal(grammarImportedComponent.component.properties.externalRemark, opaqueExternalText, "Whole-package import treated opaque external text as a dependency.");
assert.equal(grammarImportedNode.customData, opaqueOwnerText, "Whole-package import rewrote customData.");
assert(
    grammarImportedNode.text.includes(`ui://${grammarPackage.id}`),
    "Whole-package import did not rewrite a typed RichText image reference.",
);

const preparation = transactions.prepareImportPackage(baseline, parsedPackage, "BagImported");
assert.equal(preparation.ok, true, JSON.stringify(preparation));
const transaction = preparation.transaction;
assert.equal(transaction.operation.kind, "addPackage");
assert.equal(transaction.inverseOperation.kind, "removePackage");
assert.equal(transaction.operations, undefined, "Package import must remain one addPackage history group.");
assert.equal(transaction.inverseOperations, undefined, "Package import Undo must remain one removePackage history group.");
assert.notEqual(transaction.operation.package.id, parsedPackage.id);
assert.equal(transaction.operation.package.id.length, 8);
assert.equal(transaction.operation.package.name, "BagImported");
assert.equal(transaction.operation.package.publish.name, "BagImported");
assert.equal(hashValue(parsedPackage), hashValue(await transfer.readFairyPackageFiles(transferBackend, archiveFiles)));

const projected = uam.applyUamTransaction(baseline, [transaction.operation]);
const projectedImport = projected.packages.find((pkg) => pkg.id === transaction.operation.package.id);
assert(projectedImport, "The projected import package is missing.");
const packageSaveTarget = saveTargetVerifier.createTransactionSaveTarget(projected, [transaction.operation]);
assert(packageSaveTarget && saveTargetVerifier.verifySaveTarget(projected, packageSaveTarget).ok);
const corruptedProject = structuredClone(projected);
const corruptedPackage = corruptedProject.packages.find((pkg) => pkg.id === transaction.operation.package.id);
const corruptedResource = corruptedPackage.resources.find((resource) => resource.kind !== "component");
assert(corruptedResource?.sourceBytes instanceof Uint8Array);
corruptedResource.name = `${corruptedResource.name}_corrupt`;
corruptedResource.sourceBytes[0] ^= 0xff;
assert.equal(
    saveTargetVerifier.verifySaveTarget(corruptedProject, packageSaveTarget).ok,
    false,
    "Package save verification must reject metadata and byte corruption.",
);
const undone = uam.applyUamTransaction(projected, [transaction.inverseOperation]);
assertOriginalPackagesPreserved(baseline, undone);
assert(!undone.packages.some((pkg) => pkg.id === transaction.operation.package.id));
const redone = uam.applyUamTransaction(undone, [transaction.operation]);
const redoneImport = redone.packages.find((pkg) => pkg.id === transaction.operation.package.id);
assert(redoneImport, "Package import Redo must restore the imported package.");
assertPackageRoundTrip(projectedImport, redoneImport);

const runtime = new backend.BackendRuntime();
const opened = runtime.openProjectSession({
    project: baseline,
    storage: { fileSystem, fairyPath },
});
assert.equal(opened.ok, true, JSON.stringify(opened));
assert.equal(opened.data.revision, 0);
const applied = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: 0,
    operations: [transaction.operation],
});
assert.equal(applied.ok, true, JSON.stringify(applied));
await assertSaved(runtime, opened.data.sessionId, applied.data.revision);
let reloaded = await readProject();
let reloadedImport = reloaded.packages.find((pkg) => pkg.id === transaction.operation.package.id);
assert(reloadedImport, "The saved imported package is missing after ProjectReader reload.");
assertPackageRoundTrip(transaction.operation.package, reloadedImport);
const packageSaveVerification = saveTargetVerifier.verifySaveTarget(reloaded, packageSaveTarget);
assert.equal(packageSaveVerification.ok, true, JSON.stringify(
    findFirstDifference(packageSaveTarget.expected?.value, packageSaveVerification.reloaded?.value),
));

const removed = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: applied.data.revision,
    operations: [transaction.inverseOperation],
});
assert.equal(removed.ok, true, JSON.stringify(removed));
await assertSaved(runtime, opened.data.sessionId, removed.data.revision);
reloaded = await readProject();
assert(!reloaded.packages.some((pkg) => pkg.id === transaction.operation.package.id));

const reapplied = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: removed.data.revision,
    operations: [transaction.operation],
});
assert.equal(reapplied.ok, true, JSON.stringify(reapplied));
await assertSaved(runtime, opened.data.sessionId, reapplied.data.revision);
reloaded = await readProject();
reloadedImport = reloaded.packages.find((pkg) => pkg.id === transaction.operation.package.id);
assert(reloadedImport, "The redone imported package is missing after ProjectReader reload.");
assertPackageRoundTrip(transaction.operation.package, reloadedImport);

const cleaned = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: reapplied.data.revision,
    operations: [transaction.inverseOperation],
});
assert.equal(cleaned.ok, true, JSON.stringify(cleaned));
await assertSaved(runtime, opened.data.sessionId, cleaned.data.revision);
const finalProject = await readProject();
assert.equal(finalProject.packages.length, baseline.packages.length);
assert(!finalProject.packages.some((pkg) => pkg.id === transaction.operation.package.id));
assert.deepEqual(
    resourceByteHashes(finalProject.packages.find((pkg) => pkg.id === bag.id)),
    resourceByteHashes(bag),
    "Package import cleanup must preserve source resource bytes.",
);
assert.equal(hashValue(baseline), baselineHash, "The in-memory source UAM must remain unchanged.");

console.log(JSON.stringify({
    ok: true,
    version: versions.core,
    archiveFiles: archiveFiles.length,
    resources: parsedPackage.resources.length,
    binaryHashes: Object.keys(resourceByteHashes(parsedPackage)).length,
    packageIdChanged: transaction.operation.package.id !== parsedPackage.id,
    undoRedo: true,
    saveReload: true,
    externalDependencyClosed: true,
    branchRoundTrip: true,
    invalidArchiveRejected: true,
    opaqueTextPreserved: true,
    typedRichTextRemapped: true,
    sourceUnchanged: true,
}));

async function assertSaved(runtime, sessionId, revision) {
    const saved = await runtime.saveSession({ sessionId, expectedRevision: revision });
    assert.equal(saved.ok, true, JSON.stringify(saved));
}

async function expectTransferError(run, code) {
    await assert.rejects(run, (error) => error?.code === code);
}

function injectExternalReference(pkg, packageId, resourceId) {
    const node = pkg.resources
        .filter((resource) => resource.kind === "component")
        .flatMap((resource) => resource.component?.displayList || [])
        .find((candidate) => candidate.resource?.resourceId);
    assert(node, "A component resource reference fixture is required.");
    node.resource.packageId = packageId;
    node.resource.resourceId = resourceId;
}

async function readArchiveFiles(blob) {
    return Object.entries(unzipSync(new Uint8Array(await blob.arrayBuffer())))
        .filter(([name]) => !name.endsWith("/"))
        .map(([path, data]) => ({ path, data }));
}

function resourceByteHashes(pkg) {
    return Object.fromEntries(pkg.resources
        .filter((resource) => resource.kind !== "component")
        .map((resource) => {
            assert(resource.sourceBytes instanceof Uint8Array, `Resource ${resource.id} is not hydrated.`);
            return [resource.id, createHash("sha256").update(resource.sourceBytes).digest("hex")];
        })
        .sort(([left], [right]) => left.localeCompare(right)));
}

function assertPackageRoundTrip(expected, actual) {
    assert.equal(actual.id, expected.id);
    assert.equal(actual.name, expected.name);
    assert.deepEqual(resourceByteHashes(actual), resourceByteHashes(expected));
    assert.deepEqual(stripSourceFields(actual), stripSourceFields(expected));
}

function assertOriginalPackagesPreserved(expectedProject, actualProject) {
    assert.equal(actualProject.packages.length, expectedProject.packages.length);
    for (const expectedPackage of expectedProject.packages) {
        const actualPackage = actualProject.packages.find((pkg) => pkg.id === expectedPackage.id);
        assert(actualPackage, `Undo removed original package ${expectedPackage.id}.`);
        assert.equal(actualPackage.name, expectedPackage.name);
        assert.deepEqual(
            actualPackage.resources.map(({ id, kind, name }) => ({ id, kind, name })),
            expectedPackage.resources.map(({ id, kind, name }) => ({ id, kind, name })),
        );
        assert.deepEqual(resourceByteHashes(actualPackage), resourceByteHashes(expectedPackage));
    }
}

function stripSourceFields(value) {
    if (ArrayBuffer.isView(value)) return undefined;
    if (Array.isArray(value)) return value.map(stripSourceFields);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !["sourceBytes", "binaryData", "sourcePath"].includes(key))
        .map(([key, item]) => [key, stripSourceFields(item)]));
}

function hashValue(value) {
    return createHash("sha256").update(JSON.stringify(value, (_key, item) => (
        item instanceof Uint8Array ? { bytes: Buffer.from(item).toString("base64") } : item
    ))).digest("hex");
}

function findFirstDifference(expected, actual, path = "package") {
    if (Object.is(expected, actual)) return null;
    if (!expected || !actual || typeof expected !== "object" || typeof actual !== "object") {
        return { path, expected, actual };
    }
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
        const difference = findFirstDifference(expected[key], actual[key], `${path}.${key}`);
        if (difference) return difference;
    }
    return null;
}
