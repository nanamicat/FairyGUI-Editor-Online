import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveAuthoringProjectPath, resolveOpenFairyGuiModuleRoot } from "../project-boundary.mjs";

const moduleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const projectPath = resolveAuthoringProjectPath(process.argv[3]);
const projectDir = path.dirname(projectPath);
const fairyPath = path.basename(projectPath);
const reportPath = path.resolve(process.argv[4] || "verification/reports/resource-workspace-report.json");
const packageVersion = JSON.parse(readFileSync(path.join(moduleRoot, "core/package.json"), "utf8")).version;
const importFile = (filePath) => import(pathToFileURL(filePath).href);
const [core, uam, projectIo, backend, transactions, verifier, snapshots] = await Promise.all([
    importFile(path.join(moduleRoot, "core/dist/index.js")),
    importFile(path.join(moduleRoot, "core/dist/uam/index.js")),
    importFile(path.join(moduleRoot, "core/dist/project-io.js")),
    importFile(path.join(moduleRoot, "backend/dist/index.mjs")),
    importTypeScriptModule("src/editor/commands/ResourceTransactions.ts"),
    importTypeScriptModule("src/editor/services/BrowserSaveTargetVerifier.ts"),
    importTypeScriptModule("src/editor/services/UamProjectSnapshotAdapter.ts"),
]);

const storage = new MemoryBrowserStorage();
storage.importDirectory(projectDir);
const fileSystem = backend.createBackendStorageFileSystem(storage);
const readProject = async () => {
    const document = await new projectIo.ProjectReader(fileSystem).read(fairyPath, {
        includeBinaryData: true,
        hydrateResourceBytes: true,
    });
    return core.liftDocumentToUamProject(document);
};
const baseline = await readProject();
const pkg = baseline.packages.find((candidate) => candidate.resources.length > 0);
const resource = pkg?.resources[0];
assert(pkg && resource, "The authoring project must contain a resource.");
const selector = { packageId: pkg.id, resourceId: resource.id };
const favoriteFolder = pkg.folders.find((folder) => pkg.resources.some((candidate) => (
    (candidate.branch || "") === (folder.branch || "")
    && String(candidate.path || "/").startsWith(folder.path)
)));
assert(favoriteFolder, "The authoring project must contain a non-empty resource folder.");
const favoriteFolderSelector = {
    packageId: pkg.id,
    branch: favoriteFolder.branch || "",
    path: favoriteFolder.path,
};
const favoriteFolderTarget = favoriteFolder.favorite !== true;
const originalFolderAtlas = favoriteFolder.atlas || "";
const targetFolderAtlas = originalFolderAtlas === "" ? "0" : "";
const originalFolderFavorites = new Map(pkg.folders.map((folder) => [
    `${folder.branch || ""}:${folder.path}`,
    folder.favorite === true,
]));
const originalResourceFavorites = new Map(pkg.resources.map((candidate) => [candidate.id, candidate.favorite === true]));

let projected = structuredClone(baseline);
const prepared = [];
const append = (preparation) => {
    assert.equal(preparation.ok, true, JSON.stringify(preparation));
    prepared.push(preparation.transaction);
    projected = uam.applyUamTransaction(
        projected,
        preparation.transaction.operations || [preparation.transaction.operation],
    );
};
append(transactions.prepareSetResourceFavorite(projected, selector, resource.favorite !== true));
append(transactions.prepareSetResourceFolderFavorite(projected, favoriteFolderSelector, favoriteFolderTarget));
append(transactions.prepareSetResourceFolderAtlas(projected, favoriteFolderSelector, targetFolderAtlas));
append(transactions.prepareSetResourceExported(projected, selector, resource.exported === false));
append(transactions.prepareAddResourceFolder(projected, pkg.id, "/CodexAlpha30/"));
append(transactions.prepareAddResourceFolder(projected, pkg.id, "/CodexAlpha30/Child/"));
append(transactions.prepareRenameResourceFolder(projected, {
    packageId: pkg.id,
    branch: "",
    path: "/CodexAlpha30/Child/",
}, "Renamed"));
append(transactions.prepareMoveResourceFolder(projected, {
    packageId: pkg.id,
    branch: "",
    path: "/CodexAlpha30/Renamed/",
}, "/"));

