import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveAuthoringProjectPath, resolveOpenFairyGuiModuleRoot } from "../project-boundary.mjs";

const moduleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const projectPath = resolveAuthoringProjectPath(process.argv[3]);
const projectDir = path.dirname(projectPath);
const fairyPath = path.basename(projectPath);
const importFile = (filePath) => import(pathToFileURL(filePath).href);
const [core, projectIo, backend, transactions] = await Promise.all([
    importFile(path.join(moduleRoot, "core/dist/index.js")),
    importFile(path.join(moduleRoot, "core/dist/project-io.js")),
    importFile(path.join(moduleRoot, "backend/dist/index.mjs")),
    importTypeScriptModule("src/editor/commands/ResourceTransactions.ts"),
]);

const storage = new MemoryBrowserStorage();
storage.importDirectory(projectDir);
const fileSystem = backend.createBackendStorageFileSystem(storage);
const readProject = async () => core.liftDocumentToUamProject(
    await new projectIo.ProjectReader(fileSystem).read(fairyPath, {
        includeBinaryData: true,
        hydrateResourceBytes: true,
    }),
);
const baseline = await readProject();
const svgPreparation = transactions.prepareImportImageResource(
    baseline,
    { packageId: baseline.packages[0].id },
    {
        fileName: "safe.svg",
        sourceBytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12"/></svg>'),
    },
    { width: 16, height: 12 },
);
assert.equal(svgPreparation.ok, true, JSON.stringify(svgPreparation));
assert.equal(svgPreparation.transaction.operation.kind, "addResource");
assert.equal(svgPreparation.transaction.operation.resource.fileName, "safe.svg");
assert.equal(
    transactions.prepareImportImageResource(
        baseline,
        { packageId: baseline.packages[0].id },
        { fileName: "huge.svg", sourceBytes: new Uint8Array(8 * 1024 * 1024 + 1) },
        { width: 1, height: 1 },
    ).code,
    "image_source_too_large",
);
const pngImages = baseline.packages.flatMap((pkg) => pkg.resources.flatMap((resource) => (
    resource.kind === "image"
        && resource.fileName?.toLowerCase().endsWith(".png")
        && resource.sourceBytes instanceof Uint8Array
        && resource.sourceBytes.byteLength <= 8 * 1024 * 1024
        && resource.dimensions?.width > 0
        && resource.dimensions?.height > 0
        ? [{ pkg, resource }]
        : []
)));
const target = pngImages.find(({ resource }, targetIndex) => (
    resource.image?.scaleOption !== 1
    && pngImages.some(({ resource: donor }, donorIndex) => (
        donorIndex !== targetIndex
        && (donor.dimensions.width !== resource.dimensions.width
            || donor.dimensions.height !== resource.dimensions.height)
    ))
));
const donor = target && pngImages.find(({ resource }) => (
    resource.id !== target.resource.id
    && (resource.dimensions.width !== target.resource.dimensions.width
        || resource.dimensions.height !== target.resource.dimensions.height)
));
assert(target && donor, "Expected two hydrated PNG resources with different dimensions.");

const selector = { packageId: target.pkg.id, resourceId: target.resource.id };
const originalBytes = new Uint8Array(target.resource.sourceBytes);
const originalDimensions = structuredClone(target.resource.dimensions);
const originalImageProps = structuredClone(target.resource.image);
const originalMetadata = structuredClone(target.resource.metadata);
const originalFileName = target.resource.fileName;
const updateInput = {
    fileName: donor.resource.fileName,
    sourceBytes: new Uint8Array(donor.resource.sourceBytes),
    dimensions: structuredClone(donor.resource.dimensions),
};
const preparation = transactions.prepareReplaceImageSource(baseline, selector, updateInput);
assert.equal(preparation.ok, true, JSON.stringify(preparation));
assert.equal(preparation.transaction.operation.kind, "replaceResourceBytes");
assert.equal(preparation.transaction.inverseOperation.kind, "replaceResourceBytes");
assert.equal(preparation.transaction.operations, undefined, "Image update must remain one forward operation.");
assert.equal(preparation.transaction.inverseOperations, undefined, "Image update must remain one inverse operation.");
assert.deepEqual(target.resource.sourceBytes, originalBytes, "Preparation must not mutate the source project.");

