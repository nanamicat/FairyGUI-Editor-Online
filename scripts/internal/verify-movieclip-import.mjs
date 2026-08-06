import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyUamTransaction } from "../../assets/resources/editor/runtime/openfairygui-backend-browser.js";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveAuthoringProjectPath, resolveOpenFairyGuiModuleRoot } from "../project-boundary.mjs";

const moduleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
assert.equal(
    JSON.parse(readFileSync(path.join(moduleRoot, "core/package.json"), "utf8")).version,
    "0.2.4",
);
const { parseJta } = await import(pathToFileURL(path.join(moduleRoot, "core/dist/index.js")).href);

const {
    findOpaqueBounds,
    parseMovieClipJta,
    parseMovieClipSpriteSheetDescriptor,
    prepareImportMovieClipResource,
    prepareImportMovieClipSpriteSheetResource,
    prepareRemoveAssetResource,
    prepareUpdateMovieClipResource,
} = await importTypeScriptModule("src/editor/commands/HighRiskAuthoringTransactions.ts");
const { createTransactionSaveTarget } = await importTypeScriptModule(
    "src/editor/services/BrowserLiveSessionBridge.ts",
);

const sample = parseJta(new Uint8Array(
    readFileSync(path.join(path.dirname(resolveAuthoringProjectPath()), "assets/Bag/images/quan.jta")),
));
assert.ok(sample.textures.length >= 2);
const firstFrame = sample.frames.find((frame) => frame.textureIndex === 0);
const secondFrame = sample.frames.find((frame) => frame.textureIndex === 1);
assert.ok(firstFrame);
assert.ok(secondFrame);

const rgba = new Uint8ClampedArray(4 * 3 * 4);
rgba[(1 * 4 + 1) * 4 + 3] = 1;
rgba[(1 * 4 + 2) * 4 + 3] = 255;
assert.deepEqual(findOpaqueBounds(rgba, 4, 3), { x: 1, y: 1, width: 2, height: 1 });
assert.deepEqual(findOpaqueBounds(new Uint8ClampedArray(16), 2, 2), { x: 0, y: 0, width: 0, height: 0 });

const project = { packages: [{ id: "pkg", resources: [] }] };
const prepared = prepareImportMovieClipResource(project, { packageId: "pkg" }, [
    {
        fileName: "pulse10.png",
        sourceBytes: sample.textures[0].raw,
        dimensions: { width: firstFrame.rectWidth + 4, height: firstFrame.rectHeight + 6 },
        crop: { x: 2, y: 3, width: firstFrame.rectWidth, height: firstFrame.rectHeight },
    },
    {
        fileName: "pulse2.png",
        sourceBytes: sample.textures[1].raw,
        dimensions: { width: secondFrame.rectWidth, height: secondFrame.rectHeight },
    },
]);
assert.equal(prepared.ok, true);
if (!prepared.ok) throw new Error(prepared.message);
assert.equal(prepared.transaction.operation.kind, "addResource");
if (prepared.transaction.operation.kind !== "addResource") throw new Error("Expected addResource.");

const resource = prepared.transaction.operation.resource;
const encoded = parseJta(resource.sourceBytes);
const locallyParsed = parseMovieClipJta(resource.sourceBytes);
assert.equal(locallyParsed.fps, encoded.fps);
assert.deepEqual(locallyParsed.frames, encoded.frames);
assert.deepEqual(locallyParsed.textures, encoded.textures.map((texture) => texture.raw));
assert.equal(resource.kind, "movieClip");
assert.equal(resource.fileName, "pulse2.jta");
assert.deepEqual(resource.dimensions, {
    width: locallyParsed.boundsWidth,
    height: locallyParsed.boundsHeight,
});
assert.equal(resource.movieClip.smoothing, true);
assert.equal(resource.movieClip.frames.length, 2);
assert.equal(encoded.version, 102);
assert.equal(encoded.fps, 24);
assert.equal(encoded.speed, 1);
assert.equal(encoded.frames.length, 2);
assert.equal(encoded.textures.length, 2);
assert.deepEqual(encoded.textures[0].raw, sample.textures[1].raw);
assert.deepEqual(encoded.textures[1].raw, sample.textures[0].raw);
assert.equal(encoded.boundsWidth, Math.max(firstFrame.rectWidth + 4, secondFrame.rectWidth));
assert.equal(encoded.boundsHeight, Math.max(firstFrame.rectHeight + 6, secondFrame.rectHeight));
assert.equal(encoded.frames[1].rectWidth, firstFrame.rectWidth);
assert.equal(encoded.frames[1].rectHeight, firstFrame.rectHeight);

