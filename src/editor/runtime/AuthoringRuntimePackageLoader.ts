import type { BrowserProjectStorage, BrowserProjectStorageAdapter } from "../services/BrowserProjectStorage";

export type AuthoringRuntimePackageLoadStatus = "loaded" | "unavailable" | "failed";
export type AuthoringRuntimePackageSource = "workspace" | "static";

export interface AuthoringRuntimePackageLoadResult {
    ok: boolean;
    packageName: string;
    status: AuthoringRuntimePackageLoadStatus;
    source?: AuthoringRuntimePackageSource;
    message: string;
}

interface AuthoringRuntimePackageManifest {
    schemaVersion: 1;
    source: {
        projectId: string;
    };
    packages: AuthoringRuntimePackageManifestEntry[];
}

interface AuthoringRuntimePackageManifestEntry {
    packageId: string;
    packageName: string;
    publishName: string;
    resourceKey: string;
    files?: string[];
}

interface RuntimePackageCandidate {
    source: AuthoringRuntimePackageSource;
    manifest: AuthoringRuntimePackageManifest;
    entry: AuthoringRuntimePackageManifestEntry;
    workspace?: {
        adapter: BrowserProjectStorageAdapter;
        rootPath: string;
    };
}

interface RuntimePackageLease {
    token: string;
    projectId: string;
    sourceKey: string;
    blobUrls: string[];
}

const MANIFEST_URLS = [
    "resources/editor/authoring-runtime/manifest.json",
    "assets/resources/editor/authoring-runtime/manifest.json",
];

export const AUTHORING_RUNTIME_WORKSPACE_ROOT = ".fairygui-runtime";
export const AUTHORING_RUNTIME_WORKSPACE_MANIFEST_PATH = `${AUTHORING_RUNTIME_WORKSPACE_ROOT}/manifest.json`;

/**
 * Loads prepared FairyGUI packages for the active authoring project. A workspace
 * bundle may come from import or the current OpenFairyGUI browser publisher.
 */
export class AuthoringRuntimePackageLoader {
    private staticManifestPromise: Promise<AuthoringRuntimePackageManifest> | null = null;
    private workspaceManifestPromise: Promise<AuthoringRuntimePackageManifest | null> | null = null;
    private packageLoads = new Map<string, Promise<AuthoringRuntimePackageLoadResult>>();
    private leases = new Map<string, RuntimePackageLease>();
    private lifecycleRevision = 0;

    constructor(private readonly projectStorage: BrowserProjectStorage | null = null) {}

    reset(): void {
        this.lifecycleRevision += 1;
        this.workspaceManifestPromise = null;
        this.packageLoads.clear();
        for (const [packageName, lease] of this.leases) {
            this.releaseLease(packageName, lease);
        }
    }

    async ensureLoaded(projectId: string, packageName: string): Promise<AuthoringRuntimePackageLoadResult> {
        const requestRevision = this.lifecycleRevision;
        this.releasePackagesForOtherProjects(projectId);

        let candidate: RuntimePackageCandidate | null;
        try {
            candidate = await this.resolveCandidate(projectId, packageName);
        } catch (error) {
            return this.failed(packageName, this.formatError(error));
        }

        if (!candidate) {
            return this.unavailable(
                packageName,
                "No prepared runtime package matches the current authoring project. Import a .fairygui-runtime bundle for this project.",
            );
        }

        if (requestRevision !== this.lifecycleRevision) {
            return this.unavailable(packageName, "Runtime package request was superseded.", candidate.source);
        }

        const sourceKey = this.createSourceKey(projectId, candidate);
        const currentLease = this.leases.get(packageName);
        if (currentLease?.sourceKey === sourceKey) {
            return this.loaded(packageName, "Matching runtime package is already available.", candidate.source);
        }
        if (currentLease) {
            this.releaseLease(packageName, currentLease);
        }

        const existing = fgui.UIPackage.getByName(packageName);
        if (existing) {
            return this.failed(
                packageName,
                `Runtime package name ${packageName} conflicts with a package outside the authoring preview lifecycle.`,
                candidate.source,
            );
        }

        let task = this.packageLoads.get(sourceKey);
        if (!task) {
            task = candidate.source === "workspace"
                ? this.loadWorkspacePackage(projectId, candidate, sourceKey, requestRevision)
                : this.loadStaticPackage(projectId, candidate, sourceKey, requestRevision);
            this.packageLoads.set(sourceKey, task);
        }

        const result = await task;
        if (!result.ok) {
            this.packageLoads.delete(sourceKey);
        }
        return result;
    }

