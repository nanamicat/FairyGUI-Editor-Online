import type { EditorCommandDiagnostic } from "../model/EditorCommand";
import type {
    BrowserDirectoryWritebackState,
    BrowserProjectStorageState,
    BrowserSaveResult,
    BrowserSaveTarget,
    DirectoryVersionEntry,
    BrowserWorkspaceImport,
    BrowserWorkspaceLifecycleMode,
    BrowserWorkspaceLifecycleResult,
    BrowserWorkspaceFile,
    BrowserWorkspaceWriteback,
} from "../model/BrowserWorkspace";
import {
    BrowserProjectStorage,
    BrowserWorkspaceRollbackError,
} from "./BrowserProjectStorage";
import {
    compareDirectoryWritebackVersions,
    createDirectoryVersionEntry,
    createDirectoryWritebackBaseline,
    type DirectoryWritebackObservedEntry,
    type DirectoryWritebackFileChange,
    writeDirectoryFilesWithRollback,
} from "./DirectoryWritebackPolicy";
import type { BrowserLiveSessionBridge } from "./BrowserLiveSessionBridge";

export class BrowserSaveCoordinator {
    private directoryBinding: DirectoryWritebackBinding | null = null;
    private directoryBindingRestoreAttempted = false;
    private directoryBindingRestorePromise: Promise<void> | null = null;
    private directoryBindingState: BrowserDirectoryWritebackState = {
        status: "none",
        baselineFileCount: 0,
        restored: false,
        message: "No Folder is attached to this browser workspace.",
    };

    constructor(
        private readonly liveSession: BrowserLiveSessionBridge,
        private readonly storage: BrowserProjectStorage,
    ) {}

    async getStorageState(): Promise<BrowserProjectStorageState> {
        return await this.restoreWorkspaceBinding();
    }

    async restoreWorkspaceBinding(): Promise<BrowserProjectStorageState> {
        const storage = await this.storage.initialize();
        await this.restoreDirectoryBinding(storage);
        return await this.resolveStorageState(storage);
    }

    async switchWorkspace(workspaceName: string, fairyPath: string): Promise<BrowserProjectStorageState> {
        const previousWorkspaceName = this.storage.getWorkspaceName();
        const previousFairyPath = this.storage.getFairyPath();
        const previousBinding = this.directoryBinding;
        const previousBindingState = this.directoryBindingState;
        const previousBindingRestoreAttempted = this.directoryBindingRestoreAttempted;
        const reset = await this.liveSession.reset();
        if (!reset.ok) throw new Error(reset.message || "Active authoring session could not be closed.");
        this.resetDirectoryBindingState();
        try {
            const storage = await this.storage.switchWorkspace(workspaceName, fairyPath);
            if (!storage.available) throw new Error(storage.error || "Target browser workspace storage is unavailable.");
            await this.restoreDirectoryBinding(storage);
            return await this.resolveStorageState(storage);
        } catch (error) {
            this.resetDirectoryBindingState();
            try {
                const restored = await this.storage.switchWorkspace(previousWorkspaceName, previousFairyPath);
                if (!restored.available) throw new Error(restored.error || "Previous browser workspace storage is unavailable.");
                this.restorePreviousDirectoryBinding(
                    previousBinding,
                    previousBindingState,
                    previousBindingRestoreAttempted,
                );
            } catch (rollbackError) {
                throw new Error(`Workspace switch failed: ${formatError(error)} Rollback also failed: ${formatError(rollbackError)}`);
            }
            throw error;
        }
    }

    async reauthorizeDirectoryBinding(): Promise<BrowserProjectStorageState> {
        const binding = this.directoryBinding;
        if (!binding) {
            const restored = await this.restoreWorkspaceBinding();
            if (restored.directoryWriteback?.status === "permission_prompt") {
                return {
                    ...restored,
                    directoryWriteback: {
                        ...restored.directoryWriteback,
                        message: "Folder binding was restored. Click reauthorize again to open the browser permission prompt.",
                    },
                };
            }
            return restored;
        }
        const workspaceName = this.storage.getWorkspaceName();
        let state: BrowserDirectoryWritebackState;
        try {
            const permissionHandle = binding.directory as unknown as DirectoryPermissionHandle;
            const permission = typeof permissionHandle.requestPermission === "function"
                ? await permissionHandle.requestPermission({ mode: "readwrite" })
                : await queryDirectoryWritePermission(binding.directory);
            if (permission !== "granted") throw new Error("Permission state: " + permission + ".");
            state = createDirectoryBindingState(binding, "granted");
        } catch (error) {
            state = {
                status: "permission_denied",
                directoryName: binding.directoryName,
                baselineFileCount: binding.baseline.length,
                restored: binding.restored,
                message: "Folder permission was not granted: " + formatError(error),
            };
        }
        if (this.directoryBinding === binding && this.storage.getWorkspaceName() === workspaceName) {
            this.directoryBindingState = state;
        }
        return await this.resolveStorageState(await this.storage.getState());
    }