const gifPrepared = prepareImportMovieClipResource(project, { packageId: "pkg" }, [
    {
        fileName: "pulse-1.png",
        sourceBytes: sample.textures[0].raw,
        dimensions: { width: firstFrame.rectWidth, height: firstFrame.rectHeight },
        delay: 4,
    },
    {
        fileName: "pulse-2.png",
        sourceBytes: sample.textures[1].raw,
        dimensions: { width: secondFrame.rectWidth, height: secondFrame.rectHeight },
        delay: 9,
    },
], "pulse.gif", 100);
assert.equal(gifPrepared.ok, true);
if (!gifPrepared.ok || gifPrepared.transaction.operation.kind !== "addResource") throw new Error("Expected GIF MovieClip addResource.");
const gifJta = parseMovieClipJta(gifPrepared.transaction.operation.resource.sourceBytes);
assert.equal(gifPrepared.transaction.operation.resource.fileName, "pulse.jta");
assert.equal(gifJta.fps, 100);
assert.deepEqual(gifJta.frames.map((frame) => frame.delay), [4, 9]);

const baseline = JSON.parse(
    readFileSync("assets/resources/editor/runtime/uam-baseline.json", "utf8"),
).uamProject;
const projectionProject = {
    ...baseline,
    packages: [{ ...baseline.packages[0], id: "pkg", name: "Pkg", resources: [] }],
};
const imported = applyUamTransaction(projectionProject, [prepared.transaction.operation]);
const importedResource = imported.packages[0].resources[0];
assert.equal(parseJta(importedResource.sourceBytes).frames.length, 2);
const saveTarget = createTransactionSaveTarget(imported, [prepared.transaction.operation]);
assert.equal(saveTarget.kind, "transaction");
assert.equal(saveTarget.expected.value.index, 0);
assert.equal(saveTarget.expected.value.resource.sourceBytes.byteLength, resource.sourceBytes.byteLength);

const timing = prepareUpdateMovieClipResource(imported, {
    packageId: "pkg",
    resourceId: resource.id,
}, {
    fps: 30,
    speed: 2,
    repeatDelay: 4,
    swing: true,
    smoothing: false,
    frameDelays: [1, 7],
});
assert.equal(timing.ok, true);
if (!timing.ok) throw new Error(timing.message);
const timedOperations = timing.transaction.operations || [timing.transaction.operation];
const timed = applyUamTransaction(imported, timedOperations);
const timedResource = timed.packages[0].resources[0];
const timedJta = parseMovieClipJta(timedResource.sourceBytes);
assert.equal(timedJta.fps, 30);
assert.equal(timedJta.speed, 2);
assert.equal(timedJta.repeatDelay, 4);
assert.equal(timedJta.swing, true);
assert.deepEqual(timedJta.frames.map((frame) => frame.delay), [1, 7]);
assert.deepEqual(timedJta.textures, encoded.textures.map((texture) => texture.raw));
assert.deepEqual(
    applyUamTransaction(timed, timing.transaction.inverseOperations || [timing.transaction.inverseOperation]).packages[0].resources[0].sourceBytes,
    resource.sourceBytes,
);
assert.equal(createTransactionSaveTarget(timed, timedOperations).kind, "transactionBatch");

