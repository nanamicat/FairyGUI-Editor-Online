import { createBrowserPluginsModule } from "../modules/BrowserPluginsModule";
import {
    createFairyPackageExportModule,
    createFairyPackageImportModule,
    createRuntimePublishModule,
    createWorkspaceImportModule,
} from "../modules/ProjectTransferModules";
import { createResourceHealthModule } from "../modules/ResourceHealthModule";
import { EditorWorkbench, type EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { createFairyGuiEditorCoreModules } from "./FairyGuiEditorCoreProduct";

export {
    createEditorShellModule,
    createFairyGuiEditorCoreModules,
    EDITOR_SHELL_MODULE_ID,
} from "./FairyGuiEditorCoreProduct";

export function createFairyGuiEditorProductModules(): EditorModule<FairyGuiEditorWorkbenchHost>[] {
    return [
        ...createFairyGuiEditorCoreModules(),
        createFairyPackageImportModule(),
        createFairyPackageExportModule(),
        createWorkspaceImportModule(),
        createRuntimePublishModule(),
        createBrowserPluginsModule(),
        createResourceHealthModule(),
    ];
}

export function createFairyGuiEditorWorkbench(mainView: fgui.GComponent): EditorWorkbench<FairyGuiEditorWorkbenchHost> {
    const workbench = new EditorWorkbench<FairyGuiEditorWorkbenchHost>({ mainView });
    workbench.install(createFairyGuiEditorProductModules());
    return workbench;
}
