import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryBrowserStorage } from "../browser-storage-fixture.mjs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";
import { resolveAuthoringProjectPath } from "../project-boundary.mjs";

const transactionModulePath = path.resolve(
    process.argv[2] ?? "assets/resources/editor/runtime/openfairygui-backend-browser.js",
);
const {
    prepareMoveComponent,
    prepareRemoveComponent,
    prepareRemovePackage,
    parseMovieClipJta,
    readComponentProperties,
    readTextProperties,
} = await importTypeScriptModule(
    "src/editor/commands/HighRiskAuthoringTransactions.ts",
);
const {
    applyUamTransaction,
    BackendRuntime,
    createBackendStorageFileSystem,
    ProjectReader,
    liftDocumentToUamProject,
} = await import(pathToFileURL(transactionModulePath).href);

const node = (id, kind, resource) => ({
    id,
    name: id,
    kind,
    position: { x: 0, y: 0 },
    size: { width: 0, height: 0 },
    visible: true,
    touchable: true,
    grayed: false,
    alpha: 1,
    rotation: 0,
    customData: "",
    group: "",
    relations: [],
    gears: [],
    ...(kind === "text"
        ? {
            text: "",
            font: "",
            fontSize: 12,
            color: "#000000",
            ...readTextProperties({ kind: "text" }),
        }
        : {}),
    ...(resource ? { resource } : {}),
});
const componentProperties = (properties = {}) => readComponentProperties({ properties });
const imageProperties = {
    textureSetMode: "",
    qualityOption: "",
    quality: 80,
    smoothing: true,
    duplicatePadding: false,
    scaleOption: 0,
    scale9Grid: null,
    tileGridIndice: 0,
};
const authoringProjectPath = resolveAuthoringProjectPath();
const sourceMovieBytes = new Uint8Array(await readFile(
    path.join(path.dirname(authoringProjectPath), "assets/Bag/images/quan.jta"),
));
const sourceMovieJta = parseMovieClipJta(sourceMovieBytes);
const sourceMovieMillisecondsPerFrame = 1000 / sourceMovieJta.fps;
const sourceMovieModel = {
    interval: Math.trunc(sourceMovieMillisecondsPerFrame * (sourceMovieJta.speed || 1)),
    repeatDelay: Math.trunc(sourceMovieMillisecondsPerFrame * sourceMovieJta.repeatDelay),
    swing: sourceMovieJta.swing,
    smoothing: true,
    frames: sourceMovieJta.frames.map((frame) => ({
        rectX: frame.rectX,
        rectY: frame.rectY,
        rectWidth: frame.rectWidth,
        rectHeight: frame.rectHeight,
        addDelay: Math.trunc(sourceMovieMillisecondsPerFrame * frame.delay),
        spriteId: "",
    })),
};
const project = {
    packages: [
        {
            id: "source",
            resources: [
                {
                    kind: "component",
                    id: "moving",
                    name: "Moving",
                    component: {
                        displayList: [
                            node("text", "text"),
                            node("self-ref", "component", { packageId: "", resourceId: "moving" }),
                        ],
                        controllers: [],
                        transitions: [],
                    },
                },
                {
                    kind: "component",
                    id: "source-host",
                    component: {
                        displayList: [
                            node("before", "text"),
                            node("implicit", "component", { resourceId: "moving" }),
                            node("between", "text"),
                            node("explicit", "component", { packageId: "source", resourceId: "moving" }),
                        ],
                        controllers: [],
                        transitions: [],
                    },
                },
            ],
        },
        {
            id: "destination",
            resources: [],
        },
        {
            id: "external",
            resources: [{
                kind: "component",
                id: "external-host",
                component: {
                    displayList: [
                        node("external-ref", "component", { packageId: "source", resourceId: "moving" }),
                        {
                            ...node("derived-ref", "button"),
                            src: "moving",
                            packageId: "source",
                        },
                    ],
                    controllers: [],
                    transitions: [],
                },
            }],
        },
    ],
};
for (const pkg of project.packages) {
    pkg.name ??= pkg.id;
    pkg.publish ??= null;
    for (const resource of pkg.resources) {
        resource.name ??= resource.id;
        resource.path ??= "/";
        resource.exported ??= false;
        resource.favorite ??= false;
        resource.branch ??= "";
        resource.branchItemIds ??= [];
        if (!resource.component) continue;
        resource.component.size ??= { width: 0, height: 0 };
        resource.component.properties = componentProperties(resource.component.properties);
        resource.component.customData ??= "";
    }
}
const original = structuredClone(project);
const prepared = prepareMoveComponent(project, { packageId: "source", componentResourceId: "moving" }, "destination");

