import assert from "node:assert/strict";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const {
    appendDesktopConsoleEntry,
    getDesktopConsoleCopyText,
} = await importTypeScriptModule("src/editor/runtime/DesktopConsoleLog.ts");

let entries = [];
for (let index = 0; index < 101; index += 1) {
    entries = appendDesktopConsoleEntry(
        entries,
        `Message ${index}`,
        index === 100 ? "error" : "info",
        new Date(`2026-07-30T09:00:${String(index % 60).padStart(2, "0")}.000Z`),
    );
}

assert.equal(entries.length, 100);
assert.equal(entries[0].message.endsWith("Message 1"), true);
assert.equal(entries[99].level, "error");
assert.equal(
    getDesktopConsoleCopyText(entries, [0, 99, 100, -1]),
    `${entries[0].message}\n${entries[99].message}`,
);

console.log("Desktop console log verification passed.");