const removal = prepareRemoveAssetResource(imported, {
    packageId: "pkg",
    resourceId: resource.id,
});
assert.equal(removal.ok, true);
if (!removal.ok) throw new Error(removal.message);
const removed = applyUamTransaction(imported, removal.transaction.operations);
const restored = applyUamTransaction(removed, removal.transaction.inverseOperations);
assert.deepEqual(restored.packages[0].resources[0].sourceBytes, resource.sourceBytes);

const unsupported = prepareImportMovieClipResource(project, { packageId: "pkg" }, [{
    fileName: "frame.webp",
    sourceBytes: new Uint8Array([1]),
    dimensions: { width: 1, height: 1 },
}]);
assert.equal(unsupported.ok, false);
assert.equal(unsupported.code, "unsupported_movieclip_frame");

const jsonSource = JSON.stringify({
    frames: {
        "walk1.png": {
            frame: { x: 0, y: 0, w: 10, h: 12 },
            rotated: false,
            spriteSourceSize: { x: -2, y: 1, w: 10, h: 12 },
        },
        "walk2.png": {
            frame: { x: 12, y: 0, w: 8, h: 9 },
            rotated: true,
            spriteSourceSize: { x: 3, y: -1, w: 8, h: 9 },
        },
    },
    meta: { image: "walk.png" },
});
const jsonDescriptor = parseMovieClipSpriteSheetDescriptor("walk.json", jsonSource);
assert.equal(jsonDescriptor.ok, true);
if (!jsonDescriptor.ok) throw new Error(jsonDescriptor.message);
assert.equal(jsonDescriptor.imageFileName, "walk.png");
assert.equal(jsonDescriptor.frames.length, 2);
assert.deepEqual(jsonDescriptor.frames[0].rect, { x: -2, y: 1, width: 10, height: 12 });
assert.equal(jsonDescriptor.frames[1].rotated, true);
const easDescriptor = parseMovieClipSpriteSheetDescriptor("walk.eas", jsonSource);
assert.equal(easDescriptor.ok, true);
if (!easDescriptor.ok) throw new Error(easDescriptor.message);
assert.deepEqual(easDescriptor, jsonDescriptor);

const xmlDescriptor = parseMovieClipSpriteSheetDescriptor("walk.xml", `
<TextureAtlas imagePath="walk.png">
  <SubTexture name="walk1.png" x="0" y="0" width="10" height="12" frameX="-2" frameY="1"/>
  <SubTexture name="walk2.png" x="12" y="0" width="8" height="9" frameX="3" frameY="-1" rotated="true"/>
</TextureAtlas>`);
assert.equal(xmlDescriptor.ok, true);
if (!xmlDescriptor.ok) throw new Error(xmlDescriptor.message);
assert.equal(xmlDescriptor.imageFileName, "walk.png");
assert.deepEqual(xmlDescriptor.frames, jsonDescriptor.frames);

const plistDescriptor = parseMovieClipSpriteSheetDescriptor("walk.plist", `
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>frames</key><dict>
    <key>walk1.png</key><dict>
      <key>frame</key><string>{0,0,10,12}</string>
      <key>sourceColorRect</key><string>{-2,1,10,12}</string>
      <key>rotated</key><false/>
    </dict>
    <key>walk2.png</key><dict>
      <key>textureRect</key><string>{12,0,8,9}</string>
      <key>spriteOffset</key><string>{3,-1}</string>
      <key>textureRotated</key><true/>
    </dict>
  </dict>
  <key>metadata</key><dict><key>textureFileName</key><string>walk.png</string></dict>
</dict></plist>`);
assert.equal(plistDescriptor.ok, true);
if (!plistDescriptor.ok) throw new Error(plistDescriptor.message);
assert.equal(plistDescriptor.imageFileName, "walk.png");
assert.deepEqual(plistDescriptor.frames, jsonDescriptor.frames);