assert.equal(prepared.ok, true, "self-contained component move should prepare");
assert.deepEqual(project, original, "preparing must not mutate the working project");
if (!prepared.ok) throw new Error(prepared.message);

const operations = prepared.transaction.operations || [];
const inverseOperations = prepared.transaction.inverseOperations || [];
assert.deepEqual(operations.map((operation) => operation.kind), [
    "detachDisplayNode", "detachDisplayNode", "detachDisplayNode", "detachDisplayNode", "detachDisplayNode",
    "attachDisplayNode", "attachDisplayNode", "attachDisplayNode", "attachDisplayNode", "attachDisplayNode", "moveComponent",
]);
assert.deepEqual(inverseOperations.map((operation) => operation.kind), [
    "detachDisplayNode", "detachDisplayNode", "detachDisplayNode", "detachDisplayNode", "detachDisplayNode",
    "attachDisplayNode", "attachDisplayNode", "attachDisplayNode", "attachDisplayNode", "attachDisplayNode", "moveComponent",
]);
const detachedNodes = operations.filter((operation) => operation.kind === "detachDisplayNode");
assert.deepEqual(detachedNodes.map((operation) => operation.selector), [
    { packageId: "source", componentResourceId: "moving", displayNodeId: "self-ref" },
    { packageId: "source", componentResourceId: "source-host", displayNodeId: "implicit" },
    { packageId: "source", componentResourceId: "source-host", displayNodeId: "explicit" },
    { packageId: "external", componentResourceId: "external-host", displayNodeId: "external-ref" },
    { packageId: "external", componentResourceId: "external-host", displayNodeId: "derived-ref" },
]);
const rewrittenNodes = operations.filter((operation) => operation.kind === "attachDisplayNode");
assert.deepEqual(rewrittenNodes.map((operation) => operation.atIndex), [1, 1, 3, 0, 1]);
assert(rewrittenNodes.every((operation) =>
    operation.node.kind === "component"
        ? operation.node.resource.packageId === "destination"
        : operation.node.packageId === "destination",
));
const inverseDetachedNodes = inverseOperations.filter((operation) => operation.kind === "detachDisplayNode");
assert.equal(inverseDetachedNodes[0].selector.packageId, "destination");
assert.equal(inverseDetachedNodes[0].selector.componentResourceId, "moving");
assert.equal(inverseDetachedNodes[0].selector.displayNodeId, "self-ref");
const restoredNodes = inverseOperations.filter((operation) => operation.kind === "attachDisplayNode");
assert.equal(restoredNodes[0].selector.packageId, "destination");
assert.equal(restoredNodes[0].selector.componentResourceId, "moving");
assert.equal(restoredNodes[0].node.resource.packageId, "");
assert.equal(restoredNodes[1].node.resource.packageId, undefined);
assert.equal(restoredNodes[2].node.resource.packageId, "source");
assert.equal(restoredNodes[3].node.resource.packageId, "source");
assert.equal(restoredNodes[4].node.packageId, "source");
assert.match(prepared.transaction.summary, /retarget 5 incoming component references/);

