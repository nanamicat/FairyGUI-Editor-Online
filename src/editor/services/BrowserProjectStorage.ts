import { zip, type AsyncZippable } from "fflate";
import type {
    BrowserProjectStorageKind,
    BrowserProjectStorageState,
    BrowserWorkspaceExport,
    BrowserWorkspaceFile,
} from "../model/BrowserWorkspace";

interface BrowserStorageStatLike {
    kind: "file" | "directory";
}

export interface BrowserProjectStorageAdapter {
    readFile(filePath: string): Promise<string>;
    readFileRaw(filePath: string): Promise<Uint8Array>;
    writeFile(filePath: string, content: string): Promise<void>;
    writeFileRaw(filePath: string, data: Uint8Array): Promise<void>;
    mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>;
    readdir(dirPath: string): Promise<string[]>;
    exists(filePath: string): Promise<boolean>;
    stat(filePath: string): Promise<BrowserStorageStatLike>;
    unlink(filePath: string): Promise<void>;
    rmdir(dirPath: string): Promise<void>;
    join(...paths: string[]): string;
    dirname(filePath: string): string;
    resolve(...paths: string[]): string;
    getWriteCount?(): number;
    clear?(): Promise<void>;
    dispose?(): void;
}

export class BrowserWorkspaceRollbackError extends Error {
    readonly code = "BROWSER_WORKSPACE_ROLLBACK_FAILED";
}

interface IndexedDbFileRecord {
    path: string;
    data: ArrayBuffer;
    updatedAt: number;
}

interface IndexedDbDirectoryRecord {
    path: string;
    updatedAt: number;
}

interface OpfsStorageManager {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// Persisted namespace. Changing this would orphan existing browser workspaces.
const LEGACY_DEFAULT_WORKSPACE_NAME = "fairygui-editor-online-phase8";
const DEFAULT_FAIRY_PATH = "FairyGUI-layabox-demo.fairy";

export class BrowserProjectStorage {
    private status: BrowserProjectStorageState["status"] = "idle";
    private adapter: BrowserProjectStorageAdapter | null = null;
    private kind: BrowserProjectStorageKind = "indexeddb";
    private error = "";
    private initializePromise: Promise<BrowserProjectStorageState> | null = null;

    constructor(
        private workspaceName: string = LEGACY_DEFAULT_WORKSPACE_NAME,
        private fairyPath: string = DEFAULT_FAIRY_PATH,
    ) {}

    getWorkspaceName(): string {
        return this.workspaceName;
    }

    async switchWorkspace(workspaceName: string, fairyPath: string): Promise<BrowserProjectStorageState> {
        if (this.initializePromise) await this.initializePromise;
        this.adapter?.dispose?.();
        this.workspaceName = workspaceName;
        this.fairyPath = normalizeStoragePath(fairyPath || DEFAULT_FAIRY_PATH);
        this.status = "idle";
        this.adapter = null;
        this.error = "";
        return await this.initialize();
    }

    getFairyPath(): string {
        return this.fairyPath;
    }

    setFairyPath(fairyPath: string): void {
        this.fairyPath = normalizeStoragePath(fairyPath || DEFAULT_FAIRY_PATH);
    }

    async initialize(): Promise<BrowserProjectStorageState> {
        if (this.status === "ready" && this.adapter) return this.getState();
        if (this.initializePromise) return this.initializePromise;

        this.initializePromise = this.initializeInternal();
        try {
            return await this.initializePromise;
        } finally {
            this.initializePromise = null;
        }
    }

    private async initializeInternal(): Promise<BrowserProjectStorageState> {
        this.status = "initializing";
        this.error = "";

        try {
            const opfs = await this.tryCreateOpfsAdapter();
            if (opfs) {
                this.adapter = opfs;
                this.kind = "opfs";
            } else {
                this.adapter = await IndexedDbBrowserStorageAdapter.open(this.workspaceName);
                this.kind = "indexeddb";
            }
            await this.adapter.mkdir(".", { recursive: true });
            this.status = "ready";
        } catch (error) {
            this.adapter = null;
            this.status = typeof indexedDB === "undefined" ? "unsupported" : "failed";
            this.error = error instanceof Error ? error.message : String(error);
        }

        return this.getState();
    }

    getAdapter(): BrowserProjectStorageAdapter | null {
        return this.adapter;
    }

