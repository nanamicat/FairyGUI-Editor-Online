import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { importTypeScriptModule } from "../import-typescript-module.mjs";

const root = process.cwd();

function readSource(relativePath) {
    return readFileSync(path.join(root, relativePath), "utf8");
}

const editorShellSource = readSource("src/editor/EditorShell.ts");
const editorShellConfig = readSource("src/editor/EditorShellConfig.ts");
const desktopLayoutControllerSource = readSource("src/editor/ui/DesktopLayoutController.ts");
const editorUiExtensions = readSource("src/editor/ui/EditorUiExtensions.ts");
const browserPluginDialogSource = readSource("src/editor/dialogs/BrowserPluginDialog.ts");
const browserPluginsModuleSource = readSource("src/editor/modules/BrowserPluginsModule.ts");
const browserWorkspaceDialogSource = readSource("src/editor/dialogs/BrowserWorkspaceDialog.ts");
const projectImportDialogSource = readSource("src/editor/dialogs/ProjectImportDialog.ts");
const resourceHealthDialogSource = readSource("src/editor/dialogs/ResourceHealthDialog.ts");
const resourceHealthModuleSource = readSource("src/editor/modules/ResourceHealthModule.ts");
const projectSessionModuleSource = readSource("src/editor/modules/ProjectSessionModule.ts");
const shellChromeModuleSource = readSource("src/editor/modules/ShellChromeModule.ts");
const documentAuthoringModuleSource = readSource("src/editor/modules/DocumentAuthoringModule.ts");
const editorMenuControllerSource = readSource("src/editor/ui/EditorMenuController.ts");
const resourceAuthoringControllerSource = readSource("src/editor/ui/ResourceAuthoringController.ts");
const projectTreeInteractionSource = readSource("src/editor/ui/ProjectTreeInteractionController.ts");
const resourcePreviewSource = readSource("src/editor/ui/ResourcePreviewController.ts");
const resourceEditorsSource = readSource("src/editor/dialogs/ResourceEditors.ts");
const publishSettingsEditorSource = readSource("src/editor/dialogs/PublishSettingsEditor.ts");
const componentInstanceEditorSource = readSource("src/editor/dialogs/ComponentInstancePropertyEditors.ts");
const componentPropertyEditorSource = readSource("src/editor/dialogs/ComponentPropertyEditors.ts");
const listPropertyEditorSource = readSource("src/editor/dialogs/ListPropertyEditors.ts");
const textGraphPropertyEditorSource = readSource("src/editor/dialogs/TextGraphPropertyEditors.ts");
const editorCommandSource = readSource("src/editor/model/EditorCommand.ts");
const editorShell = [
    editorShellSource,
    editorShellConfig,
    readSource("src/editor/dialogs/ComponentInstancePropertyEditors.ts"),
    readSource("src/editor/dialogs/ComponentPropertyEditors.ts"),
    readSource("src/editor/dialogs/CommonDisplayPropertyEditors.ts"),
    readSource("src/editor/dialogs/ComponentTemplateEditors.ts"),
    browserWorkspaceDialogSource,
    browserPluginDialogSource,
    browserPluginsModuleSource,
    readSource("src/editor/dialogs/ControllerEditors.ts"),
    readSource("src/editor/dialogs/ListPropertyEditors.ts"),
    readSource("src/editor/dialogs/LoaderPropertyEditors.ts"),
    readSource("src/editor/dialogs/EditorDialogs.ts"),
    readSource("src/editor/dialogs/PreferencesDialog.ts"),
    readSource("src/editor/dialogs/ProjectSettingsEditor.ts"),
    projectImportDialogSource,
    readSource("src/editor/dialogs/RelationGearEditors.ts"),
    readSource("src/editor/dialogs/ReplaceObjectDialog.ts"),
    readSource("src/editor/dialogs/ResourceEditors.ts"),
    resourceHealthDialogSource,
    resourceHealthModuleSource,
    projectSessionModuleSource,
    shellChromeModuleSource,
    documentAuthoringModuleSource,
    readSource("src/editor/dialogs/TextGraphPropertyEditors.ts"),
    readSource("src/editor/dialogs/TimelineItemEditor.ts"),
    readSource("src/editor/ui/EditorFormControls.ts"),
    readSource("src/editor/ui/ActiveDocumentController.ts"),
    readSource("src/editor/ui/AuthoringDialogController.ts"),
    readSource("src/editor/ui/ControllerTimelineAuthoringController.ts"),
    desktopLayoutControllerSource,
    readSource("src/editor/ui/DocumentWorkspaceController.ts"),
    readSource("src/editor/ui/InspectorCommandPanel.ts"),
    readSource("src/editor/ui/InspectorController.ts"),
    readSource("src/editor/ui/InspectorPresentation.ts"),
    readSource("src/editor/ui/LibraryController.ts"),
    editorMenuControllerSource,
    editorUiExtensions,
    readSource("src/editor/ui/ProjectTreeInteractionController.ts"),
    resourcePreviewSource,
    resourceAuthoringControllerSource,
    readSource("src/editor/ui/TimelinePanelController.ts"),
    readSource("src/editor/runtime/PublishedTestController.ts"),
    readSource("src/editor/runtime/WorkspaceLifecycleController.ts"),
].join("\n");
const mainSource = readSource("src/Main.ts");
const inspectorCommandPanel = readSource("src/editor/ui/InspectorCommandPanel.ts");
const timelinePanelSource = readSource("src/editor/ui/TimelinePanelController.ts");
const activeDocumentControllerSource = readSource("src/editor/ui/ActiveDocumentController.ts");
const libraryControllerSource = readSource("src/editor/ui/LibraryController.ts");
const timelinePathEditor = readSource("src/editor/TimelinePathEditor.ts");
const timelinePathData = readSource("src/editor/model/TimelinePathData.ts");
const runtimePreview = readSource("src/editor/runtime/RuntimePreviewController.ts");
const desktopCanvasInteraction = readSource("src/editor/runtime/DesktopCanvasInteraction.ts");
const desktopHierarchyInteraction = readSource("src/editor/runtime/DesktopHierarchyInteraction.ts");
const desktopDocumentTabs = readSource("src/editor/runtime/DesktopDocumentTabs.ts");
const authoringTransactions = [
    "AuthoringTransactionTypes",
    "AuthoringTransactionSupport",
    "PackageComponentTransactions",
    "ResourceTransactions",
    "MovieClipTransactions",
    "MovieClipJtaCodec",
    "DisplayListReaders",
    "DisplayListTransactions",
    "ControllerTransactions",
    "TransitionTransactions",
    "GearTransactions",
].map((name) => readSource(`src/editor/commands/${name}.ts`)).join("\n");
const browserProjectImport = readSource("src/editor/services/BrowserProjectImport.ts");
const browserProjectStorage = readSource("src/editor/services/BrowserProjectStorage.ts");
const browserSaveCoordinator = readSource("src/editor/services/BrowserSaveCoordinator.ts");
const directoryWritebackPolicy = readSource("src/editor/services/DirectoryWritebackPolicy.ts");
const browserPluginHostSource = readSource("src/editor/runtime/BrowserPluginHost.ts");
const phase6Adapter = readSource("src/editor/commands/EditorCommandAdapter.ts");
const phase7Bridge = [
    readSource("src/editor/services/BrowserLiveSessionBridge.ts"),
    readSource("src/editor/services/BrowserSaveTargetVerifier.ts"),
].join("\n");
const phase7Prepare = readSource("scripts/prepare-browser-runtime.mjs");
const previewProjection = readSource("src/editor/runtime/AuthoringPreviewProjection.ts");
assert(editorUiExtensions.includes("export class EditorTooltipsWin extends fgui.GLabel"));
assert(editorUiExtensions.includes('setExtension("ui://Basic/TooltipsWin", EditorTooltipsWin)'));
for (const phrase of [
    "graph-backed",
    "public addComponent transaction",
    "Transaction unavailable:",
    "create one transaction",
    "OpenFairyGUI no longer stores",
    "not part of the OpenFairyGUI",
    "OpenFairyGUI does not expose",
    "no persistent OpenFairyGUI",
    "synchronized UAM snapshot",
]) {
    assert(!`${editorShell}\n${timelinePathEditor}\n${previewProjection}`.includes(phrase), `Product UI contains research wording: ${phrase}`);
}
assert(
    editorShell.includes("https://github.com/OpenFairyGUI/FairyGUI-Editor-Online")
        && editorShell.includes("https://fairygui.com/")
        && editorShell.includes("Laya.Event.LINK, this, this.onAboutDialogLink")
        && editorShell.includes('window.open(url, "_blank")'),
    "About dialog must expose the editor repository and FairyGUI website as external links.",
);
const publishedTestViewport = await importTypeScriptModule("src/editor/runtime/PublishedTestViewport.ts");
const inspectorPresentation = await importTypeScriptModule("src/editor/ui/InspectorPresentation.ts");
const projectSettingsEditor = await importTypeScriptModule("src/editor/dialogs/ProjectSettingsEditor.ts");
const browserLanguageFiles = await importTypeScriptModule("src/editor/services/BrowserLanguageFiles.ts");
const resourceHealthAudit = await importTypeScriptModule("src/editor/runtime/ResourceHealthAudit.ts");
const editorPreferences = await importTypeScriptModule("src/editor/runtime/EditorPreferences.ts");
const browserWorkspaceRegistry = await importTypeScriptModule("src/editor/runtime/BrowserWorkspaceRegistry.ts");
const browserPluginHost = await importTypeScriptModule("src/editor/runtime/BrowserPluginHost.ts");
const projectImportDialog = await importTypeScriptModule("src/editor/dialogs/ProjectImportDialog.ts");
const resourcePreview = await importTypeScriptModule("src/editor/ui/ResourcePreviewController.ts");
const resourceEditors = await importTypeScriptModule("src/editor/dialogs/ResourceEditors.ts");

