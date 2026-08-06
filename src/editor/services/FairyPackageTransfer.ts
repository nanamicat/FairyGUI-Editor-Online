import type { BrowserWorkspaceFile } from "../model/BrowserWorkspace";
import type {
    EditorCommandOperation,
    EditorHighRiskTransaction,
} from "../model/EditorCommand";
import {
    createStoredZipBlob,
    type BrowserProjectStorageAdapter,
} from "./BrowserProjectStorage";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const FNT_DECODER = new TextDecoder("utf-8", { fatal: true });
const SYNTHETIC_PROJECT_FILE = "PackageImport.fairy";

interface BackendResult {
    ok: boolean;
    data?: { sessionId?: string; revision?: number };
    error?: { code?: string; message?: string };
}

interface TransferRuntime {
    openProjectSession(input: { project: unknown; canonicalProjectPath?: string }): BackendResult;
    materializeSession?(input: {
        sessionId: string;
        storage: { fileSystem: unknown; fairyPath: string };
        mode: "fullProject";
        reason: string;
    }): Promise<BackendResult>;
}

export interface FairyPackageBackendModule {
    BackendRuntime: new () => TransferRuntime;
    createBackendStorageFileSystem(storage: BrowserProjectStorageAdapter): unknown;
    ProjectReader: new (fileSystem: unknown) => {
        read(projectPath: string, options: {
            includeBinaryData: boolean;
            hydrateResourceBytes: boolean;
        }): Promise<unknown>;
    };
    liftDocumentToUamProject(document: unknown): unknown;
}

export interface FairyPackageExport {
    packageId: string;
    packageName: string;
    fileName: string;
    files: BrowserWorkspaceFile[];
    blob: Blob;
}

export interface FairyPackageResourceSelector {
    packageId: string;
    resourceId: string;
}

export type FairyPackageImportConflictStrategy = "rename" | "replace" | "skip";

export interface FairyPackageResourceImportOptions {
    targetPackageId: string;
    targetPath: string;
    targetBranch?: string;
    conflictStrategy: FairyPackageImportConflictStrategy;
}

export interface FairyPackageResourceImportConflict {
    incomingResourceId: string;
    incomingName: string;
    incomingKind: string;
    targetResourceId: string;
    targetName: string;
    targetKind: string;
    targetPath: string;
    fileName: string;
}

export interface FairyPackageResourceImportInspection {
    targetPackageId: string;
    targetPath: string;
    targetBranch: string;
    resourceCount: number;
    folderCount: number;
    conflicts: FairyPackageResourceImportConflict[];
}

export interface FairyPackageResourceImportCounts {
    added: number;
    replaced: number;
    skipped: number;
}

export type FairyPackageResourceImportPreparation = {
    ok: true;
    transaction: EditorHighRiskTransaction;
    inspection: FairyPackageResourceImportInspection;
    counts: FairyPackageResourceImportCounts;
} | {
    ok: false;
    code: string;
    message: string;
    inspection?: FairyPackageResourceImportInspection;
};

interface TransferPackage extends Record<string, unknown> {
    id?: string;
    name?: string;
    branchNames?: string[];
    folders?: Array<Record<string, unknown>>;
    resources?: Array<Record<string, unknown>>;
}

interface TransferProject extends Record<string, unknown> {
    packages?: TransferPackage[];
}

interface TransferResourceEntry {
    packageId: string;
    packageName: string;
    pkg: TransferPackage;
    resource: Record<string, unknown>;
}

export class FairyPackageTransferError extends Error {
    constructor(public readonly code: string, message: string) {
        super(message);
        this.name = "FairyPackageTransferError";
    }
}

export async function readFairyPackageFiles(
    backend: FairyPackageBackendModule,
    archiveFiles: BrowserWorkspaceFile[],
): Promise<unknown> {
    try {
        const files = normalizeArchiveFiles(archiveFiles);
        if (!files.some((file) => file.path === "package.xml")) {
            throw transferError("fairy_package_invalid_archive", "The archive root does not contain package.xml.");
        }
        const storage = new MemoryTransferStorage();
        await storage.writeFile(
            SYNTHETIC_PROJECT_FILE,
            '<?xml version="1.0" encoding="utf-8"?>\n'
            + '<projectDescription id="fairy-package-import" type="Layabox" version="3.0"/>\n',
        );
        const projectPaths = new Set<string>();
        for (const file of files) {
            const projectPath = getImportedArchiveProjectPath(file.path);
            if (projectPaths.has(projectPath)) {
                throw transferError("fairy_package_invalid_archive", `Archive paths collide at ${projectPath}.`);
            }
            projectPaths.add(projectPath);
            await storage.writeFileRaw(projectPath, file.data);
        }
        const fileSystem = backend.createBackendStorageFileSystem(storage);
        const document = await new backend.ProjectReader(fileSystem).read(SYNTHETIC_PROJECT_FILE, {
            includeBinaryData: true,
            hydrateResourceBytes: true,
        });
        const project = backend.liftDocumentToUamProject(document) as { packages?: unknown[] };
        if (!Array.isArray(project.packages) || project.packages.length !== 1) {
            throw transferError("fairy_package_invalid_archive", "The archive did not resolve to exactly one FairyGUI package.");
        }
        assertHydratedResources(project.packages[0]);
        return structuredClone(project.packages[0]);
    } catch (error) {
        if (error instanceof FairyPackageTransferError) throw error;
        throw transferError(
            "fairy_package_invalid_archive",
            `The FairyGUI package archive could not be read: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function exportFairyPackage(
    backend: FairyPackageBackendModule,
    projectValue: unknown,
    packageId: string,
): Promise<FairyPackageExport> {
    const project = projectValue as { packages?: Array<Record<string, unknown>> };
    const pkg = project?.packages?.find((candidate) => candidate.id === packageId);
    if (!pkg) throw transferError("fairy_package_not_found", `Package ${packageId} was not found.`);
    const externalPackageIds = findTypedPackageExternalDependencyIds(pkg, packageId);
    const portablePackage = externalPackageIds.length > 0
        ? createFairyPackageResourceSubset(
            project as TransferProject,
            (Array.isArray(pkg.resources) ? pkg.resources : []).map((resource) => ({
                packageId,
                resourceId: String(resource.id || ""),
            })),
            true,
        )
        : structuredClone(pkg) as TransferPackage;
    assertHydratedResources(portablePackage);

    return materializeFairyPackage(
        backend,
        project as TransferProject,
        portablePackage,
        `${String(pkg.name || packageId)}.fairypackage`,
    );
}

export async function exportFairyPackageResources(
    backend: FairyPackageBackendModule,
    projectValue: unknown,
    selectors: FairyPackageResourceSelector[],
): Promise<FairyPackageExport> {
    const project = projectValue as TransferProject;
    const subset = createFairyPackageResourceSubset(project, selectors);
    const packageName = String(subset.name || subset.id || "SelectedResources");
    return materializeFairyPackage(
        backend,
        project,
        subset,
        `${packageName}-selection.fairypackage`,
    );
}

async function materializeFairyPackage(
    backend: FairyPackageBackendModule,
    projectValue: TransferProject,
    pkg: TransferPackage,
    fileName: string,
): Promise<FairyPackageExport> {
    const packageId = String(pkg.id || "");
    const packageName = String(pkg.name || packageId);
    if (!/^[A-Za-z0-9]{8}$/.test(packageId) || !packageName) {
        throw transferError("fairy_package_invalid_snapshot", "The FairyGUI package export snapshot is missing its package id or name.");
    }
    assertHydratedResources(pkg);

    const portableProject = structuredClone(projectValue) as TransferProject & { packages: TransferPackage[] };
    portableProject.packages = [structuredClone(pkg)];
    const storage = new MemoryTransferStorage();
    const fileSystem = backend.createBackendStorageFileSystem(storage);
    const runtime = new backend.BackendRuntime();
    const opened = runtime.openProjectSession({
        project: portableProject,
        canonicalProjectPath: `memory://fairy-package-export/${packageId}`,
    });
    if (!opened.ok || !opened.data?.sessionId || typeof runtime.materializeSession !== "function") {
        throw transferError(
            "fairy_package_materialize_failed",
            opened.error?.message || "The backend cannot materialize an isolated FairyGUI package.",
        );
    }
    const materialized = await runtime.materializeSession({
        sessionId: opened.data.sessionId,
        storage: { fileSystem, fairyPath: "PackageExport.fairy" },
        mode: "fullProject",
        reason: "fairy_package_export",
    });
    if (!materialized.ok) {
        throw transferError(
            "fairy_package_materialize_failed",
            materialized.error?.message || "The backend failed to materialize the FairyGUI package.",
        );
    }

    const files = collectMaterializedArchiveFiles(storage.listFiles(), packageName, pkg);
    if (!files.some((file) => file.path === "package.xml")) {
        throw transferError("fairy_package_materialize_failed", "The materialized package is missing package.xml.");
    }
    return {
        packageId,
        packageName,
        fileName,
        files,
        blob: await createStoredZipBlob(files),
    };
}

