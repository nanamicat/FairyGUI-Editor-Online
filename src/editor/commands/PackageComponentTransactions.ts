import type {
    ComponentEditableProperties,
    EditorComponentSelector,
    EditorResourceSelector,
} from "../model/EditorCommand";
import type { HighRiskTransactionPreparation } from "./AuthoringTransactionTypes";
import {
    findTypedPackageExternalDependencyIds,
    rewriteFairyPackageOwnerReferences,
} from "../services/FairyPackageTransfer";
import {
    UamResourceLike,
    UamPackageLike,
    UamComponentLike,
    UamDisplayNodeLike,
    UamControllerLike,
    UamTransitionLike,
    createDefaultUamDisplayNodeBase,
    getHighRiskWorkingProject,
    findPackage,
    findResource,
    findComponent,
    hasUnsupportedIncomingComponentReference,
    findComponentMoveReferenceRewrites,
    referencesSourcePackage,
    referencesPackage,
    readComponentReference,
    isRetargetableComponentReference,
    normalizeResourcePath,
    createCopyId,
    createAddResourceSnapshot,
    createCopyName,
    createOpId,
    copySourcePackageDisplayDependencies,
    cloneJson,
    missingResource,
} from "./AuthoringTransactionSupport";
import { readListProperties, readLoaderProperties, readTextProperties } from "./DisplayListTransactions";

export function readComponentProperties(component: UamComponentLike): ComponentEditableProperties {
    const properties = component.properties;
    return {
        minSize: {
            width: Number(properties?.minSize?.width || 0),
            height: Number(properties?.minSize?.height || 0),
        },
        maxSize: {
            width: Number(properties?.maxSize?.width || 0),
            height: Number(properties?.maxSize?.height || 0),
        },
        pivot: {
            x: Number(properties?.pivot?.x || 0),
            y: Number(properties?.pivot?.y || 0),
        },
        pivotAsAnchor: Boolean(properties?.pivotAsAnchor),
        overflow: Number(properties?.overflow || 0),
        margin: {
            top: Number(properties?.margin?.top || 0),
            bottom: Number(properties?.margin?.bottom || 0),
            left: Number(properties?.margin?.left || 0),
            right: Number(properties?.margin?.right || 0),
        },
        clipSoftness: {
            x: Number(properties?.clipSoftness?.x || 0),
            y: Number(properties?.clipSoftness?.y || 0),
        },
        hitTest: String(properties?.hitTest || ""),
        mask: String(properties?.mask || ""),
        reversedMask: Boolean(properties?.reversedMask),
        scrollType: Number(properties?.scrollType ?? 1),
        scrollBarDisplay: Number(properties?.scrollBarDisplay || 0),
        scrollBarFlags: Number(properties?.scrollBarFlags || 0),
        scrollBarMargin: {
            top: Number(properties?.scrollBarMargin?.top || 0),
            bottom: Number(properties?.scrollBarMargin?.bottom || 0),
            left: Number(properties?.scrollBarMargin?.left || 0),
            right: Number(properties?.scrollBarMargin?.right || 0),
        },
        vtScrollBarRes: String(properties?.vtScrollBarRes || ""),
        hzScrollBarRes: String(properties?.hzScrollBarRes || ""),
        headerRes: String(properties?.headerRes || ""),
        footerRes: String(properties?.footerRes || ""),
        bgColor: String(properties?.bgColor || ""),
        bgColorEnabled: Boolean(properties?.bgColorEnabled),
        designImageAlpha: Number(properties?.designImageAlpha || 0),
        designImageLayer: Number(properties?.designImageLayer || 0),
        designImageOffset: {
            x: Number(properties?.designImageOffset?.x || 0),
            y: Number(properties?.designImageOffset?.y || 0),
        },
        idNum: Number(properties?.idNum || 0),
        initName: String(properties?.initName || ""),
        remark: String(properties?.remark || ""),
        extensionType: String(properties?.extensionType || ""),
        opaque: properties?.opaque !== false,
        buttonMode: Number(properties?.buttonMode || 0),
        sound: String(properties?.sound || ""),
        soundVolumeScale: Number(properties?.soundVolumeScale ?? 1),
        downEffect: Number(properties?.downEffect || 0),
        downEffectValue: Number(properties?.downEffectValue ?? 0.8),
        dropdown: String(properties?.dropdown || ""),
        promptText: String(properties?.promptText || ""),
        selectionController: String(properties?.selectionController || ""),
        titleType: Number(properties?.titleType || 0),
        reverse: Boolean(properties?.reverse),
        wholeNumbers: Boolean(properties?.wholeNumbers),
        changeOnClick: properties?.changeOnClick !== false,
        fixedGripSize: Boolean(properties?.fixedGripSize),
        autoClearItems: Boolean(properties?.autoClearItems),
        customProperties: Array.isArray(properties?.customProperties)
            ? properties.customProperties.map((property) => ({ ...property }))
            : [],
    };
}

export function componentCustomPropertyTargetExists(
    projectValue: unknown,
    selector: EditorComponentSelector,
    target: string,
): boolean {
    const segments = target.split(".");
    let packageId = selector.packageId;
    let component = findComponent(projectValue, selector);
    for (let index = 0; component && index < segments.length; index += 1) {
        const node = component.displayList?.find((child) => child.name === segments[index]);
        if (!node) return false;
        if (index === segments.length - 1) return true;
        if (node.kind !== "component" || !node.resource?.resourceId) return false;
        packageId = node.resource.packageId || packageId;
        component = findComponent(projectValue, {
            packageId,
            componentResourceId: node.resource.resourceId,
        });
    }
    return false;
}

export function prepareAddPackage(projectValue: unknown): HighRiskTransactionPreparation {
    const project = getHighRiskWorkingProject(projectValue);
    if (!project) return { ok: false, code: "project_not_loaded", message: "The UAM working project is unavailable." };
    const packages = project.packages || [];
    const id = createCopyId(packages, "imported_package");
    const name = createCopyName(packages, "NewPackage");
    const pkg = {
        id,
        name,
        publish: {
            name,
            path: "",
            branchPath: "",
            packageCount: 0,
            genCode: false,
            codePath: "",
        },
        resources: [] as UamResourceLike[],
    };
    return {
        ok: true,
        transaction: {
            summary: `Add empty package ${name}`,
            operation: { opId: createOpId("add-package"), kind: "addPackage", package: pkg, atIndex: packages.length },
            inverseOperation: { opId: createOpId("remove-package-undo"), kind: "removePackage", selector: { packageId: id } },
        },
    };
}

export function findPackageExternalDependencyIds(
    value: unknown,
    ownerPackageId: string,
): string[] {
    return findTypedPackageExternalDependencyIds(value, ownerPackageId);
}

