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
    createInspectorModule,
    EditorInspector,
    INSPECTOR_SERVICE,
} from "../modules/InspectorModule";
import {
    createProjectExplorerModule,
    EditorProjectExplorer,
    PROJECT_EXPLORER_SERVICE,
} from "../modules/ProjectExplorerModule";
import {
    AUTHORING_DIALOGS_SERVICE,
    createAuthoringDialogsModule,
    EditorAuthoringDialogs,
} from "../modules/AuthoringDialogsModule";
import {
    createTimelineModule,
    EditorTimeline,
    TIMELINE_SERVICE,
} from "../modules/TimelineModule";
import {
    createResourceAuthoringModule,
    EditorResourceAuthoring,
    RESOURCE_AUTHORING_SERVICE,
} from "../modules/ResourceAuthoringModule";
import {
    createFairyPackageExportModule,
    createFairyPackageImportModule,
    createWorkspaceExportModule,
    createWorkspaceImportModule,
    createRuntimePublishModule,
} from "../modules/ProjectTransferModules";
import { EditorWorkbench, type EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";

export const EDITOR_SHELL_MODULE_ID = "fairygui.editor-shell";

function createEditorShellModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: EDITOR_SHELL_MODULE_ID,
        hotReloadable: false,
        activate(context) {
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const session = context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE);
            const document = context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE);
            const inspector = context.requireService<EditorInspector>(INSPECTOR_SERVICE);
            const explorer = context.requireService<EditorProjectExplorer>(PROJECT_EXPLORER_SERVICE);
            const dialogs = context.requireService<EditorAuthoringDialogs>(AUTHORING_DIALOGS_SERVICE);
            const timeline = context.requireService<EditorTimeline>(TIMELINE_SERVICE);
            const resourceAuthoring = context.requireService<EditorResourceAuthoring>(RESOURCE_AUTHORING_SERVICE);
            const shell = new EditorShell(
                chrome,
                session,
                document,
                inspector,
                explorer,
                dialogs,
                timeline,
                resourceAuthoring,
            );
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
        createProjectExplorerModule(),
        createInspectorModule(),
        createAuthoringDialogsModule(),
        createTimelineModule(),
        createResourceAuthoringModule(),
        createEditorShellModule(),
        createFairyPackageImportModule(),
        createFairyPackageExportModule(),
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