function createFairyPackageResourceSubset(
    project: TransferProject,
    selectors: FairyPackageResourceSelector[],
    preserveSourcePackageId = false,
): TransferPackage {
    if (!Array.isArray(selectors) || selectors.length === 0) {
        throw transferError("fairy_package_resource_selection_empty", "Select at least one FairyGUI resource to export.");
    }
    const sourcePackageId = String(selectors[0]?.packageId || "");
    if (!sourcePackageId || selectors.some((selector) => selector.packageId !== sourcePackageId)) {
        throw transferError(
            "fairy_package_resource_selection_package_mismatch",
            "Selected FairyGUI resources must belong to one source package.",
        );
    }

    const packages = Array.isArray(project?.packages) ? project.packages : [];
    const packageIndex = new Map<string, TransferPackage>();
    const resourceIndex = new Map<string, Map<string, Record<string, unknown>>>();
    for (const pkg of packages) {
        const packageId = String(pkg.id || "");
        if (!packageId) continue;
        packageIndex.set(packageId, pkg);
        const resources = new Map<string, Record<string, unknown>>();
        for (const resource of Array.isArray(pkg.resources) ? pkg.resources : []) {
            const resourceId = String(resource.id || "");
            if (resourceId) resources.set(resourceId, resource);
        }
        resourceIndex.set(packageId, resources);
    }
    const sourcePackage = packageIndex.get(sourcePackageId);
    if (!sourcePackage) {
        throw transferError("fairy_package_not_found", `Package ${sourcePackageId} was not found.`);
    }

    const includedKeys = new Set<string>();
    const queue: TransferResourceEntry[] = [];
    const keyOf = (packageId: string, resourceId: string): string => `${packageId}\0${resourceId}`;
    const enqueue = (packageId: string, resourceId: string, sourceLabel: string): void => {
        const pkg = packageIndex.get(packageId);
        const resource = resourceIndex.get(packageId)?.get(resourceId);
        if (!pkg || !resource) {
            throw transferError(
                "fairy_package_dependency_not_found",
                `${sourceLabel} references missing FairyGUI resource ${packageId}/${resourceId}.`,
            );
        }
        const key = keyOf(packageId, resourceId);
        if (includedKeys.has(key)) return;
        includedKeys.add(key);
        queue.push({
            packageId,
            packageName: String(pkg.name || packageId),
            pkg,
            resource,
        });
    };
    const scanReferences = (value: unknown, ownerPackageId: string, sourceLabel: string): void => {
        if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return;
        if (Array.isArray(value)) {
            for (const item of value) scanReferences(item, ownerPackageId, sourceLabel);
            return;
        }
        const record = value as Record<string, unknown>;
        const referencedPackageId = typeof record.packageId === "string" && record.packageId
            ? record.packageId
            : ownerPackageId;
        if (typeof record.resourceId === "string" && record.resourceId) {
            enqueue(referencedPackageId, record.resourceId, sourceLabel);
        }
        if (typeof record.src === "string" && record.src && !record.src.startsWith("ui://")) {
            enqueue(referencedPackageId, record.src, sourceLabel);
        }
        for (const [field, item] of Object.entries(record)) {
            if (isTypedResourceUriField(field)) {
                visitTypedResourceUriValues(item, (packageId, resourceId) => enqueue(packageId, resourceId, sourceLabel));
            }
            if (field === "text" && record.kind === "richText") {
                visitRichTextImageResourceUris(item, (packageId, resourceId) => enqueue(packageId, resourceId, sourceLabel));
            }
            if (field !== "resourceId" && field !== "src") scanReferences(item, ownerPackageId, sourceLabel);
        }
    };

    for (const selector of selectors) {
        enqueue(sourcePackageId, String(selector.resourceId || ""), "Selected resource");
    }
    while (queue.length > 0) {
        const entry = queue.shift()!;
        const resourceId = String(entry.resource.id || "");
        const sourceLabel = `${entry.packageName}/${String(entry.resource.name || resourceId)}`;
        const branchItemIds = Array.isArray(entry.resource.branchItemIds)
            ? entry.resource.branchItemIds
            : [];
        for (const branchItemId of branchItemIds) {
            if (typeof branchItemId === "string" && branchItemId) {
                enqueue(entry.packageId, branchItemId, sourceLabel);
            }
        }
        if (entry.resource.kind === "font") {
            const metadata = entry.resource.metadata as { textureId?: unknown } | null | undefined;
            if (typeof metadata?.textureId === "string" && metadata.textureId) {
                enqueue(entry.packageId, metadata.textureId, sourceLabel);
            }
            const pageFileNames = parseBitmapFontPageFileNames(entry.resource);
            const portablePageFileNames = pageFileNames.length > 1 || !metadata?.textureId ? pageFileNames : [];
            for (const pageFileName of portablePageFileNames) {
                const pageResource = findTransferResourceByFileName(entry.pkg, entry.resource, pageFileName);
                if (!pageResource) {
                    throw transferError(
                        "fairy_package_dependency_not_found",
                        `${sourceLabel} references missing bitmap-font page ${pageFileName}.`,
                    );
                }
                enqueue(entry.packageId, String(pageResource.id || ""), sourceLabel);
            }
            if (!(typeof metadata?.textureId === "string" && metadata.textureId) && portablePageFileNames.length === 0) {
                for (const glyphResourceId of parseImageBasedFontGlyphResourceIds(entry.resource, sourceLabel)) {
                    enqueue(entry.packageId, glyphResourceId, sourceLabel);
                }
            }
        }
        const requireIds = (entry.resource.metadata as { requireIds?: unknown } | null | undefined)?.requireIds;
        if (Array.isArray(requireIds)) {
            for (const requireId of requireIds) {
                if (typeof requireId === "string" && requireId) enqueue(entry.packageId, requireId, sourceLabel);
            }
        }
        scanReferences(entry.resource, entry.packageId, sourceLabel);
    }

    const orderedEntries = packages.flatMap((pkg) => {
        const packageId = String(pkg.id || "");
        return (Array.isArray(pkg.resources) ? pkg.resources : []).flatMap((resource) => {
            const resourceId = String(resource.id || "");
            return includedKeys.has(keyOf(packageId, resourceId))
                ? [{ packageId, packageName: String(pkg.name || packageId), pkg, resource }]
                : [];
        });
    }).sort((left, right) => (
        Number(right.packageId === sourcePackageId) - Number(left.packageId === sourcePackageId)
    ));
    if (orderedEntries.length === 0) {
        throw transferError("fairy_package_resource_selection_empty", "The selected resources did not resolve to an exportable subset.");
    }

    const syntheticPackageId = preserveSourcePackageId
        ? sourcePackageId
        : createSyntheticPackageId(packages, `${sourcePackageId}:${[...includedKeys].sort().join(":")}`);
    const occupiedIds = new Set<string>();
    const targetIds = new Map<string, string>();
    for (const entry of orderedEntries) {
        const sourceId = String(entry.resource.id || "");
        let targetId = sourceId;
        if (!targetId || occupiedIds.has(targetId)) {
            targetId = createUniqueTransferResourceId(sourceId || String(entry.resource.kind || "resource"), occupiedIds);
        }
        occupiedIds.add(targetId);
        targetIds.set(keyOf(entry.packageId, sourceId), targetId);
    }
    const targetBranchNames = [...new Set(orderedEntries.flatMap((entry) => [
        ...(Array.isArray(entry.pkg.branchNames) ? entry.pkg.branchNames : []),
        String(entry.resource.branch || ""),
    ]).filter(Boolean))];

    const includedPackageIds = new Set(orderedEntries.map((entry) => entry.packageId));
    const rewriteReferences = (value: unknown, ownerPackageId: string, sourceLabel: string): unknown => {
        if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index += 1) {
                value[index] = rewriteReferences(value[index], ownerPackageId, sourceLabel);
            }
            return value;
        }
        const record = value as Record<string, unknown>;
        const originalPackageId = typeof record.packageId === "string" && record.packageId
            ? record.packageId
            : ownerPackageId;
        if (typeof record.resourceId === "string" && record.resourceId) {
            const targetId = targetIds.get(keyOf(originalPackageId, record.resourceId));
            if (!targetId) {
                throw transferError("fairy_package_dependency_not_found", `${sourceLabel} has an unmapped direct resource reference.`);
            }
            record.resourceId = targetId;
            if (typeof record.packageId === "string" && record.packageId) record.packageId = syntheticPackageId;
        }
        if (typeof record.src === "string" && record.src && !record.src.startsWith("ui://")) {
            const targetId = targetIds.get(keyOf(originalPackageId, record.src));
            if (!targetId) {
                throw transferError("fairy_package_dependency_not_found", `${sourceLabel} has an unmapped derived-control reference.`);
            }
            record.src = targetId;
            if (typeof record.packageId === "string" && record.packageId) record.packageId = syntheticPackageId;
        }
        if (Array.isArray(record.branchItemIds)) {
            const sourceBranchItemIds = record.branchItemIds;
            const ownerBranchNames = packageIndex.get(ownerPackageId)?.branchNames || [];
            record.branchItemIds = targetBranchNames.map((branchName) => {
                const branchItemId = sourceBranchItemIds[ownerBranchNames.indexOf(branchName)];
                if (typeof branchItemId !== "string" || !branchItemId) return "";
                const targetId = targetIds.get(keyOf(ownerPackageId, branchItemId));
                if (!targetId) {
                    throw transferError("fairy_package_dependency_not_found", `${sourceLabel} has an unmapped branch resource reference.`);
                }
                return targetId;
            });
        }
        for (const [key, item] of Object.entries(record)) {
            if (key === "resourceId" || key === "src" || key === "branchItemIds") continue;
            if (isTypedResourceUriField(key)) {
                record[key] = rewriteTypedResourceUriValues(item, (packageId, resourceId) => {
                    const targetId = targetIds.get(keyOf(packageId, resourceId));
                    if (!targetId) {
                        throw transferError(
                            "fairy_package_dependency_not_found",
                            `${sourceLabel} contains an unmapped typed ui://${packageId}${resourceId} reference.`,
                        );
                    }
                    return `ui://${syntheticPackageId}${targetId}`;
                });
            } else if (key === "text" && record.kind === "richText") {
                record[key] = rewriteRichTextImageResourceUris(item, (packageId, resourceId) => {
                    const targetId = targetIds.get(keyOf(packageId, resourceId));
                    if (!targetId) {
                        throw transferError(
                            "fairy_package_dependency_not_found",
                            `${sourceLabel} contains an unmapped RichText image ui://${packageId}${resourceId} reference.`,
                        );
                    }
                    return `ui://${syntheticPackageId}${targetId}`;
                });
            } else if (key === "packageId" && typeof item === "string" && includedPackageIds.has(item)) {
                record[key] = syntheticPackageId;
            } else {
                record[key] = rewriteReferences(item, ownerPackageId, sourceLabel);
            }
        }
        return value;
    };

    const occupiedFiles = new Set<string>();
    const clonedEntries = orderedEntries.map((entry) => {
        const sourceId = String(entry.resource.id || "");
        const clone = structuredClone(entry.resource);
        clone.id = targetIds.get(keyOf(entry.packageId, sourceId));
        delete clone.sourcePath;
        ensureUniqueTransferFileIdentity(clone, entry.packageName, occupiedFiles);
        return { entry, clone };
    });
    relocateConflictingDependencyFolders(clonedEntries, sourcePackageId);
    const cloneByKey = new Map(clonedEntries.map(({ entry, clone }) => [
        keyOf(entry.packageId, String(entry.resource.id || "")),
        clone,
    ]));
    const resources = clonedEntries.map(({ entry, clone }) => {
        const sourceId = String(entry.resource.id || "");
        const sourceLabel = `${entry.packageName}/${String(entry.resource.name || sourceId)}`;
        if (clone.kind === "font") {
            const metadata = clone.metadata as Record<string, unknown> | null | undefined;
            if (typeof metadata?.textureId === "string" && metadata.textureId) {
                const targetTextureId = targetIds.get(keyOf(entry.packageId, metadata.textureId));
                if (!targetTextureId) {
                    throw transferError("fairy_package_dependency_not_found", `${sourceLabel} has an unmapped font texture reference.`);
                }
                metadata.textureId = targetTextureId;
            }
            const pageFileNames = parseBitmapFontPageFileNames(entry.resource);
            const portablePageFileNames = pageFileNames.length > 1 || !metadata?.textureId ? pageFileNames : [];
            if (portablePageFileNames.length > 0) {
                clone.sourceBytes = rewriteBitmapFontPageFileNames(clone, sourceLabel, (pageFileName) => {
                    const sourcePage = findTransferResourceByFileName(entry.pkg, entry.resource, pageFileName);
                    const targetPage = sourcePage && cloneByKey.get(keyOf(entry.packageId, String(sourcePage.id || "")));
                    const targetFileName = targetPage && getTransferResourceFileName(targetPage);
                    if (!targetFileName) {
                        throw transferError("fairy_package_dependency_not_found", `${sourceLabel} has an unmapped bitmap-font page ${pageFileName}.`);
                    }
                    return targetFileName;
                });
            } else if (!(typeof metadata?.textureId === "string" && metadata.textureId)) {
                clone.sourceBytes = rewriteImageBasedFontGlyphResourceIds(clone, sourceLabel, (sourceGlyphId) => {
                    const targetGlyphId = targetIds.get(keyOf(entry.packageId, sourceGlyphId));
                    if (!targetGlyphId) {
                        throw transferError(
                            "fairy_package_dependency_not_found",
                            `${sourceLabel} has an unmapped image-based font glyph reference.`,
                        );
                    }
                    return targetGlyphId;
                });
            }
        }
        const metadata = clone.metadata as Record<string, unknown> | null | undefined;
        const sourceRequireIds = Array.isArray(metadata?.requireIds) ? [...metadata.requireIds] : [];
        if (Array.isArray(metadata?.requireIds)) {
            metadata.requireIds = metadata.requireIds.map((requireId) => {
                if (typeof requireId !== "string" || !requireId) return requireId;
                const targetRequireId = targetIds.get(keyOf(entry.packageId, requireId));
                if (!targetRequireId) {
                    throw transferError("fairy_package_dependency_not_found", `${sourceLabel} has an unmapped skeleton dependency.`);
                }
                return targetRequireId;
            });
        }
        if (Array.isArray(metadata?.atlasNames)) {
            metadata.atlasNames = rewriteSkeletonAtlasNames(
                metadata.atlasNames,
                sourceRequireIds,
                entry,
                cloneByKey,
                keyOf,
            );
        }
        rewriteReferences(clone, entry.packageId, sourceLabel);
        return clone;
    });

    const syntheticPackage = structuredClone(sourcePackage);
    syntheticPackage.id = syntheticPackageId;
    syntheticPackage.branchNames = targetBranchNames;
    syntheticPackage.resources = resources;
    syntheticPackage.folders = collectSubsetFolders(clonedEntries);
    return syntheticPackage;
}

