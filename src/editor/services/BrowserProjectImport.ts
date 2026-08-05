import { Inflate } from "fflate";
import type {
    BrowserWorkspaceFile,
    BrowserWorkspaceImport,
} from "../model/BrowserWorkspace";

interface DirectoryPickerWindow {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
}

interface FileSystemDirectoryHandleWithKeys extends FileSystemDirectoryHandle {
    keys(): { next(): Promise<{ done?: boolean; value: string }> };
}

type DirectoryInputElement = HTMLInputElement & {
    webkitdirectory: boolean;
    directory?: boolean;
};

type BrowserDirectoryFile = File & { webkitRelativePath: string };

interface ProjectImportCandidate {
    source: BrowserWorkspaceImport["source"];
    sourceName: string;
    files: BrowserWorkspaceFile[];
    directoryHandle?: FileSystemDirectoryHandle;
}

export interface BrowserProjectImportResult {
    imported: BrowserWorkspaceImport;
    files: BrowserWorkspaceFile[];
    directoryHandle?: FileSystemDirectoryHandle;
}

export class BrowserProjectImport {
    async pickDirectoryProject(): Promise<BrowserProjectImportResult> {
        const picker = (window as unknown as DirectoryPickerWindow).showDirectoryPicker;
        if (typeof picker === "function") {
            try {
                const directory = await picker({ mode: "readwrite" });
                const files = await this.readDirectoryFiles(directory, ".");
                return this.createImportResult({
                    source: "directory",
                    sourceName: directory.name || "selected-folder",
                    files,
                    directoryHandle: directory,
                });
            } catch (error) {
                if (isDirectoryPickerCancelled(error)) throw error;
                // The File System Access API can exist yet be unavailable in an
                // embedded/browser-automation context. Keep Folder import usable
                // through the standard directory-input fallback in that case.
            }
        }

        const fallback = await pickDirectoryFilesFallback();
        return this.createImportResult({
            source: "directory",
            sourceName: fallback.sourceName,
            files: fallback.files,
        });
    }

    async pickZipProject(): Promise<BrowserProjectImportResult> {
        const file = await pickZipFile();
        const files = await readZipProjectFiles(file);
        return this.createImportResult({
            source: "zip",
            sourceName: file.name || "selected-project.zip",
            files,
        });
    }

