import assert from "node:assert/strict";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const { WorkspaceLifecycleController } = await importTypeScriptModule("src/editor/runtime/WorkspaceLifecycleController.ts");
const { EditorWorkspaceLifecycle } = await importTypeScriptModule("src/editor/modules/WorkspaceLifecycleModule.ts");
const { BROWSER_WORKSPACE_REGISTRY_STORAGE_KEY, parseBrowserWorkspaceRegistry } =
    await importTypeScriptModule("src/editor/runtime/BrowserWorkspaceRegistry.ts");
const cleanupKey = "fairygui-editor-online.directory-workspace-cleanup.v1";
const values = new Map();
const bindings = new Map();
globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
};
let failedDatabase = "";
globalThis.indexedDB = {
    open(name) {
        const request = {};
        queueMicrotask(() => {
            if (name === failedDatabase) {
                request.error = new Error("Binding unavailable");
                request.onerror();
                return;
            }
            request.result = {
                close() {},
                transaction() {
                    return { objectStore: () => ({
                        get() {
                            const read = {};
                            queueMicrotask(() => {
                                read.result = bindings.get(name);
                                read.onsuccess();
                            });
                            return read;
                        },
                    }) };
                },
            };
            request.onsuccess();
        });
        return request;
    },
};

let comparisons = 0;
let comparisonError = false;
function directory(identity) {
    return {
        name: "FGUIProject",
        identity,
        async isSameEntry(other) {
            comparisons++;
            if (comparisonError) throw new Error("Identity unavailable");
            return identity === other.identity;
        },
        async getFileHandle() { throw new Error("Directory files must not be read during reuse."); },
        async *keys() { throw new Error("Directory must not be scanned during reuse."); },
    };
}
function entry(suffix, day, fairyPath = "FGUIProject.fairy") {
    return {
        id: `fairygui-editor-online-workspace-${suffix}`,
        name: "FGUIProject", fairyPath, lastOpenedAt: `2026-10-${day}T00:00:00Z`,
        source: "directory", sourceName: "FGUIProject", directoryBound: true,
    };
}
function bind(entry, identity) {
    bindings.set(`${entry.id}-directory-binding`, {
        key: "active", directory: directory(identity), directoryName: "FGUIProject",
        fairyPath: entry.fairyPath, baseline: [],
    });
}
const active = entry("active", "10");
const activeDuplicate = entry("active-copy", "15");
const sameName = entry("different-directory", "14");
const differentProject = entry("different-project", "13", "Other.fairy");
const older = entry("older", "11");
const newer = entry("newer", "12");
const missing = entry("lost-binding", "10");
bind(active, "A");
bind(activeDuplicate, "A");
bind(sameName, "B");
bind(differentProject, "A");
bind(older, "C");
bind(newer, "C");
const original = { activeId: active.id, entries: [activeDuplicate, sameName, differentProject, newer, older, missing, active] };
const controller = new WorkspaceLifecycleController({}, {}, structuredClone(original));
await Promise.all([controller.prepareRecentDirectories(), controller.prepareRecentDirectories()]);
assert.equal(controller.registry.activeId, active.id, "Cleanup must retain the active workspace.");
assert.deepEqual(controller.registry.entries.map(({ id }) => id), [sameName, differentProject, newer, missing, active].map(({ id }) => id));
const backup = JSON.parse(values.get(`${cleanupKey}.backup`));
assert.deepEqual(backup.previousRegistry, original, "The removed registrations must be recoverable.");
assert.deepEqual(backup.removedIds.sort(), [activeDuplicate.id, older.id].sort());
assert.equal(bindings.size, 6, "Cleanup must leave cached workspaces and their bindings intact.");
assert.equal(parseBrowserWorkspaceRegistry(values.get(BROWSER_WORKSPACE_REGISTRY_STORAGE_KEY)).entries.length, 5);

const selected = directory("A"); // A newly returned handle object for the same directory.
assert.equal((await controller.findDirectoryWorkspace(selected)).id, active.id);
assert.equal((await controller.findDirectoryWorkspace(selected, "Other.fairy")).id, differentProject.id);
assert.equal((await controller.findDirectoryWorkspace(directory("B"))).id, sameName.id);
assert.equal(await controller.findDirectoryWorkspace(directory("D")), undefined, "Same name is not directory identity.");
const picked = {
    directoryHandle: { async getDirectoryHandle(name) { assert.equal(name, "child"); return selected; } },
    imported: { projectRoot: "child", fairyPath: "FGUIProject.fairy" },
};
assert.equal((await controller.findPickedDirectoryWorkspace(picked)).id, active.id, "Parent selection must resolve the project root before matching.");

