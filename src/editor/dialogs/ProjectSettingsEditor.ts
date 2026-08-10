import {
    prepareAddProjectBranch,
    prepareRemoveProjectBranch,
    prepareRenameProjectBranch,
    prepareUpdateDisplayNodeGears,
    prepareUpdateProjectSettings,
    type HighRiskTransactionPreparation,
} from "../commands/HighRiskAuthoringTransactions";
import {
    collectBrowserLanguageEntries,
    createBrowserLanguageCommands,
    createBrowserLanguageXml,
    normalizeBrowserLanguagePath,
    readBrowserLanguageValues,
} from "../services/BrowserLanguageFiles";
import { pickBrowserFile } from "../services/BrowserProjectImport";
import type { SetDisplayNodePropsCommand } from "../model/EditorCommand";
import type {
    ComponentInstanceEditableProperties,
    DisplayNodeEditableProps,
    EditorCommandOperation,
    EditorHighRiskTransaction,
} from "../model/EditorCommand";
import { createOpId, findDisplayNode } from "../commands/AuthoringTransactionSupport";
import { readListProperties, readTextInputProperties } from "../commands/DisplayListReaders";
import { addDialogBackground, setOverflowText } from "../ui/EditorFormControls";

type JsonObject = Record<string, unknown>;

export interface ProjectSettingsEditorContext {
    getWorkingProject(): unknown | null;
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    applyPreparation(preparation: HighRiskTransactionPreparation): Promise<boolean>;
    applyDisplayNodeCommands(commands: SetDisplayNodePropsCommand[], summary: string): Promise<boolean>;
    download(blob: Blob, fileName: string): void;
    runWorkspaceTextFileTask(task: (files: {
        read(path: string): Promise<string | null>;
        write(path: string, content: string): Promise<void>;
    }) => Promise<void>): Promise<void>;
    setStatus(message: string): void;
    eventOwner: object;
}