assert.equal(projectImportDialog.formatFileSize(1000), "1000 B");
assert.equal(projectImportDialog.formatFileSize(1536), "1.5 KB");
assert.equal(projectImportDialog.formatFileSize(1572864), "1.5 MB");
assert.equal(resourcePreview.detectImageMimeType(Uint8Array.of(0x89, 0x50, 0x4e, 0x47), ""), "image/png");
assert.equal(resourcePreview.detectImageMimeType(Uint8Array.of(), "font.svg"), "image/svg+xml");
assert.equal(resourcePreview.detectSoundMimeType(Uint8Array.of(0x4f, 0x67, 0x67, 0x53), ""), "audio/ogg");
assert.equal(resourcePreview.detectSoundMimeType(Uint8Array.of(), "voice.mp3"), "audio/mpeg");
assert(resourcePreviewSource.includes("showComponent("));
assert(resourcePreviewSource.includes("this.componentPreview?.dispose()"));
assert(resourcePreviewSource.includes('menu.addItem("组件缩略图"'));
assert(runtimePreview.includes("async createLibraryComponentPreview("));
assert.equal((resourceEditorsSource.match(/addDialogBackground\(content\);/g) || []).length, 3);
assert(resourceAuthoringControllerSource.includes('"CreateFontDialog"'));
assert(resourceAuthoringControllerSource.includes('"CreateMovieClipDialog"'));
assert(resourceAuthoringControllerSource.includes('textureSetMode: content.getChild("cb3")'));
assert(publishSettingsEditorSource.includes("pendingImageAtlasModes"));
assert(publishSettingsEditorSource.includes("prepareSetImageResourceProps"));
for (const snippet of [
    '"properties:image"',
    '"properties:movieClip"',
    '"ImagePropsPanel"',
    '"MovieClipPropsPanel"',
    "outlineSoftness",
]) assert(`${editorShell}\n${textGraphPropertyEditorSource}`.includes(snippet), `Missing OpenFairyGUI 0.2.4 display property wiring: ${snippet}`);
for (const snippet of [
    'scrollBarDisplay.selectedIndex = current.scrollBarDisplay',
    '["No", "Click", "Double click"]',
]) assert(listPropertyEditorSource.includes(snippet), `Missing OpenFairyGUI 0.2.4 list/tree property wiring: ${snippet}`);
for (const snippet of [
    'setLabel("sound", initial.sound)',
    'direction.selectedIndex = initial.popupDirection',
    'titleColor: panel.getChild("titleColorSet")',
]) assert(componentInstanceEditorSource.includes(snippet), `Missing OpenFairyGUI 0.2.4 component instance wiring: ${snippet}`);
for (const snippet of [
    'designPanel.getChild("src")',
    'designImageForTest:',
    'pageController:',
    'showSound:',
    'hideSound:',
]) assert(componentPropertyEditorSource.includes(snippet), `Missing OpenFairyGUI 0.2.4 component property wiring: ${snippet}`);
for (const snippet of [
    "setResourceFolderAtlas",
    '"FolderPropertyDialog"',
    '"resourceFolder:atlas"',
]) assert(`${editorCommandSource}\n${resourceAuthoringControllerSource}\n${editorShell}`.includes(snippet), `Missing OpenFairyGUI 0.2.4 resource-folder Atlas wiring: ${snippet}`);
assert(runtimePreview.includes("setGraphPointEditing(enabled: boolean"));
assert(runtimePreview.includes("resolveDesktopCanvasRegularPolygonDistance"));
assert.deepEqual(
    resourceEditors.parseBitmapFont([
        'info face="Test" size=32 resizable=true colored=false',
        "common lineHeight=32",
        "char id=65 xoffset=1 yoffset=2 xadvance=20",
    ].join("\n")),
    {
        lines: [
            'info face="Test" size=32 resizable=true colored=false',
            "common lineHeight=32",
            "char id=65 xoffset=1 yoffset=2 xadvance=20",
        ],
        ttf: true,
        size: 32,
        xadvance: 0,
        resizable: true,
        colored: false,
        chars: [{ id: 65, imageId: "", xoffset: 1, yoffset: 2, xadvance: 20 }],
    },
);

assert(editorShellSource.includes('from "./EditorShellConfig"'));
assert(activeDocumentControllerSource.includes("private selection: ActiveDocumentSelection"));
assert(activeDocumentControllerSource.includes("setActiveSelection("));
assert(!editorShellSource.includes("this.activeDocument.packageId ="));
assert(!editorShellSource.includes("this.activeDocument.componentId ="));
assert(!editorShellSource.includes("private selectedResourceId ="));
assert(!editorShellSource.includes("private selectedResourceFolder:"));
assert(libraryControllerSource.includes("private inspectorSelection: LibraryInspectorSelection"));
assert(libraryControllerSource.includes("reconcileInspectorSelection(snapshot: EditorProjectSnapshot)"));
assert(!editorShellSource.includes("const TOOLBAR_ACTIONS"));
assert(editorShellConfig.includes("export const TOOLBAR_ACTIONS"));
assert(!editorShellSource.includes("private layoutPanelContents"));
assert(desktopLayoutControllerSource.includes("private layoutPanelContents"));
assert(projectSessionModuleSource.includes("private operationQueue: Promise<void>"));
assert(projectSessionModuleSource.includes("this.operationQueue.then(() => this.liveSessionBridge.reset())"));
assert(projectSessionModuleSource.includes("let pendingProjectSessionDisposal: Promise<void> = Promise.resolve();"));
assert(projectSessionModuleSource.includes("this.operationQueue = pendingProjectSessionDisposal;"));
assert(projectSessionModuleSource.includes("pendingProjectSessionDisposal = close.then("));
assert(editorShellSource.includes("this.projectSession.runExclusive(() => ("));
assert(editorShellSource.includes("this.disposed ? Promise.resolve(false) : task()"));
assert(editorShellSource.includes("return this.disposed ? false : this.initializeProjectSnapshotNow();"));
assert(!editorShellSource.includes("void this.initializeProjectSnapshot();"));
assert(editorShellSource.includes("runWorkspaceTextFileTask: async (task)"));
assert(!editorShellSource.includes("readWorkspaceTextFile:"));
assert(editorShell.includes("await options.runWorkspaceTextFileTask(async (files) =>"));
assert(editorShellSource.includes("if (!await this.initializeProjectSnapshotNow())"));
assert(editorShellSource.includes("private async connectBrowserLiveSession(): Promise<boolean>"));
assert(editorShellSource.includes("if (!await this.connectBrowserLiveSession() || this.disposed) return false;"));
assert(editorShellSource.includes("Browser live session connected without a synchronized project snapshot."));
assert(phase6Adapter.includes("markSaved(stateId = this.currentStateId)"));
assert(phase6Adapter.includes('"live_session_revision_mismatch"'));

assert.equal(
    inspectorPresentation.describeSaveTarget({ kind: "transaction", description: "Rename resource" }),
    "Rename resource",
);
assert.equal(inspectorPresentation.buildWorkspaceLifecycleLines, undefined);
assert.equal(inspectorPresentation.getBrowserSaveFailure({
    results: { save: { errorCode: "save_failed" }, reload: {} },
}), "save_failed");
assert.equal(inspectorPresentation.getWorkspaceLifecycleFailure({
    results: { reload: { message: "reload failed" } },
    diagnostics: [],
}), "reload failed");
assert.equal(
    inspectorPresentation.describeAuthoringPreviewProjection(null),
    "Authoring canvas refreshed for the active component.",
);
assert.equal(
    inspectorPresentation.describeAuthoringPreviewProjection({
        status: "unaffected",
        runtimeStatus: "publish-required",
    }),
    "Publish to update the runtime preview.",
);
assert.equal(inspectorPresentation.buildCommandHistoryLines, undefined);
assert(!editorShellSource.includes("private describePreviewProjection"));
assert(!editorShellSource.includes("private formatCommandHistory"));

const pluginManifest = browserPluginHost.parseBrowserPluginManifest({
    schemaVersion: 1,
    id: "example.selection-tools",
    name: "Selection tools",
    version: "1.0.0",
    entry: "index.mjs",
    permissions: ["project.read", "project.write", "ui.menu", "ui.panel"],
    contributes: {
        commands: [{ id: "example.selection-tools.nudge", title: "Nudge" }],
        panels: [{ id: "example.selection-tools.summary", title: "Summary" }],
    },
});
assert.equal(pluginManifest.contributes.commands[0].id, "example.selection-tools.nudge");
assert.throws(() => browserPluginHost.parseBrowserPluginManifest({
    ...pluginManifest,
    permissions: ["filesystem.raw"],
}), /Unsupported plugin permission/);
assert.deepEqual(browserPluginHost.validateBrowserPluginInvokeResult({
    panel: { title: "Summary", lines: ["one"] },
    commands: [{ kind: "setDisplayNodeProps" }],
}), {
    panel: { title: "Summary", lines: ["one"] },
    commands: [{ kind: "setDisplayNodeProps" }],
});
const pluginSelection = {
    packageId: "package",
    componentResourceId: "component",
    displayNodeId: "node",
};
assert.deepEqual(browserPluginHost.validateBrowserPluginWriteCommands({
    commands: [{
        kind: "setDisplayNodeProps",
        selector: pluginSelection,
        props: { position: { x: 3, y: 4 } },
    }],
}, pluginSelection), [{
    kind: "setDisplayNodeProps",
    selector: pluginSelection,
    props: { position: { x: 3, y: 4 } },
}]);
assert.throws(() => browserPluginHost.validateBrowserPluginWriteCommands({
    commands: [{
        kind: "setDisplayNodeProps",
        selector: { ...pluginSelection, displayNodeId: "other" },
        props: { position: { x: 3, y: 4 } },
    }],
}, pluginSelection), /current selection/);
assert.throws(() => browserPluginHost.validateBrowserPluginWriteCommands({
    commands: [{
        kind: "setDisplayNodeProps",
        selector: pluginSelection,
        props: { position: { x: Number.NaN, y: 4 } },
    }],
}, pluginSelection), /finite position/);

const persistedPlugin = (id) => ({
    manifestUrl: `http://localhost/plugins/${id}/plugin.json`,
    manifest: {
        schemaVersion: 1,
        id,
        name: id,
        version: "1.0.0",
        entry: "index.mjs",
        permissions: [],
        contributes: { commands: [], panels: [] },
    },
    source: "export async function activate() {}",
    enabled: false,
});
let persistedPlugins = JSON.stringify([
    persistedPlugin("fairygui.selection-summary"),
    persistedPlugin("example.user-plugin"),
]);
globalThis.window = { location: { href: "http://localhost/" } };
globalThis.localStorage = {
    getItem: () => persistedPlugins,
    setItem: (_key, value) => { persistedPlugins = value; },
};
const pluginHost = new browserPluginHost.BrowserPluginHost();
await pluginHost.initialize();
assert.deepEqual(pluginHost.list().map((plugin) => plugin.id), ["example.user-plugin"]);
assert.equal(persistedPlugins.includes("fairygui.selection-summary"), false);
pluginHost.dispose();
await assert.rejects(
    pluginHost.install("http://localhost/plugins/late/plugin.json"),
    /host is disposed/,
);
delete globalThis.localStorage;
delete globalThis.window;

const initialWorkspaceRegistry = browserWorkspaceRegistry.createDefaultBrowserWorkspaceRegistry("2026-08-01T00:00:00.000Z");
const addedWorkspace = browserWorkspaceRegistry.addBrowserWorkspace(
    initialWorkspaceRegistry,
    "Second Project",
    "2026-08-01T00:00:01.000Z",
);
assert.equal(addedWorkspace.registry.entries.length, 2);
assert.equal(addedWorkspace.entry.id, "fairygui-editor-online-workspace-second-project");
assert.equal(
    browserWorkspaceRegistry.activateBrowserWorkspace(
        addedWorkspace.registry,
        initialWorkspaceRegistry.activeId,
        "Original.fairy",
        "2026-08-01T00:00:02.000Z",
    ).entries.find((entry) => entry.id === initialWorkspaceRegistry.activeId)?.fairyPath,
    "Original.fairy",
);

const defaultPreferences = editorPreferences.createDefaultEditorPreferences();
assert.equal(
    editorPreferences.resolveEditorShortcut({ key: "f", ctrlKey: true }, defaultPreferences),
    "projectSearch",
);
const conflictingPreferences = {
    ...defaultPreferences,
    shortcuts: { ...defaultPreferences.shortcuts, save: "Ctrl+F" },
};
assert.equal(editorPreferences.findEditorShortcutConflicts(conflictingPreferences).length, 1);
assert.equal(
    editorPreferences.resolveEditorShortcut({ key: "f", ctrlKey: true }, conflictingPreferences),
    null,
);
assert.equal(
    editorPreferences.parseEditorPreferences(JSON.stringify({ componentPreviewEnabled: false })).componentPreviewEnabled,
    false,
);
const productPreferences = editorPreferences.parseEditorPreferences(JSON.stringify({
    language: "en",
    uiFont: "Inter",
    saveBeforePublish: false,
    publishAction: "all",
}));
assert.equal(productPreferences.language, "en");
assert.equal(productPreferences.uiFont, "Inter");
assert.equal(productPreferences.saveBeforePublish, false);
assert.equal(productPreferences.publishAction, "all");
assert(editorPreferences.EDITOR_SHORTCUTS.length >= 27, "Preferences must expose the expanded editor action set.");
assert.equal(editorPreferences.normalizeEditorShortcut("cmd + shift + tab"), "Ctrl+Shift+Tab");
for (const snippet of [
    '"使用指南"',
    '"快捷键说明"',
    "this.editorPreferences.publishAction",
    "this.editorPreferences.saveBeforePublish",
    "Laya.Config.defaultFont = font",
]) {
    assert(editorShellSource.includes(snippet), `Preferences or Help product wiring is missing: ${snippet}`);
}
for (const snippet of [
    "fairygui-editor-online.resource-imports.v1:",
    '"导入历史与失败重试…"',
    "private readonly retryImports",
    "this.retryImports.clear()",
]) {
    assert(resourceAuthoringControllerSource.includes(snippet), `Resource import history wiring is missing: ${snippet}`);
}
for (const snippet of ["expandedKeys", "collectExpandedKeys()", "restoredExpandedKeys"]) {
    assert(libraryControllerSource.includes(snippet), `Workspace Library view persistence is missing: ${snippet}`);
}
assert(editorShellSource.includes("twoColumn: this.panels.library") && editorShellSource.includes("state.twoColumn === true"));

