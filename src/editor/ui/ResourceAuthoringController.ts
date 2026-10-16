import {
    parseMovieClipJta,
    parseMovieClipSpriteSheetDescriptor,
    prepareAddBinaryResource,
    prepareAddComponent,
    prepareAddPackage,
    prepareAddResourceFolder,
    prepareDuplicateAssetResource,
    prepareDuplicateResources,
    prepareImportBitmapFontResources,
    prepareImportImageResource,
    prepareImportMovieClipResource,
    prepareImportMovieClipSpriteSheetResource,
    prepareImportSoundResource,
    prepareMoveComponent,
    prepareMoveResourceFolder,
    prepareRemoveAssetResource,
    prepareRemoveBinaryResource,
    prepareRemovePackage,
    prepareRemoveResourceFolder,
    prepareRemoveResources,
    prepareRenamePackage,
    prepareRenameResourceFolder,
    prepareReplaceAssetBytes,
    prepareReplaceBinaryResource,
    prepareResourceMove,
    prepareResourceRename,
    prepareSetResourceExported,
    prepareSetResourceFavorite,
    prepareSetResourceFolderAtlas,
    prepareSetResourceFolderFavorite,
    prepareSetImageResourceProps,
    readImageResourceProps,
    type HighRiskTransactionPreparation,
    type MovieClipFrameInput
} from "../commands/HighRiskAuthoringTransactions";
import { findPackage, findResource } from "../commands/AuthoringTransactionSupport";
import {
    prepareGifMovieClipFrames,
    prepareMovieClipFrame,
    prepareMovieClipSpriteSheetFrames,
    prepareSafeSvgImage,
} from "../dialogs/ResourceEditors";
import type {
    EditorComponentSelector,
    EditorHighRiskTransaction,
    EditorResourceSelector,
    ImageResourceEditableProps,
} from "../model/EditorCommand";
import type {
    ProjectSnapshotComponent,
    ProjectSnapshotPackage,
    ProjectSnapshotResource,
    ProjectSnapshotResourceFolder,
} from "../model/ProjectSnapshot";
import type {
    BrowserLiveSessionBridge,
    BrowserLiveSessionIdentity,
} from "../services/BrowserLiveSessionBridge";
import type {
    ResourceHealthEntry,
    ResourceHealthIssue,
} from "../runtime/ResourceHealthAudit";
import {
    pickBrowserFile,
    pickBrowserFiles,
} from "../services/BrowserFilePicker";
import type { AuthoringDialogController } from "./AuthoringDialogController";
import { setActionEnabled } from "./EditorFormControls";
import type { LibraryResourceFolderSelector } from "./LibraryController";
import type { LibraryItemData } from "./ProjectTreeInteractionController";
import type { EditorActionId } from "../EditorShellConfig";

const TRANSPARENT_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function decodeBase64Bytes(value: string): Uint8Array {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function normalizeCreatedResourcePath(value: string): string | null {
    const parts = value.trim().replaceAll("\\", "/").split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === ".." || part.includes("\0"))) return null;
    return parts.length ? `/${parts.join("/")}/` : "/";
}

interface ResourceAuthoringControllerOptions {
    liveSessionBridge: BrowserLiveSessionBridge;
    dialogs: AuthoringDialogController;
    isLiveSession: () => boolean;
    getSelectedPackage: () => ProjectSnapshotPackage | null;
    getSelectedComponent: () => ProjectSnapshotComponent | null;
    getSelectedResource: () => ProjectSnapshotResource | null;
    getSelectedResourceFolder: () => ProjectSnapshotResourceFolder | null;
    getPackages: () => ProjectSnapshotPackage[];
    getSelectedComponentSelector: () => EditorComponentSelector | null;
    getSelectedResourceFolderSelector: () => LibraryResourceFolderSelector | null;
    setSelectedResourceFolderSelector: (selector: LibraryResourceFolderSelector | null) => void;
    getSelectedPackageId: () => string;
    getWorkspaceId: () => string;
    getLibraryPackageId: () => string;
    setLibraryPackageId: (packageId: string) => void;
    getSelectedLibraryResourceSelectors: () => EditorResourceSelector[];
    applyPreparation: (
        preparation: HighRiskTransactionPreparation,
        identity?: BrowserLiveSessionIdentity | null,
    ) => Promise<boolean>;
    applyLibrarySelection: (data: LibraryItemData | null, preserveResourceSelection?: boolean) => void;
    refreshProjectViews: () => void;
    createActionMenu: () => fgui.PopupMenu;
    addMenuItem: (
        menu: fgui.PopupMenu,
        name: string,
        title: string,
        handler: () => void,
    ) => fgui.GButton;
    showActionMenu: (menu: fgui.PopupMenu, anchor: fgui.GObject | null, source: string, status: string) => void;
    showSelectedResourceInspector: () => void;
    showProjectReferences: () => void;
    removeSelectedComponent: () => void;
    hasEditorAction: (action: EditorActionId) => boolean;
    runEditorAction: (action: EditorActionId) => void;
    setStatus: (message: string, level?: "info" | "error") => void;
    setDebugAttribute: (name: string, value: string) => void;
}

export class ResourceAuthoringController {
    private readonly liveSessionBridge: BrowserLiveSessionBridge;
    private readonly authoringDialogs: AuthoringDialogController;
    private importHistoryWorkspaceId = "";
    private importHistory: Array<{
        id: string;
        kind: string;
        files: string[];
        packageId: string;
        status: "success" | "failed";
        error: string;
        createdAt: string;
    }> = [];
    private readonly retryImports = new Map<string, () => Promise<void>>();

    constructor(private readonly options: ResourceAuthoringControllerOptions) {
        this.liveSessionBridge = options.liveSessionBridge;
        this.authoringDialogs = options.dialogs;
    }

    dispose(): void {
        this.retryImports.clear();
        this.importHistory = [];
    }

    private syncImportHistoryWorkspace(): void {
        const workspaceId = this.options.getWorkspaceId();
        if (workspaceId === this.importHistoryWorkspaceId) return;
        this.importHistoryWorkspaceId = workspaceId;
        this.retryImports.clear();
        try {
            const raw = localStorage.getItem(`fairygui-editor-online.resource-imports.v1:${workspaceId}`);
            const parsed = raw ? JSON.parse(raw) as unknown : [];
            this.importHistory = Array.isArray(parsed) ? parsed.flatMap((item) => {
                if (!item || typeof item !== "object") return [];
                const value = item as Record<string, unknown>;
                if (typeof value.id !== "string" || !["success", "failed"].includes(String(value.status))) return [];
                return [{
                    id: value.id,
                    kind: typeof value.kind === "string" ? value.kind : "resource",
                    files: Array.isArray(value.files) ? value.files.filter((file): file is string => typeof file === "string") : [],
                    packageId: typeof value.packageId === "string" ? value.packageId : "",
                    status: value.status as "success" | "failed",
                    error: typeof value.error === "string" ? value.error : "",
                    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
                }];
            }).slice(0, 30) : [];
        } catch {
            this.importHistory = [];
        }
    }

