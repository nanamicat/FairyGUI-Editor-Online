import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveAuthoringProjectPath, resolveOpenFairyGuiModuleRoot } from "../project-boundary.mjs";

const moduleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const projectPath = resolveAuthoringProjectPath(process.argv[3]);
const version = JSON.parse(readFileSync(path.join(moduleRoot, "core/package.json"), "utf8")).version;
assert.equal(version, "0.2.2");
const [core, projectIo, backend, web, transactions, languageFiles] = await Promise.all([
    import(pathToFileURL(path.join(moduleRoot, "core/dist/index.js")).href),
    import(pathToFileURL(path.join(moduleRoot, "core/dist/project-io.js")).href),
    import(pathToFileURL(path.join(moduleRoot, "backend/dist/index.mjs")).href),
    import(pathToFileURL(path.join(moduleRoot, "functions/dist/web.js")).href),
    importTypeScriptModule("src/editor/commands/ProjectSettingsTransactions.ts"),
    importTypeScriptModule("src/editor/services/BrowserLanguageFiles.ts"),
]);
const storage = new MemoryBrowserStorage();
storage.importDirectory(path.dirname(projectPath));
const fileSystem = backend.createBackendStorageFileSystem(storage);
const fairyPath = path.basename(projectPath);
const reader = new projectIo.ProjectReader(fileSystem);
const readProject = async () => core.liftDocumentToUamProject(await reader.read(fairyPath, {
    includeBinaryData: true,
    hydrateResourceBytes: true,
}));
let project = await readProject();
const baselineSettings = structuredClone(project.settings);
const baselineBranches = [...project.branches];
const targetPackage = project.packages.find((pkg) => pkg.publish);
assert(targetPackage);
const baselinePackageSettings = {
    compressPNG: targetPackage.compressPNG,
    jpegQuality: targetPackage.jpegQuality,
    publish: structuredClone(targetPackage.publish),
};
const runtime = new backend.BackendRuntime();
const opened = runtime.openProjectSession({
    project: structuredClone(project),
    storage: {
        fileSystem,
        fairyPath,
        canonicalProjectPath: "opfs://project-settings-verification",
        canonicalPathKey: "opfs://project-settings-verification",
    },
});
assert.equal(opened.ok, true, JSON.stringify(opened));
let revision = opened.data.revision;

const applyAndSave = async (preparation) => {
    assert.equal(preparation.ok, true, JSON.stringify(preparation));
    const operations = preparation.transaction.operations || [preparation.transaction.operation];
    const applied = await runtime.applyTransaction({ sessionId: opened.data.sessionId, expectedRevision: revision, operations });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    revision = applied.data.revision;
    project = core.applyUamTransaction(project, operations);
    const saved = await runtime.saveSession({ sessionId: opened.data.sessionId, expectedRevision: revision });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    revision = saved.data.revision;
    return preparation;
};

const changedSettings = structuredClone(project.settings);
changedSettings.common.fontSize = Number(changedSettings.common.fontSize || 12) + 1;
changedSettings.i18n = { langFiles: [...(changedSettings.i18n?.langFiles || []), { name: "release-check", path: "i18n/release-check.json" }] };
changedSettings.customProperties = { ...(changedSettings.customProperties || {}), releaseCheck: true };
const changedPackageSettings = {
    ...baselinePackageSettings,
    jpegQuality: baselinePackageSettings.jpegQuality === 79 ? 80 : 79,
    publish: {
        ...baselinePackageSettings.publish,
        useGlobalAtlasSettings: false,
        maxAtlasSize: baselinePackageSettings.publish.maxAtlasSize === 1024 ? 2048 : 1024,
    },
};
const settingsPreparation = await applyAndSave(transactions.prepareUpdateSettingsBatch(
    project,
    changedSettings,
    [{ selector: { packageId: targetPackage.id }, settings: changedPackageSettings }],
));
let reloaded = await readProject();
assert.equal(reloaded.settings.common.fontSize, changedSettings.common.fontSize);
assert.equal(reloaded.settings.customProperties.releaseCheck, true);
assert.equal(reloaded.settings.i18n.langFiles.at(-1).name, "release-check");
assert.equal(reloaded.packages.find((pkg) => pkg.id === targetPackage.id).jpegQuality, changedPackageSettings.jpegQuality);
assert.equal(reloaded.packages.find((pkg) => pkg.id === targetPackage.id).publish.maxAtlasSize, changedPackageSettings.publish.maxAtlasSize);

const branchName = "release-check-empty";
await applyAndSave(transactions.prepareAddProjectBranch(project, branchName));
assert((await readProject()).branches.includes(branchName));
await applyAndSave(transactions.prepareRenameProjectBranch(project, branchName, `${branchName}-renamed`));
assert((await readProject()).branches.includes(`${branchName}-renamed`));
await applyAndSave(transactions.prepareRemoveProjectBranch(project, `${branchName}-renamed`));
assert.deepEqual((await readProject()).branches, baselineBranches);

