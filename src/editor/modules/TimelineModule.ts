import type { HighRiskTransactionPreparation } from "../commands/HighRiskAuthoringTransactions";
import type { BrowserLiveSessionIdentity } from "../services/BrowserLiveSessionBridge";
import { ControllerTimelineAuthoringController } from "../ui/ControllerTimelineAuthoringController";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { AUTHORING_DIALOGS_SERVICE, EditorAuthoringDialogs } from "./AuthoringDialogsModule";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const TIMELINE_SERVICE = "fairygui.timeline";

export type TimelineEvents = {
    applyPreparation(
        preparation: HighRiskTransactionPreparation,
        identity?: BrowserLiveSessionIdentity | null,
    ): Promise<boolean>;
    getTimelineVisible(): boolean;
    setTimelineVisible(visible: boolean): void;
    setConsoleVisible(visible: boolean): void;
    getLeftDockVisible(): boolean;
    setLeftDockVisible(visible: boolean): void;
    setLeftTopPanelMode(mode: "transition"): void;
    showEditorWorkspace(): void;
    layout(): void;
    saveLayout(): void;
};

export class EditorTimeline {
    readonly controller: ControllerTimelineAuthoringController;
    private events: TimelineEvents | null = null;

    constructor(
        chrome: EditorShellChrome,
        session: EditorProjectSession,
        document: EditorDocumentAuthoring,
        dialogs: EditorAuthoringDialogs,
    ) {
        this.controller = new ControllerTimelineAuthoringController({
            documentView: chrome.panels.document,
            transitionListView: chrome.transitionListView,
            timelineView: chrome.timelineView,
            liveSessionBridge: session.liveSessionBridge,
            runtimePreview: document.preview,
            dialogs: dialogs.controller,
            isLiveSession: () => session.commandAdapter.getSessionState().liveSession,
            getSelectedComponentSelector: () => {
                const tab = document.getActiveTab();
                return tab ? { packageId: tab.packageId, componentResourceId: tab.componentId } : null;
            },
            getSelectedComponent: () => document.getSelectedComponent(),
            getSelectedDisplayNodeId: () => document.primaryNodeId,
            applyPreparation: (preparation, identity) => (
                this.events?.applyPreparation(preparation, identity) ?? Promise.resolve(false)
            ),
            getTimelineVisible: () => this.events?.getTimelineVisible() ?? false,
            setTimelineVisible: (visible) => this.events?.setTimelineVisible(visible),
            setConsoleVisible: (visible) => this.events?.setConsoleVisible(visible),
            getLeftDockVisible: () => this.events?.getLeftDockVisible() ?? true,
            setLeftDockVisible: (visible) => this.events?.setLeftDockVisible(visible),
            setLeftTopPanelMode: (mode) => this.events?.setLeftTopPanelMode(mode),
            showEditorWorkspace: () => this.events?.showEditorWorkspace(),
            layout: () => this.events?.layout(),
            saveLayout: () => this.events?.saveLayout(),
            setStatus: (message) => chrome.setStatus(message),
            setDebugAttribute: (name, value) => chrome.setDebugAttribute(name, value),
        });
    }

    bind(events: TimelineEvents): () => void {
        if (this.events) throw new Error("Timeline events are already bound.");
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

export function createTimelineModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.timeline",
        hotReloadable: false,
        activate(context) {
            const timeline = new EditorTimeline(
                context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE),
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
                context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE),
                context.requireService<EditorAuthoringDialogs>(AUTHORING_DIALOGS_SERVICE),
            );
            context.provideService(TIMELINE_SERVICE, timeline);
            return () => timeline.dispose();
        },
    };
}
