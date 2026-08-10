import type { BrowserProjectImportResult } from "../services/BrowserProjectImport";
import { BrowserProjectImport } from "../services/BrowserProjectImport";
import { BrowserSaveCoordinator } from "../services/BrowserSaveCoordinator";
import type { BrowserLiveSessionBridge } from "../services/BrowserLiveSessionBridge";
import type { BrowserProjectStorage } from "../services/BrowserProjectStorage";
import type {
    BrowserSaveTarget,
} from "../model/BrowserWorkspace";
import {
    BROWSER_WORKSPACE_REGISTRY_STORAGE_KEY,
    activateBrowserWorkspace,
    addBrowserWorkspace,
    clearBrowserWorkspaceQuarantine,
    parseBrowserWorkspaceRegistry,
    readBrowserWorkspaceQuarantine,
    type BrowserWorkspaceRegistry,
    type BrowserWorkspaceRegistryEntry,
    writeBrowserWorkspaceQuarantine,
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
    private readonly quarantineFallback = new Map<string, string>();
    private currentRegistry: BrowserWorkspaceRegistry;

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

    pickDirectoryProject(): Promise<BrowserProjectImportResult> {
        return this.importer.pickDirectoryProject();
    }

    pickZipProject(): Promise<BrowserProjectImportResult> {
        return this.importer.pickZipProject();
    }

    restoreWorkspaceBinding() {
        return this.coordinator.restoreWorkspaceBinding();
    }

    save(target?: BrowserSaveTarget) {
        return this.coordinator.save(target);
    }

    async createWorkspace(name: string): Promise<BrowserWorkspaceRegistryEntry> {
        const added = addBrowserWorkspace(this.currentRegistry, name);
        const state = await this.coordinator.switchWorkspace(added.entry.id, added.entry.fairyPath);
        this.currentRegistry = activateBrowserWorkspace(
            added.registry,
            added.entry.id,
            state.fairyPath,
        );
        this.persistRegistry();
        return this.currentRegistry.entries.find((entry) => entry.id === added.entry.id) || added.entry;
    }

    async switchWorkspace(entry: BrowserWorkspaceRegistryEntry) {
        const state = await this.coordinator.switchWorkspace(entry.id, entry.fairyPath);
        this.currentRegistry = activateBrowserWorkspace(
            this.currentRegistry,
            entry.id,
            state.fairyPath,
        );
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
        return this.coordinator.checkExternalChanges();
    }

    async importWorkspace(picked: BrowserProjectImportResult) {
        const result = await this.coordinator.importWorkspaceFiles(
            picked.imported,
            picked.files,
            picked.directoryHandle,
        );
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

    async getActiveWorkspaceQuarantine(): Promise<string | null> {
        const workspaceId = this.currentRegistry.activeId;
        return this.quarantineFallback.get(workspaceId)
            || await readBrowserWorkspaceQuarantine(workspaceId);
    }

    async quarantineActiveWorkspace(reason: string): Promise<void> {
        const workspaceId = this.currentRegistry.activeId;
        this.quarantineFallback.set(workspaceId, reason);
        await writeBrowserWorkspaceQuarantine(workspaceId, reason);
        this.quarantineFallback.delete(workspaceId);
    }

    async clearActiveWorkspaceQuarantine(): Promise<void> {
        const workspaceId = this.currentRegistry.activeId;
        await clearBrowserWorkspaceQuarantine(workspaceId);
        this.quarantineFallback.delete(workspaceId);
    }

    async exportWorkspaceZip() {
        return this.coordinator.exportWorkspaceZip();
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
