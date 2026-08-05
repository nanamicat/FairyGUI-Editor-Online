import assert from "node:assert/strict";
import path from "node:path";
import { build } from "vite";

const root = process.cwd();
const entry = path.join(root, "src/editor/services/DirectoryWritebackPolicy.ts");
const output = await build({
    configFile: false,
    logLevel: "error",
    build: {
        lib: {
            entry,
            formats: ["es"],
            fileName: "phase8-directory-writeback-policy",
        },
        minify: false,
        sourcemap: false,
        target: "es2022",
        write: false,
    },
});
const bundle = (Array.isArray(output) ? output[0] : output).output
    .find((item) => item.type === "chunk");
if (!bundle || bundle.type !== "chunk") {
    throw new Error("Could not build the Phase 8 directory write-back policy check.");
}
const policy = await import(
    "data:text/javascript;base64," + Buffer.from(bundle.code).toString("base64"),
);

const files = [
    { path: "FairyGUI-layabox-demo.fairy", data: new Uint8Array([1, 2, 3]) },
    { path: "assets/icon.bin", data: new Uint8Array([4, 5]) },
];
const baseline = await policy.createDirectoryWritebackBaseline(files);
const unchanged = await Promise.all(files.map(async (file) => ({
    path: file.path,
    version: await policy.createDirectoryVersionEntry(file.path, file.data),
})));
assert.deepEqual(policy.compareDirectoryWritebackVersions(baseline, unchanged), []);

const changed = await policy.createDirectoryVersionEntry(
    "FairyGUI-layabox-demo.fairy",
    new Uint8Array([9, 2, 3]),
);
assert.deepEqual(
    policy.compareDirectoryWritebackVersions(baseline, [
        { path: "FairyGUI-layabox-demo.fairy", version: changed },
        { path: "assets/icon.bin" },
        {
            path: "new.bin",
            version: await policy.createDirectoryVersionEntry("new.bin", new Uint8Array([7])),
        },
    ]),
    [
        { path: "assets/icon.bin", kind: "missing" },
        { path: "FairyGUI-layabox-demo.fairy", kind: "changed" },
        { path: "new.bin", kind: "created" },
    ],
);

assert.throws(
    () => policy.normalizeDirectoryWritebackPath("../outside.fairy"),
    /Unsafe workspace path/,
);

const disk = new Map([
    ["existing.bin", new Uint8Array([1])],
    ["later.bin", new Uint8Array([5])],
]);
let failForwardWrite = true;
await assert.rejects(
    policy.writeDirectoryFilesWithRollback(
        [
            {
                file: { path: "existing.bin", data: new Uint8Array([2]) },
                previous: new Uint8Array([1]),
            },
            {
                file: { path: "new.bin", data: new Uint8Array([3]) },
            },
            {
                file: { path: "later.bin", data: new Uint8Array([4]) },
                previous: new Uint8Array([5]),
            },
        ],
        async (file) => {
            if (file.path === "later.bin" && failForwardWrite) {
                failForwardWrite = false;
                throw new Error("injected late write failure");
            }
            disk.set(file.path, file.data.slice());
        },
        async (path) => {
            disk.delete(path);
        },
    ),
    (error) => error?.code === "DIRECTORY_WRITEBACK_ROLLED_BACK"
        && /Restored 3 attempted file/.test(error.message),
);
assert.deepEqual(disk, new Map([
    ["existing.bin", new Uint8Array([1])],
    ["later.bin", new Uint8Array([5])],
]));

console.log(JSON.stringify({
    ok: true,
    verified: [
        "unchanged Folder baseline",
        "changed, missing, and externally created target conflicts",
        "unsafe workspace path rejection",
        "late write failure restores changed files and removes new files",
    ],
}, null, 2));
