import type { HighRiskTransactionPreparation } from "../commands/HighRiskAuthoringTransactions";
import type { EditorResourceSelector } from "../model/EditorCommand";
import type { ProjectSnapshotResourceFolder } from "../model/ProjectSnapshot";
import type { BrowserLiveSessionIdentity } from "../services/BrowserLiveSessionBridge";
import type { ResourceHealthEntry, ResourceHealthIssue } from "../runtime/ResourceHealthAudit";
import type { LibraryResourceFolderSelector } from "../ui/LibraryController";
import type { LibraryItemData } from "../ui/ProjectTreeInteractionController";
import { ResourceAuthoringController } from "../ui/ResourceAuthoringController";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { AUTHORING_DIALOGS_SERVICE, EditorAuthoringDialogs } from "./AuthoringDialogsModule";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";
import { EditorProjectExplorer, PROJECT_EXPLORER_SERVICE } from "./ProjectExplorerModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const RESOURCE_AUTHORING_SERVICE = "fairygui.resource-authoring";

export type ResourceAuthoringEvents = {
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
    removeSelectedComponent(): void;
};

export class EditorResourceAuthoring {
    readonly controller: ResourceAuthoringController;
    private events: ResourceAuthoringEvents | null = null;

    constructor(
        chrome: EditorShellChrome,
        private readonly session: EditorProjectSession,
        private readonly document: EditorDocumentAuthoring,
        private readonly explorer: EditorProjectExplorer,
        dialogs: EditorAuthoringDialogs,
    ) {
        this.controller = new ResourceAuthoringController({
            liveSessionBridge: session.liveSessionBridge,
            dialogs: dialogs.controller,
            isLiveSession: () => session.commandAdapter.getSessionState().liveSession,
            getSelectedPackage: () => this.getLibraryActionSelection().pkg,
            getSelectedComponent: () => this.getLibraryActionSelection().component,
            getSelectedResource: () => this.getLibraryActionSelection().resource,
            getSelectedResourceFolder: () => this.getSelectedResourceFolder(),
            getPackages: () => session.snapshot?.packages || [],
            getSelectedComponentSelector: () => {
                const { pkg, component } = this.getLibraryActionSelection();
                return pkg && component ? { packageId: pkg.id, componentResourceId: component.id } : null;
            },
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
            getSelectedLibraryResourceSelectors: () => this.getSelectedLibraryResourceSelectors(),
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
            showProjectReferences: () => explorer.showProjectReferencesForCurrentSelection(),
            removeSelectedComponent: () => this.events?.removeSelectedComponent(),
            hasEditorAction: (action) => chrome.hasAction(action),
            runEditorAction: (action) => { chrome.runAction(action); },
            setStatus: (message, level) => chrome.setStatus(message, level === "error" ? "error" : "info"),
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

    private getSelectedResourceFolder(): ProjectSnapshotResourceFolder | null {
        const selection = this.explorer.library.getInspectorSelection();
        if (selection?.kind !== "folder") return null;
        return this.getLibraryActionSelection().pkg?.folders?.find((folder) => (
            folder.branch === selection.branch && folder.path === selection.path
        )) || null;
    }

    bind(events: ResourceAuthoringEvents): () => void {
        if (this.events) throw new Error("Resource authoring events are already bound.");
        this.events = events;
        return () => {
            if (this.events === events) this.events = null;
        };
    }

    selectLibraryPackage(packageId: string): void {
        this.explorer.library.setPackageId(packageId);
        this.events?.applyLibrarySelection({ kind: "package", packageId });
    }

    selectLibraryResource(packageId: string, resourceId: string): void {
        this.explorer.library.setPackageId(packageId);
        this.events?.applyLibrarySelection({ kind: "resource", packageId, resourceId });
        this.explorer.library.populate();
    }

    getSelectedLibraryResourceSelectors(): EditorResourceSelector[] {
        return this.events?.getSelectedLibraryResourceSelectors() || [];
    }

    repairResourceHealthIssue(issue: ResourceHealthIssue, entries: ResourceHealthEntry[]): void {
        this.controller.repairResourceHealthIssue(issue, entries);
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
            const chrome = context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE);
            const resourceAuthoring = new EditorResourceAuthoring(
                chrome,
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
                context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE),
                context.requireService<EditorProjectExplorer>(PROJECT_EXPLORER_SERVICE),
                context.requireService<EditorAuthoringDialogs>(AUTHORING_DIALOGS_SERVICE),
            );
            context.provideService(RESOURCE_AUTHORING_SERVICE, resourceAuthoring);
            context.onDeactivate(chrome.registerActions(["toolbar:createPackage"], () => { void resourceAuthoring.controller.applyAuthoringAddPackage(); }));
            context.onDeactivate(chrome.registerActions(["toolbar:createComponent"], () => { void resourceAuthoring.controller.applyAuthoringAddComponent(); }));
            context.onDeactivate(chrome.registerActions(["toolbar:createBitmapFont"], () => resourceAuthoring.controller.showCreateBitmapFontDialog()));
            context.onDeactivate(chrome.registerActions(["toolbar:createMovieClip"], () => resourceAuthoring.controller.showCreateMovieClipDialog()));
            return () => resourceAuthoring.dispose();
        },
    };
}