const operations = prepared.flatMap((transaction) => transaction.operations || [transaction.operation]);
const inverseOperations = prepared.slice().reverse().flatMap(
    (transaction) => transaction.inverseOperations || [transaction.inverseOperation],
);
const projectedPackage = projected.packages.find((candidate) => candidate.id === pkg.id);
const projectedResource = projectedPackage?.resources.find((candidate) => candidate.id === resource.id);
const runtime = new backend.BackendRuntime();
const opened = runtime.openProjectSession({
    project: structuredClone(baseline),
    storage: {
        fileSystem,
        fairyPath,
        canonicalProjectPath: "opfs://resource-workspace",
        canonicalPathKey: "opfs://resource-workspace",
    },
});
assert.equal(opened.ok, true, JSON.stringify(opened));
const applied = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: opened.data.revision,
    operations,
});
assert.equal(applied.ok, true, JSON.stringify(applied));
const saved = await runtime.saveSession({
    sessionId: opened.data.sessionId,
    expectedRevision: applied.data.revision,
});
assert.equal(saved.ok, true, JSON.stringify(saved));

const reloaded = await readProject();
const reloadedPackage = reloaded.packages.find((candidate) => candidate.id === pkg.id);
const reloadedResource = reloadedPackage?.resources.find((candidate) => candidate.id === resource.id);
assert.equal(reloadedResource?.favorite, projectedResource?.favorite);
assert.equal(reloadedResource?.exported, projectedResource?.exported);
const reloadedFavoriteFolder = reloadedPackage?.folders.find((folder) => (
    (folder.branch || "") === favoriteFolderSelector.branch && folder.path === favoriteFolderSelector.path
));
assert.equal(reloadedFavoriteFolder?.favorite, favoriteFolderTarget);
assert.equal(reloadedFavoriteFolder?.atlas || "", targetFolderAtlas);
for (const folder of reloadedPackage?.folders || []) {
    if ((folder.branch || "") === favoriteFolderSelector.branch && folder.path.startsWith(favoriteFolderSelector.path)) {
        assert.equal(folder.favorite, favoriteFolderTarget);
    }
}
for (const candidate of reloadedPackage?.resources || []) {
    if ((candidate.branch || "") === favoriteFolderSelector.branch && String(candidate.path || "/").startsWith(favoriteFolderSelector.path)) {
        assert.equal(candidate.favorite, favoriteFolderTarget);
    }
}
assert(reloadedPackage?.folders.some((folder) => folder.path === "/CodexAlpha30/"));
assert(reloadedPackage?.folders.some((folder) => folder.path === "/Renamed/"));
const saveTarget = verifier.createTransactionSaveTarget(projected, operations);
assert(saveTarget && verifier.verifySaveTarget(reloaded, saveTarget).ok, "Resource workspace save target mismatch.");
const snapshot = snapshots.createProjectSnapshotFromUamProject(reloaded, {
    projectPath: fairyPath,
    openfairyguiVersion: packageVersion,
    reader: "BrowserWorkspace",
});
const snapshotPackage = snapshot.packages.find((candidate) => candidate.id === pkg.id);
assert(snapshotPackage?.folders.some((folder) => folder.path === "/Renamed/"));
assert.equal(
    snapshotPackage?.folders.find((folder) => (
        folder.branch === favoriteFolderSelector.branch && folder.path === favoriteFolderSelector.path
    ))?.favorite,
    favoriteFolderTarget,
);
assert.equal(
    snapshotPackage?.folders.find((folder) => (
        folder.branch === favoriteFolderSelector.branch && folder.path === favoriteFolderSelector.path
    ))?.atlas || "",
    targetFolderAtlas,
);
assert.equal(
    snapshotPackage?.resources.find((candidate) => candidate.id === resource.id)?.favorite,
    projectedResource?.favorite,
);