function relocateConflictingDependencyFolders(
    entries: Array<{ entry: TransferResourceEntry; clone: Record<string, unknown> }>,
    sourcePackageId: string,
): void {
    const settings = new Map<string, string>();
    const relocate = new Set<string>();
    for (const packageId of [...new Set(entries.map(({ entry }) => entry.packageId))]) {
        const packageEntries = entries.filter(({ entry }) => entry.packageId === packageId);
        const folders = packageEntries.flatMap(({ entry }) => (entry.pkg.folders || []).filter((folder) => (
            String(folder.branch || "") === String(entry.resource.branch || "")
            && String(entry.resource.path || "/").startsWith(String(folder.path || ""))
        )));
        const conflict = folders.some((folder) => {
            const key = `${String(folder.branch || "")}\0${String(folder.path || "")}`;
            const signature = `${Boolean(folder.favorite)}\0${String(folder.atlas || "")}`;
            return settings.has(key) && settings.get(key) !== signature;
        });
        if (conflict && packageId !== sourcePackageId) {
            relocate.add(packageId);
            continue;
        }
        for (const folder of folders) {
            const key = `${String(folder.branch || "")}\0${String(folder.path || "")}`;
            settings.set(key, `${Boolean(folder.favorite)}\0${String(folder.atlas || "")}`);
        }
    }
    for (const { entry, clone } of entries) {
        if (!relocate.has(entry.packageId)) continue;
        const prefix = entry.packageName.replace(/[^A-Za-z0-9_-]+/g, "_") || "dependency";
        clone.path = `/${prefix}/${String(clone.path || "/").replace(/^\/+/, "")}`.replace(/\/+$/g, "/");
    }
}

function collectSubsetFolders(
    entries: Array<{ entry: TransferResourceEntry; clone: Record<string, unknown> }>,
): Array<Record<string, unknown>> {
    const folders = new Map<string, Record<string, unknown>>();
    for (const { entry, clone } of entries) {
        const sourceResourcePath = String(entry.resource.path || "/");
        const resourcePath = String(clone.path || "/");
        const resourceBranch = String(entry.resource.branch || "");
        for (const folder of Array.isArray(entry.pkg.folders) ? entry.pkg.folders : []) {
            const sourceFolderPath = String(folder.path || "");
            const folderBranch = String(folder.branch || "");
            if (!sourceFolderPath || folderBranch !== resourceBranch || !sourceResourcePath.startsWith(sourceFolderPath)) continue;
            const prefix = resourcePath.endsWith(sourceResourcePath)
                ? resourcePath.slice(0, resourcePath.length - sourceResourcePath.length)
                : "";
            const folderPath = `${prefix ? `${prefix}/` : "/"}${sourceFolderPath.replace(/^\/+/, "")}`.replace(/\/+/g, "/");
            const key = `${folderBranch}\0${folderPath}`;
            const existing = folders.get(key);
            if (existing) {
                const sameSettings = Boolean(existing.favorite) === Boolean(folder.favorite)
                    && String(existing.atlas || "") === String(folder.atlas || "");
                if (!sameSettings) {
                    throw transferError(
                        "fairy_package_folder_conflict",
                        `Dependency packages define conflicting settings for resource folder ${folderPath}.`,
                    );
                }
                continue;
            }
            folders.set(key, structuredClone(folder));
            folders.get(key)!.path = folderPath;
            if (prefix) {
                const prefixPath = `${prefix}/`.replace(/\/+/g, "/");
                folders.set(`${folderBranch}\0${prefixPath}`, {
                    path: prefixPath,
                    branch: folderBranch,
                    favorite: false,
                    atlas: "",
                });
            }
        }
    }
    return [...folders.values()].sort((left, right) => (
        String(left.branch || "").localeCompare(String(right.branch || ""))
        || String(left.path || "").localeCompare(String(right.path || ""))
    ));
}

function createSyntheticPackageId(packages: TransferPackage[], seed: string): string {
    const existing = new Set(packages.map((pkg) => String(pkg.id || "")));
    for (let attempt = 0; ; attempt += 1) {
        let hash = 0x811c9dc5;
        for (const char of `${seed}:${attempt}`) {
            hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
        }
        const candidate = hash.toString(36).padStart(8, "0").slice(-8);
        if (!existing.has(candidate)) return candidate;
    }
}

function createUniqueTransferResourceId(base: string, occupied: Set<string>): string {
    let suffix = 1;
    let candidate = `${base}_dependency_copy`;
    while (occupied.has(candidate)) {
        suffix += 1;
        candidate = `${base}_dependency_copy${suffix}`;
    }
    return candidate;
}

function ensureUniqueTransferFileIdentity(
    resource: Record<string, unknown>,
    sourcePackageName: string,
    occupied: Set<string>,
): void {
    const path = String(resource.path || "/");
    const branch = String(resource.branch || "");
    const kind = String(resource.kind || "");
    const originalFileName = kind === "component"
        ? `${String(resource.name || resource.id || "Component")}.xml`
        : String(resource.fileName || resource.file || "");
    if (!originalFileName) return;
    const fileKey = (fileName: string): string => `${branch}\0${path}\0${fileName.toLowerCase()}`;
    if (!occupied.has(fileKey(originalFileName))) {
        occupied.add(fileKey(originalFileName));
        return;
    }

    const extensionIndex = originalFileName.lastIndexOf(".");
    const extension = extensionIndex > 0 ? originalFileName.slice(extensionIndex) : "";
    const baseName = extensionIndex > 0 ? originalFileName.slice(0, extensionIndex) : originalFileName;
    const packageSuffix = sourcePackageName.replace(/[^A-Za-z0-9_-]+/g, "_") || "dependency";
    let suffix = 1;
    let candidateBase = `${baseName}_${packageSuffix}`;
    let candidate = `${candidateBase}${extension}`;
    while (occupied.has(fileKey(candidate))) {
        suffix += 1;
        candidateBase = `${baseName}_${packageSuffix}_${suffix}`;
        candidate = `${candidateBase}${extension}`;
    }
    occupied.add(fileKey(candidate));
    resource.name = candidateBase;
    if (kind !== "component") {
        if (typeof resource.fileName === "string") resource.fileName = candidate;
        else resource.file = candidate;
    }
}

interface ResourceImportContext {
    incomingPackage: TransferPackage;
    incomingPackageId: string;
    incomingResources: Array<Record<string, unknown>>;
    targetPackage: TransferPackage;
    targetPackageId: string;
    targetResources: Array<Record<string, unknown>>;
    targetPath: string;
    targetBranch: string;
    conflicts: FairyPackageResourceImportConflict[];
}

interface ResourceImportPlanEntry {
    source: Record<string, unknown>;
    target: Record<string, unknown>;
    mode: "add" | "replace" | "skip";
    existing?: Record<string, unknown>;
    existingIndex?: number;
}

