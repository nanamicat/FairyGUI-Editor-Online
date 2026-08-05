import type { EditorHighRiskTransaction, EditorPackageSelector } from "../model/EditorCommand";
import type { HighRiskTransactionPreparation } from "./AuthoringTransactionTypes";
import {
    cloneJson,
    createOpId,
    findPackage,
    getHighRiskWorkingProject,
} from "./AuthoringTransactionSupport";

function prepared(
    summary: string,
    operation: EditorHighRiskTransaction["operation"],
    inverseOperation: EditorHighRiskTransaction["inverseOperation"],
): HighRiskTransactionPreparation {
    return { ok: true, transaction: { summary, operation, inverseOperation } };
}

function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function prepareUpdateProjectSettings(
    projectValue: unknown,
    settings: unknown,
): HighRiskTransactionPreparation {
    const project = getHighRiskWorkingProject(projectValue);
    if (!project?.settings || !settings || typeof settings !== "object" || Array.isArray(settings)) {
        return { ok: false, code: "project_settings_required", message: "A hydrated project settings snapshot is required." };
    }
    const next = cloneJson(settings);
    const previous = cloneJson(project.settings);
    if (sameJson(previous, next)) return { ok: false, code: "project_settings_unchanged", message: "Project settings are unchanged." };
    return prepared(
        "Update project settings",
        { opId: createOpId("update-project-settings"), kind: "updateProjectSettings", settings: next },
        { opId: createOpId("update-project-settings-undo"), kind: "updateProjectSettings", settings: previous },
    );
}

export function prepareUpdatePackageSettings(
    projectValue: unknown,
    selector: EditorPackageSelector,
    settings: unknown,
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    if (!pkg || !settings || typeof settings !== "object" || Array.isArray(settings)) {
        return { ok: false, code: "package_settings_required", message: "A hydrated package settings snapshot is required." };
    }
    const previous = cloneJson({
        compressPNG: pkg.compressPNG ?? null,
        jpegQuality: pkg.jpegQuality ?? null,
        publish: pkg.publish ?? null,
    });
    const next = cloneJson(settings);
    if (sameJson(previous, next)) return { ok: false, code: "package_settings_unchanged", message: "Package settings are unchanged." };
    return prepared(
        `Update package settings for ${pkg.name || pkg.id}`,
        { opId: createOpId("update-package-settings"), kind: "updatePackageSettings", selector, settings: next },
        { opId: createOpId("update-package-settings-undo"), kind: "updatePackageSettings", selector, settings: previous },
    );
}

export function prepareAddProjectBranch(projectValue: unknown, branch: string): HighRiskTransactionPreparation {
    const project = getHighRiskWorkingProject(projectValue);
    const name = branch.trim();
    if (!name) return { ok: false, code: "invalid_branch_name", message: "Branch name is required." };
    if (project?.branches?.includes(name)) return { ok: false, code: "branch_exists", message: `Branch ${name} already exists.` };
    return prepared(
        `Add branch ${name}`,
        { opId: createOpId("add-branch"), kind: "addBranch", branch: name },
        { opId: createOpId("add-branch-undo"), kind: "removeBranch", selector: { branch: name } },
    );
}

export function prepareRenameProjectBranch(projectValue: unknown, branch: string, newName: string): HighRiskTransactionPreparation {
    const project = getHighRiskWorkingProject(projectValue);
    const next = newName.trim();
    if (!project?.branches?.includes(branch)) return { ok: false, code: "branch_not_found", message: `Branch ${branch} was not found.` };
    if (!next || next === branch) return { ok: false, code: "invalid_branch_name", message: "Choose a different non-empty branch name." };
    if (project.branches.includes(next)) return { ok: false, code: "branch_exists", message: `Branch ${next} already exists.` };
    return prepared(
        `Rename branch ${branch} to ${next}`,
        { opId: createOpId("rename-branch"), kind: "renameBranch", selector: { branch }, newName: next },
        { opId: createOpId("rename-branch-undo"), kind: "renameBranch", selector: { branch: next }, newName: branch },
    );
}

export function prepareRemoveProjectBranch(projectValue: unknown, branch: string): HighRiskTransactionPreparation {
    const project = getHighRiskWorkingProject(projectValue);
    if (!project?.branches?.includes(branch)) return { ok: false, code: "branch_not_found", message: `Branch ${branch} was not found.` };
    return prepared(
        `Remove branch ${branch}`,
        { opId: createOpId("remove-branch"), kind: "removeBranch", selector: { branch } },
        { opId: createOpId("remove-branch-undo"), kind: "addBranch", branch },
    );
}

export function prepareUpdateSettingsBatch(
    projectValue: unknown,
    projectSettings: unknown,
    packageSettings: Array<{ selector: EditorPackageSelector; settings: unknown }>,
): HighRiskTransactionPreparation {
    const candidates = [
        prepareUpdateProjectSettings(projectValue, projectSettings),
        ...packageSettings.map((entry) => prepareUpdatePackageSettings(projectValue, entry.selector, entry.settings)),
    ];
    const failures = candidates.filter((item) => item.ok === false && !item.code.endsWith("_unchanged"));
    if (failures[0]?.ok === false) return failures[0];
    const transactions = candidates.flatMap((item) => item.ok ? [item.transaction] : []);
    if (transactions.length === 0) return { ok: false, code: "settings_unchanged", message: "Publish settings are unchanged." };
    const operations = transactions.flatMap((item) => item.operations || [item.operation]);
    const inverseOperations = transactions.slice().reverse().flatMap((item) => item.inverseOperations || [item.inverseOperation]);
    return {
        ok: true,
        transaction: {
            summary: "Update publish settings",
            operation: operations[0] as EditorHighRiskTransaction["operation"],
            inverseOperation: inverseOperations[0],
            operations,
            inverseOperations,
        },
    };
}
