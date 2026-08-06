import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { unzipSync } from "fflate";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveAuthoringProjectPath, resolveOpenFairyGuiModuleRoot } from "../project-boundary.mjs";

const moduleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const projectPath = resolveAuthoringProjectPath(process.argv[3]);
const projectDir = path.dirname(projectPath);
const fairyPath = path.basename(projectPath);
const importFile = (filePath) => import(pathToFileURL(filePath).href);
const [core, projectIo, backend, transfer] = await Promise.all([
    importFile(path.join(moduleRoot, "core/dist/index.js")),
    importFile(path.join(moduleRoot, "core/dist/project-io.js")),
    importFile(path.join(moduleRoot, "backend/dist/index.mjs")),
    importTypeScriptModule("src/editor/services/FairyPackageTransfer.ts"),
]);
const expectedVersion = "0.2.4";
for (const packageName of ["core", "functions", "backend", "cli"]) {
    const version = JSON.parse(readFileSync(path.join(moduleRoot, packageName, "package.json"), "utf8")).version;
    assert.equal(version, expectedVersion, `${packageName} must use OpenFairyGUI ${expectedVersion}`);
}
const editorShellSource = [
    readFileSync("src/editor/EditorShell.ts", "utf8"),
    readFileSync("src/editor/ui/ResourceAuthoringController.ts", "utf8"),
].join("\n");
for (const snippet of [
    "desktopMenuExportSelectedFairyPackageResources",
    "Export Selected Resources...",
    "exportFairyPackageResources(",
]) {
    assert(editorShellSource.includes(snippet), `EditorShell must wire ${snippet}`);
}

const transferBackend = {
    BackendRuntime: backend.BackendRuntime,
    createBackendStorageFileSystem: backend.createBackendStorageFileSystem,
    ProjectReader: projectIo.ProjectReader,
    liftDocumentToUamProject: core.liftDocumentToUamProject,
};
const storage = new MemoryBrowserStorage();
storage.importDirectory(projectDir);
const fileSystem = backend.createBackendStorageFileSystem(storage);
const baseline = core.liftDocumentToUamProject(await new projectIo.ProjectReader(fileSystem).read(fairyPath, {
    includeBinaryData: true,
    hydrateResourceBytes: true,
}));
const baselineHash = hashValue(baseline);
const bag = baseline.packages.find((pkg) => pkg.name === "Bag");
const bagWin = bag?.resources.find((resource) => resource.kind === "component" && resource.name === "BagWin");
assert(bag && bagWin, "Bag/BagWin is required for selected-resource export verification.");

const bagExport = await transfer.exportFairyPackageResources(transferBackend, baseline, [{
    packageId: bag.id,
    resourceId: bagWin.id,
}]);
assert.equal(bagExport.fileName, "Bag-selection.fairypackage");
assert.notEqual(bagExport.packageId, bag.id, "Selected-resource export must use an isolated synthetic package id.");
const bagArchiveFiles = await readArchiveFiles(bagExport.blob);
const parsedBagSubset = await transfer.readFairyPackageFiles(transferBackend, bagArchiveFiles);
const bagSubsetNames = new Set(parsedBagSubset.resources.map((resource) => resource.name));
for (const dependencyName of ["BagWin", "WindowFrame", "CloseButton"]) {
    assert(bagSubsetNames.has(dependencyName), `BagWin export is missing dependency ${dependencyName}.`);
}
assert(parsedBagSubset.resources.length < bag.resources.length, "Selected BagWin export unexpectedly contains the whole Bag package.");
assert.equal(parsedBagSubset.id, bagExport.packageId);
const parsedBagWin = parsedBagSubset.resources.find((resource) => resource.id === bagWin.id);
assert(parsedBagWin?.component, "Selected BagWin component body is missing after archive read-back.");
assert.deepEqual(
    canonicalizeOwnerReferences(parsedBagWin.component, parsedBagSubset.id),
    canonicalizeOwnerReferences(bagWin.component, bag.id),
    "Selected component body changed beyond the synthetic owner-package rewrite.",
);
for (const parsedResource of parsedBagSubset.resources) {
    const sourceResource = bag.resources.find((resource) => resource.id === parsedResource.id);
    assert(sourceResource, `Bag subset contains unexpected resource id ${parsedResource.id}.`);
    assert.equal(parsedResource.path || "/", sourceResource.path || "/");
    assert.equal(parsedResource.branch || "", sourceResource.branch || "");
    if (parsedResource.kind !== "component") {
        assert.equal(byteHash(parsedResource.sourceBytes), byteHash(sourceResource.sourceBytes));
    }
}
for (const folder of parsedBagSubset.folders || []) {
    const sourceFolder = bag.folders?.find((candidate) => (
        (candidate.branch || "") === (folder.branch || "") && candidate.path === folder.path
    ));
    assert(sourceFolder, `Bag subset contains unexpected folder ${folder.path}.`);
    assert.equal(Boolean(folder.favorite), Boolean(sourceFolder.favorite));
    assert.equal(folder.atlas || "", sourceFolder.atlas || "");
}
assertNoExternalPackageReferences(parsedBagSubset, new Set([bag.id]), parsedBagSubset.id);
assert.equal(hashValue(baseline), baselineHash, "BagWin subset export mutated the source UAM project.");
assert.equal(
    hashValue(parsedBagSubset),
    hashValue(await transfer.readFairyPackageFiles(transferBackend, bagArchiveFiles)),
    "Selected-resource archive read-back is not deterministic.",
);