    async checkExternalChanges(): Promise<BrowserWorkspaceWriteback> {
        await this.restoreWorkspaceBinding();
        const binding = this.directoryBinding;
        if (!binding) {
            return {
                ok: true,
                status: "skipped",
                fileCount: 0,
                totalBytes: 0,
                message: "No authorized Folder is attached to this workspace.",
            };
        }
        const permission = await queryDirectoryWritePermission(binding.directory);
        if (permission !== "granted") {
            return {
                ok: false,
                status: "failed",
                directoryName: binding.directoryName,
                fileCount: 0,
                totalBytes: 0,
                errorCode: "DIRECTORY_PERMISSION_DENIED",
                message: "Folder permission is not granted. Reauthorize or re-import the Folder.",
            };
        }
        const inspection = await this.inspectDirectoryWriteback(binding);
        if (inspection.conflicts.length > 0) {
            const message = describeDirectoryWritebackConflicts(inspection.conflicts);
            this.directoryBindingState = {
                status: "conflict",
                directoryName: binding.directoryName,
                baselineFileCount: binding.baseline.length,
                restored: binding.restored,
                message,
            };
            return {
                ok: false,
                status: "conflict",
                directoryName: binding.directoryName,
                fileCount: inspection.files.length,
                totalBytes: inspection.files.reduce((total, file) => total + file.data.byteLength, 0),
                conflictCount: inspection.conflicts.length,
                errorCode: "DIRECTORY_WRITEBACK_CONFLICT",
                message,
            };
        }
        return {
            ok: true,
            status: "skipped",
            directoryName: binding.directoryName,
            fileCount: inspection.files.length,
            totalBytes: inspection.files.reduce((total, file) => total + file.data.byteLength, 0),
            message: "No external target-file changes were detected. Save remains compare-before-write, not a collaboration lock.",
        };
    }

    async bootstrapWorkspace(): Promise<BrowserWorkspaceLifecycleResult> {
        const storageState = await this.restoreWorkspaceBinding();
        if (!storageState.available) {
            return this.createFailedLifecycleResult(
                "workspace_bootstrap",
                storageState,
                "BROWSER_STORAGE_UNAVAILABLE",
                storageState.error || "Browser workspace storage is unavailable.",
            );
        }

        const bootstrapped = await this.liveSession.bootstrapWorkspace();
        const storage = await this.resolveStorageState(storageState);
        const bootstrapWrite = bootstrapped.materialize ?? bootstrapped.apply;
        return {
            ok: bootstrapped.connect.ok && (bootstrapWrite?.ok ?? true) && bootstrapped.save.ok && bootstrapped.reload.ok,
            generatedAt: new Date().toISOString(),
            mode: "workspace_bootstrap",
            storage,
            target: bootstrapped.target,
            results: {
                connect: bootstrapped.connect,
                materialize: bootstrapped.materialize,
                apply: bootstrapped.apply,
                save: bootstrapped.save,
                reload: bootstrapped.reload,
                events: bootstrapped.events,
            },
            diagnostics: bootstrapped.diagnostics,
        };
    }

    async clearWorkspace(): Promise<BrowserWorkspaceLifecycleResult> {
        const storageState = await this.restoreWorkspaceBinding();
        if (!storageState.available) {
            return this.createFailedLifecycleResult(
                "workspace_clear",
                storageState,
                "BROWSER_STORAGE_UNAVAILABLE",
                storageState.error || "Browser workspace storage is unavailable.",
            );
        }

        const reset = await this.liveSession.reset();
        if (!reset.ok) {
            return this.createFailedLifecycleResult(
                "workspace_clear",
                storageState,
                "LIVE_SESSION_CLOSE_FAILED",
                reset.message || "Browser workspace was not cleared because the active authoring session could not be closed.",
            );
        }

        try {
            await this.clearDirectoryBinding();
        } catch (error) {
            return this.createFailedLifecycleResult(
                "workspace_clear",
                storageState,
                "DIRECTORY_BINDING_CLEAR_FAILED",
                "Browser workspace was not cleared because the saved Folder binding could not be removed: " + formatError(error),
            );
        }
        const storage = this.decorateStorageState(await this.storage.clearWorkspace());
        return {
            ok: storage.available && storage.fileCount === 0 && !storage.projectFileExists,
            generatedAt: new Date().toISOString(),
            mode: "workspace_clear",
            storage,
            results: {},
            diagnostics: [
                {
                    severity: "info",
                    code: "BROWSER_WORKSPACE_CLEARED",
                    message:
                        "Browser workspace storage was cleared. This does not change the packaged UAM baseline or the user's local project directory.",
                },
            ],
        };
    }

