import type {
    EditorCommandDiagnostic,
    EditorCommandNodeState,
    EditorCommandOperation,
    EditorDisplayNodeSelector,
} from "./EditorCommand";

export type BrowserProjectStorageKind = "indexeddb" | "opfs" | "memory";
export type BrowserProjectStorageStatus = "idle" | "initializing" | "ready" | "failed" | "unsupported";

export interface BrowserProjectStorageState {
    kind: BrowserProjectStorageKind;
    status: BrowserProjectStorageStatus;
    workspaceName: string;
    fairyPath: string;
    available: boolean;
    projectFileExists: boolean;
    workspaceState: "empty" | "project_file_present" | "unknown";
    fileCount: number;
    directoryCount: number;
    totalBytes: number;
    writeCount: number;
    error?: string;
    directoryWriteback?: BrowserDirectoryWritebackState;
}

export type BrowserDirectoryWritebackStatus =
    | "none"
    | "ready"
    | "conflict"
    | "permission_prompt"
    | "permission_denied"
    | "unavailable";

export interface BrowserDirectoryWritebackState {
    status: BrowserDirectoryWritebackStatus;
    directoryName?: string;
    baselineFileCount: number;
    restored: boolean;
    message: string;
}

export interface BrowserWorkspaceFile {
    path: string;
    data: Uint8Array;
}

export interface DisplayNodeSaveTarget {
    kind: "displayNode";
    selector: EditorDisplayNodeSelector;
    expected: EditorCommandNodeState;
}

export interface TransactionSaveTarget {
    kind: "transaction";
    operation: EditorCommandOperation;
    expected: unknown;
    description: string;
}

export interface TransactionBatchSaveTarget {
    kind: "transactionBatch";
    operations: EditorCommandOperation[];
    expected: unknown[];
    description: string;
}

export type BrowserSaveTarget = DisplayNodeSaveTarget | TransactionSaveTarget | TransactionBatchSaveTarget;

export interface BrowserSaveResult {
    ok: boolean;
    generatedAt: string;
    mode: "browser_workspace_save";
    storage: BrowserProjectStorageState;
    target?: BrowserSaveTarget;
    results: {
        connect: BrowserSaveStepResult;
        save: BrowserSaveStepResult;
        reload: BrowserReloadStepResult;
        events: BrowserEventsStepResult;
    };
    writeback?: BrowserWorkspaceWriteback;
    diagnostics: EditorCommandDiagnostic[];
}

export type BrowserWorkspaceLifecycleMode =
    | "workspace_bootstrap"
    | "workspace_clear"
    | "workspace_export_manifest"
    | "workspace_import_directory";

export interface BrowserWorkspaceExport {
    format: "manifest" | "zip";
    fileName: string;
    mimeType: string;
    bytes: number;
    fileCount: number;
    totalBytes: number;
    blob?: Blob;
}

export interface BrowserWorkspaceWriteback {
    ok: boolean;
    status: "saved" | "skipped" | "conflict" | "failed";
    directoryName?: string;
    fileCount: number;
    totalBytes: number;
    conflictCount?: number;
    errorCode?: string;
    message?: string;
}

export interface DirectoryVersionEntry {
    path: string;
    bytes: number;
    sha256: string;
}

export interface DirectoryWritebackConflict {
    path: string;
    kind: "changed" | "missing" | "created";
}

export interface BrowserWorkspaceImport {
    source: "directory";
    sourceName: string;
    projectRoot: string;
    fairyPath: string;
    fileCount: number;
    totalBytes: number;
}

export interface BrowserWorkspaceLifecycleResult {
    ok: boolean;
    generatedAt: string;
    mode: BrowserWorkspaceLifecycleMode;
    storage: BrowserProjectStorageState;
    target?: BrowserSaveTarget;
    results: {
        connect?: BrowserSaveStepResult;
        materialize?: BrowserSaveStepResult;
        apply?: BrowserSaveStepResult;
        save?: BrowserSaveStepResult;
        reload?: BrowserReloadStepResult;
        events?: BrowserEventsStepResult;
    };
    export?: BrowserWorkspaceExport;
    imported?: BrowserWorkspaceImport;
    diagnostics: EditorCommandDiagnostic[];
}

export interface BrowserSaveStepResult {
    ok: boolean;
    revision?: number;
    dirty?: boolean;
    lastSavedRevision?: number;
    errorCode?: string;
    message?: string;
}

export interface BrowserReloadStepResult {
    ok: boolean;
    status: "verified" | "skipped" | "failed";
    reloaded?: EditorCommandNodeState | unknown;
    message?: string;
}

export interface BrowserEventsStepResult {
    ok: boolean;
    kinds: string[];
    message?: string;
}
