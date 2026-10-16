import type { BrowserProjectImportResult } from "../services/BrowserProjectImport";
import { createInspectorButton, setOverflowText } from "../ui/EditorFormControls";

type ProjectImportDialogCallbacks = {
    applyImport: (picked: BrowserProjectImportResult, label: string) => Promise<boolean>;
    onError: (label: string, error: unknown) => void;
    pickDirectory: () => Promise<BrowserProjectImportResult>;
    pickZip: () => Promise<BrowserProjectImportResult>;
    setDebugAttribute: (name: string, value: string) => void;
    setStatus: (message: string) => void;
    showWorkspace: () => void;
};

export class ProjectImportDialog {
    private host: fgui.GComponent | null = null;
    private pending: BrowserProjectImportResult | null = null;
    private interactionToken = 0;
    private importing = false;

    constructor(
        private readonly mainView: fgui.GComponent,
        private readonly callbacks: ProjectImportDialogCallbacks,
    ) {}

    show(): void {
        this.ensureOpen();
        this.pending = null;
        this.layout();
        this.render(
            "请选择 FairyGUI 工程文件夹或 ZIP。导入前会先预览，确认后才替换浏览器工作区。",
        );
    }

    close(): void {
        if (this.importing) return;
        this.interactionToken += 1;
        if (!this.host) return;
        if (this.host.parent) {
            this.host.parent.removeChild(this.host, true);
        } else {
            this.host.dispose();
        }
        this.host = null;
        this.pending = null;
        this.callbacks.setDebugAttribute("data-fairy-editor-workspace-import-dialog", "closed");
        this.callbacks.setDebugAttribute("data-fairy-editor-workspace-pending-import", "false");
    }

    layout(): void {
        if (!this.host) return;
        const rootWidth = Math.max(720, this.mainView.width || Laya.stage.width || 720);
        const rootHeight = Math.max(420, this.mainView.height || Laya.stage.height || 420);
        this.host.setXY(0, 0);
        this.host.setSize(rootWidth, rootHeight);
        this.host.getChild("projectImportScrim")?.setSize(rootWidth, rootHeight);
        const dialog = this.getContent();
        dialog?.setXY(
            Math.round((rootWidth - dialog.width) / 2),
            Math.round((rootHeight - dialog.height) / 2),
        );
    }

    pickDirectory(): void {
        void this.pick(
            "Folder",
            "等待选择 FairyGUI 工程文件夹...",
            "Project folder import waiting for selection.",
            "Folder import ready for confirmation.",
            "Project folder selected. Confirm import to replace the current workspace.",
            this.callbacks.pickDirectory(),
        );
    }

    pickZip(): void {
        void this.pick(
            "ZIP",
            "等待选择 FairyGUI 工程 ZIP...",
            "Project ZIP import waiting for selection.",
            "ZIP import ready for confirmation.",
            "Project ZIP selected. Confirm import to replace the current workspace.",
            this.callbacks.pickZip(),
        );
    }

    private ensureOpen(): void {
        if (this.host) return;
        const host = new fgui.GComponent();
        host.name = "projectImportDialogHost";
        host.opaque = true;
        host.touchable = true;

        const scrim = new fgui.GGraph();
        scrim.name = "projectImportScrim";
        scrim.drawRect(0, "#000000", "rgba(0,0,0,0.45)");
        host.addChild(scrim);

        const dialog = fgui.UIPackage.createObject("Builder", "CreateProjectDialog").asCom;
        dialog.name = "projectImportDialog";
        host.addChild(dialog);
        this.configure(dialog);
        this.mainView.addChild(host);
        this.host = host;
    }

