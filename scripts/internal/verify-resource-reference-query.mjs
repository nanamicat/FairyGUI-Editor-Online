import assert from "node:assert/strict";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const {
    getProjectResourceUrl,
    isProjectResourceInUse,
    parseProjectResourceUrl,
    queryProjectResourceReferences,
} = await importTypeScriptModule(
    "src/editor/commands/HighRiskAuthoringTransactions.ts",
);

const project = {
    settings: { defaultIcon: "ui://pkgAimage" },
    packages: [{
        id: "pkgA",
        name: "Package A",
        resources: [
            { id: "image", kind: "image", name: "Image" },
            {
                id: "screen",
                kind: "component",
                name: "Screen",
                path: "/screens",
                component: {
                    children: [
                        { resource: { packageId: "", resourceId: "image" } },
                        { icon: "ui://pkgAimage ui://pkgAimage" },
                        { resource: { packageId: "pkgB", src: "shared" } },
                    ],
                },
            },
            {
                id: "font",
                kind: "font",
                name: "Font",
                metadata: { textureId: "image" },
            },
        ],
    }, {
        id: "pkgB",
        name: "Package B",
        resources: [
            { id: "shared", kind: "image", name: "Shared" },
        ],
    }],
};

const image = { packageId: "pkgA", resourceId: "image" };
assert.equal(getProjectResourceUrl(image), "ui://pkgAimage");
assert.deepEqual(parseProjectResourceUrl(project, " ui://pkgAimage "), image);
assert.equal(parseProjectResourceUrl(project, "ui://missing"), null);
assert.deepEqual(
    queryProjectResourceReferences(project, image, "incoming")
        .map(({ kind, resourceId, count }) => [kind, resourceId, count]),
    [
        ["resource", "font", 1],
        ["resource", "screen", 3],
        ["projectSettings", "", 1],
    ],
);
assert.deepEqual(
    queryProjectResourceReferences(
        project,
        { packageId: "pkgA", resourceId: "screen" },
        "outgoing",
    ).map(({ packageId, resourceId, count }) => [packageId, resourceId, count]),
    [
        ["pkgA", "image", 3],
        ["pkgB", "shared", 1],
    ],
);
assert.deepEqual(
    queryProjectResourceReferences(
        project,
        { packageId: "pkgA", resourceId: "font" },
        "outgoing",
    ).map(({ resourceId, count }) => [resourceId, count]),
    [["image", 1]],
);
assert.equal(isProjectResourceInUse(project, image), true);
assert.equal(isProjectResourceInUse(project, image, "screen"), true);
assert.equal(isProjectResourceInUse({
    packages: [{
        id: "pkgA",
        resources: [
            { id: "image", kind: "image" },
            { id: "screen", kind: "component", component: { icon: "ui://pkgAimage" } },
        ],
    }],
}, image, "screen"), false);

console.log("Resource reference query verification passed.");
