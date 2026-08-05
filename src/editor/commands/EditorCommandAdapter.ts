import type {
    EditorCommand,
    EditorCommandDiagnostic,
    EditorCommandError,
    EditorCommandHistoryEntry,
    EditorCommandNodeState,
    EditorCommandOperation,
    EditorCommandResult,
    EditorCommandSessionState,
    EditorHighRiskTransaction,
    SetDisplayNodePropsOperation,
    SetDisplayNodePropsCommand,
} from "../model/EditorCommand";
import type {
    EditorProjectSnapshot,
    ProjectSnapshotDisplayNode,
} from "../model/ProjectSnapshot";
import type {
    BrowserLiveSessionRuntime,
    BrowserLiveTransactionFailed,
} from "../model/BrowserLiveSession";
import {
    applyDisplayNodeProps,
    createInverseSetDisplayNodePropsOperation,
    createSetDisplayNodePropsOperation,
    findSnapshotDisplayNode,
    isSetDisplayNodePropsOperation,
    snapshotDisplayNode,
    validateSetDisplayNodeProps,
} from "./DisplayNodePropsLogic";

interface CommandHistoryGroup {
    command?: EditorCommand;
    operation: EditorCommandOperation;
    forwardOperations: EditorCommandOperation[];
    inverseOperations: EditorCommandOperation[];
    summary?: string;
    before?: EditorCommandNodeState;
    after?: EditorCommandNodeState;
    beforeStateId: number;
    afterStateId: number;
}

export class EditorCommandAdapter {
    private snapshot: EditorProjectSnapshot | null = null;
    private revision = 0;
    private history: CommandHistoryGroup[] = [];
    private redoStack: CommandHistoryGroup[] = [];
    private currentStateId = 0;
    private savedStateId = 0;
    private nextStateId = 0;
    private commandLog: EditorCommandHistoryEntry[] = [];
    private commandSequence = 0;
    private liveSessionRuntime: BrowserLiveSessionRuntime | null = null;
    private liveSnapshotSynchronized = true;

    reset(snapshot: EditorProjectSnapshot, revision = 0): void {
        this.snapshot = snapshot;
        this.revision = revision;
        this.history = [];
        this.redoStack = [];
        this.currentStateId = 0;
        this.savedStateId = 0;
        this.nextStateId = 0;
        this.commandLog = [];
        this.commandSequence = 0;
        this.liveSnapshotSynchronized = true;
    }

    updateSnapshot(snapshot: EditorProjectSnapshot): void {
        this.snapshot = snapshot;
        this.liveSnapshotSynchronized = true;
    }

    getRevision(): number {
        return this.revision;
    }

    getCurrentStateId(): number {
        return this.currentStateId;
    }

    canUndo(): boolean {
        return this.liveSnapshotSynchronized && this.history.length > 0;
    }

    canRedo(): boolean {
        return this.liveSnapshotSynchronized && this.redoStack.length > 0;
    }

    getSessionState(): EditorCommandSessionState {
        const liveRuntimeState = this.liveSessionRuntime?.getState();
        const liveRuntimeConnected = liveRuntimeState?.status === "connected"
            && liveRuntimeState.revision === this.revision
            && this.liveSnapshotSynchronized;
        return {
            adapterMode: liveRuntimeConnected
                ? "openfairygui_browser_live_session"
                : "browser_working_copy",
            revision: this.revision,
            dirty: this.isDirty(),
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            undoDepth: this.history.length,
            redoDepth: this.redoStack.length,
            currentStateId: this.currentStateId,
            savedStateId: this.savedStateId,
            historyCount: this.commandLog.length,
            liveSession: liveRuntimeConnected,
            browserRuntimeStatus: liveRuntimeState?.status,
            browserRuntimeBoundary: liveRuntimeState?.boundary,
            browserRuntimeError: liveRuntimeState?.error,
            browserRuntimeProjectSource: liveRuntimeState?.projectSource,
            browserRuntimeWorkspaceRestoreStatus: liveRuntimeState?.workspaceRestoreStatus,
            browserRuntimeWorkspaceRestoreMessage: liveRuntimeState?.workspaceRestoreMessage,
            browserRuntimeUamFidelity: liveRuntimeState?.uamFidelity,
            browserRuntimeLockHeld: liveRuntimeState?.lockHeld,
            backendBundleUrl: liveRuntimeState?.backendBundleUrl,
            uamBaselineUrl: liveRuntimeState?.uamBaselineUrl,
            backendPackageVersion: liveRuntimeState?.backendPackageVersion,
            backendBuildSource: liveRuntimeState?.backendBuildSource,
            backendContractVersion: liveRuntimeState?.backendContractVersion,
            boundary: !this.liveSnapshotSynchronized
                ? "The browser live session applied a transaction without a synchronized project snapshot. Reconnect before editing or saving."
                : liveRuntimeState?.status === "connected" && !liveRuntimeConnected
                ? `The browser live session revision ${liveRuntimeState.revision} does not match editor revision ${this.revision}. Reconnect before editing or saving.`
                : liveRuntimeState?.boundary
                ?? "Local browser working copy. OpenFairyGUI live session and persistent save are behind the runtime adapter boundary.",
        };
    }

