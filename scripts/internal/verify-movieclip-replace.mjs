import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveAuthoringProjectPath, resolveOpenFairyGuiModuleRoot } from "../project-boundary.mjs";

const moduleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const projectPath = resolveAuthoringProjectPath(process.argv[3]);
assert.equal(
    JSON.parse(readFileSync(path.join(moduleRoot, "core/package.json"), "utf8")).version,
    "0.2.4",
);
const [core, projectIo, backend, movieClipTransactions] = await Promise.all([
    import(pathToFileURL(path.join(moduleRoot, "core/dist/index.js")).href),
    import(pathToFileURL(path.join(moduleRoot, "core/dist/project-io.js")).href),
    import(pathToFileURL(path.join(moduleRoot, "backend/dist/index.mjs")).href),
    importTypeScriptModule("src/editor/commands/MovieClipTransactions.ts"),
]);
const { applyUamTransaction } = core;
const {
    parseMovieClipJta,
    prepareImportMovieClipResource,
    prepareReplaceMovieClipResource,
    prepareReplaceMovieClipSpriteSheetResource,
    prepareUpdateMovieClipResource,
    probeImageSourceDimensions,
} = await importTypeScriptModule("src/editor/commands/HighRiskAuthoringTransactions.ts");
const {
    MAX_MOVIECLIP_FRAME_COUNT,
    MAX_MOVIECLIP_IMAGE_SOURCE_BYTES,
    MAX_MOVIECLIP_TOTAL_SOURCE_BYTES,
} = movieClipTransactions;
const resourceEditorSource = readFileSync("src/editor/dialogs/ResourceEditors.ts", "utf8");
assert.ok(resourceEditorSource.includes('content.getChild("btnImport").asButton.onClick'));
assert.ok(resourceEditorSource.includes('content.getChild("btnImport2").asButton.onClick'));
assert.ok(resourceEditorSource.includes('content.getChild("btnExport").visible = true'));
assert.ok(resourceEditorSource.includes('content.getChild("n88").visible = true'));
assert.ok(resourceEditorSource.includes("window.confirm("));
assert.ok(resourceEditorSource.includes("showMovieClipEditor(options);"));
assert.ok(resourceEditorSource.includes("let replacementBusy = false;"));
assert.ok(resourceEditorSource.includes('".png,.jpg,.jpeg,image/png,image/jpeg"'));
assert.ok(resourceEditorSource.includes("if (replacementBusy)"));
assert.ok(resourceEditorSource.includes("MAX_MOVIECLIP_DESCRIPTOR_BYTES"));
assert.ok(resourceEditorSource.includes("MAX_MOVIECLIP_TOTAL_DECODED_PIXELS - totalDecodedPixels"));
assert.ok(resourceEditorSource.includes("throwIfMovieClipPreparationCancelled(isCancelled);"));
assert.ok(
    (resourceEditorSource.match(/if \(cleaned\) return;/g) || []).length >= 12,
    "MovieClip async paths must re-check the disposed token after awaited work.",
);