const calls = [];
let dirty = false;
const service = {
    get registry() { return controller.registry; },
    findDirectoryWorkspace: (...args) => controller.findDirectoryWorkspace(...args),
    findPickedDirectoryWorkspace: (...args) => controller.findPickedDirectoryWorkspace(...args),
    switchWorkspace: async (existing) => { calls.push(existing.id); return { projectFileExists: true }; },
    createWorkspace: async () => { throw new Error("Existing directory must not create another workspace."); },
    readDirectoryProject: async () => { throw new Error("Existing directory must not be copied again."); },
    importWorkspace: async () => { throw new Error("Existing cached changes must not be overwritten."); },
    getActiveWorkspaceQuarantine: async () => null,
};
const session = {
    workspaceLifecycle: service,
    commandAdapter: { getSessionState: () => ({ dirty }) },
    runExclusive: (operation) => operation(),
    liveSessionBridge: { captureSessionIdentity: () => null },
    clearSnapshot() {},
    connectNow: async () => ({ state: { status: "connected" }, synchronized: true }),
};
const lifecycle = new EditorWorkspaceLifecycle(
    { setDebugAttribute() {}, setStatus() {} }, session,
    { persist() {}, reset() {}, resetRuntimePackages() {} },
);
assert.equal(await lifecycle.openDirectoryProject(selected), true);
assert.equal(await lifecycle.openDirectoryProject(directory("A")), true);
assert.equal(await lifecycle.openProject(picked), true);
assert.deepEqual(calls, [active.id, active.id, active.id]);
dirty = true;
assert.equal(await lifecycle.openDirectoryProject(selected), false, "Unsaved changes must still block switching.");
assert.equal(calls.length, 3);
dirty = false;
let quarantined = true;
let recoveryReads = 0;
let recoveryImports = 0;
service.getActiveWorkspaceQuarantine = async () => quarantined ? "Previous import failed validation" : null;
service.clearActiveWorkspaceQuarantine = async () => { quarantined = false; };
service.readDirectoryProject = async () => { recoveryReads++; return picked; };
service.importWorkspace = async () => {
    recoveryImports++;
    return {
        ok: true, results: {}, diagnostics: [],
        storage: { projectFileExists: true, fileCount: 1, directoryWriteback: { status: "ready" } },
    };
};
assert.equal(await lifecycle.openDirectoryProject(selected), true, "An explicit directory selection must still repair a quarantined workspace.");
assert.equal(quarantined, false);
assert.equal(recoveryReads, 1);
assert.equal(recoveryImports, 1);
service.switchWorkspace = async (existing) => { calls.push(existing.id); return { projectFileExists: false }; };
assert.equal(await lifecycle.openDirectoryProject(selected), true, "A missing browser cache must be rebuilt in the same workspace.");
assert.equal(recoveryReads, 2);
assert.equal(recoveryImports, 2);
assert.deepEqual(calls.slice(3), [active.id, active.id]);
await lifecycle.dispose();

const afterCleanup = parseBrowserWorkspaceRegistry(values.get(BROWSER_WORKSPACE_REGISTRY_STORAGE_KEY));
const comparisonsBeforeReload = comparisons;
await new WorkspaceLifecycleController({}, {}, afterCleanup).prepareRecentDirectories();
assert.equal(comparisons, comparisonsBeforeReload, "Migration must run once, not on every home-page render or reload.");

values.clear();
comparisonError = true;
const retrying = new WorkspaceLifecycleController({}, {}, structuredClone(original));
await assert.rejects(retrying.prepareRecentDirectories(), /Identity unavailable/);
assert.equal(retrying.registry.entries.length, original.entries.length);
assert.equal(values.has(cleanupKey), false, "Failed identity checks must not mark cleanup complete.");
comparisonError = false;
failedDatabase = `${active.id}-directory-binding`;
await assert.rejects(retrying.prepareRecentDirectories(), /部分目录授权记录无法恢复/);
assert.equal(values.has(cleanupKey), false);
failedDatabase = "";
const setItem = globalThis.localStorage.setItem;
globalThis.localStorage.setItem = (key, value) => {
    if (key.endsWith(".backup")) throw new Error("Backup unavailable");
    return setItem(key, value);
};
await assert.rejects(retrying.prepareRecentDirectories(), /Backup unavailable/);
assert.equal(retrying.registry.entries.length, original.entries.length, "No records may be removed before the recovery backup is saved.");
globalThis.localStorage.setItem = setItem;
await retrying.prepareRecentDirectories();
assert.equal(retrying.registry.entries.length, 5, "Failed preparation must be retryable.");

delete globalThis.localStorage;
delete globalThis.indexedDB;
console.log("Directory workspace verification passed (identity reuse before file reads, cache preservation, parent roots, dirty guard, one-time cleanup, active/latest retention, same-name isolation, recoverable backup and retry).");