    getCommandHistory(): EditorCommandHistoryEntry[] {
        return this.commandLog.slice();
    }

    markSaved(stateId = this.currentStateId): void {
        this.savedStateId = stateId;
    }

    isLiveSessionAligned(): boolean {
        return this.getConnectedLiveRuntime() !== null;
    }

    setLiveSessionRuntime(runtime: BrowserLiveSessionRuntime | null): void {
        this.liveSessionRuntime = runtime;
    }

    applySetDisplayNodeProps(command: SetDisplayNodePropsCommand): EditorCommandResult {
        const validation = validateSetDisplayNodeProps(this.snapshot, command);
        if (validation) {
            return this.recordResult(
                this.createErrorResult(
                    "validate",
                    validation,
                    [
                        {
                            severity: "error",
                            code: validation.code,
                            message: validation.message,
                        },
                    ],
                    command,
                ),
            );
        }

        const node = findSnapshotDisplayNode(this.snapshot, command.selector);
        if (!node) {
            return this.recordResult(
                this.createErrorResult(
                    "validate",
                    {
                        code: "selector_not_found",
                        message: "Display node selector does not exist in the browser working copy.",
                    },
                    [],
                    command,
                ),
            );
        }

        const before = snapshotDisplayNode(node);
        applyDisplayNodeProps(node, command.props);
        const after = snapshotDisplayNode(node);
        const operation: EditorCommandOperation = {
            opId: `set-display-node-props-${this.revision + 1}`,
            kind: "setDisplayNodeProps",
            selector: command.selector,
            props: command.props,
        };

        const inverseOperation = createInverseSetDisplayNodePropsOperation(operation, before, this.revision);
        this.revision += 1;
        this.pushHistoryEntry({
            command,
            operation,
            forwardOperations: [operation],
            inverseOperations: [inverseOperation],
            before,
            after,
        });

        const result: EditorCommandResult = {
            ok: true,
            stage: "apply",
            revision: this.revision,
            dirty: this.isDirty(),
            command,
            operation,
            before,
            after,
            diagnostics: [
                {
                    severity: "info",
                    code: "LOCAL_COMMAND_APPLIED",
                    message:
                        "Browser working copy applied a setDisplayNodeProps command using the validated operation shape.",
                },
            ],
        };
        return this.recordResult(result);
    }