export function prepareImportPackage(
    projectValue: unknown,
    importedPackageValue: unknown,
    targetName: string,
): HighRiskTransactionPreparation {
    const project = getHighRiskWorkingProject(projectValue);
    if (!project) return { ok: false, code: "project_not_loaded", message: "The UAM working project is unavailable." };
    if (!importedPackageValue || typeof importedPackageValue !== "object") {
        return { ok: false, code: "fairy_package_invalid_snapshot", message: "The imported FairyGUI package snapshot is invalid." };
    }
    const importedPackage = importedPackageValue as UamPackageLike & { publish?: Record<string, unknown> };
    const sourceId = String(importedPackage.id || "");
    const normalizedName = targetName.trim();
    if (!/^[A-Za-z0-9]{8}$/.test(sourceId) || !Array.isArray(importedPackage.resources)) {
        return { ok: false, code: "fairy_package_invalid_snapshot", message: "The imported FairyGUI package snapshot is missing its package id or resources." };
    }
    if (!normalizedName || normalizedName === "." || normalizedName === ".." || /[\\/:*?"<>|]/.test(normalizedName)) {
        return { ok: false, code: "invalid_package_name", message: "The imported package name is invalid." };
    }
    if ((project.packages || []).some((pkg) => String(pkg.name || "").toLowerCase() === normalizedName.toLowerCase())) {
        return { ok: false, code: "duplicate_package_name", message: `Package ${normalizedName} already exists.` };
    }
    const externalPackageIds = findPackageExternalDependencyIds(importedPackage, sourceId);
    if (externalPackageIds.length > 0) {
        return {
            ok: false,
            code: "fairy_package_external_dependencies_unsupported",
            message: `The imported package references external package ids: ${externalPackageIds.join(", ")}.`,
        };
    }
    const missingBytes = importedPackage.resources.find((resource) => (
        resource.kind !== "component" && !(resource.sourceBytes instanceof Uint8Array)
    ));
    if (missingBytes) {
        return {
            ok: false,
            code: "fairy_package_bytes_unavailable",
            message: `Resource ${missingBytes.name || missingBytes.id || "unknown"} has no hydrated source bytes.`,
        };
    }

    const packageId = createImportedPackageId(project.packages || [], `${sourceId}:${normalizedName}`);
    const imported = cloneJson(importedPackage) as UamPackageLike & { publish?: Record<string, unknown> };
    // TODO(transfer): replace this whole-package string remapper with the shared typed reference visitor.
    remapPackageOwnerReferences(imported, sourceId, packageId);
    imported.id = packageId;
    imported.name = normalizedName;
    imported.publish = { ...(imported.publish || {}), name: normalizedName };
    const missingBranches = [...new Set(
        ((imported as UamPackageLike & { branchNames?: string[] }).branchNames || [])
            .filter((branch) => !(project.branches || []).includes(branch)),
    )];
    const operation = {
        opId: createOpId("import-package"),
        kind: "addPackage" as const,
        package: imported,
        atIndex: (project.packages || []).length,
    };
    const inverseOperation = {
        opId: createOpId("import-package-undo"),
        kind: "removePackage" as const,
        selector: { packageId },
    };
    return {
        ok: true,
        transaction: {
            summary: `Import FairyGUI package ${normalizedName}`,
            operation,
            inverseOperation,
            ...(missingBranches.length ? {
                operations: [
                    ...missingBranches.map((branch) => ({ opId: createOpId("import-branch"), kind: "addBranch" as const, branch })),
                    operation,
                ],
                inverseOperations: [
                    inverseOperation,
                    ...missingBranches.slice().reverse().map((branch) => ({
                        opId: createOpId("import-branch-undo"),
                        kind: "removeBranch" as const,
                        selector: { branch },
                    })),
                ],
            } : {}),
        },
    };
}

function createImportedPackageId(packages: UamPackageLike[], seed: string): string {
    const existing = new Set(packages.map((pkg) => pkg.id));
    for (let attempt = 0; ; attempt += 1) {
        let hash = 0x811c9dc5;
        for (const char of `${seed}:${attempt}`) {
            hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
        }
        const candidate = hash.toString(36).padStart(8, "0").slice(-8);
        if (!existing.has(candidate)) return candidate;
    }
}

function remapPackageOwnerReferences(value: unknown, sourceId: string, targetId: string): unknown {
    return rewriteFairyPackageOwnerReferences(value, sourceId, targetId);
}

export function prepareRenamePackage(
    projectValue: unknown,
    selector: { packageId: string },
    newName: string,
): HighRiskTransactionPreparation {
    const project = getHighRiskWorkingProject(projectValue);
    const pkg = findPackage(projectValue, selector.packageId);
    const normalizedName = newName.trim();
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    if (!normalizedName) return { ok: false, code: "invalid_package_name", message: "Package name cannot be empty." };
    if (normalizedName === pkg.name) return { ok: false, code: "package_name_unchanged", message: "Package name is unchanged." };
    if (project?.packages?.some((item) => item.id !== pkg.id && item.name === normalizedName)) {
        return { ok: false, code: "duplicate_package_name", message: "Package names must be unique." };
    }
    return {
        ok: true,
        transaction: {
            summary: `Rename package ${pkg.name || pkg.id || selector.packageId}`,
            operation: { opId: createOpId("rename-package"), kind: "renamePackage", selector, newName: normalizedName },
            inverseOperation: {
                opId: createOpId("rename-package-undo"),
                kind: "renamePackage",
                selector,
                newName: String(pkg.name || pkg.id || ""),
            },
        },
    };
}

export function prepareRemovePackage(
    projectValue: unknown,
    selector: { packageId: string },
): HighRiskTransactionPreparation {
    const project = getHighRiskWorkingProject(projectValue);
    if (!project) return { ok: false, code: "project_not_loaded", message: "The UAM working project is unavailable." };
    const pkg = findPackage(projectValue, selector.packageId);
    const index = project.packages?.findIndex((item) => item.id === selector.packageId) ?? -1;
    if (!pkg || index < 0) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    if ((pkg.resources || []).some((resource) =>
        resource.kind !== "component" && !(resource.sourceBytes instanceof Uint8Array)
    )) {
        return {
            ok: false,
            code: "package_source_bytes_unavailable",
            message: "Package removal requires hydrated source bytes for every asset so Undo can restore the package.",
        };
    }
    const encodedReference = `ui://${selector.packageId}`;
    const containsEncodedReference = (value: unknown): boolean => {
        if (typeof value === "string") return value.includes(encodedReference);
        if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return false;
        return Object.values(value).some(containsEncodedReference);
    };
    const projectRecord = projectValue as Record<string, unknown>;
    if (
        Object.entries(projectRecord).some(([key, value]) => key !== "packages" && containsEncodedReference(value))
        || (project.packages || []).some((candidate) => candidate.id !== selector.packageId && containsEncodedReference(candidate))
    ) {
        return {
            ok: false,
            code: "package_reference_rewrite_unsupported",
            message: "Package removal cannot rewrite external ui:// references outside direct display resources.",
        };
    }
    const incomingReferences: Array<{
        selector: EditorComponentSelector;
        atIndex: number;
        node: UamDisplayNodeLike;
    }> = [];
    for (const ownerPackage of project.packages || []) {
        if (!ownerPackage.id || ownerPackage.id === selector.packageId) continue;
        for (const resource of ownerPackage.resources || []) {
            if (resource.kind !== "component" || !resource.id) continue;
            for (const [atIndex, node] of (resource.component?.displayList || []).entries()) {
                if (!referencesPackage(node, ownerPackage.id, selector.packageId)) continue;
                const reference = readComponentReference(node, ownerPackage.id);
                if (!node.id || reference?.packageId !== selector.packageId) {
                    return {
                        ok: false,
                        code: "package_reference_rewrite_unsupported",
                        message: "Package removal can restore external component and derived-control references; other display dependencies remain closed.",
                    };
                }
                incomingReferences.push({
                    selector: { packageId: ownerPackage.id, componentResourceId: resource.id },
                    atIndex,
                    node: cloneJson(node),
                });
            }
        }
    }
    const operation = { opId: createOpId("remove-package"), kind: "removePackage" as const, selector };
    const inverseOperation = {
        opId: createOpId("add-package-undo"),
        kind: "addPackage" as const,
        package: cloneJson(pkg),
        atIndex: index,
    };
    return {
        ok: true,
        transaction: {
            summary: `Remove package ${pkg.name || pkg.id || selector.packageId}`
                + `${incomingReferences.length ? ` and detach ${incomingReferences.length} external display reference${incomingReferences.length === 1 ? "" : "s"}` : ""}`,
            operation,
            inverseOperation,
            ...(incomingReferences.length ? {
                operations: [
                    ...incomingReferences.map(({ selector: owner, node }) => ({
                        opId: createOpId("detach-package-reference"),
                        kind: "detachDisplayNode" as const,
                        selector: { ...owner, displayNodeId: String(node.id || "") },
                    })),
                    operation,
                ],
                inverseOperations: [
                    inverseOperation,
                    ...incomingReferences.map(({ selector: owner, atIndex, node }) => ({
                        opId: createOpId("attach-package-reference-undo"),
                        kind: "attachDisplayNode" as const,
                        selector: owner,
                        atIndex,
                        node,
                    })),
                ],
            } : {}),
        },
    };
}

export function prepareAddComponent(
    projectValue: unknown,
    selector: { packageId: string },
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    const resources = pkg.resources || [];
    const name = createCopyName(resources, "NewComponent");
    return prepareAddComponentSnapshot(projectValue, selector, {
        name,
        path: "/",
        component: {
            size: { width: 64, height: 64 },
            properties: readComponentProperties({}),
            customData: "",
            displayList: [] as UamDisplayNodeLike[],
            controllers: [] as UamControllerLike[],
            transitions: [] as UamTransitionLike[],
        },
        summary: `Add empty component ${name}`,
    });
}

export function prepareAddLabelComponent(
    projectValue: unknown,
    selector: { packageId: string },
    input: { name: string; path: string; width: number; height: number },
): HighRiskTransactionPreparation {
    const project = getHighRiskWorkingProject(projectValue);
    const fontSize = Number(project?.settings?.common?.fontSize || 12);
    const textColor = String(project?.settings?.common?.textColor || "#000000");
    return prepareAddComponentSnapshot(projectValue, selector, {
        name: input.name,
        path: input.path,
        component: {
            size: { width: input.width, height: input.height },
            properties: readComponentProperties({ properties: { extensionType: "Label" } }),
            customData: "",
            displayList: [
                createTextTemplateNode("n0", "title", input.width, input.height, fontSize, textColor),
            ],
            controllers: [],
            transitions: [],
        },
        summary: `Add Label component ${input.name.trim()}`,
    });
}

export function prepareAddButtonComponent(
    projectValue: unknown,
    selector: { packageId: string },
    input: {
        name: string;
        path: string;
        width: number;
        height: number;
        buttonMode: number;
        includeTitle: boolean;
        includeIcon: boolean;
    },
): HighRiskTransactionPreparation {
    if (![0, 1, 2].includes(input.buttonMode)) {
        return { ok: false, code: "invalid_button_mode", message: "Button mode must be Common, Check, or Radio." };
    }
    const project = getHighRiskWorkingProject(projectValue);
    const fontSize = Number(project?.settings?.common?.fontSize || 12);
    const textColor = String(project?.settings?.common?.textColor || "#000000");
    const displayList: UamDisplayNodeLike[] = [
        createButtonGraphTemplateNode("n0", "background", input.width, input.height, "#F0F0F0", ["0"]),
        createButtonGraphTemplateNode("n1", "over", input.width, input.height, "#FAFAFA", ["2"]),
        createButtonGraphTemplateNode("n2", "down", input.width, input.height, "#CCCCCC", ["1", "3"]),
    ];
    if (input.includeTitle) {
        displayList.push(createTextTemplateNode("n3", "title", input.width, input.height, fontSize, textColor));
    }
    if (input.includeIcon) {
        displayList.push({
            ...createDisplayTemplateNode("loader", input.includeTitle ? "n4" : "n3", "icon", input.width, input.height),
            pivot: { x: 0, y: 0 },
            pivotAsAnchor: false,
            ...readLoaderProperties({ align: 1, vAlign: 1 }),
            relations: createRootSizeRelations(),
        });
    }

    return prepareAddComponentSnapshot(projectValue, selector, {
        name: input.name,
        path: input.path,
        component: {
            size: { width: input.width, height: input.height },
            properties: readComponentProperties({
                properties: {
                    extensionType: "Button",
                    buttonMode: input.buttonMode,
                },
            }),
            customData: "",
            displayList,
            controllers: [createButtonController()],
            transitions: [],
        },
        summary: `Add Button component ${input.name.trim()}`,
    });
}

export function prepareAddComboBoxComponent(
    projectValue: unknown,
    selector: { packageId: string },
    input: { name: string; path: string },
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    const reserved = [...(pkg.resources || [])];
    const itemId = createCopyId(reserved, "imported_component");
    reserved.push({ id: itemId });
    const popupId = createCopyId(reserved, "imported_component");
    reserved.push({ id: popupId });
    const mainId = createCopyId(reserved, "imported_component");
    const name = input.name.trim();
    const itemName = `${name}_item`;
    const popupName = `${name}_popup`;
    const font = getTemplateFont(projectValue);
    const itemDisplayList = [createTextTemplateNode("n0", "title", 150, 24, font.size, font.color)];
    const popupList = createListTemplateNode("n1", "list", 150, 200, `ui://${pkg.id}${itemId}`);
    return prepareAddComponentRecipe(projectValue, selector, [
        {
            id: itemId,
            name: itemName,
            path: input.path,
            component: createTemplateComponent(150, 24, "Button", itemDisplayList, { buttonMode: 2 }, [createButtonController()]),
        },
        {
            id: popupId,
            name: popupName,
            path: input.path,
            component: createTemplateComponent(150, 200, "", [
                createPlainGraphTemplateNode("n0", "background", 150, 200, "#F0F0F0"),
                popupList,
            ]),
        },
        {
            id: mainId,
            name,
            path: input.path,
            component: createTemplateComponent(150, 30, "ComboBox", [
                createPlainGraphTemplateNode("n0", "background", 150, 30, "#F0F0F0"),
                createTextTemplateNode("n1", "title", 130, 30, font.size, font.color),
            ], { dropdown: `ui://${pkg.id}${popupId}` }),
        },
    ], `Add ComboBox recipe ${name}`, mainId);
}

export function prepareAddProgressBarComponent(
    projectValue: unknown,
    selector: { packageId: string },
    input: { name: string; path: string; titleType: number; reverse: boolean },
): HighRiskTransactionPreparation {
    if (!Number.isInteger(input.titleType) || input.titleType < 0 || input.titleType > 4) {
        return { ok: false, code: "invalid_title_type", message: "Title type must be None, Percent, Value/Max, Value, or Max." };
    }
    const font = getTemplateFont(projectValue);
    const displayList = [
        createPlainGraphTemplateNode("n0", "background", 200, 20, "#F0F0F0"),
        { ...createPlainGraphTemplateNode("n1", "bar", 200, 6, "#3399FF"), position: { x: 0, y: 7 } },
    ];
    if (input.titleType !== 0) displayList.push(createTextTemplateNode("n2", "title", 200, 20, font.size, font.color));
    return prepareAddComponentSnapshot(projectValue, selector, {
        name: input.name,
        path: input.path,
        component: createTemplateComponent(200, 20, "ProgressBar", displayList, {
            titleType: input.titleType,
            reverse: input.reverse,
        }),
        summary: `Add ProgressBar component ${input.name.trim()}`,
    });
}

export function prepareAddSliderComponent(
    projectValue: unknown,
    selector: { packageId: string },
    input: { name: string; path: string; orientation: number; titleType: number },
): HighRiskTransactionPreparation {
    if (![0, 1].includes(input.orientation)) {
        return { ok: false, code: "invalid_orientation", message: "Slider orientation must be Horizontal or Vertical." };
    }
    if (!Number.isInteger(input.titleType) || input.titleType < 0 || input.titleType > 4) {
        return { ok: false, code: "invalid_title_type", message: "Title type must be None, Percent, Value/Max, Value, or Max." };
    }
    const horizontal = input.orientation === 0;
    const width = horizontal ? 200 : 20;
    const height = horizontal ? 20 : 200;
    const bar = createPlainGraphTemplateNode("n1", "bar", horizontal ? width : 6, horizontal ? 6 : height, "#3399FF");
    bar.position = horizontal ? { x: 0, y: 7 } : { x: 7, y: 0 };
    const grip = createPlainGraphTemplateNode("n2", "grip", 20, 20, "#A9DBF6", true);
    grip.position = horizontal ? { x: 0, y: 0 } : { x: 0, y: 0 };
    const displayList = [
        createPlainGraphTemplateNode("n0", "background", width, height, "#F0F0F0"),
        bar,
        grip,
    ];
    if (input.titleType !== 0) {
        const font = getTemplateFont(projectValue);
        displayList.push(createTextTemplateNode("n3", "title", width, height, font.size, font.color));
    }
    return prepareAddComponentSnapshot(projectValue, selector, {
        name: input.name,
        path: input.path,
        component: createTemplateComponent(width, height, "Slider", displayList, { titleType: input.titleType }),
        summary: `Add Slider component ${input.name.trim()}`,
    });
}

export function prepareAddScrollBarComponent(
    projectValue: unknown,
    selector: { packageId: string },
    input: { name: string; path: string; orientation: number; includeArrows: boolean },
): HighRiskTransactionPreparation {
    if (![0, 1].includes(input.orientation)) {
        return { ok: false, code: "invalid_orientation", message: "ScrollBar orientation must be Vertical or Horizontal." };
    }
    const vertical = input.orientation === 0;
    const width = vertical ? 17 : 200;
    const height = vertical ? 200 : 17;
    const arrowSize = input.includeArrows ? 17 : 0;
    const displayList: UamDisplayNodeLike[] = [
        createPlainGraphTemplateNode("n0", "background", width, height, "#F0F0F0"),
        createPlainGraphTemplateNode("n1", "bar", width, height, "#E0E0E0"),
    ];
    if (input.includeArrows) {
        const arrow1 = createPlainGraphTemplateNode("n2", "arrow1", 17, 17, "#A9DBF6", true);
        const arrow2 = createPlainGraphTemplateNode("n3", "arrow2", 17, 17, "#A9DBF6", true);
        arrow2.position = vertical ? { x: 0, y: height - 17 } : { x: width - 17, y: 0 };
        displayList.push(arrow1, arrow2);
    }
    const grip = createPlainGraphTemplateNode("n4", "grip", vertical ? width : 20, vertical ? 20 : height, "#7CB7D8", true);
    grip.position = vertical ? { x: 0, y: arrowSize } : { x: arrowSize, y: 0 };
    displayList.push(grip);
    return prepareAddComponentSnapshot(projectValue, selector, {
        name: input.name,
        path: input.path,
        component: createTemplateComponent(width, height, "ScrollBar", displayList),
        summary: `Add ScrollBar component ${input.name.trim()}`,
    });
}

export function prepareAddWindowFrameComponent(
    projectValue: unknown,
    selector: { packageId: string },
    input: { name: string; path: string; titleKind: "none" | "text" | "graph"; includeCloseButton: boolean },
): HighRiskTransactionPreparation {
    const font = getTemplateFont(projectValue);
    const displayList: UamDisplayNodeLike[] = [
        createPlainGraphTemplateNode("n0", "background", 400, 300, "#F0F0F0"),
    ];
    if (input.titleKind === "text") {
        const title = createTextTemplateNode("n1", "title", 400, 30, font.size, font.color);
        title.text = input.name.trim();
        displayList.push(title);
    } else if (input.titleKind === "graph") {
        displayList.push(createPlainGraphTemplateNode("n1", "title", 400, 30, "#D9E8F2"));
    }
    displayList.push(createPlainGraphTemplateNode("n2", "dragArea", 350, 30, "#00000000", true));
    if (input.includeCloseButton) {
        const close = createPlainGraphTemplateNode("n3", "closeButton", 24, 24, "#D9534F", true);
        close.position = { x: 372, y: 4 };
        displayList.push(close);
    }
    return prepareAddComponentSnapshot(projectValue, selector, {
        name: input.name,
        path: input.path,
        component: createTemplateComponent(400, 300, "Label", displayList, { initName: "frame" }),
        summary: `Add WindowFrame recipe ${input.name.trim()}`,
    });
}

export function prepareAddPopupMenuComponent(
    projectValue: unknown,
    selector: { packageId: string },
    input: { name: string; path: string },
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    const itemId = createCopyId(pkg.resources || [], "imported_component");
    const mainId = createCopyId([...(pkg.resources || []), { id: itemId }], "imported_component");
    const font = getTemplateFont(projectValue);
    const name = input.name.trim();
    return prepareAddComponentRecipe(projectValue, selector, [
        {
            id: itemId,
            name: `${name}_item`,
            path: input.path,
            component: createTemplateComponent(180, 24, "Button", [
                createTextTemplateNode("n0", "title", 180, 24, font.size, font.color),
            ], { buttonMode: 2 }, [createButtonController()]),
        },
        {
            id: mainId,
            name,
            path: input.path,
            component: createTemplateComponent(180, 160, "", [
                createPlainGraphTemplateNode("n0", "background", 180, 160, "#F0F0F0"),
                createListTemplateNode("n1", "list", 180, 160, `ui://${pkg.id}${itemId}`),
            ]),
        },
    ], `Add PopupMenu recipe ${name}`, mainId);
}

function prepareAddComponentSnapshot(
    projectValue: unknown,
    selector: { packageId: string },
    input: {
        id?: string;
        name: string;
        path: string;
        component: UamComponentLike;
        summary: string;
    },
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    const resources = pkg.resources || [];
    const name = input.name.trim();
    if (!name || /[\\/]/.test(name)) {
        return { ok: false, code: "invalid_component_name", message: "Component name must be non-empty and cannot contain slashes." };
    }
    if (resources.some((resource) => resource.name === name)) {
        return { ok: false, code: "component_name_conflict", message: `Resource ${name} already exists in the selected package.` };
    }
    const path = normalizeResourcePath(input.path || "/");
    if (!path) {
        return { ok: false, code: "invalid_component_path", message: "Component path must start with /." };
    }
    const width = Number(input.component.size?.width);
    const height = Number(input.component.size?.height);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        return { ok: false, code: "invalid_component_size", message: "Component width and height must be positive integers." };
    }

    const id = input.id || createCopyId(resources, "imported_component");
    if (resources.some((resource) => resource.id === id)) {
        return { ok: false, code: "component_id_conflict", message: `Resource id ${id} already exists in the selected package.` };
    }
    const component = {
        kind: "component",
        id,
        name,
        path,
        exported: false,
        favorite: false,
        branch: "",
        branchItemIds: [] as string[],
        component: input.component,
    };
    return {
        ok: true,
        transaction: {
            summary: input.summary,
            operation: { opId: createOpId("add-component"), kind: "addComponent", selector, component, atIndex: resources.length },
            inverseOperation: {
                opId: createOpId("remove-component-undo"),
                kind: "removeComponent",
                selector: { packageId: selector.packageId, componentResourceId: id },
            },
        },
    };
}

