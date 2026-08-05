import type { EditorCommandDiagnostic, EditorCommandOperation } from "./EditorCommand";
import type { EditorProjectSnapshot } from "./ProjectSnapshot";

export type BrowserLiveSessionStatus = "idle" | "loading" | "connected" | "failed";
export type BrowserLiveProjectSource = "uam_baseline" | "browser_workspace";
export type BrowserWorkspaceRestoreStatus = "unavailable" | "unsupported" | "missing" | "restored" | "failed";

export interface BrowserLiveSessionBaseline {
    schemaVersion: 1 | 2;
    source: BrowserLiveSessionBaselineSource;
    project: BrowserLiveSessionProject;
    target: BrowserLiveSessionTarget;
    uamProject: unknown;
}

export interface BrowserLiveSessionBaselineSource {
    packageName: string;
    packageVersion: string;
    packageVersions?: BrowserPackageVersions;
    sourceKind?: "npm_package" | "workspace_source";
}

export interface BrowserPackageVersions {
    core?: string;
    functions?: string;
    backend?: string;
    cli?: string;
}

export interface BrowserLiveSessionProject {
    id: string;
    type: number | string;
    version: string;
}

export interface BrowserLiveSessionTarget {
    packageId: string;
    packageName: string;
    componentResourceId: string;
    componentName: string;
    displayNodeId: string;
    displayNodeName: string;
}

export interface BrowserLiveSessionState {
    status: BrowserLiveSessionStatus;
    liveSession: boolean;
    revision: number;
    dirty: boolean;
    uamFidelity?: "full" | "unsupported";
    lockHeld?: boolean;
    projectSource: BrowserLiveProjectSource;
    workspaceRestoreStatus: BrowserWorkspaceRestoreStatus;
    workspaceRestoreMessage?: string;
    sessionId?: string;
    backendPackageVersion?: string;
    backendBuildSource?: "npm_package" | "workspace_source";
    backendContractVersion?: string;
    capabilitySchemaVersion?: number;
    backendBundleUrl?: string;
    uamBaselineUrl?: string;
    boundary: string;
    error?: string;
}

export interface BrowserLiveSessionRuntime {
    getState(): BrowserLiveSessionState;
    getProjectSnapshot(): EditorProjectSnapshot | null;
    connect(): Promise<BrowserLiveSessionState>;
    applyTransaction(
        operations: EditorCommandOperation[],
        expectedRevision: number,
        inverseOperations?: EditorCommandOperation[],
    ): Promise<BrowserLiveTransactionResult>;
}

export type BrowserLiveTransactionResult =
    | BrowserLiveTransactionOk
    | BrowserLiveTransactionFailed;

export interface BrowserLiveTransactionOk {
    ok: true;
    revision: number;
    dirty: boolean;
    diagnostics: EditorCommandDiagnostic[];
    raw: unknown;
}

export interface BrowserLiveTransactionFailed {
    ok: false;
    revision?: number;
    dirty?: boolean;
    error: {
        code: string;
        message: string;
        expectedRevision?: number;
        actualRevision?: number;
        opIndex?: number;
        opKind?: string;
    };
    diagnostics: EditorCommandDiagnostic[];
    raw: unknown;
}