    async applySetDisplayNodePropsWithRuntime(command: SetDisplayNodePropsCommand): Promise<EditorCommandResult> {
        const liveRuntime = this.getConnectedLiveRuntime();
        if (!liveRuntime) {
            if (this.liveSessionRuntime) {
                return this.createLiveSessionRequiredResult("apply", command);
            }
            return this.applySetDisplayNodeProps(command);
        }

        const validation = validateSetDisplayNodeProps(this.snapshot, command);
        if (validation) {
            return this.recordResult(
                this.createErrorResult(
                    "validate",
                    validation,
                    [
                        {
                            severity: "error",
                            code: validation.code,
                            message: validation.message,
                        },
                    ],
                    command,
                ),
            );
        }

        const node = findSnapshotDisplayNode(this.snapshot, command.selector);
        if (!node) {
            return this.recordResult(
                this.createErrorResult(
                    "validate",
                    {
                        code: "selector_not_found",
                        message: "Display node selector does not exist in the live-session working copy.",
                    },
                    [],
                    command,
                ),
            );
        }

        const before = snapshotDisplayNode(node);
        const operation = createSetDisplayNodePropsOperation(command, `live-set-display-node-props-${this.revision + 1}`);
        const liveResult = await liveRuntime.applyTransaction([operation], this.revision);
        if (!liveResult.ok) {
            const failed = liveResult as BrowserLiveTransactionFailed;
            return this.recordResult(
                this.createErrorResult(
                    "apply",
                    {
                        code: failed.error.code,
                        message: failed.error.message,
                        field: failed.error.opKind,
                    },
                    failed.diagnostics,
                    command,
                ),
            );
        }

        this.revision = liveResult.revision;
        if (!this.syncSnapshotFromLiveRuntime(liveRuntime)) {
            applyDisplayNodeProps(node, command.props);
        }
        const updatedNode = findSnapshotDisplayNode(this.snapshot, command.selector);
        const after = updatedNode ? snapshotDisplayNode(updatedNode) : before;
        this.pushHistoryEntry({
            command,
            operation,
            forwardOperations: [operation],
            inverseOperations: [createInverseSetDisplayNodePropsOperation(operation, before, this.revision)],
            before,
            after,
        });

        const result: EditorCommandResult = {
            ok: true,
            stage: "apply",
            revision: this.revision,
            dirty: this.isDirty(),
            command,
            operation,
            before,
            after,
            diagnostics: [
                {
                    severity: "info",
                    code: "LIVE_COMMAND_APPLIED",
                    message:
                        "OpenFairyGUI browser backend memory session accepted setDisplayNodeProps before the preview working copy was updated.",
                },
                ...liveResult.diagnostics,
            ],
        };
        return this.recordResult(result);
    }

    async applySetDisplayNodePropsGroupWithRuntime(
        commands: SetDisplayNodePropsCommand[],
        summary: string,
    ): Promise<EditorCommandResult> {
        if (commands.length === 0) {
            return this.recordResult(
                this.createErrorResult("validate", {
                    code: "command_group_empty",
                    message: "The display-node command group is empty.",
                }),
            );
        }

        const connectedLiveRuntime = this.getConnectedLiveRuntime();
        if (!connectedLiveRuntime && this.liveSessionRuntime) {
            return this.createLiveSessionRequiredResult("apply", commands[0]);
        }

        const prepared: Array<{
            command: SetDisplayNodePropsCommand;
            node: ProjectSnapshotDisplayNode;
            before: EditorCommandNodeState;
            operation: SetDisplayNodePropsOperation;
            inverse: SetDisplayNodePropsOperation;
        }> = [];
        for (let index = 0; index < commands.length; index += 1) {
            const command = commands[index];
            const validation = validateSetDisplayNodeProps(this.snapshot, command);
            if (validation) {
                return this.recordResult(
                    this.createErrorResult("validate", validation, [{
                        severity: "error",
                        code: validation.code,
                        message: validation.message,
                    }], command),
                );
            }
            const node = findSnapshotDisplayNode(this.snapshot, command.selector);
            if (!node) {
                return this.recordResult(
                    this.createErrorResult("validate", {
                        code: "selector_not_found",
                        message: "A display-node command-group selector does not exist in the working copy.",
                    }, [], command),
                );
            }
            const operation = createSetDisplayNodePropsOperation(
                command,
                `live-set-display-node-group-${this.revision + 1}-${index}`,
            );
            const before = snapshotDisplayNode(node);
            prepared.push({
                command,
                node,
                before,
                operation,
                inverse: createInverseSetDisplayNodePropsOperation(operation, before, this.revision),
            });
        }

        const operations = prepared.map((item) => item.operation);
        const inverseOperations = prepared.map((item) => item.inverse).reverse();
        const liveRuntime = connectedLiveRuntime;
        let diagnostics: EditorCommandDiagnostic[] = [];
        if (liveRuntime) {
            const liveResult = await liveRuntime.applyTransaction(operations, this.revision);
            if (!liveResult.ok) {
                const failed = liveResult as BrowserLiveTransactionFailed;
                return this.recordResult(
                    this.createErrorResult("apply", {
                        code: failed.error.code,
                        message: failed.error.message,
                        field: failed.error.opKind,
                    }, failed.diagnostics),
                );
            }
            this.revision = liveResult.revision;
            diagnostics = liveResult.diagnostics;
            if (!this.syncSnapshotFromLiveRuntime(liveRuntime)) {
                this.applyOperationsLocally(operations);
            }
        } else {
            this.applyOperationsLocally(operations);
            this.revision += 1;
        }

        const primary = prepared[prepared.length - 1];
        const first = prepared[0];
        const after = findSnapshotDisplayNode(this.snapshot, first.command.selector);
        this.pushHistoryEntry({
            operation: primary.operation,
            forwardOperations: operations,
            inverseOperations,
            summary,
            before: first.before,
            after: after ? snapshotDisplayNode(after) : first.before,
        });
        return this.recordResult({
            ok: true,
            stage: "apply",
            revision: this.revision,
            dirty: this.isDirty(),
            operation: primary.operation,
            operations,
            summary,
            before: first.before,
            after: after ? snapshotDisplayNode(after) : first.before,
            diagnostics: [
                {
                    severity: "info",
                    code: "DISPLAY_NODE_COMMAND_GROUP_APPLIED",
                    message: `Applied ${operations.length} display-node operations as one command group.`,
                },
                ...diagnostics,
            ],
        });
    }

