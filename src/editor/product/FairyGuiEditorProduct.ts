import { EditorShell } from "../EditorShell";
import {
    createAuthoringPreviewModule,
} from "../modules/AuthoringPreviewModule";
import { createBrowserPluginsModule } from "../modules/BrowserPluginsModule";
import { createResourceHealthModule } from "../modules/ResourceHealthModule";
import {
    createShellChromeModule,
    EditorShellChrome,
    SHELL_CHROME_SERVICE,
} from "../modules/ShellChromeModule";
import {
    createProjectSessionModule,
    EditorProjectSession,
    PROJECT_SESSION_SERVICE,
} from "../modules/ProjectSessionModule";
import {
    createDocumentAuthoringModule,
    DOCUMENT_AUTHORING_SERVICE,
    EditorDocumentAuthoring,
} from "../modules/DocumentAuthoringModule";
import {
    createWorkspaceExportModule,
    createWorkspaceImportModule,
    createRuntimePublishModule,
} from "../modules/ProjectTransferModules";
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
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const session = context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE);
            const document = context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE);
            const shell = new EditorShell(chrome, session, document);
            context.provideService(EDITOR_SHELL_MODULE_HOST_SERVICE, shell.createModuleHost());
            return () => shell.dispose();
        },
    };
}

export function createFairyGuiEditorProductModules(): EditorModule<FairyGuiEditorWorkbenchHost>[] {
    return [
        createAuthoringPreviewModule(),
        createShellChromeModule(),
        createProjectSessionModule(),
        createDocumentAuthoringModule(),
        createEditorShellModule(),
        createWorkspaceImportModule(),
        createWorkspaceExportModule(),
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
