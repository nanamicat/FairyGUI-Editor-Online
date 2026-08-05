import { readListProperties, readTextInputProperties } from "../commands/DisplayListReaders";
import type { UamDisplayNodeLike } from "../commands/AuthoringTransactionSupport";
import type {
    ComponentInstanceEditableProperties,
    DisplayNodeEditableProps,
    SetDisplayNodePropsCommand,
} from "../model/EditorCommand";

type JsonObject = Record<string, unknown>;

export interface BrowserLanguageEntry {
    name: string;
    nodeName: string;
    text: string;
}

export interface BrowserLanguageGearUpdate {
    selector: { packageId: string; componentResourceId: string; displayNodeId: string };
    gears: unknown[];
}

function object(value: unknown): JsonObject {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function values(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function isLocalizable(value: string): boolean {
    return Array.from(value).some((character) => (character.codePointAt(0) ?? 0) >= 65);
}

function appendEntry(
    entries: BrowserLanguageEntry[],
    prefix: string,
    suffix: string,
    nodeName: string,
    value: unknown,
): void {
    const source = text(value);
    if (!isLocalizable(source)) return;
    entries.push({
        name: `${prefix}${suffix ? `-${suffix}` : ""}`,
        nodeName,
        text: source,
    });
}

export function collectBrowserLanguageEntries(
    project: unknown,
    packageIds?: ReadonlySet<string>,
): BrowserLanguageEntry[] {
    const entries: BrowserLanguageEntry[] = [];
    for (const packageValue of values(object(project).packages)) {
        const pkg = object(packageValue);
        const packageId = text(pkg.id);
        if (!packageId || packageIds && !packageIds.has(packageId)) continue;
        const components = values(pkg.resources)
            .map(object)
            .filter((resource) => resource.kind === "component")
            .sort((left, right) => text(left.name).localeCompare(text(right.name)) || text(left.id).localeCompare(text(right.id)));
        for (const resource of components) {
            const resourceId = text(resource.id);
            if (!resourceId) continue;
            for (const nodeValue of values(object(resource.component).displayList)) {
                const node = object(nodeValue);
                const nodeId = text(node.id);
                if (!nodeId) continue;
                const prefix = `${packageId}${resourceId}-${nodeId}`;
                const nodeName = text(node.name);
                appendEntry(entries, prefix, "tips", nodeName, node.tooltips);

                if (["text", "richText", "textInput"].includes(text(node.kind))) {
                    if (node.autoClearText !== true) appendEntry(entries, prefix, "", nodeName, node.text);
                    if (node.kind === "textInput") appendEntry(entries, prefix, "prompt", nodeName, node.promptText);
                }

                if (node.kind === "list" || node.kind === "tree") {
                    values(node.listItems).forEach((itemValue, index) => {
                        const item = object(itemValue);
                        appendEntry(entries, prefix, String(index), nodeName, item.title);
                        appendEntry(entries, prefix, `${index}-0`, nodeName, item.selectedTitle);
                    });
                }

                const instance = object(node.instanceProperties);
                const extensionType = text(instance.extensionType);
                if (node.kind === "component" && extensionType) {
                    appendEntry(entries, prefix, "", nodeName, instance.title);
                    if (extensionType === "Button") appendEntry(entries, prefix, "0", nodeName, instance.selectedTitle);
                    if (extensionType === "Label") appendEntry(entries, prefix, "prompt", nodeName, instance.promptText);
                    if (extensionType === "ComboBox") {
                        values(instance.items).forEach((itemValue, index) => {
                            appendEntry(entries, prefix, String(index), nodeName, object(itemValue).title);
                        });
                    }
                } else if (["button", "label", "comboBox"].includes(text(node.kind))) {
                    appendEntry(entries, prefix, "", nodeName, node.title);
                    if (node.kind === "button") appendEntry(entries, prefix, "0", nodeName, node.selectedTitle);
                    if (node.kind === "comboBox") {
                        values(node.items).forEach((item, index) => appendEntry(entries, prefix, String(index), nodeName, item));
                    }
                }

                for (const gearValue of values(node.gears)) {
                    const gear = object(gearValue);
                    if (gear.kind !== "text") continue;
                    values(gear.states).forEach((stateValue, index) => {
                        appendEntry(entries, prefix, `texts_${index}`, nodeName, object(object(stateValue).value).text);
                    });
                    appendEntry(entries, prefix, "texts_def", nodeName, object(gear.defaultValue).text);
                }
            }
        }
    }
    return entries;
}

export function readBrowserLanguageValues(xml: string): Map<string, string> {
    if (xml.length > 8 * 1024 * 1024) throw new Error("Language file exceeds the 8 MiB browser limit.");
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror") || document.documentElement.localName !== "resources") {
        throw new Error("Language file is not valid <resources> XML.");
    }
    const result = new Map<string, string>();
    for (const element of Array.from(document.documentElement.children)) {
        if (element.localName !== "string") continue;
        const name = element.getAttribute("name") || "";
        if (name) result.set(name, element.textContent || "");
    }
    return result;
}

export function createBrowserLanguageXml(
    project: unknown,
    preservedValues: ReadonlyMap<string, string> = new Map(),
    packageIds?: ReadonlySet<string>,
): string {
    const rows = collectBrowserLanguageEntries(project, packageIds).map((entry) => {
        const value = preservedValues.get(entry.name) ?? entry.text;
        return `  <string name="${escapeXml(entry.name)}" mz="${escapeXml(entry.nodeName)}">${escapeXml(value)}</string>`;
    });
    return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${rows.join("\n")}\n</resources>\n`;
}

export function createBrowserLanguageCommands(
    project: unknown,
    importedValues: ReadonlyMap<string, string>,
    packageIds?: ReadonlySet<string>,
): { commands: SetDisplayNodePropsCommand[]; gearUpdates: BrowserLanguageGearUpdate[]; matched: number } {
    const commands: SetDisplayNodePropsCommand[] = [];
    const gearUpdates: BrowserLanguageGearUpdate[] = [];
    const matchedNames = new Set<string>();
    for (const packageValue of values(object(project).packages)) {
        const pkg = object(packageValue);
        const packageId = text(pkg.id);
        if (!packageId || packageIds && !packageIds.has(packageId)) continue;
        for (const resourceValue of values(pkg.resources)) {
            const resource = object(resourceValue);
            if (resource.kind !== "component") continue;
            const componentResourceId = text(resource.id);
            if (!componentResourceId) continue;
            for (const nodeValue of values(object(resource.component).displayList)) {
                const node = object(nodeValue) as UamDisplayNodeLike;
                const displayNodeId = text(node.id);
                if (!displayNodeId) continue;
                const prefix = `${packageId}${componentResourceId}-${displayNodeId}`;
                const props: DisplayNodeEditableProps = {};
                const imported = (suffix: string): string | undefined => {
                    const name = `${prefix}${suffix ? `-${suffix}` : ""}`;
                    const value = importedValues.get(name);
                    if (value !== undefined) matchedNames.add(name);
                    return value;
                };
                const tooltips = imported("tips");
                if (tooltips !== undefined) props.tooltips = tooltips;
                if (["text", "richText", "textInput"].includes(text(node.kind))) {
                    const value = imported("");
                    if (value !== undefined) props.text = value;
                    if (node.kind === "textInput") {
                        const promptText = imported("prompt");
                        if (promptText !== undefined) props.textInputProperties = {
                            ...readTextInputProperties(node),
                            promptText,
                        };
                    }
                }
                if (node.kind === "list" || node.kind === "tree") {
                    const listProperties = readListProperties(node);
                    let changed = false;
                    listProperties.listItems = listProperties.listItems.map((item, index) => {
                        const title = imported(String(index));
                        const selectedTitle = imported(`${index}-0`);
                        changed ||= title !== undefined || selectedTitle !== undefined;
                        return {
                            ...item,
                            title: title ?? item.title,
                            selectedTitle: selectedTitle ?? item.selectedTitle,
                        };
                    });
                    if (changed) props.listProperties = listProperties;
                }
                const instance = object(node.instanceProperties);
                const extensionType = text(instance.extensionType);
                if (node.kind === "component" && extensionType) {
                    const next = structuredClone(instance);
                    let changed = false;
                    const set = (key: string, suffix: string): void => {
                        const value = imported(suffix);
                        if (value === undefined) return;
                        next[key] = value;
                        changed = true;
                    };
                    set("title", "");
                    if (extensionType === "Button") set("selectedTitle", "0");
                    if (extensionType === "Label") set("promptText", "prompt");
                    if (extensionType === "ComboBox" && Array.isArray(next.items)) {
                        next.items = next.items.map((itemValue, index) => {
                            const title = imported(String(index));
                            if (title === undefined) return itemValue;
                            changed = true;
                            return { ...object(itemValue), title };
                        });
                    }
                    if (changed) props.componentInstanceProperties = next as unknown as ComponentInstanceEditableProperties;
                }
                const selector = { packageId, componentResourceId, displayNodeId };
                const gears = structuredClone(values(node.gears));
                let gearsChanged = false;
                for (const gearValue of gears) {
                    const gear = object(gearValue);
                    if (gear.kind !== "text") continue;
                    const states = values(gear.states);
                    states.forEach((stateValue, index) => {
                        const value = imported(`texts_${index}`);
                        if (value === undefined) return;
                        const state = object(stateValue);
                        state.value = { ...object(state.value), text: value };
                        gearsChanged = true;
                    });
                    const defaultValue = imported("texts_def");
                    if (defaultValue !== undefined) {
                        gear.defaultValue = { ...object(gear.defaultValue), text: defaultValue };
                        gearsChanged = true;
                    }
                }
                if (Object.keys(props).length) commands.push({ kind: "setDisplayNodeProps", selector, props });
                if (gearsChanged) gearUpdates.push({ selector, gears });
            }
        }
    }
    return { commands, gearUpdates, matched: matchedNames.size };
}

export function normalizeBrowserLanguagePath(value: string): string {
    if (!value || value.includes("\0") || /^[\\/]/.test(value) || /^[A-Za-z]:/.test(value)) {
        throw new Error("Language file path must be relative to the project root.");
    }
    const parts = value.replace(/\\/g, "/").split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) {
        throw new Error("Language file path contains an unsafe segment.");
    }
    const path = parts.join("/");
    if (!path.toLowerCase().endsWith(".xml")) throw new Error("Language file path must end with .xml.");
    return path;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
