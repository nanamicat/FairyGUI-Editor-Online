import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const packages = [];
let added = 0;
let removed = 0;
let unloaded = 0;
globalThis.fgui = {
    UIPackage: {
        addPackage() {
            added += 1;
            const pkg = {
                name: "Bag",
                customId: "",
                items: [],
                unloadAssets() { unloaded += 1; },
            };
            packages.push(pkg);
            return pkg;
        },
        getByName(name) {
            return packages.find((pkg) => pkg.name === name) || null;
        },
        getById(id) {
            return packages.find((pkg) => pkg.customId === id || pkg.name === id) || null;
        },
        removePackage(id) {
            const index = packages.findIndex((pkg) => pkg.customId === id || pkg.name === id);
            if (index >= 0) {
                packages.splice(index, 1);
                removed += 1;
            }
        },
    },
};
const {
    AUTHORING_RUNTIME_WORKSPACE_MANIFEST_PATH,
    AuthoringRuntimePackageLoader,
} = await importTypeScriptModule("src/editor/runtime/AuthoringRuntimePackageLoader.ts");

const manifest = JSON.stringify({
    schemaVersion: 1,
    source: { projectId: "project" },
    packages: [{
        packageId: "package",
        packageName: "Bag",
        publishName: "Bag",
        resourceKey: ".fairygui-runtime/Bag",
        files: ["Bag.fui"],
    }],
});
let revision = "a";
let descriptorReads = 0;
let advanceRevisionDuringRead = false;
const adapter = {
    async exists(path) {
        return path === AUTHORING_RUNTIME_WORKSPACE_MANIFEST_PATH;
    },
    async readFile(path) {
        assert.equal(path, AUTHORING_RUNTIME_WORKSPACE_MANIFEST_PATH);
        return manifest;
    },
    async readFileRaw(path) {
        assert.equal(path, ".fairygui-runtime/Bag.fui");
        descriptorReads += 1;
        if (advanceRevisionDuringRead) {
            advanceRevisionDuringRead = false;
            revision = "race-b";
        }
        return new Uint8Array([revision.charCodeAt(0)]);
    },
    join(...parts) {
        return parts.join("/");
    },
};
const loader = new AuthoringRuntimePackageLoader(() => ({ adapter, revision }));

assert.equal(loader.getSourceRevision(), "workspace:a");
const first = await loader.ensureLoaded("project", "Bag");
assert.equal(first.sourceRevision, "workspace:a");
assert.equal(added, 1);
assert.equal(descriptorReads, 1);

await loader.ensureLoaded("project", "Bag");
assert.equal(added, 1, "An unchanged source revision must reuse its package lease.");

revision = "b";
assert.equal(loader.getSourceRevision(), "workspace:b");
const second = await loader.ensureLoaded("project", "Bag");
assert.equal(second.sourceRevision, "workspace:b");
assert.equal(added, 2);
assert.equal(removed, 1);
assert.equal(unloaded, 1);

revision = "a";
await loader.ensureLoaded("project", "Bag");
assert.equal(added, 3, "Released revisions must not reuse completed load promises.");
assert.equal(packages.length, 1);

loader.reset();
assert.equal(packages.length, 0);
assert.equal(removed, 3);
assert.equal(unloaded, 3);

revision = "race-a";
advanceRevisionDuringRead = true;
const raced = await loader.ensureLoaded("project", "Bag");
assert.equal(raced.sourceRevision, "workspace:race-b");
assert.equal(packages.length, 1, "A source change during load must retry with the latest revision.");
loader.reset();

const controllerSource = readFileSync("src/editor/runtime/RuntimePreviewController.ts", "utf8");
assert(!controllerSource.includes("BrowserProjectStorage"));
assert(controllerSource.includes("this.previewSourceRevision === sourceRevision"));
assert(controllerSource.includes("runtimePackageLoader: AuthoringRuntimePackageLoader"));

console.log(JSON.stringify({
    ok: true,
    revisions: ["workspace:a", "workspace:b", "workspace:a"],
    packageLoads: added,
    packageReleases: removed,
}));
