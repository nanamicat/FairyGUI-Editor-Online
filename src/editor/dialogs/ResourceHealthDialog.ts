import type { EditorResourceSelector } from "../model/EditorCommand";
import {
    auditProjectResources,
    type ResourceHealthEntry,
    type ResourceHealthIssue,
} from "../runtime/ResourceHealthAudit";
import { createInspectorButton } from "../ui/EditorFormControls";

const ISSUE_KIND_LABELS: Record<ResourceHealthIssue["kind"], string> = {
    duplicate: "重复资源",
    unused: "未使用资源",
    conflict: "名称冲突",
};

const ISSUE_DETAILS: Record<ResourceHealthIssue["kind"], string> = {
    duplicate: "文件内容完全相同；在支持安全改写全部引用前仅提供查看。",
    unused: "未导出、非组件且没有入向引用；仅删除明确选择的资源。",
    conflict: "同一包、分支和路径下名称仅大小写不同；首个资源保留原名。",
};

export interface ResourceHealthDialogContext {
    getWorkingProject(): unknown;
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    countIncomingReferences(selector: EditorResourceSelector): number;
    locate(entry: ResourceHealthEntry): void;
    repair(issue: ResourceHealthIssue, entries: ResourceHealthEntry[]): void;
    setDebugAttribute(name: string, value: string): void;
    setStatus(message: string): void;
    eventOwner: object;
}

export function showResourceHealthDialog(context: ResourceHealthDialogContext): void {
    context.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopResourceHealthDialog";
    const content = fgui.UIPackage.createObject("Builder", "FindDuplicateResourceDialog").asCom;
    dialog.contentPane = content;
    content.getChild("frame").asLabel.title = "资源健康";
    const issueList = content.getChild("list1").asList;
    const entryList = content.getChild("list2").asList;
    issueList.selectionMode = fgui.ListSelectionMode.Single;
    entryList.selectionMode = fgui.ListSelectionMode.Multiple;
    const repair = content.getChild("merge").asButton;
    const locate = content.getChild("setMergeTarget").asButton;
    const result = content.getChild("result").asTextField;
    content.getChild("start").asButton.title = "重新扫描";
    content.getController("step").selectedIndex = 0;
    result.setSize(360, result.height);
    locate.title = "在资源库中定位";
    locate.enabled = false;
    repair.title = "仅查看，暂无安全修复";
    repair.enabled = false;
    for (const name of ["selectAll", "selectReverse", "selectNone"]) content.getChild(name).visible = false;
    const selectAll = createInspectorButton(content, "resourceHealthSelectAll", "全选", 262, 445, 70);
    const selectReverse = createInspectorButton(content, "resourceHealthSelectReverse", "反选", 338, 445, 70);
    const selectNone = createInspectorButton(content, "resourceHealthSelectNone", "清除", 414, 445, 70);
    let activeIssue: ResourceHealthIssue | null = null;
    let scanId = 0;

    const close = (): void => {
        dialog.dispose();
        if (context.getActiveDialog() === dialog) context.setActiveDialog(null);
    };
    const refreshActions = (): void => {
        const selected = entryList.getSelection([]);
        locate.enabled = selected.length === 1;
        repair.enabled = Boolean(activeIssue?.repair && selected.length > 0);
        repair.title = activeIssue?.repair === "remove"
            ? "删除选中的未使用资源"
            : activeIssue?.repair === "rename"
                ? "重命名选中的冲突资源"
                : "仅查看，暂无安全修复";
    };
    const renderIssue = (itemObject: fgui.GObject): void => {
        activeIssue = itemObject.data as ResourceHealthIssue | null;
        entryList.removeChildrenToPool();
        for (const entry of activeIssue?.entries || []) {
            const item = entryList.addItemFromPool().asButton;
            item.title = `${entry.name} · ${entry.packageName}${entry.path} · ${entry.resourceKind} · ${entry.incomingReferences} 个引用`;
            item.data = entry;
            item.tooltips = item.title;
        }
        entryList.clearSelection();
        result.text = activeIssue
            ? `${ISSUE_KIND_LABELS[activeIssue.kind]}：${ISSUE_DETAILS[activeIssue.kind]}`
            : "选择左侧问题组，查看受影响的资源。";
        result.tooltips = result.text;
        refreshActions();
    };
    const scan = async (): Promise<void> => {
        const currentScan = ++scanId;
        activeIssue = null;
        issueList.removeChildrenToPool();
        entryList.removeChildrenToPool();
        repair.enabled = false;
        locate.enabled = false;
        result.text = "正在扫描资源…";
        context.setStatus("资源健康扫描已开始。");
        try {
            const report = await auditProjectResources(
                context.getWorkingProject(),
                (selector) => context.countIncomingReferences(selector),
            );
            if (currentScan !== scanId || context.getActiveDialog() !== dialog) return;
            for (const issue of report.issues) {
                const item = issueList.addItemFromPool().asButton;
                item.title = `${ISSUE_KIND_LABELS[issue.kind]}（${issue.entries.length}） · ${issue.entries[0]?.name || issue.label}`;
                item.data = issue;
                item.tooltips = ISSUE_DETAILS[issue.kind];
            }
            result.text = report.issues.length > 0
                ? `已扫描 ${report.scannedResources} 项 · 重复 ${report.duplicateGroups} 组 · 未使用 ${report.unusedResources} 项 · 冲突 ${report.conflictGroups} 组`
                : `已扫描 ${report.scannedResources} 项资源，未发现问题。`;
            result.tooltips = result.text;
            context.setDebugAttribute(
                "data-fairy-editor-resource-health",
                `${report.scannedResources}:${report.duplicateGroups}:${report.unusedResources}:${report.conflictGroups}`,
            );
            context.setStatus(`资源健康扫描完成，共 ${report.issues.length} 组问题。`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.text = `扫描失败：${message}`;
            context.setStatus(`资源健康扫描失败：${message}`);
        }
    };

    issueList.on(fgui.Events.CLICK_ITEM, context.eventOwner, renderIssue);
    entryList.on(fgui.Events.CLICK_ITEM, context.eventOwner, refreshActions);
    selectAll.onClick(context.eventOwner, () => {
        entryList.selectAll();
        refreshActions();
    });
    selectReverse.onClick(context.eventOwner, () => {
        entryList.selectReverse();
        refreshActions();
    });
    selectNone.onClick(context.eventOwner, () => {
        entryList.selectNone();
        refreshActions();
    });
    content.getChild("start").onClick(context.eventOwner, () => void scan());
    content.getChild("close").onClick(context.eventOwner, close);
    locate.onClick(context.eventOwner, () => {
        const index = entryList.getSelection([])[0];
        const entry = index === undefined ? null : entryList.getChildAt(index).data as ResourceHealthEntry | null;
        if (!entry) return;
        close();
        context.locate(entry);
    });
    repair.onClick(context.eventOwner, () => {
        if (!activeIssue?.repair) return;
        const entries = entryList.getSelection([]).map((index) => entryList.getChildAt(index).data as ResourceHealthEntry);
        if (entries.length === 0) return;
        const issue = activeIssue;
        close();
        context.repair(issue, entries);
    });
    dialog.on(Laya.Event.UNDISPLAY, context.eventOwner, () => {
        scanId += 1;
        if (context.getActiveDialog() === dialog) context.setActiveDialog(null);
    });
    context.setActiveDialog(dialog);
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    context.setDebugAttribute("data-fairy-editor-resource-health-dialog", "open");
    void scan();
}