const dependencyProject = {
    projectId: "component-dependency-rewrite",
    projectType: 0,
    version: "3.0",
    branches: [],
    settings: { publish: {}, common: {}, adaptation: {} },
    packages: [{
        id: "source",
        name: "Source",
        publish: null,
        resources: [{
            kind: "component",
            id: "moving",
            name: "MovingWithImage",
            path: "/",
            exported: false,
            favorite: false,
            branch: "",
            branchItemIds: [],
            component: {
                size: { width: 10, height: 10 },
                properties: componentProperties({ sound: "ui://sourcesource-sound" }),
                displayList: [
                    node("image-a", "image", { resourceId: "source-image" }),
                    node("image-b", "image", { packageId: "", resourceId: "source-image" }),
                    {
                        ...node("movie", "movieClip", { resourceId: "source-movie" }),
                        name: "movie",
                        position: { x: 0, y: 0 },
                        size: { width: 0, height: 0 },
                        pivot: { x: 0, y: 0 },
                        pivotAsAnchor: false,
                        visible: true,
                        touchable: true,
                        grayed: false,
                        alpha: 1,
                        rotation: 0,
                        customData: "",
                        group: "",
                        relations: [],
                        fileName: "",
                        filter: "",
                        filterData: "",
                        playing: true,
                        frame: 0,
                        color: "#FFFFFF",
                    },
                    node("nested-component", "component", { resourceId: "source-nested" }),
                    {
                        ...node("nested-derived", "button"),
                        src: "source-nested",
                        packageId: "",
                    },
                    {
                        ...node("font-text", "text"),
                        font: "ui://sourcesource-font",
                    },
                    node("self-component", "component", { packageId: "source", resourceId: "moving" }),
                ],
                controllers: [],
                transitions: [{
                    name: "sound",
                    autoPlay: false,
                    items: [{
                        actionType: 9,
                        startValue: ["ui://sourcesource-sound"],
                    }],
                }],
            },
        }, {
            kind: "component",
            id: "source-nested",
            name: "SourceNested",
            path: "/components/",
            exported: false,
            favorite: false,
            branch: "",
            branchItemIds: [],
            component: {
                size: { width: 8, height: 8 },
                properties: componentProperties({ sound: "ui://sourcesource-sound" }),
                displayList: [
                    node("nested-image", "image", { resourceId: "source-image" }),
                    node("deep-component", "component", { resourceId: "source-deep" }),
                ],
                controllers: [],
                transitions: [{
                    name: "nested-sound",
                    autoPlay: false,
                    items: [{
                        actionType: 9,
                        startValue: ["ui://sourcesource-sound"],
                    }],
                }],
            },
        }, {
            kind: "component",
            id: "source-deep",
            name: "SourceDeep",
            path: "/components/",
            exported: false,
            favorite: false,
            branch: "",
            branchItemIds: [],
            component: {
                size: { width: 4, height: 4 },
                properties: componentProperties(),
                displayList: [{
                    ...node("deep-movie", "movieClip", { resourceId: "source-movie" }),
                    name: "deep-movie",
                    position: { x: 0, y: 0 },
                    size: { width: 0, height: 0 },
                    pivot: { x: 0, y: 0 },
                    pivotAsAnchor: false,
                    visible: true,
                    touchable: true,
                    grayed: false,
                    alpha: 1,
                    rotation: 0,
                    customData: "",
                    group: "",
                    relations: [],
                    fileName: "",
                    filter: "",
                    filterData: "",
                    playing: true,
                    frame: 0,
                    color: "#FFFFFF",
                }],
                controllers: [],
                transitions: [],
            },
        }, {
            kind: "image",
            id: "source-image",
            name: "source",
            path: "/images/",
            exported: false,
            favorite: false,
            branch: "",
            branchItemIds: [],
            fileName: "source.png",
            dimensions: { width: 2, height: 3 },
            metadata: { scaleMode: "default" },
            image: imageProperties,
            sourceBytes: new Uint8Array([1, 2, 3]),
        }, {
            kind: "movieClip",
            id: "source-movie",
            name: "source-movie",
            path: "/movieclips/",
            exported: false,
            favorite: false,
            branch: "",
            branchItemIds: [],
            fileName: "source-movie.jta",
            dimensions: { width: sourceMovieJta.boundsWidth, height: sourceMovieJta.boundsHeight },
            movieClip: sourceMovieModel,
            sourceBytes: sourceMovieBytes,
        }, {
            kind: "font",
            id: "source-font",
            name: "source-font",
            path: "/fonts/",
            exported: false,
            favorite: false,
            branch: "",
            branchItemIds: [],
            fileName: "source-font.fnt",
            metadata: { textureId: "source-font-texture" },
            sourceBytes: new Uint8Array([102, 111, 110, 116]),
        }, {
            kind: "image",
            id: "source-font-texture",
            name: "source-font-texture",
            path: "/fonts/",
            exported: false,
            favorite: false,
            branch: "",
            branchItemIds: [],
            fileName: "source-font-texture.png",
            dimensions: { width: 4, height: 4 },
            metadata: { scaleMode: "default" },
            image: imageProperties,
            sourceBytes: new Uint8Array([6, 7, 8]),
        }, {
            kind: "sound",
            id: "source-sound",
            name: "source-sound",
            path: "/sounds/",
            exported: false,
            favorite: false,
            branch: "",
            branchItemIds: [],
            file: "source-sound.wav",
            metadata: null,
            sourceBytes: new Uint8Array([9, 10]),
        }],
    }, {
        id: "destination",
        name: "Destination",
        publish: null,
        resources: [],
    }],
};
const dependency = prepareMoveComponent(
    dependencyProject,
    { packageId: "source", componentResourceId: "moving" },
    "destination",
);
assert.equal(dependency.ok, true, "display-list, component-property and transition dependencies should prepare");
if (!dependency.ok) throw new Error(dependency.message);
assert.deepEqual(dependency.transaction.operations.map((operation) => operation.kind), [
    "addResource", "addResource", "addResource", "addResource", "addResource",
    "addComponent", "addComponent",
    "removeComponent", "addComponent",
]);
assert.deepEqual(dependency.transaction.inverseOperations.map((operation) => operation.kind), [
    "removeComponent", "addComponent",
    "removeComponent", "removeComponent",
    "removeResource", "removeResource", "removeResource", "removeResource", "removeResource",
]);
const copiedDependencies = dependency.transaction.operations
    .filter((operation) => operation.kind === "addResource")
    .map((operation) => operation.resource);