assert.equal(transactions.detectImageSourceFormat(updateInput.sourceBytes), "png");
assert.deepEqual(transactions.probeImageSourceDimensions(updateInput.sourceBytes), updateInput.dimensions);
assert.equal(transactions.imageSourceFormatFromFileName("asset.PNG"), "png");
assert.equal(transactions.imageSourceFormatFromFileName("asset.JPEG"), "jpeg");
assert.equal(transactions.detectImageSourceFormat(new Uint8Array([1, 2, 3, 4])), null);

const rejected = [
    [
        "invalid_image_source_format",
        transactions.prepareReplaceImageSource(baseline, selector, {
            ...updateInput,
            sourceBytes: new Uint8Array([1, 2, 3, 4]),
        }),
    ],
    [
        "image_source_format_mismatch",
        transactions.prepareReplaceImageSource(baseline, selector, {
            fileName: "replacement.jpg",
            sourceBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
            dimensions: { width: 1, height: 1 },
        }),
    ],
    [
        "image_source_too_large",
        transactions.prepareReplaceImageSource(baseline, selector, {
            fileName: "replacement.png",
            sourceBytes: new Uint8Array(8 * 1024 * 1024 + 1),
            dimensions: { width: 1, height: 1 },
        }),
    ],
    [
        "image_source_unchanged",
        transactions.prepareReplaceImageSource(baseline, selector, {
            fileName: originalFileName,
            sourceBytes: new Uint8Array(originalBytes),
            dimensions: structuredClone(originalDimensions),
        }),
    ],
    [
        "image_source_dimension_mismatch",
        transactions.prepareReplaceImageSource(baseline, selector, {
            ...updateInput,
            dimensions: { width: updateInput.dimensions.width + 1, height: updateInput.dimensions.height },
        }),
    ],
];
for (const [code, result] of rejected) {
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
}

const withPngDimensions = (bytes, width, height) => {
    const forged = new Uint8Array(bytes);
    const view = new DataView(forged.buffer, forged.byteOffset, forged.byteLength);
    view.setUint32(16, width, false);
    view.setUint32(20, height, false);
    return forged;
};
const pixelLimitWidth = 4096;
const pixelLimitHeight = 4096;
const pixelLimitRejected = transactions.prepareReplaceImageSource(baseline, selector, {
    ...updateInput,
    sourceBytes: withPngDimensions(updateInput.sourceBytes, pixelLimitWidth, pixelLimitHeight),
    dimensions: { width: pixelLimitWidth, height: pixelLimitHeight },
});
assert.equal(pixelLimitRejected.ok, false);
assert.equal(pixelLimitRejected.code, "image_source_pixel_limit_exceeded");

const forgedWidth = updateInput.dimensions.width + 1;
const forgedDimensionRejected = transactions.prepareReplaceImageSource(baseline, selector, {
    ...updateInput,
    sourceBytes: withPngDimensions(updateInput.sourceBytes, forgedWidth, updateInput.dimensions.height),
});
assert.equal(forgedDimensionRejected.ok, false);
assert.equal(forgedDimensionRejected.code, "image_source_dimension_mismatch");
assert.deepEqual(target.resource.sourceBytes, originalBytes, "Rejected image updates must not mutate source bytes.");