    async applyHighRiskTransactionWithRuntime(
        transaction: EditorHighRiskTransaction,
    ): Promise<EditorCommandResult> {
        const liveRuntime = this.getConnectedLiveRuntime();
        if (!liveRuntime) {
            return this.createLiveSessionRequiredResult("apply");
        }

        const operations = transaction.operations?.length ? transaction.operations : [transaction.operation];
        const inverseOperations = transaction.inverseOperations?.length
            ? transaction.inverseOperations
            : [transaction.inverseOperation];
        const byteReplacementInverse = operations.some((operation) => operation.kind === "replaceResourceBytes")
            ? inverseOperations
            : undefined;
        const liveResult = await liveRuntime.applyTransaction(
            operations,
            this.revision,
            byteReplacementInverse,
        );
        if (!liveResult.ok) {
            const failed = liveResult as BrowserLiveTransactionFailed;
            return this.recordResult(
                this.createErrorResult(
                    "apply",
                    {
                        code: failed.error.code,
                        message: failed.error.message,
                        field: failed.error.opKind,
                    },
                    failed.diagnostics,
                ),
            );
        }

        this.revision = liveResult.revision;
        this.pushHistoryEntry({
            operation: transaction.operation,
            forwardOperations: operations,
            inverseOperations,
            summary: transaction.summary,
        });
        if (!this.syncSnapshotFromLiveRuntime(liveRuntime)) {
            return this.recordResult(
                {
                    ...this.createErrorResult("apply", {
                        code: "snapshot_sync_missing",
                        message: "The operation completed without returning the updated project state.",
                    }),
                    revision: this.revision,
                    dirty: this.isDirty(),
                    operation: transaction.operation,
                    operations,
                    summary: transaction.summary,
                },
            );
        }

        return this.recordResult({
            ok: true,
            stage: "apply",
            revision: this.revision,
            dirty: this.isDirty(),
            operation: transaction.operation,
            operations,
            summary: transaction.summary,
            diagnostics: [
                {
                    severity: "info",
                    code: "AUTHORING_TRANSACTION_APPLIED",
                    message:
                        "The browser live session applied the transaction and synchronized the project model. Publish is still required to refresh runtime preview assets.",
                },
                ...liveResult.diagnostics,
            ],
        });
    }