const testSettings = publishedTestViewport.readPublishedTestAdaptationSettings({
    settings: {
        adaptation: {
            designResolutionX: 640,
            designResolutionY: 360,
            scaleMode: "ScaleWithScreenSize",
            screenMathMode: "MatchWidthOrHeight",
            devices: [{ name: "Fixture", resolutionX: 1280, resolutionY: 720 }],
        },
    },
});
assert.deepEqual(projectSettingsEditor.parseProjectAdaptationDevices([
    { name: "Desktop", x: "1920", y: "1080" },
]), {
    ok: true,
    devices: [{ name: "Desktop", resolutionX: 1920, resolutionY: 1080 }],
});
assert.equal(projectSettingsEditor.parseProjectAdaptationDevices([
    { name: "Desktop", x: "1920", y: "1080" },
    { name: "desktop", x: "1280", y: "720" },
]).ok, false);
assert.equal(projectSettingsEditor.parseProjectAdaptationDevices([
    { name: "Broken", x: "0", y: "720.5" },
]).ok, false);
assert.equal(projectSettingsEditor.nextProjectBranchName([]), "branch-1");
assert.equal(projectSettingsEditor.nextProjectBranchName(["branch-1", "BRANCH-2"]), "branch-3");
const languageProject = {
    packages: [{
        id: "pkg00001",
        resources: [{
            kind: "component",
            id: "cmp1",
            name: "Fixture",
            component: {
                displayList: [
                    {
                        kind: "text", id: "n1", name: "title", text: "Hello & <world>", tooltips: "Tip", autoClearText: false,
                        gears: [{ kind: "text", states: [{ value: { text: "State" } }], defaultValue: { text: "Default" } }],
                    },
                    { kind: "textInput", id: "n2", name: "input", text: "Draft", promptText: "Name", autoClearText: true },
                    { kind: "list", id: "n3", name: "list", listItems: [{ title: "One", selectedTitle: "Chosen" }] },
                    { kind: "component", id: "n4", name: "label", instanceProperties: { extensionType: "Label", title: "Caption", promptText: "Prompt" } },
                    { kind: "button", id: "n5", name: "button", title: "Accept", selectedTitle: "Accepted" },
                    { kind: "comboBox", id: "n6", name: "combo", title: "Mode", items: ["Easy", "Hard"] },
                ],
            },
        }],
    }],
};
const languageEntries = browserLanguageFiles.collectBrowserLanguageEntries(languageProject);
assert.equal(languageEntries.length, 14);
assert(!languageEntries.some((entry) => entry.name === "pkg00001cmp1-n2"), "autoClearText source must be skipped.");
assert(languageEntries.some((entry) => entry.name === "pkg00001cmp1-n2-prompt" && entry.text === "Name"));
const languageXml = browserLanguageFiles.createBrowserLanguageXml(languageProject, new Map([
    ["pkg00001cmp1-n1", "Translated & <safe>"],
]));
assert.match(languageXml, /name="pkg00001cmp1-n1" mz="title">Translated &amp; &lt;safe&gt;<\/string>/);
assert.equal(browserLanguageFiles.normalizeBrowserLanguagePath("i18n/en.xml"), "i18n/en.xml");
assert.throws(() => browserLanguageFiles.normalizeBrowserLanguagePath("../outside.xml"), /unsafe/);
assert.equal(testSettings.devices[0].name, "Fixture");
assert(testSettings.devices.some((device) => device.name === "Phone 720p"), "Generic default devices must remain available.");
assert.deepEqual(
    publishedTestViewport.resolvePublishedTestViewport(testSettings, {
        adaptation: true,
        deviceName: "Fixture",
        orientation: "landscape",
        screenMatch: "FitSize",
    }, 320, 180),
    {
        device: { name: "Fixture", resolutionX: 1280, resolutionY: 720 },
        scaleFactor: 2,
        viewportWidth: 640,
        viewportHeight: 360,
        contentX: 0,
        contentY: 0,
        contentWidth: 640,
        contentHeight: 360,
    },
);
const healthReport = await resourceHealthAudit.auditProjectResources({
    packages: [{
        id: "pkg",
        name: "Fixture",
        resources: [
            { kind: "image", id: "a", name: "unused", path: "/", sourceBytes: new Uint8Array([1, 2]) },
            { kind: "image", id: "b", name: "used", path: "/", sourceBytes: new Uint8Array([1, 2]) },
            { kind: "sound", id: "c", name: "Same", path: "/audio/", sourceBytes: new Uint8Array([3]) },
            { kind: "sound", id: "d", name: "same", path: "/audio/", sourceBytes: new Uint8Array([4]) },
            { kind: "image", id: "e", name: "entry", path: "/", exported: true, sourceBytes: new Uint8Array([5]) },
        ],
    }],
}, (selector) => selector.resourceId === "a" ? 0 : 1);
assert.equal(healthReport.scannedResources, 5);
assert.equal(healthReport.duplicateGroups, 1);
assert.equal(healthReport.unusedResources, 1);
assert.equal(healthReport.conflictGroups, 1);
assert.equal(healthReport.issues.find((issue) => issue.kind === "duplicate")?.repair, null);
assert.equal(healthReport.issues.find((issue) => issue.kind === "unused")?.repair, "remove");
assert.equal(healthReport.issues.find((issue) => issue.kind === "conflict")?.repair, "rename");
assert.deepEqual(
    publishedTestViewport.resolvePublishedTestViewport(testSettings, {
        adaptation: true,
        deviceName: "Fixture",
        orientation: "portrait",
        screenMatch: "",
    }, 320, 180),
    {
        device: { name: "Fixture", resolutionX: 1280, resolutionY: 720 },
        scaleFactor: 2,
        viewportWidth: 360,
        viewportHeight: 640,
        contentX: 20,
        contentY: 230,
        contentWidth: 320,
        contentHeight: 180,
    },
);

for (const relativePath of [
    "src/editor/commands/EditorCommandAdapter.ts",
    "src/editor/commands/DisplayNodePropsLogic.ts",
    "src/editor/commands/HighRiskAuthoringTransactions.ts",
    "src/editor/model/BrowserLiveSession.ts",
    "src/editor/model/BrowserWorkspace.ts",
    "src/editor/services/BrowserLiveSessionBridge.ts",
    "src/editor/services/BrowserSaveTargetVerifier.ts",
]) {
    assert(existsSync(path.join(root, relativePath)), `Renamed product module is missing: ${relativePath}`);
}

for (const relativePath of [
    "src/editor/commands/CommandAdapter.ts",
    "src/editor/commands/AuthoringHighRiskTransactions.ts",
    "src/editor/model/LiveSessionrowserLiveSession.ts",
    "src/editor/model/WorkspaceBrowserSave.ts",
    "src/editor/services/LiveSessionrowserLiveSessionBridge.ts",
    "src/editor/model/Phase3Transaction.ts",
    "src/editor/model/Phase5Publish.ts",
    "src/editor/model/CommandLiveSession.ts",
    "src/editor/model/LiveSessionSaveBridge.ts",
    "src/editor/services/Phase3TransactionReportLoader.ts",
    "src/editor/services/Phase5PublishReportLoader.ts",
    "src/editor/services/CommandLiveSessionReportLoader.ts",
    "src/editor/services/LiveSessionSaveBridgeReportLoader.ts",
]) {
    assert(!existsSync(path.join(root, relativePath)), `Legacy static report runtime file still exists: ${relativePath}`);
}
assert(!editorShell.includes("Phase 3 report replay"), "Legacy Phase 3 report replay must stay removed.");
assert(!editorShell.includes("Preview remains stale"), "Supported authoring operations must not report a stale editing canvas.");

