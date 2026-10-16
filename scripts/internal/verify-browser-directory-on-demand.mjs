import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const { BrowserProjectImport } = await importTypeScriptModule("src/editor/services/BrowserProjectImport.ts");
const { BrowserProjectStorage } = await importTypeScriptModule("src/editor/services/BrowserProjectStorage.ts");
const { BrowserSaveCoordinator, readPersistedDirectoryBinding } = await importTypeScriptModule("src/editor/services/BrowserSaveCoordinator.ts");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const reads = [];
const writes = [];
let failWrite = "";
let failRemove = "";
let rejectBindingWrites = false;
let deny = false;
function directory(name, prefix = name) {
    const entries = new Map();
    return {
        kind: "directory", name, entries,
        async *keys() { if (deny && prefix.startsWith("source")) throw new DOMException("Denied", "NotAllowedError"); yield* entries.keys(); },
        async getDirectoryHandle(child, { create = false } = {}) {
            let entry = entries.get(child);
            if (!entry && create) entries.set(child, entry = directory(child, `${prefix}/${child}`));
            if (!entry) throw new DOMException("Missing", "NotFoundError");
            if (entry.kind !== "directory") throw new DOMException("File", "TypeMismatchError");
            return entry;
        },
        async getFileHandle(child, { create = false } = {}) {
            if (deny && prefix.startsWith("source")) throw new DOMException("Denied", "NotAllowedError");
            let entry = entries.get(child);
            if (!entry && create) {
                entry = {
                    kind: "file", name: child, bytes: new Uint8Array(),
                    async getFile() {
                        const snapshot = new File([this.bytes], child);
                        const original = snapshot.arrayBuffer.bind(snapshot);
                        snapshot.arrayBuffer = async () => { reads.push(`${prefix}/${child}`); return original(); };
                        return snapshot;
                    },
                    async createWritable() {
                        let bytes;
                        return {
                            async write(value) {
                                if (failWrite === `${prefix}/${child}`) { failWrite = ""; throw new Error("Injected disk failure"); }
                                bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value).slice();
                            },
                            async close() { entry.bytes = bytes; writes.push(`${prefix}/${child}`); },
                            async abort() {},
                        };
                    },
                };
                entries.set(child, entry);
            }
            if (!entry) throw new DOMException("Missing", "NotFoundError");
            if (entry.kind !== "file") throw new DOMException("Directory", "TypeMismatchError");
            return entry;
        },
        async removeEntry(child, { recursive = false } = {}) {
            const entry = entries.get(child);
            if (!entry) throw new DOMException("Missing", "NotFoundError");
            if (entry.kind === "directory" && entry.entries.size && !recursive) throw new Error("Directory is not empty");
            entries.delete(child);
            writes.push(`${prefix}/${child}`);
            if (failRemove === `${prefix}/${child}`) { failRemove = ""; throw new Error("Injected removal failure"); }
        },
        async queryPermission() { return "granted"; },
    };
}
async function file(root, path, content) {
    const parts = path.split("/");
    let parent = root;
    for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
    const result = await parent.getFileHandle(parts.at(-1), { create: true });
    result.bytes = typeof content === "string" ? encoder.encode(content) : content;
    return result;
}
const source = directory("source");
const descriptor = await file(source, "Project.fairy", '<projectDescription id="0123456789abcdef0123456789abcdef" type="Layabox" version="3.0"/>');
const component = await file(source, "assets/A.xml", "original");
await file(source, "assets/unopened.png", new Uint8Array(1024 * 1024));
await file(source, "unused/never-read.bin", new Uint8Array(2 * 1024 * 1024));
await file(source, ".objs/cached.fairy", "cache");
const opfs = directory("opfs");
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { getDirectory: async () => opfs } } });
const records = new Map();
globalThis.indexedDB = {
    open(name) {
        const request = {};
        queueMicrotask(() => {
            request.result = {
                close() {},
                transaction() {
                    const transaction = { objectStore: () => ({
                        get() {
                            const reading = {};
                            queueMicrotask(() => { reading.result = records.get(name); reading.onsuccess(); });
                            return reading;
                        },
                        put(value) {
                            if (rejectBindingWrites) {
                                queueMicrotask(() => { transaction.error = new Error("Binding persistence failed"); transaction.onerror(); });
                                return;
                            }
                            records.set(name, { ...value, baseline: value.baseline.map((entry) => ({ ...entry })), deletedPaths: [...(value.deletedPaths || [])], missingPaths: [...(value.missingPaths || [])] });
                            queueMicrotask(() => transaction.oncomplete());
                        },
                        delete() { records.delete(name); queueMicrotask(() => transaction.oncomplete()); },
                    }) };
                    return transaction;
                },
            };
            request.onsuccess();
        });
        return request;
    },
};
const liveSession = {
    reset: async () => ({ ok: true }),
    connect: async () => ({ status: "connected" }),
    saveWorkspace: async () => ({ save: { ok: true }, reload: { ok: true }, events: { ok: true }, diagnostics: [] }),
};
const workspace = "fairygui-editor-online-on-demand-test";
const picked = await new BrowserProjectImport().readDirectoryProject(source);
assert.deepEqual(reads, [], "Discovery may inspect names but must not read any file bytes.");
assert.equal(picked.imported.onDemand, true);
const storage = new BrowserProjectStorage(workspace, "Project.fairy");
let coordinator = new BrowserSaveCoordinator(liveSession, storage);
assert.equal((await coordinator.importWorkspaceFiles(picked.imported, picked.files, picked.directoryHandle)).ok, true);
assert.deepEqual(reads, [], "Mounting must not read file bytes.");
await storage.getState();
await coordinator.restoreWorkspaceBinding();
assert.deepEqual(reads, [], "Statistics and restored bindings must not scan or hash source files.");
let adapter = storage.getAdapter();
assert.equal(await adapter.readFile("assets/A.xml"), "original");
assert.deepEqual(reads, ["source/assets/A.xml"]);
assert.deepEqual(await adapter.readdir("."), ["Project.fairy", "assets", "unused"]);
await adapter.stat("assets/unopened.png");
assert.equal(reads.length, 1, "Listing and stat must not read file content.");
assert(!writes.some((path) => path.startsWith("source/")), "Reading must never change the project.");
await adapter.writeFile("assets/A.xml", "edited");
await adapter.writeFile("assets/new.xml", "new");
assert.equal(decoder.decode(component.bytes), "original", "Backend writes must remain staged until verified save.");
assert.equal((await readPersistedDirectoryBinding(workspace)).baseline[0].path, "assets/A.xml");
rejectBindingWrites = true;
await assert.rejects(adapter.writeFile("assets/not-staged.xml", "unsafe"), /Binding persistence failed/);
rejectBindingWrites = false;
assert.equal(await adapter.exists("assets/not-staged.xml"), false, "Staging must stop if the conflict baseline cannot be persisted.");
await source.getDirectoryHandle("vacant", { create: true });
await adapter.rmdir("vacant");