    private async resolveCandidate(projectId: string, packageName: string): Promise<RuntimePackageCandidate | null> {
        const workspaceManifest = await this.loadWorkspaceManifest();
        if (workspaceManifest) {
            if (workspaceManifest.manifest.source.projectId !== projectId) return null;
            const entry = workspaceManifest.manifest.packages.find((candidate) => candidate.packageName === packageName);
            if (!entry) return null;
            return {
                source: "workspace",
                manifest: workspaceManifest.manifest,
                entry,
                workspace: workspaceManifest.workspace,
            };
        }

        const manifest = await this.loadStaticManifest();
        if (manifest.source.projectId !== projectId) return null;
        const entry = manifest.packages.find((candidate) => candidate.packageName === packageName);
        if (!entry) return null;
        return { source: "static", manifest, entry };
    }

    private async loadWorkspacePackage(
        projectId: string,
        candidate: RuntimePackageCandidate,
        sourceKey: string,
        requestRevision: number,
    ): Promise<AuthoringRuntimePackageLoadResult> {
        const workspace = candidate.workspace;
        if (!workspace) {
            return this.failed(candidate.entry.packageName, "Workspace runtime storage is unavailable.", candidate.source);
        }

        const descriptorPath = workspace.adapter.join(workspace.rootPath, `${candidate.entry.publishName}.fui`);
        let pkg: fgui.UIPackage | null = null;
        let blobUrls: string[] = [];
        try {
            const descriptor = await workspace.adapter.readFileRaw(descriptorPath);
            this.assertCurrentRequest(requestRevision);

            const resourceKey = `workspace-runtime/${projectId}/${candidate.entry.packageId}`;
            pkg = fgui.UIPackage.addPackage(resourceKey, copyArrayBuffer(descriptor));
            blobUrls = await this.attachWorkspaceAssets(pkg, candidate.entry, workspace, resourceKey);
            this.assertCurrentRequest(requestRevision);

            const result = this.registerLease(projectId, candidate, sourceKey, pkg, blobUrls);
            pkg = null;
            blobUrls = [];
            return result;
        } catch (error) {
            this.discardPackage(pkg, blobUrls);
            return this.failed(candidate.entry.packageName, this.formatError(error), candidate.source);
        }
    }

    private async attachWorkspaceAssets(
        pkg: fgui.UIPackage,
        entry: AuthoringRuntimePackageManifestEntry,
        workspace: NonNullable<RuntimePackageCandidate["workspace"]>,
        resourceKey: string,
    ): Promise<string[]> {
        const urls: Laya.ILoadURL[] = [];
        const blobUrls: string[] = [];

        for (const item of pkg.items) {
            if (!item.file) continue;
            const assetPath = await this.findWorkspaceAssetPath(workspace, entry, resourceKey, item.file);
            if (!assetPath) {
                throw new Error(`Runtime asset is missing for ${entry.packageName}: ${item.file}.`);
            }

            const bytes = await workspace.adapter.readFileRaw(assetPath);
            const blobUrl = URL.createObjectURL(new Blob([copyArrayBuffer(bytes)], { type: mimeTypeForPath(assetPath) }));
            item.file = blobUrl;
            blobUrls.push(blobUrl);

            if (item.type === fgui.PackageItemType.Atlas) {
                urls.push({ url: blobUrl, type: Laya.Loader.IMAGE });
            } else if (item.type === fgui.PackageItemType.Sound) {
                urls.push({ url: blobUrl, type: Laya.Loader.SOUND });
            }
        }

        if (urls.length > 0) {
            await fgui.AssetProxy.inst.load(urls);
        }
        return blobUrls;
    }