const shellChecks = [
    "private configureToolbarCapabilities(): void",
    "Add an empty package.",
    "showEditMenu(anchor: fgui.GObject): void",
    "showResourceMenu(anchor: fgui.GObject | null = null): void",
    "private showToolsMenu(anchor: fgui.GObject): void",
    "showViewMenu(anchor: fgui.GObject): void",
    "private showHelpMenu(anchor: fgui.GObject): void",
    "async applyAuthoringAddPackage(): Promise<void>",
    "async applyAuthoringAddComponent(): Promise<void>",
    "private createComponentTemplateEditorContext(): ComponentTemplateEditorContext",
    'register(["toolbar:createComboBox"]',
    'comboBox: showComboBoxTemplateEditor',
    'register(["toolbar:createProgressBar"]',
    'progressBar: showProgressBarTemplateEditor',
    'register(["toolbar:createSlider"]',
    'slider: showSliderTemplateEditor',
    '"desktopMenuCreateScrollBar"',
    '"desktopMenuCreateWindowFrame"',
    '"desktopMenuCreatePopupMenu"',
    'dialogResource: "CreateComboBoxDialog"',
    'dialogResource: "CreatePopupMenuDialog"',
    "async applyAuthoringPackageRename(): Promise<void>",
    "requestAuthoringRemovePackage(): void",
    "async requestAuthoringMoveComponent(): Promise<void>",
    "showComponentProperties(): void",
    "appendComponentEditor(selectedComponent",
    '"component:properties"',
    "desktopComponentPropertiesDialog",
    "ComPropsPanel",
    'pivotPreset.tooltips = "选择轴心预设"',
    "data-fairy-editor-component-properties",
    '"componentMaskTarget"',
    '"componentHitTestTarget"',
    '.filter((node) => node.kind === "image" || node.kind === "graph")',
    'input.type = "color"',
    "data-fairy-editor-component-background-color",
    '"componentBackgroundColorClear"',
    "bgColor: backgroundEnabled ?",
    "showComponentExtensionProperties(): void",
    '`${current.extensionType}PropsPanel2`',
    '"baseSound"',
    '"downEffectValue"',
    '"dropdown"',
    '"titleType"',
    '"wholeNumbers"',
    '"fixedGripSize"',
    "data-fairy-editor-component-extension-properties",
    "showCommonDisplayProperties(): void",
    "showGroupProperties(): void",
    '"properties:common"',
    '"properties:group"',
    "showCommonDisplayPropertiesEditor(options",
    'createObject("Builder", "FilterPropsPanel")',
    "showGroupPropertiesEditor(options",
    'panel.name = "commandTextPanel"',
    '"gear", "relation"',
    'this.appendSection("Basic", "基本属性", basicPanel, lineWidth)',
    'createObject("Builder", "EffectPropsPanel")',
    '"Builder", "TextPropsPanel"',
    "props.textProperties = textProperties",
    "textEditor.color",
    "showGraphProperties(): void",
    'appendActionSection("Graph", "图形"',
    '"Builder", "GraphPropsPanel"',
    "props: { graphProperties: updated }",
    "showLoaderProperties(): void",
    'appendActionSection("Loader", "装载器"',
    '"Builder", "LoaderPropsPanel"',
    "props: { loaderProperties: updated }",
    "showLoader3DProperties(): void",
    'appendActionSection("Loader3D", "3D 装载器"',
    '"Builder", "Loader3DPropsPanel"',
    "props: { loader3DProperties: updated }",
    "data-fairy-editor-loader3d-properties",
    "showListProperties(): void",
    "function showListItemsEditor(",
    "showComponentInstanceProperties(): void",
    "function showComponentInstanceComboItemsEditor(",
    'appendActionSection("List", selectedNode.type === "GTree" ? "树" : "列表"',
    '"Builder", "ListPropsPanel"',
    '`${initial.extensionType}PropsPanel`',
    '"Builder", "ListLayoutPropsPanel"',
    '"Builder", "MarginPropsPanel"',
    '"Builder", "TreeSettingsPanel"',
    '"Builder", "ScrollPropsPanel"',
    '"Builder", "ListItemsEditDialog"',
    "props: { listProperties: updated }",
    "props: { componentInstanceProperties: updated }",
    "data-fairy-editor-list-properties",
    "private requestAuthoringRemoveComponent(): void",
    "async applyAuthoringResourceMove(): Promise<void>",
    "async applyAuthoringResourceRename(): Promise<void>",
    "async importImageResource(retryFile?: File): Promise<void>",
    "showImageEditor(): void",
    "desktopImageEditDialog",
    "data-fairy-editor-image-edit",
    "data-fairy-editor-image-import",
    "image-resource-import",
    "async importMovieClipResource(retryFiles?: File[]): Promise<void>",
    "async importMovieClipSpriteSheetResource(retryFiles?: File[]): Promise<void>",
    "showMovieClipEditor(): void",
    "desktopMenuImportMovieClip",
    "desktopMenuImportMovieClipSpriteSheet",
    "movieclip-resource-import",
    "movieclip-sprite-sheet-import",
    "data-fairy-editor-movieclip-import",
    "data-fairy-editor-movieclip-sprite-sheet-import",
    "data-fairy-editor-movieclip-edit",
    "async importSoundResource(retryFile?: File): Promise<void>",
    "data-fairy-editor-sound-import",
    "sound-resource-import",
    "async importBitmapFontResource(retryFiles?: File[]): Promise<void>",
    "desktopMenuImportBitmapFont",
    "pickBrowserFiles(",
    "bitmap-font-import",
    "data-fairy-editor-bitmap-font-import",
    "timelineActionSound",
    "timelineActionSoundVolume",
    "`ui://${selector.packageId}${resource.id}`",
    "timelineActionPathEdit",
    "timelineActionCustomEaseEdit",
    "data-fairy-editor-timeline-curve-draft",
    '"Builder", "EtcPropsPanel"',
    'otherPanel.getChild("customData")',
    "const customData = this.fields.customData?.text ?? selectedNode.customData",
    "data-fairy-editor-font-resource",
    "resource.type !== \"FontResource\"",
    "`ui://${selectedPackage.id}${resource.id}`",
    "系统 / 自定义（手动输入）",
    "data-fairy-editor-text-color",
    "async applyAuthoringDuplicateAssetResource(): Promise<void>",
    "async applyAuthoringReplaceAssetBytes(): Promise<void>",
    "requestAuthoringRemoveAssetResource(): void",
    "async applyAuthoringAddBinaryResource(): Promise<void>",
    "async applyAuthoringReplaceBinaryResource(): Promise<void>",
    "async pickAuthoringBinaryFile(action: \"add\" | \"replace\")",
    "pickBrowserFile(",
    "sourceBytes: new Uint8Array(await file.arrayBuffer())",
    "requestAuthoringRemoveBinaryResource(): void",
    "showRelationEditor(): void",
    '"display:relations"',
    "RelationPropsPanel",
    "RelationTypePopup",
    "data-fairy-editor-relations",
    "showGearEditor(): void",
    '"display:gears"',
    "GearPropsPanel",
    "fgui.GRoot.inst.hasModalWindow",
    'addItemFromPool("ui://Builder/GearPropsItem")',
    "desktopGearPageOverride",
    "desktopGearPositionsInPercent",
    "desktopGearTween",
    "data-fairy-editor-gears",
    "private async redoCommand(): Promise<void>",
    "showConfirmation(",
    "showEditorConfirmation(",
    "desktopMenuReplaceBinaryResource",
    "desktopMenuRemoveBinaryResource",
    "desktopMenuDuplicateAssetResource",
    "desktopMenuReplaceAssetResource",
    "desktopMenuRemoveAssetResource",
    "desktopMenuEditImageResource",
    "desktopControllerEditDialog",
    "data-fairy-editor-controller-editor",
    "data-fairy-editor-controller-pages",
    "data-fairy-editor-controller-actions",
    "data-fairy-editor-controller-action-editor",
    "controllerActionEditorDialog",
    "function showControllerActionEditor(",
    'nameHost.getChild("input").asTextInput.text = page.name',
    "desktopMenuRenamePackage",
    "desktopMenuRemovePackage",
    "desktopMenuMoveComponent",
    "snapshotRewrite",
    "desktopMenuRemoveComponent",
    "data-fairy-editor-transaction-remove-binary-confirmation",
    "data-fairy-editor-transaction-remove-package-confirmation",
    "data-fairy-editor-transaction-remove-component-confirmation",
    "data-fairy-editor-transaction-move-component-confirmation",
    "data-fairy-editor-preview-projection",
    "private toggleHierarchyExpansion(): void",
    "configureHierarchyTree(tree: fgui.GTree): void",
    "private onHierarchyDragStart(",
    "private onHierarchyDragMove(",
    "private onHierarchyDragEnd(",
    "private async applyHierarchyDrop(",
    "fgui.Events.DRAG_START",
    "prepareMoveDisplayNode(",
    "data-fairy-editor-hierarchy-drag",
    "data-fairy-editor-hierarchy-drop",
    "private copySelectedDisplayNodes(): boolean",
    "private cutSelectedDisplayNodes(): void",
    "private async pasteDisplayNodes(",
    "createDisplayNodeClipboard(",
    "preparePasteDisplayNodes(",
    "private showReplaceObjectDialog(): void",
    "prepareReplaceDisplayNodes(",
    'UIPackage.createObject("Builder", "ReplaceObjectDialog")',
    'UIPackage.createObject("Builder", "PasteOptionDialog")',
    "showCanvasContextMenu(): void",
    "private showSelectedDisplayNodeInLibrary(): void",
    "data-fairy-editor-display-node-clipboard",
    "data-fairy-editor-display-node-paste",
    "configureLibraryTree(tree: fgui.GTree): void",
    "private onLibraryFilterChanged(): void",
    'getChild("group").asComboBox',
    "private onLibraryDragStart(",
    "private onLibraryDragMove(",
    "private onLibraryDragEnd(",
    "private async applyLibraryDrop(",
    "preparePlaceResourceDisplayNode(",
    "data-fairy-editor-library-drop",
    "OBJECT_TOOLBAR_ACTIONS",
    '{ childName: "richtext", kind: "richText" }',
    '{ childName: "inputtext", kind: "textInput" }',
    '{ childName: "list", kind: "list" }',
    '{ childName: "loader", kind: "loader" }',
    '{ childName: "loader3D", kind: "loader3D" }',
    "private setDesktopObjectTool(",
    "private async groupSelectedDisplayNodes(): Promise<void>",
    "prepareGroupDisplayNodes(",
    "private async ungroupSelectedDisplayNodes(): Promise<void>",
    "prepareUngroupDisplayNodes(",
    "data-fairy-editor-object-group",
    "private async placeDesktopPrimitive(",
    "prepareAddPrimitiveDisplayNode(",
    "data-fairy-editor-object-create",
    "desktopMenuCopy",
    "desktopMenuPaste",
    "export class DesktopLayoutController",
    "private createSplitter(",
    "private onSplitterMouseDown(",
    "private onSplitterMouseMove(",
    "private onSplitterMouseUp(",
    "private toggleDesktopDock(",
    "DESKTOP_LAYOUT_STORAGE_KEY",
    "leftWidth: this.preferredLeftWidth ?? libraryDock.width",
    "rightWidth: this.preferredRightWidth ?? panels.inspector.width",
    "desktopMenuLeftDock",
    "desktopMenuInspectorDock",
    "desktopMenuTimeline",
    "data-fairy-editor-splitter",
    "data-fairy-editor-docks",
    "populateControllerPanel(): void",
    "item.enabled = liveSession",
    "private onControllerPanelItemClick(",
    "data-fairy-editor-controller-panel",
    "populateTimeline(): void",
    "private onStageMouseDown(event: Laya.Event): void",
    "data-fairy-editor-timeline-keyboard",
    "private onTimelineNameItemClick(",
    "private onTimelineRowItemClick(",
    "showAddTimelineItemEditor(): void",
    "showSelectedTimelineItemEditor(): void",
    "function showTimelineItemEditor(",
    "timelineAddAction",
    "timelineActionType",
    "data-fairy-editor-timeline-editor",
    "async duplicateSelectedTimelineItem(): Promise<void>",
    "async removeSelectedTimelineItem(): Promise<void>",
    "desktopMenuTimelineItemDuplicate",
    "desktopMenuTimelineItemAdd",
    "desktopMenuTimelineItemEdit",
    "desktopMenuTimelineItemRemove",
    "data-fairy-editor-timeline-item",
    "private onEditingTransitionBarClick(): void",
    "private onTimelineRowMouseDown(",
    "private onTimelineDragMouseMove(",
    "private onTimelineDragMouseUp(): void",
    "cancelTimelineDrag(",
    "async applyTimelineItemTiming(",
    "private toggleTimeline(): void",
    "data-fairy-editor-timeline-model",
    "data-fairy-editor-timeline-action",
    "playRuntimePreviewTransition(): void",
    "export class PublishedTestController",
    "start(): void",
    "reload(): void",
    "stop(updateStatus = true): void",
    "private onViewportControlChanged(): void",
    "private showPopup(anchor: fgui.GObject): void",
    "private toggleTooltips(anchor: fgui.GObject): void",
    "resolvePublishedTestViewport(",
    "showResourceHealthDialog(shell.createResourceHealthDialogContext())",
    "repairResourceHealthIssue(issue: ResourceHealthIssue, entries: ResourceHealthEntry[]): void",
    "prepareRemoveResources(project, entries)",
    "private prepareResourceHealthConflictRename(",
    'data-fairy-editor-resource-health',
    'openPreferencesDialog({',
    "private resetDesktopLayout(): void",
    "resolveEditorShortcut(event, this.editorPreferences)",
    "private readonly editorActions = new Map<EditorActionId, () => void>()",
    "private registerEditorActions(): void",
    'register(["toolbar:save", "save"]',
    "this.runEditorAction(id)",
    "export class ActiveDocumentController",
    "return this.activeDocument.restore(snapshot, selection)",
    "createPersistedSelection(",
    'data-fairy-editor-component-preview',
    'data-fairy-editor-layout-reset',
    'openBrowserWorkspaceDialog({',
    "private async switchBrowserWorkspace(entry: BrowserWorkspaceRegistryEntry): Promise<void>",
    'data-fairy-editor-workspace-switch',
    'data-fairy-editor-workspace-external',
    'setDebugAttribute("data-fairy-editor-test-runtime", "published")',
    '"data-fairy-editor-test-viewport"',
    "Runtime test blocked: Save and Publish the current authoring changes first.",
    "Runtime test blocked: Publish the saved workspace first.",
    "resetTree(tree: fgui.GTree): void",
    "tree.treeNodeRender = (node, cell) =>",
    "data-fairy-editor-dirty",
    'child.name.startsWith("inspectorSectionTitle")',
];