    private async readDirectoryFiles(
        directory: FileSystemDirectoryHandle,
        dirPath: string,
    ): Promise<BrowserWorkspaceFile[]> {
        const files: BrowserWorkspaceFile[] = [];
        const names = await readDirectoryHandleNames(directory);
        for (const name of names) {
            const childPath = joinImportPath(dirPath, name);
            try {
                const fileHandle = await directory.getFileHandle(name);
                const file = await fileHandle.getFile();
                files.push({
                    path: childPath,
                    data: new Uint8Array(await file.arrayBuffer()),
                });
                continue;
            } catch {
                // Continue as directory. File System Access has no stable stat call.
            }

            const childDirectory = await directory.getDirectoryHandle(name);
            files.push(...await this.readDirectoryFiles(childDirectory, childPath));
        }
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

async function pickDirectoryFilesFallback(): Promise<{
    sourceName: string;
    files: BrowserWorkspaceFile[];
}> {
    return await new Promise((resolve, reject) => {
        const input = document.createElement("input") as DirectoryInputElement;
        input.type = "file";
        input.multiple = true;
        input.webkitdirectory = true;
        input.directory = true;
        input.style.display = "none";

        const cleanup = (): void => {
            input.remove();
            window.removeEventListener("focus", onFocus);
        };
        const onFocus = (): void => {
            window.setTimeout(() => {
                if (!input.files || input.files.length === 0) {
                    cleanup();
                    reject(new Error("Folder import was cancelled."));
                }
            }, 300);
        };

        input.onchange = async () => {
            try {
                const selected = Array.from(input.files || []) as BrowserDirectoryFile[];
                cleanup();
                if (selected.length === 0) {
                    reject(new Error("Folder import was cancelled."));
                    return;
                }

                const files: BrowserWorkspaceFile[] = [];
                for (const file of selected) {
                    files.push({
                        path: file.webkitRelativePath || file.name,
                        data: new Uint8Array(await file.arrayBuffer()),
                    });
                }
                const firstPath = normalizeImportPath(selected[0].webkitRelativePath || selected[0].name);
                resolve({
                    sourceName: firstPath.split("/")[0] || "selected-folder",
                    files,
                });
            } catch (error) {
                cleanup();
                reject(error);
            }
        };

        document.body.appendChild(input);
        window.addEventListener("focus", onFocus);
        input.click();
    });
}

export async function pickBrowserFile(
    accept: string,
    cancelledMessage: string,
    debugName = "",
): Promise<File> {
    return (await pickBrowserFiles(accept, cancelledMessage, debugName, false))[0];
}

export async function pickBrowserFiles(
    accept: string,
    cancelledMessage: string,
    debugName = "",
    multiple = true,
): Promise<File[]> {
    return await new Promise<File[]>((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.multiple = multiple;
        if (debugName) input.dataset.fairyEditorFilePicker = debugName;
        input.style.display = "none";

        const cleanup = (): void => {
            input.remove();
            window.removeEventListener("focus", onFocus);
        };
        const onFocus = (): void => {
            window.setTimeout(() => {
                if (!input.files || input.files.length === 0) {
                    cleanup();
                    reject(new Error(cancelledMessage));
                }
            }, 300);
        };

        input.onchange = () => {
            const files = input.files ? Array.from(input.files) : [];
            cleanup();
            if (files.length === 0) {
                reject(new Error(cancelledMessage));
                return;
            }
            resolve(files);
        };

        document.body.appendChild(input);
        window.addEventListener("focus", onFocus);
        input.click();
    });
}

async function pickZipFile(): Promise<File> {
    return pickBrowserFile(
        ".zip,application/zip,application/x-zip-compressed",
        "ZIP import was cancelled.",
        "zip-project",
    );
}

export async function readZipProjectFiles(file: File): Promise<BrowserWorkspaceFile[]> {
    if (file.size > ZIP_MAX_ARCHIVE_BYTES) {
        throw new Error(`ZIP archive exceeds the ${ZIP_MAX_ARCHIVE_BYTES / 1024 / 1024} MB limit.`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = readZipEntries(bytes);
    const files: BrowserWorkspaceFile[] = [];
    for (const entry of entries) {
        if (entry.directory || entry.path.startsWith("__MACOSX/")) continue;
        files.push({ path: entry.path, data: extractZipEntry(bytes, entry) });
    }

    if (files.length === 0) {
        throw new Error("ZIP archive does not contain project files.");
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
}

const ZIP_MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const ZIP_MAX_ENTRY_COUNT = 10_000;
const ZIP_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const ZIP_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const ZIP_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    return crc >>> 0;
});

interface ZipEntry {
    path: string;
    directory: boolean;
    flags: number;
    compression: number;
    crc: number;
    compressedSize: number;
    size: number;
    localHeaderOffset: number;
}

function readZipEntries(bytes: Uint8Array): ZipEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findZipEndOfCentralDirectory(view);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralSize = view.getUint32(eocdOffset + 12, true);
    const centralOffset = view.getUint32(eocdOffset + 16, true);
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
        throw new Error("ZIP64 archives are not supported.");
    }
    if (entryCount > ZIP_MAX_ENTRY_COUNT) throw new Error(`ZIP archive exceeds the ${ZIP_MAX_ENTRY_COUNT} entry limit.`);
    if (centralOffset + centralSize > eocdOffset) throw new Error("ZIP central directory is out of bounds.");

    const entries: ZipEntry[] = [];
    const paths = new Set<string>();
    let offset = centralOffset;
    let totalSize = 0;
    for (let index = 0; index < entryCount; index += 1) {
        if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
            throw new Error("ZIP central directory entry is invalid.");
        }
        const flags = view.getUint16(offset + 8, true);
        const compression = view.getUint16(offset + 10, true);
        const crc = view.getUint32(offset + 16, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const size = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);
        const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
        if (entryEnd > bytes.byteLength) throw new Error("ZIP central directory entry is truncated.");
        if ((flags & 1) !== 0) throw new Error("Encrypted ZIP entries are not supported.");
        if (compression !== 0 && compression !== 8) throw new Error(`ZIP compression method ${compression} is not supported.`);
        if (size > ZIP_MAX_ENTRY_BYTES) throw new Error(`ZIP entry exceeds the ${ZIP_MAX_ENTRY_BYTES / 1024 / 1024} MB limit.`);
        totalSize += size;
        if (totalSize > ZIP_MAX_TOTAL_BYTES) throw new Error(`ZIP contents exceed the ${ZIP_MAX_TOTAL_BYTES / 1024 / 1024} MB limit.`);

        const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
        const extraBytes = bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
        const rawName = decodeZipEntryName(nameBytes, extraBytes, (flags & 0x0800) !== 0);
        const normalized = normalizeZipEntryPath(rawName);
        const duplicateKey = normalized.path.replace(/\/$/, "");
        if (paths.has(duplicateKey)) throw new Error(`ZIP archive contains a duplicate path: ${duplicateKey}`);
        paths.add(duplicateKey);
        entries.push({
            path: normalized.path,
            directory: normalized.directory,
            flags,
            compression,
            crc,
            compressedSize,
            size,
            localHeaderOffset,
        });
        offset = entryEnd;
    }
    if (offset !== centralOffset + centralSize) throw new Error("ZIP central directory size does not match its entries.");
    return entries;
}