const crossProject = structuredClone(baseline);
const crossBag = crossProject.packages.find((pkg) => pkg.id === bag.id);
const basics = crossProject.packages.find((pkg) => pkg.name === "Basics");
const crossBagWin = crossBag?.resources.find((resource) => resource.id === bagWin.id);
const collisionResource = crossBag?.resources.find((resource) => resource.id === "thi7h");
const donor = basics?.resources.find((resource) => (
    resource.kind === "image"
    && resource.fileName?.toLowerCase().endsWith(".png")
    && resource.sourceBytes instanceof Uint8Array
));
const externalNode = crossBagWin?.component?.displayList.find((node) => node.id === "n9");
assert(crossBag && basics && crossBagWin && collisionResource && donor && externalNode, "Cross-package dependency fixture inputs are missing.");
assert(!basics.resources.some((resource) => resource.id === collisionResource.id), "Cross-package fixture id must be free in Basics.");
const crossDependency = structuredClone(donor);
crossDependency.id = collisionResource.id;
crossDependency.name = "CrossDependencyFixture";
crossDependency.path = "/";
crossDependency.fileName = "cross-dependency-fixture.png";
basics.resources.push(crossDependency);
externalNode.resource = { packageId: basics.id, resourceId: crossDependency.id };
const crossProjectHash = hashValue(crossProject);

const crossExport = await transfer.exportFairyPackageResources(transferBackend, crossProject, [{
    packageId: crossBag.id,
    resourceId: crossBagWin.id,
}]);
const crossArchiveFiles = await readArchiveFiles(crossExport.blob);
const parsedCrossSubset = await transfer.readFairyPackageFiles(transferBackend, crossArchiveFiles);
const parsedCrossDependency = parsedCrossSubset.resources.find((resource) => resource.fileName === crossDependency.fileName);
const parsedCollisionResource = parsedCrossSubset.resources.find((resource) => resource.name === collisionResource.name);
const parsedCrossBagWin = parsedCrossSubset.resources.find((resource) => resource.name === crossBagWin.name);
assert(
    parsedCrossDependency && parsedCollisionResource && parsedCrossBagWin?.component,
    `Cross-package subset dependencies are incomplete: ${JSON.stringify(parsedCrossSubset.resources.map((resource) => ({ id: resource.id, name: resource.name, kind: resource.kind })))}`,
);
assert.notEqual(parsedCrossDependency.id, parsedCollisionResource.id, "Cross-package resource id collision was not remapped.");
assert.equal(byteHash(parsedCrossDependency.sourceBytes), byteHash(crossDependency.sourceBytes));
const parsedExternalNode = parsedCrossBagWin.component.displayList.find((node) => node.id === externalNode.id);
const parsedLocalNode = parsedCrossBagWin.component.displayList.find((node) => node.id === "n10");
assert.equal(parsedExternalNode?.resource?.packageId || parsedCrossSubset.id, parsedCrossSubset.id);
assert.equal(parsedExternalNode?.resource?.resourceId, parsedCrossDependency.id);
assert.equal(parsedLocalNode?.resource?.packageId || parsedCrossSubset.id, parsedCrossSubset.id);
assert.equal(parsedLocalNode?.resource?.resourceId, parsedCollisionResource.id);
assertNoExternalPackageReferences(parsedCrossSubset, new Set([crossBag.id, basics.id]), parsedCrossSubset.id);
assert.equal(hashValue(crossProject), crossProjectHash, "Cross-package subset export mutated its source UAM project.");
assert.equal(
    hashValue(parsedCrossSubset),
    hashValue(await transfer.readFairyPackageFiles(transferBackend, crossArchiveFiles)),
    "Cross-package archive read-back is not deterministic.",
);
assert.equal(hashValue(baseline), baselineHash, "Cross-package fixture handling mutated the original baseline.");