    async exportWorkspaceManifest(): Promise<BrowserWorkspaceLifecycleResult> {
        const storageState = await this.restoreWorkspaceBinding();
        if (!storageState.available) {
            return this.createFailedLifecycleResult(
                "workspace_export_manifest",
                storageState,
                "BROWSER_STORAGE_UNAVAILABLE",
                storageState.error || "Browser workspace storage is unavailable.",
            );
        }

        const exported = await this.storage.exportWorkspaceManifest();
        const storage = await this.resolveStorageState(storageState);
        return {
            ok: true,
            generatedAt: new Date().toISOString(),
            mode: "workspace_export_manifest",
            storage,
            results: {},
            export: exported,
            diagnostics: [
                {
                    severity: exported.fileCount > 0 ? "info" : "warning",
                    code: exported.fileCount > 0
                        ? "BROWSER_WORKSPACE_EXPORTED"
                        : "BROWSER_WORKSPACE_EXPORT_EMPTY",
                    message: exported.fileCount > 0
                        ? "Browser workspace was exported as a JSON manifest."
                        : "Browser workspace is empty; the exported manifest contains no project files.",
                },
            ],
        };
    }

    async importWorkspaceFiles(
        imported: BrowserWorkspaceImport,
        files: BrowserWorkspaceFile[],
        directoryHandle?: FileSystemDirectoryHandle,
    ): Promise<BrowserWorkspaceLifecycleResult> {
        const storageState = await this.restoreWorkspaceBinding();
        const mode: BrowserWorkspaceLifecycleMode = "workspace_import_directory";
        if (!storageState.available) {
            return this.createFailedLifecycleResult(
                mode,
                storageState,
                "BROWSER_STORAGE_UNAVAILABLE",
                storageState.error || "Browser workspace storage is unavailable.",
            );
        }

        const reset = await this.liveSession.reset();
        if (!reset.ok) {
            return this.createFailedLifecycleResult(
                mode,
                storageState,
                "LIVE_SESSION_CLOSE_FAILED",
                reset.message || "Browser workspace was not replaced because the active authoring session could not be closed.",
            );
        }

        const previousFairyPath = this.storage.getFairyPath();
        const previousBinding = this.directoryBinding;
        const previousBindingState = this.directoryBindingState;
        const previousBindingRestoreAttempted = this.directoryBindingRestoreAttempted;
        try {
            await this.clearDirectoryBinding();
        } catch (error) {
            this.restorePreviousDirectoryBinding(
                previousBinding,
                previousBindingState,
                previousBindingRestoreAttempted,
            );
            let bindingRestoreFailure = "";
            if (previousBinding) {
                try {
                    await this.persistDirectoryBinding(previousBinding);
                } catch (bindingError) {
                    bindingRestoreFailure = ` Folder binding restore also failed: ${formatError(bindingError)}.`;
                }
            }
            return this.createFailedLifecycleResult(
                mode,
                storageState,
                "DIRECTORY_BINDING_CLEAR_FAILED",
                "Browser workspace was not replaced because the saved Folder binding could not be removed: "
                    + formatError(error) + "." + bindingRestoreFailure,
            );
        }
        this.storage.setFairyPath(imported.fairyPath);
        let storage: BrowserProjectStorageState;
        try {
            storage = this.decorateStorageState(await this.storage.replaceWorkspaceFiles(files));
        } catch (error) {
            this.storage.setFairyPath(previousFairyPath);
            if (error instanceof BrowserWorkspaceRollbackError) {
                this.resetDirectoryBindingState(true);
                return this.createFailedLifecycleResult(
                    mode,
                    this.decorateStorageState(await this.storage.getState()),
                    error.code,
                    `${error.message} Re-import the workspace before editing or saving.`,
                );
            }
            this.restorePreviousDirectoryBinding(
                previousBinding,
                previousBindingState,
                previousBindingRestoreAttempted,
            );
            let bindingRestoreFailure = "";
            if (previousBinding) {
                try {
                    await this.persistDirectoryBinding(previousBinding);
                } catch (bindingError) {
                    bindingRestoreFailure = ` Folder binding restore also failed: ${formatError(bindingError)}.`;
                }
            }
            const restored = this.decorateStorageState(await this.storage.getState());
            return this.createFailedLifecycleResult(
                mode,
                restored,
                "BROWSER_WORKSPACE_IMPORT_ROLLED_BACK",
                `Browser workspace import failed and the previous files were restored: ${formatError(error)}.${bindingRestoreFailure}`,
            );
        }
        const projectFileExists = storage.projectFileExists;
        const diagnostics: EditorCommandDiagnostic[] = [
            {
                severity: storage.available && projectFileExists ? "info" : "error",
                code: storage.available && projectFileExists
                    ? "BROWSER_PROJECT_IMPORTED"
                    : "BROWSER_PROJECT_IMPORT_INCOMPLETE",
                message: storage.available && projectFileExists
                    ? `Imported ${imported.fileCount} files from ${imported.sourceName} into the browser workspace.`
                    : "Imported files were written, but the browser workspace project file was not found.",
            },
        ];

        if (storage.available && projectFileExists && directoryHandle) {
            try {
                const directory = await resolveProjectDirectoryHandle(directoryHandle, imported.projectRoot);
                const binding = await this.setDirectoryBinding(directory, imported.fairyPath, files);
                diagnostics.push({
                    severity: binding.persisted ? "info" : "warning",
                    code: binding.persisted
                        ? "DIRECTORY_WRITEBACK_READY"
                        : "DIRECTORY_BINDING_PERSIST_UNAVAILABLE",
                    message: binding.message,
                });
            } catch (error) {
                diagnostics.push({
                    severity: "warning",
                    code: "DIRECTORY_WRITEBACK_UNAVAILABLE",
                    message: `Folder import succeeded, but direct write-back is unavailable: ${formatError(error)}. Reauthorize or choose the project directory again.`,
                });
            }
        }
        return {
            ok: storage.available && projectFileExists,
            generatedAt: new Date().toISOString(),
            mode,
            storage: this.decorateStorageState(await this.storage.getState()),
            imported,
            results: {},
            diagnostics,
        };
    }