    private async findWorkspaceAssetPath(
        workspace: NonNullable<RuntimePackageCandidate["workspace"]>,
        entry: AuthoringRuntimePackageManifestEntry,
        resourceKey: string,
        itemFile: string,
    ): Promise<string | null> {
        const generatedPrefix = `${resourceKey}_`;
        const rawFileName = itemFile.startsWith(generatedPrefix)
            ? itemFile.slice(generatedPrefix.length)
            : basename(itemFile);
        const preferredName = `${entry.publishName}_${rawFileName}`;
        const listedFiles = entry.files || [];
        const candidates = Array.from(new Set([
            ...listedFiles.filter((fileName) => fileName === preferredName || fileName === rawFileName),
            preferredName,
            rawFileName,
        ]));

        for (const fileName of candidates) {
            const assetPath = workspace.adapter.join(workspace.rootPath, fileName);
            if (await workspace.adapter.exists(assetPath)) return assetPath;
        }
        return null;
    }

    private async loadStaticPackage(
        projectId: string,
        candidate: RuntimePackageCandidate,
        sourceKey: string,
        requestRevision: number,
    ): Promise<AuthoringRuntimePackageLoadResult> {
        let pkg: fgui.UIPackage | null = null;
        try {
            const resourceKey = await this.resolveResourceKey(candidate.entry.resourceKey);
            this.assertCurrentRequest(requestRevision);
            await new Promise<void>((resolve, reject) => {
                try {
                    fgui.UIPackage.loadPackage(resourceKey, () => {
                        const loaded = fgui.UIPackage.getByName(candidate.entry.packageName);
                        if (!loaded) {
                            reject(new Error(`FairyGUI did not register package ${candidate.entry.packageName}.`));
                            return;
                        }
                        pkg = loaded;
                        resolve();
                    });
                } catch (error) {
                    reject(error);
                }
            });
            this.assertCurrentRequest(requestRevision);
            if (!pkg) throw new Error(`FairyGUI did not register package ${candidate.entry.packageName}.`);

            const result = this.registerLease(projectId, candidate, sourceKey, pkg, []);
            pkg = null;
            return result;
        } catch (error) {
            this.discardPackage(pkg, []);
            return this.failed(candidate.entry.packageName, this.formatError(error), candidate.source);
        }
    }

    private registerLease(
        projectId: string,
        candidate: RuntimePackageCandidate,
        sourceKey: string,
        pkg: fgui.UIPackage,
        blobUrls: string[],
    ): AuthoringRuntimePackageLoadResult {
        const token = `fairygui-editor-runtime:${sourceKey}`;
        pkg.customId = token;
        this.leases.set(candidate.entry.packageName, {
            token,
            projectId,
            sourceKey,
            blobUrls,
        });
        return this.loaded(
            candidate.entry.packageName,
            candidate.source === "workspace"
                ? `Loaded imported ${candidate.entry.publishName}.fui and its runtime assets.`
                : `Loaded ${candidate.entry.publishName}.fui and its runtime assets.`,
            candidate.source,
        );
    }

    private releasePackagesForOtherProjects(projectId: string): void {
        for (const [packageName, lease] of this.leases) {
            if (lease.projectId !== projectId) {
                this.releaseLease(packageName, lease);
            }
        }
    }

    private releaseLease(packageName: string, lease: RuntimePackageLease): void {
        const pkg = fgui.UIPackage.getById(lease.token);
        if (pkg) {
            try {
                pkg.unloadAssets();
            } catch {
                // The package is being replaced; dispose below still removes its registration.
            }
            fgui.UIPackage.removePackage(lease.token);
        }
        for (const blobUrl of lease.blobUrls) {
            URL.revokeObjectURL(blobUrl);
        }
        this.leases.delete(packageName);
    }

    private discardPackage(pkg: fgui.UIPackage | null, blobUrls: string[]): void {
        if (pkg && fgui.UIPackage.getByName(pkg.name) === pkg) {
            try {
                pkg.unloadAssets();
            } catch {
                // The package did not complete loading, so there may be no loaded atlas to release.
            }
            fgui.UIPackage.removePackage(pkg.name);
        }
        for (const blobUrl of blobUrls) {
            URL.revokeObjectURL(blobUrl);
        }
    }