function prepareAddComponentRecipe(
    projectValue: unknown,
    selector: { packageId: string },
    inputs: Array<{ id: string; name: string; path: string; component: UamComponentLike }>,
    summary: string,
    primaryId: string,
): HighRiskTransactionPreparation {
    const workingProject = cloneJson(projectValue);
    const prepared = [];
    for (const input of inputs) {
        const result = prepareAddComponentSnapshot(workingProject, selector, { ...input, summary });
        if (result.ok === false) return result;
        prepared.push(result.transaction);
        const operation = result.transaction.operation;
        if (operation.kind !== "addComponent") {
            return { ok: false, code: "invalid_component_recipe", message: "Component recipe produced a non-component operation." };
        }
        findPackage(workingProject, selector.packageId)?.resources?.splice(
            operation.atIndex,
            0,
            cloneJson(operation.component) as UamResourceLike,
        );
    }
    const primary = prepared.find((entry) => (
        entry.operation.kind === "addComponent"
        && (entry.operation.component as { id?: unknown }).id === primaryId
    )) || prepared[prepared.length - 1];
    const inverse = [...prepared].reverse().map((entry) => entry.inverseOperation);
    return {
        ok: true,
        transaction: {
            summary,
            operation: primary.operation,
            inverseOperation: inverse[0],
            operations: prepared.map((entry) => entry.operation),
            inverseOperations: inverse,
        },
    };
}

