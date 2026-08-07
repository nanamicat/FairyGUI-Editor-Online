import { RuntimePreviewController } from "../runtime/RuntimePreviewController";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";

export const AUTHORING_PREVIEW_MODULE_ID = "fairygui.authoring-preview";
export const AUTHORING_PREVIEW_FACTORY_SERVICE = "fairygui.authoring-preview-factory";

export type AuthoringPreviewControllerFactory = (
    ...args: ConstructorParameters<typeof RuntimePreviewController>
) => RuntimePreviewController;

export function createAuthoringPreviewModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: AUTHORING_PREVIEW_MODULE_ID,
        activate(context) {
            const create: AuthoringPreviewControllerFactory = (...args) => new RuntimePreviewController(...args);
            context.provideService(AUTHORING_PREVIEW_FACTORY_SERVICE, create);
        },
    };
}