    recordImport(
        kind: string,
        files: File[],
        packageId: string,
        error = "",
        retry?: () => Promise<void>,
    ): void {
        this.syncImportHistoryWorkspace();
        const entry = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            kind,
            files: files.map((file) => file.name),
            packageId,
            status: error ? "failed" as const : "success" as const,
            error,
            createdAt: new Date().toISOString(),
        };
        this.importHistory.unshift(entry);
        const removed = this.importHistory.splice(30);
        removed.forEach((item) => this.retryImports.delete(item.id));
        if (retry) this.retryImports.set(entry.id, retry);
        try {
            localStorage.setItem(
                `fairygui-editor-online.resource-imports.v1:${this.importHistoryWorkspaceId}`,
                JSON.stringify(this.importHistory),
            );
        } catch {
            // Import history is optional and never blocks authoring.
        }
        this.setDebugAttribute(
            "data-fairy-editor-resource-import-history",
            `${this.importHistory.length}:${entry.status}:${entry.kind}`,
        );
    }

    clearImportRetries(...kinds: string[]): void {
        const selected = new Set(kinds);
        for (const entry of this.importHistory) {
            if (selected.has(entry.kind)) this.retryImports.delete(entry.id);
        }
    }

    private showImportHistoryMenu(anchor: fgui.GObject | null): void {
        this.syncImportHistoryWorkspace();
        const menu = this.createActionMenu();
        if (this.importHistory.length === 0) {
            const empty = this.addMenuItem(menu, "desktopMenuImportHistoryEmpty", "暂无资源导入记录", () => undefined);
            this.setActionEnabled(empty, false);
        }
        for (const entry of this.importHistory.slice(0, 12)) {
            const retry = this.retryImports.get(entry.id);
            const fileLabel = entry.files.join(", ") || entry.kind;
            const title = entry.status === "success"
                ? `✓ ${fileLabel}`
                : retry
                    ? `重试：${fileLabel}`
                    : `失败：${fileLabel}（需重新选择）`;
            const item = this.addMenuItem(menu, `desktopMenuImportHistory-${entry.id}`, title, () => {
                if (retry) void retry();
            });
            this.setActionEnabled(item, Boolean(retry));
            item.tooltips = entry.error || `${entry.kind} · ${new Date(entry.createdAt).toLocaleString()}`;
        }
        if (this.importHistory.length > 0) {
            menu.addSeperator();
            this.addMenuItem(menu, "desktopMenuClearImportHistory", "清除导入历史", () => {
                this.importHistory = [];
                this.retryImports.clear();
                try {
                    localStorage.removeItem(`fairygui-editor-online.resource-imports.v1:${this.importHistoryWorkspaceId}`);
                } catch {
                    // Optional browser history cleanup.
                }
                this.setDebugAttribute("data-fairy-editor-resource-import-history", "0:cleared");
                this.setStatus("资源导入历史已清除，临时重试文件已回收。");
            });
        }
        this.showActionMenu(menu, anchor, "resource-import-history", "已打开资源导入历史；失败项可独立重试。 ");
    }

    private get selectedResourceFolder(): LibraryResourceFolderSelector | null {
        return this.options.getSelectedResourceFolderSelector();
    }

    private set selectedResourceFolder(selector: LibraryResourceFolderSelector | null) {
        this.options.setSelectedResourceFolderSelector(selector);
    }

    private get libraryPackageId(): string {
        return this.options.getLibraryPackageId();
    }

    private set libraryPackageId(packageId: string) {
        this.options.setLibraryPackageId(packageId);
    }

    private get selectedPackageId(): string {
        return this.options.getSelectedPackageId();
    }

    private getSelectedPackage(): ProjectSnapshotPackage | null { return this.options.getSelectedPackage(); }
    private getSelectedComponent(): ProjectSnapshotComponent | null { return this.options.getSelectedComponent(); }
    private getSelectedResource(): ProjectSnapshotResource | null { return this.options.getSelectedResource(); }
    private getSelectedResourceFolder(): ProjectSnapshotResourceFolder | null {
        return this.options.getSelectedResourceFolder();
    }
    private getSelectedComponentSelector(): EditorComponentSelector | null {
        return this.options.getSelectedComponentSelector();
    }
    private getSelectedLibraryResourceSelectors(): EditorResourceSelector[] {
        return this.options.getSelectedLibraryResourceSelectors();
    }
    private applyAuthoringPreparation(
        preparation: HighRiskTransactionPreparation,
        identity?: BrowserLiveSessionIdentity | null,
    ): Promise<boolean> {
        return this.options.applyPreparation(preparation, identity);
    }
    private applyLibrarySelection(data: LibraryItemData | null, preserveResourceSelection = false): void {
        this.options.applyLibrarySelection(data, preserveResourceSelection);
    }
    private refreshProjectViews(): void { this.options.refreshProjectViews(); }
    private createActionMenu(): fgui.PopupMenu { return this.options.createActionMenu(); }
    private addMenuItem(menu: fgui.PopupMenu, name: string, title: string, handler: () => void): fgui.GButton {
        return this.options.addMenuItem(menu, name, title, handler);
    }
    private showActionMenu(menu: fgui.PopupMenu, anchor: fgui.GObject | null, source: string, status: string): void {
        this.options.showActionMenu(menu, anchor, source, status);
    }
    private setActionEnabled(item: fgui.GButton, enabled: boolean): void { setActionEnabled(item, enabled); }
    private showSelectedResourceInspector(): void { this.options.showSelectedResourceInspector(); }
    private showProjectReferencesForCurrentSelection(): void { this.options.showProjectReferences(); }
    private runEditorAction(action: EditorActionId): void {
        this.options.runEditorAction(action);
    }
    private setStatus(message: string, level: "info" | "error" = "info"): void {
        this.options.setStatus(message, level);
    }
    private setDebugAttribute(name: string, value: string): void { this.options.setDebugAttribute(name, value); }

    private async runCancellablePreparation<T>(
        title: string,
        task: (
            isCancelled: () => boolean,
            report: (completed: number, total: number, label?: string) => void,
        ) => Promise<T>,
    ): Promise<T | null> {
        let cancelled = false;
        const dialog = new fgui.Window();
        dialog.modal = true;
        const content = fgui.UIPackage.createObject("Builder", "WaitingDialog").asCom;
        content.getChild("title").asTextField.text = title;
        const cancel = content.getChild("cancel").asButton;
        cancel.visible = true;
        cancel.onClick(this, () => {
            cancelled = true;
            cancel.grayed = true;
            cancel.touchable = false;
            content.getChild("title").asTextField.text = "正在取消...";
        });
        dialog.contentPane = content;
        dialog.show();
        dialog.centerOn(fgui.GRoot.inst, true);
        try {
            const result = await task(
                () => cancelled,
                (completed, total, label = "") => {
                    content.getChild("title").asTextField.text = `${title}\n${completed}/${total}${label ? ` · ${label}` : ""}`;
                },
            );
            return cancelled ? null : result;
        } finally {
            dialog.dispose();
        }
    }
    async applyAuthoringResourceRename(): Promise<void> {
        const resource = this.getSelectedResource();
        const selectedPackage = this.getSelectedPackage();
        if (!resource || !selectedPackage) {
            this.setStatus("Resource rename skipped: no resource selected.");
            return;
        }
        const name = await this.authoringDialogs.requestTextInput(
            "desktopRenameResourceDialog",
            "重命名资源",
            "请输入新的资源名称。",
            resource.name,
            "重命名",
            (value) => value.trim() ? null : "资源名称不能为空。",
        );
        if (name === null) return;
        await this.applyAuthoringPreparation(prepareResourceRename(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id, resourceId: resource.id },
            name,
        ));
    }

    async applyResourceFavoriteToggle(): Promise<void> {
        const resource = this.getSelectedResource();
        const selectedPackage = this.getSelectedPackage();
        if (!resource || !selectedPackage) return;
        await this.applyAuthoringPreparation(prepareSetResourceFavorite(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id, resourceId: resource.id },
            !resource.favorite,
        ));
    }

    async applyResourceExportedToggle(): Promise<void> {
        const resource = this.getSelectedResource();
        const selectedPackage = this.getSelectedPackage();
        if (!resource || !selectedPackage) return;
        await this.applyAuthoringPreparation(prepareSetResourceExported(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id, resourceId: resource.id },
            !resource.exported,
        ));
    }

    async applyResourceFolderFavoriteToggle(): Promise<void> {
        const folder = this.getSelectedResourceFolder();
        const selector = this.selectedResourceFolder;
        if (!folder || !selector) return;
        await this.applyAuthoringPreparation(prepareSetResourceFolderFavorite(
            this.liveSessionBridge.getWorkingProject(),
            selector,
            !folder.favorite,
        ));
    }

    showResourceFolderPropertiesEditor(): void {
        const folder = this.getSelectedResourceFolder();
        const selector = this.selectedResourceFolder;
        const pkg = selector && findPackage(this.liveSessionBridge.getWorkingProject(), selector.packageId);
        if (!folder || !selector || !pkg) return;
        const publish = pkg.publish as { maxAtlasIndex?: number; atlases?: Array<{ index?: number; name?: string }> } | null;
        const maxAtlasIndex = Number.isInteger(publish?.maxAtlasIndex)
            ? Math.max(0, Math.min(255, Number(publish?.maxAtlasIndex)))
            : 10;
        const atlasValues = Array.from({ length: maxAtlasIndex + 1 }, (_, index) => String(index));
        const atlasNames = new Map((publish?.atlases || []).map((entry) => [entry.index, entry.name || ""]));

        const dialog = new fgui.Window();
        dialog.modal = true;
        const content = fgui.UIPackage.createObject("Builder", "FolderPropertyDialog").asCom;
        content.name = "desktopFolderPropertyDialog";
        const enabled = content.getChild("atlasEnabled").asButton;
        const atlas = content.getChild("atlas").asComboBox;
        enabled.selected = folder.atlas !== "";
        atlas.items = atlasValues.map((value) => {
            const name = atlasNames.get(Number(value));
            return name ? `纹理集 ${value} · ${name}` : `纹理集 ${value}`;
        });
        atlas.values = atlasValues;
        atlas.selectedIndex = Math.max(0, atlasValues.indexOf(folder.atlas));
        const syncEnabled = (): void => {
            atlas.grayed = !enabled.selected;
            atlas.touchable = enabled.selected;
        };
        enabled.onClick(this, syncEnabled);
        syncEnabled();
        content.getChild("ok").asButton.onClick(this, () => {
            const value = enabled.selected ? atlasValues[atlas.selectedIndex] || "0" : "";
            void this.applyAuthoringPreparation(prepareSetResourceFolderAtlas(
                this.liveSessionBridge.getWorkingProject(),
                selector,
                value,
            )).then((applied) => {
                if (applied) dialog.dispose();
            });
        });
        content.getChild("cancel").asButton.onClick(this, () => dialog.dispose());
        dialog.contentPane = content;
        dialog.show();
        this.setDebugAttribute("data-fairy-editor-resource-folder-atlas-dialog", `${selector.packageId}:${selector.branch || ""}:${selector.path}`);
    }

    showMultiImagePropertiesEditor(): void {
        const project = this.liveSessionBridge.getWorkingProject();
        const selected = this.options.getSelectedLibraryResourceSelectors().flatMap((selector) => {
            const resource = findResource(project, selector);
            return resource?.kind === "image" ? [{ selector, resource }] : [];
        });
        if (selected.length < 2) {
            this.setStatus("Batch image properties require at least two selected images.");
            return;
        }
        const dialog = new fgui.Window();
        dialog.modal = true;
        const content = fgui.UIPackage.createObject("Builder", "MultiImageEditDialog").asCom;
        const first = readImageResourceProps(selected[0].resource);
        const scale = content.getController("scaleOption");
        scale.selectedIndex = first.scaleOption;
        const smoothing = content.getChild("smoothing").asComboBox;
        smoothing.items = ["否", "是"];
        smoothing.values = ["0", "1"];
        smoothing.selectedIndex = first.smoothing ? 1 : 0;
        const qualityOption = content.getChild("qualityOption").asComboBox;
        qualityOption.items = ["默认", "使用原始数据", "自定义"];
        qualityOption.values = ["default", "source", "custom"];
        qualityOption.value = first.qualityOption || "custom";
        content.getChild("quality").asLabel.title = String(first.quality);
        const duplicatePadding = content.getChild("duplicatePadding").asComboBox;
        duplicatePadding.items = ["否", "是"];
        duplicatePadding.values = ["0", "1"];
        duplicatePadding.selectedIndex = first.duplicatePadding ? 1 : 0;
        const atlas = content.getChild("atlas").asComboBox;
        const atlasValues = ["", "alone", "alone_npot", "alone_mof", ...Array.from({ length: 11 }, (_, index) => String(index))];
        atlas.items = ["默认", "独立纹理", "独立纹理（NPOT）", "独立纹理（4 倍数）", ...Array.from({ length: 11 }, (_, index) => `Atlas 页 ${index}`)];
        atlas.values = atlasValues;
        atlas.selectedIndex = Math.max(0, atlasValues.indexOf(first.textureSetMode));
        for (const name of ["cb0", "cb1", "cb2", "cb3", "cb4"]) content.getChild(name).asButton.selected = false;
        content.getChild("n21").asButton.onClick(this, () => {
            const quality = Number(content.getChild("quality").asLabel.title);
            if (content.getChild("cb2").asButton.selected && (!Number.isInteger(quality) || quality < 0 || quality > 100)) {
                this.setStatus("Image quality must be an integer from 0 to 100.");
                return;
            }
            const transactions: EditorHighRiskTransaction[] = [];
            for (const { selector, resource } of selected) {
                const current = readImageResourceProps(resource);
                const next: ImageResourceEditableProps = {
                    ...current,
                    scaleOption: content.getChild("cb0").asButton.selected
                        ? Math.max(0, Math.min(2, scale.selectedIndex)) as 0 | 1 | 2
                        : current.scaleOption,
                    smoothing: content.getChild("cb1").asButton.selected ? smoothing.selectedIndex === 1 : current.smoothing,
                    qualityOption: content.getChild("cb2").asButton.selected ? qualityOption.value : current.qualityOption,
                    quality: content.getChild("cb2").asButton.selected ? quality : current.quality,
                    textureSetMode: content.getChild("cb3").asButton.selected ? atlas.value : current.textureSetMode,
                    duplicatePadding: content.getChild("cb4").asButton.selected
                        ? duplicatePadding.selectedIndex === 1
                        : current.duplicatePadding,
                };
                if (next.scaleOption === 1 && !next.scale9Grid) {
                    const width = Math.max(3, Number(resource.dimensions?.width || 3));
                    const height = Math.max(3, Number(resource.dimensions?.height || 3));
                    next.scale9Grid = [
                        Math.floor(width / 3),
                        Math.floor(height / 3),
                        Math.max(1, Math.floor(width / 3)),
                        Math.max(1, Math.floor(height / 3)),
                    ];
                }
                const prepared = prepareSetImageResourceProps(project, selector, next);
                if (prepared.ok) transactions.push(prepared.transaction);
                else if (prepared.code !== "image_properties_unchanged") {
                    this.setStatus(`Batch image properties unavailable: ${prepared.code}. ${prepared.message}`);
                    return;
                }
            }
            if (!transactions.length) {
                this.setStatus("Batch image properties are unchanged.");
                dialog.dispose();
                return;
            }
            const operations = transactions.flatMap((item) => item.operations || [item.operation]);
            const inverseOperations = transactions.slice().reverse().flatMap((item) => item.inverseOperations || [item.inverseOperation]);
            void this.applyAuthoringPreparation({
                ok: true,
                transaction: {
                    summary: `Update ${transactions.length} image resources`,
                    operation: transactions[0].operation,
                    inverseOperation: transactions[transactions.length - 1].inverseOperation,
                    operations,
                    inverseOperations,
                },
            }).then((applied) => {
                if (applied) dialog.dispose();
            });
        });
        content.getChild("n23").asButton.onClick(this, () => dialog.dispose());
        dialog.contentPane = content;
        dialog.show();
        dialog.centerOn(fgui.GRoot.inst, true);
        this.setStatus(`Editing common properties for ${selected.length} images.`);
    }

    async importImageResource(retryFile?: File): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        if (!selectedPackage) {
            this.setStatus("Image import skipped: no package selected.");
            return;
        }
        let file = retryFile;
        try {
            file ||= await pickBrowserFile(
                ".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml",
                "Image import was cancelled.",
                "image-resource-import",
            );
            let sourceBytes: Uint8Array;
            let dimensions: { width: number; height: number };
            if (/\.svg$/i.test(file.name)) {
                ({ sourceBytes, dimensions } = await prepareSafeSvgImage(file));
            } else {
                sourceBytes = new Uint8Array(await file.arrayBuffer());
                const bitmap = await createImageBitmap(file);
                dimensions = { width: bitmap.width, height: bitmap.height };
                bitmap.close();
            }
            const preparation = prepareImportImageResource(
                this.liveSessionBridge.getWorkingProject(),
                { packageId: selectedPackage.id },
                {
                    fileName: file.name,
                    sourceBytes,
                },
                dimensions,
            );
            if (preparation.ok === false) {
                throw new Error(`${preparation.code}. ${preparation.message}`);
            }
            const resource = preparation.transaction.operation.kind === "addResource"
                ? preparation.transaction.operation.resource as { id?: string }
                : null;
            if (!await this.applyAuthoringPreparation(preparation) || !resource?.id) {
                this.recordImport("image", [file], selectedPackage.id, "Import transaction was rejected.", () => this.importImageResource(file));
                return;
            }
            this.applyLibrarySelection({
                kind: "resource",
                packageId: selectedPackage.id,
                resourceId: resource.id,
            });
            this.setDebugAttribute(
                "data-fairy-editor-image-import",
                `${resource.id}:${dimensions.width}x${dimensions.height}`,
            );
            this.setStatus(`Imported image ${file.name} (${dimensions.width}×${dimensions.height}).`);
            this.recordImport("image", [file], selectedPackage.id);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Image import skipped: ${message}`);
            if (file) this.recordImport("image", [file], selectedPackage.id, message, () => this.importImageResource(file));
        }
    }

    async importSoundResource(retryFile?: File): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        if (!selectedPackage) {
            this.setStatus("Sound import skipped: no package selected.");
            return;
        }
        let file = retryFile;
        try {
            file ||= await pickBrowserFile(
                ".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg",
                "Sound import was cancelled.",
                "sound-resource-import",
            );
            const preparation = prepareImportSoundResource(
                this.liveSessionBridge.getWorkingProject(),
                { packageId: selectedPackage.id },
                {
                    fileName: file.name,
                    sourceBytes: new Uint8Array(await file.arrayBuffer()),
                },
            );
            if (preparation.ok === false) {
                throw new Error(`${preparation.code}. ${preparation.message}`);
            }
            const resource = preparation.transaction.operation.kind === "addResource"
                ? preparation.transaction.operation.resource as { id?: string }
                : null;
            if (!await this.applyAuthoringPreparation(preparation) || !resource?.id) {
                this.recordImport("sound", [file], selectedPackage.id, "Import transaction was rejected.", () => this.importSoundResource(file));
                return;
            }
            this.applyLibrarySelection({
                kind: "resource",
                packageId: selectedPackage.id,
                resourceId: resource.id,
            });
            this.setDebugAttribute("data-fairy-editor-sound-import", resource.id);
            this.setStatus(`Imported sound ${file.name}.`);
            this.recordImport("sound", [file], selectedPackage.id);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Sound import skipped: ${message}`);
            if (file) this.recordImport("sound", [file], selectedPackage.id, message, () => this.importSoundResource(file));
        }
    }

    async importMovieClipResource(retryFiles?: File[]): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        if (!selectedPackage) {
            this.setStatus("MovieClip import skipped: no package selected.");
            return;
        }
        let files = retryFiles;
        try {
            files ||= await pickBrowserFiles(
                ".png,.jpg,.jpeg,.gif,image/png,image/jpeg,image/gif",
                "MovieClip import was cancelled.",
                "movieclip-resource-import",
            );
            const gif = files.length === 1 && /\.gif$/i.test(files[0].name) ? files[0] : null;
            if (!gif && files.some((file) => /\.gif$/i.test(file.name))) {
                throw new Error("Choose one GIF, or a PNG/JPEG frame sequence without GIF files.");
            }
            const frames = await this.runCancellablePreparation<MovieClipFrameInput[]>(
                `正在处理 ${files.length} 个动画源文件...`,
                async (isCancelled, report) => {
                    const prepared: MovieClipFrameInput[] = gif
                        ? await prepareGifMovieClipFrames(gif, isCancelled, report)
                        : [];
                    const sortedFiles = files!.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
                    if (!gif) for (let index = 0; index < sortedFiles.length; index += 1) {
                        const file = sortedFiles[index];
                        if (isCancelled()) break;
                        prepared.push(await prepareMovieClipFrame(file, isCancelled));
                        report(index + 1, sortedFiles.length, file.name);
                    }
                    return prepared;
                },
            );
            if (!frames) {
                this.setStatus("MovieClip import cancelled.");
                return;
            }
            const preparation = prepareImportMovieClipResource(
                this.liveSessionBridge.getWorkingProject(),
                { packageId: selectedPackage.id },
                frames,
                gif?.name,
                gif ? 100 : 24,
            );
            if (preparation.ok === false) {
                throw new Error(`${preparation.code}. ${preparation.message}`);
            }
            const resource = preparation.transaction.operation.kind === "addResource"
                ? preparation.transaction.operation.resource as { id?: string }
                : null;
            if (!await this.applyAuthoringPreparation(preparation) || !resource?.id) {
                this.recordImport("movieClip", files, selectedPackage.id, "Import transaction was rejected.", () => this.importMovieClipResource(files));
                return;
            }
            this.applyLibrarySelection({
                kind: "resource",
                packageId: selectedPackage.id,
                resourceId: resource.id,
            });
            const croppedCount = frames.filter((frame) =>
                frame.crop
                && (
                    frame.crop.x !== 0
                    || frame.crop.y !== 0
                    || frame.crop.width !== frame.dimensions.width
                    || frame.crop.height !== frame.dimensions.height
                )
            ).length;
            this.setDebugAttribute(
                "data-fairy-editor-movieclip-import",
                `${resource.id}:${frames.length}:cropped=${croppedCount}`,
            );
            this.setStatus(`Imported MovieClip from ${frames.length} frames; alpha-trimmed ${croppedCount}.`);
            this.recordImport("movieClip", files, selectedPackage.id);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`MovieClip import skipped: ${message}`);
            if (files) this.recordImport("movieClip", files, selectedPackage.id, message, () => this.importMovieClipResource(files));
        }
    }

    async importMovieClipSpriteSheetResource(retryFiles?: File[]): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        if (!selectedPackage) {
            this.setStatus("Sprite Sheet import skipped: no package selected.");
            return;
        }
        let files = retryFiles;
        try {
            files ||= await pickBrowserFiles(
                ".json,.eas,.xml,.plist,.png,application/json,text/xml,application/xml,image/png",
                "Sprite Sheet import was cancelled.",
                "movieclip-sprite-sheet-import",
            );
            const descriptors = files.filter((file) => /\.(?:json|eas|xml|plist)$/i.test(file.name));
            const images = files.filter((file) => /\.png$/i.test(file.name));
            if (files.length !== 2 || descriptors.length !== 1 || images.length !== 1) {
                throw new Error("Choose exactly one TexturePacker JSON/EAS/XML/plist descriptor and one PNG atlas.");
            }
            const descriptorFile = descriptors[0];
            const parsed = parseMovieClipSpriteSheetDescriptor(
                descriptorFile.name,
                await descriptorFile.text(),
            );
            if (parsed.ok === false) {
                this.setStatus(`Sprite Sheet import unavailable: ${parsed.code}. ${parsed.message}`);
                return;
            }
            const frames = await this.runCancellablePreparation(
                `正在切分 ${parsed.frames.length} 个动画帧...`,
                (isCancelled, report) => prepareMovieClipSpriteSheetFrames(images[0], parsed.frames, isCancelled, report),
            );
            if (!frames) {
                this.setStatus("Sprite Sheet import cancelled.");
                return;
            }
            const preparation = prepareImportMovieClipSpriteSheetResource(
                this.liveSessionBridge.getWorkingProject(),
                { packageId: selectedPackage.id },
                descriptorFile.name,
                frames,
            );
            if (preparation.ok === false) {
                throw new Error(`${preparation.code}. ${preparation.message}`);
            }
            const resource = preparation.transaction.operation.kind === "addResource"
                ? preparation.transaction.operation.resource as { id?: string; sourceBytes?: Uint8Array }
                : null;
            if (!await this.applyAuthoringPreparation(preparation) || !resource?.id) {
                this.recordImport("movieClipSpriteSheet", files, selectedPackage.id, "Import transaction was rejected.", () => this.importMovieClipSpriteSheetResource(files));
                return;
            }
            this.applyLibrarySelection({
                kind: "resource",
                packageId: selectedPackage.id,
                resourceId: resource.id,
            });
            const textureCount = resource.sourceBytes
                ? parseMovieClipJta(resource.sourceBytes).textures.length
                : 0;
            this.setDebugAttribute(
                "data-fairy-editor-movieclip-sprite-sheet-import",
                `${resource.id}:${parsed.frames.length}:textures=${textureCount}:atlas=${images[0].name}`,
            );
            this.setStatus(
                `Imported MovieClip Sprite Sheet ${descriptorFile.name}: ${parsed.frames.length} frames, ${textureCount} textures.`,
            );
            this.recordImport("movieClipSpriteSheet", files, selectedPackage.id);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Sprite Sheet import skipped: ${message}`);
            if (files) this.recordImport("movieClipSpriteSheet", files, selectedPackage.id, message, () => this.importMovieClipSpriteSheetResource(files));
        }
    }

    async importBitmapFontResource(retryFiles?: File[]): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        if (!selectedPackage) {
            this.setStatus("Bitmap font import skipped: no package selected.");
            return;
        }
        let files = retryFiles;
        try {
            files ||= await pickBrowserFiles(
                ".fnt,.png,.jpg,.jpeg,.webp,text/plain,image/png,image/jpeg,image/webp",
                "Bitmap font import was cancelled.",
                "bitmap-font-import",
            );
            const fontFile = files.find((file) => file.name.toLowerCase().endsWith(".fnt"));
            const textureFile = files.find((file) =>
                [".png", ".jpg", ".jpeg", ".webp"].some((extension) =>
                    file.name.toLowerCase().endsWith(extension),
                ),
            );
            if (files.length !== 2 || !fontFile || !textureFile) {
                throw new Error("Choose exactly one .fnt descriptor and one PNG, JPEG, or WebP texture.");
            }
            const bitmap = await createImageBitmap(textureFile);
            const dimensions = { width: bitmap.width, height: bitmap.height };
            bitmap.close();
            const preparation = prepareImportBitmapFontResources(
                this.liveSessionBridge.getWorkingProject(),
                { packageId: selectedPackage.id },
                {
                    fileName: fontFile.name,
                    sourceBytes: new Uint8Array(await fontFile.arrayBuffer()),
                },
                {
                    fileName: textureFile.name,
                    sourceBytes: new Uint8Array(await textureFile.arrayBuffer()),
                },
                dimensions,
            );
            if (preparation.ok === false) {
                throw new Error(`${preparation.code}. ${preparation.message}`);
            }
            const fontResource = preparation.transaction.operations
                ?.filter((operation) => operation.kind === "addResource")
                .map((operation) => operation.resource as { id?: string; kind?: string })
                .find((resource) => resource.kind === "font");
            if (!await this.applyAuthoringPreparation(preparation) || !fontResource?.id) {
                this.recordImport("bitmapFont", files, selectedPackage.id, "Import transaction was rejected.", () => this.importBitmapFontResource(files));
                return;
            }
            this.applyLibrarySelection({
                kind: "resource",
                packageId: selectedPackage.id,
                resourceId: fontResource.id,
            });
            this.setDebugAttribute(
                "data-fairy-editor-bitmap-font-import",
                `${fontResource.id}:${dimensions.width}x${dimensions.height}`,
            );
            this.setStatus(`Imported bitmap font ${fontFile.name} with texture ${textureFile.name}.`);
            this.recordImport("bitmapFont", files, selectedPackage.id);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Bitmap font import skipped: ${message}`);
            if (files) this.recordImport("bitmapFont", files, selectedPackage.id, message, () => this.importBitmapFontResource(files));
        }
    }

    showCreateBitmapFontDialog(): void {
        this.showCreateAssetDialog("font");
    }

    showCreateMovieClipDialog(): void {
        this.showCreateAssetDialog("movieClip");
    }

    private showCreateAssetDialog(kind: "font" | "movieClip"): void {
        const selectedPackage = this.getSelectedPackage();
        if (!selectedPackage || !this.options.isLiveSession()) {
            this.setStatus(`${kind === "font" ? "Bitmap font" : "MovieClip"} creation requires a selected package and live session.`);
            return;
        }
        const dialog = new fgui.Window();
        dialog.modal = true;
        const content = fgui.UIPackage.createObject(
            "Builder",
            kind === "font" ? "CreateFontDialog" : "CreateMovieClipDialog",
        ).asCom;
        const baseName = kind === "font" ? "Font" : "MovieClip";
        const occupied = new Set(selectedPackage.resources.map((resource) => resource.name.toLocaleLowerCase()));
        let suffix = 1;
        while (occupied.has(`${baseName}${suffix}`.toLocaleLowerCase())) suffix += 1;
        const name = content.getChild("n3").asLabel;
        name.title = `${baseName}${suffix}`;
        const selectedFolder = this.selectedResourceFolder?.packageId === selectedPackage.id
            ? this.selectedResourceFolder
            : null;
        let path = normalizeCreatedResourcePath(selectedFolder?.path || "/") || "/";
        let branch = selectedFolder?.branch || "";
        const renderPath = (): void => {
            content.getChild("n9").asLabel.title = `/${selectedPackage.name}${path}`;
        };
        renderPath();
        content.getChild("n10").asButton.onClick(this, () => {
            void this.authoringDialogs.requestTextInput(
                `${kind}CreatePathDialog`,
                "创建位置",
                "输入资源包内的相对路径",
                path,
                "确定",
                (value) => normalizeCreatedResourcePath(value)
                    ? null
                    : "路径必须位于当前资源包内，且不能包含 . 或 ..。",
            ).then((answer) => {
                const normalized = answer === null ? null : normalizeCreatedResourcePath(answer);
                if (!normalized) return;
                path = normalized;
                branch = "";
                renderPath();
            });
        });
        content.getChild("btnCancel").asButton.onClick(this, () => dialog.dispose());
        content.getChild("btnCreate").asButton.onClick(this, () => {
            const resourceName = name.title.trim();
            if (!resourceName || /[\\/:\0]/.test(resourceName)) {
                this.setStatus("Resource name cannot be empty or contain path separators.");
                return;
            }
            const png = decodeBase64Bytes(TRANSPARENT_PIXEL_PNG);
            const preparation = kind === "font"
                ? prepareImportBitmapFontResources(
                    this.liveSessionBridge.getWorkingProject(),
                    { packageId: selectedPackage.id },
                    {
                        fileName: `${resourceName}.fnt`,
                        sourceBytes: new TextEncoder().encode(
                            `info face="${resourceName.replaceAll('"', "'")}" size=16 bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=0,0\n`
                            + `common lineHeight=16 base=12 scaleW=1 scaleH=1 pages=1 packed=0\n`
                            + `page id=0 file="${resourceName}.png"\n`
                            + `chars count=1\n`
                            + `char id=32 x=0 y=0 width=1 height=1 xoffset=0 yoffset=0 xadvance=8 page=0 chnl=15\n`,
                        ),
                    },
                    { fileName: `${resourceName}.png`, sourceBytes: png },
                    { width: 1, height: 1 },
                )
                : prepareImportMovieClipResource(
                    this.liveSessionBridge.getWorkingProject(),
                    { packageId: selectedPackage.id },
                    [{
                        fileName: `${resourceName}.png`,
                        sourceBytes: png,
                        dimensions: { width: 1, height: 1 },
                        crop: { x: 0, y: 0, width: 1, height: 1 },
                        delay: 0,
                    }],
                    `${resourceName}.png`,
                    24,
                );
            if (preparation.ok) {
                for (const operation of preparation.transaction.operations || [preparation.transaction.operation]) {
                    if (operation.kind !== "addResource") continue;
                    const resource = operation.resource as { path?: string; branch?: string };
                    resource.path = path;
                    resource.branch = branch;
                }
            }
            void this.applyAuthoringPreparation(preparation).then((applied) => {
                if (!applied || !preparation.ok) return;
                const resource = (preparation.transaction.operations || [preparation.transaction.operation])
                    .filter((operation) => operation.kind === "addResource")
                    .map((operation) => operation.resource as { id?: string; kind?: string })
                    .find((candidate) => candidate.kind === kind);
                if (!resource?.id) return;
                this.applyLibrarySelection({ kind: "resource", packageId: selectedPackage.id, resourceId: resource.id });
                this.setDebugAttribute(`data-fairy-editor-${kind === "font" ? "bitmap-font" : "movieclip"}-create`, resource.id);
                dialog.dispose();
                if (kind === "font") this.authoringDialogs.showFontEditor();
                else this.authoringDialogs.showMovieClipEditor();
            });
        });
        dialog.contentPane = content;
        dialog.show();
        dialog.centerOn(fgui.GRoot.inst, true);
        this.setStatus(`Create a new ${kind === "font" ? "bitmap font" : "MovieClip"} resource.`);
    }

    async applyAuthoringAddBinaryResource(): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        if (!selectedPackage) {
            this.setStatus("Binary add skipped: no package selected.");
            return;
        }
        const fileInput = await this.pickAuthoringBinaryFile("add");
        if (!fileInput) return;
        await this.applyAuthoringPreparation(prepareAddBinaryResource(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id },
            fileInput,
        ));
    }

    async applyAuthoringReplaceBinaryResource(): Promise<void> {
        const resource = this.getSelectedResource();
        const selectedPackage = this.getSelectedPackage();
        if (!resource || !selectedPackage) {
            this.setStatus("Binary replace skipped: no resource selected.");
            return;
        }
        const fileInput = await this.pickAuthoringBinaryFile("replace");
        if (!fileInput) return;
        await this.applyAuthoringPreparation(prepareReplaceBinaryResource(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id, resourceId: resource.id },
            fileInput,
        ));
    }

    async applyAuthoringDuplicateAssetResource(): Promise<void> {
        const resource = this.getSelectedResource();
        const selectedPackage = this.getSelectedPackage();
        if (!resource || !selectedPackage) {
            this.setStatus("Asset duplicate skipped: no resource selected.");
            return;
        }
        await this.applyAuthoringPreparation(prepareDuplicateAssetResource(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id, resourceId: resource.id },
        ));
    }

    async applyAuthoringReplaceAssetBytes(): Promise<void> {
        const resource = this.getSelectedResource();
        const selectedPackage = this.getSelectedPackage();
        if (!resource || !selectedPackage) {
            this.setStatus("Asset byte replacement skipped: no resource selected.");
            return;
        }
        const fileInput = await this.pickAuthoringBinaryFile("replace");
        if (!fileInput) return;
        await this.applyAuthoringPreparation(prepareReplaceAssetBytes(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id, resourceId: resource.id },
            fileInput,
        ));
    }

    async pickAuthoringBinaryFile(action: "add" | "replace"): Promise<{
        fileName: string;
        sourceBytes: Uint8Array;
    } | null> {
        try {
            const file = await pickBrowserFile(
                "",
                `Binary ${action} file selection was cancelled.`,
                `binary-${action}`,
            );
            return {
                fileName: file.name,
                sourceBytes: new Uint8Array(await file.arrayBuffer()),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus(`Binary ${action} skipped: ${message}`);
            return null;
        }
    }

    requestAuthoringRemoveBinaryResource(): void {
        const resource = this.getSelectedResource();
        const selectedPackage = this.getSelectedPackage();
        if (!resource || !selectedPackage) {
            this.setStatus("Binary removal skipped: no resource selected.");
            return;
        }
        const preparation = prepareRemoveBinaryResource(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id, resourceId: resource.id },
        );
        const preparationIdentity = this.liveSessionBridge.captureSessionIdentity();
        if (preparation.ok === false) {
            this.setStatus(`Operation unavailable: ${preparation.code}. ${preparation.message}`);
            return;
        }
        this.authoringDialogs.showConfirmation(
            "authoringRemoveBinaryConfirmDialog",
            "Remove binary resource",
            `Remove ${resource.name || resource.id}? This change is undoable before Save.`,
            "Remove",
            "data-fairy-editor-transaction-remove-binary-confirmation",
            "Confirm binary resource removal.",
            "Binary removal cancelled.",
            () => void this.applyAuthoringPreparation(preparation, preparationIdentity),
        );
    }

    requestAuthoringRemoveAssetResource(): void {
        const resource = this.getSelectedResource();
        const selectedPackage = this.getSelectedPackage();
        if (!resource || !selectedPackage) {
            this.setStatus("Asset removal skipped: no resource selected.");
            return;
        }
        const preparation = prepareRemoveAssetResource(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id, resourceId: resource.id },
        );
        const preparationIdentity = this.liveSessionBridge.captureSessionIdentity();
        if (preparation.ok === false) {
            this.setStatus(`Operation unavailable: ${preparation.code}. ${preparation.message}`);
            return;
        }
        const removesUnusedTexture = (preparation.transaction.operations?.length || 1) > 1;
        this.authoringDialogs.showConfirmation(
            "authoringRemoveAssetConfirmDialog",
            "Remove editor-created asset",
            `Remove ${resource.name || resource.id}${removesUnusedTexture ? " and its unused imported texture" : ""}? This change is undoable before Save.`,
            "Remove",
            "data-fairy-editor-transaction-remove-asset-confirmation",
            "Confirm editor-created asset removal.",
            "Asset removal cancelled.",
            () => void this.applyAuthoringPreparation(preparation, preparationIdentity),
        );
    }

    async applyAuthoringAddPackage(): Promise<void> {
        if (!this.options.isLiveSession()) {
            this.setStatus("Package creation requires the connected browser live session.");
            return;
        }
        await this.applyAuthoringPreparation(prepareAddPackage(
            this.liveSessionBridge.getWorkingProject(),
        ));
    }

    async applyAuthoringAddComponent(): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        if (!selectedPackage) {
            this.setStatus("Component creation skipped: select a target package first.");
            return;
        }
        if (!this.options.isLiveSession()) {
            this.setStatus("Component creation requires the connected browser live session.");
            return;
        }
        await this.applyAuthoringPreparation(prepareAddComponent(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id },
        ));
    }

    async applyAuthoringPackageRename(): Promise<void> {
        const selectedPackage = this.getSelectedPackage();
        if (!selectedPackage) {
            this.setStatus("Package rename skipped: no package selected.");
            return;
        }
        const name = await this.authoringDialogs.requestTextInput(
            "desktopRenamePackageDialog",
            "重命名资源包",
            "请输入新的资源包名称。",
            selectedPackage.name,
            "重命名",
            (value) => value.trim() ? null : "资源包名称不能为空。",
        );
        if (name === null) return;
        await this.applyAuthoringPreparation(prepareRenamePackage(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id },
            name,
        ));
    }

    requestAuthoringRemovePackage(): void {
        const selectedPackage = this.getSelectedPackage();
        if (!selectedPackage) {
            this.setStatus("Package removal skipped: no package selected.");
            return;
        }
        const preparation = prepareRemovePackage(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id },
        );
        const preparationIdentity = this.liveSessionBridge.captureSessionIdentity();
        if (preparation.ok === false) {
            this.setStatus(`Operation unavailable: ${preparation.code}. ${preparation.message}`);
            return;
        }
        const referenceCount = preparation.transaction.operations?.filter(
            (operation) => operation.kind === "detachDisplayNode",
        ).length || 0;
        this.authoringDialogs.showConfirmation(
            "authoringRemovePackageConfirmDialog",
            "Remove package",
            `Remove ${selectedPackage.name} (${selectedPackage.resources.length} resources)?`
                + ` Detach ${referenceCount} external component object${referenceCount === 1 ? "" : "s"}; all package contents are deleted together.`
                + " Undo remains available after Save.",
            "Remove",
            "data-fairy-editor-transaction-remove-package-confirmation",
            "Confirm package removal.",
            "Package removal cancelled.",
            () => void this.applyAuthoringPreparation(preparation, preparationIdentity),
        );
    }

    async requestAuthoringMoveComponent(): Promise<void> {
        const selector = this.getSelectedComponentSelector();
        if (!selector) {
            this.setStatus("Component move skipped: no component selected.");
            return;
        }
        const packages = this.options.getPackages().filter((entry) => entry.id !== selector.packageId);
        const targetPackageId = await this.authoringDialogs.requestPackage("移动组件到资源包", packages);
        if (!targetPackageId) return;
        const preparation = prepareMoveComponent(
            this.liveSessionBridge.getWorkingProject(),
            selector,
            targetPackageId,
        );
        const preparationIdentity = this.liveSessionBridge.captureSessionIdentity();
        if (preparation.ok === false) {
            this.setStatus(`Operation unavailable: ${preparation.code}. ${preparation.message}`);
            return;
        }
        const operations = preparation.transaction.operations || [];
        const assetDependencyCount = operations.filter((operation) =>
            operation.kind === "addResource" && operation.opId.includes("-copy-component-dependency-"),
        ).length;
        const componentDependencyCount = operations.filter((operation) =>
            operation.kind === "addComponent" && operation.opId.includes("-copy-component-dependency-"),
        ).length;
        const dependencyCount = assetDependencyCount + componentDependencyCount;
        const dependencyReferenceCount = operations.filter((operation) =>
            operation.kind === "attachDisplayNode" && operation.opId.includes("-attach-component-dependency-"),
        ).length;
        const snapshotRewrite = operations.some((operation) =>
            operation.kind === "addComponent" && operation.opId.includes("-add-component-for-snapshot-move-"),
        );
        const rewriteCount = operations.filter((operation) =>
            operation.kind === "attachDisplayNode" && operation.opId.includes("-attach-component-reference-"),
        ).length;
        const componentName = this.getSelectedComponent()?.name || selector.componentResourceId;
        this.authoringDialogs.showConfirmation(
            "authoringMoveComponentConfirmDialog",
            "Move component",
            `Move ${componentName} to ${targetPackageId}?`
                + `${dependencyCount ? ` Copy ${dependencyCount} source dependenc${dependencyCount === 1 ? "y" : "ies"} (${componentDependencyCount} component${componentDependencyCount === 1 ? "" : "s"}, ${assetDependencyCount} asset${assetDependencyCount === 1 ? "" : "s"})${snapshotRewrite ? " and rewrite the moved component snapshot." : ` and rewrite ${dependencyReferenceCount} moved-component reference${dependencyReferenceCount === 1 ? "" : "s"}.`}` : ""}`
                + `${snapshotRewrite && !dependencyCount ? " Rewrite the moved component snapshot." : ""}`
                + `${rewriteCount ? ` Retarget ${rewriteCount} incoming component reference${rewriteCount === 1 ? "" : "s"}.` : ""}`
                + " This change is undoable before Save.",
            "Move",
            "data-fairy-editor-transaction-move-component-confirmation",
            "Confirm component move.",
            "Component move cancelled.",
            () => void this.applyAuthoringPreparation(preparation, preparationIdentity),
        );
    }

    async applyAuthoringResourceMove(): Promise<void> {
        const resource = this.getSelectedResource();
        const selectedPackage = this.getSelectedPackage();
        if (!resource || !selectedPackage) {
            this.setStatus("Move skipped: no resource selected.");
            return;
        }
        const path = await this.authoringDialogs.requestTextInput(
            "desktopMoveResourceDialog",
            "移动资源",
            "请输入资源包内的目标目录，例如 /images/。",
            resource.path || "/",
            "移动",
        );
        if (path === null) return;
        await this.applyAuthoringPreparation(prepareResourceMove(
            this.liveSessionBridge.getWorkingProject(),
            { packageId: selectedPackage.id, resourceId: resource.id },
            path,
        ));
    }

    showResourceMenu(anchor: fgui.GObject | null = null): void {
        const menu = this.createActionMenu();
        const templateEnabled = this.options.isLiveSession()
            && Boolean(this.getSelectedPackage());
        const addFolder = this.addMenuItem(menu, "desktopMenuAddResourceFolder", "Create Folder...", () => {
            void this.addResourceFolder();
        });
        this.setActionEnabled(addFolder, templateEnabled);
        const selectedFolder = this.getSelectedResourceFolder();
        if (selectedFolder) {
            this.addMenuItem(menu, "desktopMenuResourceFolderProperties", "Folder Properties...", () => {
                this.showResourceFolderPropertiesEditor();
            });
            this.addMenuItem(menu, "desktopMenuRenameResourceFolder", "Rename Folder...", () => {
                void this.renameSelectedResourceFolder();
            });
            this.addMenuItem(menu, "desktopMenuMoveResourceFolder", "Move Folder...", () => {
                void this.moveSelectedResourceFolder();
            });
            this.addMenuItem(menu, "desktopMenuRemoveResourceFolder", "Remove Empty Folder", () => {
                this.removeSelectedResourceFolder();
            });
            this.addMenuItem(
                menu,
                "desktopMenuFavoriteResourceFolder",
                selectedFolder.favorite ? "取消收藏文件夹" : "收藏文件夹",
                () => { void this.applyResourceFolderFavoriteToggle(); },
            );
        }
        const selectedResource = this.getSelectedResource();
        const selectedPackage = this.getSelectedPackage();
        const selectedComponent = selectedResource?.type === "Component" ? this.getSelectedComponent() : null;
        if (selectedResource) {
            menu.addSeperator();
            const editable = ["ImageResource", "SoundResource", "FontResource", "MovieClipResource", "Component"]
                .includes(selectedResource.type);
            const rename = this.addMenuItem(menu, "desktopMenuRenameResource", "重命名资源…", () => {
                void this.applyAuthoringResourceRename();
            });
            const move = this.addMenuItem(menu, "desktopMenuMoveResource", "移动资源…", () => {
                void this.applyAuthoringResourceMove();
            });
            this.setActionEnabled(rename, editable && this.options.isLiveSession());
            this.setActionEnabled(move, editable && this.options.isLiveSession());
            if (selectedResource.type === "MiscResource") {
                this.addMenuItem(menu, "desktopMenuReplaceBinaryResource", "替换文件…", () => {
                    void this.applyAuthoringReplaceBinaryResource();
                });
                this.addMenuItem(menu, "desktopMenuRemoveBinaryResource", "删除资源", () => {
                    this.requestAuthoringRemoveBinaryResource();
                });
            } else if (["ImageResource", "SoundResource", "FontResource", "MovieClipResource"].includes(selectedResource.type)) {
                this.addMenuItem(menu, "desktopMenuDuplicateAssetResource", "创建副本", () => {
                    void this.applyAuthoringDuplicateAssetResource();
                });
                if (selectedResource.type === "ImageResource") {
                    this.addMenuItem(menu, "desktopMenuEditImageResource", "编辑图片…", () => this.authoringDialogs.showImageEditor());
                    if (this.options.getSelectedLibraryResourceSelectors().length > 1) {
                        this.addMenuItem(menu, "desktopMenuEditImages", "批量修改图片属性…", () => this.showMultiImagePropertiesEditor());
                    }
                } else if (selectedResource.type === "MovieClipResource") {
                    this.addMenuItem(menu, "desktopMenuEditMovieClipResource", "编辑动画…", () => this.authoringDialogs.showMovieClipEditor());
                } else if (selectedResource.type === "FontResource") {
                    this.addMenuItem(menu, "desktopMenuEditFontResource", "编辑位图字体…", () => this.authoringDialogs.showFontEditor());
                } else {
                    this.addMenuItem(menu, "desktopMenuReplaceAssetResource", "替换文件…", () => {
                        void this.applyAuthoringReplaceAssetBytes();
                    });
                }
                this.addMenuItem(menu, "desktopMenuRemoveAssetResource", "删除资源", () => {
                    this.requestAuthoringRemoveAssetResource();
                });
            }
            this.addMenuItem(
                menu,
                "desktopMenuFavoriteResource",
                selectedResource.favorite ? "取消收藏" : "收藏",
                () => { void this.applyResourceFavoriteToggle(); },
            );
            this.addMenuItem(
                menu,
                "desktopMenuExportResource",
                selectedResource.exported ? "取消导出" : "设为导出",
                () => { void this.applyResourceExportedToggle(); },
            );
            this.addMenuItem(menu, "desktopMenuFindReferences", "查找引用…", () => {
                this.showProjectReferencesForCurrentSelection();
            });
        }
        if (selectedComponent) {
            menu.addSeperator();
            this.addMenuItem(menu, "desktopMenuComponentProperties", "组件属性…", () => {
                this.authoringDialogs.showComponentProperties();
            });
            this.addMenuItem(menu, "desktopMenuComponentCustomProperties", "自定义属性…", () => {
                this.authoringDialogs.showComponentCustomPropertyDefinitions();
            });
            this.addMenuItem(menu, "desktopMenuComponentExtensionProperties", "扩展属性…", () => {
                this.authoringDialogs.showComponentExtensionProperties();
            });
            this.addMenuItem(menu, "desktopMenuMoveComponent", "移动组件到资源包…", () => {
                void this.requestAuthoringMoveComponent();
            });
            this.addMenuItem(menu, "desktopMenuRemoveComponent", "删除组件", () => {
                this.options.removeSelectedComponent();
            });
        } else if (selectedPackage && !selectedResource && !selectedFolder) {
            menu.addSeperator();
            this.addMenuItem(menu, "desktopMenuRenamePackage", "重命名资源包…", () => {
                void this.applyAuthoringPackageRename();
            });
            this.addMenuItem(menu, "desktopMenuRemovePackage", "删除资源包", () => {
                this.requestAuthoringRemovePackage();
            });
        }
        const selectedResources = this.getSelectedLibraryResourceSelectors();
        if (selectedResources.length > 1) {
            this.addMenuItem(menu, "desktopMenuMoveSelectedResources", `Move ${selectedResources.length} Selected...`, () => {
                void this.moveSelectedResources(selectedResources);
            });
            this.addMenuItem(menu, "desktopMenuDuplicateSelectedResources", `Duplicate ${selectedResources.length} Selected`, () => {
                void this.duplicateSelectedResources(selectedResources);
            });
            this.addMenuItem(menu, "desktopMenuRemoveSelectedResources", `Remove ${selectedResources.length} Selected`, () => {
                this.removeSelectedResources(selectedResources);
            });
        }
        menu.addSeperator();
        for (const [name, title, kind] of [
            ["desktopMenuCreateComboBox", "Create ComboBox...", "comboBox"],
            ["desktopMenuCreateProgressBar", "Create ProgressBar...", "progressBar"],
            ["desktopMenuCreateSlider", "Create Slider...", "slider"],
            ["desktopMenuCreateScrollBar", "Create ScrollBar...", "scrollBar"],
            ["desktopMenuCreateWindowFrame", "Create Window Frame...", "windowFrame"],
            ["desktopMenuCreatePopupMenu", "Create Popup Menu...", "popupMenu"],
        ] as const) {
            const item = this.addMenuItem(menu, name, title, () => this.authoringDialogs.showComponentTemplate(kind));
            this.setActionEnabled(item, templateEnabled);
        }
        menu.addSeperator();
        const createMovieClip = this.addMenuItem(menu, "desktopMenuCreateMovieClip", "新建动画...", () => {
            this.showCreateMovieClipDialog();
        });
        const createBitmapFont = this.addMenuItem(menu, "desktopMenuCreateBitmapFont", "新建位图字体...", () => {
            this.showCreateBitmapFontDialog();
        });
        this.setActionEnabled(createMovieClip, templateEnabled);
        this.setActionEnabled(createBitmapFont, templateEnabled);
        const importImage = this.addMenuItem(menu, "desktopMenuImportImage", "导入图片...", () => {
            void this.importImageResource();
        });
        this.setActionEnabled(
            importImage,
            this.options.isLiveSession() && Boolean(this.getSelectedPackage()),
        );
        const importBinary = this.addMenuItem(menu, "desktopMenuImportBinary", "导入其他文件...", () => {
            void this.applyAuthoringAddBinaryResource();
        });
        this.setActionEnabled(
            importBinary,
            this.options.isLiveSession() && Boolean(this.getSelectedPackage()),
        );
        const importMovieClip = this.addMenuItem(
            menu,
            "desktopMenuImportMovieClip",
            "Import MovieClip Frames...",
            () => {
                void this.importMovieClipResource();
            },
        );
        this.setActionEnabled(
            importMovieClip,
            this.options.isLiveSession() && Boolean(this.getSelectedPackage()),
        );
        const importMovieClipSpriteSheet = this.addMenuItem(
            menu,
            "desktopMenuImportMovieClipSpriteSheet",
            "Import MovieClip Sprite Sheet...",
            () => {
                void this.importMovieClipSpriteSheetResource();
            },
        );
        this.setActionEnabled(
            importMovieClipSpriteSheet,
            this.options.isLiveSession() && Boolean(this.getSelectedPackage()),
        );
        const importSound = this.addMenuItem(menu, "desktopMenuImportSound", "导入声音...", () => {
            void this.importSoundResource();
        });
        this.setActionEnabled(
            importSound,
            this.options.isLiveSession() && Boolean(this.getSelectedPackage()),
        );
        const importBitmapFont = this.addMenuItem(
            menu,
            "desktopMenuImportBitmapFont",
            "Import Bitmap Font...",
            () => {
                void this.importBitmapFontResource();
            },
        );
        this.setActionEnabled(
            importBitmapFont,
            this.options.isLiveSession() && Boolean(this.getSelectedPackage()),
        );
        const transferActions = [
            "resource:importFairyPackage",
            "resource:importFairyPackageResources",
            "resource:exportFairyPackage",
            "resource:exportFairyPackageResources",
        ] as const;
        if (transferActions.some((action) => this.options.hasEditorAction(action))) {
            menu.addSeperator();
        }
        if (this.options.hasEditorAction("resource:importFairyPackage")) {
            const item = this.addMenuItem(menu, "desktopMenuImportFairyPackage", "Import FairyGUI Package...", () => {
                this.runEditorAction("resource:importFairyPackage");
            });
            this.setActionEnabled(item, this.options.isLiveSession());
        }
        if (this.options.hasEditorAction("resource:importFairyPackageResources")) {
            const item = this.addMenuItem(
                menu,
                "desktopMenuImportFairyPackageResources",
                "Import Resources into Existing Package...",
                () => this.runEditorAction("resource:importFairyPackageResources"),
            );
            this.setActionEnabled(item, this.options.isLiveSession());
        }
        if (this.options.hasEditorAction("resource:exportFairyPackage")) {
            const item = this.addMenuItem(menu, "desktopMenuExportFairyPackage", "Export Selected Package...", () => {
                this.runEditorAction("resource:exportFairyPackage");
            });
            this.setActionEnabled(item, this.options.isLiveSession() && Boolean(this.libraryPackageId));
        }
        if (this.options.hasEditorAction("resource:exportFairyPackageResources")) {
            const item = this.addMenuItem(
                menu,
                "desktopMenuExportSelectedFairyPackageResources",
                "Export Selected Resources...",
                () => this.runEditorAction("resource:exportFairyPackageResources"),
            );
            this.setActionEnabled(
                item,
                this.options.isLiveSession()
                    && selectedResources.length > 0
                    && selectedResources.every((selector) => selector.packageId === selectedResources[0].packageId),
            );
        }
        this.addMenuItem(menu, "desktopMenuResourceImportHistory", "导入历史与失败重试…", () => {
            this.showImportHistoryMenu(anchor);
        });
        menu.addSeperator();
        const inspect = this.addMenuItem(menu, "desktopMenuInspectResource", "显示资源属性", () => {
            this.showSelectedResourceInspector();
        });
        this.setActionEnabled(inspect, Boolean(selectedResource));
        if (this.options.hasEditorAction("workspace:importProject")) {
            this.addMenuItem(menu, "desktopMenuImportProject", "导入项目...", () => {
                this.runEditorAction("workspace:importProject");
            });
        }

        this.showActionMenu(menu, anchor, "resource", "Resource menu opened.");
    }

    async addResourceFolder(): Promise<void> {
        const pkg = this.getSelectedPackage();
        if (!pkg) return;
        const path = await this.authoringDialogs.requestTextInput(
            "desktopAddResourceFolderDialog",
            "Create resource folder",
            "Folder path",
            "/NewFolder/",
            "Create",
        );
        if (path === null) return;
        const preparation = prepareAddResourceFolder(
            this.liveSessionBridge.getWorkingProject(),
            pkg.id,
            path,
        );
        if (!await this.applyAuthoringPreparation(preparation)) return;
        if (preparation.ok) {
            const operation = preparation.transaction.operation;
            if (operation.kind === "addResourceFolder") {
                this.applyLibrarySelection({
                    kind: "folder",
                    packageId: pkg.id,
                    branch: operation.branch || "",
                    path: operation.path,
                });
            }
        }
    }

    async renameSelectedResourceFolder(): Promise<void> {
        const selected = this.selectedResourceFolder;
        const folder = this.getSelectedResourceFolder();
        if (!selected || !folder) return;
        const currentName = folder.path.split("/").filter(Boolean).pop() || "";
        const newName = await this.authoringDialogs.requestTextInput(
            "desktopRenameResourceFolderDialog",
            "Rename resource folder",
            folder.path,
            currentName,
            "Rename",
        );
        if (newName === null) return;
        const preparation = prepareRenameResourceFolder(
            this.liveSessionBridge.getWorkingProject(),
            selected,
            newName,
        );
        if (!await this.applyAuthoringPreparation(preparation) || !preparation.ok) return;
        const operation = preparation.transaction.operation;
        if (operation.kind !== "renameResourceFolder") return;
        const parent = selected.path.split("/").filter(Boolean).slice(0, -1);
        this.selectedResourceFolder = {
            ...selected,
            path: `/${[...parent, operation.newName].join("/")}/`,
        };
        this.refreshProjectViews();
    }

    async moveSelectedResourceFolder(): Promise<void> {
        const selected = this.selectedResourceFolder;
        if (!selected || !this.getSelectedResourceFolder()) return;
        const currentParent = `/${selected.path.split("/").filter(Boolean).slice(0, -1).join("/")}/`.replace("//", "/");
        const toPath = await this.authoringDialogs.requestTextInput(
            "desktopMoveResourceFolderDialog",
            "Move resource folder",
            "Destination parent folder path",
            currentParent,
            "Move",
        );
        if (toPath === null) return;
        const preparation = prepareMoveResourceFolder(
            this.liveSessionBridge.getWorkingProject(),
            selected,
            toPath,
        );
        if (!await this.applyAuthoringPreparation(preparation) || !preparation.ok) return;
        const operation = preparation.transaction.operation;
        if (operation.kind !== "moveResourceFolder") return;
        const name = selected.path.split("/").filter(Boolean).pop() || "";
        this.selectedResourceFolder = { ...selected, path: `${operation.toPath}${name}/` };
        this.refreshProjectViews();
    }

    removeSelectedResourceFolder(): void {
        const selected = this.selectedResourceFolder;
        const folder = this.getSelectedResourceFolder();
        if (!selected || !folder) return;
        const preparation = prepareRemoveResourceFolder(
            this.liveSessionBridge.getWorkingProject(),
            selected,
        );
        const preparationIdentity = this.liveSessionBridge.captureSessionIdentity();
        if (preparation.ok === false) {
            this.setStatus(`Resource folder removal unavailable: ${preparation.code}. ${preparation.message}`);
            return;
        }
        this.authoringDialogs.showConfirmation(
            "desktopRemoveResourceFolderConfirmDialog",
            "Remove empty folder",
            `Remove ${folder.path}?`,
            "Remove",
            "data-fairy-editor-resource-folder-remove-confirmation",
            "Confirm empty resource folder removal.",
            "Resource folder removal cancelled.",
            () => void this.applyAuthoringPreparation(preparation, preparationIdentity).then((applied) => {
                if (!applied) return;
                this.selectedResourceFolder = null;
                this.refreshProjectViews();
            }),
        );
    }

    repairResourceHealthIssue(issue: ResourceHealthIssue, entries: ResourceHealthEntry[]): void {
        const project = this.liveSessionBridge.getWorkingProject();
        const preparation = issue.repair === "remove"
            ? prepareRemoveResources(project, entries)
            : issue.repair === "rename"
                ? this.prepareResourceHealthConflictRename(project, entries)
                : null;
        const preparationIdentity = this.liveSessionBridge.captureSessionIdentity();
        if (!preparation) {
            this.setStatus("该资源健康问题仅供查看，暂无安全的自动修复方式。");
            return;
        }
        if (preparation.ok === false) {
            this.setStatus(`资源健康修复不可用：${preparation.code}。${preparation.message}`);
            return;
        }
        this.authoringDialogs.showConfirmation(
            "resourceHealthRepairDialog",
            "资源健康修复",
            `${preparation.transaction.summary}\n\n已明确选择 ${entries.length} 项资源，本次操作将作为一个原子历史记录提交。`,
            issue.repair === "remove" ? "删除" : "重命名",
            "data-fairy-editor-resource-health-repair",
            "请确认资源健康修复操作。",
            "已取消资源健康修复。",
            () => void this.applyAuthoringPreparation(preparation, preparationIdentity),
        );
    }

    private prepareResourceHealthConflictRename(
        projectValue: unknown,
        entries: ResourceHealthEntry[],
    ): HighRiskTransactionPreparation {
        const project = projectValue as {
            packages?: Array<{
                id?: string;
                resources?: Array<{ id?: string; name?: string; path?: string; branch?: string }>;
            }>;
        } | null;
        const used = new Set<string>();
        for (const pkg of project?.packages || []) {
            for (const resource of pkg.resources || []) {
                used.add([
                    pkg.id || "",
                    resource.branch || "",
                    resource.path || "/",
                    String(resource.name || resource.id || "").toLocaleLowerCase(),
                ].join("\0"));
            }
        }
        const preparations = entries.map((entry) => {
            let suffix = 2;
            let name = `${entry.name}_${suffix}`;
            let key = [entry.packageId, entry.branch, entry.path, name.toLocaleLowerCase()].join("\0");
            while (used.has(key)) {
                suffix += 1;
                name = `${entry.name}_${suffix}`;
                key = [entry.packageId, entry.branch, entry.path, name.toLocaleLowerCase()].join("\0");
            }
            used.add(key);
            return prepareResourceRename(projectValue, entry, name);
        });
        return this.combineResourcePreparations(
            `Rename ${entries.length} conflicting resources`,
            preparations,
        );
    }

    combineResourcePreparations(
        summary: string,
        preparations: HighRiskTransactionPreparation[],
    ): HighRiskTransactionPreparation {
        const failure = preparations.find((preparation) => preparation.ok === false);
        if (failure?.ok === false) return failure;
        const transactions = preparations.flatMap((preparation) => preparation.ok ? [preparation.transaction] : []);
        const operations = transactions.flatMap((transaction) => transaction.operations || [transaction.operation]);
        const inverseOperations = transactions.slice().reverse().flatMap(
            (transaction) => transaction.inverseOperations || [transaction.inverseOperation],
        );
        if (operations.length === 0 || inverseOperations.length === 0) {
            return { ok: false, code: "resource_selection_empty", message: "Select at least one resource." };
        }
        return {
            ok: true,
            transaction: {
                summary,
                operation: operations[0] as EditorHighRiskTransaction["operation"],
                inverseOperation: inverseOperations[0],
                operations,
                inverseOperations,
            },
        };
    }

    async moveSelectedResources(selectors: EditorResourceSelector[]): Promise<void> {
        const path = await this.authoringDialogs.requestTextInput(
            "desktopMoveResourcesDialog",
            "Move resources",
            "Destination resource path",
            "/",
            "Move",
        );
        if (path === null) return;
        await this.applyAuthoringPreparation(this.combineResourcePreparations(
            `Move ${selectors.length} resources to ${path}`,
            selectors.map((selector) => prepareResourceMove(
                this.liveSessionBridge.getWorkingProject(),
                selector,
                path,
            )),
        ));
    }

    async duplicateSelectedResources(selectors: EditorResourceSelector[]): Promise<void> {
        await this.applyAuthoringPreparation(prepareDuplicateResources(
            this.liveSessionBridge.getWorkingProject(),
            selectors,
        ));
    }

    removeSelectedResources(selectors: EditorResourceSelector[]): void {
        const preparation = prepareRemoveResources(
            this.liveSessionBridge.getWorkingProject(),
            selectors,
        );
        const preparationIdentity = this.liveSessionBridge.captureSessionIdentity();
        if (preparation.ok === false) {
            this.setStatus(`Batch removal unavailable: ${preparation.code}. ${preparation.message}`);
            return;
        }
        this.authoringDialogs.showConfirmation(
            "desktopRemoveSelectedResourcesConfirmDialog",
            "Remove selected resources",
            `Remove ${selectors.length} selected resources? The batch is atomic and undoable.`,
            "Remove",
            "data-fairy-editor-resource-batch-remove-confirmation",
            "Confirm selected resource removal.",
            "Selected resource removal cancelled.",
            () => void this.applyAuthoringPreparation(preparation, preparationIdentity),
        );
    }
}
