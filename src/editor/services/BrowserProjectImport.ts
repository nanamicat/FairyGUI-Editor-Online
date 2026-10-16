import { pickLocalDirectory } from "./BrowserFileSystemAccess";
import type {
    BrowserWorkspaceFile,
    BrowserWorkspaceImport,
} from "../model/BrowserWorkspace";

interface FileSystemDirectoryHandleWithKeys extends FileSystemDirectoryHandle {
    keys(): { next(): Promise<{ done?: boolean; value: string }> };
}

interface ProjectImportCandidate {
    source: BrowserWorkspaceImport["source"];
    sourceName: string;
    files: BrowserWorkspaceFile[];
    directoryHandle: FileSystemDirectoryHandle;
}

export interface BrowserProjectImportResult {
    imported: BrowserWorkspaceImport;
    files: BrowserWorkspaceFile[];
    directoryHandle: FileSystemDirectoryHandle;
}

export interface BrowserProjectReadProgress {
    fileCount: number;
    totalBytes: number;
    sourceName: string;
}

type ProjectReadProgressHandler = (progress: BrowserProjectReadProgress) => void;
const PROJECT_CACHE_NAMES = new Set([".objs", ".git", ".svn", "node_modules"]);

export class BrowserProjectImport {
    async pickDirectoryProject(onProgress?: ProjectReadProgressHandler): Promise<BrowserProjectImportResult> {
        return this.readDirectoryProject(await pickLocalDirectory(), onProgress);
    }

    async readDirectoryProject(
        directory: FileSystemDirectoryHandle,
        onProgress?: ProjectReadProgressHandler,
    ): Promise<BrowserProjectImportResult> {
        const progress: BrowserProjectReadProgress = { fileCount: 0, totalBytes: 0, sourceName: directory.name };
        onProgress?.({ ...progress });
        return this.createImportResult({
            source: "directory",
            sourceName: directory.name || "selected-folder",
            files: await this.readDirectoryFiles(directory, ".", progress, onProgress),
            directoryHandle: directory,
        });
    }

    private async readDirectoryFiles(
        directory: FileSystemDirectoryHandle,
        dirPath: string,
        progress: BrowserProjectReadProgress,
        onProgress?: ProjectReadProgressHandler,
    ): Promise<BrowserWorkspaceFile[]> {
        const files: BrowserWorkspaceFile[] = [];
        const names = await readDirectoryHandleNames(directory);
        for (const name of names) {
            if (PROJECT_CACHE_NAMES.has(name.toLowerCase())) continue;
            const childPath = joinImportPath(dirPath, name);
            try {
                const fileHandle = await directory.getFileHandle(name);
                const file = await fileHandle.getFile();
                files.push({
                    path: childPath,
                    data: new Uint8Array(await file.arrayBuffer()),
                });
                progress.fileCount += 1;
                progress.totalBytes += file.size;
                if (progress.fileCount === 1 || progress.fileCount % 16 === 0) onProgress?.({ ...progress });
                continue;
            } catch (error) {
                if (!(error instanceof Error) || error.name !== "TypeMismatchError") throw error;
                // Continue as directory. File System Access has no stable stat call.
            }

            const childDirectory = await directory.getDirectoryHandle(name);
            files.push(...await this.readDirectoryFiles(childDirectory, childPath, progress, onProgress));
        }
        onProgress?.({ ...progress });
        return files;
    }

    private createImportResult(candidate: ProjectImportCandidate): BrowserProjectImportResult {
        const normalizedFiles = candidate.files
            .map((file) => ({ path: normalizeImportPath(file.path), data: file.data }))
            .filter((file) => file.path !== "." && !file.path.startsWith("__MACOSX/"));
        const fairyPath = findFairyProjectPath(normalizedFiles);
        const projectRoot = dirnameImportPath(fairyPath);
        const importedFiles = normalizedFiles
            .filter((file) => projectRoot === "." || file.path === projectRoot || file.path.startsWith(`${projectRoot}/`))
            .map((file) => ({
                path: projectRoot === "." ? file.path : file.path.slice(projectRoot.length + 1),
                data: file.data,
            }))
            .filter((file) => file.path && file.path !== ".");
        const importedFairyPath = projectRoot === "." ? fairyPath : fairyPath.slice(projectRoot.length + 1);
        const totalBytes = importedFiles.reduce((total, file) => total + file.data.byteLength, 0);

        return {
            files: importedFiles,
            imported: {
                source: candidate.source,
                sourceName: candidate.sourceName,
                projectRoot,
                fairyPath: importedFairyPath,
                fileCount: importedFiles.length,
                totalBytes,
            },
            directoryHandle: candidate.directoryHandle,
        };
    }
}

async function readDirectoryHandleNames(directory: FileSystemDirectoryHandle): Promise<string[]> {
    const names: string[] = [];
    const keys = (directory as FileSystemDirectoryHandleWithKeys).keys();
    while (true) {
        const next = await keys.next();
        if (next.done) break;
        names.push(next.value);
    }
    return names.sort();
}

function findFairyProjectPath(files: BrowserWorkspaceFile[]): string {
    const fairyPaths = files
        .map((file) => file.path)
        .filter((path) => path.toLowerCase().endsWith(".fairy"))
        .sort((a, b) => slashCount(a) - slashCount(b) || a.localeCompare(b));
    if (fairyPaths.length === 0) {
        throw new Error("Imported files do not contain a .fairy project file.");
    }
    const shallowest = fairyPaths.filter((path) => slashCount(path) === slashCount(fairyPaths[0]));
    if (shallowest.length > 1) {
        throw new Error("所选目录中有多个 .fairy 工程，请选择具体的工程文件夹。");
    }
    return fairyPaths[0];
}

function normalizeImportPath(value: string): string {
    const normalized = String(value || ".").replace(/\\/g, "/").replace(/\/+/g, "/");
    const segments: string[] = [];
    for (const segment of normalized.split("/")) {
        if (!segment || segment === ".") continue;
        if (segment === "..") continue;
        segments.push(segment);
    }
    return segments.join("/") || ".";
}

function joinImportPath(...paths: string[]): string {
    return normalizeImportPath(paths.filter((part) => part && part !== ".").join("/"));
}

function dirnameImportPath(filePath: string): string {
    const path = normalizeImportPath(filePath);
    if (path === ".") return ".";
    const parts = path.split("/");
    parts.pop();
    return parts.join("/") || ".";
}

function slashCount(value: string): number {
    return value.split("/").length - 1;
}