    async save(target?: BrowserSaveTarget): Promise<BrowserSaveResult> {
        const diagnostics: EditorCommandDiagnostic[] = [];
        const storageState = await this.restoreWorkspaceBinding();
        if (!storageState.available) {
            return this.createFailedResult(
                storageState,
                target,
                "BROWSER_STORAGE_UNAVAILABLE",
                storageState.error || "Browser workspace storage is unavailable.",
            );
        }

        const preparedWriteback = await this.prepareWriteback();

        const connected = await this.liveSession.connect();
        if (connected.status !== "connected") {
            return this.createFailedResult(
                await this.resolveStorageState(storageState),
                target,
                "LIVE_SESSION_UNAVAILABLE",
                connected.error || "OpenFairyGUI browser live session is not connected.",
            );
        }

        const saved = await this.liveSession.saveWorkspace(target);
        diagnostics.push(...saved.diagnostics);
        const resolvedStorage = await this.resolveStorageState(storageState);
        const saveOk = saved.save.ok && saved.reload.ok;
        if (saved.save.ok && resolvedStorage.fileCount === 0) {
            diagnostics.push({
                severity: "warning",
                code: "BROWSER_WORKSPACE_NOT_SEEDED",
                message: "OpenFairyGUI plain saveSession returned ok, but the browser workspace has no files. Use Bootstrap/materialize for an empty clean workspace.",
            });
        }

        const writeback = saveOk
            ? preparedWriteback || await this.writeWorkspaceToDirectory()
            : undefined;
        if (writeback) {
            diagnostics.push({
                severity: writeback.ok ? "info" : writeback.status === "conflict" ? "warning" : "error",
                code: writeback.ok
                    ? writeback.status === "saved"
                        ? "DIRECTORY_WRITEBACK_SAVED"
                        : "DIRECTORY_WRITEBACK_SKIPPED"
                    : writeback.errorCode || "DIRECTORY_WRITEBACK_FAILED",
                message: writeback.message || "Directory write-back did not report a message.",
            });
        }
        const finalStorage = await this.resolveStorageState(resolvedStorage);

        return {
            ok: saveOk && (writeback?.ok ?? true),
            generatedAt: new Date().toISOString(),
            mode: "browser_workspace_save",
            storage: finalStorage,
            target,
            results: {
                connect: {
                    ok: true,
                    revision: connected.revision,
                    dirty: connected.dirty,
                },
                save: saved.save,
                reload: saved.reload,
                events: saved.events,
            },
            writeback,
            diagnostics,
        };
    }

    private async prepareWriteback(): Promise<BrowserWorkspaceWriteback | null> {
        const binding = this.directoryBinding;
        if (!binding) {
            return {
                ok: true,
                status: "skipped",
                fileCount: 0,
                totalBytes: 0,
                message: "No user-authorized Folder is attached; choose and authorize the project directory to save to disk.",
            };
        }

        try {
            await ensureDirectoryWritePermission(binding.directory);
            return null;
        } catch (error) {
            return {
                ok: false,
                status: "failed",
                directoryName: binding.directoryName,
                fileCount: 0,
                totalBytes: 0,
                errorCode: "DIRECTORY_PERMISSION_DENIED",
                message: "Directory write permission was not granted: " + formatError(error),
            };
        }
    }

