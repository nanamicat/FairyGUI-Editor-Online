import type { BrowserProjectStorageAdapter } from "./BrowserProjectStorage";
import type { BrowserWorkspaceFile } from "../model/BrowserWorkspace";
import { createDirectoryVersionEntry } from "./DirectoryWritebackPolicy";
import { savePersistedDirectoryBinding, type DirectoryWritebackBinding } from "./BrowserDirectoryBinding";
import type { BrowserProjectReadProgress } from "./BrowserProjectImport";

export const PROJECT_CACHE_NAMES = new Set([".objs", ".git", ".svn", "node_modules"]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Reads go to the authorized directory. Only backend writes enter the persistent
// overlay; no directory crawl or source-file copy is performed when mounting.
export class BrowserDirectoryStorage implements BrowserProjectStorageAdapter {
    private readonly snapshots = new Map<string, File | undefined>();
    private readonly accessed = new Map<string, number>();
    private readonly hiddenDirectories: Set<string>;
    private mutation: Promise<unknown> = Promise.resolve();

    constructor(
        readonly binding: DirectoryWritebackBinding,
        private readonly overlay: BrowserProjectStorageAdapter,
        private readonly workspaceName: string,
        private readonly onRead?: (progress: BrowserProjectReadProgress) => void,
    ) {
        this.hiddenDirectories = new Set(binding.deletedDirectories || []);
    }

    getSummary(): { fileCount: number; totalBytes: number } {
        return { fileCount: this.accessed.size, totalBytes: [...this.accessed.values()].reduce((sum, bytes) => sum + bytes, 0) };
    }

    async readFile(path: string): Promise<string> { return decoder.decode(await this.readFileRaw(path)); }

    async readFileRaw(value: string): Promise<Uint8Array> {
        const path = directoryPath(value);
        this.requireVisible(path);
        if (await this.overlay.exists(path)) {
            const bytes = await this.overlay.readFileRaw(path);
            this.recordRead(path, bytes.length);
            return bytes;
        }
        const file = await this.snapshot(path);
        if (!file) throw pathError("ENOENT", path);
        const bytes = new Uint8Array(await file.arrayBuffer());
        await this.captureBaseline(path, bytes);
        this.recordRead(path, bytes.length);
        return bytes;
    }

    writeFile(path: string, content: string): Promise<void> { return this.writeFileRaw(path, encoder.encode(content)); }

    writeFileRaw(value: string, bytes: Uint8Array): Promise<void> {
        return this.mutate(async () => {
            const path = directoryPath(value);
            await this.captureBeforeWrite(path);
            this.binding.deletedPaths = (this.binding.deletedPaths || []).filter((deleted) => deleted !== path);
            await this.persist(); // The original version must survive refresh before any staged write.
            await this.overlay.writeFileRaw(path, bytes);
            this.accessed.set(path, bytes.length);
        });
    }

    async mkdir(value: string, options?: { recursive?: boolean }): Promise<void> {
        const path = directoryPath(value);
        let changed = false;
        for (const deleted of this.hiddenDirectories) {
            if (path === deleted || path.startsWith(`${deleted}/`)) {
                this.hiddenDirectories.delete(deleted);
                changed = true;
            }
        }
        if (changed) {
            this.binding.deletedDirectories = [...this.hiddenDirectories];
            await this.persist();
        }
        await this.overlay.mkdir(path, options);
    }

    async readdir(value: string): Promise<string[]> {
        const path = directoryPath(value);
        this.requireVisible(path);
        const names = new Set<string>();
        try {
            const directory = await this.sourceDirectory(path);
            const keys = (directory as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> }).keys();
            for await (const name of keys) names.add(name);
        } catch (error) {
            if (!isMissing(error)) throw error;
            if (!await this.overlay.exists(path)) throw error;
        }
        if (await this.overlay.exists(path)) for (const name of await this.overlay.readdir(path)) names.add(name);
        return [...names].filter((name) => !this.isHidden(this.join(path, name))).sort();
    }

    async stat(value: string): Promise<{ kind: "file" | "directory" }> {
        const path = directoryPath(value);
        this.requireVisible(path);
        if (path === ".") return { kind: "directory" };
        if (await this.overlay.exists(path)) return this.overlay.stat(path);
        const parent = await this.sourceDirectory(this.dirname(path));
        try {
            const handle = await parent.getFileHandle(basename(path));
            if (!this.snapshots.has(path)) this.snapshots.set(path, await handle.getFile());
            return { kind: "file" };
        } catch (error) {
            if (!(error instanceof Error) || error.name !== "TypeMismatchError") throw error;
            await parent.getDirectoryHandle(basename(path));
            return { kind: "directory" };
        }
    }

    async exists(value: string): Promise<boolean> {
        try { await this.stat(value); return true; }
        catch (error) {
            if (!isMissing(error)) throw error;
            const path = directoryPath(value);
            if (!this.binding.baseline.some((entry) => entry.path === path) && !this.binding.missingPaths?.includes(path)) {
                (this.binding.missingPaths ||= []).push(path);
            }
            return false;
        }
    }

    unlink(value: string): Promise<void> {
        return this.mutate(async () => {
            const path = directoryPath(value);
            if ((await this.stat(path)).kind !== "file") throw pathError("EISDIR", path);
            await this.captureBeforeWrite(path);
            if (!this.binding.deletedPaths?.includes(path)) (this.binding.deletedPaths ||= []).push(path);
            await this.persist();
            if (await this.overlay.exists(path)) await this.overlay.unlink(path);
            this.accessed.delete(path);
        });
    }

    async rmdir(value: string): Promise<void> {
        const path = directoryPath(value);
        if (path === ".") throw pathError("EBUSY", path);
        if ((await this.readdir(path)).length) throw pathError("ENOTEMPTY", path);
        if (await this.overlay.exists(path)) await this.overlay.rmdir(path);
        this.hiddenDirectories.add(path);
        this.binding.deletedDirectories = [...this.hiddenDirectories];
        await this.persist();
    }

    async stagedFiles(): Promise<BrowserWorkspaceFile[]> {
        const files: BrowserWorkspaceFile[] = [];
        const visit = async (path: string): Promise<void> => {
            for (const name of await this.overlay.readdir(path)) {
                const child = this.join(path, name);
                if (this.isHidden(child)) continue;
                if ((await this.overlay.stat(child)).kind === "directory") await visit(child);
                else files.push({ path: child, data: await this.overlay.readFileRaw(child) });
            }
        };
        await visit(".");
        return files;
    }

    acceptWriteback(files: readonly BrowserWorkspaceFile[]): void {
        for (const file of files) this.snapshots.delete(file.path);
        for (const path of this.binding.deletedPaths || []) {
            this.snapshots.set(path, undefined);
            this.binding.baseline = this.binding.baseline.filter((entry) => entry.path !== path);
            if (!this.binding.missingPaths?.includes(path)) (this.binding.missingPaths ||= []).push(path);
        }
    }

    join(...paths: string[]): string { return directoryPath(paths.filter((part) => part && part !== ".").join("/")); }
    dirname(path: string): string { return directoryPath(directoryPath(path).split("/").slice(0, -1).join("/")); }
    resolve(...paths: string[]): string { return this.join(...paths); }
    getWriteCount(): number { return this.overlay.getWriteCount?.() || 0; }
    dispose(): void { this.overlay.dispose?.(); }

    private mutate(operation: () => Promise<void>): Promise<void> {
        const result = this.mutation.then(operation);
        this.mutation = result.catch(() => undefined);
        return result;
    }

    private async snapshot(path: string): Promise<File | undefined> {
        if (this.snapshots.has(path)) return this.snapshots.get(path);
        try {
            const parent = await this.sourceDirectory(this.dirname(path));
            const file = await (await parent.getFileHandle(basename(path))).getFile();
            this.snapshots.set(path, file);
            return file;
        } catch (error) {
            if (!isMissing(error)) throw error;
            this.snapshots.set(path, undefined);
            return undefined;
        }
    }

    private async captureBeforeWrite(path: string): Promise<void> {
        if (this.binding.baseline.some((entry) => entry.path === path) || this.binding.missingPaths?.includes(path)) return;
        const file = await this.snapshot(path);
        if (file) await this.captureBaseline(path, new Uint8Array(await file.arrayBuffer()));
        else (this.binding.missingPaths ||= []).push(path);
    }

    private async captureBaseline(path: string, bytes: Uint8Array): Promise<void> {
        if (!this.binding.baseline.some((entry) => entry.path === path) && !this.binding.missingPaths?.includes(path)) {
            const version = await createDirectoryVersionEntry(path, bytes);
            if (!this.binding.baseline.some((entry) => entry.path === path)) this.binding.baseline.push(version);
        }
    }

    private recordRead(path: string, bytes: number): void {
        const firstRead = !this.accessed.has(path);
        this.accessed.set(path, bytes);
        if (firstRead && (this.accessed.size === 1 || this.accessed.size % 16 === 0)) {
            this.onRead?.({ ...this.getSummary(), sourceName: this.binding.directoryName });
        }
    }

    private persist(): Promise<void> { return savePersistedDirectoryBinding(this.workspaceName, this.binding); }

    private async sourceDirectory(path: string): Promise<FileSystemDirectoryHandle> {
        let directory = this.binding.directory;
        for (const name of path === "." ? [] : path.split("/")) directory = await directory.getDirectoryHandle(name);
        return directory;
    }

    private isHidden(path: string): boolean {
        return path.split("/").some((part) => PROJECT_CACHE_NAMES.has(part.toLowerCase()))
            || (this.binding.deletedPaths || []).includes(path)
            || [...this.hiddenDirectories].some((directory) => path === directory || path.startsWith(`${directory}/`));
    }

    private requireVisible(path: string): void { if (this.isHidden(path)) throw pathError("ENOENT", path); }
}

export function directoryPath(value: string): string {
    const segments: string[] = [];
    if (value.startsWith("/") || /^[a-z]:/i.test(value)) throw pathError("EINVAL", value);
    for (const part of value.replace(/\\/g, "/").split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") { if (!segments.length) throw pathError("EINVAL", value); segments.pop(); }
        else segments.push(part);
    }
    return segments.join("/") || ".";
}
function basename(path: string): string { const parts = path.split("/"); return parts[parts.length - 1]; }
function pathError(code: string, path: string): Error & { code: string } { return Object.assign(new Error(`${code}: ${path}`), { code }); }
function isMissing(error: unknown): boolean {
    return error instanceof Error && (error.name === "NotFoundError" || (error as Error & { code?: string }).code === "ENOENT");
}