export function inspectFairyPackageResourceImport(
    projectValue: unknown,
    importedPackageValue: unknown,
    options: Pick<FairyPackageResourceImportOptions, "targetPackageId" | "targetPath" | "targetBranch">,
): FairyPackageResourceImportInspection {
    const context = createResourceImportContext(projectValue, importedPackageValue, options);
    return createResourceImportInspection(context);
}

export function prepareImportFairyPackageResources(
    projectValue: unknown,
    importedPackageValue: unknown,
    options: FairyPackageResourceImportOptions,
): FairyPackageResourceImportPreparation {
    let context: ResourceImportContext;
    try {
        context = createResourceImportContext(projectValue, importedPackageValue, options);
    } catch (error) {
        if (error instanceof FairyPackageTransferError) {
            return { ok: false, code: error.code, message: error.message };
        }
        return {
            ok: false,
            code: "fairy_package_import_invalid",
            message: error instanceof Error ? error.message : String(error),
        };
    }
    const inspection = createResourceImportInspection(context);
    if (!(["rename", "replace", "skip"] as string[]).includes(options.conflictStrategy)) {
        return {
            ok: false,
            code: "fairy_package_import_conflict_strategy_invalid",
            message: `Unsupported FairyGUI paste conflict strategy: ${String(options.conflictStrategy)}.`,
            inspection,
        };
    }

    try {
        const targetIds = new Map<string, string>();
        const occupiedIds = new Set(context.targetResources.map((resource) => String(resource.id || "")).filter(Boolean));
        const occupiedFiles = new Map<string, { resource: Record<string, unknown>; existingIndex: number }>();
        for (let index = 0; index < context.targetResources.length; index += 1) {
            const resource = context.targetResources[index];
            const fileName = getTransferResourceFileName(resource);
            if (!fileName) continue;
            occupiedFiles.set(
                resourceFileKey(String(resource.branch || ""), String(resource.path || "/"), fileName),
                { resource, existingIndex: index },
            );
        }

        const planned: ResourceImportPlanEntry[] = [];
        for (const source of context.incomingResources) {
            const incomingId = String(source.id || "");
            if (!incomingId || targetIds.has(incomingId)) {
                throw transferError(
                    "fairy_package_import_resource_id_invalid",
                    `Imported resource id ${incomingId || "(empty)"} is missing or duplicated.`,
                );
            }
            const target = cloneTransferResource(source);
            target.path = mapImportedResourcePath(context.targetPath, String(source.path || "/"));
            target.branch = context.targetBranch;
            const originalFileName = getTransferResourceFileName(target);
            if (!originalFileName) {
                throw transferError(
                    "fairy_package_import_file_name_missing",
                    `Imported resource ${String(source.name || incomingId)} has no physical file name.`,
                );
            }
            let fileKey = resourceFileKey(context.targetBranch, String(target.path), originalFileName);
            let occupied = occupiedFiles.get(fileKey);
            let mode: ResourceImportPlanEntry["mode"] = "add";
            let existing: Record<string, unknown> | undefined;
            let existingIndex: number | undefined;
            if (occupied && options.conflictStrategy === "rename") {
                renameImportedResourceFile(target, occupiedFiles);
                fileKey = resourceFileKey(
                    context.targetBranch,
                    String(target.path),
                    getTransferResourceFileName(target),
                );
                occupied = undefined;
            } else if (occupied) {
                if (occupied.existingIndex < 0) {
                    throw transferError(
                        "fairy_package_import_duplicate_target",
                        `Multiple imported resources resolve to ${String(target.path)}${originalFileName}.`,
                    );
                }
                const incomingKind = String(source.kind || "");
                const targetKind = String(occupied.resource.kind || "");
                if (incomingKind !== targetKind) {
                    throw transferError(
                        "fairy_package_import_kind_mismatch",
                        `Cannot ${options.conflictStrategy} ${String(target.path)}${originalFileName}: incoming ${incomingKind} is incompatible with target ${targetKind}.`,
                    );
                }
                mode = options.conflictStrategy === "replace" ? "replace" : "skip";
                existing = occupied.resource;
                existingIndex = occupied.existingIndex;
            }

            let targetId: string;
            if (existing) {
                targetId = String(existing.id || "");
            } else {
                targetId = incomingId;
                if (occupiedIds.has(targetId)) {
                    targetId = createUniqueTransferResourceId(targetId, occupiedIds);
                }
                occupiedIds.add(targetId);
                occupiedFiles.set(fileKey, { resource: target, existingIndex: -1 });
            }
            if (!targetId) {
                throw transferError("fairy_package_import_resource_id_invalid", "The target resource id is empty.");
            }
            target.id = targetId;
            targetIds.set(incomingId, targetId);
            planned.push({ source, target, mode, existing, existingIndex });
        }

        const targetBySourceId = new Map(planned.map((entry) => [String(entry.source.id || ""), entry.target]));
        for (const entry of planned) {
            rewriteImportedResourceReferences(
                entry.target,
                entry.source,
                context.incomingPackage,
                context.incomingPackageId,
                context.targetPackageId,
                targetIds,
                targetBySourceId,
            );
        }

        const folderOperations = createImportedFolderOperations(context);
        const operationGroups: Array<{ forward: EditorCommandOperation[]; inverse: EditorCommandOperation[] }> = [];
        for (const operation of folderOperations.forward) {
            operationGroups.push({
                forward: [operation],
                inverse: [createInverseFolderOperation(operation)],
            });
        }
        let addedCount = 0;
        for (const entry of planned) {
            if (entry.mode === "skip") continue;
            if (entry.mode === "replace" && entry.existing && entry.existingIndex !== undefined) {
                const oldSnapshot = cloneTransferResource(entry.existing);
                operationGroups.push({
                    forward: [
                        createRemoveTransferResourceOperation(context.targetPackageId, entry.existing),
                        createAddTransferResourceOperation(context.targetPackageId, entry.target, entry.existingIndex),
                    ],
                    inverse: [
                        createRemoveTransferResourceOperation(context.targetPackageId, entry.target),
                        createAddTransferResourceOperation(context.targetPackageId, oldSnapshot, entry.existingIndex),
                    ],
                });
                continue;
            }
            const atIndex = context.targetResources.length + addedCount;
            addedCount += 1;
            operationGroups.push({
                forward: [createAddTransferResourceOperation(context.targetPackageId, entry.target, atIndex)],
                inverse: [createRemoveTransferResourceOperation(context.targetPackageId, entry.target)],
            });
        }
        if (operationGroups.length === 0) {
            return {
                ok: false,
                code: "fairy_package_import_no_changes",
                message: "The selected conflict strategy produced no package changes.",
                inspection,
            };
        }
        const operations = operationGroups.flatMap((group) => group.forward);
        const inverseOperations = operationGroups.slice().reverse().flatMap((group) => group.inverse);
        const counts: FairyPackageResourceImportCounts = {
            added: planned.filter((entry) => entry.mode === "add").length,
            replaced: planned.filter((entry) => entry.mode === "replace").length,
            skipped: planned.filter((entry) => entry.mode === "skip").length,
        };
        const strategyLabel = options.conflictStrategy[0].toUpperCase() + options.conflictStrategy.slice(1);
        const summary = `Import ${context.incomingResources.length} FairyGUI resources into ${String(context.targetPackage.name || context.targetPackageId)}${context.targetPath} (${strategyLabel})`;
        return {
            ok: true,
            inspection,
            counts,
            transaction: {
                summary,
                operation: operations[0] as EditorHighRiskTransaction["operation"],
                inverseOperation: inverseOperations[0],
                operations,
                inverseOperations,
            },
        };
    } catch (error) {
        if (error instanceof FairyPackageTransferError) {
            return { ok: false, code: error.code, message: error.message, inspection };
        }
        return {
            ok: false,
            code: "fairy_package_import_invalid",
            message: error instanceof Error ? error.message : String(error),
            inspection,
        };
    }
}

function createResourceImportContext(
    projectValue: unknown,
    importedPackageValue: unknown,
    options: Pick<FairyPackageResourceImportOptions, "targetPackageId" | "targetPath" | "targetBranch">,
): ResourceImportContext {
    const project = projectValue as TransferProject;
    const incomingPackage = importedPackageValue as TransferPackage;
    const incomingPackageId = String(incomingPackage?.id || "");
    const incomingResources = Array.isArray(incomingPackage?.resources) ? incomingPackage.resources : [];
    if (!/^[A-Za-z0-9]{8}$/.test(incomingPackageId) || incomingResources.length === 0) {
        throw transferError("fairy_package_import_invalid", "The imported FairyGUI package has no valid package id or resources.");
    }
    assertHydratedResources(incomingPackage);
    assertMainBranchResources(incomingPackage);
    const externalPackageIds = findTypedPackageExternalDependencyIds(incomingPackage, incomingPackageId);
    if (externalPackageIds.length > 0) {
        throw transferError(
            "fairy_package_external_dependencies_unsupported",
            `The imported resources reference external package ids: ${externalPackageIds.join(", ")}.`,
        );
    }
    const targetPackageId = String(options.targetPackageId || "");
    const targetPackage = project?.packages?.find((pkg) => String(pkg.id || "") === targetPackageId);
    if (!targetPackage) {
        throw transferError("fairy_package_target_not_found", `Target package ${targetPackageId || "(empty)"} was not found.`);
    }
    const targetResources = Array.isArray(targetPackage.resources) ? targetPackage.resources : [];
    const targetPath = normalizeTransferResourcePath(options.targetPath);
    const targetBranch = String(options.targetBranch || "");
    if (targetPath !== "/" && !(targetPackage.folders || []).some((folder) => (
        String(folder.branch || "") === targetBranch && String(folder.path || "") === targetPath
    ))) {
        throw transferError("fairy_package_target_folder_not_found", `Target folder ${targetPath} was not found.`);
    }
    const targetByFile = new Map<string, { resource: Record<string, unknown>; index: number }>();
    for (let index = 0; index < targetResources.length; index += 1) {
        const resource = targetResources[index];
        const fileName = getTransferResourceFileName(resource);
        if (!fileName) continue;
        targetByFile.set(
            resourceFileKey(String(resource.branch || ""), String(resource.path || "/"), fileName),
            { resource, index },
        );
    }
    const conflicts: FairyPackageResourceImportConflict[] = [];
    for (const resource of incomingResources) {
        const targetResourcePath = mapImportedResourcePath(targetPath, String(resource.path || "/"));
        const fileName = getTransferResourceFileName(resource);
        if (!fileName) continue;
        const conflict = targetByFile.get(resourceFileKey(targetBranch, targetResourcePath, fileName));
        if (!conflict) continue;
        conflicts.push({
            incomingResourceId: String(resource.id || ""),
            incomingName: String(resource.name || resource.id || ""),
            incomingKind: String(resource.kind || ""),
            targetResourceId: String(conflict.resource.id || ""),
            targetName: String(conflict.resource.name || conflict.resource.id || ""),
            targetKind: String(conflict.resource.kind || ""),
            targetPath: targetResourcePath,
            fileName,
        });
    }
    return {
        incomingPackage,
        incomingPackageId,
        incomingResources,
        targetPackage,
        targetPackageId,
        targetResources,
        targetPath,
        targetBranch,
        conflicts,
    };
}