const copiedComponents = dependency.transaction.operations
    .filter((operation) => operation.kind === "addComponent" && operation.opId.includes("copy-component-dependency"))
    .map((operation) => operation.component);
const movedComponentSnapshot = dependency.transaction.operations.find((operation) =>
    operation.kind === "addComponent" && operation.opId.includes("add-component-for-snapshot-move")
).component;
const dependencyNodes = movedComponentSnapshot.component.displayList;
assert.deepEqual(copiedDependencies.map((resource) => resource.kind), ["image", "movieClip", "sound", "image", "font"]);
assert.deepEqual([...copiedDependencies[0].sourceBytes], [1, 2, 3]);
assert.deepEqual(copiedDependencies[1].sourceBytes, sourceMovieBytes);
assert.deepEqual([...copiedDependencies[2].sourceBytes], [9, 10]);
assert.deepEqual([...copiedDependencies[3].sourceBytes], [6, 7, 8]);
assert.deepEqual([...copiedDependencies[4].sourceBytes], [102, 111, 110, 116]);
assert.equal(copiedDependencies[4].metadata.textureId, copiedDependencies[3].id);
assert.equal(movedComponentSnapshot.component.properties.sound, `ui://destination${copiedDependencies[2].id}`);
assert.equal(movedComponentSnapshot.component.transitions[0].items[0].startValue[0], `ui://destination${copiedDependencies[2].id}`);
assert.deepEqual(copiedComponents.map((resource) => resource.name), [
    "SourceNested_dependency_copy",
    "SourceDeep_dependency_copy",
]);
const copiedDependencyIds = new Set(copiedDependencies.map((resource) => resource.id));
const copiedComponentIds = new Set(copiedComponents.map((resource) => resource.id));
assert(dependencyNodes.every((displayNode) => {
    if (displayNode.id === "font-text") {
        return displayNode.font === `ui://destination${copiedDependencies[4].id}`;
    }
    if (displayNode.id === "self-component") {
        return displayNode.resource.packageId === "destination"
            && displayNode.resource.resourceId === "moving";
    }
    if (displayNode.kind === "component") {
        return displayNode.resource.packageId === "destination"
            && copiedComponentIds.has(displayNode.resource.resourceId);
    }
    if (displayNode.src) {
        return displayNode.packageId === "destination"
            && copiedComponentIds.has(displayNode.src);
    }
    return displayNode.resource.packageId === "destination"
        && copiedDependencyIds.has(displayNode.resource.resourceId);
}));
const copiedNested = copiedComponents[0];
const copiedDeep = copiedComponents[1];
assert.equal(copiedNested.component.properties.sound, `ui://destination${copiedDependencies[2].id}`);
assert.equal(
    copiedNested.component.transitions[0].items[0].startValue[0],
    `ui://destination${copiedDependencies[2].id}`,
);
assert.deepEqual(
    copiedNested.component.displayList.map((displayNode) => [
        displayNode.resource.packageId,
        displayNode.resource.resourceId,
    ]),
    [
        ["destination", copiedDependencies[0].id],
        ["destination", copiedDeep.id],
    ],
);
assert.deepEqual(
    copiedDeep.component.displayList.map((displayNode) => [
        displayNode.resource.packageId,
        displayNode.resource.resourceId,
    ]),
    [["destination", copiedDependencies[1].id]],
);
assert.match(dependency.transaction.summary, /copy 7 source dependencies and rewrite 8 internal references/);
const dependencyMoved = applyUamTransaction(
    structuredClone(dependencyProject),
    dependency.transaction.operations,
);
const dependencyRestored = applyUamTransaction(
    dependencyMoved,
    dependency.transaction.inverseOperations,
);
const restoredDependencySource = dependencyRestored.packages.find((pkg) => pkg.id === "source");
const restoredDependencyTarget = dependencyRestored.packages.find((pkg) => pkg.id === "destination");
const restoredDependencyComponent = restoredDependencySource.resources.find((resource) => resource.id === "moving");
assert.deepEqual(restoredDependencyComponent.component.displayList.map((displayNode) =>
    displayNode.kind === "component"
        ? displayNode.resource.resourceId
        : displayNode.src || displayNode.resource?.resourceId || displayNode.id,
), ["source-image", "source-image", "source-movie", "source-nested", "source-nested", "font-text", "moving"]);
assert.equal(restoredDependencyComponent.component.displayList[5].font, "ui://sourcesource-font");
assert.equal(restoredDependencyComponent.component.properties.sound, "ui://sourcesource-sound");
assert.equal(restoredDependencyComponent.component.transitions[0].items[0].startValue[0], "ui://sourcesource-sound");
assert.equal(restoredDependencySource.resources.length, 8);
assert.equal(restoredDependencyTarget.resources.length, 0);

