import { BrowserProjectImport, type BrowserProjectImportResult } from "../services/BrowserProjectImport";
import { createLocalProject, isFilePickerCancelled, pickLocalDirectory, validateLocalProjectName } from "../services/BrowserFileSystemAccess";
import { addInspectorLine, setActionEnabled } from "../ui/EditorFormControls";

export function showCreateLocalProjectDialog(context: {
    canCreate(): boolean;
    openProject(project: BrowserProjectImportResult): Promise<boolean>;
    setStatus(message: string): void;
    setActiveDialog(dialog: fgui.Window | null): void;
}): fgui.Window {
    const dialog = new fgui.Window();
    dialog.name = "createLocalProjectDialog";
    dialog.modal = true;
    const content = fgui.UIPackage.createObject("Builder", "CreateProjectDialog").asCom;
    dialog.contentPane = content;
    const name = content.getChild("name").asCom.getChild("title").asTextInput;
    name.text = "NewProject";
    const path = content.getChild("path").asCom.getChild("title").asTextInput;
    path.editable = false;
    path.text = "请选择并授权本地目录";
    const type = content.getChild("type").asComboBox;
    type.items = ["LayaAir"];
    type.values = ["Layabox"];
    type.selectedIndex = 0;
    const subfolder = content.getChild("shouldCreateSubFolder").asButton;
    subfolder.selected = true;
    const status = addInspectorLine(content, "localProjectStatus", "点击“浏览”选择目录，并允许浏览器读写。", 24, 158, 452, "#bdbdbd");
    status.singleLine = false;
    status.autoSize = fgui.AutoSizeType.None;
    status.setSize(452, 65);
    const browse = content.getChild("btnBrowse").asButton;
    const ok = content.getChild("ok").asButton;
    const cancel = content.getChild("cancel").asButton;
    let directory: FileSystemDirectoryHandle | undefined;
    let closed = false;
    let busy = false;
    setActionEnabled(ok, false);
    const close = (): void => {
        if (busy) return;
        closed = true;
        dialog.dispose();
        context.setActiveDialog(null);
    };
    browse.onClick(dialog, async () => {
        if (busy) return;
        setActionEnabled(browse, false);
        try {
            // Start the native picker before any async work to retain user activation.
            const selected = await pickLocalDirectory();
            if (closed) return;
            directory = selected;
            path.text = selected.name;
            status.text = "已授权目录。创建时写入 .fairy 工程；已有文件的目录不会被覆盖。";
            setActionEnabled(ok, true);
        } catch (error) {
            if (!closed && !isFilePickerCancelled(error)) status.text = error instanceof Error ? error.message : String(error);
        } finally {
            if (!closed) setActionEnabled(browse, true);
        }
    });
    ok.onClick(dialog, async () => {
        if (!directory || busy || !context.canCreate()) return;
        busy = true;
        for (const button of [ok, cancel, browse]) setActionEnabled(button, false);
        name.editable = false;
        subfolder.touchable = false;
        try {
            const projectName = validateLocalProjectName(name.text);
            status.text = "正在创建项目…";
            const projectDirectory = await createLocalProject(directory, projectName, subfolder.selected);
            const picked = await new BrowserProjectImport().readDirectoryProject(projectDirectory);
            if (await context.openProject(picked)) {
                busy = false;
                close();
                return;
            }
            status.text = "工程文件已创建，打开失败。可通过“打开文件夹”重试，详情见状态栏。";
            directory = undefined;
        } catch (error) {
            status.text = error instanceof Error ? error.message : String(error);
            context.setStatus(status.text);
        } finally {
            busy = false;
            if (!closed) {
                setActionEnabled(ok, !!directory);
                setActionEnabled(cancel, true);
                setActionEnabled(browse, true);
                name.editable = true;
                subfolder.touchable = true;
            }
        }
    });
    cancel.onClick(dialog, close);
    dialog.on(Laya.Event.UNDISPLAY, dialog, () => { closed = true; });
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    return dialog;
}
