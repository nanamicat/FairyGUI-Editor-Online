import assert from "node:assert/strict";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const { EditorCommandAdapter } = await importTypeScriptModule(
    "src/editor/commands/EditorCommandAdapter.ts",
);
const { createCommonDisplayNodePropsCommands } = await importTypeScriptModule(
    "src/editor/commands/DisplayNodePropsLogic.ts",
);
const { ActiveDocumentController } = await importTypeScriptModule(
    "src/editor/ui/ActiveDocumentController.ts",
);
const { LibraryController } = await importTypeScriptModule(
    "src/editor/ui/LibraryController.ts",
);

function createSnapshot() {
    return {
        schemaVersion: 1,
        generatedAt: "test",
        source: {
            projectPath: "memory://history",
            openfairyguiVersion: "test",
            reader: "UamBaseline",
            uamLift: { ok: true },
        },
        project: { id: "project", type: "layabox", version: "1" },
        totals: {
            packages: 1,
            images: 0,
            sounds: 0,
            fonts: 0,
            movieClips: 0,
            components: 1,
            displayObjects: 1,
            gears: 0,
            controllers: 0,
            transitions: 0,
        },
        packages: [{
            id: "package",
            name: "Package",
            publishName: "Package",
            resources: [],
            components: [{
                id: "component",
                name: "Component",
                path: "/",
                exported: true,
                width: 100,
                height: 100,
                childCount: 1,
                controllerCount: 0,
                transitionCount: 0,
                children: [{
                    id: "node",
                    name: "Node",
                    type: "GGraph",
                    x: 0,
                    y: 0,
                    width: 10,
                    height: 10,
                    src: "",
                    visible: true,
                    touchable: true,
                    grayed: false,
                    alpha: 1,
                    rotation: 0,
                    pivotX: 0,
                    pivotY: 0,
                    pivotAsAnchor: false,
                    text: "",
                    font: "",
                    fontSize: 0,
                    color: "",
                    group: "",
                    gearCount: 0,
                    relationCount: 0,
                }],
            }],
        }],
        diagnostics: [],
    };
}

const selector = {
    packageId: "package",
    componentResourceId: "component",
    displayNodeId: "node",
};
const commonSnapshot = createSnapshot();
const commonNodes = commonSnapshot.packages[0].components[0].children;
commonNodes.push({ ...commonNodes[0], id: "node-2", name: "Node 2", x: 10 });
const commonCommands = createCommonDisplayNodePropsCommands(
    "package",
    "component",
    commonNodes,
    { x: 5, visible: false },
);
assert.deepEqual(commonCommands.changedFields, ["x", "visible"]);
assert.deepEqual(
    commonCommands.commands.map((command) => command.props),
    [
        { position: { x: 5, y: 0 }, visible: false },
        { position: { x: 5, y: 0 }, visible: false },
    ],
    "Common multi-selection command construction must omit kept fields and keep each node atomic.",
);
const selectionController = new ActiveDocumentController({
    getScopedNodeIds: (_tab, component) => component.children.map((node) => node.id),
}, () => undefined);
selectionController.setActiveSelection(
    commonSnapshot,
    "package",
    "component",
    ["node", "node-2"],
    "node-2",
);
const exposedNodeIds = selectionController.nodeIds;
exposedNodeIds.length = 0;
assert.deepEqual(selectionController.nodeIds, ["node", "node-2"], "Selection state must not be externally mutable.");