async function verifyRealComponentModelMove({
    sourcePackageId,
    componentResourceId,
    targetPackageId,
    readUri,
    expectedKind,
}) {
    const storage = new MemoryBrowserStorage();
    storage.importDirectory(path.dirname(authoringProjectPath));
    const fileSystem = createBackendStorageFileSystem(storage);
    const fairyPath = path.basename(authoringProjectPath);
    const readProject = async () => liftDocumentToUamProject(await new ProjectReader(fileSystem).read(
        fairyPath,
        { includeBinaryData: true, hydrateResourceBytes: true },
    ));
    const sourceProject = await readProject();
    const sourcePackage = sourceProject.packages.find((pkg) => pkg.id === sourcePackageId);
    const targetPackage = sourceProject.packages.find((pkg) => pkg.id === targetPackageId);
    const sourceResource = sourcePackage.resources.find((resource) => resource.id === componentResourceId);
    const originalUri = readUri(sourceResource.component);
    const originalTargetIds = targetPackage.resources.map((resource) => resource.id);
    const preparedMove = prepareMoveComponent(
        sourceProject,
        { packageId: sourcePackageId, componentResourceId },
        targetPackageId,
    );
    assert.equal(preparedMove.ok, true, JSON.stringify(preparedMove));
    assert(preparedMove.transaction.operations.some((operation) =>
        operation.kind === "removeComponent" && operation.selector.packageId === sourcePackageId
    ));
    assert(preparedMove.transaction.operations.some((operation) =>
        operation.kind === "addComponent"
        && operation.selector.packageId === targetPackageId
        && operation.component.id === componentResourceId
    ));
    assert.equal(preparedMove.transaction.operations.some((operation) =>
        operation.kind === "setComponentProps" || operation.kind === "updateTransition"
    ), false);

    const runtime = new BackendRuntime();
    const opened = runtime.openProjectSession({
        project: sourceProject,
        storage: {
            fileSystem,
            fairyPath,
            canonicalProjectPath: `memory://component-model-move/${componentResourceId}`,
            canonicalPathKey: `memory://component-model-move/${componentResourceId}`,
        },
    });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    const applied = await runtime.applyTransaction({
        sessionId: opened.data.sessionId,
        expectedRevision: opened.data.revision,
        operations: preparedMove.transaction.operations,
    });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal((await runtime.saveSession({
        sessionId: opened.data.sessionId,
        expectedRevision: applied.data.revision,
    })).ok, true);

    const reloaded = await readProject();
    const movedPackage = reloaded.packages.find((pkg) => pkg.id === targetPackageId);
    const movedResource = movedPackage.resources.find((resource) => resource.id === componentResourceId);
    const movedUri = readUri(movedResource.component);
    assert.match(movedUri, new RegExp(`^ui://${targetPackageId}`));
    const copiedResourceId = movedUri.slice(`ui://${targetPackageId}`.length);
    assert.equal(movedPackage.resources.find((resource) => resource.id === copiedResourceId)?.kind, expectedKind);

    const undone = await runtime.applyTransaction({
        sessionId: opened.data.sessionId,
        expectedRevision: applied.data.revision,
        operations: preparedMove.transaction.inverseOperations,
    });
    assert.equal(undone.ok, true, JSON.stringify(undone));
    assert.equal((await runtime.saveSession({
        sessionId: opened.data.sessionId,
        expectedRevision: undone.data.revision,
    })).ok, true);
    const restored = await readProject();
    const restoredSource = restored.packages.find((pkg) => pkg.id === sourcePackageId);
    const restoredTarget = restored.packages.find((pkg) => pkg.id === targetPackageId);
    assert.equal(
        readUri(restoredSource.resources.find((resource) => resource.id === componentResourceId).component),
        originalUri,
    );
    assert.deepEqual(
        restoredTarget.resources.map((resource) => resource.id).sort(),
        originalTargetIds.sort(),
    );
}

await verifyRealComponentModelMove({
    sourcePackageId: "9leh0eyf",
    componentResourceId: "gojg7s",
    targetPackageId: "rbw1tv9t",
    readUri: (component) => component.properties.sound,
    expectedKind: "sound",
});
await verifyRealComponentModelMove({
    sourcePackageId: "9leh0eyf",
    componentResourceId: "rt103t",
    targetPackageId: "rbw1tv9t",
    readUri: (component) => component.properties.dropdown,
    expectedKind: "component",
});
await verifyRealComponentModelMove({
    sourcePackageId: "c0hnre6o",
    componentResourceId: "lvxr1g",
    targetPackageId: "rbw1tv9t",
    readUri: (component) => component.transitions[0].items[0].startValue[0],
    expectedKind: "sound",
});