function createResourceImportInspection(context: ResourceImportContext): FairyPackageResourceImportInspection {
    return {
        targetPackageId: context.targetPackageId,
        targetPath: context.targetPath,
        targetBranch: context.targetBranch,
        resourceCount: context.incomingResources.length,
        folderCount: Array.isArray(context.incomingPackage.folders) ? context.incomingPackage.folders.length : 0,
        conflicts: context.conflicts.map((conflict) => ({ ...conflict })),
    };
}

function createImportedFolderOperations(context: ResourceImportContext): {
    forward: Array<Extract<EditorCommandOperation, { kind: "addResourceFolder" }>>;
} {
    const existing = new Set((context.targetPackage.folders || []).map((folder) => (
        `${String(folder.branch || "")}\0${String(folder.path || "")}`
    )));
    const importedMetadata = new Map<string, Record<string, unknown>>();
    for (const folder of context.incomingPackage.folders || []) {
        const mappedPath = mapImportedResourcePath(context.targetPath, String(folder.path || "/"));
        importedMetadata.set(mappedPath, folder);
    }
    const requiredPaths = new Set<string>();
    const collectAncestors = (resourcePath: string): void => {
        const segments = resourcePath.split("/").filter(Boolean);
        let current = "/";
        for (const segment of segments) {
            current += `${segment}/`;
            if (current !== context.targetPath && current.startsWith(context.targetPath)) requiredPaths.add(current);
        }
    };
    for (const folderPath of importedMetadata.keys()) collectAncestors(folderPath);
    for (const resource of context.incomingResources) {
        collectAncestors(mapImportedResourcePath(context.targetPath, String(resource.path || "/")));
    }
    const forward: Array<Extract<EditorCommandOperation, { kind: "addResourceFolder" }>> = [];
    for (const path of [...requiredPaths].sort((left, right) => (
        pathDepth(left) - pathDepth(right) || left.localeCompare(right)
    ))) {
        const key = `${context.targetBranch}\0${path}`;
        if (existing.has(key)) continue;
        const metadata = importedMetadata.get(path);
        forward.push({
            opId: createTransferOperationId("add-import-folder"),
            kind: "addResourceFolder",
            selector: { packageId: context.targetPackageId },
            path,
            branch: context.targetBranch,
            favorite: metadata?.favorite === true,
            atlas: String(metadata?.atlas || ""),
        });
        existing.add(key);
    }
    return { forward };
}

function createInverseFolderOperation(
    operation: Extract<EditorCommandOperation, { kind: "addResourceFolder" }>,
): Extract<EditorCommandOperation, { kind: "removeResourceFolder" }> {
    return {
        opId: createTransferOperationId("remove-import-folder-undo"),
        kind: "removeResourceFolder",
        selector: {
            packageId: operation.selector.packageId,
            branch: operation.branch || "",
            path: operation.path,
        },
    };
}

function createAddTransferResourceOperation(
    packageId: string,
    resource: Record<string, unknown>,
    atIndex: number,
): EditorCommandOperation {
    if (resource.kind === "component") {
        return {
            opId: createTransferOperationId("add-import-component"),
            kind: "addComponent",
            selector: { packageId },
            component: cloneTransferResource(resource),
            atIndex,
        };
    }
    return {
        opId: createTransferOperationId("add-import-resource"),
        kind: "addResource",
        selector: { packageId },
        resource: cloneTransferResource(resource),
        atIndex,
    };
}

function createRemoveTransferResourceOperation(
    packageId: string,
    resource: Record<string, unknown>,
): EditorCommandOperation {
    const resourceId = String(resource.id || "");
    if (resource.kind === "component") {
        return {
            opId: createTransferOperationId("remove-import-component"),
            kind: "removeComponent",
            selector: { packageId, componentResourceId: resourceId },
        };
    }
    return {
        opId: createTransferOperationId("remove-import-resource"),
        kind: "removeResource",
        selector: { packageId, resourceId },
    };
}

function rewriteImportedResourceReferences(
    resource: Record<string, unknown>,
    sourceResource: Record<string, unknown>,
    incomingPackage: TransferPackage,
    incomingPackageId: string,
    targetPackageId: string,
    targetIds: Map<string, string>,
    targetBySourceId: Map<string, Record<string, unknown>>,
): void {
    const rewrite = (value: unknown): unknown => {
        if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index += 1) value[index] = rewrite(value[index]);
            return value;
        }
        const record = value as Record<string, unknown>;
        if (typeof record.resourceId === "string" && record.resourceId) {
            const ownerPackageId = typeof record.packageId === "string" && record.packageId
                ? record.packageId
                : incomingPackageId;
            if (ownerPackageId !== incomingPackageId) {
                throw transferError("fairy_package_external_dependencies_unsupported", "Imported direct reference targets an external package.");
            }
            const targetId = targetIds.get(record.resourceId);
            if (!targetId) throw transferError("fairy_package_dependency_not_found", "Imported direct reference is unmapped.");
            record.resourceId = targetId;
            record.packageId = targetPackageId;
        }
        if (typeof record.src === "string" && record.src && !record.src.startsWith("ui://")) {
            const targetId = targetIds.get(record.src);
            if (!targetId) throw transferError("fairy_package_dependency_not_found", "Imported derived-control reference is unmapped.");
            record.src = targetId;
            if (typeof record.packageId === "string") record.packageId = targetPackageId;
        }
        if (Array.isArray(record.branchItemIds)) {
            record.branchItemIds = record.branchItemIds.map((sourceId) => {
                if (typeof sourceId !== "string" || !sourceId) return sourceId;
                const targetId = targetIds.get(sourceId);
                if (!targetId) throw transferError("fairy_package_dependency_not_found", "Imported branch reference is unmapped.");
                return targetId;
            });
        }
        for (const [key, item] of Object.entries(record)) {
            if (key === "resourceId" || key === "src" || key === "branchItemIds") continue;
            if (isTypedResourceUriField(key)) {
                record[key] = rewriteTypedResourceUriValues(item, (packageId, resourceId) => {
                    if (packageId !== incomingPackageId) {
                        throw transferError(
                            "fairy_package_external_dependencies_unsupported",
                            `Imported resource contains unsupported external ui://${packageId} reference.`,
                        );
                    }
                    const targetId = targetIds.get(resourceId);
                    if (!targetId) {
                        throw transferError("fairy_package_dependency_not_found", "Imported resource contains an unmapped ui:// reference.");
                    }
                    return `ui://${targetPackageId}${targetId}`;
                });
            } else if (key === "text" && record.kind === "richText") {
                record[key] = rewriteRichTextImageResourceUris(item, (packageId, resourceId) => {
                    if (packageId !== incomingPackageId) {
                        throw transferError(
                            "fairy_package_external_dependencies_unsupported",
                            `Imported RichText image targets unsupported external ui://${packageId} reference.`,
                        );
                    }
                    const targetId = targetIds.get(resourceId);
                    if (!targetId) {
                        throw transferError(
                            "fairy_package_dependency_not_found",
                            "Imported RichText image contains an unmapped ui:// reference.",
                        );
                    }
                    return `ui://${targetPackageId}${targetId}`;
                });
            } else {
                record[key] = key === "packageId" && item === incomingPackageId
                    ? targetPackageId
                    : rewrite(item);
            }
        }
        return value;
    };
    if (resource.kind === "font") {
        const metadata = resource.metadata as Record<string, unknown> | null | undefined;
        if (typeof metadata?.textureId === "string" && metadata.textureId) {
            const targetId = targetIds.get(metadata.textureId);
            if (!targetId) throw transferError("fairy_package_dependency_not_found", "Imported font texture is unmapped.");
            metadata.textureId = targetId;
        }
        const pageFileNames = parseBitmapFontPageFileNames(sourceResource);
        const portablePageFileNames = pageFileNames.length > 1 || !metadata?.textureId ? pageFileNames : [];
        if (portablePageFileNames.length > 0) {
            resource.sourceBytes = rewriteBitmapFontPageFileNames(resource, String(resource.name || resource.id || "font"), (pageFileName) => {
                const sourcePage = findTransferResourceByFileName(incomingPackage, sourceResource, pageFileName);
                const targetPage = sourcePage && targetBySourceId.get(String(sourcePage.id || ""));
                const targetFileName = targetPage && getTransferResourceFileName(targetPage);
                if (!targetFileName) throw transferError("fairy_package_dependency_not_found", "Imported bitmap-font page is unmapped.");
                return targetFileName;
            });
        } else if (!(typeof metadata?.textureId === "string" && metadata.textureId)) {
            resource.sourceBytes = rewriteImageBasedFontGlyphResourceIds(resource, String(resource.name || resource.id || "font"), (sourceGlyphId) => {
                const targetId = targetIds.get(sourceGlyphId);
                if (!targetId) {
                    throw transferError("fairy_package_dependency_not_found", "Imported image-based font glyph is unmapped.");
                }
                return targetId;
            });
        }
    }
    const metadata = resource.metadata as Record<string, unknown> | null | undefined;
    const sourceRequireIds = Array.isArray(metadata?.requireIds) ? [...metadata.requireIds] : [];
    if (Array.isArray(metadata?.requireIds)) {
        metadata.requireIds = metadata.requireIds.map((sourceId) => {
            if (typeof sourceId !== "string" || !sourceId) return sourceId;
            const targetId = targetIds.get(sourceId);
            if (!targetId) throw transferError("fairy_package_dependency_not_found", "Imported skeleton dependency is unmapped.");
            return targetId;
        });
    }
    if (Array.isArray(metadata?.atlasNames)) {
        metadata.atlasNames = rewriteSkeletonAtlasNames(
            metadata.atlasNames,
            sourceRequireIds,
            { packageId: incomingPackageId, packageName: String(incomingPackage.name || incomingPackageId), pkg: incomingPackage, resource: sourceResource },
            new Map([...targetBySourceId].map(([resourceId, target]) => [`${incomingPackageId}\0${resourceId}`, target])),
            (packageId, resourceId) => `${packageId}\0${resourceId}`,
        );
    }
    rewrite(resource);
}