    private configure(dialog: fgui.GComponent): void {
        const frame = dialog.getChild("frame");
        if (frame) frame.asLabel.title = "导入 FairyGUI 项目";
        this.setText(dialog, "n15", "导入来源");
        this.setText(dialog, "n16", "项目文件");
        this.setText(dialog, "n20", "目标");
        this.setInput(dialog, "name", "未选择");
        this.setInput(dialog, "path", "-");
        dialog.getChild("path")?.setSize(244, 20);

        const folderButton = dialog.getChild("btnBrowse").asButton;
        folderButton.title = "文件夹";
        folderButton.setXY(344, 58);
        folderButton.setSize(72, 25);
        folderButton.onClick(this, this.pickDirectory);

        const zipButton = createInspectorButton(
            dialog,
            "projectImportZip",
            "ZIP",
            424,
            58,
            64,
        );
        zipButton.onClick(this, this.pickZip);

        const replaceCheckbox = dialog.getChild("shouldCreateSubFolder").asButton;
        replaceCheckbox.title = "导入后替换当前工作区内容";
        replaceCheckbox.selected = true;
        replaceCheckbox.touchable = false;
        replaceCheckbox.setSize(360, 19);
        const targetSelector = dialog.getChild("type");
        if (targetSelector) targetSelector.visible = false;

        this.addLine(
            dialog,
            "projectImportTarget",
            "当前浏览器工作区",
            93,
            116,
            380,
            "#bdbdbd",
        );
        this.addLine(dialog, "projectImportPreview0", "项目：尚未选择", 92, 148, 396, "#ffffff");
        this.addLine(dialog, "projectImportPreview1", "工程文件：-", 92, 166, 396, "#bdbdbd");
        this.addLine(dialog, "projectImportPreview2", "内容：-", 92, 184, 396, "#bdbdbd");
        this.addLine(
            dialog,
            "projectImportPreview3",
            "导入前不会修改当前工作区。",
            92,
            202,
            396,
            "#8ccf7e",
        );

        const okButton = dialog.getChild("ok").asButton;
        okButton.name = "projectImportConfirm";
        okButton.title = "导入";
        okButton.onClick(this, this.confirm);
        const cancelButton = dialog.getChild("cancel").asButton;
        cancelButton.name = "projectImportCancel";
        cancelButton.title = "取消";
        cancelButton.onClick(this, this.close);
    }

    private render(message: string): void {
        const dialog = this.getContent();
        if (!dialog) return;
        const pending = this.pending;
        this.setInput(
            dialog,
            "name",
            pending
                ? `${formatImportSource(pending.imported.source)}: ${pending.imported.sourceName}`
                : "未选择",
        );
        this.setInput(dialog, "path", pending ? pending.imported.fairyPath : "-");
        this.setText(
            dialog,
            "projectImportPreview0",
            pending ? `项目：${pending.imported.sourceName}` : message,
        );
        this.setText(
            dialog,
            "projectImportPreview1",
            pending ? `工程文件：${pending.imported.fairyPath}` : "工程文件：-",
        );
        this.setText(
            dialog,
            "projectImportPreview2",
            pending
                ? `内容：${pending.imported.fileCount} 个文件，${formatFileSize(pending.imported.totalBytes)}`
                : "内容：-",
        );
        this.setText(
            dialog,
            "projectImportPreview3",
            pending
                ? formatRuntimeBundlePreview(pending)
                : "选择后可核对项目文件、内容和保存方式。",
        );

        const confirmButton = dialog.getChild("projectImportConfirm").asButton;
        confirmButton.grayed = !pending;
        confirmButton.touchable = !!pending;
        this.callbacks.setDebugAttribute("data-fairy-editor-workspace-import-dialog", "open");
        this.callbacks.setDebugAttribute(
            "data-fairy-editor-workspace-pending-import",
            pending ? "true" : "false",
        );
        this.callbacks.setDebugAttribute(
            "data-fairy-editor-workspace-pending-import-source",
            pending?.imported.source || "",
        );
        this.callbacks.setDebugAttribute(
            "data-fairy-editor-workspace-pending-import-fairy",
            pending?.imported.fairyPath || "",
        );
        this.callbacks.setDebugAttribute(
            "data-fairy-editor-workspace-pending-import-files",
            pending ? String(pending.imported.fileCount) : "",
        );
        this.callbacks.setDebugAttribute(
            "data-fairy-editor-workspace-pending-runtime-bundle",
            pending?.files.some((file) => file.path === ".fairygui-runtime/manifest.json")
                ? "prepared"
                : pending ? "missing" : "",
        );
    }