const restored = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: saved.data.revision,
    operations: inverseOperations,
});
assert.equal(restored.ok, true, JSON.stringify(restored));
const restoreSaved = await runtime.saveSession({
    sessionId: opened.data.sessionId,
    expectedRevision: restored.data.revision,
});
assert.equal(restoreSaved.ok, true, JSON.stringify(restoreSaved));
const restoreReloaded = await readProject();
const restoredPackage = restoreReloaded.packages.find((candidate) => candidate.id === pkg.id);
const restoredResource = restoredPackage?.resources.find((candidate) => candidate.id === resource.id);
assert.equal(restoredResource?.favorite, resource.favorite === true);
assert.equal(restoredResource?.exported, resource.exported !== false);
for (const folder of restoredPackage?.folders || []) {
    assert.equal(folder.favorite === true, originalFolderFavorites.get(`${folder.branch || ""}:${folder.path}`));
}
assert.equal(
    restoredPackage?.folders.find((folder) => (
        (folder.branch || "") === favoriteFolderSelector.branch && folder.path === favoriteFolderSelector.path
    ))?.atlas || "",
    originalFolderAtlas,
);
for (const candidate of restoredPackage?.resources || []) {
    assert.equal(candidate.favorite === true, originalResourceFavorites.get(candidate.id));
}
assert(!restoredPackage?.folders.some((folder) => folder.path === "/CodexAlpha30/" || folder.path === "/Renamed/"));

const nonEmptyFolder = restoredPackage?.folders.find((folder) => (
    restoredPackage.resources.some((candidate) => (
        (candidate.branch || "") === folder.branch && candidate.path.startsWith(folder.path)
    ))
    || restoredPackage.folders.some((candidate) => (
        candidate !== folder && candidate.branch === folder.branch && candidate.path.startsWith(folder.path)
    ))
));
let nonEmptyGuard = "not_applicable";
if (nonEmptyFolder) {
    const remove = transactions.prepareRemoveResourceFolder(restoreReloaded, {
        packageId: restoredPackage.id,
        branch: nonEmptyFolder.branch,
        path: nonEmptyFolder.path,
    });
    assert.equal(remove.ok, true, JSON.stringify(remove));
    const rejected = await runtime.applyTransaction({
        sessionId: opened.data.sessionId,
        expectedRevision: restoreSaved.data.revision,
        operations: [remove.transaction.operation],
    });
    assert.equal(rejected.ok, false, "Non-empty folder removal must be rejected.");
    assert.equal(rejected.error.code, "transaction_unsupported", JSON.stringify(rejected));
    assert(rejected.error.issues.some((issue) => issue.code === "resource_folder_not_empty"));
    nonEmptyGuard = "resource_folder_not_empty";
}

assert.equal(transactions.prepareAddResourceFolder(baseline, pkg.id, "/../bad/").ok, false);
const editorUiSource = [
    readFileSync("src/editor/EditorShell.ts", "utf8"),
    readFileSync("src/editor/dialogs/EditorDialogs.ts", "utf8"),
    readFileSync("src/editor/ui/LibraryController.ts", "utf8"),
    readFileSync("src/editor/ui/ResourceAuthoringController.ts", "utf8"),
].join("\n");
for (const snippet of [
    'this.createPanel("FavoritesView", "desktopFavoritesView")',
    'fgui.UIPackage.createObject("Builder", "InputDialog")',
    'prepareSetResourceFavorite(',
    'prepareSetResourceFolderFavorite(',
    'prepareSetResourceFolderAtlas(',
    '"FolderPropertyDialog"',
    'prepareSetResourceExported(',
    'prepareAddResourceFolder(',
    'Move ${selectedResources.length} Selected...',
    'for (const [index, resource] of visibleResources.entries())',
    'const node = this.createTreeNode(true, folder.path);',
    'appendFolderContents(node, folder);',
    'const liveSnapshot = this.liveSessionBridge.getProjectSnapshot();',
    'this.applyProjectSnapshot(liveSnapshot, state.revision);',
]) assert(editorUiSource.includes(snippet), `Missing resource workspace UI wiring: ${snippet}`);
assert(!editorUiSource.includes("for (const [index, component] of selectedPackage.components.entries())"));
assert(!editorUiSource.includes("window.prompt("), "Resource workspace must use the in-editor input dialog.");

const report = {
    generatedAt: new Date().toISOString(),
    source: { packageVersion, projectPath: projectPath.replaceAll("\\", "/") },
    results: {
        ok: true,
        operationKinds: operations.map((operation) => operation.kind),
        saveReload: true,
        inverseSaveReload: true,
        favoritesSnapshot: true,
        folderFavoriteAtomic: true,
        folderAtlasSaveReload: true,
        saveTargetVerified: true,
        nonEmptyGuard,
    },
};
mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