const scale9Source = pngImages.find(({ resource: candidate }) => pngImages.some(({ resource: smaller }) => (
    smaller.id !== candidate.id
    && smaller.dimensions.width < candidate.dimensions.width
    && smaller.dimensions.height < candidate.dimensions.height
)));
const scale9Donor = scale9Source && pngImages.find(({ resource: candidate }) => (
    candidate.id !== scale9Source.resource.id
    && candidate.dimensions.width < scale9Source.resource.dimensions.width
    && candidate.dimensions.height < scale9Source.resource.dimensions.height
));
assert(scale9Source && scale9Donor, "Expected a hydrated PNG pair where the replacement is smaller.");
const scale9Selector = { packageId: scale9Source.pkg.id, resourceId: scale9Source.resource.id };
const scale9Input = {
    fileName: scale9Donor.resource.fileName,
    sourceBytes: new Uint8Array(scale9Donor.resource.sourceBytes),
    dimensions: structuredClone(scale9Donor.resource.dimensions),
};
const scale9Project = structuredClone(baseline);
const scale9Target = scale9Project.packages
    .find((pkg) => pkg.id === scale9Selector.packageId)
    ?.resources.find((resource) => resource.id === scale9Selector.resourceId);
assert.equal(scale9Target?.kind, "image");
scale9Target.image = {
    ...scale9Target.image,
    scaleOption: 1,
    scale9Grid: [0, 0, scale9Input.dimensions.width + 1, scale9Input.dimensions.height],
};
const scale9Rejected = transactions.prepareReplaceImageSource(scale9Project, scale9Selector, scale9Input);
assert.equal(scale9Rejected.ok, false);
assert.equal(scale9Rejected.code, "image_scale9_grid_out_of_bounds");

const validScale9Project = structuredClone(baseline);
const validScale9Target = validScale9Project.packages
    .find((pkg) => pkg.id === scale9Selector.packageId)
    ?.resources.find((resource) => resource.id === scale9Selector.resourceId);
assert.equal(validScale9Target?.kind, "image");
validScale9Target.image = {
    ...validScale9Target.image,
    scaleOption: 1,
    scale9Grid: [0, 0, scale9Input.dimensions.width, scale9Input.dimensions.height],
};
const scale9Accepted = transactions.prepareReplaceImageSource(validScale9Project, scale9Selector, scale9Input);
assert.equal(scale9Accepted.ok, true, JSON.stringify(scale9Accepted));
const scale9Projected = await core.applyUamTransactionAsync(
    structuredClone(validScale9Project),
    [scale9Accepted.transaction.operation],
);
const scale9ProjectedTarget = scale9Projected.packages
    .find((pkg) => pkg.id === scale9Selector.packageId)
    ?.resources.find((resource) => resource.id === scale9Selector.resourceId);
assert.deepEqual(scale9ProjectedTarget?.dimensions, scale9Input.dimensions);
assert.deepEqual(scale9ProjectedTarget?.image?.scale9Grid, validScale9Target.image.scale9Grid);
const scale9Restored = await core.applyUamTransactionAsync(
    scale9Projected,
    [scale9Accepted.transaction.inverseOperation],
);
const scale9RestoredTarget = scale9Restored.packages
    .find((pkg) => pkg.id === scale9Selector.packageId)
    ?.resources.find((resource) => resource.id === scale9Selector.resourceId);
assert.deepEqual(scale9RestoredTarget?.dimensions, validScale9Target.dimensions);
assert.deepEqual(scale9RestoredTarget?.sourceBytes, validScale9Target.sourceBytes);