    undoLast(): EditorCommandResult {
        const entry = this.history[this.history.length - 1];
        if (!entry) {
            return this.recordResult(
                this.createErrorResult("undo", {
                    code: "undo_stack_empty",
                    message: "No working-copy command is available to undo.",
                }),
            );
        }

        if (!this.canApplyLocally(entry.inverseOperations)) {
            return this.recordResult(
                this.createErrorResult("undo", {
                    code: "live_session_required",
                    message: "High-risk transactions can only be undone through the connected OpenFairyGUI browser live session.",
                }),
            );
        }

        const operation = entry.inverseOperations[entry.inverseOperations.length - 1];
        const node = isSetDisplayNodePropsOperation(operation)
            ? findSnapshotDisplayNode(this.snapshot, operation.selector)
            : null;
        if (!node) {
            return this.recordResult(
                this.createErrorResult(
                    "undo",
                    {
                        code: "selector_not_found",
                        message: "Undo target does not exist in the browser working copy.",
                    },
                    [],
                    entry.command,
                ),
            );
        }

        this.applyOperationsLocally(entry.inverseOperations);
        this.revision += 1;
        this.history.pop();
        this.redoStack.push(entry);
        this.currentStateId = entry.beforeStateId;

        const result: EditorCommandResult = {
            ok: true,
            stage: "undo",
            revision: this.revision,
            dirty: this.isDirty(),
            command: entry.command,
            operation,
            operations: entry.inverseOperations,
            before: entry.after,
            after: snapshotDisplayNode(node),
            diagnostics: [
                {
                    severity: "info",
                    code: "LOCAL_COMMAND_UNDONE",
                    message:
                        "Browser working copy restored the previous display node state. Persistent project save is unchanged.",
                },
            ],
        };
        return this.recordResult(result);
    }

    async undoLastWithRuntime(): Promise<EditorCommandResult> {
        const liveRuntime = this.getConnectedLiveRuntime();
        if (!liveRuntime) {
            if (this.liveSessionRuntime) {
                return this.createLiveSessionRequiredResult("undo");
            }
            return this.undoLast();
        }

        const entry = this.history[this.history.length - 1];
        if (!entry) {
            return this.recordResult(
                this.createErrorResult("undo", {
                    code: "undo_stack_empty",
                    message: "No live-session command is available to undo.",
                }),
            );
        }
        const inverseOperations = entry.inverseOperations;
        if (inverseOperations.length === 0) {
            return this.recordResult(
                this.createErrorResult(
                    "undo",
                    {
                        code: "undo_inverse_missing",
                        message: "The current command does not have an invertible OpenFairyGUI transaction.",
                    },
                    [],
                    entry.command,
                ),
            );
        }

        const liveResult = await liveRuntime.applyTransaction(inverseOperations, this.revision);
        if (!liveResult.ok) {
            const failed = liveResult as BrowserLiveTransactionFailed;
            return this.recordResult(
                this.createErrorResult(
                    "undo",
                    {
                        code: failed.error.code,
                        message: failed.error.message,
                        field: failed.error.opKind,
                    },
                    failed.diagnostics,
                    entry.command,
                ),
            );
        }

        this.history.pop();
        this.redoStack.push(entry);
        this.currentStateId = entry.beforeStateId;
        this.revision = liveResult.revision;
        const synced = this.syncSnapshotFromLiveRuntime(liveRuntime);
        const primaryInverseOperation = inverseOperations[inverseOperations.length - 1];
        const currentNode = isSetDisplayNodePropsOperation(primaryInverseOperation)
            ? findSnapshotDisplayNode(this.snapshot, primaryInverseOperation.selector)
            : null;

        const result: EditorCommandResult = {
            ok: true,
            stage: "undo",
            revision: this.revision,
            dirty: this.isDirty(),
            command: entry.command,
            operation: primaryInverseOperation,
            operations: inverseOperations,
            summary: entry.summary ? `Undo ${entry.summary}` : undefined,
            before: entry.after,
            after: currentNode ? snapshotDisplayNode(currentNode) : undefined,
            diagnostics: [
                {
                    severity: "info",
                    code: entry.summary
                        ? "AUTHORING_TRANSACTION_UNDONE"
                        : "LIVE_COMMAND_UNDONE",
                    message:
                        "OpenFairyGUI browser live session accepted the inverse transaction.",
                },
                ...(synced ? [] : [{
                    severity: "warning" as const,
                    code: "LIVE_SNAPSHOT_SYNC_UNAVAILABLE",
                    message: "The inverse transaction applied, but the browser working-copy snapshot could not be refreshed.",
                }]),
                ...liveResult.diagnostics,
            ],
        };
        return this.recordResult(result);
    }