const metadataProject = structuredClone(baseline);
const metadataBag = metadataProject.packages.find((pkg) => pkg.id === bag.id);
const metadataBagWin = metadataBag.resources.find((resource) => resource.id === bagWin.id);
const metadataBasics = metadataProject.packages.find((pkg) => pkg.name === "Basics");
const sourceFont = metadataBasics.resources.find((resource) => resource.kind === "font" && resource.metadata?.textureId);
const sourceFontTexture = sourceFont && metadataBasics.resources.find((resource) => resource.id === sourceFont.metadata.textureId);
assert(metadataBagWin?.component && sourceFont && sourceFontTexture, "Metadata closure fixtures are unavailable.");
const freeText = `literal ui://${bag.id}thi7h tail; short ui://abc; unresolved ui://${bag.id}not-a-typed-token remains text`;
metadataBagWin.component.properties = { ...(metadataBagWin.component.properties || {}), remark: freeText };
metadataBagWin.component.displayList[0].customData = freeText;
const skeletonDependency = {
    kind: "misc",
    id: "skreq001",
    name: "skeleton_meta_fixture",
    path: "/skeleton/",
    exported: false,
    favorite: false,
    branch: "",
    branchItemIds: [],
    file: "skeleton_meta_fixture.json",
    sourceBytes: new TextEncoder().encode('{"fixture":true}'),
};
const skeletonBranchItem = {
    kind: "dragonBones",
    id: "skelalt1",
    name: "skeleton_branch_item_fixture",
    path: "/skeleton/",
    exported: false,
    favorite: false,
    branch: "",
    branchItemIds: [],
    file: "skeleton_branch_item_fixture.json",
    sourceBytes: new TextEncoder().encode('{"armature":[]}'),
    dimensions: { width: 0, height: 0 },
    metadata: { requireIds: [], atlasNames: [], anchorX: 0, anchorY: 0 },
};
const skeletonResource = {
    ...structuredClone(skeletonBranchItem),
    id: "skel0001",
    name: "skeleton_fixture",
    file: "skeleton_fixture.json",
    branchItemIds: [],
    metadata: {
        requireIds: [skeletonDependency.id, "thi7h"],
        atlasNames: [],
        anchorX: 0,
        anchorY: 0,
    },
};
const fontTexture = {
    ...structuredClone(sourceFontTexture),
    id: "fonttex1",
    name: "subset_font_texture",
    path: "/font/",
    fileName: "subset_font_texture.png",
};
delete fontTexture.sourcePath;
const fontResource = {
    ...structuredClone(sourceFont),
    id: "font0001",
    name: "subset_font",
    path: "/font/",
    fileName: "subset_font.fnt",
    metadata: { ...structuredClone(sourceFont.metadata), textureId: fontTexture.id },
};
delete fontResource.sourcePath;
const secondFontTexture = {
    ...structuredClone(fontTexture),
    id: "fonttex2",
    name: "subset_font_texture_2",
    fileName: "subset_font_texture_2.png",
};
fontResource.sourceBytes = new TextEncoder().encode([
    'info face="Subset" size=16',
    'common lineHeight=16 pages=2',
    `page id=0 file="${fontTexture.fileName}"`,
    `page id=1 file='${secondFontTexture.fileName}'`,
    "chars count=0",
].join("\n"));
metadataBag.resources.push(skeletonDependency, skeletonBranchItem, skeletonResource, fontTexture, secondFontTexture, fontResource);
for (const folderPath of ["/skeleton/", "/font/"]) {
    if (!metadataBag.folders.some((folder) => folder.path === folderPath && !folder.branch)) {
        metadataBag.folders.push({ path: folderPath, branch: "", favorite: false, atlas: "" });
    }
}
const metadataProjectHash = hashValue(metadataProject);
const metadataExport = await transfer.exportFairyPackageResources(transferBackend, metadataProject, [
    { packageId: metadataBag.id, resourceId: metadataBagWin.id },
    { packageId: metadataBag.id, resourceId: skeletonResource.id },
    { packageId: metadataBag.id, resourceId: fontResource.id },
]);
const metadataArchiveFiles = await readArchiveFiles(metadataExport.blob);
const parsedMetadataSubset = await transfer.readFairyPackageFiles(transferBackend, metadataArchiveFiles);
const parsedSkeleton = parsedMetadataSubset.resources.find((resource) => resource.name === skeletonResource.name);
const parsedSkeletonDependency = parsedMetadataSubset.resources.find((resource) => resource.name === skeletonDependency.name);
const parsedFont = parsedMetadataSubset.resources.find((resource) => resource.name === fontResource.name);
const parsedFontTexture = parsedMetadataSubset.resources.find((resource) => resource.name === fontTexture.name);
const parsedSecondFontTexture = parsedMetadataSubset.resources.find((resource) => resource.name === secondFontTexture.name);
const parsedMetadataBagWin = parsedMetadataSubset.resources.find((resource) => resource.name === metadataBagWin.name);
assert(parsedSkeleton && parsedSkeletonDependency && parsedFont && parsedFontTexture && parsedSecondFontTexture && parsedMetadataBagWin);
assert.deepEqual(
    parsedSkeleton.metadata.requireIds,
    [parsedSkeletonDependency.id, parsedMetadataSubset.resources.find((resource) => resource.name === "8")?.id],
    "Skeleton requireIds were not closed and remapped.",
);
assert.equal(parsedFont.metadata.textureId, parsedFontTexture.id, "Bitmap font texture dependency was not closed and remapped.");
const parsedMultiPageFont = new TextDecoder().decode(parsedFont.sourceBytes);
assert(parsedMultiPageFont.includes(`file="${parsedFontTexture.fileName}"`));
assert(parsedMultiPageFont.includes(`file='${parsedSecondFontTexture.fileName}'`));
assert.equal(parsedMetadataBagWin.component.properties.remark, freeText, "Free-text fake/short ui:// content was rewritten.");
assert.equal(parsedMetadataBagWin.component.displayList[0].customData, freeText, "customData fake/short ui:// content was rewritten.");
assert.equal(hashValue(metadataProject), metadataProjectHash, "Metadata subset export mutated its source project.");

