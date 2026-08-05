import { prepareUpdateProjectSettings, type HighRiskTransactionPreparation } from "../commands/HighRiskAuthoringTransactions";
import type { ProjectSnapshotPackage } from "../model/ProjectSnapshot";
import { addDialogBackground } from "../ui/EditorFormControls";

export interface PackageGroupDefinition {
    name: string;
    pkgs: string[];
}

export interface PackageGroupsEditorContext {
    getWorkingProject(): unknown;
    getPackages(): ProjectSnapshotPackage[];
    getLocalPackageIds(): string[];
    setLocalPackageIds(ids: string[]): void;
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    applyPreparation(preparation: HighRiskTransactionPreparation): Promise<boolean>;
    setStatus(message: string): void;
    setDebugAttribute(name: string, value: string): void;
    eventOwner: object;
}

function object(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function readPackageGroups(projectValue: unknown): PackageGroupDefinition[] {
    const settings = object(object(projectValue).settings);
    const groups = object(settings.packageGroups).groups;
    if (!Array.isArray(groups)) return [];
    return groups.flatMap((entry): PackageGroupDefinition[] => {
        const group = object(entry);
        const name = String(group.name || "").trim();
        if (!name) return [];
        return [{
            name,
            pkgs: Array.isArray(group.pkgs)
                ? [...new Set(group.pkgs.filter((id): id is string => typeof id === "string" && id.length > 0))]
                : [],
        }];
    });
}

export function showPackageGroupsEditor(options: PackageGroupsEditorContext): void {
    options.getActiveDialog()?.dispose();
    const project = object(options.getWorkingProject());
    const groups = readPackageGroups(project);
    let localPackageIds = options.getLocalPackageIds();
    let selectedGroup = 0;
    let dirty = false;
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopPackageGroupsDialog";
    const content = fgui.UIPackage.createObject("Builder", "PackageGroupsEditDialog").asCom;
    addDialogBackground(content);
    const groupList = content.getChild("groupList").asList;
    const packageList = content.getChild("pkgList").asList;
    const count = content.getChild("count").asTextField;
    const find = content.getChild("find").asLabel.getTextField();
    const packages = options.getPackages();

    const selectedIds = (): string[] => packageList.getSelection().flatMap((index) => {
        const id = packageList.getChildAt(index)?.name;
        return id ? [id] : [];
    });
    const commitSelection = (): void => {
        const ids = selectedIds();
        if (selectedGroup === 0) localPackageIds = ids;
        else if (groups[selectedGroup - 1]) groups[selectedGroup - 1].pkgs = ids;
    };
    const renderPackages = (): void => {
        packageList.removeChildrenToPool();
        const ids = new Set(selectedGroup === 0 ? localPackageIds : groups[selectedGroup - 1]?.pkgs || []);
        for (const pkg of packages) {
            const item = packageList.addItemFromPool().asButton;
            item.name = pkg.id;
            item.title = pkg.name;
            item.icon = fgui.UIPackage.getItemURL("Builder", "icon_package");
            item.selected = ids.has(pkg.id);
            item.visible = !find.text || pkg.name.toLocaleLowerCase().includes(find.text.toLocaleLowerCase());
        }
        count.text = `${ids.size}/${packages.length}`;
    };
    const renderGroups = (): void => {
        groupList.removeChildrenToPool();
        const local = groupList.addItemFromPool().asButton;
        local.title = "我的工作区(本地)";
        local.data = 0;
        groups.forEach((group, index) => {
            const item = groupList.addItemFromPool().asButton;
            item.title = group.name;
            item.data = index + 1;
        });
        groupList.selectedIndex = Math.max(0, Math.min(selectedGroup, groupList.numChildren - 1));
        renderPackages();
    };
    const chooseGroup = (item: fgui.GObject): void => {
        commitSelection();
        selectedGroup = Number(item.data || 0);
        renderPackages();
    };
    groupList.on(fgui.Events.CLICK_ITEM, options.eventOwner, chooseGroup);
    packageList.on(fgui.Events.CLICK_ITEM, options.eventOwner, () => {
        dirty = true;
        commitSelection();
        count.text = `${selectedIds().length}/${packages.length}`;
    });
    find.on(Laya.Event.INPUT, options.eventOwner, renderPackages);
    content.getChild("selectAll").onClick(options.eventOwner, () => { packageList.selectAll(); dirty = true; commitSelection(); renderPackages(); });
    content.getChild("selectReverse").onClick(options.eventOwner, () => { packageList.selectReverse(); dirty = true; commitSelection(); renderPackages(); });
    content.getChild("selectNone").onClick(options.eventOwner, () => { packageList.clearSelection(); dirty = true; commitSelection(); renderPackages(); });
    content.getChild("addGroup").onClick(options.eventOwner, () => {
        const name = window.prompt("分组名称", `分组${groups.length + 1}`)?.trim();
        if (!name || groups.some((group) => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return;
        commitSelection();
        groups.push({ name, pkgs: [] });
        selectedGroup = groups.length;
        dirty = true;
        renderGroups();
    });
    content.getChild("editGroup").onClick(options.eventOwner, () => {
        const group = groups[selectedGroup - 1];
        if (!group) return;
        const name = window.prompt("重命名分组", group.name)?.trim();
        if (!name || groups.some((candidate) => candidate !== group && candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return;
        group.name = name;
        dirty = true;
        renderGroups();
    });
    content.getChild("removeGroup").onClick(options.eventOwner, () => {
        if (selectedGroup <= 0) return;
        groups.splice(selectedGroup - 1, 1);
        selectedGroup = Math.min(selectedGroup, groups.length);
        dirty = true;
        renderGroups();
    });
    const move = (delta: -1 | 1): void => {
        const index = selectedGroup - 1;
        const target = index + delta;
        if (index < 0 || target < 0 || target >= groups.length) return;
        commitSelection();
        [groups[index], groups[target]] = [groups[target], groups[index]];
        selectedGroup = target + 1;
        dirty = true;
        renderGroups();
    };
    content.getChild("moveUp").onClick(options.eventOwner, () => move(-1));
    content.getChild("moveDown").onClick(options.eventOwner, () => move(1));

    const save = async (): Promise<boolean> => {
        commitSelection();
        options.setLocalPackageIds(localPackageIds);
        if (!dirty) return true;
        const settings = { ...object(project.settings), packageGroups: { groups: structuredClone(groups) } };
        const preparation = prepareUpdateProjectSettings(options.getWorkingProject(), settings);
        if (preparation.ok === false && preparation.code === "project_settings_unchanged") return true;
        const applied = await options.applyPreparation(preparation);
        if (applied) {
            options.setDebugAttribute("data-fairy-editor-package-groups", groups.map((group) => group.name).join("|"));
            options.setStatus(`已保存 ${groups.length} 个资源包分组。`);
        }
        return applied;
    };
    content.getChild("close").onClick(options.eventOwner, () => {
        void save().then((saved) => { if (saved) dialog.dispose(); });
    });
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => {
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    });
    renderGroups();
    dialog.contentPane = content;
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute("data-fairy-editor-package-groups-editor", "open");
    options.setStatus("正在编辑资源包分组。");
}
