import type { EditorResourceSelector } from "../model/EditorCommand";

export type ResourceHealthIssueKind = "duplicate" | "unused" | "conflict";

export interface ResourceHealthEntry extends EditorResourceSelector {
    packageName: string;
    resourceKind: string;
    name: string;
    path: string;
    branch: string;
    incomingReferences: number;
}

export interface ResourceHealthIssue {
    id: string;
    kind: ResourceHealthIssueKind;
    label: string;
    detail: string;
    entries: ResourceHealthEntry[];
    repair: "remove" | "rename" | null;
}

export interface ResourceHealthReport {
    issues: ResourceHealthIssue[];
    duplicateGroups: number;
    unusedResources: number;
    conflictGroups: number;
    scannedResources: number;
}

interface ResourceRecord extends ResourceHealthEntry {
    sourceBytes: Uint8Array | null;
    exported: boolean;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function sourceBytes(value: unknown): Uint8Array | null {
    if (value instanceof Uint8Array) return value;
    const encoded = record(value);
    if (encoded.encoding !== "base64" || typeof encoded.data !== "string") return null;
    try {
        return Uint8Array.from(atob(encoded.data), (character) => character.charCodeAt(0));
    } catch {
        return null;
    }
}

async function digest(bytes: Uint8Array): Promise<string> {
    const result = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function issueLabel(kind: ResourceHealthIssueKind, entries: ResourceHealthEntry[]): string {
    if (kind === "unused") return `${entries[0]?.packageName || "Project"}: ${entries.length} unused`;
    const first = entries[0];
    return kind === "duplicate"
        ? `${entries.length} duplicate ${first?.resourceKind || "resource"} files`
        : `${first?.packageName || "Package"}${first?.path || "/"}${first?.name || "resource"}: ${entries.length} conflicts`;
}

export async function auditProjectResources(
    projectValue: unknown,
    countIncomingReferences: (selector: EditorResourceSelector) => number,
): Promise<ResourceHealthReport> {
    const project = record(projectValue);
    const resources: ResourceRecord[] = [];
    for (const packageValue of Array.isArray(project.packages) ? project.packages : []) {
        const pkg = record(packageValue);
        const packageId = String(pkg.id || "");
        const packageName = String(pkg.name || packageId);
        for (const resourceValue of Array.isArray(pkg.resources) ? pkg.resources : []) {
            const resource = record(resourceValue);
            const resourceId = String(resource.id || "");
            if (!packageId || !resourceId) continue;
            const selector = { packageId, resourceId };
            resources.push({
                ...selector,
                packageName,
                resourceKind: String(resource.kind || "resource"),
                name: String(resource.name || resourceId),
                path: String(resource.path || "/"),
                branch: String(resource.branch || ""),
                exported: resource.exported === true,
                incomingReferences: countIncomingReferences(selector),
                sourceBytes: sourceBytes(resource.sourceBytes),
            });
        }
    }

    const issues: ResourceHealthIssue[] = [];
    const conflicts = new Map<string, ResourceRecord[]>();
    for (const resource of resources) {
        const key = [resource.packageId, resource.branch, resource.path, resource.name.toLocaleLowerCase()].join("\0");
        const group = conflicts.get(key) || [];
        group.push(resource);
        conflicts.set(key, group);
    }
    for (const [key, entries] of conflicts) {
        if (entries.length < 2) continue;
        issues.push({
            id: `conflict:${key}`,
            kind: "conflict",
            label: issueLabel("conflict", entries),
            detail: "Rename selected conflicting resources; the first resource keeps its name.",
            entries,
            repair: "rename",
        });
    }

    const unusedByPackage = new Map<string, ResourceRecord[]>();
    for (const resource of resources) {
        if (resource.resourceKind === "component" || resource.exported || resource.incomingReferences > 0) continue;
        const entries = unusedByPackage.get(resource.packageId) || [];
        entries.push(resource);
        unusedByPackage.set(resource.packageId, entries);
    }
    for (const [packageId, entries] of unusedByPackage) {
        issues.push({
            id: `unused:${packageId}`,
            kind: "unused",
            label: issueLabel("unused", entries),
            detail: "Unexported non-component resources with zero incoming references. Removal remains opt-in.",
            entries,
            repair: "remove",
        });
    }

    const duplicateCandidates = new Map<string, ResourceRecord[]>();
    await Promise.all(resources.filter((resource) => resource.sourceBytes?.byteLength).map(async (resource) => {
        const bytes = resource.sourceBytes!;
        const key = `${resource.resourceKind}:${bytes.byteLength}:${await digest(bytes)}`;
        const entries = duplicateCandidates.get(key) || [];
        entries.push(resource);
        duplicateCandidates.set(key, entries);
    }));
    for (const [key, entries] of duplicateCandidates) {
        if (entries.length < 2) continue;
        issues.push({
            id: `duplicate:${key}`,
            kind: "duplicate",
            label: issueLabel("duplicate", entries),
            detail: "Exact SHA-256 byte duplicates. Referenced-resource merge stays read-only until reference rewrite is supported.",
            entries,
            repair: null,
        });
    }

    issues.sort((left, right) => left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label));
    return {
        issues,
        duplicateGroups: issues.filter((issue) => issue.kind === "duplicate").length,
        unusedResources: issues.filter((issue) => issue.kind === "unused")
            .reduce((count, issue) => count + issue.entries.length, 0),
        conflictGroups: issues.filter((issue) => issue.kind === "conflict").length,
        scannedResources: resources.length,
    };
}
