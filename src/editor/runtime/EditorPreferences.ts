export const EDITOR_PREFERENCES_STORAGE_KEY = "fairygui-editor-online.preferences.v1";

export const EDITOR_SHORTCUTS = [
    { id: "projectSearch", label: "搜索项目", defaultShortcut: "Ctrl+F" },
    { id: "save", label: "保存工作区", defaultShortcut: "Ctrl+S" },
    { id: "undo", label: "撤销", defaultShortcut: "Ctrl+Z" },
    { id: "redo", label: "重做", defaultShortcut: "Ctrl+Y" },
    { id: "nextDocument", label: "下一个文档", defaultShortcut: "Ctrl+Tab" },
    { id: "previousDocument", label: "上一个文档", defaultShortcut: "Ctrl+Shift+Tab" },
    { id: "closeDocument", label: "关闭文档", defaultShortcut: "Ctrl+W" },
    { id: "test", label: "启动或重新载入测试视图", defaultShortcut: "F5" },
] as const;

export type EditorShortcutId = typeof EDITOR_SHORTCUTS[number]["id"];

export interface EditorPreferences {
    componentPreviewEnabled: boolean;
    shortcuts: Record<EditorShortcutId, string>;
}

export interface EditorShortcutConflict {
    shortcut: string;
    labels: string[];
}

interface ShortcutEventLike {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
}

const RESERVED_SHORTCUTS: ReadonlyArray<{ label: string; shortcut: string }> = [
    { label: "复制", shortcut: "Ctrl+C" },
    { label: "剪切", shortcut: "Ctrl+X" },
    { label: "粘贴", shortcut: "Ctrl+V" },
    { label: "创建副本", shortcut: "Ctrl+D" },
    { label: "全选", shortcut: "Ctrl+A" },
    { label: "取消选择", shortcut: "Ctrl+Shift+A" },
    { label: "成组", shortcut: "Ctrl+G" },
    { label: "取消成组", shortcut: "Ctrl+Shift+G" },
    { label: "上移一层", shortcut: "Ctrl+]" },
    { label: "下移一层", shortcut: "Ctrl+[" },
    { label: "重做（备用）", shortcut: "Ctrl+Shift+Z" },
    { label: "删除", shortcut: "Delete" },
    { label: "进入组或打开引用组件", shortcut: "Enter" },
    { label: "切换网格吸附", shortcut: "G" },
];

export function createDefaultEditorPreferences(): EditorPreferences {
    return {
        componentPreviewEnabled: true,
        shortcuts: Object.fromEntries(
            EDITOR_SHORTCUTS.map((entry) => [entry.id, entry.defaultShortcut]),
        ) as Record<EditorShortcutId, string>,
    };
}

export function normalizeEditorShortcut(value: string): string {
    const tokens = value
        .replace(/⌘/g, "Ctrl")
        .split("+")
        .map((token) => token.trim())
        .filter(Boolean);
    const modifiers = new Set<string>();
    let key = "";
    for (const token of tokens) {
        const lower = token.toLocaleLowerCase();
        if (lower === "ctrl" || lower === "control" || lower === "cmd" || lower === "meta") {
            modifiers.add("Ctrl");
        } else if (lower === "alt" || lower === "option") {
            modifiers.add("Alt");
        } else if (lower === "shift") {
            modifiers.add("Shift");
        } else {
            key = lower === "space" ? "Space"
                : lower === "escape" || lower === "esc" ? "Escape"
                    : lower === "delete" || lower === "del" ? "Delete"
                        : lower === "tab" ? "Tab"
                            : token.length === 1 ? token.toLocaleUpperCase()
                                : token.replace(/^f(\d{1,2})$/i, "F$1");
        }
    }
    if (!key) return "";
    return ["Ctrl", "Alt", "Shift"].filter((modifier) => modifiers.has(modifier)).concat(key).join("+");
}

export function shortcutFromEditorEvent(event: ShortcutEventLike): string {
    const modifiers = [
        event.ctrlKey || event.metaKey ? "Ctrl" : "",
        event.altKey ? "Alt" : "",
        event.shiftKey ? "Shift" : "",
    ].filter(Boolean);
    const key = normalizeEditorShortcut(event.key === " " ? "Space" : event.key);
    if (!key || ["Ctrl", "Alt", "Shift"].includes(key)) return "";
    return modifiers.concat(key).join("+");
}

export function parseEditorPreferences(raw: string | null): EditorPreferences {
    const defaults = createDefaultEditorPreferences();
    if (!raw) return defaults;
    try {
        const value = JSON.parse(raw) as {
            componentPreviewEnabled?: unknown;
            shortcuts?: Record<string, unknown>;
        };
        if (typeof value.componentPreviewEnabled === "boolean") {
            defaults.componentPreviewEnabled = value.componentPreviewEnabled;
        }
        for (const entry of EDITOR_SHORTCUTS) {
            const shortcut = value.shortcuts?.[entry.id];
            if (typeof shortcut === "string") defaults.shortcuts[entry.id] = normalizeEditorShortcut(shortcut);
        }
    } catch {
        return defaults;
    }
    return defaults;
}

export function findEditorShortcutConflicts(preferences: EditorPreferences): EditorShortcutConflict[] {
    const byShortcut = new Map<string, string[]>();
    for (const entry of EDITOR_SHORTCUTS) {
        const shortcut = preferences.shortcuts[entry.id];
        if (shortcut) byShortcut.set(shortcut, [...(byShortcut.get(shortcut) || []), entry.label]);
    }
    for (const reserved of RESERVED_SHORTCUTS) {
        byShortcut.set(reserved.shortcut, [...(byShortcut.get(reserved.shortcut) || []), reserved.label]);
    }
    return [...byShortcut]
        .filter(([, labels]) => labels.length > 1)
        .map(([shortcut, labels]) => ({ shortcut, labels }));
}

export function resolveEditorShortcut(
    event: ShortcutEventLike,
    preferences: EditorPreferences,
): EditorShortcutId | null {
    const shortcut = shortcutFromEditorEvent(event);
    if (!shortcut || findEditorShortcutConflicts(preferences).some((entry) => entry.shortcut === shortcut)) {
        return null;
    }
    return EDITOR_SHORTCUTS.find((entry) => preferences.shortcuts[entry.id] === shortcut)?.id || null;
}