function findZipEndOfCentralDirectory(view: DataView): number {
    const minimum = Math.max(0, view.byteLength - 22 - 0xffff);
    for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
        if (view.getUint32(offset, true) !== 0x06054b50) continue;
        const commentLength = view.getUint16(offset + 20, true);
        if (offset + 22 + commentLength !== view.byteLength) continue;
        if (view.getUint16(offset + 4, true) !== 0 || view.getUint16(offset + 6, true) !== 0) {
            throw new Error("Multi-disk ZIP archives are not supported.");
        }
        if (view.getUint16(offset + 8, true) !== view.getUint16(offset + 10, true)) {
            throw new Error("ZIP central directory entry count is inconsistent.");
        }
        return offset;
    }
    throw new Error("ZIP end-of-central-directory record was not found.");
}

function decodeZipEntryName(nameBytes: Uint8Array, extraBytes: Uint8Array, utf8: boolean): string {
    for (let offset = 0; offset + 4 <= extraBytes.byteLength;) {
        const view = new DataView(extraBytes.buffer, extraBytes.byteOffset + offset, extraBytes.byteLength - offset);
        const id = view.getUint16(0, true);
        const size = view.getUint16(2, true);
        if (offset + 4 + size > extraBytes.byteLength) throw new Error("ZIP extra field is truncated.");
        if (id === 0x7075 && size >= 5 && extraBytes[offset + 4] === 1) {
            const expectedCrc = view.getUint32(5, true);
            if (expectedCrc === crc32(nameBytes)) {
                return new TextDecoder("utf-8", { fatal: true }).decode(extraBytes.subarray(offset + 9, offset + 4 + size));
            }
        }
        offset += 4 + size;
    }
    return new TextDecoder(utf8 ? "utf-8" : "gbk", { fatal: true }).decode(nameBytes);
}

function normalizeZipEntryPath(value: string): { path: string; directory: boolean } {
    if (!value || value.includes("\0") || /^[\\/]/.test(value) || /^[A-Za-z]:/.test(value)) {
        throw new Error(`ZIP archive contains an invalid absolute path: ${value || "(empty)"}`);
    }
    const normalized = value.replace(/\\/g, "/");
    const directory = normalized.endsWith("/");
    const segments = normalized.split("/");
    if (directory) segments.pop();
    if (segments.length === 0 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error(`ZIP archive contains an unsafe path: ${value}`);
    }
    return { path: `${segments.join("/")}${directory ? "/" : ""}`, directory };
}

function extractZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offset = entry.localHeaderOffset;
    if (offset + 30 > bytes.byteLength || view.getUint32(offset, true) !== 0x04034b50) {
        throw new Error(`ZIP local header is invalid for ${entry.path}.`);
    }
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataOffset = offset + 30 + nameLength + extraLength;
    if (dataOffset + entry.compressedSize > bytes.byteLength) throw new Error(`ZIP entry data is truncated for ${entry.path}.`);
    const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
    const data = entry.compression === 0
        ? new Uint8Array(compressed)
        : inflateZipEntry(compressed, entry);
    if (data.byteLength !== entry.size || crc32(data) !== entry.crc) {
        throw new Error(`ZIP entry integrity check failed for ${entry.path}.`);
    }
    return data;
}

function inflateZipEntry(compressed: Uint8Array, entry: ZipEntry): Uint8Array {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const inflater = new Inflate((chunk) => {
        size += chunk.byteLength;
        if (size > entry.size) {
            throw new Error(`ZIP entry inflated size exceeds its declared size for ${entry.path}.`);
        }
        chunks.push(chunk);
    });
    const chunkSize = entry.size <= 1024 * 1024 ? 1024 : 64 * 1024;
    if (compressed.byteLength === 0) {
        inflater.push(compressed, true);
    } else {
        for (let offset = 0; offset < compressed.byteLength; offset += chunkSize) {
            inflater.push(compressed.subarray(offset, offset + chunkSize), offset + chunkSize >= compressed.byteLength);
        }
    }
    if (size !== entry.size) {
        throw new Error(`ZIP entry inflated size does not match its declared size for ${entry.path}.`);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return data;
}

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ ZIP_CRC_TABLE[(crc ^ byte) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
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

function isDirectoryPickerCancelled(error: unknown): boolean {
    if (!(error instanceof Error) || error.name !== "AbortError") return false;
    // Chromium reports an AbortError when an embedded automation host intercepts
    // the native picker. That is an availability failure, not a user cancel, so
    // it must still reach the directory-input fallback.
    return !error.message.includes("Intercepted by Page.setInterceptFileChooserDialog");
}