commonSnapshot.packages[0].resources.push({ id: "image", type: "Image" });
commonSnapshot.packages[0].folders = [{ branch: "main", path: "/images/" }];
const libraryController = new LibraryController(null, null, null, {
    getSnapshot: () => commonSnapshot,
    getSelectedPackageId: () => "package",
    applySelection: () => undefined,
    clearSelection: () => undefined,
    setDebugAttribute: () => undefined,
    setStatus: () => undefined,
});
libraryController.setResourceSelection([{ packageId: "package", resourceId: "image" }]);
const exposedResourceSelectors = libraryController.resourceSelectors;
exposedResourceSelectors[0].resourceId = "changed";
assert.equal(libraryController.resourceSelectors[0].resourceId, "image", "Library selections must not be externally mutable.");
libraryController.setInspectorSelection({ kind: "resource", packageId: "package", resourceId: "image" });
const exposedResourceSelection = libraryController.getInspectorSelection();
exposedResourceSelection.resourceId = "changed";
assert.equal(libraryController.getInspectorSelection().resourceId, "image", "Inspector selection must not be externally mutable.");
libraryController.setInspectorSelection({ kind: "folder", packageId: "package", branch: "main", path: "/images/" });
libraryController.reconcileInspectorSelection(commonSnapshot);
assert.equal(libraryController.getInspectorSelection().kind, "folder");
commonSnapshot.packages[0].folders = [];
libraryController.reconcileInspectorSelection(commonSnapshot);
assert.equal(libraryController.getInspectorSelection(), null, "Missing Inspector selections must be cleared.");
assert.deepEqual(
    selectionController.resolveCommandTargetSelection(commonSnapshot, [{
        packageId: "package",
        componentResourceId: "component",
        displayNodeId: "node",
    }]),
    {
        packageId: "package",
        componentId: "component",
        nodeIds: ["node", "node-2"],
        primaryNodeId: "node-2",
    },
    "Undo/Redo must keep a surviving multi-selection when every command target is already selected.",
);
const missingSelectionSnapshot = structuredClone(commonSnapshot);
missingSelectionSnapshot.packages[0].components[0].children.pop();
assert.deepEqual(
    selectionController.resolveCommandTargetSelection(missingSelectionSnapshot, [{
        packageId: "package",
        componentResourceId: "component",
        displayNodeId: "node",
    }]),
    {
        packageId: "package",
        componentId: "component",
        nodeIds: ["node"],
        primaryNodeId: "node",
    },
    "Undo/Redo must fall back to surviving command targets when the previous selection no longer exists.",
);
const snapshot = createSnapshot();
const adapter = new EditorCommandAdapter();
adapter.reset(snapshot);

const applied = adapter.applySetDisplayNodeProps({
    kind: "setDisplayNodeProps",
    selector,
    props: {
        position: { x: 10, y: 0 },
        pivot: { x: 0.25, y: 0.5 },
        pivotAsAnchor: true,
    },
});
assert.equal(applied.ok, true);
assert.equal(snapshot.packages[0].components[0].children[0].x, 10);
assert.deepEqual(
    {
        pivotX: snapshot.packages[0].components[0].children[0].pivotX,
        pivotY: snapshot.packages[0].components[0].children[0].pivotY,
        pivotAsAnchor: snapshot.packages[0].components[0].children[0].pivotAsAnchor,
    },
    { pivotX: 0.25, pivotY: 0.5, pivotAsAnchor: true },
);
assert.deepEqual(
    {
        dirty: adapter.getSessionState().dirty,
        undo: adapter.getSessionState().undoDepth,
        redo: adapter.getSessionState().redoDepth,
    },
    { dirty: true, undo: 1, redo: 0 },
);

adapter.markSaved();
assert.equal(adapter.getSessionState().dirty, false, "Save checkpoint must not clear Undo.");
assert.equal(adapter.canUndo(), true);
const undone = adapter.undoLast();
assert.equal(undone.ok, true);
assert.equal(snapshot.packages[0].components[0].children[0].x, 0);
assert.deepEqual(
    {
        pivotX: snapshot.packages[0].components[0].children[0].pivotX,
        pivotY: snapshot.packages[0].components[0].children[0].pivotY,
        pivotAsAnchor: snapshot.packages[0].components[0].children[0].pivotAsAnchor,
    },
    { pivotX: 0, pivotY: 0, pivotAsAnchor: false },
);
assert.equal(adapter.getSessionState().dirty, true);
assert.equal(adapter.canRedo(), true);
const redone = adapter.redoLast();
assert.equal(redone.ok, true);
assert.equal(snapshot.packages[0].components[0].children[0].x, 10);
assert.equal(snapshot.packages[0].components[0].children[0].pivotAsAnchor, true);
assert.equal(adapter.getSessionState().dirty, false, "Redo to the saved state must clear dirty.");

const groupSnapshot = createSnapshot();
groupSnapshot.packages[0].components[0].children[0].type = "GGroup";
const groupAdapter = new EditorCommandAdapter();
groupAdapter.reset(groupSnapshot);
const unsupportedPivot = groupAdapter.applySetDisplayNodeProps({
    kind: "setDisplayNodeProps",
    selector,
    props: { pivot: { x: 0.5, y: 0.5 } },
});
assert.equal(unsupportedPivot.ok, false);
assert.equal(unsupportedPivot.error?.code, "unsupported_pivot_target");

adapter.undoLast();
adapter.applySetDisplayNodeProps({
    kind: "setDisplayNodeProps",
    selector,
    props: { position: { x: 0, y: 7 } },
});
assert.equal(adapter.canRedo(), false, "A new command after Undo must discard the redo branch.");

