import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = path.join(root, "vendor", "FairyGUI-Editor", "ui");
const outputDir = path.join(root, "assets", "resources", "ui");
const stagingDir = path.join(root, ".tmp", "editor-ui-publish");
const cli = path.join(root, "node_modules", "@openfairygui", "cli", "bin", "cli.cjs");
const packageNames = ["Basic", "Builder"];

await rm(stagingDir, { force: true, recursive: true });
await mkdir(stagingDir, { recursive: true });

const publish = spawnSync(process.execPath, [
    cli,
    "publish",
    projectDir,
    "--output",
    stagingDir,
    "--project-type",
    "layabox",
    "--packages",
    packageNames.join(","),
], { stdio: "inherit" });

if (publish.error) throw publish.error;
if (publish.status !== 0) throw new Error(`Editor UI publish failed with exit code ${publish.status}.`);

const generated = await readdir(stagingDir, { withFileTypes: true });
if (generated.some((entry) => !entry.isFile())) {
    throw new Error("Editor UI publish emitted an unsupported nested output directory.");
}

await mkdir(outputDir, { recursive: true });
for (const entry of generated) {
    await copyFile(path.join(stagingDir, entry.name), path.join(outputDir, entry.name));
}

const generatedNames = new Set(generated.map((entry) => entry.name));
for (const entry of await readdir(outputDir, { withFileTypes: true })) {
    if (entry.isFile() && !entry.name.endsWith(".meta") && !generatedNames.has(entry.name)) {
        await rm(path.join(outputDir, entry.name));
    }
}

await rm(stagingDir, { force: true, recursive: true });
console.log(`Published editor UI from vendor/FairyGUI-Editor/ui to assets/resources/ui (${generated.length} files).`);