    private async writeWorkspaceToDirectory(): Promise<BrowserWorkspaceWriteback> {
        const binding = this.directoryBinding;
        if (!binding) {
            return {
                ok: true,
                status: "skipped",
                fileCount: 0,
                totalBytes: 0,
                message: "No user-authorized Folder is attached; choose and authorize the project directory to save to disk.",
            };
        }

        try {
            const { files, snapshots, conflicts } = await this.inspectDirectoryWriteback(binding);
            if (conflicts.length > 0) {
                const message = describeDirectoryWritebackConflicts(conflicts);
                this.directoryBindingState = {
                    status: "conflict",
                    directoryName: binding.directoryName,
                    baselineFileCount: binding.baseline.length,
                    restored: binding.restored,
                    message,
                };
                return {
                    ok: false,
                    status: "conflict",
                    directoryName: binding.directoryName,
                    fileCount: files.length,
                    totalBytes: files.reduce((total, file) => total + file.data.byteLength, 0),
                    conflictCount: conflicts.length,
                    errorCode: "DIRECTORY_WRITEBACK_CONFLICT",
                    message,
                };
            }

            // ponytail: compare-before-write cannot lock another process; re-import after an external writer races this check.
            const changes: DirectoryWritebackFileChange[] = snapshots
                .filter(({ file, previous }) => previous === undefined || !sameBytes(file.data, previous))
                .map(({ file, previous }) => ({ file, previous }));
            await writeDirectoryFilesWithRollback(
                changes,
                (file) => writeDirectoryFile(binding.directory, file),
                (path) => removeDirectoryFile(binding.directory, path),
            );
            binding.baseline = await createDirectoryWritebackBaseline(files);
            let message = changes.length === 0
                ? "Verified " + files.length + " workspace files in " + binding.directoryName + "; no Folder changes were needed."
                : "Wrote and verified " + changes.length + " changed workspace file(s) in " + binding.directoryName + ".";
            try {
                await this.persistDirectoryBinding(binding);
                this.directoryBindingState = createDirectoryBindingState(
                    binding,
                    "granted",
                    "Folder write-back baseline was updated.",
                );
            } catch (error) {
                try {
                    const storage = await this.storage.getState();
                    await deletePersistedDirectoryBinding(storage.workspaceName);
                } catch {
                    // Keep the current-page binding, but never claim a stale cross-refresh baseline is safe.
                }
                this.directoryBindingState = {
                    status: "unavailable",
                    directoryName: binding.directoryName,
                    baselineFileCount: binding.baseline.length,
                    restored: binding.restored,
                    message: "Folder was written, but cross-refresh binding persistence failed: " + formatError(error),
                };
                message += " Cross-refresh Folder binding was not persisted.";
            }
            return {
                ok: true,
                status: "saved",
                directoryName: binding.directoryName,
                fileCount: files.length,
                totalBytes: files.reduce((total, file) => total + file.data.byteLength, 0),
                message,
            };
        } catch (error) {
            return {
                ok: false,
                status: "failed",
                directoryName: binding.directoryName,
                fileCount: 0,
                totalBytes: 0,
                errorCode: getErrorCode(error) || "DIRECTORY_WRITEBACK_FAILED",
                message: "Directory write-back failed: " + formatError(error),
            };
        }
    }

    private async inspectDirectoryWriteback(binding: DirectoryWritebackBinding): Promise<{
        files: BrowserWorkspaceFile[];
        snapshots: Array<{
            file: BrowserWorkspaceFile;
            previous: Uint8Array | undefined;
            observed: DirectoryWritebackObservedEntry;
        }>;
        conflicts: ReturnType<typeof compareDirectoryWritebackVersions>;
    }> {
        const files = await this.storage.readWorkspaceFiles();
        const snapshots = await Promise.all(files.map(async (file) => {
            const previous = await readDirectoryFile(binding.directory, file.path);
            return {
                file,
                previous,
                observed: {
                    path: file.path,
                    version: previous === undefined
                        ? undefined
                        : await createDirectoryVersionEntry(file.path, previous),
                } satisfies DirectoryWritebackObservedEntry,
            };
        }));
        return {
            files,
            snapshots,
            conflicts: compareDirectoryWritebackVersions(
                binding.baseline,
                snapshots.map((snapshot) => snapshot.observed),
            ),
        };
    }

    private async restoreDirectoryBinding(storage: BrowserProjectStorageState): Promise<void> {
        if (!storage.available || this.directoryBinding || this.directoryBindingRestoreAttempted) return;
        if (this.directoryBindingRestorePromise) {
            await this.directoryBindingRestorePromise;
            return;
        }

        this.directoryBindingRestorePromise = (async () => {
            this.directoryBindingRestoreAttempted = true;
            let persisted: PersistedDirectoryBinding | null;
            try {
                persisted = await readPersistedDirectoryBinding(storage.workspaceName);
            } catch (error) {
                this.directoryBindingState = {
                    status: "unavailable",
                    baselineFileCount: 0,
                    restored: true,
                    message: "Saved Folder binding could not be restored: " + formatError(error),
                };
                return;
            }
            if (!persisted) return;

            try {
                const files = await this.storage.readWorkspaceFiles();
                if (!files.some((file) => file.path === persisted.fairyPath)) {
                    this.directoryBindingState = {
                        status: "unavailable",
                        directoryName: persisted.directoryName,
                        baselineFileCount: persisted.baseline.length,
                        restored: true,
                        message: "Saved Folder binding was not attached because its browser workspace project file is missing.",
                    };
                    return;
                }

                this.storage.setFairyPath(persisted.fairyPath);
                this.directoryBinding = {
                    ...persisted,
                    restored: true,
                };
                const permission = await queryDirectoryWritePermission(persisted.directory);
                this.directoryBindingState = createDirectoryBindingState(this.directoryBinding, permission);
            } catch (error) {
                this.directoryBindingState = {
                    status: "unavailable",
                    directoryName: persisted.directoryName,
                    baselineFileCount: persisted.baseline.length,
                    restored: true,
                    message: "Saved Folder binding could not be attached: " + formatError(error),
                };
            }
        })();

        try {
            await this.directoryBindingRestorePromise;
        } finally {
            this.directoryBindingRestorePromise = null;
        }
    }