function runNode(scriptPath, args, cwd) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [scriptPath, ...args], { cwd, windowsHide: true });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
        child.on("error", (error) => resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` }));
        child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
    });
}

function materializeStorage(storage, outputDir) {
    for (const [relativePath, bytes] of storage.files) {
        if (relativePath.endsWith(".openfairygui.backend.lock")) continue;
        const outputPath = path.join(outputDir, ...relativePath.split("/"));
        mkdirSync(path.dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, bytes);
    }
}

function listFiles(rootDir) {
    const result = [];
    const walk = (directory) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(absolutePath);
            else if (entry.isFile() && statSync(absolutePath).size > 0) result.push(absolutePath);
        }
    };
    walk(rootDir);
    return result;
}

const sample = parseMovieClipJta(new Uint8Array(
    readFileSync(path.join(path.dirname(projectPath), "assets/Bag/images/quan.jta")),
));
assert.ok(sample.frames.length >= 2);
assert.ok(sample.textures.length >= 2);
const sampleFrames = sample.frames.filter((frame) => frame.textureIndex >= 0).slice(0, 2);
assert.equal(sampleFrames.length, 2);

const frameInput = (name, frame, texture) => ({
    fileName: name,
    sourceBytes: texture,
    dimensions: { width: frame.rectWidth, height: frame.rectHeight },
});
const transactionFixture = { packages: [{ id: "pkg", name: "Pkg", resources: [] }] };
const jpegBytes = new Uint8Array(readFileSync(path.join(path.dirname(projectPath), "assets/PullToRefresh/logo.jpg")));
const jpegDimensions = probeImageSourceDimensions(jpegBytes);
assert.ok(jpegDimensions);
const jpegAccepted = prepareImportMovieClipResource(transactionFixture, { packageId: "pkg" }, [{
    fileName: "frame.jpg",
    sourceBytes: jpegBytes,
    dimensions: jpegDimensions,
}]);
assert.equal(jpegAccepted.ok, true, JSON.stringify(jpegAccepted));

const tooManyFrames = Array.from({ length: MAX_MOVIECLIP_FRAME_COUNT + 1 }, (_, index) => (
    frameInput(`frame${index}.png`, sampleFrames[0], sample.textures[sampleFrames[0].textureIndex])
));
const frameCountRejected = prepareImportMovieClipResource(transactionFixture, { packageId: "pkg" }, tooManyFrames);
assert.equal(frameCountRejected.ok, false);
assert.equal(frameCountRejected.code, "invalid_movieclip_frame_count");

const oversizedPng = new Uint8Array(MAX_MOVIECLIP_IMAGE_SOURCE_BYTES + 1);
oversizedPng.set(sample.textures[sampleFrames[0].textureIndex]);
const sourceSizeRejected = prepareImportMovieClipResource(transactionFixture, { packageId: "pkg" }, [
    frameInput("oversized.png", sampleFrames[0], oversizedPng),
]);
assert.equal(sourceSizeRejected.ok, false);
assert.equal(sourceSizeRejected.code, "movieclip_frame_too_large");

const withPngDimensions = (sourceBytes, width, height) => {
    const bytes = new Uint8Array(sourceBytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(16, width, false);
    view.setUint32(20, height, false);
    return bytes;
};
const pixelHeavyPng = withPngDimensions(sample.textures[sampleFrames[0].textureIndex], 2048, 2048);
const totalPixelRejected = prepareImportMovieClipResource(
    transactionFixture,
    { packageId: "pkg" },
    Array.from({ length: 17 }, (_, index) => ({
        fileName: `pixel${index}.png`,
        sourceBytes: pixelHeavyPng,
        dimensions: { width: 2048, height: 2048 },
    })),
);
assert.equal(totalPixelRejected.ok, false);
assert.equal(totalPixelRejected.code, "movieclip_total_pixels_exceeded");

const budgetPng = new Uint8Array(MAX_MOVIECLIP_IMAGE_SOURCE_BYTES);
budgetPng.set(sample.textures[sampleFrames[0].textureIndex]);
const totalSourceRejected = prepareImportMovieClipResource(
    transactionFixture,
    { packageId: "pkg" },
    Array.from({ length: 9 }, (_, index) => frameInput(`source${index}.png`, sampleFrames[0], budgetPng)),
);
assert.equal(totalSourceRejected.ok, false);
assert.equal(totalSourceRejected.code, "movieclip_total_source_too_large");
assert.equal(MAX_MOVIECLIP_TOTAL_SOURCE_BYTES, 8 * MAX_MOVIECLIP_IMAGE_SOURCE_BYTES);
const jtaSizeRejected = prepareImportMovieClipResource(
    transactionFixture,
    { packageId: "pkg" },
    Array.from({ length: 8 }, (_, index) => frameInput(`jta${index}.png`, sampleFrames[0], budgetPng)),
);
assert.equal(jtaSizeRejected.ok, false);
assert.equal(jtaSizeRejected.code, "movieclip_jta_too_large");

const naturalOrderPreparation = prepareImportMovieClipResource(transactionFixture, { packageId: "pkg" }, [
    frameInput("pulse10.png", sampleFrames[0], sample.textures[sampleFrames[0].textureIndex]),
    frameInput("pulse2.png", sampleFrames[1], sample.textures[sampleFrames[1].textureIndex]),
]);
assert.equal(naturalOrderPreparation.ok, true, JSON.stringify(naturalOrderPreparation));
if (!naturalOrderPreparation.ok || naturalOrderPreparation.transaction.operation.kind !== "addResource") {
    throw new Error("Natural-order MovieClip preparation failed.");
}
const naturalOrderJta = parseMovieClipJta(naturalOrderPreparation.transaction.operation.resource.sourceBytes);
assert.deepEqual(naturalOrderJta.textures[0], sample.textures[sampleFrames[1].textureIndex]);
assert.deepEqual(naturalOrderJta.textures[1], sample.textures[sampleFrames[0].textureIndex]);

const baseline = JSON.parse(
    readFileSync("assets/resources/editor/runtime/uam-baseline.json", "utf8"),
).uamProject;
const project = {
    ...baseline,
    packages: [{ ...baseline.packages[0], id: "pkg", name: "Pkg", resources: [] }],
};
const imported = prepareImportMovieClipResource(project, { packageId: "pkg" }, [
    frameInput("base1.png", sampleFrames[0], sample.textures[sampleFrames[0].textureIndex]),
    frameInput("base2.png", sampleFrames[1], sample.textures[sampleFrames[1].textureIndex]),
]);
assert.equal(imported.ok, true);
if (!imported.ok || imported.transaction.operation.kind !== "addResource") throw new Error("MovieClip import failed.");
const resourceId = imported.transaction.operation.resource.id;
const withResource = applyUamTransaction(project, [imported.transaction.operation]);
const timing = {
    fps: 30,
    speed: 2,
    repeatDelay: 4,
    swing: true,
    smoothing: false,
    frameDelays: [5, 7],
};
const timingPreparation = prepareUpdateMovieClipResource(
    withResource,
    { packageId: "pkg", resourceId },
    timing,
);
assert.equal(timingPreparation.ok, true);
if (!timingPreparation.ok) throw new Error(timingPreparation.message);
const timed = applyUamTransaction(
    withResource,
    timingPreparation.transaction.operations || [timingPreparation.transaction.operation],
);
const timedResource = timed.packages[0].resources[0];

const sequenceReplacement = prepareReplaceMovieClipResource(
    timed,
    { packageId: "pkg", resourceId },
    [
        frameInput("replace1.png", sampleFrames[0], sample.textures[sampleFrames[0].textureIndex]),
        frameInput("replace2.png", sampleFrames[1], sample.textures[sampleFrames[1].textureIndex]),
        frameInput("replace3.png", sampleFrames[0], sample.textures[sampleFrames[0].textureIndex]),
    ],
    timing,
);
assert.equal(sequenceReplacement.ok, true);
if (!sequenceReplacement.ok) throw new Error(sequenceReplacement.message);
assert.equal(sequenceReplacement.transaction.operation.kind, "replaceResourceBytes");
assert.equal(sequenceReplacement.transaction.inverseOperation.kind, "replaceResourceBytes");
assert.equal(sequenceReplacement.transaction.operations, undefined);
const sequenceProject = applyUamTransaction(timed, [sequenceReplacement.transaction.operation]);
const sequenceResource = sequenceProject.packages[0].resources[0];
const sequenceJta = parseMovieClipJta(sequenceResource.sourceBytes);
assert.deepEqual(
    [sequenceJta.fps, sequenceJta.speed, sequenceJta.repeatDelay, sequenceJta.swing],
    [30, 2, 4, true],
);
assert.deepEqual(sequenceJta.frames.map((frame) => frame.delay), [5, 7, 0]);
assert.deepEqual(sequenceResource.dimensions, {
    width: sequenceJta.boundsWidth,
    height: sequenceJta.boundsHeight,
});
const sequenceUndone = applyUamTransaction(sequenceProject, [sequenceReplacement.transaction.inverseOperation]);
assert.deepEqual(sequenceUndone.packages[0].resources[0].sourceBytes, timedResource.sourceBytes);

const spriteReplacement = prepareReplaceMovieClipSpriteSheetResource(
    timed,
    { packageId: "pkg", resourceId },
    "replace.json",
    [{
        name: "sprite1.png",
        textureKey: "sprite1",
        sourceBytes: sample.textures[sampleFrames[0].textureIndex],
        rect: {
            x: -2,
            y: 1,
            width: sampleFrames[0].rectWidth,
            height: sampleFrames[0].rectHeight,
        },
    }],
    timing,
);
assert.equal(spriteReplacement.ok, true);
if (!spriteReplacement.ok) throw new Error(spriteReplacement.message);
assert.equal(spriteReplacement.transaction.operation.kind, "replaceResourceBytes");
assert.equal(spriteReplacement.transaction.inverseOperation.kind, "replaceResourceBytes");
assert.equal(spriteReplacement.transaction.operations, undefined);
const spriteProject = applyUamTransaction(timed, [spriteReplacement.transaction.operation]);
const spriteResource = spriteProject.packages[0].resources[0];
const spriteJta = parseMovieClipJta(spriteResource.sourceBytes);
assert.deepEqual(
    [spriteJta.fps, spriteJta.speed, spriteJta.repeatDelay, spriteJta.swing],
    [30, 2, 4, true],
);
assert.deepEqual(spriteJta.frames.map((frame) => frame.delay), [5]);
assert.deepEqual(spriteResource.dimensions, {
    width: spriteJta.boundsWidth,
    height: spriteJta.boundsHeight,
});
const spriteUndone = applyUamTransaction(spriteProject, [spriteReplacement.transaction.inverseOperation]);
assert.deepEqual(spriteUndone.packages[0].resources[0].sourceBytes, timedResource.sourceBytes);

const spriteJpegRejected = prepareReplaceMovieClipSpriteSheetResource(
    timed,
    { packageId: "pkg", resourceId },
    "replace.json",
    [{
        name: "sprite1.jpg",
        textureKey: "sprite1",
        sourceBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        rect: { x: 0, y: 0, width: 1, height: 1 },
    }],
    timing,
);
assert.equal(spriteJpegRejected.ok, false);
assert.equal(spriteJpegRejected.code, "invalid_movieclip_frame_png");

const storage = new MemoryBrowserStorage();
storage.importDirectory(path.dirname(projectPath));
const fileSystem = backend.createBackendStorageFileSystem(storage);
const fairyPath = path.basename(projectPath);
const readStoredProject = async () => core.liftDocumentToUamProject(
    await new projectIo.ProjectReader(fileSystem).read(fairyPath, {
        includeBinaryData: true,
        hydrateResourceBytes: true,
    }),
);
const storedBaseline = await readStoredProject();
const persistedTarget = storedBaseline.packages
    .flatMap((pkg) => pkg.resources.map((resource) => ({ pkg, resource })))
    .find(({ resource: candidate }) => {
        if (candidate.kind !== "movieClip" || !(candidate.sourceBytes instanceof Uint8Array)) return false;
        try {
            const parsed = parseMovieClipJta(candidate.sourceBytes);
            return parsed.frames.filter((frame) => frame.textureIndex >= 0).length >= 2
                && parsed.textures.every((texture) => (
                    texture.byteLength === 0 || movieClipTransactions.probeMovieClipPngDimensions(texture)
                ));
        } catch {
            return false;
        }
    });
assert(persistedTarget, "Expected a hydrated PNG-backed MovieClip in the authoring sample.");
const persistedSelector = {
    packageId: persistedTarget.pkg.id,
    resourceId: persistedTarget.resource.id,
};
const originalPersistedBytes = new Uint8Array(persistedTarget.resource.sourceBytes);
const originalPersistedJta = parseMovieClipJta(originalPersistedBytes);
const persistedSourceFrames = originalPersistedJta.frames
    .filter((frame) => frame.textureIndex >= 0)
    .slice(0, 2);
const persistedTiming = {
    fps: originalPersistedJta.fps === 30 ? 31 : 30,
    speed: originalPersistedJta.speed,
    repeatDelay: originalPersistedJta.repeatDelay,
    swing: !originalPersistedJta.swing,
    smoothing: !(persistedTarget.resource.movieClip?.smoothing ?? true),
    frameDelays: originalPersistedJta.frames.map((frame) => frame.delay),
};
const persistedPreparation = prepareReplaceMovieClipResource(
    storedBaseline,
    persistedSelector,
    persistedSourceFrames.map((frame, index) => frameInput(
        `persisted${index + 1}.png`,
        frame,
        originalPersistedJta.textures[frame.textureIndex],
    )),
    persistedTiming,
);
assert.equal(persistedPreparation.ok, true, JSON.stringify(persistedPreparation));
if (!persistedPreparation.ok) throw new Error(persistedPreparation.message);

const runtime = new backend.BackendRuntime();
const opened = runtime.openProjectSession({
    project: structuredClone(storedBaseline),
    storage: {
        fileSystem,
        fairyPath,
        canonicalProjectPath: "opfs://movieclip-replace",
        canonicalPathKey: "opfs://movieclip-replace",
    },
});
assert.equal(opened.ok, true, JSON.stringify(opened));
const persistedApplied = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: opened.data.revision,
    operations: persistedPreparation.transaction.operations || [persistedPreparation.transaction.operation],
});
assert.equal(persistedApplied.ok, true, JSON.stringify(persistedApplied));
const persistedSaved = await runtime.saveSession({
    sessionId: opened.data.sessionId,
    expectedRevision: persistedApplied.data.revision,
});
assert.equal(persistedSaved.ok, true, JSON.stringify(persistedSaved));
const storedUpdated = await readStoredProject();
const storedUpdatedResource = storedUpdated.packages
    .find((pkg) => pkg.id === persistedSelector.packageId)
    ?.resources.find((candidate) => candidate.id === persistedSelector.resourceId);
assert.equal(storedUpdatedResource?.kind, "movieClip");
assert(storedUpdatedResource?.sourceBytes instanceof Uint8Array);
const storedUpdatedJta = parseMovieClipJta(storedUpdatedResource.sourceBytes);
assert.deepEqual(
    [storedUpdatedJta.fps, storedUpdatedJta.speed, storedUpdatedJta.repeatDelay, storedUpdatedJta.swing],
    [persistedTiming.fps, persistedTiming.speed, persistedTiming.repeatDelay, persistedTiming.swing],
    "Storage Save/ProjectReader reload must preserve MovieClip timing.",
);
assert.equal(storedUpdatedResource.movieClip.smoothing, persistedTiming.smoothing);
assert.equal(storedUpdatedResource.movieClip.frames.length, storedUpdatedJta.frames.length);
assert.deepEqual(
    storedUpdatedJta.frames.map((frame) => frame.delay),
    persistedTiming.frameDelays.slice(0, persistedSourceFrames.length),
);
assert(storedUpdatedJta.textures.every((texture) => movieClipTransactions.probeMovieClipPngDimensions(texture)));

mkdirSync(path.resolve(".tmp"), { recursive: true });
const publishFixtureRoot = mkdtempSync(path.resolve(".tmp/movieclip-replace-"));
let publishedFiles = [];
try {
    materializeStorage(storage, publishFixtureRoot);
    const publishOutput = path.join(publishFixtureRoot, "published");
    const cliEntry = path.join(moduleRoot, "cli/bin/cli.cjs");
    const publish = await runNode(cliEntry, [
        "publish",
        publishFixtureRoot,
        "--output",
        publishOutput,
        "--project-type",
        "layabox",
    ], process.cwd());
    assert.equal(publish.exitCode, 0, `MovieClip publish failed:\n${publish.stderr}\n${publish.stdout}`);
    publishedFiles = listFiles(publishOutput);
    assert(publishedFiles.some((filePath) => /\.fui$/i.test(filePath)), "Publish must emit a FairyGUI package descriptor.");
    assert(publishedFiles.some((filePath) => /_atlas.*\.png$/i.test(filePath)), "Publish must emit a PNG atlas containing MovieClip frames.");
} finally {
    rmSync(publishFixtureRoot, { recursive: true, force: true });
}

const persistedUndone = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: persistedSaved.data.revision,
    operations: persistedPreparation.transaction.inverseOperations || [persistedPreparation.transaction.inverseOperation],
});
assert.equal(persistedUndone.ok, true, JSON.stringify(persistedUndone));
const persistedUndoSaved = await runtime.saveSession({
    sessionId: opened.data.sessionId,
    expectedRevision: persistedUndone.data.revision,
});
assert.equal(persistedUndoSaved.ok, true, JSON.stringify(persistedUndoSaved));
const storedRestored = await readStoredProject();
const storedRestoredResource = storedRestored.packages
    .find((pkg) => pkg.id === persistedSelector.packageId)
    ?.resources.find((candidate) => candidate.id === persistedSelector.resourceId);
assert(storedRestoredResource?.sourceBytes instanceof Uint8Array);
assert.deepEqual(storedRestoredResource.sourceBytes, originalPersistedBytes);

console.log(JSON.stringify({
    ok: true,
    backendVersion: "0.2.4",
    sequence: { frames: sequenceJta.frames.length, delays: sequenceJta.frames.map((frame) => frame.delay) },
    spriteSheet: { frames: spriteJta.frames.length, delays: spriteJta.frames.map((frame) => frame.delay) },
    timing: { fps: spriteJta.fps, speed: spriteJta.speed, repeatDelay: spriteJta.repeatDelay, swing: spriteJta.swing },
    inverseRestored: true,
    budgets: {
        frameCount: MAX_MOVIECLIP_FRAME_COUNT,
        perImageBytes: MAX_MOVIECLIP_IMAGE_SOURCE_BYTES,
        totalSourceBytes: MAX_MOVIECLIP_TOTAL_SOURCE_BYTES,
        jpegAccepted: true,
    },
    storageRoundTrip: {
        target: `${persistedTarget.pkg.name}/${persistedTarget.resource.name}`,
        savedFrames: storedUpdatedJta.frames.length,
        inverseRestored: true,
        typedModelPersisted: true,
    },
    publish: { pngJta: true, outputFiles: publishedFiles.length },
}));