const multiSnapshot = createSnapshot();
multiSnapshot.packages[0].components[0].children.push({
    ...structuredClone(multiSnapshot.packages[0].components[0].children[0]),
    id: "node2",
    name: "Node 2",
});
multiSnapshot.packages[0].components[0].childCount = 2;
multiSnapshot.totals.displayObjects = 2;
const multiAdapter = new EditorCommandAdapter();
multiAdapter.reset(multiSnapshot);
const multiApplied = await multiAdapter.applySetDisplayNodePropsGroupWithRuntime([
    {
        kind: "setDisplayNodeProps",
        selector,
        props: { position: { x: 4, y: 5 } },
    },
    {
        kind: "setDisplayNodeProps",
        selector: { ...selector, displayNodeId: "node2" },
        props: { position: { x: 8, y: 9 } },
    },
], "move selection");
assert.equal(multiApplied.ok, true);
assert.equal(multiAdapter.getSessionState().undoDepth, 1, "A multi-select edit must create one history entry.");
assert.deepEqual(
    multiSnapshot.packages[0].components[0].children.map(({ x, y }) => ({ x, y })),
    [{ x: 4, y: 5 }, { x: 8, y: 9 }],
);
assert.equal(multiAdapter.undoLast().ok, true);
assert.deepEqual(
    multiSnapshot.packages[0].components[0].children.map(({ x, y }) => ({ x, y })),
    [{ x: 0, y: 0 }, { x: 0, y: 0 }],
);
assert.equal(multiAdapter.redoLast().ok, true);
assert.deepEqual(
    multiSnapshot.packages[0].components[0].children.map(({ x, y }) => ({ x, y })),
    [{ x: 4, y: 5 }, { x: 8, y: 9 }],
);

const instanceSnapshot = createSnapshot();
const instanceNode = instanceSnapshot.packages[0].components[0].children[0];
instanceNode.type = "GComponent";
instanceNode.componentInstanceProperties = {
    extensionType: "Button",
    title: "",
    selectedTitle: "",
    icon: "",
    selectedIcon: "",
    titleColor: "",
    titleFontSize: 0,
    controller: "",
    page: "",
    checked: false,
    sound: "",
    soundVolumeScale: 1,
};
instanceNode.componentInstancePropertiesExplicit = false;
const instanceAdapter = new EditorCommandAdapter();
instanceAdapter.reset(instanceSnapshot);
const instanceApplied = instanceAdapter.applySetDisplayNodeProps({
    kind: "setDisplayNodeProps",
    selector,
    props: {
        componentInstanceProperties: {
            ...instanceNode.componentInstanceProperties,
            title: "Apply",
        },
    },
});
assert.equal(instanceApplied.ok, true);
assert.equal(instanceNode.componentInstanceProperties?.title, "Apply");
assert.equal(instanceNode.componentInstancePropertiesExplicit, true);
assert.equal(instanceAdapter.undoLast().ok, true);
assert.equal(instanceNode.componentInstanceProperties?.title, "");
assert.equal(
    instanceNode.componentInstancePropertiesExplicit,
    false,
    "Undo must remove an overlay that was inferred but not explicit in the source snapshot.",
);
assert.equal(instanceAdapter.redoLast().ok, true);
assert.equal(instanceNode.componentInstanceProperties?.title, "Apply");

const customPropertySnapshot = createSnapshot();
const customPropertyNode = customPropertySnapshot.packages[0].components[0].children[0];
customPropertyNode.type = "GComponent";
const customPropertyAdapter = new EditorCommandAdapter();
customPropertyAdapter.reset(customPropertySnapshot);
assert.equal(customPropertyAdapter.applySetDisplayNodeProps({
    kind: "setDisplayNodeProps",
    selector,
    props: {
        componentCustomPropertyValues: [{
            target: "title",
            propertyId: 0,
            value: "Apply",
        }],
        componentControllerPageOverrides: [{
            controllerName: "state",
            pageId: "1",
        }],
    },
}).ok, true);
assert.equal(customPropertyNode.componentCustomPropertyValues?.[0]?.value, "Apply");
assert.equal(customPropertyNode.componentCustomPropertyValuesExplicit, true);
assert.equal(customPropertyNode.componentControllerPageOverrides?.[0]?.pageId, "1");
assert.equal(customPropertyNode.componentControllerPageOverridesExplicit, true);
assert.equal(customPropertyAdapter.undoLast().ok, true);
assert.equal(customPropertyNode.componentCustomPropertyValues, undefined);
assert.equal(customPropertyNode.componentCustomPropertyValuesExplicit, false);
assert.equal(customPropertyNode.componentControllerPageOverrides, undefined);
assert.equal(customPropertyNode.componentControllerPageOverridesExplicit, false);
assert.equal(customPropertyAdapter.redoLast().ok, true);
assert.equal(customPropertyNode.componentCustomPropertyValues?.[0]?.value, "Apply");
assert.equal(customPropertyNode.componentControllerPageOverrides?.[0]?.pageId, "1");