function createDisplayTemplateNode(
    kind: string,
    id: string,
    name: string,
    width: number,
    height: number,
): UamDisplayNodeLike {
    return {
        kind,
        id,
        name,
        position: { x: 0, y: 0 },
        size: { width, height },
        ...createDefaultUamDisplayNodeBase(),
        group: "",
    };
}

function createRootSizeRelations(): Array<{ targetNodeId: string; type: number; usePercent: boolean }> {
    return [
        { targetNodeId: "", type: 14, usePercent: false },
        { targetNodeId: "", type: 15, usePercent: false },
    ];
}

function createTextTemplateNode(
    id: string,
    name: string,
    width: number,
    height: number,
    fontSize: number,
    color: string,
): UamDisplayNodeLike {
    const textProperties = readTextProperties({
        kind: "text",
        align: 1,
        vAlign: 1,
        autoSize: 0,
        singleLine: true,
    });
    return {
        ...createDisplayTemplateNode("text", id, name, width, height),
        pivot: { x: 0, y: 0 },
        pivotAsAnchor: false,
        text: "",
        font: "",
        fontSize,
        color,
        ...textProperties,
        relations: createRootSizeRelations(),
    };
}

function createButtonGraphTemplateNode(
    id: string,
    name: string,
    width: number,
    height: number,
    fillColor: string,
    visibleOnPageIds: string[],
): UamDisplayNodeLike {
    return {
        ...createDisplayTemplateNode("graph", id, name, width, height),
        touchable: false,
        locked: false,
        minWidth: 0,
        maxWidth: 0,
        minHeight: 0,
        maxHeight: 0,
        pivot: { x: 0, y: 0 },
        pivotAsAnchor: false,
        skew: { x: 0, y: 0 },
        graphType: 1,
        lineSize: 0,
        lineColor: "#000000",
        fillColor,
        cornerRadius: null,
        points: null,
        sides: 0,
        startAngle: 0,
        distances: null,
        relations: createRootSizeRelations(),
        gears: [{
            kind: "display",
            name: "",
            controllerName: "button",
            visibleOnPageIds,
        }],
    };
}