for (const snippet of shellChecks) {
    assert(editorShell.includes(snippet), `Missing UI interaction wiring: ${snippet}`);
}
for (const removedProductDiagnostic of [
    "showCapabilitySummary",
    "showCommandHistory",
    "Command session diagnostics",
    "Browser editor capability",
    "Typed common properties; Save/Reload verified.",
]) {
    assert(!editorShell.includes(removedProductDiagnostic), `Product UI still exposes diagnostic copy: ${removedProductDiagnostic}`);
}
for (const desktopInspectorComponent of [
    "TitleBar",
    "InfoPropsPanel",
    "BasicPropsPanel",
    "TextPropsPanel",
    "EffectPropsPanel",
    "EtcPropsPanel",
    "MultiSelectionPanel",
]) {
    assert(
        inspectorCommandPanel.includes(`createObject("Builder", "${desktopInspectorComponent}")`),
        `Inspector must reuse Builder/${desktopInspectorComponent}.`,
    );
}
assert(inspectorCommandPanel.includes("titleBar.changeStateOnClick = false"));
assert(inspectorCommandPanel.includes("this.list.removeChild(panel)"));
assert(inspectorCommandPanel.includes("this.list.addChildAt(panel, this.list.getChildIndex(titleBar) + 1)"));
assert(inspectorCommandPanel.includes('input.on(Laya.Event.BLUR, this, this.emit, ["command:apply"])'));
assert(inspectorCommandPanel.includes('input.nativeInput.focus = false'));
assert(!inspectorCommandPanel.includes('"commandApply"'));
assert(!inspectorCommandPanel.includes('"commandUndo"'));
assert(browserPluginDialogSource.includes('createObject("Builder", "PlugInView")'));
assert(!browserPluginDialogSource.includes('createObject("Builder", "ChoosePackageDialog")'));
for (const label of ["安装插件…", "重新载入", "权限：", "来源："]) {
    assert(browserPluginDialogSource.includes(label), `Browser plugin manager is missing visible label: ${label}`);
}
assert(browserWorkspaceDialogSource.includes('createObject("Builder", "ConfirmDialog")'));
assert(browserWorkspaceDialogSource.includes('getItemURL("Builder", "RecentItem")'));
assert(!browserWorkspaceDialogSource.includes('createObject("Builder", "ChoosePackageDialog")'));
for (const label of ["浏览器工作区", "默认工作区", "[当前]", "Folder 绑定跟随当前工作区", "新建工作区…", "打开"]) {
    assert(browserWorkspaceDialogSource.includes(label), `Workspace dialog is missing product copy: ${label}`);
}
for (const label of ["资源健康", "重复资源", "未使用资源", "名称冲突", "在资源库中定位", "全选", "反选", "清除"]) {
    assert(resourceHealthDialogSource.includes(label), `Resource health dialog is missing visible label: ${label}`);
}
assert(resourceHealthDialogSource.includes("dialog.centerOn(fgui.GRoot.inst, true)"));
for (const label of ["剪切", "复制", "粘贴", "搜索项目…", "显示资源库", "隐藏属性面板"]) {
    assert(editorMenuControllerSource.includes(label), `Desktop menu is missing localized label: ${label}`);
}
for (const copy of ["OPFS / IndexedDB", "Boundary:", "original dialog-confirm flow", "Runtime:"]) {
    assert(!projectImportDialogSource.includes(copy), `Project import still exposes implementation copy: ${copy}`);
}
for (const label of ["当前浏览器工作区", "工程文件：", "运行预览：", "保存时可写回所选文件夹"]) {
    assert(projectImportDialogSource.includes(label), `Project import is missing product copy: ${label}`);
}

for (const snippet of [
    "timelineCurvePlot",
    "timelineCurveAddPoint",
    "timelineCurveRemovePoint",
    "Apply Curve",
    "isValidCustomEasePath(points)",
]) {
    assert(timelinePathEditor.includes(snippet), `Timeline visual curve editor wiring is missing: ${snippet}`);
}
for (const snippet of [
    "parseTimelinePathData",
    "stringifyTimelinePathData",
    "createDefaultCustomEasePath",
]) {
    assert(timelinePathData.includes(snippet), `Timeline path-data contract is missing: ${snippet}`);
}
assert(timelinePathEditor.includes("new fgui.GPath()"), "Timeline curve drawing must reuse the FairyGUI runtime path sampler.");

for (const removedInspectorHarness of [
    "appendResourceEditor",
    "appendResourceFolderEditor",
    "appendPackageActions",
    "appendComponentActions",
]) {
    assert(!inspectorCommandPanel.includes(removedInspectorHarness), `Inspector still exposes authoring harness: ${removedInspectorHarness}`);
}
for (const rawJsonUi of [
    "showModelJsonEditor",
    "showAuthoringControllerJsonEditor",
    "showAuthoringTransitionJsonEditor",
    "showSelectedTimelineItemJsonEditor",
    "Advanced item JSON",
    "Polygon points JSON",
    "Regular polygon distances JSON",
]) {
    assert(!editorShell.includes(rawJsonUi), `Product UI still exposes raw JSON editing: ${rawJsonUi}`);
}
assert(resourceAuthoringControllerSource.includes('"desktopMenuMoveComponent"'), "Component operations must live in the Resource menu.");
assert(editorShellSource.includes("private setTransientStatus(message: string): void"), "Transient UI status must not append Console entries.");
assert(editorShellSource.includes("list.removeChildrenToPool();"), "Start scene must replace upstream placeholder rows with live workspaces.");
assert(
    editorShellSource.includes("[url=create]创建浏览器工作区[/url]")
        && editorShellSource.includes("[url=open]导入项目...[/url]")
        && editorShellSource.includes("[url=open_folder]从文件夹导入...[/url]"),
    "Start scene links must be configured for browser workspace import.",
);
assert(
    editorShellSource.includes('this.mainView.getChild("userInfo").visible = false;')
        && editorShellSource.includes('this.toolbar.getChild("tbImport").tooltips = "导入项目";'),
    "MainView browser-only visibility and toolbar labels must be configured at runtime.",
);
assert(!editorShellConfig.includes('"workspace:bootstrapWorkspace"'), "Product actions must not expose sample-workspace bootstrap.");

assert(resourceAuthoringControllerSource.includes('selectedResource.type === "MiscResource"'), "Binary replace/remove must stay limited to misc resources.");
assert(resourceAuthoringControllerSource.includes('selectedResource?.type === "Component"'), "Component actions must follow the selected snapshot resource type.");
assert(mainSource.includes('fgui.UIConfig.tooltipsWin = "ui://Basic/TooltipsWin";'), "Desktop hover tooltips must use the published Basic tooltip window.");
assert(
    editorUiExtensions.includes("export class EditorIconLoader extends fgui.GLoader")
        && editorUiExtensions.includes('if (this.name !== "icon") return;')
        && editorUiExtensions.includes("this.fill = fgui.LoaderFillType.Scale;")
        && editorUiExtensions.includes("this.shrinkOnly = true;")
        && editorUiExtensions.includes("fgui.UIObjectFactory.setLoaderExtension(EditorIconLoader);"),
    "Editor icon loaders must scale safely through the runtime factory extension.",
);
assert(
    editorUiExtensions.includes("title.ensureSizeCorrect();")
        && editorUiExtensions.includes("Math.ceil(title.textWidth) + 10"),
    "Tooltip text must drive its runtime window size.",
);
assert(
    editorUiExtensions.includes("fgui.Window.prototype.show = function(this: fgui.Window): void")
        && editorUiExtensions.includes("this.centerOn(fgui.GRoot.inst, true);"),
    "Editor windows must center automatically when shown.",
);
for (const snippet of [
    'this.createPanel("ViewGrid", "desktopLibraryDock")',
    '["资源", "library", "panel_lib"]',
    '["收藏", "favorites", "panel_favorite"]',
    '["搜索", "search", "panel_search"]',
    'this.libraryDock.getChild("tab2")',
    "library.width * 137 / 283",
    "slider.y - list.y",
]) {
    assert(editorShell.includes(snippet), `Desktop LibraryView alignment is missing: ${snippet}`);
}
for (const snippet of [
    'btnTwoColumn").asButton.selected = false',
    'list.visible = separator.visible = slider.visible = twoColumn',
    'this.listenClick(this.panels.library.getChild("btnCollapseAll"), this.collapseLibrary)',
    'data-fairy-editor-library-columns',
]) {
    assert(editorShell.includes(snippet), `Desktop single-column LibraryView behavior is missing: ${snippet}`);
}
for (const icon of ["icon_component", "icon_font", "icon_image", "icon_misc", "icon_movieclip", "icon_sound"]) {
    assert(libraryControllerSource.includes(`${icon}"`), `Library resource icon mapping is missing: ${icon}`);
}
assert(
    projectTreeInteractionSource.includes('cell.icon = icon ? fgui.UIPackage.getItemURL("Builder"'),
    "Library tree rows must assign and clear their desktop resource icons.",
);
assert(
    mainSource.indexOf("registerEditorUiExtensions();")
        < mainSource.indexOf('fgui.UIPackage.createObject("Builder", "MainView")'),
    "Editor UI extensions must be registered before MainView constructs package children.",
);
for (const url of [
    "ui://Basic/TextInput",
    "ui://Basic/TextArea",
    "ui://Basic/ResourceInput",
    "ui://Basic/NumericInput",
    "ui://Basic/XYInput",
    "ui://Builder/CustomArrangePanel",
    "ui://Builder/ConsoleView_item",
]) {
    assert(editorUiExtensions.includes(`setExtension("${url}"`), `Missing editor UI extension registration for ${url}.`);
}
assert(
    editorUiExtensions.includes("export class EditorCustomArrangePanel extends fgui.GComponent")
        && editorUiExtensions.includes("protected override onConstruct(): void"),
    "Plain GComponent extensions must initialize through the Laya FairyGUI onConstruct lifecycle.",
);
assert(
    !editorShellSource.includes('getChild("columnCount").asLabel.title')
        && !editorShellSource.includes('getController("type").selectedIndex = levelIndex'),
    "Custom arrange and console item internals must remain encapsulated by editor UI extensions.",
);
assert(
    inspectorCommandPanel.includes("createInspectorNumericInput")
        && !editorShellSource.includes("Number(input.text.trim())"),
    "Inspector numeric parsing must use the registered NumericInput extension.",
);

assert(
    runtimePreview.includes("playFirstTransition(): { ok: boolean; transitionName?: string }"),
    "Missing runtime transition preview action.",
);
assert(runtimePreview.includes("this.previewRoot?.getTransitionAt(0)"), "Transition preview must target the published runtime root.");
assert(
    runtimePreview.includes("playTransition(name: string): { ok: boolean; transitionName?: string }"),
    "Missing selected runtime transition preview action.",
);
assert(
    runtimePreview.includes("this.previewRoot?.getTransition(name)"),
    "Selected transition preview must resolve against the published runtime root.",
);
assert(
    runtimePreview.includes("requiresRuntimePublish(): boolean"),
    "Published test mode must honor the runtime publish-required boundary.",
);

