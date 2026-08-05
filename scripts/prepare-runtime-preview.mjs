import assert from "node:assert/strict";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

const publishOutputDir = path.resolve(process.argv[2] ?? ".tmp/phase5-openfairygui-publish");
const publishReportPath = path.resolve(
    process.argv[3] ?? "verification/reports/phase5-publish-report.json",
);
const runtimeOutputDir = path.resolve(
    process.argv[4] ?? "assets/resources/editor/authoring-runtime",
);
const runtimeAssetsRoot = path.resolve("assets/resources/editor");

function relativePath(filePath) {
    return path.relative(process.cwd(), filePath).replaceAll(path.sep, "/");
}

function isInside(parentPath, targetPath) {
    const relative = path.relative(parentPath, targetPath);
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertSafeRuntimeOutput() {
    const isStaticRuntime = isInside(runtimeAssetsRoot, runtimeOutputDir)
        && path.basename(runtimeOutputDir) === "authoring-runtime";
    const isPortableRuntime = path.basename(runtimeOutputDir) === ".fairygui-runtime";
    assert(
        isStaticRuntime || isPortableRuntime,
        `Runtime output must be assets/resources/editor/authoring-runtime or a .fairygui-runtime folder: ${runtimeOutputDir}`,
    );
    return isStaticRuntime;
}

function readReport() {
    assert(existsSync(publishReportPath), `Publish report was not found: ${publishReportPath}`);
    const report = JSON.parse(readFileSync(publishReportPath, "utf8"));
    assert(report?.schemaVersion === 1, "Unsupported publish report schema.");
    assert(report?.contracts?.outputOk, "Publish report does not contain valid output.");
    assert(Array.isArray(report.contracts.outputFiles), "Publish report has no output file list.");
    assert(Array.isArray(report.contracts.packages), "Publish report has no package contracts.");
    return report;
}

function assertSafeFileName(name) {
    assert(typeof name === "string" && name && path.basename(name) === name, `Unsafe publish file name: ${name}`);
}

function copyPublishedFiles(report) {
    assert(existsSync(publishOutputDir), `Publish output was not found: ${publishOutputDir}`);
    for (const file of report.contracts.outputFiles) {
        assertSafeFileName(file.name);
        const sourcePath = path.join(publishOutputDir, file.name);
        assert(existsSync(sourcePath), `Publish file was not found: ${sourcePath}`);
        assert(statSync(sourcePath).isFile(), `Publish output is not a file: ${sourcePath}`);
        copyFileSync(sourcePath, path.join(runtimeOutputDir, file.name));
    }
}

function createManifest(report, isStaticRuntime) {
    const packages = report.contracts.packages.map((pkg) => {
        assertSafeFileName(`${pkg.publishName}.fui`);
        assert(pkg.packageId && pkg.packageName && pkg.publishName, "Publish package contract is incomplete.");
        const files = report.contracts.outputFiles
            .map((file) => String(file.name))
            .filter((fileName) => fileName === `${pkg.publishName}.fui` || fileName.startsWith(`${pkg.publishName}_`));
        assert(files.includes(`${pkg.publishName}.fui`), `Publish package descriptor is missing: ${pkg.publishName}.fui`);
        return {
            packageId: String(pkg.packageId),
            packageName: String(pkg.packageName),
            publishName: String(pkg.publishName),
            resourceKey: isStaticRuntime
                ? `resources/editor/authoring-runtime/${pkg.publishName}`
                : `runtime/${pkg.publishName}`,
            files,
        };
    });

    return {
        schemaVersion: 1,
        source: {
            projectId: String(report.project.id),
        },
        packages,
    };
}

const report = readReport();
const isStaticRuntime = assertSafeRuntimeOutput();
if (isStaticRuntime) {
    rmSync(runtimeOutputDir, { recursive: true, force: true });
}
mkdirSync(runtimeOutputDir, { recursive: true });
copyPublishedFiles(report);
const manifest = createManifest(report, isStaticRuntime);
const manifestPath = path.join(runtimeOutputDir, "manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
    outputDir: relativePath(runtimeOutputDir),
    mode: isStaticRuntime ? "vite_static" : "portable_import_bundle",
    manifest: relativePath(manifestPath),
    packageCount: manifest.packages.length,
    fileCount: report.contracts.outputFiles.length,
}, null, 2));