function getTemplateFont(projectValue: unknown): { size: number; color: string } {
    const project = getHighRiskWorkingProject(projectValue);
    return {
        size: Number(project?.settings?.common?.fontSize || 12),
        color: String(project?.settings?.common?.textColor || "#000000"),
    };
}

function createButtonController(): UamControllerLike {
    return {
        name: "button",
        selectedIndex: 0,
        autoRadioGroupDepth: false,
        alias: "",
        exported: false,
        homePageType: "default",
        homePage: "",
        pages: [
            { id: "0", name: "up" },
            { id: "1", name: "down" },
            { id: "2", name: "over" },
            { id: "3", name: "selectedOver" },
        ],
        actions: [],
    };
}

function createTemplateComponent(
    width: number,
    height: number,
    extensionType: string,
    displayList: UamDisplayNodeLike[],
    propertyOverrides: Partial<ComponentEditableProperties> = {},
    controllers: UamControllerLike[] = [],
): UamComponentLike {
    return {
        size: { width, height },
        properties: readComponentProperties({ properties: {
            extensionType,
            idNum: displayList.length,
            ...propertyOverrides,
        } }),
        customData: "",
        displayList,
        controllers,
        transitions: [],
    };
}

function createPlainGraphTemplateNode(
    id: string,
    name: string,
    width: number,
    height: number,
    fillColor: string,
    touchable = false,
): UamDisplayNodeLike {
    return {
        ...createDisplayTemplateNode("graph", id, name, width, height),
        touchable,
        pivot: { x: 0, y: 0 },
        pivotAsAnchor: false,
        group: "",
        graphType: 1,
        lineSize: 0,
        lineColor: "#000000",
        fillColor,
        cornerRadius: null,
        points: null,
        sides: 0,
        startAngle: 0,
        distances: null,
        relations: createRootSizeRelations(),
    };
}

