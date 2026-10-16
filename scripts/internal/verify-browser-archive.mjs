import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const encoder = new TextEncoder();
const { BrowserProjectStorage, BrowserWorkspaceRollbackError } = await importTypeScriptModule(
    "src/editor/services/BrowserProjectStorage.ts",
);
const { readZipArchiveFiles } = await importTypeScriptModule(
    "src/editor/services/BrowserArchive.ts",
);

const adapter = new MemoryBrowserStorage();
await adapter.writeFileRaw("Project.fairy", encoder.encode("<project />"));
await adapter.writeFileRaw("assets/中文.bin", new Uint8Array([0, 1, 2, 255]));

const storage = new BrowserProjectStorage("archive-verification", "Project.fairy");
storage.status = "ready";
storage.kind = "indexeddb";
storage.adapter = adapter;
assert.equal(storage.exportWorkspaceZip, undefined, "Whole-project ZIP export must not be exposed.");

const rollbackAdapter = new MemoryBrowserStorage();
await rollbackAdapter.writeFileRaw("Project.fairy", encoder.encode("<original />"));
await rollbackAdapter.writeFileRaw("keep.bin", new Uint8Array([1, 2, 3]));
const rollbackStorage = new BrowserProjectStorage("rollback-verification", "Project.fairy");
rollbackStorage.status = "ready";
rollbackStorage.kind = "indexeddb";
rollbackStorage.adapter = rollbackAdapter;
const rollbackBaseline = rollbackAdapter.snapshot();
const writeFileRaw = rollbackAdapter.writeFileRaw.bind(rollbackAdapter);
let failImportedWrite = true;
rollbackAdapter.writeFileRaw = async (filePath, data) => {
    if (failImportedWrite && filePath === "extra.bin") {
        failImportedWrite = false;
        throw new Error("injected import write failure");
    }
    await writeFileRaw(filePath, data);
};
await assert.rejects(() => rollbackStorage.replaceWorkspaceFiles([
    { path: "Project.fairy", data: encoder.encode("<imported />") },
    { path: "extra.bin", data: new Uint8Array([9]) },
]), /injected import write failure/);
assert.deepEqual(rollbackAdapter.snapshot(), rollbackBaseline, "A partial workspace import must restore every previous file.");
await assert.rejects(() => rollbackStorage.replaceWorkspaceFiles([
    { path: "wrong.fairy", data: encoder.encode("<wrong />") },
]), /does not contain Project\.fairy/);
assert.deepEqual(rollbackAdapter.snapshot(), rollbackBaseline, "An import without the selected project file must roll back.");

const failedRollbackAdapter = new MemoryBrowserStorage();
await failedRollbackAdapter.writeFileRaw("Project.fairy", encoder.encode("<original />"));
await failedRollbackAdapter.writeFileRaw("keep.bin", new Uint8Array([1, 2, 3]));
const failedRollbackStorage = new BrowserProjectStorage("failed-rollback-verification", "Project.fairy");
failedRollbackStorage.status = "ready";
failedRollbackStorage.kind = "indexeddb";
failedRollbackStorage.adapter = failedRollbackAdapter;
const failedRollbackWrite = failedRollbackAdapter.writeFileRaw.bind(failedRollbackAdapter);
let rollbackStarted = false;
failedRollbackAdapter.writeFileRaw = async (filePath, data) => {
    if (filePath === "extra.bin") {
        rollbackStarted = true;
        throw new Error("injected import write failure");
    }
    if (rollbackStarted && filePath === "keep.bin") throw new Error("injected rollback write failure");
    await failedRollbackWrite(filePath, data);
};
await assert.rejects(
    () => failedRollbackStorage.replaceWorkspaceFiles([
        { path: "Project.fairy", data: encoder.encode("<imported />") },
        { path: "extra.bin", data: new Uint8Array([9]) },
    ]),
    (error) => error instanceof BrowserWorkspaceRollbackError
        && error.code === "BROWSER_WORKSPACE_ROLLBACK_FAILED",
    "A failed rollback must be distinguishable from a successfully restored import failure.",
);

await adapter.writeFileRaw(".fairygui-runtime/manifest.json", encoder.encode("{}"));
await adapter.writeFileRaw(".fairygui-runtime/Bag.fui", new Uint8Array([7, 8, 9]));
const runtimeExported = await storage.exportRuntimeBundleZip();
const runtimeRoundTrip = await readZipArchiveFiles(new File(
    [new Uint8Array(await runtimeExported.blob.arrayBuffer())],
    runtimeExported.fileName,
));
assert.match(runtimeExported.fileName, /^Project-runtime-\d{8}T\d{6}Z\.zip$/);
assert.deepEqual(
    runtimeRoundTrip.map((file) => file.path),
    [".fairygui-runtime/Bag.fui", ".fairygui-runtime/manifest.json"],
    "Runtime export must exclude authoring project files.",
);