component.bytes = encoder.encode("external");
assert.equal((await coordinator.save()).writeback.status, "conflict");
assert.equal(decoder.decode(component.bytes), "external", "External changes must never be overwritten.");
component.bytes = encoder.encode("original");
const externalNew = await file(source, "assets/new.xml", "external-created");
assert.equal((await coordinator.save()).writeback.status, "conflict");
assert.equal(decoder.decode(externalNew.bytes), "external-created");
await (await source.getDirectoryHandle("assets")).removeEntry("new.xml");

const restored = new BrowserProjectStorage(workspace, "Project.fairy");
const readsBeforeRestore = reads.length;
await restored.initialize();
coordinator = new BrowserSaveCoordinator(liveSession, restored);
await coordinator.restoreWorkspaceBinding();
assert.equal(reads.length, readsBeforeRestore, "Refresh must restore overlay and baselines without reading the directory.");
adapter = restored.getAdapter();
assert.equal(await adapter.exists("vacant"), false, "Removed virtual directories must stay hidden after refresh.");
assert.equal(await adapter.readFile("assets/A.xml"), "edited", "Pending writes must survive refresh.");
failWrite = "source/assets/new.xml";
const failed = await coordinator.save();
assert.equal(failed.writeback.status, "failed");
assert.equal(decoder.decode(component.bytes), "original", "A mid-write failure must restore earlier source writes.");
assert.equal(await (await source.getDirectoryHandle("assets")).getFileHandle("new.xml").then(() => true, () => false), false);
const saved = await coordinator.save();
assert.equal(saved.ok, true, JSON.stringify(saved));
assert.equal(decoder.decode(component.bytes), "edited");
assert.equal(decoder.decode((await (await source.getDirectoryHandle("assets")).getFileHandle("new.xml")).bytes), "new");
await adapter.unlink("assets/A.xml");
assert.equal(await adapter.exists("assets/A.xml"), false);
assert((await (await source.getDirectoryHandle("assets")).getFileHandle("A.xml")), "Unlink must be staged.");
failRemove = "source/assets/A.xml";
assert.equal((await coordinator.save()).writeback.status, "failed");
assert.equal(decoder.decode((await (await source.getDirectoryHandle("assets")).getFileHandle("A.xml")).bytes), "edited", "Failed deletion must restore its source file.");
assert.equal((await coordinator.save()).ok, true);
assert.equal(await (await source.getDirectoryHandle("assets")).getFileHandle("A.xml").then(() => true, () => false), false);
assert.equal(await adapter.exists("assets/raced.xml"), false);
const raced = await file(source, "assets/raced.xml", "created-after-probe");
await adapter.writeFile("assets/raced.xml", "staged-new-resource");
assert.equal((await coordinator.save()).writeback.status, "conflict", "A target created externally after an absence probe must not become a new baseline.");
assert.equal(decoder.decode(raced.bytes), "created-after-probe");
assert(!reads.some((path) => /unopened|never-read|cached\.fairy/.test(path)), "Unrequested assets and cache files must stay unread throughout mounting, restore and save.");
assert.equal(decoder.decode(descriptor.bytes).includes("projectDescription"), true);
for (const path of ["../escape", "/absolute", "C:/absolute"]) await assert.rejects(adapter.readFile(path), /EINVAL/);
deny = true;
await assert.rejects(adapter.exists("not-cached.xml"), { name: "NotAllowedError" });
deny = false;

