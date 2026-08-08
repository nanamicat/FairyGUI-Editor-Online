import { EditorShell } from "../EditorShell";
import { createAuthoringPreviewModule } from "../modules/AuthoringPreviewModule";
import {
    AUTHORING_DIALOGS_SERVICE,
    createAuthoringDialogsModule,
    EditorAuthoringDialogs,
} from "../modules/AuthoringDialogsModule";
import {
    createDocumentAuthoringModule,
    DOCUMENT_AUTHORING_SERVICE,
    EditorDocumentAuthoring,
} from "../modules/DocumentAuthoringModule";
import {
    createDisplayListAuthoringModule,
    DISPLAY_LIST_AUTHORING_SERVICE,
    EditorDisplayListAuthoring,
} from "../modules/DisplayListAuthoringModule";
import { createInspectorModule, EditorInspector, INSPECTOR_SERVICE } from "../modules/InspectorModule";
import {
    createProjectExplorerModule,
    EditorProjectExplorer,
    PROJECT_EXPLORER_SERVICE,
} from "../modules/ProjectExplorerModule";
import {
    createProjectSessionModule,
    EditorProjectSession,
    PROJECT_SESSION_SERVICE,
} from "../modules/ProjectSessionModule";
import {
    createResourceAuthoringModule,
    EditorResourceAuthoring,
    RESOURCE_AUTHORING_SERVICE,
} from "../modules/ResourceAuthoringModule";
import { createShellChromeModule, EditorShellChrome, SHELL_CHROME_SERVICE } from "../modules/ShellChromeModule";
import { createTimelineModule, EditorTimeline, TIMELINE_SERVICE } from "../modules/TimelineModule";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";

export const EDITOR_SHELL_MODULE_ID = "fairygui.editor-shell";

export function createEditorShellModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: EDITOR_SHELL_MODULE_ID,
        hotReloadable: false,
        activate(context) {
            const shell = new EditorShell(
                context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE),
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
                context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE),
                context.requireService<EditorInspector>(INSPECTOR_SERVICE),
                context.requireService<EditorProjectExplorer>(PROJECT_EXPLORER_SERVICE),
                context.requireService<EditorAuthoringDialogs>(AUTHORING_DIALOGS_SERVICE),
                context.requireService<EditorDisplayListAuthoring>(DISPLAY_LIST_AUTHORING_SERVICE),
                context.requireService<EditorTimeline>(TIMELINE_SERVICE),
                context.requireService<EditorResourceAuthoring>(RESOURCE_AUTHORING_SERVICE),
            );
            return () => shell.dispose();
        },
    };
}

export function createFairyGuiEditorCoreModules(): EditorModule<FairyGuiEditorWorkbenchHost>[] {
    return [
        createShellChromeModule(),
        createProjectSessionModule(),
        createAuthoringPreviewModule(),
        createDocumentAuthoringModule(),
        createProjectExplorerModule(),
        createInspectorModule(),
        createAuthoringDialogsModule(),
        createDisplayListAuthoringModule(),
        createTimelineModule(),
        createResourceAuthoringModule(),
        createEditorShellModule(),
    ];
}