const groupedAdapter = new EditorCommandAdapter();
const groupedSnapshot = createSnapshot();
let runtimeRevision = 0;
const appliedGroups = [];
groupedAdapter.reset(groupedSnapshot);
groupedAdapter.setLiveSessionRuntime({
    getState() {
        return {
            phase: "Phase 7A",
            status: "connected",
            liveSession: true,
            revision: runtimeRevision,
            dirty: runtimeRevision > 0,
            projectSource: "uam_baseline",
            workspaceRestoreStatus: "unavailable",
            backendBuildSource: "npm_package",
            backendBundleUrl: "",
            uamBaselineUrl: "",
            boundary: "test",
        };
    },
    async applyTransaction(operations) {
        appliedGroups.push(operations.map((operation) => operation.kind));
        runtimeRevision += 1;
        return { ok: true, revision: runtimeRevision, dirty: true, diagnostics: [], raw: null };
    },
    getProjectSnapshot() {
        return groupedSnapshot;
    },
});

const grouped = await groupedAdapter.applyHighRiskTransactionWithRuntime({
    summary: "grouped structure edit",
    operation: {
        opId: "detach",
        kind: "detachDisplayNode",
        selector,
    },
    inverseOperation: {
        opId: "attach-undo",
        kind: "attachDisplayNode",
        selector: { packageId: "package", componentResourceId: "component" },
        atIndex: 0,
        node: { id: "node", kind: "graph" },
    },
    operations: [
        { opId: "detach", kind: "detachDisplayNode", selector },
        {
            opId: "attach",
            kind: "attachDisplayNode",
            selector: { packageId: "package", componentResourceId: "component" },
            atIndex: 0,
            node: { id: "node", kind: "graph" },
        },
    ],
    inverseOperations: [
        { opId: "detach-undo", kind: "detachDisplayNode", selector },
        {
            opId: "attach-undo",
            kind: "attachDisplayNode",
            selector: { packageId: "package", componentResourceId: "component" },
            atIndex: 0,
            node: { id: "node", kind: "graph" },
        },
    ],
});
assert.equal(grouped.ok, true);
groupedAdapter.markSaved();
assert.equal((await groupedAdapter.undoLastWithRuntime()).ok, true);
assert.equal(groupedAdapter.getSessionState().dirty, true);
assert.equal((await groupedAdapter.redoLastWithRuntime()).ok, true);
assert.equal(groupedAdapter.getSessionState().dirty, false);
assert.deepEqual(appliedGroups, [
    ["detachDisplayNode", "attachDisplayNode"],
    ["detachDisplayNode", "attachDisplayNode"],
    ["detachDisplayNode", "attachDisplayNode"],
]);

const byteAdapter = new EditorCommandAdapter();
const byteSnapshot = createSnapshot();
let receivedByteInverse;
byteAdapter.reset(byteSnapshot);
byteAdapter.setLiveSessionRuntime({
    getState() {
        return {
            phase: "Phase 7A",
            status: "connected",
            liveSession: true,
            revision: 0,
            dirty: false,
            projectSource: "uam_baseline",
            workspaceRestoreStatus: "unavailable",
            boundary: "test",
        };
    },
    async applyTransaction(_operations, _expectedRevision, inverseOperations) {
        receivedByteInverse = inverseOperations;
        return { ok: true, revision: 1, dirty: true, diagnostics: [], raw: null };
    },
    getProjectSnapshot() {
        return byteSnapshot;
    },
});
const byteSelector = { packageId: "package", resourceId: "image" };
const byteInverse = {
    opId: "replace-image-undo",
    kind: "replaceResourceBytes",
    selector: byteSelector,
    sourceBytes: new Uint8Array([1, 2, 3]),
};
assert.equal((await byteAdapter.applyHighRiskTransactionWithRuntime({
    summary: "replace image bytes",
    operation: {
        opId: "replace-image",
        kind: "replaceResourceBytes",
        selector: byteSelector,
        sourceBytes: new Uint8Array([4, 5, 6]),
    },
    inverseOperation: byteInverse,
})).ok, true);
assert.deepEqual(receivedByteInverse, [byteInverse], "Byte replacement must preflight its exact inverse.");