// The actual backend can parse a directly mounted source without a materialized copy.
const backend = await import(new URL("../../assets/resources/editor/runtime/openfairygui-backend-browser.js", import.meta.url));
const fs = backend.createBackendStorageFileSystem(adapter);
fs.acquireSessionLock = async () => ({ writeMetadata: async () => {}, release: async () => {} });
const runtime = new backend.BackendRuntime({ fileSystem: fs });
const opened = await runtime.openSession({ projectPath: "." });
assert.equal(opened.ok, true, JSON.stringify(opened));
await runtime.closeSession({ sessionId: opened.data.sessionId });
assert(!reads.some((path) => /unopened|never-read|cached\.fairy/.test(path)));

// Build a full-fidelity source fixture, then use formal openSession for the
// real backend transaction/save through the directory overlay and native writeback.
const baseline = JSON.parse(await readFile(new URL("../../assets/resources/editor/runtime/uam-baseline.json", import.meta.url), "utf8"));
for (const pkg of baseline.uamProject.packages || []) for (const resource of pkg.resources || []) {
    if (resource.sourceBytes?.encoding === "base64") resource.sourceBytes = new Uint8Array(Buffer.from(resource.sourceBytes.data, "base64"));
}
const seeded = new MemoryBrowserStorage();
const seedRuntime = new backend.BackendRuntime();
const seedSession = seedRuntime.openProjectSession({ project: baseline.uamProject, storage: { fileSystem: backend.createBackendStorageFileSystem(seeded), fairyPath: "Full.fairy" } });
assert.equal((await seedRuntime.materializeSession({ sessionId: seedSession.data.sessionId, expectedRevision: 0, mode: "fullProject", reason: "on_demand_test_fixture" })).ok, true);
await seedRuntime.closeSession({ sessionId: seedSession.data.sessionId });
const fullSource = directory("full-source");
for (const [path, bytes] of seeded.files) await file(fullSource, path, bytes);
await file(fullSource, "unused/untouched.bin", new Uint8Array(1024 * 1024));
const fullPicked = await new BrowserProjectImport().readDirectoryProject(fullSource);
const fullStorage = new BrowserProjectStorage(`${workspace}-full`, "Full.fairy");
const fullCoordinator = new BrowserSaveCoordinator(liveSession, fullStorage);
assert.equal((await fullCoordinator.importWorkspaceFiles(fullPicked.imported, [], fullSource)).ok, true);
const fullFs = backend.createBackendStorageFileSystem(fullStorage.getAdapter());
fullFs.acquireSessionLock = fs.acquireSessionLock;
const fullRuntime = new backend.BackendRuntime({ fileSystem: fullFs });
const fullOpened = await fullRuntime.openSession({ projectPath: "." });
assert.equal(fullOpened.ok, true, JSON.stringify(fullOpened));
assert.equal(fullOpened.data.uamFidelity, "full", "The new filesystem must preserve the formal source-fidelity check.");
const target = baseline.target;
const node = baseline.uamProject.packages.find((pkg) => pkg.id === target.packageId).resources
    .find((resource) => resource.id === target.componentResourceId).component.displayList.find((node) => node.id === target.displayNodeId);
