import type {
    DirectoryVersionEntry,
    DirectoryWritebackConflict,
    BrowserWorkspaceFile,
} from "../model/BrowserWorkspace";

export interface DirectoryWritebackObservedEntry {
    path: string;
    version?: DirectoryVersionEntry;
}

export interface DirectoryWritebackFileChange {
    file: BrowserWorkspaceFile;
    previous?: Uint8Array;
    remove?: boolean;
}

export async function writeDirectoryFilesWithRollback(
    changes: readonly DirectoryWritebackFileChange[],
    writeFile: (file: BrowserWorkspaceFile) => Promise<void>,
    removeFile: (path: string) => Promise<void>,
): Promise<void> {
    const attempted: DirectoryWritebackFileChange[] = [];
    try {
        for (const change of changes) {
            attempted.push(change);
            if (change.remove) await removeFile(change.file.path);
            else await writeFile(change.file);
        }
    } catch (writeError) {
        const rollbackErrors: string[] = [];
        for (const change of attempted.reverse()) {
            try {
                if (change.previous === undefined) {
                    await removeFile(change.file.path);
                } else {
                    await writeFile({ path: change.file.path, data: change.previous });
                }
            } catch (rollbackError) {
                rollbackErrors.push(change.file.path + ": " + formatError(rollbackError));
            }
        }

        if (rollbackErrors.length > 0) {
            throw createDirectoryWritebackPolicyError(
                "DIRECTORY_WRITEBACK_ROLLBACK_FAILED",
                formatError(writeError) + " Rollback failed for " + rollbackErrors.join(", ") + ".",
            );
        }
        throw createDirectoryWritebackPolicyError(
            "DIRECTORY_WRITEBACK_ROLLED_BACK",
            formatError(writeError) + " Restored " + attempted.length + " attempted file(s) to their pre-write state.",
        );
    }
}

export async function createDirectoryWritebackBaseline(
    files: readonly BrowserWorkspaceFile[],
): Promise<DirectoryVersionEntry[]> {
    const paths = new Set<string>();
    const entries: DirectoryVersionEntry[] = [];
    for (const file of files) {
        const path = normalizeDirectoryWritebackPath(file.path);
        if (paths.has(path)) {
            throw createDirectoryWritebackPolicyError(
                "DIRECTORY_CONFLICT_INVALID_BASELINE",
                "Duplicate workspace path: " + path + ".",
            );
        }
        paths.add(path);
        entries.push(await createDirectoryVersionEntry(path, file.data));
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function createDirectoryVersionEntry(
    path: string,
    data: Uint8Array,
): Promise<DirectoryVersionEntry> {
    const normalizedPath = normalizeDirectoryWritebackPath(path);
    return {
        path: normalizedPath,
        bytes: data.byteLength,
        sha256: await sha256(data),
    };
}

export function compareDirectoryWritebackVersions(
    baseline: readonly DirectoryVersionEntry[],
    observed: readonly DirectoryWritebackObservedEntry[],
): DirectoryWritebackConflict[] {
    const expected = new Map<string, DirectoryVersionEntry>();
    for (const entry of baseline) {
        const path = normalizeDirectoryWritebackPath(entry.path);
        if (expected.has(path)) {
            throw createDirectoryWritebackPolicyError(
                "DIRECTORY_CONFLICT_INVALID_BASELINE",
                "Duplicate baseline path: " + path + ".",
            );
        }
        expected.set(path, entry);
    }

    const conflicts: DirectoryWritebackConflict[] = [];
    const observedPaths = new Set<string>();
    for (const entry of observed) {
        const path = normalizeDirectoryWritebackPath(entry.path);
        if (observedPaths.has(path)) {
            throw createDirectoryWritebackPolicyError(
                "DIRECTORY_CONFLICT_INVALID_BASELINE",
                "Duplicate observed path: " + path + ".",
            );
        }
        observedPaths.add(path);

        const previous = expected.get(path);
        if (!previous) {
            if (entry.version) conflicts.push({ path, kind: "created" });
            continue;
        }
        if (!entry.version) {
            conflicts.push({ path, kind: "missing" });
            continue;
        }
        if (previous.bytes !== entry.version.bytes || previous.sha256 !== entry.version.sha256) {
            conflicts.push({ path, kind: "changed" });
        }
    }

    return conflicts.sort((left, right) => left.path.localeCompare(right.path));
}

export function normalizeDirectoryWritebackPath(value: string): string {
    const parts = String(value).replace(/\\/g, "/").split("/");
    if (parts.length === 0 || parts.some((part) => !part || part === "." || part === "..")) {
        throw createDirectoryWritebackPolicyError(
            "DIRECTORY_CONFLICT_INVALID_PATH",
            "Unsafe workspace path: " + value + ".",
        );
    }
    return parts.join("/");
}

async function sha256(data: Uint8Array): Promise<string> {
    if (!globalThis.crypto?.subtle) {
        throw createDirectoryWritebackPolicyError(
            "DIRECTORY_CONFLICT_HASH_UNAVAILABLE",
            "SHA-256 is unavailable, so Folder write-back cannot safely compare versions.",
        );
    }
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", copy.buffer));
    return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

function createDirectoryWritebackPolicyError(code: string, message: string): Error & { code: string } {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