    private async pick(
        label: string,
        waitingMessage: string,
        waitingStatus: string,
        readyMessage: string,
        readyStatus: string,
        picked: Promise<BrowserProjectImportResult>,
    ): Promise<void> {
        const token = ++this.interactionToken;
        try {
            this.ensureOpen();
            this.pending = null;
            this.render(waitingMessage);
            this.callbacks.setStatus(waitingStatus);
            const result = await picked;
            if (token !== this.interactionToken) return;
            this.pending = result;
            this.render(readyMessage);
            this.callbacks.setStatus(readyStatus);
        } catch (error) {
            this.pending = null;
            this.render(`选择失败：${error instanceof Error ? error.message : String(error)}`);
            this.callbacks.onError(label, error);
        }
    }

    private async confirm(): Promise<void> {
        if (!this.pending) {
            this.render("请先选择 FairyGUI 工程文件夹或 ZIP。");
            this.callbacks.setStatus("Project import requires a selected source.");
            return;
        }
        const pending = this.pending;
        this.importing = true;
        const dialog = this.getContent();
        const cancel = dialog?.getChild("projectImportCancel").asButton;
        if (cancel) {
            cancel.title = "导入中";
            cancel.grayed = true;
            cancel.touchable = false;
        }
        this.render(`正在导入 ${pending.imported.fileCount} 个文件...`);
        try {
            if (await this.callbacks.applyImport(pending, formatImportSource(pending.imported.source))) {
                this.callbacks.showWorkspace();
                this.importing = false;
                this.close();
            }
        } finally {
            this.importing = false;
            if (cancel && this.host) {
                cancel.title = "取消";
                cancel.grayed = false;
                cancel.touchable = true;
            }
        }
    }

    private getContent(): fgui.GComponent | null {
        const dialog = this.host?.getChild("projectImportDialog");
        return dialog ? dialog.asCom : null;
    }

    private addLine(
        dialog: fgui.GComponent,
        name: string,
        text: string,
        x: number,
        y: number,
        width: number,
        color: string,
    ): void {
        const line = new fgui.GTextField();
        line.name = name;
        line.fontSize = 12;
        line.color = color;
        line.setXY(x, y);
        line.setSize(width, 18);
        setOverflowText(line, text);
        dialog.addChild(line);
    }

    private setText(dialog: fgui.GComponent, childName: string, text: string): void {
        const child = dialog.getChild(childName);
        if (child) setOverflowText(child.asTextField, text);
    }

    private setInput(dialog: fgui.GComponent, childName: string, text: string): void {
        const child = dialog.getChild(childName);
        if (!child) return;
        const input = child.asCom.getChild("title").asTextInput;
        setOverflowText(input, text);
        child.tooltips = text;
        input.editable = false;
        input.color = "#bdbdbd";
    }
}

export function formatImportSource(
    source: BrowserProjectImportResult["imported"]["source"],
): string {
    return source === "zip" ? "ZIP" : "Folder";
}

export function formatRuntimeBundlePreview(pending: BrowserProjectImportResult): string {
    const runtimeFiles = pending.files.filter((file) => file.path.startsWith(".fairygui-runtime/"));
    const writeback = pending.directoryHandle
        ? "保存时可写回所选文件夹。"
        : "保存到浏览器后可导出 ZIP。";
    return runtimeFiles.some((file) => file.path === ".fairygui-runtime/manifest.json")
        ? `运行预览：已包含发布资源（${runtimeFiles.length} 个文件）；${writeback}`
        : `运行预览：保存并发布后可用；${writeback}`;
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