const applied = await fullRuntime.applyTransaction({ sessionId: fullOpened.data.sessionId, expectedRevision: 0,
    operations: [{ kind: "setDisplayNodeProps", selector: { packageId: target.packageId, componentResourceId: target.componentResourceId, displayNodeId: target.displayNodeId }, props: { position: { x: node.position.x + 3, y: node.position.y } } }] });
assert.equal(applied.ok, true, JSON.stringify(applied));
assert.equal((await fullRuntime.saveSession({ sessionId: fullOpened.data.sessionId, expectedRevision: applied.data.revision })).ok, true);
assert.equal((await fullCoordinator.save()).ok, true, "Actual backend output must pass conflict checks and write back.");
await fullRuntime.closeSession({ sessionId: fullOpened.data.sessionId });
const { BrowserDirectoryStorage } = await importTypeScriptModule("src/editor/services/BrowserDirectoryStorage.ts");
const diskOnly = new BrowserDirectoryStorage({ directory: fullSource, directoryName: "full-source", fairyPath: "Full.fairy", baseline: [], restored: false }, new MemoryBrowserStorage(), "unused-read-only");
const diskDoc = await new backend.ProjectReader(backend.createBackendStorageFileSystem(diskOnly)).read("Full.fairy", { hydrateResourceBytes: true });
const diskProject = backend.liftDocumentToUamProject(diskDoc);
const diskNode = diskProject.packages.find((pkg) => pkg.id === target.packageId).resources
    .find((resource) => resource.id === target.componentResourceId).component.displayList.find((node) => node.id === target.displayNodeId);
assert.equal(diskNode.position.x, node.position.x + 3, "Reload from the native source, without staged files, must contain the saved change.");
assert(!reads.includes("full-source/unused/untouched.bin"), "Backend save must not read unrelated source files.");

Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
delete globalThis.indexedDB;
console.log("On-demand directory verification passed (zero-byte discovery/mount/restore, demand reads, persistent staging, conflicts, deletion/rollback, permission errors, path boundaries, formal backend full-fidelity transaction/save/native reload, unrelated files unread).");
