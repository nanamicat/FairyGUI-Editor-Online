import {
    InspectorController,
    type InspectorPanelAction,
} from "../ui/InspectorController";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const INSPECTOR_SERVICE = "fairygui.inspector";

export class EditorInspector extends InspectorController {
    private actionHandler: ((action: InspectorPanelAction) => void) | null = null;

    constructor(chrome: EditorShellChrome) {
        super(
            chrome.panels.inspector.getChild("list").asList,
            (action) => this.actionHandler?.(action),
            (name, value) => chrome.setDebugAttribute(name, value),
        );
    }

    bindActions(handler: (action: InspectorPanelAction) => void): () => void {
        if (this.actionHandler) throw new Error("Inspector actions are already bound.");
        this.actionHandler = handler;
        return () => {
            if (this.actionHandler === handler) this.actionHandler = null;
        };
    }

    dispose(): void {
        this.actionHandler = null;
        this.clear();
    }
}

export function createInspectorModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.inspector",
        hotReloadable: false,
        activate(context) {
            const inspector = new EditorInspector(
                context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE),
            );
            context.provideService(INSPECTOR_SERVICE, inspector);
            return () => inspector.dispose();
        },
    };
}