function createListTemplateNode(
    id: string,
    name: string,
    width: number,
    height: number,
    defaultItem: string,
): UamDisplayNodeLike {
    return {
        ...createDisplayTemplateNode("list", id, name, width, height),
        group: "",
        ...readListProperties({ defaultItem, overflow: 1, scrollType: 1 }),
        relations: createRootSizeRelations(),
    };
}

export function prepareSetComponentSize(
    projectValue: unknown,
    selector: EditorComponentSelector,
    width: number,
    height: number,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, {
        packageId: selector.packageId,
        resourceId: selector.componentResourceId,
    });
    if (!resource || resource.kind !== "component" || !resource.component) {
        return { ok: false, code: "component_not_found", message: "The selected resource is not a component." };
    }
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        return { ok: false, code: "invalid_component_size", message: "Component width and height must be positive integers." };
    }
    const prepared = prepareSetComponentProperties(
        projectValue,
        selector,
        { width, height },
        readComponentProperties(resource.component),
    );
    if (prepared.ok === false && prepared.code === "component_properties_unchanged") {
        return { ok: false, code: "component_size_unchanged", message: "Component size is unchanged." };
    }
    return prepared;
}

export function prepareSetComponentProperties(
    projectValue: unknown,
    selector: EditorComponentSelector,
    size: { width: number; height: number },
    properties: ComponentEditableProperties,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, {
        packageId: selector.packageId,
        resourceId: selector.componentResourceId,
    });
    if (!resource || resource.kind !== "component" || !resource.component) {
        return { ok: false, code: "component_not_found", message: "The selected resource is not a component." };
    }
    if (!Number.isInteger(size.width) || size.width <= 0 || !Number.isInteger(size.height) || size.height <= 0) {
        return { ok: false, code: "invalid_component_size", message: "Component width and height must be positive integers." };
    }
    const finiteNonNegativeSize = (value: { width: number; height: number }): boolean => (
        Number.isFinite(value.width) && value.width >= 0 && Number.isFinite(value.height) && value.height >= 0
    );
    if (
        !finiteNonNegativeSize(properties.minSize)
        || !finiteNonNegativeSize(properties.maxSize)
        || !Number.isFinite(properties.pivot.x)
        || !Number.isFinite(properties.pivot.y)
        || !Number.isInteger(properties.overflow)
        || properties.overflow < 0
        || properties.overflow > 2
        || properties.customProperties.some((property) => (
            !property.target
            || (property.propertyId !== 0 && property.propertyId !== 1)
            || typeof property.label !== "string"
        ))
    ) {
        return { ok: false, code: "invalid_component_properties", message: "Component bounds, pivot, or overflow values are invalid." };
    }
    const currentSize = {
        width: Number(resource.component.size?.width || 0),
        height: Number(resource.component.size?.height || 0),
    };
    const currentProperties = readComponentProperties(resource.component);
    if (
        currentSize.width === size.width
        && currentSize.height === size.height
        && JSON.stringify(currentProperties) === JSON.stringify(properties)
    ) {
        return { ok: false, code: "component_properties_unchanged", message: "Component properties are unchanged." };
    }
    return {
        ok: true,
        transaction: {
            summary: `Update component properties for ${resource.name || resource.id || selector.componentResourceId}`,
            operation: {
                opId: createOpId("set-component-props"),
                kind: "setComponentProps",
                selector,
                props: { size, properties: cloneJson(properties) },
            },
            inverseOperation: {
                opId: createOpId("set-component-props-undo"),
                kind: "setComponentProps",
                selector,
                props: { size: currentSize, properties: cloneJson(currentProperties) },
            },
        },
    };
}

