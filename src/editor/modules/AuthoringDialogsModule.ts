import type { HighRiskTransactionPreparation } from "../commands/HighRiskAuthoringTransactions";
import type { ExportedControllerDefinition } from "../dialogs/ComponentInstancePropertyEditors";
import type {
    ComponentCustomPropertyDefinition,
    SetDisplayNodePropsCommand,
} from "../model/EditorCommand";
import type { BrowserLiveSessionIdentity } from "../services/BrowserLiveSessionBridge";
import { downloadBrowserFile } from "../services/BrowserDownload";
import { AuthoringDialogController } from "../ui/AuthoringDialogController";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";
import { EditorProjectExplorer, PROJECT_EXPLORER_SERVICE } from "./ProjectExplorerModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const AUTHORING_DIALOGS_SERVICE = "fairygui.authoring-dialogs";

export type AuthoringDialogsEvents = {
    getSelectedControllerName(): string;
    setSelectedControllerName(name: string): void;
    getSelectedTransitionName(): string;
    getCustomPropertyDefinitions(): ComponentCustomPropertyDefinition[];
    getExportedControllers(): ExportedControllerDefinition[];
    applyDisplayNodeCommand(command: SetDisplayNodePropsCommand, summary: string): Promise<boolean>;
    applyPreparation(
        preparation: HighRiskTransactionPreparation,
        identity?: BrowserLiveSessionIdentity | null,
    ): Promise<boolean>;
    activateDocument(packageId: string, componentId: string): boolean;
    onTimelineItemApplied(itemIndex: number): void;
    createActionMenu(): fgui.PopupMenu;
    addMenuItem(menu: fgui.PopupMenu, name: string, title: string, handler: () => void): fgui.GButton;
};

export class EditorAuthoringDialogs {
    readonly controller: AuthoringDialogController;
    private events: AuthoringDialogsEvents | null = null;

    constructor(
        chrome: EditorShellChrome,
        private readonly session: EditorProjectSession,
        private readonly document: EditorDocumentAuthoring,
        private readonly explorer: EditorProjectExplorer,
    ) {
        this.controller = new AuthoringDialogController({
            eventOwner: this,
            getWorkingProject: () => session.liveSessionBridge.getWorkingProject(),
            getProjectSnapshot: () => session.snapshot,
            getSelectedPackage: () => this.getLibraryActionSelection().pkg,
            getSelectedComponent: () => this.getLibraryActionSelection().component,
            getSelectedResource: () => this.getLibraryActionSelection().resource,
            getSelectedDisplayNode: () => document.getSelectedNode(),
            getSelectedDisplayNodeSelector: () => document.getSelectedNodeSelector(),
            getSelectedComponentSelector: () => {
                const { pkg, component } = this.getLibraryActionSelection();
                return pkg && component ? { packageId: pkg.id, componentResourceId: component.id } : null;
            },
            getSelectedControllerName: () => this.events?.getSelectedControllerName() || "",
            setSelectedControllerName: (name) => this.events?.setSelectedControllerName(name),
            getSelectedTransitionName: () => this.events?.getSelectedTransitionName() || "",
            isLiveSession: () => session.commandAdapter.getSessionState().liveSession,
            getCustomPropertyDefinitions: () => this.events?.getCustomPropertyDefinitions() || [],
            getExportedControllers: () => this.events?.getExportedControllers() || [],
            applyDisplayNodeCommand: (command, summary) => (
                this.events?.applyDisplayNodeCommand(command, summary) ?? Promise.resolve(false)
            ),
            setGraphPointEditing: (enabled, shapeLocked) => document.preview.setGraphPointEditing(enabled, shapeLocked),
            isGraphPointEditing: () => document.preview.isGraphPointEditing(),
            isGraphShapeLocked: () => document.preview.isGraphShapeLocked(),
            applyPreparation: (preparation) => (
                this.events?.applyPreparation(preparation) ?? Promise.resolve(false)
            ),
            download: downloadBrowserFile,
            activateDocument: (packageId, componentId) => (
                this.events?.activateDocument(packageId, componentId) ?? false
            ),
            onTimelineItemApplied: (itemIndex) => this.events?.onTimelineItemApplied(itemIndex),
            createActionMenu: () => {
                if (!this.events) throw new Error("Authoring dialogs are not bound to the editor shell.");
                return this.events.createActionMenu();
            },
            addMenuItem: (menu, name, title, handler) => {
                if (!this.events) throw new Error("Authoring dialogs are not bound to the editor shell.");
                return this.events.addMenuItem(menu, name, title, handler);
            },
            setStatus: (message) => chrome.setStatus(message),
            setDebugAttribute: (name, value) => chrome.setDebugAttribute(name, value),
        });
    }

    private getLibraryActionSelection() {
        const selection = this.explorer.library.getInspectorSelection();
        const pkg = selection
            ? this.session.snapshot?.packages.find((pkg) => pkg.id === selection.packageId) || null
            : this.document.getSelectedPackage();
        const resource = selection?.kind === "resource"
            ? this.explorer.findResource(selection.packageId, selection.resourceId)
            : null;
        const component = selection?.kind === "resource"
            ? resource?.type === "Component"
                ? pkg?.components.find((component) => component.id === resource.id) || null
                : null
            : this.document.getSelectedComponent();
        return { pkg, component, resource };
    }

    bind(events: AuthoringDialogsEvents): () => void {
        if (this.events) throw new Error("Authoring dialog events are already bound.");
        this.events = events;
        return () => {
            if (this.events === events) this.events = null;
        };
    }

    dispose(): void {
        this.events = null;
        this.controller.dispose();
    }
}

export function createAuthoringDialogsModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.authoring-dialogs",
        hotReloadable: false,
        activate(context) {
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const dialogs = new EditorAuthoringDialogs(
                chrome,
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
                context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE),
                context.requireService<EditorProjectExplorer>(PROJECT_EXPLORER_SERVICE),
            );
            context.provideService(AUTHORING_DIALOGS_SERVICE, dialogs);
            context.onDeactivate(chrome.registerActions(["toolbar:createButton"], () => dialogs.controller.showComponentTemplate("button")));
            context.onDeactivate(chrome.registerActions(["toolbar:createLabel"], () => dialogs.controller.showComponentTemplate("label")));
            context.onDeactivate(chrome.registerActions(["toolbar:createComboBox"], () => dialogs.controller.showComponentTemplate("comboBox")));
            context.onDeactivate(chrome.registerActions(["toolbar:createProgressBar"], () => dialogs.controller.showComponentTemplate("progressBar")));
            context.onDeactivate(chrome.registerActions(["toolbar:createSlider"], () => dialogs.controller.showComponentTemplate("slider")));
            return () => dialogs.dispose();
        },
    };
}