function cloneTransferResource(resource: Record<string, unknown>): Record<string, unknown> {
    const clone = structuredClone(resource);
    delete clone.sourcePath;
    return clone;
}

function renameImportedResourceFile(
    resource: Record<string, unknown>,
    occupiedFiles: Map<string, { resource: Record<string, unknown>; existingIndex: number }>,
): void {
    const originalFileName = getTransferResourceFileName(resource);
    const extensionIndex = originalFileName.lastIndexOf(".");
    const extension = extensionIndex > 0 ? originalFileName.slice(extensionIndex) : "";
    const baseName = extensionIndex > 0 ? originalFileName.slice(0, extensionIndex) : originalFileName;
    let suffix = 1;
    let candidateBase = `${baseName}_copy`;
    let candidate = `${candidateBase}${extension}`;
    while (occupiedFiles.has(resourceFileKey(String(resource.branch || ""), String(resource.path || "/"), candidate))) {
        suffix += 1;
        candidateBase = `${baseName}_copy${suffix}`;
        candidate = `${candidateBase}${extension}`;
    }
    resource.name = candidateBase;
    if (resource.kind !== "component") {
        if (typeof resource.fileName === "string") resource.fileName = candidate;
        else resource.file = candidate;
    }
}

function getTransferResourceFileName(resource: Record<string, unknown>): string {
    if (resource.kind === "component") return `${String(resource.name || "")}.xml`;
    return String(resource.fileName || resource.file || "");
}

function resourceFileKey(branch: string, path: string, fileName: string): string {
    return `${branch}\0${path}\0${fileName.toLowerCase()}`;
}

function normalizeTransferResourcePath(value: unknown): string {
    const raw = String(value || "/").replace(/\\/g, "/");
    if (!raw.startsWith("/") || raw.includes("//") || raw.split("/").some((segment) => segment === "." || segment === "..")) {
        throw transferError("fairy_package_import_path_invalid", `Invalid FairyGUI resource path: ${raw}.`);
    }
    return raw === "/" ? raw : `${raw.replace(/\/+$/, "")}/`;
}

function mapImportedResourcePath(targetPath: string, sourcePathValue: string): string {
    const sourcePath = normalizeTransferResourcePath(sourcePathValue);
    if (sourcePath === "/") return targetPath;
    return normalizeTransferResourcePath(`${targetPath}${sourcePath.slice(1)}`);
}

function pathDepth(path: string): number {
    return path.split("/").filter(Boolean).length;
}

let transferOperationSequence = 0;

function createTransferOperationId(prefix: string): string {
    transferOperationSequence += 1;
    return `fairy-package-${prefix}-${transferOperationSequence}`;
}

const TYPED_RESOURCE_URI_FIELDS = new Set([
    "font",
    "icon",
    "sound",
    "url",
    "vtScrollBarRes",
    "hzScrollBarRes",
    "headerRes",
    "footerRes",
    "dropdown",
    "hitTest",
    "defaultItem",
    "horizontal",
    "vertical",
    "startValue",
    "endValue",
]);

function isTypedResourceUriField(field: string): boolean {
    return TYPED_RESOURCE_URI_FIELDS.has(field);
}

function parseTypedResourceUri(value: string): { packageId: string; resourceId: string } | null {
    if (!value.startsWith("ui://")) return null;
    const match = /^ui:\/\/([A-Za-z0-9]{8})([A-Za-z0-9_-]+)$/.exec(value);
    if (!match) {
        throw transferError("fairy_package_dependency_not_found", `Malformed typed FairyGUI resource URI: ${value}.`);
    }
    return { packageId: match[1], resourceId: match[2] };
}

function visitTypedResourceUriValues(
    value: unknown,
    visit: (packageId: string, resourceId: string) => void,
): void {
    if (typeof value === "string") {
        const parsed = parseTypedResourceUri(value);
        if (parsed) visit(parsed.packageId, parsed.resourceId);
        return;
    }
    if (!Array.isArray(value)) return;
    for (const item of value) visitTypedResourceUriValues(item, visit);
}

function rewriteTypedResourceUriValues(
    value: unknown,
    rewrite: (packageId: string, resourceId: string) => string,
): unknown {
    if (typeof value === "string") {
        const parsed = parseTypedResourceUri(value);
        return parsed ? rewrite(parsed.packageId, parsed.resourceId) : value;
    }
    if (!Array.isArray(value)) return value;
    return value.map((item) => rewriteTypedResourceUriValues(item, rewrite));
}

function visitRichTextImageResourceUris(
    value: unknown,
    visit: (packageId: string, resourceId: string) => void,
): void {
    if (typeof value !== "string") return;
    for (const { uri } of collectRichTextImageResourceUriRanges(value)) {
        if (!uri.startsWith("ui://")) continue;
        const parsed = parseTypedResourceUri(uri);
        if (parsed) visit(parsed.packageId, parsed.resourceId);
    }
}

function rewriteRichTextImageResourceUris(
    value: unknown,
    rewrite: (packageId: string, resourceId: string) => string,
): unknown {
    if (typeof value !== "string") return value;
    const replacements = collectRichTextImageResourceUriRanges(value).flatMap(({ start, end, uri }) => {
        if (!uri.startsWith("ui://")) return [];
        const parsed = parseTypedResourceUri(uri);
        return parsed ? [{ start, end, value: rewrite(parsed.packageId, parsed.resourceId) }] : [];
    });
    let result = value;
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
    }
    return result;
}

interface RichTextImageResourceUriRange {
    start: number;
    end: number;
    uri: string;
}

function collectRichTextImageResourceUriRanges(value: string): RichTextImageResourceUriRange[] {
    return [
        ...collectUbbImageResourceUriRanges(value),
        ...collectHtmlImageResourceUriRanges(value),
    ].sort((left, right) => left.start - right.start);
}

function collectUbbImageResourceUriRanges(value: string): RichTextImageResourceUriRange[] {
    const ranges: RichTextImageResourceUriRange[] = [];
    let cursor = 0;
    while (cursor < value.length) {
        const tagStart = value.indexOf("[", cursor);
        if (tagStart < 0) break;
        if (isEscapedUbbTag(value, tagStart)) {
            cursor = tagStart + 1;
            continue;
        }
        const tagEnd = value.indexOf("]", tagStart + 1);
        if (tagEnd < 0) break;
        const tagName = value.slice(tagStart + 1, tagEnd).toLowerCase();
        if (tagName !== "img") {
            cursor = tagEnd + 1;
            continue;
        }
        const uriStart = tagEnd + 1;
        const closingStart = findNextUnescapedUbbTagStart(value, uriStart);
        if (closingStart < 0) break;
        const closingEnd = value.indexOf("]", closingStart + 1);
        if (closingEnd < 0) break;
        if (value.slice(closingStart + 1, closingEnd).toLowerCase() === "/img") {
            ranges.push({
                start: uriStart,
                end: closingStart,
                uri: value.slice(uriStart, closingStart),
            });
        }
        cursor = closingStart;
    }
    return ranges;
}

function isEscapedUbbTag(value: string, tagStart: number): boolean {
    return tagStart > 0 && value.charCodeAt(tagStart - 1) === 92;
}

function findNextUnescapedUbbTagStart(value: string, start: number): number {
    let cursor = start;
    while (cursor < value.length) {
        const tagStart = value.indexOf("[", cursor);
        if (tagStart < 0) return -1;
        if (!isEscapedUbbTag(value, tagStart)) return tagStart;
        cursor = tagStart + 1;
    }
    return -1;
}

function collectHtmlImageResourceUriRanges(value: string): RichTextImageResourceUriRange[] {
    const ranges: RichTextImageResourceUriRange[] = [];
    let cursor = 0;
    while (cursor < value.length) {
        const tagStart = value.indexOf("<", cursor);
        if (tagStart < 0) break;
        const tagEnd = findHtmlTagEnd(value, tagStart + 1);
        if (tagEnd < 0) break;
        collectHtmlImageTagSourceRange(value, tagStart, tagEnd, ranges);
        cursor = tagEnd + 1;
    }
    return ranges;
}

function findHtmlTagEnd(value: string, start: number): number {
    let quote = "";
    for (let index = start; index < value.length; index += 1) {
        const character = value[index];
        if (quote) {
            if (character === quote) quote = "";
            continue;
        }
        if (character === "\"" || character === "'") quote = character;
        else if (character === ">") return index;
    }
    return -1;
}

function collectHtmlImageTagSourceRange(
    value: string,
    tagStart: number,
    tagEnd: number,
    ranges: RichTextImageResourceUriRange[],
): void {
    let cursor = tagStart + 1;
    while (cursor < tagEnd && /\s/.test(value[cursor])) cursor += 1;
    if (value[cursor] === "/") return;
    const nameStart = cursor;
    while (cursor < tagEnd && /[A-Za-z0-9]/.test(value[cursor])) cursor += 1;
    if (value.slice(nameStart, cursor).toLowerCase() !== "img") return;
    if (cursor < tagEnd && !/[\s/]/.test(value[cursor])) return;

    while (cursor < tagEnd) {
        while (cursor < tagEnd && /[\s/]/.test(value[cursor])) cursor += 1;
        const attributeStart = cursor;
        while (cursor < tagEnd && !/[\s=/>]/.test(value[cursor])) cursor += 1;
        if (cursor === attributeStart) break;
        const attributeName = value.slice(attributeStart, cursor).toLowerCase();
        while (cursor < tagEnd && /\s/.test(value[cursor])) cursor += 1;
        if (value[cursor] !== "=") continue;
        cursor += 1;
        while (cursor < tagEnd && /\s/.test(value[cursor])) cursor += 1;
        const quote = value[cursor] === "\"" || value[cursor] === "'" ? value[cursor] : "";
        if (quote) cursor += 1;
        const valueStart = cursor;
        if (quote) {
            while (cursor < tagEnd && value[cursor] !== quote) cursor += 1;
        } else {
            while (cursor < tagEnd && !/[\s>]/.test(value[cursor])) cursor += 1;
        }
        const valueEnd = cursor;
        if (quote && cursor < tagEnd) cursor += 1;
        if (attributeName === "src") {
            ranges.push({ start: valueStart, end: valueEnd, uri: value.slice(valueStart, valueEnd) });
        }
    }
}