export function prepareMoveComponent(
    projectValue: unknown,
    selector: EditorComponentSelector,
    toPackageId: string,
): HighRiskTransactionPreparation {
    const sourcePackage = findPackage(projectValue, selector.packageId);
    const targetPackage = findPackage(projectValue, toPackageId);
    const resource = findResource(projectValue, {
        packageId: selector.packageId,
        resourceId: selector.componentResourceId,
    });
    const sourceIndex = sourcePackage?.resources?.findIndex((item) => item.id === selector.componentResourceId) ?? -1;
    if (!sourcePackage || !resource || sourceIndex < 0) return missingResource({ packageId: selector.packageId, resourceId: selector.componentResourceId });
    if (!targetPackage) return { ok: false, code: "target_package_not_found", message: `Package ${toPackageId} was not found.` };
    if (toPackageId === selector.packageId) return { ok: false, code: "component_package_unchanged", message: "Choose a different target package." };
    if (resource.kind !== "component" || !resource.component) {
        return { ok: false, code: "component_not_found", message: "The selected resource is not a component." };
    }
    if (targetPackage.resources?.some((item) => item.id === resource.id)) {
        return { ok: false, code: "duplicate_component_id", message: `Target package ${toPackageId} already contains component ${resource.id || selector.componentResourceId}.` };
    }
    if (hasUnsupportedIncomingComponentReference(projectValue, selector)) {
        return {
            ok: false,
            code: "component_reference_rewrite_unsupported",
            message: "Move cannot safely retarget one or more incoming component references.",
        };
    }
    const currentComponentProperties = readComponentProperties(resource.component);
    const currentTransitions = cloneJson(resource.component.transitions || []);
    const dependencyPlan = copySourcePackageDisplayDependencies(
        projectValue,
        selector.packageId,
        toPackageId,
        resource.component.displayList || [],
        targetPackage.resources || [],
        selector,
        {
            properties: currentComponentProperties,
            transitions: currentTransitions,
        },
    );
    if (dependencyPlan.ok === false) return dependencyPlan;
    const binaryDependencyCopies = dependencyPlan.binaryDependencies;
    const componentDependencyCopies = dependencyPlan.componentDependencies;
    const dependencyRewrites: Array<{
        atIndex: number;
        node: UamDisplayNodeLike;
        rewrittenNode: UamDisplayNodeLike;
    }> = [];

    for (const [atIndex, node] of (resource.component.displayList || []).entries()) {
        if (
            !referencesSourcePackage(node, selector.packageId)
            || isRetargetableComponentReference(node, selector.packageId, selector)
        ) {
            continue;
        }
        const originalNode = cloneJson(node);
        const rewrittenNode = dependencyPlan.nodes[atIndex];
        dependencyRewrites.push({ atIndex, node: originalNode, rewrittenNode });
    }
    const rewrites = findComponentMoveReferenceRewrites(projectValue, selector, toPackageId);
    const copiedDependencies = [...binaryDependencyCopies, ...componentDependencyCopies];
    const componentPropertiesRewrite = dependencyPlan.componentProperties
        && JSON.stringify(dependencyPlan.componentProperties) !== JSON.stringify(currentComponentProperties)
        ? dependencyPlan.componentProperties
        : null;
    const transitionRewrites = currentTransitions.flatMap((transition, index) => {
        const rewritten = dependencyPlan.transitions?.[index];
        return rewritten && JSON.stringify(rewritten) !== JSON.stringify(transition)
            ? [{ transition, rewritten }]
            : [];
    });
    if (transitionRewrites.some(({ transition }) => !transition.name)) {
        return {
            ok: false,
            code: "component_transition_name_unavailable",
            message: "A component transition dependency cannot be rewritten because the transition has no name.",
        };
    }
    const componentModelRewriteCount = Number(Boolean(componentPropertiesRewrite)) + transitionRewrites.length;
    const internalRewriteCount = dependencyRewrites.length + componentModelRewriteCount;
    const snapshotMove = componentModelRewriteCount > 0;
    const referenceRewrites = snapshotMove
        ? rewrites.filter(({ selector: owner }) => (
            owner.packageId !== selector.packageId
            || owner.componentResourceId !== selector.componentResourceId
        ))
        : rewrites;
    const hasAtomicMoveChanges = internalRewriteCount > 0
        || referenceRewrites.length > 0
        || copiedDependencies.length > 0;
    const originalComponentSnapshot = createAddResourceSnapshot(resource);
    const rewrittenComponentSnapshot = createAddResourceSnapshot(resource);
    if (snapshotMove && rewrittenComponentSnapshot.component) {
        rewrittenComponentSnapshot.component.displayList = dependencyPlan.nodes;
        rewrittenComponentSnapshot.component.properties = cloneJson(
            dependencyPlan.componentProperties || currentComponentProperties,
        );
        rewrittenComponentSnapshot.component.transitions = cloneJson(
            dependencyPlan.transitions || currentTransitions,
        );
    }
    const operation = {
        opId: createOpId("move-component"),
        kind: "moveComponent" as const,
        selector,
        toPackageId,
        toIndex: targetPackage.resources?.length || 0,
    };
    const inverseOperation = {
        opId: createOpId("move-component-undo"),
        kind: "moveComponent" as const,
        selector: { packageId: toPackageId, componentResourceId: selector.componentResourceId },
        toPackageId: selector.packageId,
        toIndex: sourceIndex,
    };
    return {
        ok: true,
        transaction: {
            summary: `Move component ${resource.name || resource.id || selector.componentResourceId}`
                + `${copiedDependencies.length || internalRewriteCount ? `, ${copiedDependencies.length ? `copy ${copiedDependencies.length} source dependenc${copiedDependencies.length === 1 ? "y" : "ies"} and ` : ""}rewrite ${internalRewriteCount} internal reference${internalRewriteCount === 1 ? "" : "s"}` : ""}`
                + `${referenceRewrites.length ? `, and retarget ${referenceRewrites.length} incoming component reference${referenceRewrites.length === 1 ? "" : "s"}` : ""}`,
            operation,
            inverseOperation,
            ...(hasAtomicMoveChanges ? {
                operations: [
                    ...binaryDependencyCopies.map((copiedDependency) => ({
                        opId: createOpId("copy-component-dependency"),
                        kind: "addResource" as const,
                        selector: { packageId: toPackageId },
                        resource: copiedDependency,
                    })),
                    ...componentDependencyCopies.map((copiedDependency, index) => ({
                        opId: createOpId("copy-component-dependency"),
                        kind: "addComponent" as const,
                        selector: { packageId: toPackageId },
                        component: copiedDependency,
                        atIndex: (targetPackage.resources?.length || 0) + binaryDependencyCopies.length + index,
                    })),
                    ...(snapshotMove ? [] : dependencyRewrites.map(({ node }) => ({
                        opId: createOpId("detach-component-dependency"),
                        kind: "detachDisplayNode" as const,
                        selector: { ...selector, displayNodeId: String(node.id || "") },
                    }))),
                    ...referenceRewrites.map(({ selector: componentSelector, node }) => ({
                        opId: createOpId("detach-component-reference"),
                        kind: "detachDisplayNode" as const,
                        selector: { ...componentSelector, displayNodeId: String(node.id || "") },
                    })),
                    ...(snapshotMove ? [] : referenceRewrites.map(({ selector: componentSelector, atIndex, rewrittenNode }) => ({
                        opId: createOpId("attach-component-reference"),
                        kind: "attachDisplayNode" as const,
                        selector: componentSelector,
                        atIndex,
                        node: rewrittenNode,
                    }))),
                    ...(snapshotMove ? [{
                        opId: createOpId("remove-component-for-snapshot-move"),
                        kind: "removeComponent" as const,
                        selector,
                    }, {
                        opId: createOpId("add-component-for-snapshot-move"),
                        kind: "addComponent" as const,
                        selector: { packageId: toPackageId },
                        component: rewrittenComponentSnapshot,
                        atIndex: (targetPackage.resources?.length || 0) + copiedDependencies.length,
                    }] : [operation]),
                    ...(snapshotMove ? referenceRewrites.map(({ selector: componentSelector, atIndex, rewrittenNode }) => ({
                        opId: createOpId("attach-component-reference"),
                        kind: "attachDisplayNode" as const,
                        selector: componentSelector,
                        atIndex,
                        node: rewrittenNode,
                    })) : []),
                    ...(snapshotMove ? [] : dependencyRewrites.map(({ atIndex, rewrittenNode }) => ({
                        opId: createOpId("attach-component-dependency"),
                        kind: "attachDisplayNode" as const,
                        selector: { packageId: toPackageId, componentResourceId: selector.componentResourceId },
                        atIndex,
                        node: rewrittenNode,
                    }))),
                ],
                inverseOperations: [
                    ...(snapshotMove ? [] : dependencyRewrites.map(({ rewrittenNode }) => ({
                        opId: createOpId("detach-component-dependency-undo"),
                        kind: "detachDisplayNode" as const,
                        selector: {
                            packageId: toPackageId,
                            componentResourceId: selector.componentResourceId,
                            displayNodeId: String(rewrittenNode.id || ""),
                        },
                    }))),
                    ...referenceRewrites.map(({ inverseSelector: nodeSelector, node }) => ({
                        opId: createOpId("detach-component-reference-undo"),
                        kind: "detachDisplayNode" as const,
                        selector: { ...nodeSelector, displayNodeId: String(node.id || "") },
                    })),
                    ...(snapshotMove ? [] : referenceRewrites.map(({ inverseSelector: componentSelector, atIndex, node }) => ({
                        opId: createOpId("attach-component-reference-undo"),
                        kind: "attachDisplayNode" as const,
                        selector: componentSelector,
                        atIndex,
                        node,
                    }))),
                    ...(snapshotMove ? [{
                        opId: createOpId("remove-component-for-snapshot-move-undo"),
                        kind: "removeComponent" as const,
                        selector: { packageId: toPackageId, componentResourceId: selector.componentResourceId },
                    }, {
                        opId: createOpId("add-component-for-snapshot-move-undo"),
                        kind: "addComponent" as const,
                        selector: { packageId: selector.packageId },
                        component: originalComponentSnapshot,
                        atIndex: sourceIndex,
                    }] : [inverseOperation]),
                    ...(snapshotMove ? referenceRewrites.map(({ inverseSelector: componentSelector, atIndex, node }) => ({
                        opId: createOpId("attach-component-reference-undo"),
                        kind: "attachDisplayNode" as const,
                        selector: componentSelector,
                        atIndex,
                        node,
                    })) : []),
                    ...(snapshotMove ? [] : dependencyRewrites.map(({ atIndex, node }) => ({
                        opId: createOpId("attach-component-dependency-undo"),
                        kind: "attachDisplayNode" as const,
                        selector,
                        atIndex,
                        node,
                    }))),
                    ...[...componentDependencyCopies].reverse().map((copiedDependency) => ({
                        opId: createOpId("remove-component-dependency-undo"),
                        kind: "removeComponent" as const,
                        selector: {
                            packageId: toPackageId,
                            componentResourceId: String(copiedDependency.id || ""),
                        },
                    })),
                    ...[...binaryDependencyCopies].reverse().map((copiedDependency) => ({
                        opId: createOpId("remove-component-dependency-undo"),
                        kind: "removeResource" as const,
                        selector: { packageId: toPackageId, resourceId: String(copiedDependency.id || "") },
                    })),
                ],
            } : {}),
        },
    };
}

