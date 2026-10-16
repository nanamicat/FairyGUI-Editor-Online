import type { BrowserProjectImportResult, BrowserProjectReadProgress } from "../services/BrowserProjectImport";
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

const DIRECTORY_WORKSPACE_CLEANUP_KEY = "fairygui-editor-online.directory-workspace-cleanup.v1";

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
    private recentDirectoriesPreparation: Promise<void> | null = null;

    constructor(
        private readonly liveSession: BrowserLiveSessionBridge,
        private readonly storage: BrowserProjectStorage,
        initialRegistry: BrowserWorkspaceRegistry,
    ) {
        this.coordinator = new BrowserSaveCoordinator(liveSession, storage);
        this.currentRegistry = initialRegistry;
    }

    get registry(): BrowserWorkspaceRegistry {
        return this.currentRegistry;
    }

    prepareRecentDirectories(): Promise<void> {
        if (this.recentDirectoriesReady) return Promise.resolve();
        if (!this.recentDirectoriesPreparation) {
            this.recentDirectoriesPreparation = this.loadRecentDirectories().finally(() => {
                this.recentDirectoriesPreparation = null;
            });
        }
        return this.recentDirectoriesPreparation;
    }

    private async loadRecentDirectories(): Promise<void> {
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
        if (results.some((result) => result.status === "rejected")) {
            throw new Error("部分目录授权记录无法恢复，请重新选择项目目录。");
        }
        await this.cleanupDuplicateDirectoryWorkspacesOnce();
        this.recentDirectoriesReady = true;
    }

    async findPickedDirectoryWorkspace(picked: BrowserProjectImportResult): Promise<BrowserWorkspaceRegistryEntry | undefined> {
        let directory = picked.directoryHandle;
        for (const segment of picked.imported.projectRoot.split("/").filter((part) => part && part !== ".")) {
            directory = await directory.getDirectoryHandle(segment);
        }
        return this.findDirectoryWorkspace(directory, picked.imported.fairyPath);
    }

    async findDirectoryWorkspace(
        directory: FileSystemDirectoryHandle,
        fairyPath?: string,
    ): Promise<BrowserWorkspaceRegistryEntry | undefined> {
        await this.prepareRecentDirectories();
        for (const entry of this.preferredDirectoryEntries()) {
            const existing = this.recentDirectories.get(entry.id);
            if (existing && (!fairyPath || entry.fairyPath === fairyPath) && await directory.isSameEntry(existing)) {
                return entry;
            }
        }
        return undefined;
    }

    private preferredDirectoryEntries(): BrowserWorkspaceRegistryEntry[] {
        return [...this.currentRegistry.entries].sort((left, right) => (
            Number(right.id === this.currentRegistry.activeId) - Number(left.id === this.currentRegistry.activeId)
            || right.lastOpenedAt.localeCompare(left.lastOpenedAt)
        ));
    }

    private async cleanupDuplicateDirectoryWorkspacesOnce(): Promise<void> {
        if (typeof localStorage === "undefined" || localStorage.getItem(DIRECTORY_WORKSPACE_CLEANUP_KEY)) return;
        const retained: BrowserWorkspaceRegistryEntry[] = [];
        const removed = new Set<string>();
        for (const entry of this.preferredDirectoryEntries()) {
            const directory = this.recentDirectories.get(entry.id);
            let duplicate = false;
            if (directory) {
                for (const previous of retained) {
                    const previousDirectory = this.recentDirectories.get(previous.id);
                    if (previousDirectory && previous.fairyPath === entry.fairyPath
                        && await directory.isSameEntry(previousDirectory)) {
                        duplicate = true;
                        break;
                    }
                }
            }
            if (duplicate) removed.add(entry.id);
            else retained.push(entry);
        }
        const previousRegistry = this.currentRegistry;
        const next = {
            ...previousRegistry,
            entries: previousRegistry.entries.filter((entry) => !removed.has(entry.id)),
        };
        // Remove duplicate recent-project registrations once; retain their cached files and
        // original registry so existing browser-only changes remain recoverable.
        const backupKey = `${DIRECTORY_WORKSPACE_CLEANUP_KEY}.backup`;
        if (!localStorage.getItem(backupKey)) {
            localStorage.setItem(backupKey, JSON.stringify({ removedIds: [...removed], previousRegistry }));
        }
        localStorage.setItem(BROWSER_WORKSPACE_REGISTRY_STORAGE_KEY, JSON.stringify(next));
        this.currentRegistry = next;
        localStorage.setItem(DIRECTORY_WORKSPACE_CLEANUP_KEY, new Date().toISOString());
        for (const id of removed) this.recentDirectories.delete(id);
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

    readDirectoryProject(
        directory: FileSystemDirectoryHandle,
        onProgress?: (progress: BrowserProjectReadProgress) => void,
    ): Promise<BrowserProjectImportResult> {
        return this.importer.readDirectoryProject(directory, onProgress);
    }

    setReadProgressHandler(handler?: (progress: BrowserProjectReadProgress) => void): void {
        this.storage.setReadProgressHandler(handler);
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
