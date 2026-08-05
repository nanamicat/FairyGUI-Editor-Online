// Persisted namespace. Changing this would orphan existing browser workspaces.
export const DEFAULT_BROWSER_WORKSPACE_ID = "fairygui-editor-online-phase8";
export const BROWSER_WORKSPACE_REGISTRY_STORAGE_KEY = "fairygui-editor-online.workspaces.v1";

export interface BrowserWorkspaceRegistryEntry {
    id: string;
    name: string;
    fairyPath: string;
    lastOpenedAt: string;
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
            ))
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
