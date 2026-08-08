import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const { EditorWorkbench } = await importTypeScriptModule("src/editor/workbench/EditorWorkbench.ts");
const events = [];
let consumerActivation = 0;
const workbench = new EditorWorkbench({ product: "test" });

workbench.install([
    {
        id: "test.provider",
        hotReloadable: false,
        activate(context) {
            context.provideService("test.value", { value: 42 });
            context.onDeactivate(() => events.push("provider:owned-cleanup"));
            return () => events.push("provider:deactivate");
        },
    },
    {
        id: "test.consumer",
        activate(context) {
            consumerActivation += 1;
            const service = context.requireService("test.value");
            assert.equal(service.value, 42);
            context.onDeactivate(() => events.push(`consumer:${consumerActivation}:owned-cleanup`));
            return () => events.push(`consumer:${consumerActivation}:deactivate`);
        },
    },
]);

await workbench.start();
assert.deepEqual(
    workbench.list().map((module) => ({ id: module.id, state: module.state, dependencies: module.dependencies })),
    [
        { id: "test.provider", state: "active", dependencies: [] },
        { id: "test.consumer", state: "active", dependencies: ["test.provider"] },
    ],
);
await assert.rejects(
    workbench.deactivate("test.provider"),
    /bound to the workbench lifecycle/,
);
await workbench.reload("test.consumer");
assert.equal(consumerActivation, 2);
assert.deepEqual(events.slice(0, 2), ["consumer:1:deactivate", "consumer:1:owned-cleanup"]);
await workbench.deactivate("test.consumer");
assert.equal(workbench.list()[1].state, "installed");
await workbench.activate("test.consumer");
assert.equal(consumerActivation, 3);
let dynamicCleanup = 0;
await workbench.attach({
    id: "test.dynamic",
    activate(context) {
        assert.equal(context.requireService("test.value").value, 42);
        return () => { dynamicCleanup += 1; };
    },
});
assert.equal(workbench.list().find((module) => module.id === "test.dynamic")?.state, "active");
await workbench.detach("test.dynamic");
assert.equal(dynamicCleanup, 1);
assert.equal(workbench.list().some((module) => module.id === "test.dynamic"), false);
await assert.rejects(
    workbench.attach({ id: "test.failure-dynamic", activate: () => { throw new Error("dynamic failed"); } }),
    /dynamic failed/,
);
assert.equal(workbench.list().some((module) => module.id === "test.failure-dynamic"), false);
await workbench.dispose();
assert.deepEqual(events.slice(-4), [
    "consumer:3:deactivate",
    "consumer:3:owned-cleanup",
    "provider:deactivate",
    "provider:owned-cleanup",
]);
assert(workbench.list().every((module) => module.state === "installed"));

const rollbackEvents = [];
const failingWorkbench = new EditorWorkbench({ product: "rollback" });
failingWorkbench.install([
    {
        id: "test.first",
        activate: () => () => rollbackEvents.push("first:deactivate"),
    },
    {
        id: "test.failure",
        activate: () => { throw new Error("activation failed"); },
    },
]);
await assert.rejects(failingWorkbench.start(), /activation failed/);
assert.deepEqual(rollbackEvents, ["first:deactivate"]);
assert.equal(failingWorkbench.list()[0].state, "installed");
assert.equal(failingWorkbench.list()[1].state, "error");
await failingWorkbench.dispose();

const cleanupWorkbench = new EditorWorkbench({ product: "cleanup-error" });
cleanupWorkbench.install([{
    id: "test.cleanup-error",
    activate: () => () => { throw new Error("cleanup failed"); },
}]);
await cleanupWorkbench.start();
await assert.rejects(cleanupWorkbench.dispose(), /cleanup failed/);
assert.equal(cleanupWorkbench.list()[0].state, "error");

