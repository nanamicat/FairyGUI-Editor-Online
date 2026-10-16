import type { DirectoryVersionEntry } from "../model/BrowserWorkspace";

export interface DirectoryWritebackBinding {
    directory: FileSystemDirectoryHandle;
    directoryName: string;
    fairyPath: string;
    baseline: DirectoryVersionEntry[];
    restored: boolean;
    cacheName?: string;
    deletedPaths?: string[];
    deletedDirectories?: string[];
    missingPaths?: string[];
}

export interface PersistedDirectoryBinding {
    key: "active";
    directory: FileSystemDirectoryHandle;
    directoryName: string;
    fairyPath: string;
    baseline: DirectoryVersionEntry[];
    cacheName?: string;
    deletedPaths?: string[];
    deletedDirectories?: string[];
    missingPaths?: string[];
}

const DIRECTORY_BINDING_DATABASE_SUFFIX = "-directory-binding";
const DIRECTORY_BINDING_STORE = "bindings";
const DIRECTORY_BINDING_KEY = "active";

export interface DirectoryPermissionHandle {
    queryPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
}

export async function readPersistedDirectoryBinding(workspaceName: string): Promise<PersistedDirectoryBinding | null> {
    const database = await openDirectoryBindingDatabase(workspaceName);
    if (!database) return null;
    try {
        const record = await new Promise<unknown>((resolve, reject) => {
            const request = database.transaction(DIRECTORY_BINDING_STORE, "readonly")
                .objectStore(DIRECTORY_BINDING_STORE)
                .get(DIRECTORY_BINDING_KEY);
            request.onerror = () => reject(request.error || new Error("Failed to read Folder binding."));
            request.onsuccess = () => resolve(request.result);
        });
        return parsePersistedDirectoryBinding(record);
    } finally {
        database.close();
    }
}

export async function savePersistedDirectoryBinding(
    workspaceName: string,
    binding: DirectoryWritebackBinding,
): Promise<void> {
    const database = await openDirectoryBindingDatabase(workspaceName);
    if (!database) {
        throw createDirectoryBindingError(
            "DIRECTORY_BINDING_PERSIST_UNAVAILABLE",
            "IndexedDB is unavailable for Folder binding persistence.",
        );
    }
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(DIRECTORY_BINDING_STORE, "readwrite");
            transaction.objectStore(DIRECTORY_BINDING_STORE).put({
                key: DIRECTORY_BINDING_KEY,
                directory: binding.directory,
                directoryName: binding.directoryName,
                fairyPath: binding.fairyPath,
                baseline: binding.baseline,
                cacheName: binding.cacheName,
                deletedPaths: binding.deletedPaths,
                deletedDirectories: binding.deletedDirectories,
                missingPaths: binding.missingPaths,
            } satisfies PersistedDirectoryBinding);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error("Failed to save Folder binding."));
            transaction.onabort = () => reject(transaction.error || new Error("Folder binding save was aborted."));
        });
    } finally {
        database.close();
    }
}

export async function deletePersistedDirectoryBinding(workspaceName: string): Promise<void> {
    const database = await openDirectoryBindingDatabase(workspaceName);
    if (!database) return;
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(DIRECTORY_BINDING_STORE, "readwrite");
            transaction.objectStore(DIRECTORY_BINDING_STORE).delete(DIRECTORY_BINDING_KEY);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error("Failed to remove Folder binding."));
            transaction.onabort = () => reject(transaction.error || new Error("Folder binding removal was aborted."));
        });
    } finally {
        database.close();
    }
}

function openDirectoryBindingDatabase(workspaceName: string): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(workspaceName + DIRECTORY_BINDING_DATABASE_SUFFIX, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(DIRECTORY_BINDING_STORE)) {
                request.result.createObjectStore(DIRECTORY_BINDING_STORE, { keyPath: "key" });
            }
        };
        request.onerror = () => reject(request.error || new Error("Failed to open Folder binding storage."));
        request.onsuccess = () => resolve(request.result);
    });
}

function parsePersistedDirectoryBinding(value: unknown): PersistedDirectoryBinding | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<PersistedDirectoryBinding>;
    if (
        candidate.key !== DIRECTORY_BINDING_KEY
        || typeof candidate.directoryName !== "string"
        || typeof candidate.fairyPath !== "string"
        || !Array.isArray(candidate.baseline)
        || !candidate.directory
        || typeof candidate.directory.getFileHandle !== "function"
    ) {
        return null;
    }
    if (!candidate.baseline.every((entry) => (
        entry
        && typeof entry.path === "string"
        && typeof entry.bytes === "number"
        && typeof entry.sha256 === "string"
    ))) {
        return null;
    }
    return {
        key: DIRECTORY_BINDING_KEY,
        directory: candidate.directory,
        directoryName: candidate.directoryName,
        fairyPath: candidate.fairyPath,
        baseline: candidate.baseline,
        cacheName: typeof candidate.cacheName === "string" && candidate.cacheName.startsWith("fairygui-editor-online-")
            ? candidate.cacheName : undefined,
        deletedPaths: Array.isArray(candidate.deletedPaths) ? candidate.deletedPaths.filter((path): path is string => typeof path === "string") : [],
        deletedDirectories: Array.isArray(candidate.deletedDirectories) ? candidate.deletedDirectories.filter((path): path is string => typeof path === "string") : [],
        missingPaths: Array.isArray(candidate.missingPaths) ? candidate.missingPaths.filter((path): path is string => typeof path === "string") : [],
    };
}


function createDirectoryBindingError(code: string, message: string): Error & { code: string } {
    return Object.assign(new Error(message), { code });
}