const deflatedBytes = zipSync({
    "Imported/Project.fairy": encoder.encode("<project />"),
    "Imported/data.txt": encoder.encode("browser zip ".repeat(200)),
    "__MACOSX/ignored": encoder.encode("ignored"),
}, { level: 6 });
const deflated = await readZipArchiveFiles(new File([deflatedBytes], "deflated.zip"));
assert.deepEqual(deflated.map((file) => file.path), ["Imported/data.txt", "Imported/Project.fairy"]);
assert.equal(new TextDecoder().decode(deflated[0].data), "browser zip ".repeat(200));

await assert.rejects(
    () => readZipArchiveFiles(new File([new Uint8Array([1, 2, 3])], "broken.zip")),
);

const legacyGbk = createRawStoredZip([
    { name: new Uint8Array([0xb2, 0xe2, 0xca, 0xd4, 0x2e, 0x70, 0x6e, 0x67]), data: new Uint8Array([7, 8, 9]) },
]);
const legacyFiles = await readZipArchiveFiles(new File([legacyGbk], "air-legacy.fairypackage"));
assert.deepEqual(legacyFiles.map((file) => file.path), ["测试.png"]);

for (const unsafePath of ["../package.xml", "/absolute.txt", "C:/drive.txt"]) {
    const unsafeZip = createRawStoredZip([{ name: encoder.encode(unsafePath), data: new Uint8Array([1]) }]);
    await assert.rejects(
        () => readZipArchiveFiles(new File([unsafeZip], "unsafe.zip")),
        /unsafe path|absolute path/,
    );
}
const duplicateZip = createRawStoredZip([
    { name: encoder.encode("same.txt"), data: new Uint8Array([1]) },
    { name: encoder.encode("same.txt"), data: new Uint8Array([2]) },
]);
await assert.rejects(
    () => readZipArchiveFiles(new File([duplicateZip], "duplicate.zip")),
    /duplicate path/,
);
const oversizedZip = createRawStoredZip([
    { name: encoder.encode("large.bin"), data: new Uint8Array([1]), declaredSize: 64 * 1024 * 1024 + 1 },
]);
await assert.rejects(
    () => readZipArchiveFiles(new File([oversizedZip], "oversized.zip")),
    /entry exceeds/,
);
const forgedInflatedSizeZip = createForgedInflatedSizeZip();
await assert.rejects(
    () => readZipArchiveFiles(new File([forgedInflatedSizeZip], "forged-size.zip")),
    /inflated size/,
    "A deflated entry must be rejected when its actual output exceeds the declared size.",
);

console.log("Browser archive and storage rollback verification passed.");

function createRawStoredZip(entries) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    for (const entry of entries) {
        const data = entry.data;
        const size = entry.declaredSize ?? data.byteLength;
        const crc = crc32(data);
        const local = new Uint8Array(30 + entry.name.byteLength + data.byteLength);
        const localView = new DataView(local.buffer);
        localView.setUint32(0, 0x04034b50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(8, 0, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, data.byteLength, true);
        localView.setUint32(22, size, true);
        localView.setUint16(26, entry.name.byteLength, true);
        local.set(entry.name, 30);
        local.set(data, 30 + entry.name.byteLength);
        localParts.push(local);

        const central = new Uint8Array(46 + entry.name.byteLength);
        const centralView = new DataView(central.buffer);
        centralView.setUint32(0, 0x02014b50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(10, 0, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, data.byteLength, true);
        centralView.setUint32(24, size, true);
        centralView.setUint16(28, entry.name.byteLength, true);
        centralView.setUint32(42, localOffset, true);
        central.set(entry.name, 46);
        centralParts.push(central);
        localOffset += local.byteLength;
    }
    const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0);
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(8, entries.length, true);
    eocdView.setUint16(10, entries.length, true);
    eocdView.setUint32(12, centralSize, true);
    eocdView.setUint32(16, localOffset, true);
    const result = new Uint8Array(localOffset + centralSize + eocd.byteLength);
    let offset = 0;
    for (const part of [...localParts, ...centralParts, eocd]) {
        result.set(part, offset);
        offset += part.byteLength;
    }
    return result;
}

function createForgedInflatedSizeZip() {
    const actual = new Uint8Array(8 * 1024 * 1024).fill(0x41);
    const archive = zipSync({ "bomb.bin": actual }, { level: 9 });
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const forgedSize = 1;
    const forgedCrc = crc32(actual.subarray(0, forgedSize));
    for (let offset = 0; offset + 30 <= archive.byteLength; offset += 1) {
        const signature = view.getUint32(offset, true);
        if (signature === 0x04034b50) {
            view.setUint32(offset + 14, forgedCrc, true);
            view.setUint32(offset + 22, forgedSize, true);
        } else if (signature === 0x02014b50) {
            view.setUint32(offset + 16, forgedCrc, true);
            view.setUint32(offset + 24, forgedSize, true);
        }
    }
    return archive;
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
