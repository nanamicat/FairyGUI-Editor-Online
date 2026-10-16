// Persisted namespace. Changing this would orphan existing browser workspaces.
export const DEFAULT_BROWSER_WORKSPACE_ID = "fairygui-editor-online-phase8";
export const BROWSER_WORKSPACE_REGISTRY_STORAGE_KEY = "fairygui-editor-online.workspaces.v1";
export const BROWSER_WORKSPACE_QUARANTINE_STORAGE_PREFIX = "fairygui-editor-online.workspace-quarantine.v1";
const BROWSER_WORKSPACE_QUARANTINE_DATABASE = "fairygui-editor-online-workspace-safety";
const BROWSER_WORKSPACE_QUARANTINE_STORE = "quarantines";

export interface BrowserWorkspaceRegistryEntry {
    id: string;
    name: string;
    fairyPath: string;
    lastOpenedAt: string;
    source?: "directory" | "zip";
    sourceName?: string;
    directoryBound?: boolean;
}

export interface BrowserWorkspaceRegistry {
    activeId: string;
    entries: BrowserWorkspaceRegistryEntry[];
}

export function createDefaultBrowserWorkspaceRegistry(now = new Date().toISOString()): BrowserWorkspaceRegistry {
    return {
        activeId: DEFAULT_BROWSER_WORKSPACE_ID,
        entries: [{
            id: DEFAULT_BROWSER_WORKSPACE_ID,
            name: "Default workspace",
            fairyPath: "FairyGUI-layabox-demo.fairy",
            lastOpenedAt: now,
        }],
    };
}

export function parseBrowserWorkspaceRegistry(raw: string | null): BrowserWorkspaceRegistry {
    const fallback = createDefaultBrowserWorkspaceRegistry();
    if (!raw) return fallback;
    try {
        const value = JSON.parse(raw) as Partial<BrowserWorkspaceRegistry>;
        const entries = Array.isArray(value.entries)
            ? value.entries.filter((entry): entry is BrowserWorkspaceRegistryEntry => (
                !!entry
                && typeof entry.id === "string"
                && entry.id.startsWith("fairygui-editor-online-")
                && typeof entry.name === "string"
                && typeof entry.fairyPath === "string"
                && typeof entry.lastOpenedAt === "string"
            )).map((entry): BrowserWorkspaceRegistryEntry => ({
                id: entry.id,
                name: entry.name,
                fairyPath: entry.fairyPath,
                lastOpenedAt: entry.lastOpenedAt,
                source: entry.source === "directory" || entry.source === "zip" ? entry.source : undefined,
                sourceName: typeof entry.sourceName === "string" ? entry.sourceName : undefined,
                directoryBound: entry.directoryBound === true,
            }))
            : [];
        if (entries.length === 0) return fallback;
        return {
            activeId: entries.some((entry) => entry.id === value.activeId)
                ? String(value.activeId)
                : entries[0].id,
            entries: entries.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)),
        };
    } catch {
        return fallback;
    }
}

export function getBrowserWorkspaceQuarantineStorageKey(workspaceId: string): string {
    return `${BROWSER_WORKSPACE_QUARANTINE_STORAGE_PREFIX}:${workspaceId}`;
}

export async function readBrowserWorkspaceQuarantine(workspaceId: string): Promise<string | null> {
    const results = await Promise.allSettled([
        readLocalWorkspaceQuarantine(workspaceId),
        readIndexedWorkspaceQuarantine(workspaceId),
    ]);
    for (const result of results) {
        if (result.status === "fulfilled" && result.value) return result.value;
    }
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) {
        throw new Error(`Workspace quarantine state could not be read: ${failures.map((result) => formatError(result.reason)).join("; ")}`);
    }
    return null;
}

export async function writeBrowserWorkspaceQuarantine(workspaceId: string, reason: string): Promise<void> {
    const results = await Promise.allSettled([
        writeLocalWorkspaceQuarantine(workspaceId, reason),
        writeIndexedWorkspaceQuarantine(workspaceId, reason),
    ]);
    if (results.some((result) => result.status === "fulfilled" && result.value)) return;
    throw new Error(`Workspace quarantine marker could not be persisted: ${results.map((result) => (
        result.status === "rejected" ? formatError(result.reason) : "storage unavailable"
    )).join("; ")}`);
}

export async function clearBrowserWorkspaceQuarantine(workspaceId: string): Promise<void> {
    const results = await Promise.allSettled([
        clearLocalWorkspaceQuarantine(workspaceId),
        clearIndexedWorkspaceQuarantine(workspaceId),
    ]);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw new Error(`Workspace quarantine marker could not be cleared: ${formatError(failure.reason)}`);
}

function parseWorkspaceQuarantine(value: unknown, workspaceId: string): string | null {
    if (value === null || value === undefined) return null;
    try {
        const candidate = typeof value === "string"
            ? JSON.parse(value) as { workspaceId?: unknown; reason?: unknown }
            : value as { workspaceId?: unknown; reason?: unknown };
        if (candidate.workspaceId === workspaceId && typeof candidate.reason === "string" && candidate.reason) {
            return candidate.reason;
        }
    } catch {
        // An unreadable safety marker must fail closed instead of being treated as absent.
    }
    return "Workspace quarantine marker is invalid. Re-import the workspace before editing or saving.";
}