    private async clearDirectoryBinding(): Promise<void> {
        const storage = await this.storage.getState();
        await deletePersistedDirectoryBinding(storage.workspaceName);
        this.resetDirectoryBindingState(true);
    }

    private resetDirectoryBindingState(restored = false): void {
        this.directoryBinding = null;
        this.directoryBindingRestoreAttempted = restored;
        this.directoryBindingRestorePromise = null;
        this.directoryBindingState = {
            status: "none",
            baselineFileCount: 0,
            restored: false,
            message: "No Folder is attached to this browser workspace.",
        };
    }

    private restorePreviousDirectoryBinding(
        binding: DirectoryWritebackBinding | null,
        state: BrowserDirectoryWritebackState,
        restoreAttempted: boolean,
    ): void {
        this.directoryBinding = binding;
        this.directoryBindingState = state;
        this.directoryBindingRestoreAttempted = restoreAttempted;
        this.directoryBindingRestorePromise = null;
    }

    private async setDirectoryBinding(
        directory: FileSystemDirectoryHandle,
        fairyPath: string,
        files: readonly BrowserWorkspaceFile[],
    ): Promise<{ persisted: boolean; message: string }> {
        const binding: DirectoryWritebackBinding = {
            directory,
            directoryName: directory.name || "selected-folder",
            fairyPath,
            baseline: await createDirectoryWritebackBaseline(files),
            restored: false,
        };
        this.directoryBinding = binding;
        this.directoryBindingRestoreAttempted = true;
        const permission = await queryDirectoryWritePermission(directory);
        this.directoryBindingState = createDirectoryBindingState(binding, permission);

        try {
            await this.persistDirectoryBinding(binding);
            return {
                persisted: true,
                message: this.directoryBindingState.message,
            };
        } catch (error) {
            try {
                const storage = await this.storage.getState();
                await deletePersistedDirectoryBinding(storage.workspaceName);
            } catch {
                // The new in-page binding remains usable, but refresh must not trust a partial persisted record.
            }
            this.directoryBindingState = {
                status: "unavailable",
                directoryName: binding.directoryName,
                baselineFileCount: binding.baseline.length,
                restored: false,
                message: "Folder is attached for this page, but cross-refresh restore is unavailable: " + formatError(error),
            };
            return {
                persisted: false,
                message: this.directoryBindingState.message,
            };
        }
    }

    private async persistDirectoryBinding(binding: DirectoryWritebackBinding): Promise<void> {
        const storage = await this.storage.getState();
        await savePersistedDirectoryBinding(storage.workspaceName, binding);
    }

    private decorateStorageState(state: BrowserProjectStorageState): BrowserProjectStorageState {
        return {
            ...state,
            directoryWriteback: this.directoryBindingState,
        };
    }

    private async resolveStorageState(
        fallback: BrowserProjectStorageState,
    ): Promise<BrowserProjectStorageState> {
        const state = await this.storage.getState();
        return this.decorateStorageState(state || fallback);
    }

    private createFailedResult(
        storage: BrowserProjectStorageState,
        target: BrowserSaveTarget | undefined,
        code: string,
        message: string,
    ): BrowserSaveResult {
        return {
            ok: false,
            generatedAt: new Date().toISOString(),
            mode: "browser_workspace_save",
            storage: this.decorateStorageState(storage),
            target,
            results: {
                connect: { ok: false, message },
                save: { ok: false, message },
                reload: { ok: false, status: "skipped", message: "Save did not run." },
                events: { ok: false, kinds: [], message: "Save did not run." },
            },
            diagnostics: [
                {
                    severity: "error",
                    code,
                    message,
                },
            ],
        };
    }

    private createFailedLifecycleResult(
        mode: BrowserWorkspaceLifecycleMode,
        storage: BrowserProjectStorageState,
        code: string,
        message: string,
    ): BrowserWorkspaceLifecycleResult {
        return {
            ok: false,
            generatedAt: new Date().toISOString(),
            mode,
            storage: this.decorateStorageState(storage),
            results: {},
            diagnostics: [
                {
                    severity: "error",
                    code,
                    message,
                },
            ],
        };
    }
}

interface DirectoryWritebackBinding {
    directory: FileSystemDirectoryHandle;
    directoryName: string;
    fairyPath: string;
    baseline: DirectoryVersionEntry[];
    restored: boolean;
}

interface PersistedDirectoryBinding {
    key: "active";
    directory: FileSystemDirectoryHandle;
    directoryName: string;
    fairyPath: string;
    baseline: DirectoryVersionEntry[];
}