    async getState(): Promise<BrowserProjectStorageState> {
        if (!this.adapter || this.status !== "ready") {
            return this.createState(0, 0, 0, 0);
        }

        return this.createSummaryState();
    }

    async clearWorkspace(): Promise<BrowserProjectStorageState> {
        const state = await this.initialize();
        if (!state.available || !this.adapter) return state;

        if (this.adapter.clear) {
            await this.adapter.clear();
        } else {
            await this.clearFilesOnly(this.adapter, ".");
        }
        await this.adapter.mkdir(".", { recursive: true });
        return await this.getState();
    }

    async replaceWorkspaceFiles(files: BrowserWorkspaceFile[]): Promise<BrowserProjectStorageState> {
        const state = await this.initialize();
        if (!state.available || !this.adapter) return state;
        const previousFiles = await this.collectFiles(this.adapter, ".");
        const replace = async (nextFiles: readonly BrowserWorkspaceFile[]): Promise<void> => {
            if (this.adapter?.clear) await this.adapter.clear();
            else if (this.adapter) await this.clearFilesOnly(this.adapter, ".");
            if (!this.adapter) throw new Error("Browser workspace storage is unavailable.");
            await this.adapter.mkdir(".", { recursive: true });
            for (const file of nextFiles) {
                const normalizedPath = normalizeStoragePath(file.path);
                if (normalizedPath !== ".") await this.adapter.writeFileRaw(normalizedPath, file.data);
            }
        };
        try {
            await replace(files);
            const replaced = await this.getState();
            if (!replaced.projectFileExists) {
                throw new Error(`Imported workspace does not contain ${this.fairyPath}.`);
            }
            return replaced;
        } catch (error) {
            try {
                await replace(previousFiles);
            } catch (rollbackError) {
                const failed = error instanceof Error ? error.message : String(error);
                const rollbackFailed = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
                throw new BrowserWorkspaceRollbackError(
                    `Workspace replacement failed: ${failed} Rollback also failed: ${rollbackFailed}`,
                );
            }
            throw error;
        }
    }

    async exportWorkspaceManifest(): Promise<BrowserWorkspaceExport> {
        const state = await this.initialize();
        if (!state.available || !this.adapter) {
            throw new Error(state.error || "Browser workspace storage is unavailable.");
        }

        const files = await this.readWorkspaceFiles();
        const manifest = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            kind: "fairygui-editor-online-browser-workspace",
            storage: {
                workspaceName: state.workspaceName,
                fairyPath: state.fairyPath,
                storageKind: state.kind,
            },
            files: files.map((file) => ({
                path: file.path,
                bytes: file.data.byteLength,
                encoding: "base64",
                contentBase64: bytesToBase64(file.data),
            })),
        };
        const json = `${JSON.stringify(manifest, null, 2)}\n`;
        const blob = new Blob([json], { type: "application/json" });
        const totalBytes = files.reduce((total, file) => total + file.data.byteLength, 0);

        return {
            format: "manifest",
            fileName: `${this.workspaceName}-${formatExportTimestamp(new Date())}.fairygui-workspace.json`,
            mimeType: "application/json",
            bytes: blob.size,
            fileCount: files.length,
            totalBytes,
            blob,
        };
    }

    async exportWorkspaceZip(): Promise<BrowserWorkspaceExport> {
        const files = await this.readWorkspaceFiles();
        const blob = await createStoredZipBlob(files);
        const totalBytes = files.reduce((total, file) => total + file.data.byteLength, 0);
        const projectName = basenameStoragePath(this.fairyPath).replace(/\.fairy$/i, "") || "fairygui-project";

        return {
            format: "zip",
            fileName: `${projectName}-${formatExportTimestamp(new Date())}.zip`,
            mimeType: "application/zip",
            bytes: blob.size,
            fileCount: files.length,
            totalBytes,
            blob,
        };
    }

    async exportRuntimeBundleZip(): Promise<BrowserWorkspaceExport> {
        const files = (await this.readWorkspaceFiles()).filter((file) => (
            file.path.startsWith(".fairygui-runtime/")
        ));
        if (files.length === 0) throw new Error("Published runtime bundle is empty.");
        const blob = await createStoredZipBlob(files);
        const totalBytes = files.reduce((total, file) => total + file.data.byteLength, 0);
        const projectName = basenameStoragePath(this.fairyPath).replace(/\.fairy$/i, "") || "fairygui-project";

        return {
            format: "zip",
            fileName: `${projectName}-runtime-${formatExportTimestamp(new Date())}.zip`,
            mimeType: "application/zip",
            bytes: blob.size,
            fileCount: files.length,
            totalBytes,
            blob,
        };
    }