export function prepareRemoveComponent(
    projectValue: unknown,
    selector: EditorComponentSelector,
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    const resource = findResource(projectValue, {
        packageId: selector.packageId,
        resourceId: selector.componentResourceId,
    });
    const index = pkg?.resources?.findIndex((item) => item.id === selector.componentResourceId) ?? -1;
    if (!pkg || !resource || index < 0) return missingResource({ packageId: selector.packageId, resourceId: selector.componentResourceId });
    if (resource.kind !== "component" || !resource.component) {
        return { ok: false, code: "component_not_found", message: "The selected resource is not a component." };
    }
    const incomingReferences = findComponentMoveReferenceRewrites(
        projectValue,
        selector,
        selector.packageId,
    ).filter(({ selector: owner }) => (
        owner.packageId !== selector.packageId
        || owner.componentResourceId !== selector.componentResourceId
    ));
    const operation = { opId: createOpId("remove-component"), kind: "removeComponent" as const, selector };
    const inverseOperation = {
        opId: createOpId("add-component-undo"),
        kind: "addComponent" as const,
        selector: { packageId: selector.packageId },
        component: cloneJson(resource),
        atIndex: index,
    };
    return {
        ok: true,
        transaction: {
            summary: `Remove component ${resource.name || resource.id || selector.componentResourceId}`
                + `${incomingReferences.length ? ` and detach ${incomingReferences.length} incoming reference${incomingReferences.length === 1 ? "" : "s"}` : ""}`,
            operation,
            inverseOperation,
            ...(incomingReferences.length ? {
                operations: [
                    ...incomingReferences.map(({ selector: owner, node }) => ({
                        opId: createOpId("detach-component-reference"),
                        kind: "detachDisplayNode" as const,
                        selector: { ...owner, displayNodeId: String(node.id || "") },
                    })),
                    operation,
                ],
                inverseOperations: [
                    inverseOperation,
                    ...incomingReferences.map(({ selector: owner, atIndex, node }) => ({
                        opId: createOpId("attach-component-reference-undo"),
                        kind: "attachDisplayNode" as const,
                        selector: owner,
                        atIndex,
                        node,
                    })),
                ],
            } : {}),
        },
    };
}

export function prepareComponentRename(
    projectValue: unknown,
    selector: EditorResourceSelector,
    newName: string,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    const normalizedName = newName.trim();
    if (!resource) return missingResource(selector);
    if (resource.kind !== "component") {
        return {
            ok: false,
            code: resource.kind === "image" ? "use_image_rename" : "unsupported_resource_rename",
            message: resource.kind === "image"
                ? "Use the image rename narrow entry for image resources."
                : "Only component resource rename is handled by this legacy helper.",
        };
    }
    if (!normalizedName) {
        return { ok: false, code: "invalid_resource_name", message: "Resource name cannot be empty." };
    }
    if (normalizedName === resource.name) {
        return { ok: false, code: "resource_name_unchanged", message: "Resource name is unchanged." };
    }

    return {
        ok: true,
        transaction: {
            summary: `Rename component resource to ${normalizedName}`,
            operation: {
                opId: createOpId("rename-resource"),
                kind: "renameResource",
                selector,
                newName: normalizedName,
            },
            inverseOperation: {
                opId: createOpId("rename-resource-undo"),
                kind: "renameResource",
                selector,
                newName: String(resource.name || resource.id || ""),
            },
        },
    };
}