for (const snippet of [
    "export function prepareImageRename(",
    "export function prepareAddPackage(",
    "export function prepareRenamePackage(",
    "export function prepareRemovePackage(",
    "export function prepareAddComponent(",
    "export function prepareSetComponentSize(",
    "export function prepareMoveComponent(",
    "export function prepareRemoveComponent(",
    "export function prepareResourceRename(",
    "export function prepareDuplicateAssetResource(",
    "export function prepareImportImageResource(",
    "export function prepareSetImageResourceProps(",
    "export function readImageResourceProps(",
    "export function prepareImportMovieClipResource(",
    "export function prepareUpdateMovieClipResource(",
    "export function parseMovieClipJta(",
    "export function findOpaqueBounds(",
    "export function prepareImportBitmapFontResources(",
    "export function prepareImportSoundResource(",
    "export function prepareReplaceAssetBytes(",
    "export function prepareRemoveAssetResource(",
    "export function prepareAddBinaryResource(",
    "export function prepareReplaceBinaryResource(",
    "export function prepareRemoveBinaryResource(",
    "export function inspectComponent(",
    "export function inspectDisplayNode(",
    "export function getDisplayNodeRelationModel(",
    "export function prepareUpdateDisplayNodeRelations(",
    "export function getDisplayNodeGearEditorModel(",
    "export function createTypedGearModel(",
    "export function prepareUpdateDisplayNodeGears(",
    "export function displayNodeSupportsGearKind(",
    "export function prepareMoveDisplayNode(",
    "export function createDisplayNodeClipboard(",
    "export function preparePasteDisplayNodes(",
    "export function prepareReplaceDisplayNodes(",
    "export function preparePlaceResourceDisplayNode(",
    "export function prepareAddPrimitiveDisplayNode(",
    "export function getControllerModel(",
    "export function prepareUpdateControllerModel(",
    "export function insertControllerPageDraft(",
    "export function removeControllerPageDraft(",
    "export function moveControllerPageDraft(",
    "export function createControllerActionDraft(",
    "export function removeControllerActionDraft(",
    "export function moveControllerActionDraft(",
    "export function getTransitionModel(",
    "export function prepareUpdateTransitionModel(",
    "export function getGearModel(",
    "export function prepareAddGenericGear(",
    "export function prepareUpdateGenericGearModel(",
    "export function prepareRemoveGenericGear(",
    "export function prepareUpdateController(",
    "export function prepareAddController(",
    "export function prepareRemoveController(",
    "export function prepareUpdateTransition(",
    "export function prepareDuplicateTransitionItem(",
    "export function prepareAddTransitionItemModel(",
    "export function createTransitionItemModel(",
    "export function prepareRemoveTransitionItem(",
    "export function prepareUpdateTransitionItemModel(",
    "export function prepareUpdateTransitionItemTiming(",
    "export function prepareAddTransition(",
    "export function prepareRemoveTransition(",
    "export function prepareUpdateLookGear(",
    "export function prepareAddLookGear(",
    "export function prepareRemoveLookGear(",
    "export interface BinaryFileInput",
    "fileInput: BinaryFileInput",
    "new Uint8Array(normalizedFile.sourceBytes)",
    "path: \"/imported/images/\"",
    "path: \"/imported/sounds/\"",
    "image: {",
    "export function prepareAddNonLookGear(",
    "export function prepareUpdateNonLookGear(",
    "export function prepareRemoveNonLookGear(",
    "kind: \"addResource\"",
    "kind: \"setImageResourceProps\"",
    "kind: \"replaceResourceBytes\"",
    "kind: \"removeResource\"",
    "kind: \"addPackage\"",
    "kind: \"renamePackage\"",
    "kind: \"removePackage\"",
    "kind: \"addComponent\"",
    "kind: \"moveComponent\"",
    "kind: \"removeComponent\"",
    "kind: \"addGear\"",
    "kind: \"updateGear\"",
    "kind: \"removeGear\"",
]) {
    assert(authoringTransactions.includes(snippet), `Missing Phase 9 transaction preparation: ${snippet}`);
}
assert(!authoringTransactions.includes("controllers?.[0]"), "Phase 9 controller actions must require an exact selected name.");
assert(!authoringTransactions.includes("transitions?.[0]"), "Phase 9 transition actions must require an exact selected name.");
assert(!authoringTransactions.includes("new Uint8Array([1, 9, 2, 9])"), "Binary add must not use placeholder bytes.");
assert(!authoringTransactions.includes("new Uint8Array([9, 2, 9, 1])"), "Binary replace must not use placeholder bytes.");
assert(!authoringTransactions.includes("cross_package_resource_placement_unsupported"), "Hydrated cross-package image and MovieClip placement must copy the resource instead of rejecting it.");
assert(authoringTransactions.includes("transition_dangling_target"), "Dangling transition targets must be explicitly guarded.");
assert(authoringTransactions.includes("operations:"), "Reorder/reparent and controller cascade must use an atomic transaction batch.");
assert(authoringTransactions.includes("prepareDetachDisplayNodes"), "Multi-node delete must use one atomic detach/attach batch.");
assert(authoringTransactions.includes("resourceId: selector.componentResourceId"), "Component lifecycle must resolve its resource selector before preparing a transaction.");
assert(authoringTransactions.includes("findComponentMoveReferenceRewrites"), "Component moves must prepare explicit inbound-reference rewrites.");
assert(authoringTransactions.includes("component_reference_rewrite_unsupported"), "Unsupported derived component references must stay closed.");
assert(
    authoringTransactions.includes('const encodedReference = `ui://${selector.packageId}`')
        && authoringTransactions.includes("detach-package-reference")
        && authoringTransactions.includes("attach-package-reference-undo"),
    "Package removal must reject encoded dependencies and atomically detach/restore direct display references.",
);
assert(
    authoringTransactions.includes("const incomingReferences = findComponentMoveReferenceRewrites(")
        && authoringTransactions.includes("detach-component-reference")
        && authoringTransactions.includes("attach-component-reference-undo"),
    "Component removal must atomically detach and restore incoming references.",
);
assert(authoringTransactions.includes("prepareSetComponentProperties"), "Component root properties must use one reversible transaction.");
assert(authoringTransactions.includes("readComponentProperties"), "Component root properties must preserve fields outside the current panel.");
assert(phase6Adapter.includes("transaction.operations?.length"), "The command adapter must submit Phase 9 transaction batches atomically.");
assert(phase6Adapter.includes("entry.inverseOperations"), "The command adapter must undo transaction batches atomically.");
assert(phase6Adapter.includes("entry.forwardOperations"), "The command adapter must redo transaction batches atomically.");
assert(phase6Adapter.includes("applySetDisplayNodePropsGroupWithRuntime"), "Multi-select display edits must share one command group.");
assert(phase6Adapter.includes("currentStateId !== this.savedStateId"), "Dirty state must follow the save checkpoint identity.");
assert(phase6Adapter.includes("this.savedStateId = stateId"), "Saving must move the captured checkpoint without clearing Undo.");
assert(phase7Bridge.includes("resource: summarizeNodeResourceReference(node, operation.selector.packageId)"), "Save/reload must verify rewritten component resource references.");
assert(phase7Bridge.includes("relations: summarizeNodeRelations(node)"), "Save/reload must verify attached display-node relations.");
assert(phase7Bridge.includes("actual.customData === expected.customData"), "Save/reload must verify custom display-node data.");
assert(phase7Bridge.includes("packageId === ownerPackageId ? undefined"), "Save/reload must normalize local resource references while keeping cross-package references strict.");
assert(phase7Bridge.includes('kind: "transactionBatch"'), "Save/reload must retain every operation in an atomic transaction batch.");
assert(phase7Bridge.includes("verifyTransactionBatchTarget"), "Save/reload must verify all transaction batch targets after reload.");
assert(phase7Bridge.includes('entity: "package"'), "Save/reload must verify package lifecycle targets.");
assert(phase7Bridge.includes('entity: "component"'), "Save/reload must verify component lifecycle targets.");
assert(phase7Bridge.includes("normalizeControllerForComparison"), "Controller action save targets must use source-fidelity normalization.");
assert(phase7Bridge.includes("delete action.name"), "Controller action save targets must ignore non-persisted action names.");
assert(
    phase7Bridge.includes("normalizeLatestTransactionOperations(this.workingProject, operations)"),
    "Browser transaction apply must normalize the exact alpha29 operation batch before backend apply.",
);
assert(phase7Prepare.includes("export { publishBrowser } from '@openfairygui/functions/web';"), "Phase 7 bundle must expose browser publish.");
for (const snippet of [
    "const bootstrap = await this.bootstrapWorkspace()",
    "publishRuntimeBundleInternal(",
    "sourceFileSystem: this.fileSystem",
    'outputFileSystem: adapter',
    'output = ".fairygui-runtime"',
    "await adapter.writeFile(manifestPath",
]) {
    assert(phase7Bridge.includes(snippet), `Missing browser runtime publish wiring: ${snippet}`);
}
assert(editorShell.includes("Browser publish blocked: save changes first."), "Dirty browser publish must require a saved checkpoint.");
assert(documentAuthoringModuleSource.includes("this.preview.resetRuntimePackages()"), "Successful browser publish must unload stale runtime packages.");

for (const snippet of [
    "export async function pickBrowserFile(",
    'input.type = "file"',
    "input.dataset.fairyEditorFilePicker = debugName",
    "if (isDirectoryPickerCancelled(error)) throw error;",
    "Intercepted by Page.setInterceptFileChooserDialog",
]) {
    assert(browserProjectImport.includes(snippet), `Missing native file picker wiring: ${snippet}`);
}