const DIRECTORY_BINDING_DATABASE_SUFFIX = "-directory-binding";
const DIRECTORY_BINDING_STORE = "bindings";
const DIRECTORY_BINDING_KEY = "active";

interface DirectoryPermissionHandle {
    queryPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
}

function createDirectoryBindingState(
    binding: DirectoryWritebackBinding,
    permission: PermissionState | "unavailable",
    message?: string,
): BrowserDirectoryWritebackState {
    const status = permission === "granted"
        ? "ready"
        : permission === "prompt"
            ? "permission_prompt"
            : permission === "denied"
                ? "permission_denied"
                : "unavailable";
    const defaultMessage = status === "ready"
        ? binding.restored
            ? "Folder authorization was restored. Save compares the imported baseline before write-back."
            : "Folder is attached. Save compares the imported baseline before write-back."
        : status === "permission_prompt"
            ? "Folder handle was restored. Save will request permission before write-back."
            : status === "permission_denied"
                ? "Folder handle was restored, but browser permission is denied. Choose Folder again to replace it."
                : "Folder permission cannot be checked. Reauthorize or choose the project directory again.";
    return {
        status,
        directoryName: binding.directoryName,
        baselineFileCount: binding.baseline.length,
        restored: binding.restored,
        message: message || defaultMessage,
    };
}

export async function readPersistedDirectoryBinding(workspaceName: string): Promise<PersistedDirectoryBinding | null> {
    const database = await openDirectoryBindingDatabase(workspaceName);
    if (!database) return null;
    try {
        const record = await new Promise<unknown>((resolve, reject) => {
            const request = database.transaction(DIRECTORY_BINDING_STORE, "readonly")
                .objectStore(DIRECTORY_BINDING_STORE)
                .get(DIRECTORY_BINDING_KEY);
            request.onerror = () => reject(request.error || new Error("Failed to read Folder binding."));
            request.onsuccess = () => resolve(request.result);
        });
        return parsePersistedDirectoryBinding(record);
    } finally {
        database.close();
    }
}

async function savePersistedDirectoryBinding(
    workspaceName: string,
    binding: DirectoryWritebackBinding,
): Promise<void> {
    const database = await openDirectoryBindingDatabase(workspaceName);
    if (!database) {
        throw createDirectoryBindingError(
            "DIRECTORY_BINDING_PERSIST_UNAVAILABLE",
            "IndexedDB is unavailable for Folder binding persistence.",
        );
    }
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(DIRECTORY_BINDING_STORE, "readwrite");
            transaction.objectStore(DIRECTORY_BINDING_STORE).put({
                key: DIRECTORY_BINDING_KEY,
                directory: binding.directory,
                directoryName: binding.directoryName,
                fairyPath: binding.fairyPath,
                baseline: binding.baseline,
            } satisfies PersistedDirectoryBinding);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error("Failed to save Folder binding."));
            transaction.onabort = () => reject(transaction.error || new Error("Folder binding save was aborted."));
        });
    } finally {
        database.close();
    }
}

async function deletePersistedDirectoryBinding(workspaceName: string): Promise<void> {
    const database = await openDirectoryBindingDatabase(workspaceName);
    if (!database) return;
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(DIRECTORY_BINDING_STORE, "readwrite");
            transaction.objectStore(DIRECTORY_BINDING_STORE).delete(DIRECTORY_BINDING_KEY);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error("Failed to remove Folder binding."));
            transaction.onabort = () => reject(transaction.error || new Error("Folder binding removal was aborted."));
        });
    } finally {
        database.close();
    }
}

function openDirectoryBindingDatabase(workspaceName: string): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(workspaceName + DIRECTORY_BINDING_DATABASE_SUFFIX, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(DIRECTORY_BINDING_STORE)) {
                request.result.createObjectStore(DIRECTORY_BINDING_STORE, { keyPath: "key" });
            }
        };
        request.onerror = () => reject(request.error || new Error("Failed to open Folder binding storage."));
        request.onsuccess = () => resolve(request.result);
    });
}

function parsePersistedDirectoryBinding(value: unknown): PersistedDirectoryBinding | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<PersistedDirectoryBinding>;
    if (
        candidate.key !== DIRECTORY_BINDING_KEY
        || typeof candidate.directoryName !== "string"
        || typeof candidate.fairyPath !== "string"
        || !Array.isArray(candidate.baseline)
        || !candidate.directory
        || typeof candidate.directory.getFileHandle !== "function"
    ) {
        return null;
    }
    if (!candidate.baseline.every((entry) => (
        entry
        && typeof entry.path === "string"
        && typeof entry.bytes === "number"
        && typeof entry.sha256 === "string"
    ))) {
        return null;
    }
    return {
        key: DIRECTORY_BINDING_KEY,
        directory: candidate.directory,
        directoryName: candidate.directoryName,
        fairyPath: candidate.fairyPath,
        baseline: candidate.baseline,
    };
}