    redoLast(): EditorCommandResult {
        const entry = this.redoStack[this.redoStack.length - 1];
        if (!entry) {
            return this.recordResult(
                this.createErrorResult("redo", {
                    code: "redo_stack_empty",
                    message: "No working-copy command is available to redo.",
                }),
            );
        }
        if (!this.canApplyLocally(entry.forwardOperations)) {
            return this.recordResult(
                this.createErrorResult("redo", {
                    code: "live_session_required",
                    message: "High-risk transactions can only be redone through the connected OpenFairyGUI browser live session.",
                }),
            );
        }

        this.applyOperationsLocally(entry.forwardOperations);
        this.revision += 1;
        this.redoStack.pop();
        this.history.push(entry);
        this.currentStateId = entry.afterStateId;
        const operation = entry.forwardOperations[entry.forwardOperations.length - 1];
        const node = isSetDisplayNodePropsOperation(operation)
            ? findSnapshotDisplayNode(this.snapshot, operation.selector)
            : null;
        return this.recordResult({
            ok: true,
            stage: "redo",
            revision: this.revision,
            dirty: this.isDirty(),
            command: entry.command,
            operation,
            operations: entry.forwardOperations,
            before: entry.before,
            after: node ? snapshotDisplayNode(node) : entry.after,
            summary: entry.summary ? `Redo ${entry.summary}` : undefined,
            diagnostics: [
                {
                    severity: "info",
                    code: "LOCAL_COMMAND_REDONE",
                    message: "Browser working copy reapplied the command group.",
                },
            ],
        });
    }

    async redoLastWithRuntime(): Promise<EditorCommandResult> {
        const liveRuntime = this.getConnectedLiveRuntime();
        if (!liveRuntime) {
            if (this.liveSessionRuntime) {
                return this.createLiveSessionRequiredResult("redo");
            }
            return this.redoLast();
        }

        const entry = this.redoStack[this.redoStack.length - 1];
        if (!entry) {
            return this.recordResult(
                this.createErrorResult("redo", {
                    code: "redo_stack_empty",
                    message: "No live-session command is available to redo.",
                }),
            );
        }

        const liveResult = await liveRuntime.applyTransaction(entry.forwardOperations, this.revision);
        if (!liveResult.ok) {
            const failed = liveResult as BrowserLiveTransactionFailed;
            return this.recordResult(
                this.createErrorResult(
                    "redo",
                    {
                        code: failed.error.code,
                        message: failed.error.message,
                        field: failed.error.opKind,
                    },
                    failed.diagnostics,
                    entry.command,
                ),
            );
        }

        this.redoStack.pop();
        this.history.push(entry);
        this.currentStateId = entry.afterStateId;
        this.revision = liveResult.revision;
        const synced = this.syncSnapshotFromLiveRuntime(liveRuntime);
        const primaryOperation = entry.forwardOperations[entry.forwardOperations.length - 1];
        const currentNode = isSetDisplayNodePropsOperation(primaryOperation)
            ? findSnapshotDisplayNode(this.snapshot, primaryOperation.selector)
            : null;
        return this.recordResult({
            ok: true,
            stage: "redo",
            revision: this.revision,
            dirty: this.isDirty(),
            command: entry.command,
            operation: primaryOperation,
            operations: entry.forwardOperations,
            summary: entry.summary ? `Redo ${entry.summary}` : undefined,
            before: entry.before,
            after: currentNode ? snapshotDisplayNode(currentNode) : entry.after,
            diagnostics: [
                {
                    severity: "info",
                    code: entry.summary
                        ? "AUTHORING_TRANSACTION_REDONE"
                        : "LIVE_COMMAND_REDONE",
                    message: "OpenFairyGUI browser live session accepted the forward transaction group.",
                },
                ...(synced ? [] : [{
                    severity: "warning" as const,
                    code: "LIVE_SNAPSHOT_SYNC_UNAVAILABLE",
                    message: "The forward transaction applied, but the browser working-copy snapshot could not be refreshed.",
                }]),
                ...liveResult.diagnostics,
            ],
        });
    }

