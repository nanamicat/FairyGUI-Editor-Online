import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const report = JSON.parse(await readFile(
    path.resolve("assets/resources/editor/runtime/uam-baseline.json"),
    "utf8",
));
const baseline = report.uamProject;
const selector = { packageId: "rbw1tv9t", componentResourceId: "kcy10" };
const { prepareAddPrimitiveDisplayNode, readTextProperties } = await importTypeScriptModule(
    "src/editor/commands/HighRiskAuthoringTransactions.ts",
);
const { createProjectSnapshotFromUamProject } = await importTypeScriptModule(
    "src/editor/services/UamProjectSnapshotAdapter.ts",
);
const { normalizeLatestTransactionOperations } = await importTypeScriptModule(
    "src/editor/services/BrowserLiveSessionBridge.ts",
);
const { applyUamTransaction } = await import(pathToFileURL(path.resolve(
    process.argv[2] ?? "assets/resources/editor/runtime/openfairygui-backend-browser.js",
)).href);

for (const [kind, size] of [
    ["text", { width: 160, height: 30 }],
    ["richText", { width: 240, height: 100 }],
    ["textInput", { width: 200, height: 30 }],
    ["graph", { width: 100, height: 100 }],
    ["list", { width: 240, height: 160 }],
    ["loader", { width: 160, height: 120 }],
    ["loader3D", { width: 200, height: 160 }],
]) {
    const prepared = prepareAddPrimitiveDisplayNode(baseline, selector, kind, { x: 21, y: 34 });
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const node = prepared.transaction.operation.node;
    assert.equal(node.kind, kind);
    assert.deepEqual(node.position, { x: 21, y: 34 });
    assert.deepEqual(node.size, size);
    const applied = applyUamTransaction(
        structuredClone(baseline),
        [prepared.transaction.operation],
    );
    const component = applied.packages
        .find((pkg) => pkg.id === selector.packageId).resources
        .find((resource) => resource.id === selector.componentResourceId).component;
    assert(component.displayList.some((candidate) => candidate.id === node.id));
    if (kind === "textInput") {
        const snapshot = createProjectSnapshotFromUamProject(applied, {
            projectPath: "verification",
            openfairyguiVersion: "0.2.4",
            reader: "browser-uam-session",
        });
        const child = snapshot.packages
            .find((pkg) => pkg.id === selector.packageId).components
            .find((candidate) => candidate.id === selector.componentResourceId).children
            .find((candidate) => candidate.id === node.id);
        assert.equal(child.type, "GTextInput");
    }
    const restored = applyUamTransaction(applied, [prepared.transaction.inverseOperation]);
    const restoredComponent = restored.packages
        .find((pkg) => pkg.id === selector.packageId).resources
        .find((resource) => resource.id === selector.componentResourceId).component;
    assert(!restoredComponent.displayList.some((candidate) => candidate.id === node.id));
}

const textTarget = baseline.packages.flatMap((pkg) =>
    pkg.resources.flatMap((resource) =>
        (resource.component?.displayList || [])
            .filter((node) => node.kind === "text")
            .map((node) => ({ packageId: pkg.id, componentResourceId: resource.id, node })),
    ),
)[0];
assert(textTarget);
const normalizedTextOperation = normalizeLatestTransactionOperations(baseline, [{
    opId: "alpha29-text-properties",
    kind: "setDisplayNodeProps",
    selector: {
        packageId: textTarget.packageId,
        componentResourceId: textTarget.componentResourceId,
        displayNodeId: textTarget.node.id,
    },
    props: {
        textProperties: {
            ...readTextProperties(textTarget.node),
            leading: Number(textTarget.node.leading || 0) + 1,
        },
    },
}])[0];
assert.equal(normalizedTextOperation.props.textProperties.text, textTarget.node.text);
assert.equal(normalizedTextOperation.props.textProperties.fontSize, textTarget.node.fontSize);
assert.doesNotThrow(() => applyUamTransaction(structuredClone(baseline), [normalizedTextOperation]));

const defaultOperations = [{
    opId: "alpha29-image-defaults",
    kind: "addResource",
    selector: { packageId: selector.packageId },
    resource: {
        kind: "image",
        id: "alpha29-image",
        image: {},
    },
}, {
    opId: "alpha29-component-defaults",
    kind: "addComponent",
    selector: { packageId: selector.packageId },
    component: {
        kind: "component",
        id: "alpha29-component",
    },
}];
const normalizedDefaults = normalizeLatestTransactionOperations(baseline, defaultOperations);
assert.equal(normalizedDefaults[0].resource.favorite, false);
assert.equal(normalizedDefaults[0].resource.image.quality, 80);
assert.equal(normalizedDefaults[1].component.favorite, false);
assert.equal("favorite" in defaultOperations[0].resource, false);
assert.equal("quality" in defaultOperations[0].resource.image, false);
assert.equal("favorite" in defaultOperations[1].component, false);

for (const kind of ["text", "richText"]) {
    const prepared = prepareAddPrimitiveDisplayNode(baseline, selector, kind, { x: 45, y: 67 });
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    if (!prepared.ok) throw new Error(prepared.message);
    const node = prepared.transaction.operation.node;
    const normalized = normalizeLatestTransactionOperations(baseline, [
        prepared.transaction.operation,
        {
            opId: `alpha29-attached-${kind}-properties`,
            kind: "setDisplayNodeProps",
            selector: {
                packageId: selector.packageId,
                componentResourceId: selector.componentResourceId,
                displayNodeId: node.id,
            },
            props: {
                textProperties: {
                    leading: 9,
                    demoText: "demo",
                    templateVarsEnabled: true,
                    faceDilate: 1,
                },
            },
        },
    ]);
    const normalizedProperties = normalized[1].props.textProperties;
    assert.equal(normalizedProperties.text, node.text);
    assert.equal(normalizedProperties.leading, 9);
    if (kind === "richText") {
        assert.equal("demoText" in normalizedProperties, false);
        assert.equal("templateVarsEnabled" in normalizedProperties, false);
        assert.equal("faceDilate" in normalizedProperties, false);
    }
    assert.doesNotThrow(() => applyUamTransaction(structuredClone(baseline), normalized));
}

console.log(JSON.stringify({
    ok: true,
    verified: [
        "ObjectToolbar node defaults",
        "atomic attach/inverse",
        "alpha29 resource and component defaults",
        "alpha29 complete text property snapshots",
        "same-batch attached text normalization",
        "rich-text exact property filtering",
    ],
}, null, 2));