const richTextProject = structuredClone(baseline);
const richTextBasics = richTextProject.packages.find((pkg) => pkg.name === "Basics");
const demoText = richTextBasics.resources.find((resource) => resource.kind === "component" && resource.name === "Demo_Text");
const richTextNode = demoText?.component?.displayList.find((node) => node.kind === "richText" && node.text?.includes("[img]ui://"));
assert(demoText && richTextNode, "Basics/Demo_Text RichText image fixture is required.");
const richTextMatch = /\[img\]ui:\/\/([A-Za-z0-9]{8})([A-Za-z0-9_-]+)\[\/img\]/.exec(richTextNode.text);
assert(richTextMatch, "RichText image fixture URI is malformed.");
richTextNode.customData = richTextNode.text;
demoText.component.properties = {
    ...(demoText.component.properties || {}),
    remark: richTextNode.text,
};
const richTextExport = await transfer.exportFairyPackageResources(transferBackend, richTextProject, [{
    packageId: richTextBasics.id,
    resourceId: demoText.id,
}]);
const parsedRichTextSubset = await transfer.readFairyPackageFiles(transferBackend, await readArchiveFiles(richTextExport.blob));
const parsedDemoText = parsedRichTextSubset.resources.find((resource) => resource.name === demoText.name);
const parsedRichTextNode = parsedDemoText?.component?.displayList.find((node) => node.id === richTextNode.id);
const parsedRichTextImage = parsedRichTextSubset.resources.find((resource) => resource.id === richTextMatch[2]);
assert(parsedDemoText && parsedRichTextNode && parsedRichTextImage, "RichText image dependency closure is incomplete.");
assert(
    parsedRichTextNode.text.includes(`[img]ui://${parsedRichTextSubset.id}${parsedRichTextImage.id}[/img]`),
    "RichText image URI was not rewritten to the synthetic package.",
);
assert.equal(parsedRichTextNode.customData, richTextNode.customData, "RichText customData must remain opaque text.");
assert.equal(parsedDemoText.component.properties.remark, demoText.component.properties.remark, "Component remark must remain opaque text.");