    private getConnectedLiveRuntime(): BrowserLiveSessionRuntime | null {
        if (!this.liveSessionRuntime || !this.liveSnapshotSynchronized) return null;

        const state = this.liveSessionRuntime.getState();
        if (state.status !== "connected") return null;

        return state.revision === this.revision ? this.liveSessionRuntime : null;
    }

    private createLiveSessionRequiredResult(
        stage: "apply" | "undo" | "redo",
        command?: EditorCommand,
    ): EditorCommandResult {
        const state = this.liveSessionRuntime?.getState();
        if (!this.liveSnapshotSynchronized) {
            return this.recordResult(this.createErrorResult(stage, {
                code: "snapshot_sync_missing",
                message: "The browser live session must reconnect after a transaction returned no synchronized project snapshot.",
            }, [], command));
        }
        const revisionMismatch = state?.status === "connected" && state.revision !== this.revision;
        return this.recordResult(this.createErrorResult(stage, {
            code: revisionMismatch ? "live_session_revision_mismatch" : "live_session_required",
            message: revisionMismatch
                ? `Browser live session revision ${state.revision} does not match editor revision ${this.revision}.`
                : "Editing requires the connected OpenFairyGUI browser live session.",
        }, [], command));
    }

    private syncSnapshotFromLiveRuntime(runtime: BrowserLiveSessionRuntime): boolean {
        const snapshot = runtime.getProjectSnapshot();
        if (!snapshot) {
            this.liveSnapshotSynchronized = false;
            return false;
        }
        this.snapshot = snapshot;
        this.liveSnapshotSynchronized = true;
        return true;
    }













    private pushHistoryEntry(
        entry: Omit<CommandHistoryGroup, "beforeStateId" | "afterStateId">,
    ): void {
        const beforeStateId = this.currentStateId;
        const afterStateId = ++this.nextStateId;
        this.history.push({ ...entry, beforeStateId, afterStateId });
        this.redoStack = [];
        this.currentStateId = afterStateId;
    }

    private isDirty(): boolean {
        return this.currentStateId !== this.savedStateId;
    }

    private canApplyLocally(operations: EditorCommandOperation[]): boolean {
        return operations.every((operation) => isSetDisplayNodePropsOperation(operation));
    }

    private applyOperationsLocally(operations: EditorCommandOperation[]): void {
        for (const operation of operations) {
            if (!isSetDisplayNodePropsOperation(operation)) continue;
            const node = findSnapshotDisplayNode(this.snapshot, operation.selector);
            if (node) applyDisplayNodeProps(node, operation.props);
        }
    }













    private createErrorResult(
        stage: "apply" | "undo" | "redo" | "validate",
        error: EditorCommandError,
        diagnostics: EditorCommandDiagnostic[] = [],
        command?: EditorCommand,
    ): EditorCommandResult {
        return {
            ok: false,
            stage,
            revision: this.revision,
            dirty: this.isDirty(),
            command,
            error,
            diagnostics,
        };
    }

    private recordResult(result: EditorCommandResult): EditorCommandResult {
        const target = result.operation && isSetDisplayNodePropsOperation(result.operation)
            ? result.operation.selector
            : result.command?.selector;
        this.commandSequence += 1;
        this.commandLog.push({
            id: `command-${this.commandSequence}`,
            sequence: this.commandSequence,
            createdAt: new Date().toISOString(),
            ok: result.ok,
            stage: result.stage,
            revision: result.revision,
            dirty: result.dirty,
            commandKind: result.command ? result.command.kind : result.operation?.kind || result.stage,
            operationKind: result.operation?.kind,
            summary: result.summary,
            target: target ? { ...target } : undefined,
            before: result.before,
            after: result.after,
            error: result.error,
            diagnostics: result.diagnostics,
        });
        return result;
    }
}