    async readWorkspaceFiles(): Promise<BrowserWorkspaceFile[]> {
        const state = await this.initialize();
        if (!state.available || !this.adapter) {
            throw new Error(state.error || "Browser workspace storage is unavailable.");
        }
        return await this.collectFiles(this.adapter, ".");
    }

    private async tryCreateOpfsAdapter(): Promise<BrowserProjectStorageAdapter | null> {
        const storageManager = navigator.storage as unknown as OpfsStorageManager | undefined;
        if (!storageManager || typeof storageManager.getDirectory !== "function") {
            return null;
        }

        try {
            const root = await storageManager.getDirectory();
            const workspaceRoot = await root.getDirectoryHandle(this.workspaceName, { create: true });
            return new OpfsBrowserStorageAdapter(workspaceRoot);
        } catch {
            return null;
        }
    }

    private async createSummaryState(): Promise<BrowserProjectStorageState> {
        const adapter = this.adapter;
        if (!adapter) return this.createState(0, 0, 0, 0);

        let fileCount = 0;
        let directoryCount = 0;
        let totalBytes = 0;
        let projectFileExists = false;

        const visit = async (dirPath: string): Promise<void> => {
            directoryCount += 1;
            const names = await adapter.readdir(dirPath);
            for (const name of names) {
                const childPath = dirPath === "." ? name : adapter.join(dirPath, name);
                const stat = await adapter.stat(childPath);
                if (stat.kind === "directory") {
                    await visit(childPath);
                } else {
                    fileCount += 1;
                    totalBytes += (await adapter.readFileRaw(childPath)).byteLength;
                }
            }
        };

        try {
            await visit(".");
            projectFileExists = await adapter.exists(this.fairyPath);
            return this.createState(
                fileCount,
                directoryCount,
                totalBytes,
                adapter.getWriteCount ? adapter.getWriteCount() : 0,
                projectFileExists,
            );
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            return this.createState(
                fileCount,
                directoryCount,
                totalBytes,
                adapter.getWriteCount ? adapter.getWriteCount() : 0,
                projectFileExists,
                "unknown",
            );
        }
    }

    private async collectFiles(
        adapter: BrowserProjectStorageAdapter,
        dirPath: string,
    ): Promise<Array<{ path: string; data: Uint8Array }>> {
        const files: Array<{ path: string; data: Uint8Array }> = [];
        const names = await adapter.readdir(dirPath);
        for (const name of names) {
            const childPath = dirPath === "." ? name : adapter.join(dirPath, name);
            const stat = await adapter.stat(childPath);
            if (stat.kind === "directory") {
                files.push(...await this.collectFiles(adapter, childPath));
            } else {
                files.push({
                    path: childPath,
                    data: await adapter.readFileRaw(childPath),
                });
            }
        }
        return files.sort((a, b) => a.path.localeCompare(b.path));
    }

    private async clearFilesOnly(adapter: BrowserProjectStorageAdapter, dirPath: string): Promise<void> {
        const names = await adapter.readdir(dirPath);
        for (const name of names) {
            const childPath = dirPath === "." ? name : adapter.join(dirPath, name);
            const stat = await adapter.stat(childPath);
            if (stat.kind === "directory") {
                await this.clearFilesOnly(adapter, childPath);
            } else {
                await adapter.unlink(childPath);
            }
        }
    }

    private createState(
        fileCount: number,
        directoryCount: number,
        totalBytes: number,
        writeCount: number,
        projectFileExists = false,
        workspaceState?: BrowserProjectStorageState["workspaceState"],
    ): BrowserProjectStorageState {
        return {
            kind: this.kind,
            status: this.status,
            workspaceName: this.workspaceName,
            fairyPath: this.fairyPath,
            available: this.status === "ready" && Boolean(this.adapter),
            projectFileExists,
            workspaceState: workspaceState || (projectFileExists ? "project_file_present" : fileCount > 0 ? "unknown" : "empty"),
            fileCount,
            directoryCount,
            totalBytes,
            writeCount,
            error: this.error || undefined,
        };
    }
}