    private async loadWorkspaceManifest(): Promise<{
        manifest: AuthoringRuntimePackageManifest;
        workspace: NonNullable<RuntimePackageCandidate["workspace"]>;
    } | null> {
        const adapter = this.projectStorage?.getAdapter();
        if (!adapter) return null;

        if (!this.workspaceManifestPromise) {
            this.workspaceManifestPromise = (async () => {
                if (!await adapter.exists(AUTHORING_RUNTIME_WORKSPACE_MANIFEST_PATH)) return null;
                const manifest = JSON.parse(await adapter.readFile(AUTHORING_RUNTIME_WORKSPACE_MANIFEST_PATH)) as AuthoringRuntimePackageManifest;
                this.assertManifest(manifest);
                return manifest;
            })();
        }

        const manifest = await this.workspaceManifestPromise;
        if (!manifest) return null;
        return {
            manifest,
            workspace: {
                adapter,
                rootPath: AUTHORING_RUNTIME_WORKSPACE_ROOT,
            },
        };
    }

    private async loadStaticManifest(): Promise<AuthoringRuntimePackageManifest> {
        if (!this.staticManifestPromise) {
            this.staticManifestPromise = this.fetchStaticManifest();
        }
        return await this.staticManifestPromise;
    }

    private async fetchStaticManifest(): Promise<AuthoringRuntimePackageManifest> {
        const failures: string[] = [];
        for (const url of MANIFEST_URLS) {
            const response = await fetch(url, { cache: "no-cache" });
            if (!response.ok) {
                failures.push(`${url}: ${response.status} ${response.statusText}`);
                continue;
            }
            const manifest = (await response.json()) as AuthoringRuntimePackageManifest;
            this.assertManifest(manifest);
            return manifest;
        }
        throw new Error(`Authoring runtime manifest is unavailable. Tried ${failures.join("; ")}.`);
    }

    private async resolveResourceKey(resourceKey: string): Promise<string> {
        const candidates = [resourceKey, `assets/${resourceKey}`];
        const failures: string[] = [];
        for (const candidate of candidates) {
            const response = await fetch(`${candidate}.fui`, { cache: "no-cache" });
            if (response.ok) return candidate;
            failures.push(`${candidate}.fui: ${response.status} ${response.statusText}`);
        }
        throw new Error(`Runtime package descriptor is unavailable. Tried ${failures.join("; ")}.`);
    }

    private assertManifest(manifest: AuthoringRuntimePackageManifest): void {
        if (manifest?.schemaVersion !== 1 || !manifest.source?.projectId || !Array.isArray(manifest.packages)) {
            throw new Error("Unsupported authoring runtime manifest.");
        }
        for (const entry of manifest.packages) {
            if (!entry.packageId || !entry.packageName || !entry.publishName || !entry.resourceKey) {
                throw new Error("Authoring runtime manifest contains an invalid package entry.");
            }
            if (entry.files && (!Array.isArray(entry.files) || entry.files.some((fileName) => !isSafeFileName(fileName)))) {
                throw new Error("Authoring runtime manifest contains an unsafe package file name.");
            }
        }
    }

    private createSourceKey(projectId: string, candidate: RuntimePackageCandidate): string {
        return `${candidate.source}:${projectId}:${candidate.entry.packageId}`;
    }

    private assertCurrentRequest(requestRevision: number): void {
        if (requestRevision !== this.lifecycleRevision) {
            throw new Error("Runtime package request was superseded.");
        }
    }

    private loaded(
        packageName: string,
        message: string,
        source: AuthoringRuntimePackageSource,
    ): AuthoringRuntimePackageLoadResult {
        return { ok: true, packageName, status: "loaded", source, message };
    }

    private unavailable(
        packageName: string,
        message: string,
        source?: AuthoringRuntimePackageSource,
    ): AuthoringRuntimePackageLoadResult {
        return { ok: false, packageName, status: "unavailable", source, message };
    }

    private failed(
        packageName: string,
        message: string,
        source?: AuthoringRuntimePackageSource,
    ): AuthoringRuntimePackageLoadResult {
        return { ok: false, packageName, status: "failed", source, message };
    }

    private formatError(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

function basename(value: string): string {
    const parts = value.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || "";
}

function isSafeFileName(value: string): boolean {
    return Boolean(value) && basename(value) === value && !value.includes("..") && !value.includes("/") && !value.includes("\\");
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

function mimeTypeForPath(filePath: string): string {
    const extension = basename(filePath).split(".").pop()?.toLowerCase();
    if (extension === "png") return "image/png";
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "webp") return "image/webp";
    if (extension === "wav") return "audio/wav";
    if (extension === "mp3") return "audio/mpeg";
    if (extension === "ogg") return "audio/ogg";
    return "application/octet-stream";
}
