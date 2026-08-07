import type { HighRiskTransactionPreparation } from "../commands/HighRiskAuthoringTransactions";
import type {
    EditorComponentSelector,
    EditorResourceSelector,
} from "../model/EditorCommand";
import type {
    ProjectSnapshotComponent,
    ProjectSnapshotPackage,
    ProjectSnapshotResource,
    ProjectSnapshotResourceFolder,
} from "../model/ProjectSnapshot";
import type { BrowserLiveSessionIdentity } from "../services/BrowserLiveSessionBridge";
import type { LibraryResourceFolderSelector } from "../ui/LibraryController";
import type { LibraryItemData } from "../ui/ProjectTreeInteractionController";
import { ResourceAuthoringController } from "../ui/ResourceAuthoringController";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { AUTHORING_DIALOGS_SERVICE, EditorAuthoringDialogs } from "./AuthoringDialogsModule";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";
import { downloadBrowserFile } from "./ProjectTransferModules";
import { EditorProjectExplorer, PROJECT_EXPLORER_SERVICE } from "./ProjectExplorerModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const RESOURCE_AUTHORING_SERVICE = "fairygui.resource-authoring";

export type ResourceAuthoringEvents = {
    getSelectedPackage(): ProjectSnapshotPackage | null;
    getSelectedComponent(): ProjectSnapshotComponent | null;
    getSelectedResource(): ProjectSnapshotResource | null;
    getSelectedResourceFolder(): ProjectSnapshotResourceFolder | null;
    getSelectedComponentSelector(): EditorComponentSelector | null;
    getSelectedLibraryResourceSelectors(): EditorResourceSelector[];
    applyPreparation(
        preparation: HighRiskTransactionPreparation,
        identity?: BrowserLiveSessionIdentity | null,
    ): Promise<boolean>;
    applyLibrarySelection(data: LibraryItemData | null, preserveResourceSelection?: boolean): void;
    refreshProjectViews(): void;
    createActionMenu(): fgui.PopupMenu;
    addMenuItem(menu: fgui.PopupMenu, name: string, title: string, handler: () => void): fgui.GButton;
    showActionMenu(menu: fgui.PopupMenu, anchor: fgui.GObject | null, source: string, status: string): void;
    showSelectedResourceInspector(): void;
    showProjectReferences(): void;
    removeSelectedComponent(): void;
    runEditorAction(action: "workspace:importProject" | "toolbar:exportWorkspace"): void;
};

export class EditorResourceAuthoring {
    readonly controller: ResourceAuthoringController;
    private events: ResourceAuthoringEvents | null = null;

    constructor(
        chrome: EditorShellChrome,
        session: EditorProjectSession,
        document: EditorDocumentAuthoring,
        explorer: EditorProjectExplorer,
        dialogs: EditorAuthoringDialogs,
    ) {
        this.controller = new ResourceAuthoringController({
            liveSessionBridge: session.liveSessionBridge,
            dialogs: dialogs.controller,
            isLiveSession: () => session.commandAdapter.getSessionState().liveSession,
            getSelectedPackage: () => this.events?.getSelectedPackage() || null,
            getSelectedComponent: () => this.events?.getSelectedComponent() || null,
            getSelectedResource: () => this.events?.getSelectedResource() || null,
            getSelectedResourceFolder: () => this.events?.getSelectedResourceFolder() || null,
            getPackages: () => session.snapshot?.packages || [],
            getSelectedComponentSelector: () => this.events?.getSelectedComponentSelector() || null,
            getSelectedResourceFolderSelector: () => {
                const selection = explorer.library.getInspectorSelection();
                return selection?.kind === "folder" ? selection : null;
            },
            setSelectedResourceFolderSelector: (selector: LibraryResourceFolderSelector | null) => {
                explorer.library.setInspectorSelection(selector ? { kind: "folder", ...selector } : null);
            },
            getSelectedPackageId: () => document.packageId,
            getWorkspaceId: () => session.projectStorage.getWorkspaceName(),
            getLibraryPackageId: () => explorer.library.packageId,
            setLibraryPackageId: (packageId) => explorer.library.setPackageId(packageId),
            getSelectedLibraryResourceSelectors: () => this.events?.getSelectedLibraryResourceSelectors() || [],
            applyPreparation: (preparation, identity) => (
                this.events?.applyPreparation(preparation, identity) ?? Promise.resolve(false)
            ),
            applyLibrarySelection: (data, preserve) => this.events?.applyLibrarySelection(data, preserve),
            refreshProjectViews: () => this.events?.refreshProjectViews(),
            createActionMenu: () => {
                if (!this.events) throw new Error("Resource authoring is not bound to the editor shell.");
                return this.events.createActionMenu();
            },
            addMenuItem: (menu, name, title, handler) => {
                if (!this.events) throw new Error("Resource authoring is not bound to the editor shell.");
                return this.events.addMenuItem(menu, name, title, handler);
            },
            showActionMenu: (menu, anchor, source, status) => this.events?.showActionMenu(menu, anchor, source, status),
            showSelectedResourceInspector: () => this.events?.showSelectedResourceInspector(),
            showProjectReferences: () => this.events?.showProjectReferences(),
            removeSelectedComponent: () => this.events?.removeSelectedComponent(),
            runEditorAction: (action) => this.events?.runEditorAction(action),
            download: downloadBrowserFile,
            setStatus: (message, level) => chrome.setStatus(message, level === "error" ? "error" : "info"),
            setDebugAttribute: (name, value) => chrome.setDebugAttribute(name, value),
        });
    }

    bind(events: ResourceAuthoringEvents): () => void {
        if (this.events) throw new Error("Resource authoring events are already bound.");
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

export function createResourceAuthoringModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.resource-authoring",
        hotReloadable: false,
        activate(context) {
            const resourceAuthoring = new EditorResourceAuthoring(
                context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE),
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
                context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE),
                context.requireService<EditorProjectExplorer>(PROJECT_EXPLORER_SERVICE),
                context.requireService<EditorAuthoringDialogs>(AUTHORING_DIALOGS_SERVICE),
            );
            context.provideService(RESOURCE_AUTHORING_SERVICE, resourceAuthoring);
            return () => resourceAuthoring.dispose();
        },
    };
}