class IndexedDbBrowserStorageAdapter implements BrowserProjectStorageAdapter {
    private writeCount = 0;

    private constructor(private readonly db: IDBDatabase) {}

    static open(workspaceName: string): Promise<IndexedDbBrowserStorageAdapter> {
        if (typeof indexedDB === "undefined") {
            return Promise.reject(new Error("IndexedDB is not available in this browser context."));
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(`${workspaceName}-db`, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains("files")) {
                    db.createObjectStore("files", { keyPath: "path" });
                }
                if (!db.objectStoreNames.contains("directories")) {
                    db.createObjectStore("directories", { keyPath: "path" });
                }
            };
            request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB workspace."));
            request.onsuccess = async () => {
                const adapter = new IndexedDbBrowserStorageAdapter(request.result);
                await adapter.mkdir(".", { recursive: true });
                resolve(adapter);
            };
        });
    }

    dispose(): void {
        this.db.close();
    }

    async readFile(filePath: string): Promise<string> {
        return TEXT_DECODER.decode(await this.readFileRaw(filePath));
    }

    async readFileRaw(filePath: string): Promise<Uint8Array> {
        const path = normalizeStoragePath(filePath);
        const record = await this.getRecord<IndexedDbFileRecord>("files", path);
        if (!record) throw createPathError("ENOENT", `File not found: ${path}`);
        return new Uint8Array(record.data);
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        await this.writeFileRaw(filePath, TEXT_ENCODER.encode(content));
    }

    async writeFileRaw(filePath: string, data: Uint8Array): Promise<void> {
        const path = normalizeStoragePath(filePath);
        await this.mkdir(dirnameStoragePath(path), { recursive: true });
        await this.putRecord("files", {
            path,
            data: copyArrayBuffer(data),
            updatedAt: Date.now(),
        });
        this.writeCount += 1;
    }

    async mkdir(dirPath: string, _options: { recursive?: boolean } = {}): Promise<void> {
        const path = normalizeStoragePath(dirPath);
        const parts = path === "." ? [] : path.split("/");
        let cursor = ".";
        await this.putRecord("directories", { path: cursor, updatedAt: Date.now() });
        for (const part of parts) {
            cursor = cursor === "." ? part : `${cursor}/${part}`;
            await this.putRecord("directories", { path: cursor, updatedAt: Date.now() });
        }
    }

    async readdir(dirPath: string): Promise<string[]> {
        const path = normalizeStoragePath(dirPath);
        if (!(await this.exists(path))) throw createPathError("ENOENT", `Directory not found: ${path}`);
        const prefix = path === "." ? "" : `${path}/`;
        const names = new Set<string>();
        const directories = await this.getAllRecords<IndexedDbDirectoryRecord>("directories");
        const files = await this.getAllRecords<IndexedDbFileRecord>("files");

        for (const directory of directories) {
            if (directory.path === path || !directory.path.startsWith(prefix)) continue;
            const rest = directory.path.slice(prefix.length);
            if (rest) names.add(rest.split("/")[0]);
        }
        for (const file of files) {
            if (!file.path.startsWith(prefix)) continue;
            const rest = file.path.slice(prefix.length);
            if (rest) names.add(rest.split("/")[0]);
        }
        return Array.from(names).sort();
    }

    async exists(filePath: string): Promise<boolean> {
        const path = normalizeStoragePath(filePath);
        return Boolean(await this.getRecord("files", path) || await this.getRecord("directories", path));
    }

    async stat(filePath: string): Promise<BrowserStorageStatLike> {
        const path = normalizeStoragePath(filePath);
        if (await this.getRecord("files", path)) return { kind: "file" };
        if (await this.getRecord("directories", path)) return { kind: "directory" };
        throw createPathError("ENOENT", `Path not found: ${path}`);
    }

    async unlink(filePath: string): Promise<void> {
        await this.deleteRecord("files", normalizeStoragePath(filePath));
    }

    async rmdir(dirPath: string): Promise<void> {
        const path = normalizeStoragePath(dirPath);
        if (path === ".") throw createPathError("EBUSY", "Cannot remove the storage root.");
        if (!await this.getRecord("directories", path)) {
            throw createPathError("ENOENT", `Directory not found: ${path}`);
        }
        const prefix = `${path}/`;
        const [directories, files] = await Promise.all([
            this.getAllRecords<IndexedDbDirectoryRecord>("directories"),
            this.getAllRecords<IndexedDbFileRecord>("files"),
        ]);
        if (directories.some((directory) => directory.path.startsWith(prefix))
            || files.some((file) => file.path.startsWith(prefix))) {
            throw createPathError("ENOTEMPTY", `Directory is not empty: ${path}`);
        }
        await this.deleteRecord("directories", path);
        this.writeCount += 1;
    }

    async clear(): Promise<void> {
        await Promise.all([
            this.clearStore("files"),
            this.clearStore("directories"),
        ]);
        this.writeCount += 1;
        await this.mkdir(".", { recursive: true });
    }

    join(...paths: string[]): string {
        return joinStoragePath(...paths);
    }

    dirname(filePath: string): string {
        return dirnameStoragePath(filePath);
    }

    resolve(...paths: string[]): string {
        return joinStoragePath(...paths);
    }

    getWriteCount(): number {
        return this.writeCount;
    }

    private transaction(storeName: string, mode: IDBTransactionMode): IDBObjectStore {
        return this.db.transaction(storeName, mode).objectStore(storeName);
    }

    private getRecord<T>(storeName: string, key: string): Promise<T | undefined> {
        return new Promise((resolve, reject) => {
            const request = this.transaction(storeName, "readonly").get(key);
            request.onerror = () => reject(request.error || new Error(`IndexedDB get failed: ${key}`));
            request.onsuccess = () => resolve(request.result as T | undefined);
        });
    }

    private getAllRecords<T>(storeName: string): Promise<T[]> {
        return new Promise((resolve, reject) => {
            const request = this.transaction(storeName, "readonly").getAll();
            request.onerror = () => reject(request.error || new Error(`IndexedDB getAll failed: ${storeName}`));
            request.onsuccess = () => resolve(request.result as T[]);
        });
    }

    private putRecord(storeName: string, value: unknown): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = this.transaction(storeName, "readwrite").put(value);
            request.onerror = () => reject(request.error || new Error(`IndexedDB put failed: ${storeName}`));
            request.onsuccess = () => resolve();
        });
    }

    private deleteRecord(storeName: string, key: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = this.transaction(storeName, "readwrite").delete(key);
            request.onerror = () => reject(request.error || new Error(`IndexedDB delete failed: ${key}`));
            request.onsuccess = () => resolve();
        });
    }

    private clearStore(storeName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = this.transaction(storeName, "readwrite").clear();
            request.onerror = () => reject(request.error || new Error(`IndexedDB clear failed: ${storeName}`));
            request.onsuccess = () => resolve();
        });
    }
}