const unsupportedDependencyProject = structuredClone(project);
unsupportedDependencyProject.packages[0].resources[0].component.displayList = [
    node("unsupported-dependency", "loader", { resourceId: "source-host" }),
];
const unsupportedDependency = prepareMoveComponent(
    unsupportedDependencyProject,
    { packageId: "source", componentResourceId: "moving" },
    "destination",
);
assert.deepEqual(unsupportedDependency, {
    ok: false,
    code: "component_has_package_dependencies",
    message: "Cross-package copy supports component, derived-control, image, MovieClip, font and sound display dependencies; other dependency shapes remain closed.",
});
const missingUriDependencyProject = structuredClone(dependencyProject);
missingUriDependencyProject.packages[0].resources[0].component.displayList = [{
    ...node("missing-font", "text"),
    font: "ui://sourcemissing",
}];
assert.deepEqual(
    prepareMoveComponent(
        missingUriDependencyProject,
        { packageId: "source", componentResourceId: "moving" },
        "destination",
    ),
    {
        ok: false,
        code: "component_dependency_not_found",
        message: "A ui://source dependency does not match a source-package resource.",
    },
);

const removal = prepareRemoveComponent(project, { packageId: "source", componentResourceId: "moving" });
assert.equal(removal.ok, true, "non-empty component removal should prepare");
if (!removal.ok) throw new Error(removal.message);
assert.deepEqual(removal.transaction.operations.map((operation) => operation.kind), [
    "detachDisplayNode", "detachDisplayNode", "detachDisplayNode", "detachDisplayNode", "removeComponent",
]);
assert.deepEqual(
    removal.transaction.operations
        .filter((operation) => operation.kind === "detachDisplayNode")
        .map((operation) => operation.selector),
    [
        { packageId: "source", componentResourceId: "source-host", displayNodeId: "implicit" },
        { packageId: "source", componentResourceId: "source-host", displayNodeId: "explicit" },
        { packageId: "external", componentResourceId: "external-host", displayNodeId: "external-ref" },
        { packageId: "external", componentResourceId: "external-host", displayNodeId: "derived-ref" },
    ],
);
assert.deepEqual(removal.transaction.inverseOperations.map((operation) => operation.kind), [
    "addComponent", "attachDisplayNode", "attachDisplayNode", "attachDisplayNode", "attachDisplayNode",
]);
assert.deepEqual(
    removal.transaction.inverseOperations
        .filter((operation) => operation.kind === "attachDisplayNode")
        .map((operation) => operation.atIndex),
    [1, 3, 0, 1],
);
assert.match(removal.transaction.summary, /detach 4 incoming references/);