async function resolveProjectDirectoryHandle(
    directory: FileSystemDirectoryHandle,
    projectRoot: string,
): Promise<FileSystemDirectoryHandle> {
    let current = directory;
    for (const segment of projectRoot.split("/").filter((part) => part && part !== ".")) {
        current = await current.getDirectoryHandle(segment);
    }
    return current;
}

async function ensureDirectoryWritePermission(directory: FileSystemDirectoryHandle): Promise<void> {
    const permissionHandle = directory as unknown as DirectoryPermissionHandle;
    let permission = await queryDirectoryWritePermission(directory);
    if (permission !== "granted" && typeof permissionHandle.requestPermission === "function") {
        permission = await permissionHandle.requestPermission({ mode: "readwrite" });
    }
    if (permission !== "granted") {
        throw new Error("Permission state: " + permission + ".");
    }
}

async function queryDirectoryWritePermission(
    directory: FileSystemDirectoryHandle,
): Promise<PermissionState | "unavailable"> {
    const permissionHandle = directory as unknown as DirectoryPermissionHandle;
    if (typeof permissionHandle.queryPermission !== "function") return "unavailable";
    try {
        return await permissionHandle.queryPermission({ mode: "readwrite" });
    } catch {
        return "unavailable";
    }
}

async function readDirectoryFile(
    root: FileSystemDirectoryHandle,
    path: string,
): Promise<Uint8Array | undefined> {
    const parts = getSafeDirectoryFileParts(path);
    const fileName = parts.pop();
    if (!fileName) return undefined;
    try {
        let directory = root;
        for (const part of parts) {
            directory = await directory.getDirectoryHandle(part);
        }
        const file = await (await directory.getFileHandle(fileName)).getFile();
        return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
        if (isDirectoryFileAbsent(error)) return undefined;
        throw createDirectoryWritebackError(path, "read", error);
    }
}

function describeDirectoryWritebackConflicts(conflicts: readonly { path: string; kind: string }[]): string {
    const sample = conflicts.slice(0, 3).map((conflict) => conflict.kind + " " + conflict.path).join(", ");
    const suffix = conflicts.length > 3 ? " and " + (conflicts.length - 3) + " more" : "";
    return "Folder write-back was blocked by " + conflicts.length + " external change(s): " + sample + suffix
        + ". Browser workspace remains saved; resolve the external change and select the project directory again.";
}

async function writeDirectoryFile(
    root: FileSystemDirectoryHandle,
    file: BrowserWorkspaceFile,
): Promise<void> {
    const parts = getSafeDirectoryFileParts(file.path);
    const fileName = parts.pop();
    if (!fileName) {
        throw createDirectoryWritebackError(file.path, "validate", new Error("Unsafe workspace path."));
    }

    try {
        let directory = root;
        for (const part of parts) {
            directory = await directory.getDirectoryHandle(part, { create: true });
        }
        const fileHandle = await directory.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        try {
            await writable.write(new Uint8Array(file.data));
            await writable.close();
        } catch (error) {
            const abortable = writable as unknown as { abort?: () => Promise<void> };
            await abortable.abort?.();
            throw error;
        }

        const written = new Uint8Array(await (await fileHandle.getFile()).arrayBuffer());
        if (!sameBytes(file.data, written)) {
            throw new Error("Read-back bytes differ after write.");
        }
    } catch (error) {
        throw createDirectoryWritebackError(file.path, "write", error);
    }
}

async function removeDirectoryFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
    const parts = getSafeDirectoryFileParts(path);
    const fileName = parts.pop();
    if (!fileName) return;
    try {
        let directory = root;
        for (const part of parts) {
            directory = await directory.getDirectoryHandle(part);
        }
        await directory.removeEntry(fileName);
        // ponytail: parent directories are not tracked by the file baseline, so never prune them during rollback.
    } catch (error) {
        if (isDirectoryFileAbsent(error)) return;
        throw createDirectoryWritebackError(path, "remove", error);
    }
}

function getSafeDirectoryFileParts(path: string): string[] {
    const parts = String(path).replace(/\\/g, "/").split("/");
    if (parts.length === 0 || parts.some((part) => !part || part === "." || part === "..")) {
        throw createDirectoryWritebackError(path, "validate", new Error("Unsafe workspace path."));
    }
    return parts;
}

function isDirectoryFileAbsent(error: unknown): boolean {
    return error instanceof DOMException
        && (error.name === "NotFoundError" || error.name === "TypeMismatchError");
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
        if (left[index] !== right[index]) return false;
    }
    return true;
}

function createDirectoryBindingError(code: string, message: string): Error & { code: string } {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
}

function createDirectoryWritebackError(path: string, operation: string, error: unknown): Error & { code: string } {
    const result = new Error(`${operation} ${path}: ${formatError(error)}`) as Error & { code: string };
    result.code = "DIRECTORY_WRITEBACK_FAILED";
    return result;
}

function getErrorCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
