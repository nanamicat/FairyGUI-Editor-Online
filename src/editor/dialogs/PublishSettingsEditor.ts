import {
    prepareSetImageResourceProps,
    prepareUpdateSettingsBatch,
    readImageResourceProps,
    type HighRiskTransactionPreparation,
} from "../commands/HighRiskAuthoringTransactions";
import type { EditorHighRiskTransaction } from "../model/EditorCommand";
import { addDialogBackground, createInspectorButton } from "../ui/EditorFormControls";

type JsonObject = Record<string, unknown>;
type PackageLike = JsonObject & {
    id: string;
    name: string;
    compressPNG?: boolean | null;
    jpegQuality?: number | null;
    publish?: JsonObject | null;
    folders?: JsonObject[];
    resources?: JsonObject[];
};

export interface PublishSettingsEditorContext {
    getWorkingProject(): unknown | null;
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    applyPreparation(preparation: HighRiskTransactionPreparation): Promise<boolean>;
    publish(mode: "current" | "modified" | "all"): Promise<void>;
    setStatus(message: string): void;
    eventOwner: object;
}

function object(value: unknown): JsonObject {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(panel: fgui.GComponent, name: string): string {
    return panel.getChild(name).asLabel.title.trim();
}

function setText(panel: fgui.GComponent, name: string, value: unknown): void {
    panel.getChild(name).asLabel.title = String(value ?? "");
}

function packagePublish(pkg: PackageLike): JsonObject {
    return structuredClone(pkg.publish || {
        name: pkg.name,
        path: "",
        branchPath: "",
        packageCount: 1,
        genCode: false,
        codePath: "",
        useGlobalAtlasSettings: true,
        maxAtlasSize: 2048,
        sizeOption: "pot",
        forceSquare: false,
        allowRotation: false,
        paging: true,
        extractAlpha: false,
        maxAtlasIndex: 0,
        atlases: [],
        excludedResourceIds: [],
    });
}

export function showPublishSettingsEditor(options: PublishSettingsEditorContext): void {
    const project = options.getWorkingProject() as (JsonObject & { settings?: JsonObject; packages?: PackageLike[] }) | null;
    if (!project?.settings || !project.packages?.length) {
        options.setStatus("Publish settings unavailable: open a live browser workspace first.");
        return;
    }
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopPublishSettingsDialog";
    const content = fgui.UIPackage.createObject("Builder", "PublishDialog").asCom;
    addDialogBackground(content);
    dialog.contentPane = content;
    const controller = content.getController("global");
    const globalPanel = content.getChild("globalSettings").asCom;
    const packagePanel = content.getChild("packageSettings").asCom;
    globalPanel.getController("support_atlas").selectedIndex = 1;
    packagePanel.getController("support_atlas").selectedIndex = 1;
    const projectSettings = structuredClone(project.settings);
    const publish = object(projectSettings.publish);
    const atlas = object(publish.atlasSetting);
    setText(globalPanel, "path", publish.path);
    setText(globalPanel, "branchPath", publish.branchPath);
    setText(globalPanel, "fileExtension", publish.fileExtension ?? "fui");
    globalPanel.getChild("binaryFormat").asButton.selected = publish.binaryFormat !== false;
    globalPanel.getChild("compressDesc").asButton.selected = publish.compressDesc === true;
    globalPanel.getChild("twoPackages").asButton.selected = Number(publish.packageCount ?? 1) === 2;
    globalPanel.getChild("branchProcessing").asComboBox.value = String(publish.branchProcessing ?? 0);
    globalPanel.getChild("seperatedAtlasForBranch").asButton.selected = publish.seperatedAtlasForBranch === true;
    const highResolution = Number(publish.includeHighResolution ?? 0);
    globalPanel.getChild("2x").asButton.selected = (highResolution & 1) !== 0;
    globalPanel.getChild("3x").asButton.selected = (highResolution & 2) !== 0;
    globalPanel.getChild("4x").asButton.selected = (highResolution & 4) !== 0;
    setText(globalPanel, "jpegQuality", publish.jpegQuality ?? 80);
    globalPanel.getChild("compressPNG").asComboBox.selectedIndex = publish.compressPNG === true ? 1 : 0;
    globalPanel.getChild("maxAtlasSize").asComboBox.value = String(atlas.maxSize ?? 2048);
    globalPanel.getChild("paging").asButton.selected = atlas.paging !== false;
    globalPanel.getChild("sizeOption").asComboBox.value = String(atlas.sizeOption ?? "pot");
    globalPanel.getChild("square").asButton.selected = atlas.forceSquare === true;
    globalPanel.getChild("rotation").asButton.selected = atlas.allowRotation === true;
    globalPanel.getChild("trimImage").asButton.selected = atlas.trimImage === true;
    const allowGenCode = globalPanel.getChild("allowGenCode").asButton;
    allowGenCode.selected = object(publish.codeGeneration).allowGenCode === true;
    allowGenCode.enabled = true;
    allowGenCode.tooltips = "Browser publish rejects code generation before writing output; turn this off to publish runtime assets.";
    for (const name of ["codePath", "classNamePrefix", "memberNamePrefix", "ignoreNoname", "getMemberByName", "codePackageName"]) {
        globalPanel.getChild(name).enabled = false;
    }

    const drafts = new Map(project.packages.map((pkg) => [pkg.id, {
        compressPNG: pkg.compressPNG ?? null,
        jpegQuality: pkg.jpegQuality ?? null,
        publish: packagePublish(pkg),
    }]));
    const pendingImageAtlasModes = new Map<string, string>();
    const imageAtlasKey = (packageId: string, resourceId: string): string => `${packageId}\0${resourceId}`;
    const imageAtlasMode = (pkg: PackageLike, resource: JsonObject): string => (
        pendingImageAtlasModes.get(imageAtlasKey(pkg.id, String(resource.id || "")))
        ?? String(object(resource.image).textureSetMode || "")
    );
    let selectedPackageId = "";
    const excludedList = packagePanel.getChild("excludedList").asList;
    const renderExcluded = (): void => {
        excludedList.removeChildrenToPool();
        const pkg = project.packages!.find((candidate) => candidate.id === selectedPackageId);
        const excluded = object(drafts.get(selectedPackageId)?.publish).excludedResourceIds;
        const ids = Array.isArray(excluded) ? excluded.map(String) : [];
        const resources = Array.isArray(pkg?.resources) ? pkg.resources.map(object) : [];
        for (const id of ids) {
            const resource = resources.find((candidate) => candidate.id === id);
            const item = excludedList.addItemFromPool().asButton;
            item.getChild("title").asLabel.title = String(resource?.name || id);
            item.data = id;
        }
        if (excludedList.numChildren) excludedList.selectedIndex = 0;
    };
    const storePackagePanel = (): void => {
        if (!selectedPackageId) return;
        const draft = drafts.get(selectedPackageId);
        if (!draft) return;
        const current = object(draft.publish);
        draft.publish = {
            ...current,
            name: text(packagePanel, "fileName"),
            path: text(packagePanel, "path"),
            branchPath: text(packagePanel, "branchPath"),
            packageCount: packagePanel.getChild("twoPackages").asButton.selected ? 2 : 1,
            genCode: packagePanel.getChild("genCode").asButton.selected,
            codePath: text(packagePanel, "codePath"),
            useGlobalAtlasSettings: packagePanel.getChild("atlasOption").asButton.selected,
            maxAtlasSize: Number(packagePanel.getChild("maxAtlasSize").asComboBox.value),
            sizeOption: packagePanel.getChild("sizeOption").asComboBox.value,
            forceSquare: packagePanel.getChild("square").asButton.selected,
            allowRotation: packagePanel.getChild("rotation").asButton.selected,
            paging: packagePanel.getChild("paging").asButton.selected,
            extractAlpha: packagePanel.getChild("extractAlpha").asButton.selected,
        };
    };
    const showPackage = (packageId: string): void => {
        storePackagePanel();
        selectedPackageId = packageId;
        const draft = drafts.get(packageId);
        const current = object(draft?.publish);
        setText(packagePanel, "fileName", current.name);
        setText(packagePanel, "path", current.path);
        setText(packagePanel, "branchPath", current.branchPath);
        packagePanel.getChild("twoPackages").asButton.selected = Number(current.packageCount ?? 1) === 2;
        packagePanel.getChild("atlasOption").asButton.selected = current.useGlobalAtlasSettings !== false;
        packagePanel.getChild("maxAtlasSize").asComboBox.value = String(current.maxAtlasSize ?? 2048);
        packagePanel.getChild("sizeOption").asComboBox.value = String(current.sizeOption ?? "pot");
        packagePanel.getChild("square").asButton.selected = current.forceSquare === true;
        packagePanel.getChild("rotation").asButton.selected = current.allowRotation === true;
        packagePanel.getChild("paging").asButton.selected = current.paging !== false;
        packagePanel.getChild("extractAlpha").asButton.selected = current.extractAlpha === true;
        const genCode = packagePanel.getChild("genCode").asButton;
        genCode.selected = current.genCode === true;
        genCode.enabled = true;
        genCode.tooltips = "Browser publish rejects selected-package code generation before writing output; turn this off to publish runtime assets.";
        setText(packagePanel, "codePath", current.codePath);
        packagePanel.getChild("codePath").enabled = false;
        renderExcluded();
        controller.selectedIndex = 0;
    };

    const addExcluded = createInspectorButton(packagePanel, "addExcluded", "+", 490, 342, 23);
    addExcluded.tooltips = "添加发布时排除的资源";
    addExcluded.onClick(options.eventOwner, () => {
        const pkg = project.packages!.find((candidate) => candidate.id === selectedPackageId);
        const resources = Array.isArray(pkg?.resources) ? pkg.resources.map(object) : [];
        const answer = window.prompt(
            `输入要排除的资源名称或 ID：\n${resources.slice(0, 80).map((resource) => `${resource.name || resource.id} (${resource.id})`).join(", ")}`,
            "",
        )?.trim();
        if (!answer) return;
        const resource = resources.find((candidate) => candidate.id === answer || candidate.name === answer);
        if (!resource) {
            options.setStatus("Excluded resource was not found in the selected package.");
            return;
        }
        const draft = drafts.get(selectedPackageId);
        if (!draft) return;
        const current = object(draft.publish);
        const ids = Array.isArray(current.excludedResourceIds) ? current.excludedResourceIds.map(String) : [];
        if (!ids.includes(String(resource.id))) ids.push(String(resource.id));
        draft.publish = { ...current, excludedResourceIds: ids };
        renderExcluded();
    });
    packagePanel.getChild("removeExcluded").asButton.onClick(options.eventOwner, () => {
        const item = excludedList.selectedIndex >= 0 ? excludedList.getChildAt(excludedList.selectedIndex) : null;
        const draft = drafts.get(selectedPackageId);
        if (!item || !draft) return;
        const current = object(draft.publish);
        draft.publish = {
            ...current,
            excludedResourceIds: (Array.isArray(current.excludedResourceIds) ? current.excludedResourceIds.map(String) : [])
                .filter((id) => id !== String(item.data || "")),
        };
        renderExcluded();
    });

    packagePanel.getChild("openDefinition").asButton.onClick(options.eventOwner, () => {
        storePackagePanel();
        const draft = drafts.get(selectedPackageId);
        const pkg = project.packages!.find((candidate) => candidate.id === selectedPackageId);
        if (!draft || !pkg) return;
        const atlasDialog = new fgui.Window();
        atlasDialog.modal = true;
        const atlasContent = fgui.UIPackage.createObject("Builder", "AtlasDefinitionDialog").asCom;
        addDialogBackground(atlasContent);
        const atlasList = atlasContent.getChild("atlasList").asList;
        const resourceList = atlasContent.getChild("resList").asList;
        const max = atlasContent.getChild("max").asLabel;
        const compression = atlasContent.getChild("compression").asButton;
        let currentPublish = object(draft.publish);
        let atlases = (Array.isArray(currentPublish.atlases) ? currentPublish.atlases : []).map((entry) => ({
            index: Number(object(entry).index),
            name: String(object(entry).name || ""),
            compression: object(entry).compression === true,
        })).filter((entry) => Number.isInteger(entry.index));
        let selectedAtlas = 0;
        max.title = String(Number(currentPublish.maxAtlasIndex ?? 10));
        const storeAtlas = (): void => {
            const atlas = atlases[selectedAtlas];
            if (atlas) atlas.compression = compression.selected;
        };
        const renderResources = (): void => {
            resourceList.removeChildrenToPool();
            const atlas = atlases[selectedAtlas];
            const resources = Array.isArray(pkg.resources) ? pkg.resources.map(object) : [];
            for (const resource of resources.filter((candidate) => candidate.kind === "image" || candidate.kind === "movieClip" || candidate.kind === "font")) {
                const item = resourceList.addItemFromPool().asButton;
                item.title = String(resource.name || resource.id || "resource");
                item.data = { resourceId: String(resource.id || ""), kind: String(resource.kind || "") };
                item.selected = Boolean(atlas && resource.kind === "image" && imageAtlasMode(pkg, resource) === String(atlas.index));
                item.touchable = Boolean(atlas && resource.kind === "image");
                item.grayed = resource.kind !== "image";
                item.tooltips = resource.kind === "image"
                    ? "点击切换该图片是否属于当前 Atlas 页。"
                    : "当前 OpenFairyGUI UAM 未给 MovieClip/Font 暴露 textureSetMode，浏览器端不能安全改写其 Atlas 归属。";
            }
        };
        const renderAtlases = (): void => {
            atlasList.removeChildrenToPool();
            atlases.sort((left, right) => left.index - right.index);
            atlases.forEach((atlas) => {
                const item = atlasList.addItemFromPool().asButton;
                item.getChild("index").text = String(atlas.index);
                item.getChild("name").asLabel.title = atlas.name;
            });
            selectedAtlas = Math.max(0, Math.min(selectedAtlas, atlases.length - 1));
            atlasList.selectedIndex = atlases.length ? selectedAtlas : -1;
            compression.selected = atlases[selectedAtlas]?.compression === true;
            renderResources();
        };
        atlasList.on(fgui.Events.CLICK_ITEM, options.eventOwner, () => {
            storeAtlas();
            selectedAtlas = atlasList.selectedIndex;
            compression.selected = atlases[selectedAtlas]?.compression === true;
            renderResources();
        });
        resourceList.on(fgui.Events.CLICK_ITEM, options.eventOwner, (itemObject: fgui.GObject) => {
            const atlas = atlases[selectedAtlas];
            const data = itemObject.data as { resourceId?: string; kind?: string } | null;
            if (!atlas || data?.kind !== "image" || !data.resourceId) return;
            const resource = (pkg.resources || []).map(object).find((candidate) => candidate.id === data.resourceId);
            if (!resource) return;
            const key = imageAtlasKey(pkg.id, data.resourceId);
            pendingImageAtlasModes.set(
                key,
                imageAtlasMode(pkg, resource) === String(atlas.index) ? "" : String(atlas.index),
            );
            renderResources();
        });
        const addAtlas = createInspectorButton(atlasContent, "addAtlas", "新建", 200, 449, 48);
        const removeAtlas = createInspectorButton(atlasContent, "removeAtlas", "删除", 254, 449, 48);
        const renameAtlas = createInspectorButton(atlasContent, "renameAtlas", "重命名", 308, 449, 60);
        addAtlas.onClick(options.eventOwner, () => {
            storeAtlas();
            const used = new Set(atlases.map((atlas) => atlas.index));
            let index = 0;
            while (used.has(index)) index += 1;
            const name = window.prompt("纹理集名称", `atlas-${index}`)?.trim();
            if (!name) return;
            atlases.push({ index, name, compression: false });
            selectedAtlas = atlases.length - 1;
            renderAtlases();
        });
        removeAtlas.onClick(options.eventOwner, () => {
            const removed = atlases[selectedAtlas];
            if (!removed) return;
            for (const resource of (pkg.resources || []).map(object).filter((candidate) => candidate.kind === "image")) {
                if (imageAtlasMode(pkg, resource) === String(removed.index)) {
                    pendingImageAtlasModes.set(imageAtlasKey(pkg.id, String(resource.id || "")), "");
                }
            }
            atlases.splice(selectedAtlas, 1);
            selectedAtlas = Math.max(0, selectedAtlas - 1);
            renderAtlases();
        });
        renameAtlas.onClick(options.eventOwner, () => {
            const atlas = atlases[selectedAtlas];
            if (!atlas) return;
            const name = window.prompt("纹理集名称", atlas.name)?.trim();
            if (!name) return;
            atlas.name = name;
            renderAtlases();
        });
        atlasContent.getChild("close").asButton.onClick(options.eventOwner, () => {
            storeAtlas();
            const maxAtlasIndex = Number(max.title);
            if (!Number.isInteger(maxAtlasIndex) || maxAtlasIndex < 0 || maxAtlasIndex > 255
                || atlases.some((atlas) => atlas.index < 0 || atlas.index > maxAtlasIndex)) {
                options.setStatus("Atlas indexes must be integers between 0 and the maximum atlas index.");
                return;
            }
            currentPublish = { ...currentPublish, maxAtlasIndex, atlases };
            draft.publish = currentPublish;
            atlasDialog.dispose();
        });
        renderAtlases();
        atlasDialog.contentPane = atlasContent;
        atlasDialog.show();
        atlasDialog.centerOn(fgui.GRoot.inst, true);
    });

    const packageList = content.getChild("pkgs").asList;
    packageList.removeChildrenToPool();
    const globalItem = packageList.addItemFromPool().asButton;
    globalItem.title = "Global Settings";
    globalItem.data = "";
    for (const pkg of project.packages) {
        const item = packageList.addItemFromPool().asButton;
        item.title = pkg.name;
        item.data = pkg.id;
    }
    packageList.on(fgui.Events.CLICK_ITEM, options.eventOwner, (itemObject: fgui.GObject) => {
        const packageId = String(itemObject.data ?? "");
        if (packageId) showPackage(packageId);
        else {
            storePackagePanel();
            selectedPackageId = "";
            controller.selectedIndex = 1;
        }
    });
    packageList.selectedIndex = 0;
    controller.selectedIndex = 1;
    content.getChild("publishDesc").asButton.title = "发布已修改";
    content.getChild("publishDesc").enabled = true;
    content.getChild("publishDesc").tooltips = "仅重新发布本次浏览器会话中修改过的包。";

    const commitAndPublish = async (mode: "current" | "modified" | "all"): Promise<void> => {
        storePackagePanel();
        const jpegQuality = Number(text(globalPanel, "jpegQuality"));
        if (!Number.isInteger(jpegQuality) || jpegQuality < 0 || jpegQuality > 100) {
            options.setStatus("Publish settings skipped: JPEG quality must be an integer from 0 to 100.");
            return;
        }
        projectSettings.publish = {
            ...publish,
            path: text(globalPanel, "path"),
            branchPath: text(globalPanel, "branchPath"),
            fileExtension: text(globalPanel, "fileExtension"),
            binaryFormat: globalPanel.getChild("binaryFormat").asButton.selected,
            compressDesc: globalPanel.getChild("compressDesc").asButton.selected,
            packageCount: globalPanel.getChild("twoPackages").asButton.selected ? 2 : 1,
            branchProcessing: Number(globalPanel.getChild("branchProcessing").asComboBox.value),
            seperatedAtlasForBranch: globalPanel.getChild("seperatedAtlasForBranch").asButton.selected,
            includeHighResolution: (globalPanel.getChild("2x").asButton.selected ? 1 : 0)
                | (globalPanel.getChild("3x").asButton.selected ? 2 : 0)
                | (globalPanel.getChild("4x").asButton.selected ? 4 : 0),
            jpegQuality,
            compressPNG: globalPanel.getChild("compressPNG").asComboBox.selectedIndex === 1,
            atlasSetting: {
                ...atlas,
                maxSize: Number(globalPanel.getChild("maxAtlasSize").asComboBox.value),
                paging: globalPanel.getChild("paging").asButton.selected,
                sizeOption: globalPanel.getChild("sizeOption").asComboBox.value,
                forceSquare: globalPanel.getChild("square").asButton.selected,
                allowRotation: globalPanel.getChild("rotation").asButton.selected,
                trimImage: globalPanel.getChild("trimImage").asButton.selected,
            },
        };
        const workingProject = options.getWorkingProject();
        const preparation = prepareUpdateSettingsBatch(
            workingProject,
            projectSettings,
            project.packages!.map((pkg) => ({ selector: { packageId: pkg.id }, settings: drafts.get(pkg.id)! })),
        );
        if (preparation.ok === false && preparation.code !== "settings_unchanged") {
            await options.applyPreparation(preparation);
            return;
        }
        const transactions: EditorHighRiskTransaction[] = preparation.ok ? [preparation.transaction] : [];
        for (const [key, textureSetMode] of pendingImageAtlasModes) {
            const [packageId, resourceId] = key.split("\0");
            const currentProject = workingProject as { packages?: PackageLike[] } | null;
            const resource = currentProject?.packages?.find((pkg) => pkg.id === packageId)
                ?.resources?.map(object).find((candidate) => candidate.id === resourceId);
            if (!resource || resource.kind !== "image") continue;
            const imagePreparation = prepareSetImageResourceProps(
                workingProject,
                { packageId, resourceId },
                { ...readImageResourceProps(resource), textureSetMode },
            );
            if (imagePreparation.ok) transactions.push(imagePreparation.transaction);
            else if (imagePreparation.code !== "image_properties_unchanged") {
                await options.applyPreparation(imagePreparation);
                return;
            }
        }
        if (transactions.length) {
            const operations = transactions.flatMap((transaction) => transaction.operations || [transaction.operation]);
            const inverseOperations = transactions.slice().reverse()
                .flatMap((transaction) => transaction.inverseOperations || [transaction.inverseOperation]);
            if (!await options.applyPreparation({
                ok: true,
                transaction: {
                    summary: "Update publish settings and Atlas membership",
                    operation: operations[0] as EditorHighRiskTransaction["operation"],
                    inverseOperation: inverseOperations[0],
                    operations,
                    inverseOperations,
                },
            })) return;
        }
        dialog.dispose();
        await options.publish(mode);
    };
    content.getChild("publish").asButton.onClick(options.eventOwner, () => void commitAndPublish("current"));
    content.getChild("publishDesc").asButton.onClick(options.eventOwner, () => void commitAndPublish("modified"));
    content.getChild("publishAll").asButton.onClick(options.eventOwner, () => void commitAndPublish("all"));
    content.getChild("close").asButton.onClick(options.eventOwner, () => dialog.dispose());
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, () => {
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    });
    options.setActiveDialog(dialog);
    dialog.show();
    options.setStatus("Editing Laya/Vite publish settings. Save the workspace before publishing changed settings.");
}