const packageRemovalProject = structuredClone(project);
for (const syntheticPackage of packageRemovalProject.packages) {
    syntheticPackage.name = syntheticPackage.id;
    syntheticPackage.compressPNG = null;
    syntheticPackage.jpegQuality = null;
    syntheticPackage.branchNames = [];
    syntheticPackage.publish = {
        name: syntheticPackage.id,
        path: "",
        branchPath: "",
        packageCount: 1,
        genCode: false,
        codePath: "",
        useGlobalAtlasSettings: true,
        maxAtlasSize: 2048,
        sizeOption: "pot",
        forceSquare: false,
        allowRotation: false,
        paging: true,
        extractAlpha: false,
        maxAtlasIndex: 0,
        atlases: [],
        excludedResourceIds: [],
    };
}
packageRemovalProject.packages[0].resources.push({
    kind: "image",
    id: "source-image",
    name: "SourceImage",
    path: "/",
    fileName: "source-image.png",
    file: "source-image.png",
    exported: false,
    favorite: false,
    branch: "",
    branchItemIds: [],
    image: imageProperties,
    sourceBytes: new Uint8Array([1, 2, 3]),
});
packageRemovalProject.packages[2].resources[0].component.displayList.splice(
    1,
    0,
    node("external-image-ref", "image", { packageId: "source", resourceId: "source-image" }),
);
const blockedPackageRemoval = prepareRemovePackage({
    ...packageRemovalProject,
    settings: { common: { scrollBars: { horizontal: "ui://sourceexternal" } } },
}, { packageId: "source" });
assert.deepEqual(blockedPackageRemoval, {
    ok: false,
    code: "package_reference_rewrite_unsupported",
    message: "Package removal cannot rewrite external ui:// references outside direct display resources.",
});
const blockedAssetPackageRemoval = prepareRemovePackage(packageRemovalProject, { packageId: "source" });
assert.deepEqual(blockedAssetPackageRemoval, {
    ok: false,
    code: "package_reference_rewrite_unsupported",
    message: "Package removal can restore external component and derived-control references; other display dependencies remain closed.",
});
packageRemovalProject.packages[2].resources[0].component.displayList.splice(1, 1);
const packageRemoval = prepareRemovePackage(packageRemovalProject, { packageId: "source" });
assert.equal(packageRemoval.ok, true, "non-empty package removal should prepare");
if (!packageRemoval.ok) throw new Error(packageRemoval.message);
assert.deepEqual(packageRemoval.transaction.operations.map((operation) => operation.kind), [
    "detachDisplayNode", "detachDisplayNode", "removePackage",
]);
assert.deepEqual(
    packageRemoval.transaction.operations
        .filter((operation) => operation.kind === "detachDisplayNode")
        .map((operation) => operation.selector),
    [
        { packageId: "external", componentResourceId: "external-host", displayNodeId: "external-ref" },
        { packageId: "external", componentResourceId: "external-host", displayNodeId: "derived-ref" },
    ],
);
assert.deepEqual(packageRemoval.transaction.inverseOperations.map((operation) => operation.kind), [
    "addPackage", "attachDisplayNode", "attachDisplayNode",
]);
assert.deepEqual(
    packageRemoval.transaction.inverseOperations
        .filter((operation) => operation.kind === "attachDisplayNode")
        .map((operation) => operation.atIndex),
    [0, 1],
);
const packageRemoved = applyUamTransaction(
    structuredClone(packageRemovalProject),
    packageRemoval.transaction.operations,
);
assert.equal(packageRemoved.packages.some((pkg) => pkg.id === "source"), false);
assert.deepEqual(
    packageRemoved.packages
        .find((pkg) => pkg.id === "external")
        .resources[0].component.displayList.map((displayNode) => displayNode.id),
    [],
);
const packageRestored = applyUamTransaction(
    packageRemoved,
    packageRemoval.transaction.inverseOperations,
);
assert.deepEqual(
    packageRestored.packages.find((pkg) => pkg.id === "source").resources.map((resource) => resource.id),
    packageRemovalProject.packages[0].resources.map((resource) => resource.id),
);
assert.deepEqual(
    packageRestored.packages
        .find((pkg) => pkg.id === "external")
        .resources[0].component.displayList.map((displayNode) => displayNode.id),
    ["external-ref", "derived-ref"],
);

const browserBaseline = JSON.parse(await readFile(
    path.join(process.cwd(), "assets/resources/editor/runtime/uam-baseline.json"),
    "utf8",
)).uamProject;
const realSelector = { packageId: "8rugjhhl", componentResourceId: "qujq5" };
const realTargetPackageId = "rbw1tv9t";
const realSource = browserBaseline.packages.find((pkg) => pkg.id === realSelector.packageId);
const realTarget = browserBaseline.packages.find((pkg) => pkg.id === realTargetPackageId);
const realSourceIndex = realSource.resources.findIndex((resource) => resource.id === realSelector.componentResourceId);
const realPrepared = prepareMoveComponent(browserBaseline, realSelector, realTargetPackageId);
assert.equal(realPrepared.ok, true, "the real empty-string local reference fixture should prepare");
if (!realPrepared.ok) throw new Error(realPrepared.message);
const realMoved = applyUamTransaction(
    structuredClone(browserBaseline),
    realPrepared.transaction.operations,
);
const realRestored = applyUamTransaction(
    realMoved,
    realPrepared.transaction.inverseOperations,
);
const restoredSource = realRestored.packages.find((pkg) => pkg.id === realSelector.packageId);
const restoredTarget = realRestored.packages.find((pkg) => pkg.id === realTargetPackageId);
const restoredReference = restoredSource.resources
    .find((resource) => resource.id === "qujq2")
    .component.displayList.find((displayNode) => displayNode.id === "n9");
assert.equal(
    restoredSource.resources.findIndex((resource) => resource.id === realSelector.componentResourceId),
    realSourceIndex,
);
assert.equal(restoredTarget.resources.some((resource) => resource.id === realSelector.componentResourceId), false);
assert.deepEqual(restoredReference.resource, {
    packageId: realSelector.packageId,
    resourceId: realSelector.componentResourceId,
});

