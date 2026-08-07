import type { HighRiskTransactionPreparation } from "../commands/HighRiskAuthoringTransactions";
import type { ExportedControllerDefinition } from "../dialogs/ComponentInstancePropertyEditors";
import type {
    ComponentCustomPropertyDefinition,
    EditorComponentSelector,
    EditorDisplayNodeSelector,
    SetDisplayNodePropsCommand,
} from "../model/EditorCommand";
import type {
    ProjectSnapshotComponent,
    ProjectSnapshotPackage,
    ProjectSnapshotResource,
} from "../model/ProjectSnapshot";
import type { BrowserLiveSessionIdentity } from "../services/BrowserLiveSessionBridge";
import { AuthoringDialogController } from "../ui/AuthoringDialogController";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";
import { downloadBrowserFile } from "./ProjectTransferModules";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const AUTHORING_DIALOGS_SERVICE = "fairygui.authoring-dialogs";

export type AuthoringDialogsEvents = {
    getSelectedPackage(): ProjectSnapshotPackage | null;
    getSelectedComponent(): ProjectSnapshotComponent | null;
    getSelectedResource(): ProjectSnapshotResource | null;
    getSelectedComponentSelector(): EditorComponentSelector | null;
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
        session: EditorProjectSession,
        document: EditorDocumentAuthoring,
    ) {
        this.controller = new AuthoringDialogController({
            eventOwner: this,
            getWorkingProject: () => session.liveSessionBridge.getWorkingProject(),
            getProjectSnapshot: () => session.snapshot,
            getSelectedPackage: () => this.events?.getSelectedPackage() || null,
            getSelectedComponent: () => this.events?.getSelectedComponent() || null,
            getSelectedResource: () => this.events?.getSelectedResource() || null,
            getSelectedDisplayNode: () => document.getSelectedNode(),
            getSelectedDisplayNodeSelector: (): EditorDisplayNodeSelector | null => {
                const tab = document.getActiveTab();
                return tab && document.primaryNodeId
                    ? {
                        packageId: tab.packageId,
                        componentResourceId: tab.componentId,
                        displayNodeId: document.primaryNodeId,
                    }
                    : null;
            },
            getSelectedComponentSelector: () => this.events?.getSelectedComponentSelector() || null,
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
            const dialogs = new EditorAuthoringDialogs(
                context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE),
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
                context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE),
            );
            context.provideService(AUTHORING_DIALOGS_SERVICE, dialogs);
            return () => dialogs.dispose();
        },
    };
}
