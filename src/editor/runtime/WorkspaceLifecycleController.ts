import type { BrowserProjectImportResult } from "../services/BrowserProjectImport";
import { BrowserProjectImport } from "../services/BrowserProjectImport";
import { BrowserSaveCoordinator } from "../services/BrowserSaveCoordinator";
import type { BrowserLiveSessionBridge } from "../services/BrowserLiveSessionBridge";
import type { BrowserProjectStorage } from "../services/BrowserProjectStorage";
import type {
    BrowserSaveTarget,
    BrowserWorkspaceLifecycleResult,
} from "../model/BrowserWorkspace";
import {
    BROWSER_WORKSPACE_REGISTRY_STORAGE_KEY,
    activateBrowserWorkspace,
    addBrowserWorkspace,
    parseBrowserWorkspaceRegistry,
    type BrowserWorkspaceRegistry,
    type BrowserWorkspaceRegistryEntry,
} from "./BrowserWorkspaceRegistry";

export function loadBrowserWorkspaceRegistry(): BrowserWorkspaceRegistry {
    try {
        return parseBrowserWorkspaceRegistry(
            typeof localStorage === "undefined"
                ? null
                : localStorage.getItem(BROWSER_WORKSPACE_REGISTRY_STORAGE_KEY),
        );
    } catch {
        return parseBrowserWorkspaceRegistry(null);
    }
}

export class WorkspaceLifecycleController {
    private readonly coordinator: BrowserSaveCoordinator;
    private readonly importer = new BrowserProjectImport();
    private currentRegistry: BrowserWorkspaceRegistry;
    private currentLifecycleResult: BrowserWorkspaceLifecycleResult | null = null;

    constructor(
        private readonly liveSession: BrowserLiveSessionBridge,
        storage: BrowserProjectStorage,
        initialRegistry: BrowserWorkspaceRegistry,
    ) {
        this.coordinator = new BrowserSaveCoordinator(liveSession, storage);
        this.currentRegistry = initialRegistry;
    }

    get registry(): BrowserWorkspaceRegistry {
        return this.currentRegistry;
    }

    get lifecycleResult(): typeof this.currentLifecycleResult {
        return this.currentLifecycleResult;
    }

    pickDirectoryProject(): Promise<BrowserProjectImportResult> {
        return this.importer.pickDirectoryProject();
    }

    pickZipProject(): Promise<BrowserProjectImportResult> {
        return this.importer.pickZipProject();
    }

    restoreWorkspaceBinding() {
        return this.coordinator.restoreWorkspaceBinding();
    }

    getStorageState() {
        return this.coordinator.getStorageState();
    }

    save(target?: BrowserSaveTarget) {
        return this.coordinator.save(target);
    }

    addWorkspace(name: string): BrowserWorkspaceRegistryEntry {
        const added = addBrowserWorkspace(this.currentRegistry, name);
        this.currentRegistry = {
            activeId: this.currentRegistry.activeId,
            entries: added.registry.entries,
        };
        this.persistRegistry();
        return added.entry;
    }

    async switchWorkspace(entry: BrowserWorkspaceRegistryEntry) {
        const state = await this.coordinator.switchWorkspace(entry.id, entry.fairyPath);
        this.currentRegistry = activateBrowserWorkspace(
            this.currentRegistry,
            entry.id,
            state.fairyPath,
        );
        this.currentLifecycleResult = null;
        this.persistRegistry();
        return state;
    }

    closeWorkspace() {
        return this.liveSession.reset();
    }

    reauthorizeDirectoryBinding() {
        return this.coordinator.reauthorizeDirectoryBinding();
    }

    async checkExternalChanges() {
        const result = await this.coordinator.checkExternalChanges();
        return { result, state: await this.coordinator.getStorageState() };
    }

    async importWorkspace(picked: BrowserProjectImportResult) {
        const result = await this.coordinator.importWorkspaceFiles(
            picked.imported,
            picked.files,
            picked.directoryHandle,
        );
        this.currentLifecycleResult = result;
        if (result.ok) {
            this.currentRegistry = activateBrowserWorkspace(
                this.currentRegistry,
                this.currentRegistry.activeId,
                result.storage.fairyPath,
            );
            this.persistRegistry();
        }
        return result;
    }

    async bootstrapWorkspace() {
        const result = await this.coordinator.bootstrapWorkspace();
        this.currentLifecycleResult = result;
        return result;
    }

    async clearWorkspace() {
        const result = await this.coordinator.clearWorkspace();
        this.currentLifecycleResult = result;
        return result;
    }

    async exportWorkspaceZip() {
        const result = await this.coordinator.exportWorkspaceZip();
        this.currentLifecycleResult = result;
        return result;
    }

    private persistRegistry(): void {
        try {
            localStorage.setItem(
                BROWSER_WORKSPACE_REGISTRY_STORAGE_KEY,
                JSON.stringify(this.currentRegistry),
            );
        } catch {
            // Recent workspace persistence is optional and must not block authoring.
        }
    }
}