const checkpointAdapter = new EditorCommandAdapter();
const checkpointSnapshot = createSnapshot();
checkpointAdapter.reset(checkpointSnapshot);
assert.equal(checkpointAdapter.applySetDisplayNodeProps({
    kind: "setDisplayNodeProps",
    selector,
    props: { position: { x: 1, y: 0 } },
}).ok, true);
const savedCheckpoint = checkpointAdapter.getCurrentStateId();
assert.equal(checkpointAdapter.applySetDisplayNodeProps({
    kind: "setDisplayNodeProps",
    selector,
    props: { position: { x: 2, y: 0 } },
}).ok, true);
checkpointAdapter.markSaved(savedCheckpoint);
assert.equal(
    checkpointAdapter.getSessionState().dirty,
    true,
    "Saving an older checkpoint must not mark a newer command as persisted.",
);

const misalignedAdapter = new EditorCommandAdapter();
const misalignedSnapshot = createSnapshot();
misalignedAdapter.reset(misalignedSnapshot, 2);
misalignedAdapter.setLiveSessionRuntime({
    getState() {
        return {
            status: "connected",
            revision: 3,
            dirty: false,
            projectSource: "browser_workspace",
            workspaceRestoreStatus: "restored",
            boundary: "test",
        };
    },
    async applyTransaction() {
        throw new Error("A revision-mismatched runtime must not receive commands.");
    },
    getProjectSnapshot() {
        return misalignedSnapshot;
    },
});
assert.equal(misalignedAdapter.getSessionState().liveSession, false);
const misalignedApply = await misalignedAdapter.applySetDisplayNodePropsWithRuntime({
    kind: "setDisplayNodeProps",
    selector,
    props: { position: { x: 9, y: 0 } },
});
assert.equal(misalignedApply.ok, false);
assert.equal(misalignedApply.error?.code, "live_session_revision_mismatch");
assert.equal(
    misalignedSnapshot.packages[0].components[0].children[0].x,
    0,
    "Product editing must not silently fall back to a local snapshot when live revisions diverge.",
);

const missingSnapshotAdapter = new EditorCommandAdapter();
let missingSnapshotRevision = 0;
let missingSnapshotApplyCount = 0;
missingSnapshotAdapter.reset(createSnapshot());
missingSnapshotAdapter.setLiveSessionRuntime({
    getState() {
        return {
            status: "connected",
            revision: missingSnapshotRevision,
            dirty: missingSnapshotRevision > 0,
            projectSource: "browser_workspace",
            workspaceRestoreStatus: "restored",
            boundary: "test",
        };
    },
    async applyTransaction() {
        missingSnapshotApplyCount += 1;
        missingSnapshotRevision += 1;
        return { ok: true, revision: missingSnapshotRevision, dirty: true, diagnostics: [], raw: null };
    },
    getProjectSnapshot() {
        return null;
    },
});
const missingSnapshotTransaction = {
    summary: "missing snapshot guard",
    operation: { opId: "detach-missing", kind: "detachDisplayNode", selector },
    inverseOperation: {
        opId: "attach-missing",
        kind: "attachDisplayNode",
        selector: { packageId: "package", componentResourceId: "component" },
        atIndex: 0,
        node: { id: "node", kind: "graph" },
    },
};
const missingSnapshotApply = await missingSnapshotAdapter.applyHighRiskTransactionWithRuntime(missingSnapshotTransaction);
assert.equal(missingSnapshotApply.ok, false);
assert.equal(missingSnapshotApply.error?.code, "snapshot_sync_missing");
assert.equal(missingSnapshotAdapter.getSessionState().liveSession, false);
assert.match(missingSnapshotAdapter.getSessionState().boundary, /without a synchronized project snapshot/);
const blockedAfterMissingSnapshot = await missingSnapshotAdapter.applyHighRiskTransactionWithRuntime(missingSnapshotTransaction);
assert.equal(blockedAfterMissingSnapshot.ok, false);
assert.equal(blockedAfterMissingSnapshot.error?.code, "snapshot_sync_missing");
assert.equal(missingSnapshotApplyCount, 1, "A missing live snapshot must block further transactions until reconnect.");

console.log(JSON.stringify({
    ok: true,
    verified: [
        "save checkpoint preserves Undo",
        "Undo and Redo restore dirty by state identity",
        "new edits clear the redo branch",
        "pivot and anchor share the same inverse history path",
        "unsupported pivot targets fail before mutation",
        "multi-select property edits stay in one history group",
        "pure common multi-selection command construction",
        "inferred component instance overlays undo without creating source state",
        "component custom property values and controller pages share one undo/redo group",
        "forward and inverse transaction groups stay atomic",
        "byte replacement inverse is preflighted before apply",
        "save marks the captured checkpoint rather than later commands",
        "revision mismatch blocks product-local fallback",
        "missing live snapshot blocks further transactions until reconnect",
    ],
}, null, 2));