const realRemovalSelector = { packageId: "rbw1tv9t", componentResourceId: "dwwc4" };
const realRemovalPackage = browserBaseline.packages.find((pkg) => pkg.id === realRemovalSelector.packageId);
const realRemovalIndex = realRemovalPackage.resources.findIndex((resource) => resource.id === realRemovalSelector.componentResourceId);
const realRemoval = prepareRemoveComponent(browserBaseline, realRemovalSelector);
assert.equal(realRemoval.ok, true, "real non-empty component removal should prepare");
if (!realRemoval.ok) throw new Error(realRemoval.message);
const realRemoved = applyUamTransaction(
    structuredClone(browserBaseline),
    realRemoval.transaction.operations,
);
assert.equal(
    realRemoved.packages
        .find((pkg) => pkg.id === realRemovalSelector.packageId)
        .resources.some((resource) => resource.id === realRemovalSelector.componentResourceId),
    false,
);
assert.equal(
    realRemoved.packages
        .find((pkg) => pkg.id === realRemovalSelector.packageId)
        .resources.find((resource) => resource.id === "dwwc3")
        .component.displayList.some((displayNode) => displayNode.id === "n2"),
    false,
);
const realRemovalRestored = applyUamTransaction(
    realRemoved,
    realRemoval.transaction.inverseOperations,
);
const realRemovalRestoredPackage = realRemovalRestored.packages.find((pkg) => pkg.id === realRemovalSelector.packageId);
const realRemovalRestoredReference = realRemovalRestoredPackage.resources
    .find((resource) => resource.id === "dwwc3")
    .component.displayList.find((displayNode) => displayNode.id === "n2");
assert.equal(
    realRemovalRestoredPackage.resources.findIndex((resource) => resource.id === realRemovalSelector.componentResourceId),
    realRemovalIndex,
);
assert.deepEqual(realRemovalRestoredReference.resource, {
    packageId: realRemovalSelector.packageId,
    resourceId: realRemovalSelector.componentResourceId,
});

const realPackageRemovalId = "rbw1tvvv";
const realPackageRemovalIndex = browserBaseline.packages.findIndex((pkg) => pkg.id === realPackageRemovalId);
const realPackageRemovalSource = browserBaseline.packages[realPackageRemovalIndex];
const realPackageRemovalShape = realPackageRemovalSource.resources.map((resource) => ({
    kind: resource.kind,
    id: resource.id,
    displayNodeIds: resource.kind === "component"
        ? resource.component.displayList.map((displayNode) => displayNode.id)
        : undefined,
}));
assert.deepEqual(
    prepareRemovePackage(browserBaseline, { packageId: realPackageRemovalId }),
    {
        ok: false,
        code: "package_source_bytes_unavailable",
        message: "Package removal requires hydrated source bytes for every asset so Undo can restore the package.",
    },
);
const hydratedBrowserBaseline = structuredClone(browserBaseline);
for (const resource of hydratedBrowserBaseline.packages[realPackageRemovalIndex].resources) {
    if (resource.kind !== "component") resource.sourceBytes = new Uint8Array([1, 2, 3]);
}
const realPackageRemoval = prepareRemovePackage(hydratedBrowserBaseline, { packageId: realPackageRemovalId });
assert.equal(realPackageRemoval.ok, true, "real non-empty package removal should prepare");
if (!realPackageRemoval.ok) throw new Error(realPackageRemoval.message);
const realPackageRemoved = applyUamTransaction(
    structuredClone(hydratedBrowserBaseline),
    realPackageRemoval.transaction.operations || [realPackageRemoval.transaction.operation],
);
assert.equal(realPackageRemoved.packages.some((pkg) => pkg.id === realPackageRemovalId), false);
const realPackageRestored = applyUamTransaction(
    realPackageRemoved,
    realPackageRemoval.transaction.inverseOperations || [realPackageRemoval.transaction.inverseOperation],
);
const realPackageRestoredSource = realPackageRestored.packages[realPackageRemovalIndex];
assert.equal(realPackageRestoredSource.id, realPackageRemovalId);
assert.deepEqual(
    realPackageRestoredSource.resources.map((resource) => ({
        kind: resource.kind,
        id: resource.id,
        displayNodeIds: resource.kind === "component"
            ? resource.component.displayList.map((displayNode) => displayNode.id)
            : undefined,
    })),
    realPackageRemovalShape,
);

console.log(JSON.stringify({
    ok: true,
    verified: [
        "empty-string, implicit and explicit inbound component references",
        "real browser UAM empty-string reference apply/inverse",
        "self-reference inverse selector",
        "original display-list indexes",
        "atomic forward and inverse batches",
        "recursive component, derived-control, image, MovieClip and bitmap-font dependency closure",
        "display-node ui:// rewrite and bitmap-font texture binding",
        "component settings and transition ui:// rewrite",
        "real Button sound, ComboBox dropdown and Transition sound save/reload/inverse cleanup",
        "atomic remove/add snapshot fallback for lifecycle batch compatibility",
        "deduplicated recursive dependency copies",
        "unsupported dependency-shape gate",
        "non-empty component removal with incoming reference detach and exact inverse",
        "non-empty package removal with external display detach, encoded-reference gate and exact inverse",
    ],
}, null, 2));
