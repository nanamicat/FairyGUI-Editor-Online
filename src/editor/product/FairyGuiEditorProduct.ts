import { EditorShell } from "../EditorShell";
import {
    AUTHORING_PREVIEW_FACTORY_SERVICE,
    createAuthoringPreviewModule,
    type AuthoringPreviewControllerFactory,
} from "../modules/AuthoringPreviewModule";
import { createBrowserPluginsModule } from "../modules/BrowserPluginsModule";
import { createResourceHealthModule } from "../modules/ResourceHealthModule";
import { EditorWorkbench, type EditorModule } from "../workbench/EditorWorkbench";
import {
    EDITOR_SHELL_MODULE_HOST_SERVICE,
    type FairyGuiEditorWorkbenchHost,
} from "../workbench/EditorShellModuleHost";

export const EDITOR_SHELL_MODULE_ID = "fairygui.editor-shell";

function createEditorShellModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: EDITOR_SHELL_MODULE_ID,
        hotReloadable: false,
        activate(context) {
            const createAuthoringPreview = context.requireService<AuthoringPreviewControllerFactory>(
                AUTHORING_PREVIEW_FACTORY_SERVICE,
            );
            const shell = new EditorShell(context.host.mainView, createAuthoringPreview);
            context.provideService(EDITOR_SHELL_MODULE_HOST_SERVICE, shell.createModuleHost());
            return () => shell.dispose();
        },
    };
}

export function createFairyGuiEditorProductModules(): EditorModule<FairyGuiEditorWorkbenchHost>[] {
    return [
        createAuthoringPreviewModule(),
        createEditorShellModule(),
        createBrowserPluginsModule(),
        createResourceHealthModule(),
    ];
}

export function createFairyGuiEditorWorkbench(mainView: fgui.GComponent): EditorWorkbench<FairyGuiEditorWorkbenchHost> {
    const workbench = new EditorWorkbench<FairyGuiEditorWorkbenchHost>({ mainView });
    workbench.install(createFairyGuiEditorProductModules());
    return workbench;
}