class OpfsBrowserStorageAdapter implements BrowserProjectStorageAdapter {
    private writeCount = 0;

    constructor(private readonly root: FileSystemDirectoryHandle) {}

    async readFile(filePath: string): Promise<string> {
        return await (await this.getFile(filePath)).text();
    }

    async readFileRaw(filePath: string): Promise<Uint8Array> {
        const buffer = await (await this.getFile(filePath)).arrayBuffer();
        return new Uint8Array(buffer);
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        await this.writeFileRaw(filePath, TEXT_ENCODER.encode(content));
    }

    async writeFileRaw(filePath: string, data: Uint8Array): Promise<void> {
        const path = normalizeStoragePath(filePath);
        const directory = await this.getDirectory(dirnameStoragePath(path), true);
        const file = await directory.getFileHandle(basenameStoragePath(path), { create: true });
        const writable = await file.createWritable();
        await writable.write(copyArrayBuffer(data));
        await writable.close();
        this.writeCount += 1;
    }

    async mkdir(dirPath: string, _options: { recursive?: boolean } = {}): Promise<void> {
        await this.getDirectory(dirPath, true);
    }

    async readdir(dirPath: string): Promise<string[]> {
        const directory = await this.getDirectory(dirPath, false);
        const keys = (directory as unknown as { keys(): { next(): Promise<{ done?: boolean; value: string }> } }).keys();
        const names: string[] = [];
        while (true) {
            const next = await keys.next();
            if (next.done) break;
            names.push(next.value);
        }
        return names.sort();
    }