function parseBitmapFontPageFileNames(resource: Record<string, unknown>): string[] {
    if (!(resource.sourceBytes instanceof Uint8Array)) return [];
    let text: string;
    try {
        text = FNT_DECODER.decode(resource.sourceBytes);
    } catch {
        return [];
    }
    const files: string[] = [];
    const append = (line: string): void => {
        const match = /(?:^|\s)file=(?:"([^"]+)"|'([^']+)'|([^\s/>]+))/i.exec(line);
        const fileName = match?.slice(1).find((value) => value !== undefined);
        if (fileName) files.push(fileName);
    };
    for (const line of text.split(/\r?\n/)) if (/^\s*page\s+id=/i.test(line)) append(line);
    for (const match of text.matchAll(/<page\b[^>]*>/gi)) append(match[0]);
    return [...new Set(files)];
}

function rewriteBitmapFontPageFileNames(
    resource: Record<string, unknown>,
    sourceLabel: string,
    rewrite: (fileName: string) => string,
): Uint8Array {
    if (!(resource.sourceBytes instanceof Uint8Array)) {
        throw transferError("fairy_package_bytes_unavailable", `Bitmap font ${sourceLabel} has no hydrated source bytes.`);
    }
    const text = FNT_DECODER.decode(resource.sourceBytes);
    let changed = false;
    const rewritten = text.replace(/^[ \t]*page\s+id=[^\r\n]*|<page\b[^>]*>/gmi, (page) => (
        page.replace(
            /(^|\s)file=(?:"([^"]+)"|'([^']+)'|([^\s/>]+))/i,
            (whole, spacing, doubleQuoted, singleQuoted, bare) => {
                const sourceName = String(doubleQuoted ?? singleQuoted ?? bare ?? "");
                const targetName = rewrite(sourceName);
                if (targetName === sourceName) return whole;
                changed = true;
                if (doubleQuoted !== undefined) return `${spacing}file="${targetName}"`;
                if (singleQuoted !== undefined) return `${spacing}file='${targetName}'`;
                return `${spacing}file=${targetName}`;
            },
        )
    ));
    return changed ? ENCODER.encode(rewritten) : resource.sourceBytes;
}

function findTransferResourceByFileName(
    pkg: TransferPackage,
    owner: Record<string, unknown>,
    relativeFileName: string,
): Record<string, unknown> | null {
    const parts = [
        ...String(owner.path || "/").replace(/\\/g, "/").split("/").filter(Boolean),
        ...relativeFileName.replace(/\\/g, "/").split("/").filter(Boolean),
    ];
    if (parts.some((part) => part === "." || part === "..")) return null;
    const fileName = parts.pop();
    const path = parts.length ? `/${parts.join("/")}/` : "/";
    const matches = (pkg.resources || []).filter((resource) => (
        String(resource.branch || "") === String(owner.branch || "")
        && String(resource.path || "/") === path
        && getTransferResourceFileName(resource).toLowerCase() === String(fileName || "").toLowerCase()
    ));
    return matches.length === 1 ? matches[0] : null;
}

function rewriteSkeletonAtlasNames(
    atlasNames: unknown[],
    requireIds: unknown[],
    entry: TransferResourceEntry,
    cloneByKey: Map<string, Record<string, unknown>>,
    keyOf: (packageId: string, resourceId: string) => string,
): unknown[] {
    return atlasNames.map((value) => {
        if (typeof value !== "string" || !value) return value;
        const targetStems = new Set<string>();
        const targets: Record<string, unknown>[] = [];
        for (const requireId of requireIds) {
            if (typeof requireId !== "string" || !requireId) continue;
            const source = (entry.pkg.resources || []).find((resource) => String(resource.id || "") === requireId);
            const sourceFileName = source && getTransferResourceFileName(source);
            if (!sourceFileName || sourceFileName.replace(/\.[^.]+$/, "") !== value) continue;
            const target = cloneByKey.get(keyOf(entry.packageId, requireId));
            const targetFileName = target && getTransferResourceFileName(target);
            if (target && targetFileName) {
                targets.push(target);
                targetStems.add(targetFileName.replace(/\.[^.]+$/, ""));
            }
        }
        if (targetStems.size > 1) {
            const renamedStems = [...targetStems].filter((stem) => stem !== value);
            if (renamedStems.length === 1) {
                for (const target of targets) {
                    if (getTransferResourceFileName(target).replace(/\.[^.]+$/, "") === value) {
                        renameTransferResourceStem(target, renamedStems[0]);
                    }
                }
                return renamedStems[0];
            }
            throw transferError(
                "fairy_package_skeleton_atlas_names_ambiguous",
                `Skeleton atlas ${value} resolves to inconsistent renamed files.`,
            );
        }
        return [...targetStems][0] || value;
    });
}

function renameTransferResourceStem(resource: Record<string, unknown>, stem: string): void {
    const fileName = getTransferResourceFileName(resource);
    const extensionIndex = fileName.lastIndexOf(".");
    const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : "";
    resource.name = stem;
    if (resource.kind !== "component") {
        const renamed = `${stem}${extension}`;
        if (typeof resource.fileName === "string") resource.fileName = renamed;
        else resource.file = renamed;
    }
}

function parseImageBasedFont(
    resource: Record<string, unknown>,
    sourceLabel: string,
): { text: string; glyphResourceIds: string[] } {
    const sourceBytes = resource.sourceBytes;
    if (!(sourceBytes instanceof Uint8Array)) {
        throw transferError(
            "fairy_package_bytes_unavailable",
            `Image-based font ${sourceLabel} has no hydrated FNT source bytes.`,
        );
    }
    let text: string;
    try {
        text = FNT_DECODER.decode(sourceBytes);
    } catch {
        throw transferError(
            "fairy_package_font_format_unsupported",
            `Image-based font ${sourceLabel} is not an unambiguous UTF-8 text FNT file.`,
        );
    }
    if (text.includes("\0")) {
        throw transferError(
            "fairy_package_font_format_unsupported",
            `Image-based font ${sourceLabel} contains unsupported binary FNT data.`,
        );
    }
    const glyphResourceIds: string[] = [];
    const charLines = text.split(/\r?\n/).filter((line) => /^\s*char\s+id=/i.test(line));
    if (charLines.length === 0 && !/^\s*info\s+creator=UIBuilder(?:\s|$)/im.test(text)) {
        throw transferError(
            "fairy_package_font_format_unsupported",
            `Image-based font ${sourceLabel} does not use the supported UIBuilder FNT grammar.`,
        );
    }
    for (const line of charLines) {
        const matches = [...line.matchAll(/(?:^|\s)img=(?:"([^"]+)"|'([^']+)'|([^\s]+))/g)];
        const glyphResourceId = matches[0]?.slice(1).find((candidate) => candidate !== undefined);
        if (matches.length !== 1 || !glyphResourceId || !/^[A-Za-z0-9_-]+$/.test(glyphResourceId)) {
            throw transferError(
                "fairy_package_font_format_unsupported",
                `Image-based font ${sourceLabel} contains an ambiguous glyph image reference.`,
            );
        }
        glyphResourceIds.push(glyphResourceId);
    }
    return { text, glyphResourceIds };
}

function parseImageBasedFontGlyphResourceIds(
    resource: Record<string, unknown>,
    sourceLabel: string,
): string[] {
    return parseImageBasedFont(resource, sourceLabel).glyphResourceIds;
}

function rewriteImageBasedFontGlyphResourceIds(
    resource: Record<string, unknown>,
    sourceLabel: string,
    rewrite: (resourceId: string) => string,
): Uint8Array {
    const parsed = parseImageBasedFont(resource, sourceLabel);
    let changed = false;
    const rewritten = parsed.text.replace(/[^\r\n]+/g, (line) => {
        if (!/^\s*char\s+id=/i.test(line)) return line;
        return line.replace(
            /(^|\s)img=(?:"([^"]+)"|'([^']+)'|([^\s]+))/g,
            (whole, spacing, doubleQuoted, singleQuoted, bare) => {
                const sourceId = String(doubleQuoted ?? singleQuoted ?? bare ?? "");
                const targetId = rewrite(sourceId);
                if (targetId === sourceId) return whole;
                changed = true;
                if (doubleQuoted !== undefined) return `${spacing}img="${targetId}"`;
                if (singleQuoted !== undefined) return `${spacing}img='${targetId}'`;
                return `${spacing}img=${targetId}`;
            },
        );
    });
    return changed ? ENCODER.encode(rewritten) : resource.sourceBytes as Uint8Array;
}

export function findTypedPackageExternalDependencyIds(packageValue: unknown, ownerPackageId: string): string[] {
    const external = new Set<string>();
    const visit = (value: unknown): void => {
        if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return;
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        const record = value as Record<string, unknown>;
        if (
            (typeof record.resourceId === "string" && record.resourceId)
            || (typeof record.src === "string" && record.src && !record.src.startsWith("ui://"))
        ) {
            const packageId = typeof record.packageId === "string" && record.packageId
                ? record.packageId
                : ownerPackageId;
            if (packageId !== ownerPackageId) external.add(packageId);
        }
        for (const [field, item] of Object.entries(record)) {
            if (isTypedResourceUriField(field)) {
                visitTypedResourceUriValues(item, (packageId) => {
                    if (packageId !== ownerPackageId) external.add(packageId);
                });
            }
            if (field === "text" && record.kind === "richText") {
                visitRichTextImageResourceUris(item, (packageId) => {
                    if (packageId !== ownerPackageId) external.add(packageId);
                });
            }
            if (field !== "resourceId" && field !== "src") visit(item);
        }
    };
    visit(packageValue);
    return [...external].sort();
}