for (const snippet of [
    "onPreviewObjectMouseDown",
    "Laya.Event.MOUSE_MOVE",
    "Laya.Event.MOUSE_UP",
    "resolveDesktopCanvasDragPosition",
    "getDesktopCanvasMarqueeSelection",
    "commitMarqueeSelection",
    "event.altKey",
    "selectedNodeIds",
    "state.items.map",
    "onResizeHandleMouseDown",
    "commitNodeResize",
    "resolveDesktopCanvasResize",
    "resolveDesktopCanvasGroupResize",
    "onRotateHandleMouseDown",
    "commitNodeRotation",
    "resolveDesktopCanvasRotation",
    "resolveDesktopCanvasGroupRotation",
    "onPivotHandleMouseDown",
    "commitNodePivot",
    "resolveDesktopCanvasPivot",
    "onGraphPointHandleMouseDown",
    "commitGraphPoints",
    "RuntimePreviewGraphPointState",
    "runtimePreviewGraphPointHandle",
    "snapDesktopCanvasValue",
    "snapVerticalGuide",
    "adjustZoom(",
    "RuntimePreviewPanState",
    "setPanShortcutActive",
    "cancelActiveInteraction",
    "hasCanvasFocus",
    "onStageMouseDown",
    "resolveAuthoringDropPoint(",
    "setCreationMode(",
    "RuntimePreviewOpenNodeHandler",
    "RuntimePreviewContextMenuHandler",
    "Laya.Event.RIGHT_MOUSE_DOWN",
    "this.onContextMenu()",
    "DOUBLE_CLICK_INTERVAL_MS",
    "this.onOpenNode(node.id)",
]) {
    assert(runtimePreview.includes(snippet), `Missing desktop canvas preview interaction: ${snippet}`);
}
assert(runtimePreview.includes("projectAuthoringSnapshot("), "Runtime preview must use the explicit authoring projection planner.");
assert(
    runtimePreview.includes("for (let index = 0; index < root.numChildren; index += 1)")
        && runtimePreview.includes("this.previewObjects.set(object.id, object)")
        && runtimePreview.includes("this.runtimePublishRequired = true;"),
    "Authoring projection must track and hide published runtime children removed from the UAM snapshot.",
);
assert(
    editorShell.includes('selectionChanged ? "refresh-runtime-preview" : invalidation'),
    "Selection-changing structural commands must refresh runtime and then project the synchronized UAM snapshot.",
);
for (const snippet of [
    "AUTHORING_PREVIEW_PROJECTION_MATRIX",
    "export type ProjectionInvalidation",
    'attachDisplayNode: "live-structure"',
    'updateController: "live-model"',
    'replaceResourceBytes: "publish-required"',
    'setImageResourceProps: "publish-required"',
    'runtimeStatus: "current" | "publish-required"',
]) {
    assert(previewProjection.includes(snippet), `Missing authoring preview projection boundary: ${snippet}`);
}
for (const snippet of [
    "synchronizeAuthoringObjects",
    "createAuthoringProxy",
    "authoringProxyIds",
    "publishedRuntimeNodeOrder",
    "runtimePublishRequired",
    "projectedComponent",
    "new fgui.GComponent()",
    "this.previewRoot?.setSize(Math.max(1, component.width), Math.max(1, component.height))",
    "this.projectedComponent?.bgColorEnabled",
    'this.componentCanvasBackground.drawRect(0, "#000000", componentColor)',
    "keep authoring usable with the default font until Publish refreshes stale bitmap-font assets",
]) {
    assert(runtimePreview.includes(snippet), `Missing Authoring Canvas v2 projection: ${snippet}`);
}
assert(!previewProjection.includes('status: "stale"'), "Authoring canvas must not become stale for supported UAM operations.");
for (const snippet of [
    "commitPreviewNodePositions",
    "queueSelectedNodeNudge",
    "applyDesktopNodePositions",
    "commitPreviewNodeTransforms",
    "applyDesktopNodeTransforms",
    "group scale",
    "data-fairy-editor-canvas-size",
    "ALIGN_TOOLBAR_ACTIONS",
    "CUSTOM_ARRANGE_ACTIONS",
    "private onAlignToolbarAction(",
    "private showCustomArrangePanel(",
    "private applyCustomArrange(): void",
    "CustomArrangePanel",
    "data-fairy-editor-canvas-arrange",
    "resolveDesktopCanvasAlignment(",
    "resolveDesktopCanvasCustomArrange(",
    "data-fairy-editor-canvas-align",
    "commitPreviewNodeRotation",
    "applyDesktopNodeRotation",
    "commitPreviewNodePivot",
    "applyDesktopNodePivot",
    "commitPreviewGraphPoints",
    "applyDesktopGraphPoints",
    "data-fairy-editor-canvas-graph-point",
    "canvas group rotate",
    "data-fairy-editor-canvas-rotation",
    "data-fairy-editor-canvas-pivot",
    "data-fairy-editor-canvas-snap",
    "runtimePreview.adjustZoom",
    "data-fairy-editor-canvas-zoom",
    "data-fairy-editor-canvas-pan",
    "data-fairy-editor-canvas-tool",
    "Laya.Event.KEY_UP",
    "setPanShortcutActive(true)",
    "setDesktopPanTool",
    "selectedDisplayNodeIds",
    "resolveCommandTargetSelection",
    "applyDisplayNodePropsCommands",
    "applySetDisplayNodePropsGroupWithRuntime",
    "appendMultiSelectionEditor",
    "applyMultiSelectionCommand",
    'appendSection("MultiSelection", "多选属性", panel, lineWidth)',
    "data-fairy-editor-multi-inspector",
    "data-fairy-editor-canvas-selection-count",
    "data-fairy-editor-canvas-interaction",
    "getDesktopCanvasNudge",
]) {
    assert(editorShell.includes(snippet), `Missing desktop canvas command wiring: ${snippet}`);
}
for (const snippet of [
    "DESKTOP_CANVAS_DRAG_THRESHOLD",
    "hasDesktopCanvasDragMoved",
    "resolveDesktopCanvasDragPosition",
    "getDesktopCanvasNudge",
    "getDesktopCanvasBounds",
    "resolveDesktopCanvasGroupResize",
    "snapDesktopCanvasValue",
    "resolveDesktopCanvasRotation",
    "resolveDesktopCanvasPivot",
    "resolveDesktopCanvasGraphPoint",
    "resolveDesktopCanvasSharedValue",
    "resolveDesktopCanvasAlignment",
    "inferDesktopCanvasSpacing",
    "inferDesktopCanvasColumnCount",
    "resolveDesktopCanvasCustomArrange",
]) {
    assert(desktopCanvasInteraction.includes(snippet), `Missing desktop canvas interaction contract: ${snippet}`);
}
for (const snippet of [
    "resolveDesktopHierarchyDropIndex",
    "sourceIndex < targetIndex",
    "index === sourceIndex ? null",
]) {
    assert(desktopHierarchyInteraction.includes(snippet), `Missing desktop hierarchy interaction contract: ${snippet}`);
}
for (const snippet of [
    "private readonly hierarchyDock",
    "private createHierarchyDock(): fgui.GComponent",
    'tab.title = "显示列表"',
    "private appendHierarchyNodes(",
    "child.group !== parentGroupId",
    "private toggleAllHierarchyLocks(): void",
    "private handleHierarchyKey(event: Laya.Event): boolean",
    "private getHierarchySearchVisibleIds(",
    "private showHierarchyRenameDialog(): void",
    "private toggleAllHierarchyVisibility(): void",
    "prepareRenameDisplayNode(",
]) {
    assert(editorShell.includes(snippet), `Missing desktop display-list alignment wiring: ${snippet}`);
}
assert(
    !editorShellSource.includes('const rootNode = this.createTreeNode(true, selectedComponent.name);'),
    "Desktop display list must not render the active component as a synthetic root row",
);
for (const snippet of [
    "MIN_HIERARCHY_DOCK_HEIGHT = 122",
    'hierarchyDock.getChild("content").asCom',
    'this.formatBounds(hierarchyDock)',
]) {
    assert(desktopLayoutControllerSource.includes(snippet), `Missing hierarchy dock layout contract: ${snippet}`);
}
for (const snippet of [
    "cell.icon = icon ?",
    'cell.getChild("lock")?.asButton',
    'cell.getChild("status")?.asButton',
    "lock.selected = data?.locked === true",
    "status.selected = data?.hidden === true",
    "toggleHierarchyNodeLock(data: HierarchyItemData): void",
    "toggleHierarchyNodeHidden(data: HierarchyItemData): void",
]) {
    assert(projectTreeInteractionSource.includes(snippet), `Missing hierarchy row rendering contract: ${snippet}`);
}
for (const snippet of [
    "export function prepareRenameDisplayNode(",
    'kind: "detachDisplayNode"',
    'kind: "attachDisplayNode"',
]) {
    assert(authoringTransactions.includes(snippet), `Missing atomic display-node rename contract: ${snippet}`);
}
for (const snippet of [
    "setEditorHiddenNodeIds(nodeIds: Iterable<string>): void",
    "setShowAllInvisibleNodes(enabled: boolean): void",
]) {
    assert(runtimePreview.includes(snippet), `Missing editor-only display visibility contract: ${snippet}`);
}
for (const snippet of [
    "openDesktopDocumentTab",
    "closeDesktopDocumentTab",
    "cycleDesktopDocumentTab",
    "reconcileDesktopDocumentTabs",
    "resolveDesktopReferencedComponentTab",
]) {
    assert(desktopDocumentTabs.includes(snippet), `Missing desktop document tab contract: ${snippet}`);
}
for (const snippet of [
    "private onTabClick(",
    "private onDocumentTabClose(",
    "private activateDocumentTab(",
    "data-fairy-editor-document-tab-count",
    "openDocuments:",
    "private openReferencedComponent(",
    "data-fairy-editor-open-reference",
    "private async duplicateSelectedDisplayNodes(",
    "private async deleteSelectedDisplayNodes(",
    "data-fairy-editor-display-node-duplicate",
    "data-fairy-editor-display-node-delete",
]) {
    assert(editorShell.includes(snippet), `Missing desktop document tab wiring: ${snippet}`);
}
assert(
    editorShell.includes("const selectedTargets = shareComponent ? targets : [lastTarget]"),
    "Cross-component Undo/Redo must select the surviving attach target.",
);
const canvasPointerMove = runtimePreview.slice(
    runtimePreview.indexOf("private onPreviewObjectMouseMove"),
    runtimePreview.indexOf("private onPreviewObjectMouseUp"),
);
assert(
    !canvasPointerMove.includes("onMoveNode"),
    "Pointer move must update only the temporary preview, not submit transactions.",
);
const canvasPointerUp = runtimePreview.slice(
    runtimePreview.indexOf("private onPreviewObjectMouseUp"),
    runtimePreview.indexOf("private async commitNodeDrag"),
);
assert(
    canvasPointerUp.includes("commitNodeDrag"),
    "Pointer up must commit the final canvas drag position.",
);
const timelinePointerMove = timelinePanelSource.slice(
    timelinePanelSource.indexOf("private onTimelineDragMouseMove"),
    timelinePanelSource.indexOf("private onTimelineDragMouseUp"),
);
assert(
    !timelinePointerMove.includes("applyAuthoringPreparation"),
    "Timeline pointer move must update only the temporary range.",
);
const timelinePointerUp = timelinePanelSource.slice(
    timelinePanelSource.indexOf("private onTimelineDragMouseUp"),
    timelinePanelSource.indexOf("}", timelinePanelSource.indexOf("private onTimelineDragMouseUp")) + 1,
);
assert(
    timelinePointerUp.includes("callbacks.onTimingChange"),
    "Timeline pointer up must commit exactly one transition update.",
);
const stageKeyDown = editorShell.slice(
    editorShell.indexOf("private onStageKeyDown"),
    editorShell.indexOf("private onMenuItemClick"),
);
assert(
    stageKeyDown.includes("runtimePreview.hasCanvasFocus()"),
    "Arrow-key nudge must be scoped to canvas focus.",
);
const displayPropsApply = editorShell.slice(
    editorShell.indexOf("private async applyDisplayNodePropsCommand"),
    editorShell.indexOf("private async undoCommand"),
);
assert(
    displayPropsApply.includes("liveSessionBridge.getProjectSnapshot()"),
    "Low-risk apply must synchronize the EditorShell snapshot from the live bridge.",
);
const displayPropsUndo = editorShell.slice(
    editorShell.indexOf("private async undoCommand"),
    editorShell.indexOf("private async applyAuthoringPreparation"),
);
assert(
    displayPropsUndo.includes("liveSessionBridge.getProjectSnapshot()"),
    "Low-risk undo must synchronize the EditorShell snapshot from the live bridge.",
);
const authoringPreparation = editorShellSource.slice(
    editorShellSource.indexOf("private async applyAuthoringPreparation"),
    editorShellSource.indexOf("private refreshPreviewForSelectedNode"),
);
assert(authoringPreparation.includes("this.liveSessionBridge.captureSessionIdentity()"));
assert(authoringPreparation.includes("this.liveSessionBridge.isSessionIdentityCurrent(preparationIdentity)"));
assert(authoringPreparation.includes("Operation cancelled because the project changed while it was queued."));
assert((editorShell.match(/applyAuthoringPreparation\(preparation, preparationIdentity\)/g) || []).length >= 9);
assert(editorShellSource.includes("const preparation = prepareDetachDisplayNodes("));
assert(!editorShell.includes("let preparation: HighRiskTransactionPreparation | null = null;"));
for (const passThrough of [
    "populateInspectorForCurrentSelection",
    "clearInspectorActionButtons",
    "private readAuthoringText",
    "private get inspectorDockVisible",
    "private get selectedControllerName",
    "private set selectedControllerName",
    "private get selectedTransitionName",
    "private set selectedTransitionName",
]) assert(!editorShellSource.includes(passThrough), `Pure pass-through must stay removed: ${passThrough}`);
const projectRefresh = editorShellSource.slice(
    editorShellSource.indexOf("private async refreshProjectSnapshot"),
    editorShellSource.indexOf("private async publishBrowserRuntimeBundle"),
);
assert(projectRefresh.includes("enqueueAuthoringOperation"));
assert(projectRefresh.includes("applyLiveProjectSnapshot(snapshot)"));
assert(!projectRefresh.includes("commandAdapter.reset"));
const projectReset = editorShellSource.slice(
    editorShellSource.indexOf("private applyProjectSnapshot"),
    editorShellSource.indexOf("private applyLiveProjectSnapshot"),
);
assert(projectReset.includes("commandAdapter.reset(snapshot, revision)"));
const browserPublish = editorShellSource.slice(
    editorShellSource.indexOf("private async publishBrowserRuntimeBundle"),
    editorShellSource.indexOf("private async saveBrowserWorkspace"),
);
assert(browserPublish.includes("if (!this.commandAdapter.isLiveSessionAligned())"));
const browserSave = editorShellSource.slice(
    editorShellSource.indexOf("private async saveBrowserWorkspace"),
    editorShellSource.indexOf("private renderBrowserSaveResult"),
);
assert(browserSave.includes("enqueueAuthoringOperation"));
assert(browserSave.includes("getCurrentStateId()"));
assert(browserSave.includes("markSaved(checkpointStateId)"));
assert(browserSave.includes("result.results.save.revision === checkpointRevision"));
const createWorkspace = editorShellSource.slice(
    editorShellSource.indexOf("private async createBrowserWorkspace"),
    editorShellSource.indexOf("private async switchBrowserWorkspace"),
);
assert(createWorkspace.indexOf("enqueueAuthoringOperation") < createWorkspace.indexOf("workspaceLifecycle.addWorkspace(name)"));
for (const transition of ["switch", "close", "import"]) {
    assert(
        editorShellSource.includes(`guardWorkspaceTransition("${transition}"`),
        `${transition} must share the dirty workspace-transition guard.`,
    );
}
assert(
    libraryControllerSource.includes("this.treeInteraction.configureLibraryTree(tree);"),
    "Snapshot refresh must restore Library drag handlers after resetting the tree.",
);
assert(
    /if \(child\.isFolder\) \{\r?\n\s+const nested = find\(child\);/.test(editorShellSource),
    "Hierarchy selection restore must not read leaf-node children.",
);
assert(
    editorShellSource.includes('this.setDebugAttribute("data-fairy-editor-graph-point-editing", "inactive")'),
    "Escape must leave Polygon point-edit state inactive.",
);
assert(
    libraryControllerSource.includes('packageSelector.items = ["所有包", "我的工作区(本地)", ...groups.map((group) => group.name), "编辑分组…"]')
        && !libraryControllerSource.includes('createTreeNode(true, "Components")')
        && !libraryControllerSource.includes('createTreeNode(true, `Resources')
        && !libraryControllerSource.includes('createTreeNode(true, `Folders'),
    "Library filter and resource tree must match the desktop editor contract.",
);
assert(
    projectTreeInteractionSource.includes('fgui.UIPackage.getItemURL("Builder", "bullet_red")')
        && projectTreeInteractionSource.includes("this.context.isComponentExported"),
    "Exported components must render the desktop red-dot marker.",
);
assert(
    projectTreeInteractionSource.includes("Laya.Event.RIGHT_MOUSE_DOWN")
        && editorShellSource.includes("this.resourceAuthoring.showResourceMenu();")
        && editorShellSource.includes("data-fairy-editor-library-context"),
    "Library rows must open the existing Resource command menu on right click.",
);
assert(
    projectTreeInteractionSource.includes("Laya.Event.DOUBLE_CLICK")
        && projectTreeInteractionSource.includes("this.context.openLibraryItem(data)")
        && projectTreeInteractionSource.includes('data?.kind === "component" || data?.kind === "resource"')
        && editorShellSource.includes("private openLibraryItem(data")
        && editorShellSource.includes("this.authoringDialogs.showImageEditor()")
        && editorShellSource.includes("this.authoringDialogs.showMovieClipEditor()")
        && editorShellSource.includes("this.authoringDialogs.showFontEditor()")
        && editorShellSource.includes("this.resourcePreview.openWithBrowser(data.packageId, resource)"),
    "Library double click must open the desktop-equivalent editor for components and each resource type.",
);
assert(
    editorShellSource.includes("if (resource) this.resourcePreview.show(data.packageId, resource)")
        && editorShellSource.includes("this.activateDocumentTab({ packageId: data.packageId, componentId: data.componentId })"),
    "Library single click must update PreviewView while component documents open only from the double-click path.",
);
for (const snippet of [
    'resource.type === "MovieClipResource"',
    'resource.type === "FontResource"',
    'resource.type === "SoundResource"',
    "parseMovieClipJta(bytes)",
    "fgui.LoaderFillType.Scale",
    "this.loader.shrinkOnly = true",
    "Laya.loader.clearRes(url)",
    "URL.revokeObjectURL(url)",
    "window.clearTimeout(this.timer)",
    "window.open(url, \"_blank\")",
    "this.externalUrls.clear()",
]) {
    assert(resourcePreviewSource.includes(snippet), `Resource preview lifecycle is missing: ${snippet}`);
}
assert(
    resourceEditorsSource.includes('fgui.UIPackage.createObject("Builder", "FontEditDialog")')
        && resourceEditorsSource.includes("prepareReplaceAssetBytes(")
        && resourceEditorsSource.includes("releaseLayaObjectUrl(previewUrl)"),
    "Bitmap-font double click must use the desktop FontEditDialog with reversible bytes and preview cleanup.",
);
assert(
    editorShellSource.includes("if (!this.resourcePreview.play())")
        && editorShellSource.includes("this.resourcePreview.dispose()"),
    "Resource preview playback and disposal must be wired through EditorShell.",
);
assert(
    libraryControllerSource.includes("pkg.id === this.currentPackageId")
        && libraryControllerSource.includes("getSelectedPackageId: () => string")
        && !libraryControllerSource.slice(
            libraryControllerSource.indexOf("handlePackageChanged(): void"),
            libraryControllerSource.indexOf("setResourceSelection("),
        ).includes("applySelection"),
    "Library browsing package must stay independent from the active document package.",
);

for (const snippet of [
    "restoreWorkspaceBinding",
    "queryDirectoryWritePermission",
    "requestPermission",
    "DIRECTORY_WRITEBACK_CONFLICT",
    "compareDirectoryWritebackVersions",
    "createDirectoryWritebackBaseline",
    "writeDirectoryFilesWithRollback",
    "deletePersistedDirectoryBinding",
]) {
    assert(browserSaveCoordinator.includes(snippet), `Missing Folder write-back safety wiring: ${snippet}`);
}
const restoreDirectoryBinding = browserSaveCoordinator.slice(
    browserSaveCoordinator.indexOf("private async restoreDirectoryBinding"),
    browserSaveCoordinator.indexOf("private async clearDirectoryBinding"),
);
assert(
    restoreDirectoryBinding.includes("queryDirectoryWritePermission"),
    "Folder binding restore must query permission state.",
);
assert(
    !restoreDirectoryBinding.includes("requestPermission"),
    "Folder binding restore must not prompt for permission.",
);
assert(
    editorShell.includes("data-fairy-editor-workspace-folder-binding"),
    "Workspace UI must expose restored Folder binding state.",
);
assert(
    editorShell.includes("data-fairy-editor-workspace-writeback-conflicts"),
    "Folder conflict counts must remain observable without rendering diagnostics in the Inspector.",
);
assert(
    directoryWritebackPolicy.includes("SHA-256"),
    "Folder write-back policy must fingerprint the imported baseline.",
);
assert(browserProjectStorage.includes("async switchWorkspace(workspaceName: string, fairyPath: string)"));
assert(browserSaveCoordinator.includes("async switchWorkspace(workspaceName: string, fairyPath: string)"));
assert(browserSaveCoordinator.includes("async checkExternalChanges(): Promise<BrowserWorkspaceWriteback>"));
for (const snippet of [
    "BrowserPluginHost",
    "desktopMenuBrowserPlugins",
    "runBrowserPluginContribution",
    "Plugin v1 write supports only finite position.x/y",
    "data-fairy-editor-plugin-sandbox",
]) {
    assert(`${editorShell}\n${browserPluginHostSource}`.includes(snippet), `Missing browser plugin host wiring: ${snippet}`);
}
assert.equal(existsSync(path.join(root, "assets/resources/editor/plugins/selection-summary/plugin.json")), false);
assert.equal(existsSync(path.join(root, "assets/resources/editor/plugins/selection-summary/index.mjs")), false);
for (const snippet of [
    "parseProjectAdaptationDevices",
    'getChild("moveUp").asButton.onClick',
    'getChild("newLangFile").asButton.onClick',
    'getChild("syncLangFiles").asButton.onClick',
    "prepareSafeSvgImage",
    "prepareGifMovieClipFrames",
]) {
    assert(editorShell.includes(snippet), `Missing Project Settings or browser asset-format wiring: ${snippet}`);
}

console.log(JSON.stringify({
    ok: true,
    verified: [
        "action menus",
        "package/component lifecycle and component-size controls",
        "Phase 9 lifecycle, component props, resource, display-list, group membership, relation, controller/transition, and gear actions",
        "validated component mask, hit-test, background color, and authoring canvas projection wiring",
        "persistent component definition extension property editor wiring",
        "persistent Text, RichText, and InputText property editor wiring",
        "persistent Graph shape and geometry property editor wiring",
        "persistent Loader and Loader3D content, layout, playback, and fill property editor wiring",
        "persistent List and Tree layout, scroll, item, and tree-option editor wiring",
        "persistent component instance extension property editor wiring",
        "OpenFairyGUI 0.2.4 image, MovieClip, text, list/tree, component instance, component definition, and editable folder Atlas property wiring",
        "native browser image import and persistent image publish-property editor wiring",
        "validated self-contained SVG image import and persistent image publish-property editor wiring",
        "alpha-trimmed PNG/JPEG sequence, native GIF decode, and JSON/EAS/XML/plist Sprite Sheet import with persistent MovieClip JTA timing editor wiring",
        "native browser sound import and typed Timeline Sound wiring",
        "native bitmap font import and same-package selector wiring",
        "desktop-aligned hierarchy search, rename, visibility, lock, warning, and expand/collapse controls",
        "dirty-state status",
        "published runtime transition playback",
        "published runtime TestView with device adaptation, popup/tooltips, and Save/Publish boundary",
        "Project Settings device CRUD and browser-workspace AIR-compatible language XML generation",
        "read-only resource health audit with explicit atomic unused/conflict repair",
        "complete local Preferences, expanded conflict-safe shortcuts, Help guides, and layout reset",
        "workspace-isolated Library grouping, filtering, icon size, two-column, and expansion persistence",
        "resource import history with independent current-session failure retry and explicit GC cleanup",
        "isolated recent browser workspaces with dirty switch guard, explicit close, reauthorization, and external-change checks",
        "sandboxed versioned ESM browser plugins with explicit permissions and selection-only UAM command routing",
        "desktop canvas selection, grouped movement/scaling, resize, rotation, pivot, polygon points, snap, zoom, and pan wiring",
        "multi-selection Inspector common properties, alignment, equal sizing, distribution, and custom table arrangement wiring",
        "hierarchy reorder and cross-component reparent drag wiring",
        "UAM-backed copy/paste and fixed dock persistence wiring",
        "same-package and copied cross-package asset plus cross-package component Library placement wiring",
        "one-shot ObjectToolbar node creation and atomic Group/Ungroup wiring",
    "persistent multi-document component tabs",
        "component-reference document navigation",
        "Controller page, Timeline item lifecycle/value/timing, and AutoPlay transaction wiring",
        "Timeline motion-path and custom-ease visual editor wiring",
        "typed Controller page and action dialog wiring",
        "unified Undo/Redo, save checkpoint, and command grouping",
        "Authoring Canvas v2 snapshot projection and explicit runtime publish boundary",
        "workspace browser publish and runtime package refresh",
        "Folder handle restoration and conflict UI wiring",
    ],
}, null, 2));