const jpegImages = baseline.packages.flatMap((pkg) => pkg.resources.flatMap((resource) => (
    resource.kind === "image"
        && resource.sourceBytes instanceof Uint8Array
        && transactions.detectImageSourceFormat(resource.sourceBytes) === "jpeg"
        ? [{ pkg, resource }]
        : []
)));
const jpegTarget = jpegImages.find(({ resource }, targetIndex) => jpegImages.some(({ resource: candidate }, candidateIndex) => (
    candidateIndex !== targetIndex
    && (candidate.dimensions.width !== resource.dimensions.width
        || candidate.dimensions.height !== resource.dimensions.height)
)));
const jpegDonor = jpegTarget && jpegImages.find(({ resource }) => (
    resource.id !== jpegTarget.resource.id
    && (resource.dimensions.width !== jpegTarget.resource.dimensions.width
        || resource.dimensions.height !== jpegTarget.resource.dimensions.height)
));
assert(jpegTarget && jpegDonor, "Expected two hydrated JPEG resources with different dimensions.");
const jpegSelector = { packageId: jpegTarget.pkg.id, resourceId: jpegTarget.resource.id };
const jpegPreparation = transactions.prepareReplaceImageSource(baseline, jpegSelector, {
    fileName: jpegDonor.resource.fileName,
    sourceBytes: new Uint8Array(jpegDonor.resource.sourceBytes),
    dimensions: structuredClone(jpegDonor.resource.dimensions),
});
assert.equal(jpegPreparation.ok, true, JSON.stringify(jpegPreparation));
const jpegProjected = await core.applyUamTransactionAsync(
    structuredClone(baseline),
    [jpegPreparation.transaction.operation],
);
const jpegRestored = await core.applyUamTransactionAsync(
    jpegProjected,
    [jpegPreparation.transaction.inverseOperation],
);
const jpegRestoredTarget = jpegRestored.packages
    .find((pkg) => pkg.id === jpegSelector.packageId)
    ?.resources.find((resource) => resource.id === jpegSelector.resourceId);
assert.deepEqual(jpegRestoredTarget?.dimensions, jpegTarget.resource.dimensions);
assert.deepEqual(jpegRestoredTarget?.sourceBytes, jpegTarget.resource.sourceBytes);

const transparent = new Uint8ClampedArray(3 * 3 * 4);
assert.deepEqual(transactions.findOpaqueBounds(transparent, 3, 3), { x: 0, y: 0, width: 0, height: 0 });
transparent[(1 * 3 + 1) * 4 + 3] = 255;
assert.deepEqual(transactions.findOpaqueBounds(transparent, 3, 3), { x: 1, y: 1, width: 1, height: 1 });
const opaque = new Uint8ClampedArray(2 * 2 * 4);
for (let index = 3; index < opaque.length; index += 4) opaque[index] = 255;
assert.deepEqual(transactions.findOpaqueBounds(opaque, 2, 2), { x: 0, y: 0, width: 2, height: 2 });

const runtime = new backend.BackendRuntime();
const opened = runtime.openProjectSession({
    project: structuredClone(baseline),
    storage: {
        fileSystem,
        fairyPath,
        canonicalProjectPath: "opfs://image-source-update",
        canonicalPathKey: "opfs://image-source-update",
    },
});
assert.equal(opened.ok, true, JSON.stringify(opened));
const applied = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: opened.data.revision,
    operations: [preparation.transaction.operation],
});
assert.equal(applied.ok, true, JSON.stringify(applied));
const saved = await runtime.saveSession({
    sessionId: opened.data.sessionId,
    expectedRevision: applied.data.revision,
});
assert.equal(saved.ok, true, JSON.stringify(saved));
const updated = await readProject();
const updatedImage = updated.packages
    .find((pkg) => pkg.id === selector.packageId)
    ?.resources.find((resource) => resource.id === selector.resourceId);
assert.equal(updatedImage?.kind, "image");
assert.deepEqual(updatedImage.sourceBytes, updateInput.sourceBytes);
assert.deepEqual(updatedImage.dimensions, updateInput.dimensions);
assert.deepEqual(updatedImage.image, originalImageProps);
assert.deepEqual(updatedImage.metadata, originalMetadata);
assert.equal(updatedImage.fileName, originalFileName);