const htmlRichTextProject = structuredClone(richTextProject);
const htmlDemoText = htmlRichTextProject.packages.find((pkg) => pkg.id === richTextBasics.id).resources
    .find((resource) => resource.id === demoText.id);
const htmlRichTextNode = htmlDemoText.component.displayList.find((node) => node.id === richTextNode.id);
htmlRichTextNode.text = `HTML image: <IMG alt="quoted > text" SRC = 'ui://${richTextBasics.id}${richTextMatch[2]}' width="32"/>`;
const htmlRichTextExport = await transfer.exportFairyPackageResources(transferBackend, htmlRichTextProject, [{
    packageId: richTextBasics.id,
    resourceId: demoText.id,
}]);
const parsedHtmlRichTextSubset = await transfer.readFairyPackageFiles(
    transferBackend,
    await readArchiveFiles(htmlRichTextExport.blob),
);
const parsedHtmlDemoText = parsedHtmlRichTextSubset.resources.find((resource) => resource.name === demoText.name);
const parsedHtmlRichTextNode = parsedHtmlDemoText?.component?.displayList.find((node) => node.id === richTextNode.id);
const parsedHtmlRichTextImage = parsedHtmlRichTextSubset.resources.find((resource) => resource.id === richTextMatch[2]);
assert(parsedHtmlRichTextNode && parsedHtmlRichTextImage, "HTML RichText image dependency closure is incomplete.");
assert(
    parsedHtmlRichTextNode.text.includes(`SRC = 'ui://${parsedHtmlRichTextSubset.id}${parsedHtmlRichTextImage.id}'`),
    "HTML RichText image src was not rewritten to the synthetic package.",
);

const escapedRichTextProject = structuredClone(richTextProject);
const escapedDemoText = escapedRichTextProject.packages.find((pkg) => pkg.id === richTextBasics.id).resources
    .find((resource) => resource.id === demoText.id);
const escapedRichTextNode = escapedDemoText.component.displayList.find((node) => node.id === richTextNode.id);
const escapedLiteral = `\\[img]ui://${richTextBasics.id}${richTextMatch[2]}[/img]`;
escapedRichTextNode.text = escapedLiteral;
const escapedRichTextExport = await transfer.exportFairyPackageResources(transferBackend, escapedRichTextProject, [{
    packageId: richTextBasics.id,
    resourceId: demoText.id,
}]);
const parsedEscapedRichTextSubset = await transfer.readFairyPackageFiles(
    transferBackend,
    await readArchiveFiles(escapedRichTextExport.blob),
);
const parsedEscapedDemoText = parsedEscapedRichTextSubset.resources.find((resource) => resource.name === demoText.name);
const parsedEscapedRichTextNode = parsedEscapedDemoText?.component?.displayList.find((node) => node.id === richTextNode.id);
assert.equal(parsedEscapedRichTextNode?.text, escapedLiteral, "Escaped UBB image literal was treated as a resource reference.");

const unknownRichTextProject = structuredClone(richTextProject);
unknownRichTextProject.packages.find((pkg) => pkg.id === richTextBasics.id).resources
    .find((resource) => resource.id === demoText.id).component.displayList
    .find((node) => node.id === richTextNode.id).text = `[img]ui://${richTextBasics.id}missing-rich-image[/img]`;
await expectTransferError(
    () => transfer.exportFairyPackageResources(transferBackend, unknownRichTextProject, [{
        packageId: richTextBasics.id,
        resourceId: demoText.id,
    }]),
    "fairy_package_dependency_not_found",
);

