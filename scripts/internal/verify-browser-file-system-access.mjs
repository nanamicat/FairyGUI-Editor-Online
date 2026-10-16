import assert from "node:assert/strict";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const { pickLocalDirectory, supportsLocalDirectories, authorizeLocalDirectory, createLocalProject, validateLocalProjectName } =
    await importTypeScriptModule("src/editor/services/BrowserFileSystemAccess.ts");
const { BrowserProjectImport } = await importTypeScriptModule("src/editor/services/BrowserProjectImport.ts");
const { parseBrowserWorkspaceRegistry } = await importTypeScriptModule("src/editor/runtime/BrowserWorkspaceRegistry.ts");

function directory(name) {
    const entries = new Map();
    return {
        kind: "directory", name, entries,
        async *keys() { yield* entries.keys(); },
        async getDirectoryHandle(child, { create = false } = {}) {
            let entry = entries.get(child);
            if (!entry && create) entries.set(child, entry = directory(child));
            if (!entry) throw new DOMException("Missing", "NotFoundError");
            if (entry.kind !== "directory") throw new DOMException("File", "TypeMismatchError");
            return entry;
        },
        async getFileHandle(child, { create = false } = {}) {
            let entry = entries.get(child);
            if (entry?.kind === "directory") throw new DOMException("Directory", "TypeMismatchError");
            if (!entry && create) {
                entry = {
                    kind: "file", name: child, bytes: new Uint8Array(),
                    async getFile() { return new File([this.bytes], child); },
                    async createWritable() {
                        let data;
                        return {
                            async write(value) { data = new TextEncoder().encode(value); },
                            async close() { entry.bytes = data; },
                            async abort() {},
                        };
                    },
                };
                entries.set(child, entry);
            }
            if (!entry) throw new DOMException("Missing", "NotFoundError");
            return entry;
        },
        requestPermission(options) {
            assert.equal(options.mode, "readwrite");
            this.permissionRequested = true;
            return Promise.resolve("granted");
        },
    };
}

const parent = directory("Projects");
let pickerCalls = 0;
globalThis.window = {
    isSecureContext: true,
    showDirectoryPicker(options) {
        pickerCalls += 1;
        assert.equal(this, window, "Picker must retain its Window receiver.");
        assert.equal(options.mode, "readwrite");
        this.pickerRequested = true;
        return Promise.resolve(parent);
    },
};
assert(supportsLocalDirectories());
const picking = pickLocalDirectory();
assert(window.pickerRequested, "Picker must start before yielding user activation.");
assert.equal(await picking, parent);
assert.equal(pickerCalls, 1, "Opening a directory must request read/write access in one picker call.");
assert.equal(parent.permissionRequested, undefined, "The initial picker must not require a second authorization action.");
const authorizing = authorizeLocalDirectory(parent);
assert(parent.permissionRequested, "Recent authorization must start before queued work.");
await authorizing;
await assert.rejects(authorizeLocalDirectory({ requestPermission: async () => "denied" }), /授权未获准/);

for (const errorName of ["AbortError", "NotAllowedError", "SecurityError"]) {
    window.showDirectoryPicker = () => Promise.reject(new DOMException(errorName, errorName));
    await assert.rejects(new BrowserProjectImport().pickDirectoryProject(), { name: errorName });
}
window.isSecureContext = false;
assert(!supportsLocalDirectories());
await assert.rejects(pickLocalDirectory(), /HTTPS/);
await assert.rejects(new BrowserProjectImport().pickDirectoryProject(), /HTTPS/);
window.isSecureContext = true;
window.showDirectoryPicker = undefined;
await assert.rejects(new BrowserProjectImport().pickDirectoryProject(), /不支持本地项目目录读写/);
assert.equal(new BrowserProjectImport().pickZipProject, undefined, "Project ZIP import must not be exposed.");

for (const invalid of ["", "..", "../escape", "A/B", "a\\b", "NUL", "CON.txt", "name.", "a:b"]) {
    assert.throws(() => validateLocalProjectName(invalid), /有效的项目名称/);
}
const created = await createLocalProject(parent, "测试项目", true);
const cache = await created.getDirectoryHandle(".objs", { create: true });
await cache.getFileHandle("cached.fairy", { create: true });
const git = await created.getDirectoryHandle(".git", { create: true });
await git.getFileHandle("config", { create: true });
const progressEvents = [];
const picked = await new BrowserProjectImport().readDirectoryProject(created, (progress) => progressEvents.push(progress));
assert.equal(picked.directoryHandle, created);
assert.equal(picked.imported.fairyPath, "测试项目.fairy");
assert.equal(picked.imported.fileCount, 1);
assert.equal(progressEvents[0].fileCount, 0, "Report the selected directory before reading files.");
assert.equal(progressEvents.at(-1).fileCount, 1, "Progress must exclude editor cache and Git metadata.");
const original = new TextDecoder().decode(picked.files[0].data);
assert.match(original, /<projectDescription id="[a-f0-9]{32}" type="Layabox" version="3.0"\/>/);
assert(created.entries.has("assets"));
await assert.rejects(createLocalProject(parent, "测试项目", true), /不是空目录/);
assert.equal(await (await (await created.getFileHandle("测试项目.fairy")).getFile()).text(), original);
const flat = directory("Empty");
assert.equal(await createLocalProject(flat, "Flat", false), flat);
await flat.getFileHandle("Other.fairy", { create: true });
await assert.rejects(new BrowserProjectImport().readDirectoryProject(flat), /多个 .fairy/);

const denied = directory("Denied");
denied.entries.set("blocked", { kind: "file" });
denied.getFileHandle = async () => { throw new DOMException("No read permission", "NotAllowedError"); };
await assert.rejects(new BrowserProjectImport().readDirectoryProject(denied), { name: "NotAllowedError" });

const entry = {
    id: "fairygui-editor-online-local", name: "测试项目", fairyPath: "测试项目.fairy",
    lastOpenedAt: new Date().toISOString(), source: "directory", sourceName: "测试项目", directoryBound: true,
};
assert.deepEqual(parseBrowserWorkspaceRegistry(JSON.stringify({ activeId: entry.id, entries: [entry] })).entries[0], entry);
console.log("File System Access verification passed (picker receiver, gesture timing, permissions, cancellation, project creation, no overwrite, ambiguous projects, recent metadata).");