export function showStringsFunctionDialog(options: ProjectSettingsEditorContext): void {
    const project = options.getWorkingProject() as (JsonObject & { packages?: Array<JsonObject & { id?: string; name?: string }> }) | null;
    if (!project?.packages?.length) {
        options.setStatus("String import/export unavailable: open a live browser workspace first.");
        return;
    }
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopStringsFunctionDialog";
    const content = fgui.UIPackage.createObject("Builder", "StringsFunctionDialog").asCom;
    addDialogBackground(content);
    const mode = content.getController("c2");
    const page = content.getController("c1");
    const packageIds = new Set(project.packages.map((pkg) => String(pkg.id || "")).filter(Boolean));
    const packageNames = new Map(project.packages.map((pkg) => [String(pkg.name || pkg.id || ""), String(pkg.id || "")]));
    const packagePrompt = content.getChild("pkgsPrompt").asTextField;
    const renderPackagePrompt = (): void => {
        packagePrompt.text = packageIds.size === project.packages!.length
            ? "全部包"
            : project.packages!.filter((pkg) => packageIds.has(String(pkg.id || ""))).map((pkg) => pkg.name || pkg.id).join(", ");
    };
    renderPackagePrompt();
    content.getChild("choosePkgs").asButton.onClick(options.eventOwner, () => {
        const answer = window.prompt(
            `输入要导出的包名，用逗号分隔。\n可用：${[...packageNames.keys()].join(", ")}`,
            [...packageNames.entries()].filter(([, id]) => packageIds.has(id)).map(([name]) => name).join(", "),
        );
        if (answer === null) return;
        const names = answer.split(/[,，]/).map((value) => value.trim()).filter(Boolean);
        const ids = names.map((name) => packageNames.get(name)).filter((id): id is string => Boolean(id));
        if (!ids.length || ids.length !== names.length) {
            options.setStatus("Package selection contains an unknown package name.");
            return;
        }
        packageIds.clear();
        ids.forEach((id) => packageIds.add(id));
        renderPackagePrompt();
    });

    let importFile: File | null = null;
    let importedValues = new Map<string, string>();
    const chooseImportFile = async (): Promise<void> => {
        importFile = await pickBrowserFile(".xml,text/xml,application/xml", "String import was cancelled.", "strings-import");
        content.getChild("importFile").asLabel.title = importFile.name;
    };
    content.getChild("browse").asButton.onClick(options.eventOwner, () => void chooseImportFile().catch((error) => {
        options.setStatus(error instanceof Error ? error.message : String(error));
    }));

    const showImportPackages = (): void => {
        const list = content.getChild("importPkgList").asList;
        list.removeChildrenToPool();
        for (const pkg of project.packages || []) {
            const id = String(pkg.id || "");
            if (!id || ![...importedValues.keys()].some((name) => name.startsWith(id))) continue;
            const item = list.addItemFromPool().asButton;
            item.title = String(pkg.name || id);
            item.data = id;
            item.selected = true;
        }
        page.selectedPage = "2";
    };
    content.getChild("next").asButton.onClick(options.eventOwner, () => void (async () => {
        if (mode.selectedIndex === 0) {
            let preserved = new Map<string, string>();
            if (content.getChild("merge").asButton.selected) {
                try {
                    const existing = await pickBrowserFile(".xml,text/xml,application/xml", "Merge source selection was cancelled.", "strings-merge");
                    preserved = readBrowserLanguageValues(await existing.text());
                } catch (error) {
                    options.setStatus(error instanceof Error ? error.message : String(error));
                    return;
                }
            }
            const xml = createBrowserLanguageXml(options.getWorkingProject(), preserved, packageIds);
            options.download(new Blob([xml], { type: "application/xml;charset=utf-8" }), "strings.xml");
            options.setStatus(`Exported ${collectBrowserLanguageEntries(options.getWorkingProject(), packageIds).length} strings.`);
            dialog.dispose();
            return;
        }
        if (!importFile) await chooseImportFile();
        importedValues = readBrowserLanguageValues(await importFile!.text());
        showImportPackages();
    })().catch((error) => options.setStatus(`String operation failed: ${error instanceof Error ? error.message : String(error)}`)));
    content.getChild("import").asButton.onClick(options.eventOwner, () => void (async () => {
        const list = content.getChild("importPkgList").asList;
        const selectedIds = new Set(Array.from({ length: list.numChildren }, (_, index) => list.getChildAt(index).asButton)
            .filter((item) => item.selected)
            .map((item) => String(item.data || "")));
        if (!selectedIds.size) {
            options.setStatus("Select at least one package to import.");
            return;
        }
        const result = createBrowserLanguageCommands(options.getWorkingProject(), importedValues, selectedIds);
        if (!result.commands.length && !result.gearUpdates.length) {
            options.setStatus("The selected language file has no matching editable strings.");
            return;
        }
        if (result.gearUpdates.length) {
            const workingProject = options.getWorkingProject();
            const gearTransactions: EditorHighRiskTransaction[] = [];
            for (const update of result.gearUpdates) {
                const preparation = prepareUpdateDisplayNodeGears(workingProject, update.selector, update.gears);
                if (!preparation.ok) {
                    await options.applyPreparation(preparation);
                    return;
                }
                gearTransactions.push(preparation.transaction);
            }
            const displayOperations: EditorCommandOperation[] = [];
            const displayInverseOperations: EditorCommandOperation[] = [];
            for (const command of result.commands) {
                const node = findDisplayNode(workingProject, command.selector);
                if (!node) continue;
                const inverse: DisplayNodeEditableProps = {};
                if (command.props.tooltips !== undefined) inverse.tooltips = String(node.tooltips || "");
                if (command.props.text !== undefined) inverse.text = String(node.text || "");
                if (command.props.textInputProperties !== undefined) inverse.textInputProperties = readTextInputProperties(node);
                if (command.props.listProperties !== undefined) inverse.listProperties = readListProperties(node);
                if (command.props.componentInstanceProperties !== undefined) {
                    inverse.componentInstanceProperties = structuredClone(node.instanceProperties) as ComponentInstanceEditableProperties;
                }
                displayOperations.push({
                    opId: createOpId("import-language-text"),
                    kind: "setDisplayNodeProps",
                    selector: command.selector,
                    props: command.props,
                });
                displayInverseOperations.unshift({
                    opId: createOpId("import-language-text-undo"),
                    kind: "setDisplayNodeProps",
                    selector: command.selector,
                    props: inverse,
                });
            }
            const gearOperations = gearTransactions.flatMap((transaction) => transaction.operations || [transaction.operation]);
            const gearInverseOperations = gearTransactions.slice().reverse()
                .flatMap((transaction) => transaction.inverseOperations || [transaction.inverseOperation]);
            const operations = [...gearOperations, ...displayOperations];
            const inverseOperations = [...displayInverseOperations, ...gearInverseOperations];
            if (!await options.applyPreparation({
                ok: true,
                transaction: {
                    summary: `Import ${result.matched} strings`,
                    operation: gearOperations[0] as EditorHighRiskTransaction["operation"],
                    inverseOperation: inverseOperations[0],
                    operations,
                    inverseOperations,
                },
            })) return;
        } else if (!await options.applyDisplayNodeCommands(result.commands, `Import ${result.matched} strings`)) return;
        options.setStatus(`Imported ${result.matched} strings across ${result.commands.length + result.gearUpdates.length} display nodes.`);
        dialog.dispose();
    })());
    content.getChild("close").asButton.onClick(options.eventOwner, () => dialog.dispose());
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => {
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    });
    dialog.contentPane = content;
    options.setActiveDialog(dialog);
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setStatus("String import/export supports XML export, merge, and browser-side project updates.");
}

