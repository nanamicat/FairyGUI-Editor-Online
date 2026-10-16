import type { BrowserProjectImportResult } from "../services/BrowserProjectImport";
import { BrowserProjectImport } from "../services/BrowserProjectImport";
import { BrowserSaveCoordinator, readPersistedDirectoryBinding } from "../services/BrowserSaveCoordinator";
import { authorizeLocalDirectory } from "../services/BrowserFileSystemAccess";
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
    private readonly recentDirectories = new Map<string, FileSystemDirectoryHandle>();
    private recentDirectoriesReady = false;

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

    async prepareRecentDirectories(): Promise<void> {
        const results = await Promise.allSettled(this.currentRegistry.entries.map(async (entry) => {
            const binding = await readPersistedDirectoryBinding(entry.id);
            if (binding) {
                this.recentDirectories.set(entry.id, binding.directory);
                // Migrate existing bindings into the home page without losing old browser workspaces.
                this.currentRegistry = {
                    ...this.currentRegistry,
                    entries: this.currentRegistry.entries.map((current) => current.id === entry.id
                        ? { ...current, source: "directory", sourceName: current.sourceName || binding.directoryName, directoryBound: true }
                        : current),
                };
            }
        }));
        this.recentDirectoriesReady = true;
        if (results.some((result) => result.status === "rejected")) {
            throw new Error("部分目录授权记录无法恢复，请重新选择项目目录。");
        }
    }

    authorizeWorkspace(entry: BrowserWorkspaceRegistryEntry): Promise<void> {
        const directory = this.recentDirectories.get(entry.id);
        if (directory) return authorizeLocalDirectory(directory);
        if (entry.directoryBound) {
            return Promise.reject(new Error(this.recentDirectoriesReady
                ? "目录授权记录不可用，请通过“打开文件夹”重新选择项目。"
                : "正在读取最近项目的目录授权，请稍后再次点击。"));
        }
        return Promise.resolve();
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

    async createWorkspace(name: string, fairyPath?: string): Promise<BrowserWorkspaceRegistryEntry> {
        const added = addBrowserWorkspace(this.currentRegistry, name);
        if (fairyPath) added.entry.fairyPath = fairyPath;
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
            this.currentRegistry = {
                ...this.currentRegistry,
                entries: this.currentRegistry.entries.map((entry) => entry.id === this.currentRegistry.activeId
                    ? {
                        ...entry,
                        name: picked.imported.fairyPath.replace(/\.fairy$/i, ""),
                        source: picked.imported.source,
                        sourceName: picked.imported.projectRoot === "."
                            ? picked.imported.sourceName
                            : `${picked.imported.sourceName}/${picked.imported.projectRoot}`,
                        directoryBound: !!picked.directoryHandle,
                    }
                    : entry),
            };
            // Reload the resolved project-root handle (selection may have been a parent folder).
            this.recentDirectories.delete(this.currentRegistry.activeId);
            const binding = await readPersistedDirectoryBinding(this.currentRegistry.activeId).catch(() => null);
            if (binding) this.recentDirectories.set(this.currentRegistry.activeId, binding.directory);
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