const mainSource = readFileSync("src/Main.ts", "utf8");
const coreProductSource = readFileSync("src/editor/product/FairyGuiEditorCoreProduct.ts", "utf8");
const productSource = readFileSync("src/editor/product/FairyGuiEditorProduct.ts", "utf8");
const shellSource = readFileSync("src/editor/EditorShell.ts", "utf8");
const shellModuleHostSource = readFileSync("src/editor/workbench/EditorShellModuleHost.ts", "utf8");
const shellChromeModuleSource = readFileSync("src/editor/modules/ShellChromeModule.ts", "utf8");
const projectSessionModuleSource = readFileSync("src/editor/modules/ProjectSessionModule.ts", "utf8");
const authoringPreviewModuleSource = readFileSync("src/editor/modules/AuthoringPreviewModule.ts", "utf8");
const documentAuthoringModuleSource = readFileSync("src/editor/modules/DocumentAuthoringModule.ts", "utf8");
const inspectorModuleSource = readFileSync("src/editor/modules/InspectorModule.ts", "utf8");
const projectExplorerModuleSource = readFileSync("src/editor/modules/ProjectExplorerModule.ts", "utf8");
const authoringDialogsModuleSource = readFileSync("src/editor/modules/AuthoringDialogsModule.ts", "utf8");
const timelineModuleSource = readFileSync("src/editor/modules/TimelineModule.ts", "utf8");
const resourceAuthoringModuleSource = readFileSync("src/editor/modules/ResourceAuthoringModule.ts", "utf8");
const resourceAuthoringControllerSource = readFileSync("src/editor/ui/ResourceAuthoringController.ts", "utf8");
const projectTransferModuleSource = readFileSync("src/editor/modules/ProjectTransferModules.ts", "utf8");
const browserDownloadSource = readFileSync("src/editor/services/BrowserDownload.ts", "utf8");
const browserPluginsModuleSource = readFileSync("src/editor/modules/BrowserPluginsModule.ts", "utf8");
const resourceHealthModuleSource = readFileSync("src/editor/modules/ResourceHealthModule.ts", "utf8");
const editorDialogsSource = readFileSync("src/editor/dialogs/EditorDialogs.ts", "utf8");
assert(mainSource.includes("createFairyGuiEditorWorkbench(mainView)"));
assert(mainSource.includes("workbench.start()"));
assert(coreProductSource.includes("export function createEditorShellModule()"));
assert(coreProductSource.includes("export function createFairyGuiEditorCoreModules()"));
assert(!coreProductSource.includes("ProjectTransferModules"));
assert(!coreProductSource.includes("BrowserPluginsModule"));
assert(!coreProductSource.includes("ResourceHealthModule"));
assert(!coreProductSource.includes("createFairyPackageExportModule"));
assert(!coreProductSource.includes("createWorkspaceExportModule"));
assert(!coreProductSource.includes("createRuntimePublishModule"));
assert(productSource.includes("createFairyPackageImportModule()"));
assert(productSource.includes("createFairyPackageExportModule()"));
assert(productSource.includes("createWorkspaceExportModule()"));
assert(productSource.includes("createWorkspaceImportModule()"));
assert(productSource.includes("createRuntimePublishModule()"));
assert(productSource.includes("createBrowserPluginsModule()"));
assert(productSource.includes("createResourceHealthModule()"));
assert(coreProductSource.includes([
    "return [",
    "        createShellChromeModule(),",
    "        createProjectSessionModule(),",
    "        createAuthoringPreviewModule(),",
    "        createDocumentAuthoringModule(),",
    "        createProjectExplorerModule(),",
    "        createInspectorModule(),",
    "        createAuthoringDialogsModule(),",
    "        createTimelineModule(),",
    "        createResourceAuthoringModule(),",
    "        createEditorShellModule(),",
].join("\n")));
assert(productSource.includes([
    "return [",
    "        ...createFairyGuiEditorCoreModules(),",
    "        createFairyPackageImportModule(),",
    "        createFairyPackageExportModule(),",
    "        createWorkspaceImportModule(),",
    "        createWorkspaceExportModule(),",
    "        createRuntimePublishModule(),",
    "        createBrowserPluginsModule(),",
    "        createResourceHealthModule(),",
].join("\n")));
assert(shellChromeModuleSource.includes("getToolMenuContributions()"));
assert(shellChromeModuleSource.includes("getToolMenuProviders()"));
assert(shellChromeModuleSource.includes("registerActions(ids: EditorActionId[]"));
assert(!shellSource.includes("showResourceHealthDialog as openResourceHealthDialog"));
assert(!shellSource.includes("new BrowserPluginHost()"));
assert(!shellSource.includes("createModuleHost()"));
assert(!shellSource.includes("createBrowserPluginModuleContext"));
assert(!shellSource.includes("createResourceHealthDialogContext"));
assert(!productSource.includes("EDITOR_SHELL_MODULE_HOST_SERVICE"));
assert(!shellModuleHostSource.includes("EditorShellModuleHost"));
assert(!shellSource.includes("new BrowserProjectStorage("));
assert(!shellSource.includes("new BrowserLiveSessionBridge("));
assert(!shellSource.includes("new EditorCommandAdapter("));
assert(shellChromeModuleSource.includes("new EditorShellChrome(context.host.mainView)"));
assert(projectSessionModuleSource.includes("new EditorProjectSession()"));
assert(projectSessionModuleSource.includes("runExclusive<T>"));
assert(projectSessionModuleSource.includes("hotReloadable: false"));
assert(authoringPreviewModuleSource.includes("new AuthoringRuntimePackageLoader("));
assert(authoringPreviewModuleSource.includes("new RuntimePreviewController("));
assert(authoringPreviewModuleSource.includes("runtimeBundleRevision"));
assert(authoringPreviewModuleSource.includes("context.provideService(AUTHORING_PREVIEW_SERVICE, preview)"));
assert(authoringPreviewModuleSource.includes("return () => preview.dispose()"));
assert(authoringPreviewModuleSource.includes("hotReloadable: false"));
assert(!shellSource.includes("new DocumentWorkspaceController("));
assert(!shellSource.includes("new ActiveDocumentController("));
assert(!shellSource.includes("createAuthoringPreview("));
assert(!documentAuthoringModuleSource.includes("new AuthoringRuntimePackageLoader("));
assert(!documentAuthoringModuleSource.includes("new RuntimePreviewController("));
assert(!documentAuthoringModuleSource.includes("this.preview.dispose()"));
assert(documentAuthoringModuleSource.includes("new DocumentWorkspaceController("));
assert(documentAuthoringModuleSource.includes("new ActiveDocumentController("));
assert(documentAuthoringModuleSource.includes("authoringPreview.bind({"));
assert(documentAuthoringModuleSource.includes("AUTHORING_PREVIEW_SERVICE"));
assert(documentAuthoringModuleSource.includes("const document = new EditorDocumentAuthoring("));
assert(documentAuthoringModuleSource.includes("hotReloadable: false"));
assert(!shellSource.includes("new InspectorController("));
assert(inspectorModuleSource.includes("new EditorInspector("));
assert(inspectorModuleSource.includes("hotReloadable: false"));
assert(!shellSource.includes("new ResourcePreviewController("));
assert(!shellSource.includes("new ProjectTreeInteractionController("));
assert(!shellSource.includes("new LibraryController("));
assert(projectExplorerModuleSource.includes("new ResourcePreviewController("));
assert(projectExplorerModuleSource.includes("new ProjectTreeInteractionController("));
assert(projectExplorerModuleSource.includes("new LibraryController("));
assert(projectExplorerModuleSource.includes("hotReloadable: false"));
assert(projectExplorerModuleSource.includes("this.viewUnbinders.splice(0).reverse()"));
assert(projectExplorerModuleSource.includes("} catch (error) {"));
assert(projectExplorerModuleSource.includes("this.dispose();"));
assert(shellSource.includes("this.unbindProjectExplorer();"));
assert(!shellSource.includes("new AuthoringDialogController("));
assert(authoringDialogsModuleSource.includes("new AuthoringDialogController("));
assert(!shellSource.includes("new ControllerTimelineAuthoringController("));
assert(timelineModuleSource.includes("new ControllerTimelineAuthoringController("));
assert(!shellSource.includes("new ResourceAuthoringController("));
assert(resourceAuthoringModuleSource.includes("new ResourceAuthoringController("));
assert(resourceAuthoringModuleSource.includes("hotReloadable: false"));
assert(!resourceAuthoringControllerSource.includes('from "../services/FairyPackageTransfer"'));
assert(!shellSource.includes('from "./modules/ProjectTransferModules"'));
assert(!authoringDialogsModuleSource.includes('from "./ProjectTransferModules"'));
assert(browserDownloadSource.includes("URL.createObjectURL(blob)"));
assert(!shellSource.includes("exportBrowserWorkspaceZip"));
assert(!shellSource.includes("new ProjectImportDialog("));
assert(!shellSource.includes("applyProjectImportNow"));
assert(!shellSource.includes("publishBrowserRuntimeBundle"));
assert(projectTransferModuleSource.includes("createWorkspaceExportModule"));
assert(projectTransferModuleSource.includes("createWorkspaceImportModule"));
assert(projectTransferModuleSource.includes("createRuntimePublishModule"));
assert(projectTransferModuleSource.includes("createFairyPackageImportModule"));
assert(projectTransferModuleSource.includes("createFairyPackageExportModule"));
assert(projectTransferModuleSource.includes('id: "fairygui.fairy-package-import"'));
assert(projectTransferModuleSource.includes('id: "fairygui.fairy-package-export"'));
assert(projectTransferModuleSource.includes("hotReloadable: false"));
assert(projectTransferModuleSource.includes('["resource:importFairyPackage"]'));
assert(projectTransferModuleSource.includes('["resource:exportFairyPackageResources"]'));
assert(projectTransferModuleSource.includes("context.onDeactivate(() => transfer.dispose())"));
assert(projectTransferModuleSource.includes("publishRuntimeBundle(snapshot"));
assert(projectTransferModuleSource.includes("new ProjectImportDialog("));
assert(projectTransferModuleSource.includes('["toolbar:exportWorkspace"]'));
assert(projectTransferModuleSource.includes("await inFlight"));
assert(browserPluginsModuleSource.includes("new BrowserPluginHost()"));
assert(browserPluginsModuleSource.includes("chrome.registerToolMenuProvider"));
assert(browserPluginsModuleSource.includes("session.runExclusive"));
assert(browserPluginsModuleSource.includes("Promise.allSettled([...inFlight])"));
assert(browserPluginsModuleSource.includes("pluginHost.dispose()"));
assert(browserPluginsModuleSource.includes('ui.setDebugAttribute("data-fairy-editor-plugin-host", "detached")'));
assert(resourceHealthModuleSource.includes("chrome.registerToolMenuContribution"));
assert(resourceHealthModuleSource.includes("resourceAuthoring.selectLibraryResource"));
assert(resourceHealthModuleSource.includes("resourceAuthoring.repairResourceHealthIssue"));
assert(resourceHealthModuleSource.includes('["desktopResourceHealthDialog", "resourceHealthRepairDialog"]'));
assert(resourceHealthModuleSource.includes("dialog.dispose()"));
assert(editorDialogsSource.includes("options.setActiveDialog(dialog)"));

console.log(JSON.stringify({
    ok: true,
    modules: workbench.list().length,
    consumerActivations: consumerActivation,
    dynamicCleanup,
    rollbackVerified: true,
    cleanupFailureReported: true,
    productWiringVerified: true,
}));