function object(value: unknown): JsonObject {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function label(component: fgui.GComponent, name: string): fgui.GLabel {
    return component.getChild(name).asLabel;
}

function fillRows(
    list: fgui.GList,
    values: Array<Record<string, string>>,
): void {
    list.removeChildrenToPool();
    for (const value of values) {
        const row = list.addItemFromPool().asButton;
        for (const [name, text] of Object.entries(value)) row.getChild(name).asLabel.title = text;
    }
    if (list.numChildren > 0) list.selectedIndex = 0;
}

function readRows(list: fgui.GList, fields: string[]): Array<Record<string, string>> {
    return Array.from({ length: list.numChildren }, (_, index) => {
        const row = list.getChildAt(index).asButton;
        return Object.fromEntries(fields.map((name) => [name, row.getChild(name).asLabel.title.trim()]));
    });
}

export function parseProjectAdaptationDevices(rows: Array<Record<string, string>>):
    | { ok: true; devices: Array<{ name: string; resolutionX: number; resolutionY: number }> }
    | { ok: false } {
    const devices = rows.map((item) => ({
        name: item.name.trim(),
        resolutionX: Number(item.x),
        resolutionY: Number(item.y),
    }));
    const names = new Set<string>();
    for (const device of devices) {
        const key = device.name.toLocaleLowerCase();
        if (!device.name
            || !Number.isInteger(device.resolutionX)
            || device.resolutionX <= 0
            || !Number.isInteger(device.resolutionY)
            || device.resolutionY <= 0
            || names.has(key)) return { ok: false };
        names.add(key);
    }
    return { ok: true, devices };
}

export function nextProjectBranchName(branches: string[]): string {
    const existing = new Set(branches.map((name) => name.toLocaleLowerCase()));
    for (let index = 1; ; index += 1) {
        const candidate = `branch-${index}`;
        if (!existing.has(candidate)) return candidate;
    }
}

export function showProjectSettingsEditor(options: ProjectSettingsEditorContext): void {
    const project = options.getWorkingProject() as (JsonObject & {
        projectId?: string;
        projectType?: number | string;
        branches?: string[];
        settings?: JsonObject;
    }) | null;
    if (!project?.settings) {
        options.setStatus("Project settings unavailable: open a live browser workspace first.");
        return;
    }

    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopProjectSettingsDialog";
    const content = fgui.UIPackage.createObject("Builder", "ProjectSettingsDialog").asCom;
    addDialogBackground(content);
    dialog.contentPane = content;
    content.getController("c1").selectedIndex = 0;
    const settings = structuredClone(project.settings);
    const common = object(settings.common);
    const adaptation = object(settings.adaptation);

    const basic = content.getChild("basic").asCom;
    const projectId = String(project.projectId || "");
    const projectName = label(basic, "projectName");
    projectName.title = projectId;
    projectName.tooltips = projectId;
    setOverflowText(projectName.getTextField(), projectId);
    const projectType = basic.getChild("projectType").asComboBox;
    projectType.items = [String(project.projectType ?? "")];
    projectType.values = projectType.items;
    projectType.selectedIndex = 0;
    projectName.enabled = false;
    projectType.enabled = false;

    const commonPanel = content.getChild("common").asCom;
    label(commonPanel, "fontName").title = String(common.font ?? "");
    label(commonPanel, "fontSize").title = String(common.fontSize ?? 12);
    label(commonPanel, "textColor").title = String(common.textColor ?? "#000000");
    commonPanel.getChild("pivot").asComboBox.value = String(common.pivot ?? "default");
    const scrollBars = object(common.scrollBars);
    const scrollDisplay = commonPanel.getChild("scrollBarDisplay").asComboBox;
    scrollDisplay.items = ["Default", "Visible", "Auto", "Hidden"];
    scrollDisplay.values = ["default", "visible", "auto", "hidden"];
    scrollDisplay.value = String(scrollBars.defaultDisplay ?? "default");
    label(commonPanel, "vtScrollBarRes").title = String(scrollBars.vertical ?? "");
    label(commonPanel, "hzScrollBarRes").title = String(scrollBars.horizontal ?? "");
    label(commonPanel, "tipsRes").title = String(common.tipsRes ?? "");
    label(commonPanel, "buttonClickSound").title = String(common.buttonClickSound ?? "");

    const quickPanel = content.getChild("quick").asCom;
    const setScheme = (name: string, value: unknown): void => {
        quickPanel.getChild(name).asLabel.title = Array.isArray(value) ? value.map(String).join("\n") : "";
    };
    setScheme("fontSizeScheme", common.fontSizeScheme);
    setScheme("fontScheme", common.fontScheme);
    setScheme("colorScheme", common.colorScheme);

    const adaptationPanel = content.getChild("adaptation").asCom;
    adaptationPanel.getChild("scaleMode").asComboBox.value = String(adaptation.scaleMode ?? "ConstantPixelSize");
    adaptationPanel.getChild("screenMatchMode").asComboBox.value = String(adaptation.screenMathMode ?? "MatchWidthOrHeight");
    label(adaptationPanel, "designResolutionX").title = String(adaptation.designResolutionX ?? 0);
    label(adaptationPanel, "designResolutionY").title = String(adaptation.designResolutionY ?? 0);
    const deviceList = adaptationPanel.getChild("list").asList;
    const deviceRows = Array.isArray(adaptation.devices)
        ? adaptation.devices.map((value) => object(value)).map((device) => ({
            name: String(device.name ?? ""),
            x: String(device.resolutionX ?? ""),
            y: String(device.resolutionY ?? ""),
        }))
        : [];
    fillRows(deviceList, deviceRows);
    const replaceDevices = (rows: Array<Record<string, string>>, selectedIndex: number): void => {
        fillRows(deviceList, rows);
        deviceList.selectedIndex = rows.length === 0 ? -1 : Math.max(0, Math.min(selectedIndex, rows.length - 1));
    };
    adaptationPanel.getChild("add").asButton.onClick(options.eventOwner, () => {
        const rows = readRows(deviceList, ["name", "x", "y"]);
        rows.push({ name: "Device", x: "1280", y: "720" });
        replaceDevices(rows, rows.length - 1);
    });
    adaptationPanel.getChild("insert").asButton.onClick(options.eventOwner, () => {
        const rows = readRows(deviceList, ["name", "x", "y"]);
        const index = deviceList.selectedIndex < 0 ? 0 : deviceList.selectedIndex;
        rows.splice(index, 0, { name: "Device", x: "1280", y: "720" });
        replaceDevices(rows, index);
    });
    adaptationPanel.getChild("remove").asButton.onClick(options.eventOwner, () => {
        const rows = readRows(deviceList, ["name", "x", "y"]);
        const index = deviceList.selectedIndex;
        if (index < 0) return;
        rows.splice(index, 1);
        replaceDevices(rows, index);
    });
    const moveDevice = (offset: -1 | 1): void => {
        const rows = readRows(deviceList, ["name", "x", "y"]);
        const index = deviceList.selectedIndex;
        const next = index + offset;
        if (index < 0 || next < 0 || next >= rows.length) return;
        [rows[index], rows[next]] = [rows[next], rows[index]];
        replaceDevices(rows, next);
    };
    adaptationPanel.getChild("moveUp").asButton.onClick(options.eventOwner, () => moveDevice(-1));
    adaptationPanel.getChild("moveDown").asButton.onClick(options.eventOwner, () => moveDevice(1));

    const branchPanel = content.getChild("branch").asCom;
    const branchList = branchPanel.getChild("branches").asList;
    const branches = project.branches || [];
    fillRows(branchList, branches.map((branchName) => ({ branchName })));
    const runBranch = async (preparation: HighRiskTransactionPreparation): Promise<void> => {
        if (!await options.applyPreparation(preparation)) return;
        dialog.dispose();
        options.setStatus("Branch lifecycle applied. Reopen Project Settings to continue.");
    };
    const requestBranchName = (title: string, prompt: string, placeholder: string): Promise<string | null> =>
        new Promise((resolve) => {
            const inputDialog = new fgui.Window();
            inputDialog.modal = true;
            inputDialog.name = "desktopProjectBranchNameDialog";
            inputDialog.contentPane = fgui.UIPackage.createObject("Builder", "InputDialog").asCom;
            const inputContent = inputDialog.contentPane;
            inputContent.getChild("frame").asLabel.title = title;
            inputContent.getChild("prompt").text = prompt;
            const input = inputContent.getChild("input").asCom.getChild("title").asTextInput;
            input.text = "";
            input.promptText = placeholder;
            const close = (value: string | null): void => {
                inputDialog.dispose();
                resolve(value);
            };
            const confirm = (): void => {
                const value = input.text.trim();
                if (value) close(value);
                else inputContent.getChild("prompt").text = "Branch name is required.";
            };
            inputContent.getChild("ok").asButton.onClick(options.eventOwner, confirm);
            inputContent.getChild("cancel").asButton.onClick(options.eventOwner, close, [null]);
            input.on(Laya.Event.KEY_DOWN, options.eventOwner, (event: Laya.Event) => {
                if (event.key === "Enter") confirm();
                else if (event.key === "Escape") close(null);
            });
            inputDialog.show();
            input.requestFocus();
        });
    branchPanel.getChild("addBranch").asButton.onClick(options.eventOwner, () => void (async () => {
        const suggestion = nextProjectBranchName(branches);
        const name = await requestBranchName("Create branch", `Branch name (suggested: ${suggestion})`, suggestion);
        if (name) await runBranch(prepareAddProjectBranch(options.getWorkingProject(), name));
    })());
    branchPanel.getChild("editBranch").asButton.onClick(options.eventOwner, () => void (async () => {
        const current = branches[branchList.selectedIndex];
        if (!current) return;
        const next = await requestBranchName("Rename branch", `Rename ${current}`, current);
        if (next && current !== next) await runBranch(prepareRenameProjectBranch(options.getWorkingProject(), current, next));
    })());
    branchPanel.getChild("removeBranch").asButton.onClick(options.eventOwner, () => {
        const current = readRows(branchList, ["branchName"])[branchList.selectedIndex]?.branchName;
        if (current && window.confirm(`Remove branch ${current}? Referenced branch data will be rejected by preflight.`)) {
            void runBranch(prepareRemoveProjectBranch(options.getWorkingProject(), current));
        }
    });

    const i18nPanel = content.getChild("i18n").asCom;
    const languageList = i18nPanel.getChild("langs").asList;
    const languageFiles = Array.isArray(object(settings.i18n).langFiles)
        ? object(settings.i18n).langFiles as Array<{ name?: unknown; path?: unknown }>
        : [];
    fillRows(languageList, languageFiles.map((item) => ({ name: String(item.name ?? ""), path: String(item.path ?? "") }))
        .map(({ name, path }) => ({ title: name, path })));
    i18nPanel.getChild("addLang").asButton.onClick(options.eventOwner, () => {
        const suffix = languageList.numChildren + 1;
        const row = languageList.addItemFromPool().asButton;
        row.getChild("title").asLabel.title = `language-${suffix}`;
        row.getChild("path").asLabel.title = `i18n/language-${suffix}.xml`;
        languageList.selectedIndex = languageList.numChildren - 1;
    });
    i18nPanel.getChild("removeLang").asButton.onClick(options.eventOwner, () => {
        if (languageList.selectedIndex >= 0) languageList.removeChildToPoolAt(languageList.selectedIndex);
    });
    const writeLanguageFile = async (
        files: { read(path: string): Promise<string | null>; write(path: string, content: string): Promise<void> },
        rawPath: string,
        preserve: boolean,
    ): Promise<{ path: string; count: number }> => {
        const path = normalizeBrowserLanguagePath(rawPath.trim());
        const existing = await files.read(path);
        const preserved = preserve && existing !== null ? readBrowserLanguageValues(existing) : new Map<string, string>();
        const workingProject = options.getWorkingProject();
        const count = collectBrowserLanguageEntries(workingProject).length;
        await files.write(path, createBrowserLanguageXml(workingProject, preserved));
        return { path, count };
    };
    i18nPanel.getChild("newLangFile").asButton.onClick(options.eventOwner, () => void (async () => {
        const selectedIndex = languageList.selectedIndex;
        const row = readRows(languageList, ["title", "path"])[selectedIndex];
        if (!row) {
            options.setStatus("Language generation skipped: select or add a language row first.");
            return;
        }
        const rawPath = row.path.trim();
        if (!rawPath) {
            options.setStatus("Language generation skipped: enter a project-relative .xml path in the selected row first.");
            return;
        }
        try {
            const path = normalizeBrowserLanguagePath(rawPath);
            await options.runWorkspaceTextFileTask(async (files) => {
                const existing = await files.read(path);
                if (existing !== null && !window.confirm(`Replace ${path} with fresh source-language values?`)) return;
                const result = await writeLanguageFile(files, path, false);
                options.setStatus(`Generated ${result.count} language entries in ${result.path}. Click Save for Folder write-back.`);
            });
        } catch (error) {
            options.setStatus(`Language generation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    })());
    i18nPanel.getChild("syncLangFiles").asButton.onClick(options.eventOwner, () => void (async () => {
        try {
            await options.runWorkspaceTextFileTask(async (files) => {
                const rows = readRows(languageList, ["title", "path"]);
                if (rows.length === 0) throw new Error("Add at least one language row first.");
                const paths = rows.map((row) => normalizeBrowserLanguagePath(row.path));
                if (new Set(paths.map((path) => path.toLocaleLowerCase())).size !== paths.length) {
                    throw new Error("Language file paths must be unique.");
                }
                let count = 0;
                for (const path of paths) count += (await writeLanguageFile(files, path, true)).count;
                options.setStatus(`Synchronized ${paths.length} language file(s), ${count} entries total. Click Save for Folder write-back.`);
            });
        } catch (error) {
            options.setStatus(`Language synchronization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    })());

    const customPanel = content.getChild("customprops").asCom;
    const customList = customPanel.getChild("customProps").asList;
    fillRows(customList, Object.entries(object(settings.customProperties)).map(([text, value]) => ({
        text,
        value: typeof value === "string" ? value : JSON.stringify(value),
    })));
    customPanel.getChild("addProp").asButton.onClick(options.eventOwner, () => {
        const row = customList.addItemFromPool().asButton;
        row.getChild("text").asLabel.title = "key";
        row.getChild("value").asLabel.title = "";
        customList.selectedIndex = customList.numChildren - 1;
    });
    customPanel.getChild("removeProp").asButton.onClick(options.eventOwner, () => {
        if (customList.selectedIndex >= 0) customList.removeChildToPoolAt(customList.selectedIndex);
    });

    const commit = async (close: boolean): Promise<void> => {
        const fontSize = Number(label(commonPanel, "fontSize").title);
        const designResolutionX = Number(label(adaptationPanel, "designResolutionX").title);
        const designResolutionY = Number(label(adaptationPanel, "designResolutionY").title);
        if (![fontSize, designResolutionX, designResolutionY].every(Number.isFinite)) {
            options.setStatus("Project settings skipped: font size and design resolution must be numeric.");
            return;
        }
        const parsedDevices = parseProjectAdaptationDevices(readRows(deviceList, ["name", "x", "y"]));
        if (!parsedDevices.ok) {
            options.setStatus("Project settings skipped: device names must be unique and resolutions must be positive integers.");
            return;
        }
        settings.common = {
            ...common,
            font: label(commonPanel, "fontName").title.trim(),
            fontSize,
            textColor: label(commonPanel, "textColor").title.trim(),
            pivot: commonPanel.getChild("pivot").asComboBox.value,
            scrollBars: {
                ...scrollBars,
                defaultDisplay: scrollDisplay.value,
                vertical: label(commonPanel, "vtScrollBarRes").title.trim(),
                horizontal: label(commonPanel, "hzScrollBarRes").title.trim(),
            },
            tipsRes: label(commonPanel, "tipsRes").title.trim(),
            buttonClickSound: label(commonPanel, "buttonClickSound").title.trim(),
            fontSizeScheme: quickPanel.getChild("fontSizeScheme").asLabel.title.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
            fontScheme: quickPanel.getChild("fontScheme").asLabel.title.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
            colorScheme: quickPanel.getChild("colorScheme").asLabel.title.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        };
        settings.adaptation = {
            ...adaptation,
            scaleMode: adaptationPanel.getChild("scaleMode").asComboBox.value,
            screenMathMode: adaptationPanel.getChild("screenMatchMode").asComboBox.value,
            designResolutionX,
            designResolutionY,
            devices: parsedDevices.devices,
        };
        settings.i18n = { langFiles: readRows(languageList, ["title", "path"]).map((item) => ({ name: item.title, path: item.path })) };
        const nextCustom: JsonObject = {};
        for (const item of readRows(customList, ["text", "value"])) {
            if (!item.text) continue;
            try { nextCustom[item.text] = JSON.parse(item.value); } catch { nextCustom[item.text] = item.value; }
        }
        settings.customProperties = nextCustom;
        const preparation = prepareUpdateProjectSettings(options.getWorkingProject(), settings);
        if (preparation.ok === false && preparation.code === "project_settings_unchanged") {
            options.setStatus("Project settings are unchanged.");
            if (close) dialog.dispose();
            return;
        }
        if (await options.applyPreparation(preparation)) {
            options.setStatus("Project settings applied.");
            if (close) dialog.dispose();
        }
    };
    content.getChild("ok").asButton.onClick(options.eventOwner, () => void commit(true));
    content.getChild("apply").asButton.onClick(options.eventOwner, () => void commit(false));
    content.getChild("cancel").asButton.onClick(options.eventOwner, () => dialog.dispose());
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => {
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    });
    options.setActiveDialog(dialog);
    dialog.show();
    options.setStatus("Editing project settings.");
}