    async exists(filePath: string): Promise<boolean> {
        try {
            await this.stat(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async stat(filePath: string): Promise<BrowserStorageStatLike> {
        const path = normalizeStoragePath(filePath);
        if (path === ".") return { kind: "directory" };
        const parent = await this.getDirectory(dirnameStoragePath(path), false);
        const name = basenameStoragePath(path);
        try {
            await parent.getFileHandle(name);
            return { kind: "file" };
        } catch {
            await parent.getDirectoryHandle(name);
            return { kind: "directory" };
        }
    }

    async unlink(filePath: string): Promise<void> {
        const path = normalizeStoragePath(filePath);
        const parent = await this.getDirectory(dirnameStoragePath(path), false);
        await parent.removeEntry(basenameStoragePath(path));
    }

    async rmdir(dirPath: string): Promise<void> {
        const path = normalizeStoragePath(dirPath);
        if (path === ".") throw createPathError("EBUSY", "Cannot remove the storage root.");
        const parent = await this.getDirectory(dirnameStoragePath(path), false);
        await parent.removeEntry(basenameStoragePath(path));
        this.writeCount += 1;
    }

    async clear(): Promise<void> {
        const names = await this.readdir(".");
        const removableRoot = this.root as unknown as {
            removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
        };
        for (const name of names) {
            await removableRoot.removeEntry(name, { recursive: true });
        }
        this.writeCount += 1;
    }

    join(...paths: string[]): string {
        return joinStoragePath(...paths);
    }

    dirname(filePath: string): string {
        return dirnameStoragePath(filePath);
    }

    resolve(...paths: string[]): string {
        return joinStoragePath(...paths);
    }

    getWriteCount(): number {
        return this.writeCount;
    }

    private async getFile(filePath: string): Promise<File> {
        const path = normalizeStoragePath(filePath);
        try {
            const directory = await this.getDirectory(dirnameStoragePath(path), false);
            return await (await directory.getFileHandle(basenameStoragePath(path))).getFile();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`OPFS read failed for ${path}: ${message}`);
        }
    }

    private async getDirectory(dirPath: string, create: boolean): Promise<FileSystemDirectoryHandle> {
        const path = normalizeStoragePath(dirPath);
        if (path === ".") return this.root;

        let current = this.root;
        for (const part of path.split("/")) {
            current = await current.getDirectoryHandle(part, { create });
        }
        return current;
    }
}

function normalizeStoragePath(value: string): string {
    const normalized = String(value || ".").replace(/\\/g, "/").replace(/\/+/g, "/");
    const segments: string[] = [];
    for (const segment of normalized.split("/")) {
        if (!segment || segment === ".") continue;
        if (segment === "..") {
            if (segments.length > 0) segments.pop();
            continue;
        }
        segments.push(segment);
    }
    return segments.join("/") || ".";
}

function joinStoragePath(...paths: string[]): string {
    return normalizeStoragePath(paths.filter((part) => part && part !== ".").join("/"));
}

function dirnameStoragePath(filePath: string): string {
    const path = normalizeStoragePath(filePath);
    if (path === ".") return ".";
    const parts = path.split("/");
    parts.pop();
    return parts.join("/") || ".";
}

function basenameStoragePath(filePath: string): string {
    const path = normalizeStoragePath(filePath);
    if (path === ".") return ".";
    const parts = path.split("/");
    return parts[parts.length - 1];
}

function createPathError(code: string, message: string): Error & { code: string } {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
}

function copyArrayBuffer(data: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        binary += String.fromCharCode(...Array.from(chunk));
    }
    return btoa(binary);
}

export async function createStoredZipBlob(files: BrowserWorkspaceFile[]): Promise<Blob> {
    if (files.length > 0xffff) {
        throw new Error("ZIP export supports at most 65535 files.");
    }

    const entries: AsyncZippable = {};
    for (const file of files) {
        const path = normalizeStoragePath(file.path);
        if (path === ".") continue;
        if (TEXT_ENCODER.encode(path).byteLength > 0xffff || file.data.byteLength > 0xffffffff) {
            throw new Error(`ZIP export entry is too large: ${path}`);
        }
        if (entries[path]) throw new Error(`ZIP export contains a duplicate path: ${path}`);
        entries[path] = file.data;
    }

    const archive = await new Promise<Uint8Array>((resolve, reject) => {
        zip(entries, { level: 0, mtime: new Date() }, (error, data) => {
            if (error) reject(error);
            else resolve(data);
        });
    });
    return new Blob([copyArrayBuffer(archive)], { type: "application/zip" });
}

function formatExportTimestamp(date: Date): string {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
