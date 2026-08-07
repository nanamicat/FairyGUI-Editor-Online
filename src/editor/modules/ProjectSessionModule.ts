import { EditorCommandAdapter } from "../commands/EditorCommandAdapter";
import {
    DEFAULT_BROWSER_WORKSPACE_ID,
} from "../runtime/BrowserWorkspaceRegistry";
import {
    WorkspaceLifecycleController,
    loadBrowserWorkspaceRegistry,
} from "../runtime/WorkspaceLifecycleController";
import { BrowserLiveSessionBridge } from "../services/BrowserLiveSessionBridge";
import { BrowserProjectStorage } from "../services/BrowserProjectStorage";
import type { EditorCommandResult } from "../model/EditorCommand";
import type { EditorProjectSnapshot } from "../model/ProjectSnapshot";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";

export const PROJECT_SESSION_SERVICE = "fairygui.project-session";

let pendingProjectSessionDisposal: Promise<void> = Promise.resolve();

export class EditorProjectSession {
    readonly commandAdapter = new EditorCommandAdapter();
    readonly projectStorage: BrowserProjectStorage;
    readonly liveSessionBridge: BrowserLiveSessionBridge;
    readonly workspaceLifecycle: WorkspaceLifecycleController;
    private currentSnapshot: EditorProjectSnapshot | null = null;
    private currentLastResult: EditorCommandResult | null = null;

    private operationQueue: Promise<void>;
    private disposed = false;

    constructor() {
        const registry = loadBrowserWorkspaceRegistry();
        this.projectStorage = new BrowserProjectStorage(
            registry.activeId || DEFAULT_BROWSER_WORKSPACE_ID,
            registry.entries.find((entry) => entry.id === registry.activeId)?.fairyPath,
        );
        this.liveSessionBridge = new BrowserLiveSessionBridge(this.projectStorage);
        this.workspaceLifecycle = new WorkspaceLifecycleController(
            this.liveSessionBridge,
            this.projectStorage,
            registry,
        );
        this.commandAdapter.setLiveSessionRuntime(this.liveSessionBridge);
        this.operationQueue = pendingProjectSessionDisposal;
    }

    get snapshot(): EditorProjectSnapshot | null { return this.currentSnapshot; }
    get lastResult(): EditorCommandResult | null { return this.currentLastResult; }

    updateSnapshot(snapshot: EditorProjectSnapshot | null): void {
        this.currentSnapshot = snapshot;
    }

    updateLastResult(result: EditorCommandResult | null): void {
        this.currentLastResult = result;
    }

    runExclusive<T>(task: () => Promise<T>): Promise<T> {
        if (this.disposed) return Promise.reject(new Error("Project session is disposed."));
        const result = this.operationQueue.then(task);
        this.operationQueue = result.then(
            (): void => {},
            (): void => {},
        );
        return result;
    }

    async dispose(): Promise<void> {
        if (this.disposed) return this.operationQueue;
        this.disposed = true;
        const close = this.operationQueue.then(() => this.liveSessionBridge.reset());
        pendingProjectSessionDisposal = close.then(
            (): void => {},
            (): void => {},
        );
        this.operationQueue = pendingProjectSessionDisposal;
        try {
            const result = await close;
            if (!result.ok) console.warn("[Editor Session] dispose could not close the live session", result);
        } catch (error) {
            console.warn("[Editor Session] dispose failed to close the live session", error);
        }
    }
}

export function createProjectSessionModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.project-session",
        hotReloadable: false,
        activate(context) {
            const session = new EditorProjectSession();
            context.provideService(PROJECT_SESSION_SERVICE, session);
            return () => session.dispose();
        },
    };
}
