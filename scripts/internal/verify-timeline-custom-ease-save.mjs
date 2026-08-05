import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import {
    resolveAuthoringProjectPath,
    resolveOpenFairyGuiModuleRoot,
} from "../project-boundary.mjs";

const moduleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const projectPath = resolveAuthoringProjectPath(process.argv[3]);
const fairyPath = path.basename(projectPath);
const customEasePath = "2,0,0,0.5375,0.28,0.7575,0.865,1,0,1,1";

const importFile = (filePath) => import(pathToFileURL(filePath).href);
const [
    { liftDocumentToUamProject },
    { ProjectReader },
    { BackendRuntime, createBackendStorageFileSystem },
] = await Promise.all([
    importFile(path.join(moduleRoot, "core", "dist", "index.js")),
    importFile(path.join(moduleRoot, "core", "dist", "project-io.js")),
    importFile(path.join(moduleRoot, "backend", "dist", "index.mjs")),
]);

const storage = new MemoryBrowserStorage();
storage.importDirectory(path.dirname(projectPath));
const fileSystem = createBackendStorageFileSystem(storage);
const readProject = async () => {
    const document = await new ProjectReader(fileSystem).read(fairyPath, {
        includeBinaryData: true,
        hydrateResourceBytes: true,
    });
    return liftDocumentToUamProject(document);
};
const findTarget = (project) => {
    const pkg = project.packages.find((candidate) => candidate.name === "Transition");
    const resource = pkg?.resources.find((candidate) => candidate.name === "PathDemo");
    const transition = resource?.component?.transitions.find((candidate) => candidate.name === "t0");
    assert(pkg && resource && transition, "Transition/PathDemo/t0 must exist.");
    return { pkg, resource, transition };
};

const project = await readProject();
const original = findTarget(project);
const updatedTransition = structuredClone(original.transition);
const item = updatedTransition.items[1];
assert(item?.tween, "Transition/PathDemo/t0 item 1 must be a tween.");
item.easeType = 31;
item.customEasePath = customEasePath;

const runtime = new BackendRuntime();
const opened = runtime.openProjectSession({
    project: structuredClone(project),
    storage: {
        fileSystem,
        fairyPath,
        canonicalProjectPath: "opfs://timeline-custom-ease",
        canonicalPathKey: "opfs://timeline-custom-ease",
    },
});
assert(opened.ok, JSON.stringify(opened));
const selector = {
    packageId: original.pkg.id,
    componentResourceId: original.resource.id,
    transitionName: original.transition.name,
};
const applied = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: opened.data.revision,
    operations: [{ kind: "updateTransition", selector, transition: updatedTransition }],
});
assert(applied.ok, JSON.stringify(applied));
const saved = await runtime.saveSession({
    sessionId: opened.data.sessionId,
    expectedRevision: applied.data.revision,
});
assert(saved.ok, JSON.stringify(saved));
const reloaded = findTarget(await readProject()).transition.items[1];
assert.equal(reloaded.easeType, 31);
assert.equal(reloaded.customEasePath, customEasePath);
assert.equal(reloaded.path, original.transition.items[1].path);

const restored = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: saved.data.revision,
    operations: [{ kind: "updateTransition", selector, transition: original.transition }],
});
assert(restored.ok, JSON.stringify(restored));
const restoredSaved = await runtime.saveSession({
    sessionId: opened.data.sessionId,
    expectedRevision: restored.data.revision,
});
assert(restoredSaved.ok, JSON.stringify(restoredSaved));
assert.deepEqual(findTarget(await readProject()).transition, original.transition);

console.log(JSON.stringify({
    ok: true,
    appliedRevision: applied.data.revision,
    restoredRevision: restored.data.revision,
    customEasePath,
}));