export function rewriteFairyPackageOwnerReferences(
    value: unknown,
    sourcePackageId: string,
    targetPackageId: string,
): unknown {
    const rewrite = (current: unknown): unknown => {
        if (!current || typeof current !== "object" || ArrayBuffer.isView(current)) return current;
        if (Array.isArray(current)) {
            for (let index = 0; index < current.length; index += 1) current[index] = rewrite(current[index]);
            return current;
        }
        const record = current as Record<string, unknown>;
        if (
            (typeof record.resourceId === "string" && record.resourceId)
            || (typeof record.src === "string" && record.src && !record.src.startsWith("ui://"))
        ) {
            if (record.packageId === sourcePackageId) record.packageId = targetPackageId;
        }
        for (const [field, item] of Object.entries(record)) {
            if (field === "packageId" || field === "resourceId" || field === "src") continue;
            if (isTypedResourceUriField(field)) {
                record[field] = rewriteTypedResourceUriValues(item, (packageId, resourceId) => (
                    packageId === sourcePackageId
                        ? `ui://${targetPackageId}${resourceId}`
                        : `ui://${packageId}${resourceId}`
                ));
            } else if (field === "text" && record.kind === "richText") {
                record[field] = rewriteRichTextImageResourceUris(item, (packageId, resourceId) => (
                    packageId === sourcePackageId
                        ? `ui://${targetPackageId}${resourceId}`
                        : `ui://${packageId}${resourceId}`
                ));
            } else {
                record[field] = rewrite(item);
            }
        }
        return current;
    };
    return rewrite(value);
}

function assertMainBranchResources(packageValue: unknown): void {
    const pkg = packageValue as TransferPackage;
    const branchFolder = (pkg.folders || []).find((folder) => String(folder.branch || ""));
    const branchNames = Array.isArray(pkg.branches) ? pkg.branches.filter(Boolean) : [];
    const branchResource = (pkg.resources || []).find((resource) => (
        String(resource.branch || "") || (Array.isArray(resource.branchItemIds) && resource.branchItemIds.length > 0)
    ));
    if (branchResource || branchFolder || branchNames.length > 0) {
        throw transferError(
            "fairy_package_branch_resource_unsupported",
            `${branchResource ? `Resource ${String(branchResource.name || branchResource.id || "unknown")}` : "The package"} uses package branch data that the current .fairypackage archive cannot preserve.`,
        );
    }
}

function getImportedArchiveProjectPath(path: string): string {
    const descriptor = /^package_([^/]+)\.xml$/i.exec(path);
    if (descriptor) {
        assertSafeTransferBranchName(descriptor[1]);
        return `assets_${descriptor[1]}/Imported/package_branch.xml`;
    }
    const branchAsset = /^assets_([^/]+)\/(.+)$/i.exec(path);
    if (branchAsset) {
        assertSafeTransferBranchName(branchAsset[1]);
        return `assets_${branchAsset[1]}/Imported/${branchAsset[2]}`;
    }
    return `assets/Imported/${path}`;
}

function collectMaterializedArchiveFiles(
    projectFiles: BrowserWorkspaceFile[],
    packageName: string,
    pkg: TransferPackage,
): BrowserWorkspaceFile[] {
    const archive = new Map<string, Uint8Array>();
    const append = (path: string, data: Uint8Array): void => {
        if (archive.has(path)) throw transferError("fairy_package_materialize_failed", `Materialized archive path ${path} is duplicated.`);
        archive.set(path, data);
    };
    const mainPrefix = `assets/${packageName}/`;
    for (const file of projectFiles) {
        if (file.path.startsWith(mainPrefix)) append(file.path.slice(mainPrefix.length), file.data);
    }
    const branchNames = new Set<string>(Array.isArray(pkg.branchNames) ? pkg.branchNames : []);
    for (const folder of pkg.folders || []) if (folder.branch) branchNames.add(String(folder.branch));
    for (const resource of pkg.resources || []) if (resource.branch) branchNames.add(String(resource.branch));
    for (const branch of branchNames) {
        assertSafeTransferBranchName(branch);
        const prefix = `assets_${branch}/${packageName}/`;
        for (const file of projectFiles) {
            if (!file.path.startsWith(prefix)) continue;
            const relativePath = file.path.slice(prefix.length);
            append(
                relativePath === "package_branch.xml" ? `package_${branch}.xml` : `assets_${branch}/${relativePath}`,
                file.data,
            );
        }
    }
    return [...archive].map(([path, data]) => ({ path, data })).sort((left, right) => left.path.localeCompare(right.path));
}

function assertSafeTransferBranchName(value: string): void {
    if (!value || value === "." || value === ".." || /[\\/:]/.test(value)) {
        throw transferError("fairy_package_invalid_archive", `Invalid FairyGUI branch name: ${value || "(empty)"}.`);
    }
}

function normalizeArchiveFiles(files: BrowserWorkspaceFile[]): BrowserWorkspaceFile[] {
    if (!Array.isArray(files) || files.length === 0) {
        throw transferError("fairy_package_invalid_archive", "The FairyGUI package archive is empty.");
    }
    const paths = new Set<string>();
    const normalized: BrowserWorkspaceFile[] = [];
    for (const file of files) {
        const rawPath = String(file.path || "").replace(/\\/g, "/");
        const segments = rawPath.split("/");
        if (
            !rawPath
            || rawPath.startsWith("/")
            || /^[A-Za-z]:/.test(rawPath)
            || segments.some((segment) => !segment || segment === "." || segment === "..")
            || !(file.data instanceof Uint8Array)
        ) {
            throw transferError("fairy_package_invalid_archive", `The archive contains an invalid path: ${rawPath || "(empty)"}.`);
        }
        const path = segments.join("/");
        if (paths.has(path)) {
            throw transferError("fairy_package_invalid_archive", `The archive contains duplicate path ${path}.`);
        }
        paths.add(path);
        normalized.push({ path, data: new Uint8Array(file.data) });
    }
    return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

function assertHydratedResources(packageValue: unknown): void {
    const pkg = packageValue as {
        resources?: Array<{ id?: string; name?: string; kind?: string; sourceBytes?: unknown }>;
    };
    if (!Array.isArray(pkg?.resources)) {
        throw transferError("fairy_package_invalid_archive", "The FairyGUI package has no resource list.");
    }
    const missing = pkg.resources.find((resource) => (
        resource.kind !== "component" && !(resource.sourceBytes instanceof Uint8Array)
    ));
    if (missing) {
        throw transferError(
            "fairy_package_bytes_unavailable",
            `Resource ${missing.name || missing.id || "unknown"} has no hydrated source bytes.`,
        );
    }
}

function transferError(code: string, message: string): FairyPackageTransferError {
    return new FairyPackageTransferError(code, message);
}

class MemoryTransferStorage implements BrowserProjectStorageAdapter {
    private readonly files = new Map<string, Uint8Array>();
    private readonly directories = new Set<string>(["."]);

    async readFile(filePath: string): Promise<string> {
        return DECODER.decode(await this.readFileRaw(filePath));
    }

    async readFileRaw(filePath: string): Promise<Uint8Array> {
        const path = normalizePath(filePath);
        const data = this.files.get(path);
        if (!data) throw pathError("ENOENT", `File not found: ${path}`);
        return new Uint8Array(data);
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        await this.writeFileRaw(filePath, ENCODER.encode(content));
    }

    async writeFileRaw(filePath: string, data: Uint8Array): Promise<void> {
        const path = normalizePath(filePath);
        this.ensureDirectory(dirname(path));
        this.files.set(path, new Uint8Array(data));
    }

    async mkdir(dirPath: string): Promise<void> {
        this.ensureDirectory(dirPath);
    }

    async readdir(dirPath: string): Promise<string[]> {
        const path = normalizePath(dirPath);
        if (!this.directories.has(path)) throw pathError("ENOENT", `Directory not found: ${path}`);
        const prefix = path === "." ? "" : `${path}/`;
        const names = new Set<string>();
        for (const directory of this.directories) {
            if (directory === path || !directory.startsWith(prefix)) continue;
            names.add(directory.slice(prefix.length).split("/")[0]);
        }
        for (const file of this.files.keys()) {
            if (!file.startsWith(prefix)) continue;
            names.add(file.slice(prefix.length).split("/")[0]);
        }
        return [...names].filter(Boolean).sort();
    }

    async exists(filePath: string): Promise<boolean> {
        const path = normalizePath(filePath);
        return this.files.has(path) || this.directories.has(path);
    }

    async stat(filePath: string): Promise<{ kind: "file" | "directory" }> {
        const path = normalizePath(filePath);
        if (this.files.has(path)) return { kind: "file" };
        if (this.directories.has(path)) return { kind: "directory" };
        throw pathError("ENOENT", `Path not found: ${path}`);
    }

    async unlink(filePath: string): Promise<void> {
        this.files.delete(normalizePath(filePath));
    }

    async rmdir(dirPath: string): Promise<void> {
        const path = normalizePath(dirPath);
        const prefix = `${path}/`;
        if (
            path === "."
            || [...this.directories].some((directory) => directory.startsWith(prefix))
            || [...this.files.keys()].some((file) => file.startsWith(prefix))
        ) {
            throw pathError("ENOTEMPTY", `Directory is not empty: ${path}`);
        }
        if (!this.directories.delete(path)) throw pathError("ENOENT", `Directory not found: ${path}`);
    }

    join(...paths: string[]): string {
        return normalizePath(paths.join("/"));
    }

    dirname(filePath: string): string {
        return dirname(filePath);
    }

    resolve(...paths: string[]): string {
        return this.join(...paths);
    }

    async clear(): Promise<void> {
        this.files.clear();
        this.directories.clear();
        this.directories.add(".");
    }

    listFiles(): BrowserWorkspaceFile[] {
        return [...this.files]
            .map(([path, data]) => ({ path, data: new Uint8Array(data) }))
            .sort((left, right) => left.path.localeCompare(right.path));
    }

    private ensureDirectory(dirPath: string): void {
        const path = normalizePath(dirPath);
        let current = ".";
        for (const part of path === "." ? [] : path.split("/")) {
            current = current === "." ? part : `${current}/${part}`;
            this.directories.add(current);
        }
    }
}

function normalizePath(value: string): string {
    const parts: string[] = [];
    for (const part of String(value || ".").replace(/\\/g, "/").split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") parts.pop();
        else parts.push(part);
    }
    return parts.join("/") || ".";
}

function dirname(value: string): string {
    const parts = normalizePath(value).split("/");
    parts.pop();
    return parts.join("/") || ".";
}

function pathError(code: string, message: string): Error & { code: string } {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
}
