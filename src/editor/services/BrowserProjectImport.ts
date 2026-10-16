import { pickLocalDirectory } from "./BrowserFileSystemAccess";
import { PROJECT_CACHE_NAMES } from "./BrowserDirectoryStorage";
import type { BrowserWorkspaceFile, BrowserWorkspaceImport } from "../model/BrowserWorkspace";

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

export class BrowserProjectImport {
    async pickDirectoryProject(onProgress?: ProjectReadProgressHandler): Promise<BrowserProjectImportResult> {
        return this.readDirectoryProject(await pickLocalDirectory(), onProgress);
    }

    async readDirectoryProject(
        directory: FileSystemDirectoryHandle,
        onProgress?: ProjectReadProgressHandler,
    ): Promise<BrowserProjectImportResult> {
        onProgress?.({ fileCount: 0, totalBytes: 0, sourceName: directory.name });
        // Search names breadth-first and stop at the project level. No file contents
        // are read, including the .fairy descriptor, until the backend requests them.
        let level = [{ directory, path: "." }];
        while (level.length) {
            const candidates: Array<{ fairyPath: string; projectRoot: string }> = [];
            const children: typeof level = [];
            for (const current of level) {
                const keys = (current.directory as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> }).keys();
                const names: string[] = [];
                for await (const name of keys) if (!PROJECT_CACHE_NAMES.has(name.toLowerCase())) names.push(name);
                for (const name of names.sort()) {
                    try {
                        if (name.toLowerCase().endsWith(".fairy")) {
                            await current.directory.getFileHandle(name);
                            candidates.push({ fairyPath: name, projectRoot: current.path });
                            continue;
                        }
                        const child = await current.directory.getDirectoryHandle(name);
                        children.push({ directory: child, path: current.path === "." ? name : `${current.path}/${name}` });
                    } catch (error) {
                        if (!(error instanceof Error) || error.name !== "TypeMismatchError") throw error;
                    }
                }
            }
            if (candidates.length > 1) throw new Error("所选目录中有多个 .fairy 工程，请选择具体的工程文件夹。");
            if (candidates.length === 1) return {
                directoryHandle: directory,
                files: [],
                imported: {
                    source: "directory", sourceName: directory.name || "selected-folder",
                    ...candidates[0], fileCount: 0, totalBytes: 0, onDemand: true,
                },
            };
            level = children;
        }
        throw new Error("所选目录中未找到 .fairy 工程文件。");
    }
}