const undone = await runtime.applyTransaction({
    sessionId: opened.data.sessionId,
    expectedRevision: saved.data.revision,
    operations: [preparation.transaction.inverseOperation],
});
assert.equal(undone.ok, true, JSON.stringify(undone));
const undoSaved = await runtime.saveSession({
    sessionId: opened.data.sessionId,
    expectedRevision: undone.data.revision,
});
assert.equal(undoSaved.ok, true, JSON.stringify(undoSaved));
const restored = await readProject();
const restoredImage = restored.packages
    .find((pkg) => pkg.id === selector.packageId)
    ?.resources.find((resource) => resource.id === selector.resourceId);
assert.equal(restoredImage?.kind, "image");
assert.deepEqual(restoredImage.sourceBytes, originalBytes);
assert.deepEqual(restoredImage.dimensions, originalDimensions);
assert.deepEqual(restoredImage.image, originalImageProps);
assert.deepEqual(restoredImage.metadata, originalMetadata);
assert.equal(restoredImage.fileName, originalFileName);

const dialogSource = readFileSync("src/editor/dialogs/ResourceEditors.ts", "utf8");
for (const snippet of [
    "prepareSafeSvgImage",
    'new DOMParser().parseFromString(source, "image/svg+xml")',
    "SVG references must be local fragments or embedded raster images.",
    '"image-source-update"',
    'createImageBitmap(replacementBlob, { imageOrientation: "none" })',
    "probeImageSourceDimensions(replacementBytes)",
    "MAX_BROWSER_IMAGE_SOURCE_PIXELS",
    "Apply image properties before changing source bytes.",
    "Image operation is still running; wait for it to finish before closing.",
    "scaleController.selectedIndex === 0",
    "if (disposed) return;",
    "findOpaqueBounds(",
    "the PNG is fully transparent",
    "transparent edge bounds are unchanged",
    "await encodeCanvasPng(cropped",
    "disableTrim.enabled = false",
]) {
    assert(dialogSource.includes(snippet), `Missing Image dialog behavior: ${snippet}`);
}
assert(
    dialogSource.indexOf("probeImageSourceDimensions(replacementBytes)")
        < dialogSource.indexOf("createImageBitmap(replacementBlob"),
    "Image header dimensions and pixel limits must be checked before decoding.",
);
assert(
    dialogSource.match(/if \(disposed\) return;/g)?.length >= 8,
    "Image dialog async paths must re-check the UNDISPLAY disposal token after each await.",
);
const resourceMenuSource = readFileSync("src/editor/ui/ResourceAuthoringController.ts", "utf8");
assert(
    resourceMenuSource.includes('if (selectedResource.type === "ImageResource")')
        && resourceMenuSource.includes('} else if (selectedResource.type === "MovieClipResource")')
        && resourceMenuSource.indexOf('"desktopMenuEditImageResource"')
            < resourceMenuSource.indexOf('"desktopMenuReplaceAssetResource"'),
    "Image resources must not expose the generic Replace Asset Bytes action.",
);
const adapterSource = readFileSync("src/editor/commands/EditorCommandAdapter.ts", "utf8");
assert(
    adapterSource.includes('operation.kind === "replaceResourceBytes"')
        && adapterSource.includes("byteReplacementInverse"),
    "Byte replacement must pass its inverse through shared live-session preflight.",
);
const bridgeSource = readFileSync("src/editor/services/BrowserLiveSessionBridge.ts", "utf8");
assert(
    bridgeSource.includes("projectedInverseOperations")
        && bridgeSource.includes("cloneJson(projectedProject)"),
    "The live bridge must project byte replacement inverse before backend apply.",
);

console.log(JSON.stringify({
    ok: true,
    target: `${target.pkg.name}/${target.resource.name}`,
    originalDimensions,
    updatedDimensions: updateInput.dimensions,
    forwardOperations: 1,
    inverseOperations: 1,
    pixelLimitRejected: true,
    forgedDimensionRejected: true,
    scale9Accepted: true,
    jpegRoundTrip: true,
    sourceRestored: true,
}));