async function readLocalWorkspaceQuarantine(workspaceId: string): Promise<string | null> {
    if (typeof localStorage === "undefined") return null;
    return parseWorkspaceQuarantine(
        localStorage.getItem(getBrowserWorkspaceQuarantineStorageKey(workspaceId)),
        workspaceId,
    );
}

async function writeLocalWorkspaceQuarantine(workspaceId: string, reason: string): Promise<boolean> {
    if (typeof localStorage === "undefined") return false;
    const key = getBrowserWorkspaceQuarantineStorageKey(workspaceId);
    const serialized = JSON.stringify({ workspaceId, reason });
    localStorage.setItem(key, serialized);
    if (localStorage.getItem(key) !== serialized) {
        throw new Error("Workspace quarantine marker could not be verified.");
    }
    return true;
}

async function clearLocalWorkspaceQuarantine(workspaceId: string): Promise<void> {
    if (typeof localStorage === "undefined") return;
    const key = getBrowserWorkspaceQuarantineStorageKey(workspaceId);
    localStorage.removeItem(key);
    if (localStorage.getItem(key) !== null) {
        throw new Error("Workspace quarantine marker could not be cleared.");
    }
}

async function readIndexedWorkspaceQuarantine(workspaceId: string): Promise<string | null> {
    const database = await openWorkspaceQuarantineDatabase();
    if (!database) return null;
    try {
        const value = await new Promise<unknown>((resolve, reject) => {
            const request = database.transaction(BROWSER_WORKSPACE_QUARANTINE_STORE, "readonly")
                .objectStore(BROWSER_WORKSPACE_QUARANTINE_STORE)
                .get(workspaceId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("Workspace quarantine read failed."));
        });
        return parseWorkspaceQuarantine(value, workspaceId);
    } finally {
        database.close();
    }
}

async function writeIndexedWorkspaceQuarantine(workspaceId: string, reason: string): Promise<boolean> {
    const database = await openWorkspaceQuarantineDatabase();
    if (!database) return false;
    try {
        await runWorkspaceQuarantineTransaction(database, (store) => {
            store.put({ workspaceId, reason });
        });
    } finally {
        database.close();
    }
    if (await readIndexedWorkspaceQuarantine(workspaceId) !== reason) {
        throw new Error("IndexedDB quarantine marker could not be verified.");
    }
    return true;
}

async function clearIndexedWorkspaceQuarantine(workspaceId: string): Promise<void> {
    const database = await openWorkspaceQuarantineDatabase();
    if (!database) return;
    try {
        await runWorkspaceQuarantineTransaction(database, (store) => {
            store.delete(workspaceId);
        });
    } finally {
        database.close();
    }
    if (await readIndexedWorkspaceQuarantine(workspaceId) !== null) {
        throw new Error("IndexedDB quarantine marker could not be cleared.");
    }
}

function runWorkspaceQuarantineTransaction(
    database: IDBDatabase,
    mutate: (store: IDBObjectStore) => void,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(BROWSER_WORKSPACE_QUARANTINE_STORE, "readwrite");
        mutate(transaction.objectStore(BROWSER_WORKSPACE_QUARANTINE_STORE));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Workspace quarantine transaction failed."));
        transaction.onabort = () => reject(transaction.error || new Error("Workspace quarantine transaction was aborted."));
    });
}

function openWorkspaceQuarantineDatabase(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(BROWSER_WORKSPACE_QUARANTINE_DATABASE, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(BROWSER_WORKSPACE_QUARANTINE_STORE)) {
                request.result.createObjectStore(BROWSER_WORKSPACE_QUARANTINE_STORE, { keyPath: "workspaceId" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Workspace quarantine storage could not be opened."));
    });
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function addBrowserWorkspace(
    registry: BrowserWorkspaceRegistry,
    name: string,
    now = new Date().toISOString(),
): { registry: BrowserWorkspaceRegistry; entry: BrowserWorkspaceRegistryEntry } {
    const displayName = name.trim() || "Workspace";
    const slug = displayName.toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "workspace";
    let id = `fairygui-editor-online-workspace-${slug}`;
    let suffix = 2;
    while (registry.entries.some((entry) => entry.id === id)) {
        id = `fairygui-editor-online-workspace-${slug}-${suffix}`;
        suffix += 1;
    }
    const entry: BrowserWorkspaceRegistryEntry = {
        id,
        name: displayName,
        fairyPath: "FairyGUI-layabox-demo.fairy",
        lastOpenedAt: now,
    };
    return {
        entry,
        registry: { activeId: id, entries: [entry, ...registry.entries] },
    };
}

export function activateBrowserWorkspace(
    registry: BrowserWorkspaceRegistry,
    id: string,
    fairyPath?: string,
    now = new Date().toISOString(),
): BrowserWorkspaceRegistry {
    if (!registry.entries.some((entry) => entry.id === id)) return registry;
    return {
        activeId: id,
        entries: registry.entries.map((entry) => entry.id === id
            ? { ...entry, fairyPath: fairyPath || entry.fairyPath, lastOpenedAt: now }
            : entry),
    };
}