const imageFontProject = structuredClone(baseline);
const imageFontBag = imageFontProject.packages.find((pkg) => pkg.name === "Bag");
const imageFontBasics = imageFontProject.packages.find((pkg) => pkg.name === "Basics");
const imageFontBagWin = imageFontBag.resources.find((resource) => resource.kind === "component" && resource.name === "BagWin");
const imageFont = imageFontBasics.resources.find((resource) => resource.kind === "font" && resource.name === "HitNumber");
const sourceFntText = new TextDecoder().decode(imageFont?.sourceBytes);
const sourceGlyphIds = [...sourceFntText.matchAll(/\simg=([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
const collisionGlyphId = sourceGlyphIds.find((resourceId) => !imageFontBag.resources.some((resource) => resource.id === resourceId));
const collisionDonor = imageFontBag.resources.find((resource) => resource.kind === "image" && resource.sourceBytes instanceof Uint8Array);
assert(imageFontBagWin?.component && imageFont && collisionGlyphId && collisionDonor, "Image-based FNT collision fixtures are unavailable.");
const collision = structuredClone(collisionDonor);
collision.id = collisionGlyphId;
collision.name = "image_font_collision_fixture";
collision.path = "/";
collision.fileName = "image_font_collision_fixture.png";
delete collision.sourcePath;
imageFontBag.resources.push(collision);
imageFontBagWin.component.displayList[0].font = `ui://${imageFontBasics.id}${imageFont.id}`;
const imageFontExport = await transfer.exportFairyPackageResources(transferBackend, imageFontProject, [
    { packageId: imageFontBag.id, resourceId: imageFontBagWin.id },
    { packageId: imageFontBag.id, resourceId: collision.id },
]);
const parsedImageFontSubset = await transfer.readFairyPackageFiles(transferBackend, await readArchiveFiles(imageFontExport.blob));
const parsedImageFont = parsedImageFontSubset.resources.find((resource) => resource.name === imageFont.name);
const sourceCollisionGlyph = imageFontBasics.resources.find((resource) => resource.id === collisionGlyphId);
const parsedCollisionGlyph = parsedImageFontSubset.resources.find((resource) => resource.name === sourceCollisionGlyph?.name);
const rewrittenFntText = new TextDecoder().decode(parsedImageFont?.sourceBytes);
assert(parsedImageFont && parsedCollisionGlyph, "Image-based FNT glyph dependency closure is incomplete.");
assert.notEqual(parsedCollisionGlyph.id, collisionGlyphId, "Colliding image-based FNT glyph id was not remapped.");
assert(rewrittenFntText.includes(`img=${parsedCollisionGlyph.id}`), "Image-based FNT sourceBytes did not use the remapped glyph id.");
for (const sourceGlyphId of sourceGlyphIds) {
    const sourceGlyph = imageFontBasics.resources.find((resource) => resource.id === sourceGlyphId);
    assert(
        parsedImageFontSubset.resources.some((resource) => resource.name === sourceGlyph?.name),
        `Image-based FNT is missing glyph image ${sourceGlyphId}.`,
    );
}

const ambiguousFontProject = structuredClone(baseline);
const ambiguousFont = ambiguousFontProject.packages.find((pkg) => pkg.name === "Basics").resources
    .find((resource) => resource.kind === "font" && resource.name === "HitNumber");
ambiguousFont.sourceBytes = new TextEncoder().encode("info face=fixture\nchar id=48 x=0 y=0 width=1 height=1");
await expectTransferError(
    () => transfer.exportFairyPackageResources(transferBackend, ambiguousFontProject, [{
        packageId: imageFontBasics.id,
        resourceId: ambiguousFont.id,
    }]),
    "fairy_package_font_format_unsupported",
);

const branchProject = structuredClone(baseline);
branchProject.branches = [...new Set([...(branchProject.branches || []), "dark"])].sort();
const branchBag = branchProject.packages.find((pkg) => pkg.id === bag.id);
const branchBase = branchBag.resources.find((resource) => resource.kind === "image");
const branchVariant = { ...structuredClone(branchBase), id: "darkimg1", branch: "dark", branchItemIds: [] };
branchBag.branchNames = [...new Set([...(branchBag.branchNames || []), "dark"])];
branchBase.branchItemIds = [branchVariant.id];
branchBag.resources.push(branchVariant);
const branchExport = await transfer.exportFairyPackageResources(transferBackend, branchProject, [{
    packageId: bag.id,
    resourceId: branchBase.id,
}]);
const branchArchiveFiles = await readArchiveFiles(branchExport.blob);
assert(branchArchiveFiles.some((file) => file.path === "package_dark.xml"));
assert(branchArchiveFiles.some((file) => file.path.startsWith("assets_dark/")));
const parsedBranchSubset = await transfer.readFairyPackageFiles(transferBackend, branchArchiveFiles);
assert.deepEqual(parsedBranchSubset.branchNames, ["dark"]);
assert(parsedBranchSubset.resources.some((resource) => resource.id === branchVariant.id && resource.branch === "dark"));

const skeletonAtlasProject = structuredClone(crossProject);
const skeletonAtlasBag = skeletonAtlasProject.packages.find((pkg) => pkg.id === bag.id);
const skeletonAtlasBasics = skeletonAtlasProject.packages.find((pkg) => pkg.id === basics.id);
const skeletonAtlasBagWin = skeletonAtlasBag.resources.find((resource) => resource.id === bagWin.id);
const skeletonAtlasNode = skeletonAtlasBagWin.component.displayList.find((node) => node.id === externalNode.id);
const atlasCollision = {
    ...structuredClone(donor),
    id: "atlcol01",
    name: "fixture-atlas-collision",
    path: "/skeleton/",
    fileName: "fixture-atlas.png",
};
const atlasFile = {
    kind: "misc",
    id: "atlas001",
    name: "fixture-atlas",
    path: "/skeleton/",
    file: "fixture-atlas.atlas",
    sourceBytes: new TextEncoder().encode("fixture-atlas.png\nsize: 1,1"),
};
const atlasImage = {
    ...structuredClone(donor),
    id: "atlas002",
    name: "fixture-atlas",
    path: "/skeleton/",
    fileName: "fixture-atlas.png",
};
const atlasSkeleton = {
    ...structuredClone(skeletonResource),
    id: "atlas003",
    name: "fixture-skeleton",
    metadata: { ...structuredClone(skeletonResource.metadata), requireIds: [atlasFile.id, atlasImage.id], atlasNames: ["fixture-atlas"] },
};
skeletonAtlasBag.resources.push(atlasCollision);
skeletonAtlasBasics.resources.push(atlasFile, atlasImage, atlasSkeleton);
skeletonAtlasNode.resource = { packageId: skeletonAtlasBasics.id, resourceId: atlasSkeleton.id };
const atlasExport = await transfer.exportFairyPackageResources(transferBackend, skeletonAtlasProject, [
    { packageId: bag.id, resourceId: bagWin.id },
    { packageId: bag.id, resourceId: atlasCollision.id },
]);
const parsedAtlasSubset = await transfer.readFairyPackageFiles(transferBackend, await readArchiveFiles(atlasExport.blob));
const parsedAtlasSkeleton = parsedAtlasSubset.resources.find((resource) => resource.id === atlasSkeleton.id);
assert(parsedAtlasSkeleton, `Skeleton atlas resource is missing: ${JSON.stringify(parsedAtlasSubset.resources.map((resource) => ({ id: resource.id, name: resource.name, kind: resource.kind })))}`);
const parsedAtlasRequires = parsedAtlasSkeleton.metadata.requireIds.map((id) => parsedAtlasSubset.resources.find((resource) => resource.id === id));
const parsedAtlasStems = new Set(parsedAtlasRequires.map((resource) => (resource.fileName || resource.file).replace(/\.[^.]+$/, "")));
assert.equal(parsedAtlasStems.size, 1, "Partially colliding skeleton atlas files were not renamed as a group.");
assert.deepEqual(parsedAtlasSkeleton.metadata.atlasNames, [...parsedAtlasStems]);

const unknownTypedUriProject = structuredClone(baseline);
const unknownTypedBagWin = unknownTypedUriProject.packages.find((pkg) => pkg.id === bag.id).resources
    .find((resource) => resource.id === bagWin.id);
unknownTypedBagWin.component.displayList[0].font = `ui://${bag.id}missing-resource`;
await expectTransferError(
    () => transfer.exportFairyPackageResources(transferBackend, unknownTypedUriProject, [{
        packageId: bag.id,
        resourceId: bagWin.id,
    }]),
    "fairy_package_dependency_not_found",
);

const donorAtlasProject = structuredClone(crossProject);
const donorAtlasBasics = donorAtlasProject.packages.find((pkg) => pkg.id === basics.id);
const donorAtlasDependency = donorAtlasBasics.resources.find((resource) => resource.id === crossDependency.id);
donorAtlasDependency.path = "/images/";
donorAtlasBasics.folders.find((folder) => folder.path === "/images/" && !folder.branch).atlas = "donor-atlas";
donorAtlasBasics.publish = { ...(donorAtlasBasics.publish || {}), name: "donor-incompatible-publish" };
const donorAtlasExport = await transfer.exportFairyPackageResources(transferBackend, donorAtlasProject, [{
    packageId: bag.id,
    resourceId: bagWin.id,
}]);
assert((await readArchiveFiles(donorAtlasExport.blob)).some((file) => file.path === "package.xml"));

console.log(JSON.stringify({
    ok: true,
    packageVersion: expectedVersion,
    bagResources: parsedBagSubset.resources.length,
    bagArchiveFiles: bagArchiveFiles.length,
    crossResources: parsedCrossSubset.resources.length,
    crossArchiveFiles: crossArchiveFiles.length,
    crossDependencyIdRemapped: parsedCrossDependency.id !== crossDependency.id,
    skeletonRequireIds: parsedSkeleton.metadata.requireIds.length,
    bitmapFontDependency: true,
    multiPageBitmapFont: true,
    imageBasedFontGlyphClosure: sourceGlyphIds.length,
    imageBasedFontGlyphIdRemapped: true,
    ambiguousFontRejected: true,
    richTextImageClosure: true,
    htmlRichTextImageClosure: true,
    escapedRichTextLiteralPreserved: true,
    unknownRichTextImageRejected: true,
    branchRoundTrip: true,
    freeTextPreserved: true,
    partialSkeletonAtlasRename: true,
    donorAtlasPublishPreserved: true,
    unknownTypedUriRejected: true,
    archiveRoundTrip: true,
    sourceUnchanged: true,
}));

function readArchiveFiles(blob) {
    return blob.arrayBuffer().then((buffer) => Object.entries(unzipSync(new Uint8Array(buffer)))
        .filter(([filePath]) => !filePath.endsWith("/"))
        .map(([filePath, data]) => ({ path: filePath, data })));
}

function assertNoExternalPackageReferences(value, sourcePackageIds, syntheticPackageId) {
    const visit = (current, key = "") => {
        if (typeof current === "string") {
            if (key === "packageId" && current) assert.equal(current, syntheticPackageId);
            for (const match of current.matchAll(/ui:\/\/([A-Za-z0-9]{8})/g)) {
                assert.equal(match[1], syntheticPackageId);
            }
            for (const sourcePackageId of sourcePackageIds) {
                assert(!current.includes(`ui://${sourcePackageId}`), `Unrewritten package URI ${sourcePackageId}.`);
            }
            return;
        }
        if (!current || typeof current !== "object" || ArrayBuffer.isView(current)) return;
        if (Array.isArray(current)) {
            for (const item of current) visit(item);
            return;
        }
        for (const [childKey, item] of Object.entries(current)) visit(item, childKey);
    };
    visit(value);
}

async function expectTransferError(run, code) {
    await assert.rejects(run, (error) => error?.code === code);
}

function byteHash(bytes) {
    assert(bytes instanceof Uint8Array, "Expected hydrated resource bytes.");
    return createHash("sha256").update(bytes).digest("hex");
}

function canonicalizeOwnerReferences(value, ownerPackageId) {
    if (typeof value === "string") return value.replaceAll(`ui://${ownerPackageId}`, "ui://OWNERPKG");
    if (value instanceof Uint8Array) return { bytes: byteHash(value) };
    if (Array.isArray(value)) return value.map((item) => canonicalizeOwnerReferences(item, ownerPackageId));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
        if (key === "sourcePath" || key === "binaryData") return [];
        if (key === "packageId" && (!item || item === ownerPackageId)) return [];
        return [[key, canonicalizeOwnerReferences(item, ownerPackageId)]];
    }));
}

function hashValue(value) {
    return createHash("sha256").update(JSON.stringify(value, (_key, item) => (
        item instanceof Uint8Array ? { bytes: Buffer.from(item).toString("base64") } : item
    ))).digest("hex");
}