const undoSettings = {
    ok: true,
    transaction: {
        summary: "Restore settings",
        operation: settingsPreparation.transaction.inverseOperations[0],
        inverseOperation: settingsPreparation.transaction.operations[0],
        operations: settingsPreparation.transaction.inverseOperations,
        inverseOperations: settingsPreparation.transaction.operations,
    },
};
await applyAndSave(undoSettings);
reloaded = await readProject();
assert.deepEqual(reloaded.settings, baselineSettings);
assert.deepEqual({
    compressPNG: reloaded.packages.find((pkg) => pkg.id === targetPackage.id).compressPNG,
    jpegQuality: reloaded.packages.find((pkg) => pkg.id === targetPackage.id).jpegQuality,
    publish: reloaded.packages.find((pkg) => pkg.id === targetPackage.id).publish,
}, baselinePackageSettings);

const rejectedPackageSettings = {
    ...baselinePackageSettings,
    publish: { ...baselinePackageSettings.publish, genCode: true },
};
const rejectedPreparation = await applyAndSave(transactions.prepareUpdatePackageSettings(
    project,
    { packageId: targetPackage.id },
    rejectedPackageSettings,
));
const beforeRejectedPublishWrites = storage.writeLog.length;
const rejectedPublish = await web.publishBrowser({
    document: await reader.read(fairyPath, { includeBinaryData: true, hydrateResourceBytes: true }),
    sourceFileSystem: fileSystem,
    outputFileSystem: storage,
    projectType: "layabox",
    output: ".settings-rejected-publish",
});
assert.equal(rejectedPublish.success, false);
assert.equal(storage.writeLog.length, beforeRejectedPublishWrites, "Rejected browser publish must not write output.");
assert(
    rejectedPublish.diagnostics.some((item) => /code generation|codegen|generate code/i.test(`${item.code || ""} ${item.message}`)),
    JSON.stringify(rejectedPublish.diagnostics),
);
await applyAndSave({
    ok: true,
    transaction: {
        summary: "Restore package code generation settings",
        operation: rejectedPreparation.transaction.inverseOperation,
        inverseOperation: rejectedPreparation.transaction.operation,
    },
});

const languageProject = {
    packages: [{
        id: "pkg",
        resources: [{
            id: "component",
            kind: "component",
            component: {
                displayList: [
                    {
                        id: "text",
                        kind: "text",
                        name: "title",
                        text: "Hello",
                        tooltips: "Tip",
                        gears: [{
                            kind: "text",
                            controllerName: "state",
                            states: [{ pageId: "page-1", value: { text: "State" } }],
                            defaultValue: { text: "Default" },
                        }],
                    },
                    {
                        id: "list",
                        kind: "list",
                        name: "items",
                        listItems: [{ title: "One", selectedTitle: "Selected" }],
                    },
                ],
            },
        }],
    }],
};
const importedLanguage = new Map([
    ["pkgcomponent-text", "你好"],
    ["pkgcomponent-text-tips", "提示"],
    ["pkgcomponent-list-0", "一"],
    ["pkgcomponent-text-texts_0", "状态"],
    ["pkgcomponent-text-texts_def", "默认"],
]);
const languageCommands = languageFiles.createBrowserLanguageCommands(languageProject, importedLanguage);
assert.equal(languageCommands.matched, 5);
assert.equal(languageCommands.commands.length, 2);
assert.equal(languageCommands.commands[0].props.text, "你好");
assert.equal(languageCommands.commands[1].props.listProperties.listItems[0].title, "一");
assert.equal(languageCommands.gearUpdates.length, 1);
assert.equal(languageCommands.gearUpdates[0].gears[0].states[0].value.text, "状态");
assert.equal(languageCommands.gearUpdates[0].gears[0].defaultValue.text, "默认");
assert.match(languageFiles.createBrowserLanguageXml(languageProject), /pkgcomponent-text/);

const report = {
    ok: true,
    openfairyguiVersion: version,
    projectSettings: { saveReload: true, inverse: true, i18n: true, customProperties: true },
    packageSettings: { saveReload: true, inverse: true },
    branches: { add: true, rename: true, remove: true, emptyBranchPersisted: true },
    publishBrowser: { codeGenerationRejectedBeforeWrite: true, selectivePackage: "browser-only", safePathRequiresBrowser: true },
    languageFiles: { export: true, merge: true, importCommands: true },
};
mkdirSync("verification/reports", { recursive: true });
writeFileSync("verification/reports/project-settings-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
