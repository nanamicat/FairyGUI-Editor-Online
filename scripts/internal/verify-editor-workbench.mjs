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
const productSource = readFileSync("src/editor/product/FairyGuiEditorProduct.ts", "utf8");
const shellSource = readFileSync("src/editor/EditorShell.ts", "utf8");
const shellChromeModuleSource = readFileSync("src/editor/modules/ShellChromeModule.ts", "utf8");
const projectSessionModuleSource = readFileSync("src/editor/modules/ProjectSessionModule.ts", "utf8");
const browserPluginsModuleSource = readFileSync("src/editor/modules/BrowserPluginsModule.ts", "utf8");
const resourceHealthModuleSource = readFileSync("src/editor/modules/ResourceHealthModule.ts", "utf8");
assert(mainSource.includes("createFairyGuiEditorWorkbench(mainView)"));
assert(mainSource.includes("workbench.start()"));
assert(productSource.includes("createEditorShellModule()"));
assert(productSource.includes("createAuthoringPreviewModule()"));
assert(productSource.includes("createShellChromeModule()"));
assert(productSource.includes("createProjectSessionModule()"));
assert(productSource.includes("createBrowserPluginsModule()"));
assert(productSource.includes("createResourceHealthModule()"));
assert(productSource.includes([
    "return [",
    "        createAuthoringPreviewModule(),",
    "        createShellChromeModule(),",
    "        createProjectSessionModule(),",
    "        createEditorShellModule(),",
    "        createBrowserPluginsModule(),",
    "        createResourceHealthModule(),",
].join("\n")));
assert(shellSource.includes("this.toolMenuContributions.values()"));
assert(shellSource.includes("this.toolMenuProviders"));
assert(!shellSource.includes("showResourceHealthDialog as openResourceHealthDialog"));
assert(!shellSource.includes("new BrowserPluginHost()"));
assert(!shellSource.includes("new BrowserProjectStorage("));
assert(!shellSource.includes("new BrowserLiveSessionBridge("));
assert(!shellSource.includes("new EditorCommandAdapter("));
assert(shellChromeModuleSource.includes("new EditorShellChrome(context.host.mainView)"));
assert(projectSessionModuleSource.includes("new EditorProjectSession()"));
assert(projectSessionModuleSource.includes("runExclusive<T>"));
assert(projectSessionModuleSource.includes("hotReloadable: false"));
assert(browserPluginsModuleSource.includes("new BrowserPluginHost()"));
assert(browserPluginsModuleSource.includes("shell.registerToolMenuProvider"));
assert(browserPluginsModuleSource.includes("pluginHost.dispose()"));
assert(browserPluginsModuleSource.includes('ui.setDebugAttribute("data-fairy-editor-plugin-host", "detached")'));
assert(resourceHealthModuleSource.includes("shell.registerToolMenuContribution"));
assert(resourceHealthModuleSource.includes('dialog?.name !== "desktopResourceHealthDialog"'));
assert(resourceHealthModuleSource.includes("dialog.dispose()"));

console.log(JSON.stringify({
    ok: true,
    modules: workbench.list().length,
    consumerActivations: consumerActivation,
    dynamicCleanup,
    rollbackVerified: true,
    cleanupFailureReported: true,
    productWiringVerified: true,
}));