const legacyPlistDescriptor = parseMovieClipSpriteSheetDescriptor("legacy.plist", `
<plist version="1.0"><dict>
  <key>frames</key><dict><key>odd.png</key><dict>
    <key>x</key><integer>0</integer><key>y</key><integer>0</integer>
    <key>width</key><integer>5</integer><key>height</key><integer>7</integer>
    <key>offsetX</key><integer>3</integer><key>offsetY</key><integer>1</integer>
  </dict></dict>
  <key>metadata</key><dict><key>textureFileName</key><string>legacy.png</string></dict>
</dict></plist>`);
assert.equal(legacyPlistDescriptor.ok, true);
if (!legacyPlistDescriptor.ok) throw new Error(legacyPlistDescriptor.message);
assert.deepEqual(legacyPlistDescriptor.frames[0].rect, { x: 0, y: -2, width: 5, height: 7 });

const spritePrepared = prepareImportMovieClipSpriteSheetResource(
    project,
    { packageId: "pkg" },
    "walk.json",
    jsonDescriptor.frames.map((frame, index) => ({
        name: frame.name,
        textureKey: index === 0 ? "shared" : "shared",
        sourceBytes: sample.textures[0].raw,
        rect: frame.rect,
    })),
);
assert.equal(spritePrepared.ok, true);
if (!spritePrepared.ok) throw new Error(spritePrepared.message);
assert.equal(spritePrepared.transaction.operation.kind, "addResource");
if (spritePrepared.transaction.operation.kind !== "addResource") throw new Error("Expected addResource.");
const spriteResource = spritePrepared.transaction.operation.resource;
const spriteJta = parseMovieClipJta(spriteResource.sourceBytes);
assert.equal(spriteResource.fileName, "walk.jta");
assert.equal(spriteJta.frames.length, 2);
assert.equal(spriteJta.textures.length, 1);
assert.deepEqual(spriteJta.frames.map((frame) => [frame.rectX, frame.rectY]), [[0, 2], [5, 0]]);
assert.deepEqual([spriteJta.boundsWidth, spriteJta.boundsHeight], [13, 14]);
const spriteImported = applyUamTransaction(projectionProject, [spritePrepared.transaction.operation]);
assert.equal(createTransactionSaveTarget(spriteImported, [spritePrepared.transaction.operation]).kind, "transaction");
assert.equal(
    applyUamTransaction(spriteImported, [spritePrepared.transaction.inverseOperation]).packages[0].resources.length,
    0,
);

const malformedDescriptor = parseMovieClipSpriteSheetDescriptor("walk.json", JSON.stringify({
    frames: { broken: { frame: { x: 0, y: 0, w: 1.5, h: 2 } } },
}));
assert.equal(malformedDescriptor.ok, false);
assert.equal(malformedDescriptor.code, "invalid_sprite_sheet_descriptor");
const unsupportedDescriptor = parseMovieClipSpriteSheetDescriptor("walk.txt", "");
assert.equal(unsupportedDescriptor.ok, false);
assert.equal(unsupportedDescriptor.code, "unsupported_sprite_sheet_descriptor");

console.log(JSON.stringify({
    ok: true,
    frameCount: encoded.frames.length,
    byteLength: resource.sourceBytes.byteLength,
    croppedFrame: encoded.frames[1],
    timing: { fps: timedJta.fps, speed: timedJta.speed, repeatDelay: timedJta.repeatDelay, swing: timedJta.swing },
    naturalOrder: ["pulse2.png", "pulse10.png"],
    spriteSheet: {
        formats: ["json", "eas", "xml", "plist"],
        frames: spriteJta.frames.length,
        textures: spriteJta.textures.length,
        bounds: [spriteJta.boundsWidth, spriteJta.boundsHeight],
    },
}));
