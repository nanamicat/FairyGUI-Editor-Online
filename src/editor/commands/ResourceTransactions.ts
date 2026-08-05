import type {
    EditorCommandOperation,
    EditorHighRiskTransaction,
    EditorResourceFolderSelector,
    EditorResourceSelector,
    ImageResourceEditableProps,
    SetResourceFavoriteOperation,
    SetResourceFolderFavoriteOperation,
} from "../model/EditorCommand";
import type { HighRiskTransactionPreparation, BinaryFileInput } from "./AuthoringTransactionTypes";
import {
    SUPPORTED_ASSET_KINDS,
    UamPackageLike,
    UamResourceLike,
    getHighRiskWorkingProject,
    findPackage,
    findResource,
    normalizeResourcePath,
    normalizeBinaryFileInput,
    createBinaryResourceIdentity,
    createCopyId,
    createCopyName,
    createAssetCopy,
    createAddResourceSnapshot,
    createOpId,
    missingResource,
} from "./AuthoringTransactionSupport";
import {
    detectImageSourceFormat,
    imageSourceFormatFromFileName,
    probeImageSourceDimensions,
} from "./ImageSourceProbe";

export { encodeMovieClipJta, parseMovieClipJta } from "./MovieClipJtaCodec";
export type { MovieClipJta, MovieClipJtaFrame } from "./MovieClipJtaCodec";
export { parseMovieClipSpriteSheetDescriptor } from "./MovieClipSpriteSheetCodec";
export type {
    MovieClipFrameRect,
    MovieClipSpriteSheetDescriptor,
    MovieClipSpriteSheetFrame,
    MovieClipSpriteSheetParseResult,
} from "./MovieClipSpriteSheetCodec";
export {
    findOpaqueBounds,
    prepareImportMovieClipResource,
    prepareImportMovieClipSpriteSheetResource,
    prepareReplaceMovieClipResource,
    prepareReplaceMovieClipSpriteSheetResource,
    prepareUpdateMovieClipResource,
} from "./MovieClipTransactions";
export type {
    MovieClipFrameInput,
    MovieClipSpriteSheetFrameInput,
    MovieClipTimingUpdate,
} from "./MovieClipTransactions";

export type { ImageSourceFormat } from "./ImageSourceProbe";
export { detectImageSourceFormat, imageSourceFormatFromFileName, probeImageSourceDimensions } from "./ImageSourceProbe";

export interface ImageSourceUpdateInput extends BinaryFileInput {
    dimensions: { width: number; height: number };
}

export const MAX_BROWSER_IMAGE_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_BROWSER_IMAGE_SOURCE_PIXELS = 8 * 1024 * 1024;
export function prepareReplaceImageSource(
    projectValue: unknown,
    selector: EditorResourceSelector,
    fileInput: ImageSourceUpdateInput,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    if (!resource) return missingResource(selector);
    if (resource.kind !== "image" || !(resource.sourceBytes instanceof Uint8Array)) {
        return {
            ok: false,
            code: "hydrated_image_resource_required",
            message: "Choose a hydrated PNG or JPEG image resource.",
        };
    }

    const normalizedFile = normalizeBinaryFileInput(fileInput);
    if (normalizedFile.ok === false) return normalizedFile;
    if (normalizedFile.sourceBytes.byteLength > MAX_BROWSER_IMAGE_SOURCE_BYTES) {
        return {
            ok: false,
            code: "image_source_too_large",
            message: "Browser image source updates are limited to 8 MiB.",
        };
    }

    const targetFileName = String(resource.fileName || resource.file || "");
    const targetFormat = imageSourceFormatFromFileName(targetFileName);
    if (!targetFormat) {
        return {
            ok: false,
            code: "unsupported_image_source_format",
            message: "Image source update currently supports PNG and JPEG targets only.",
        };
    }
    const selectedFormat = imageSourceFormatFromFileName(normalizedFile.fileName);
    const detectedFormat = detectImageSourceFormat(normalizedFile.sourceBytes);
    if (!selectedFormat || !detectedFormat || selectedFormat !== detectedFormat) {
        return {
            ok: false,
            code: "invalid_image_source_format",
            message: "The selected file extension and image bytes must both identify PNG or JPEG.",
        };
    }
    if (selectedFormat !== targetFormat) {
        return {
            ok: false,
            code: "image_source_format_mismatch",
            message: `Choose a ${targetFormat === "png" ? "PNG" : "JPEG"} file to update this image without changing its source format.`,
        };
    }

    const probedDimensions = probeImageSourceDimensions(normalizedFile.sourceBytes);
    if (!probedDimensions) {
        return {
            ok: false,
            code: "invalid_image_source_dimensions",
            message: "The selected image bytes do not contain valid intrinsic dimensions.",
        };
    }
    const { width, height } = probedDimensions;
    if (width > Math.floor(MAX_BROWSER_IMAGE_SOURCE_PIXELS / height)) {
        return {
            ok: false,
            code: "image_source_pixel_limit_exceeded",
            message: `Browser image source updates are limited to ${MAX_BROWSER_IMAGE_SOURCE_PIXELS} decoded pixels.`,
        };
    }
    if (fileInput.dimensions.width !== width || fileInput.dimensions.height !== height) {
        return {
            ok: false,
            code: "image_source_dimension_mismatch",
            message: `Decoded dimensions ${fileInput.dimensions.width}×${fileInput.dimensions.height} do not match image bytes ${width}×${height}.`,
        };
    }

    const scale9Grid = resource.image?.scaleOption === 1 ? resource.image.scale9Grid : null;
    if (resource.image?.scaleOption === 1) {
        if (!scale9Grid) {
            return {
                ok: false,
                code: "image_scale9_grid_out_of_bounds",
                message: "The existing scale9Grid is unavailable for replacement-image boundary validation.",
            };
        }
        const [x, y, gridWidth, gridHeight] = scale9Grid;
        if (
            !scale9Grid.every(Number.isInteger)
            || x < 0
            || y < 0
            || gridWidth <= 0
            || gridHeight <= 0
            || x + gridWidth > width
            || y + gridHeight > height
        ) {
            return {
                ok: false,
                code: "image_scale9_grid_out_of_bounds",
                message: `The existing scale9Grid does not fit inside the replacement image (${width}×${height}).`,
            };
        }
    }

    if (
        normalizedFile.sourceBytes.byteLength === resource.sourceBytes.byteLength
        && normalizedFile.sourceBytes.every((value, index) => value === resource.sourceBytes![index])
    ) {
        return {
            ok: false,
            code: "image_source_unchanged",
            message: "Image source bytes are unchanged.",
        };
    }

    return {
        ok: true,
        transaction: {
            summary: `Update image source for ${resource.name || resource.id} (${width}×${height})`,
            operation: {
                opId: createOpId("replace-image-source"),
                kind: "replaceResourceBytes",
                selector,
                sourceBytes: new Uint8Array(normalizedFile.sourceBytes),
            },
            inverseOperation: {
                opId: createOpId("replace-image-source-undo"),
                kind: "replaceResourceBytes",
                selector,
                sourceBytes: new Uint8Array(resource.sourceBytes),
            },
        },
    };
}

export function prepareImageRename(
    projectValue: unknown,
    selector: EditorResourceSelector,
    newName: string,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    const normalizedName = newName.trim();
    if (!resource) return missingResource(selector);
    if (resource.kind !== "image") {
        return { ok: false, code: "unsupported_image_rename", message: "Only image resource rename is enabled here." };
    }
    if (!normalizedName) return { ok: false, code: "invalid_resource_name", message: "Image name cannot be empty." };
    if (normalizedName === resource.name) return { ok: false, code: "resource_name_unchanged", message: "Image name is unchanged." };

    return {
        ok: true,
        transaction: {
            summary: `Rename image resource to ${normalizedName}`,
            operation: {
                opId: createOpId("rename-image-resource"),
                kind: "renameResource",
                selector,
                newName: normalizedName,
            },
            inverseOperation: {
                opId: createOpId("rename-image-resource-undo"),
                kind: "renameResource",
                selector,
                newName: String(resource.name || resource.id || ""),
            },
        },
    };
}

export function prepareResourceRename(
    projectValue: unknown,
    selector: EditorResourceSelector,
    newName: string,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    const normalizedName = newName.trim();
    if (!resource) return missingResource(selector);
    if (resource.kind !== "component" && !SUPPORTED_ASSET_KINDS.has(String(resource.kind))) {
        return {
            ok: false,
            code: "unsupported_resource_rename",
            message: "Rename is verified for component, image, sound, font, and movieClip resources only.",
        };
    }
    if (!normalizedName) return { ok: false, code: "invalid_resource_name", message: "Resource name cannot be empty." };
    if (normalizedName === resource.name) return { ok: false, code: "resource_name_unchanged", message: "Resource name is unchanged." };
    return {
        ok: true,
        transaction: {
            summary: `Rename ${resource.kind} resource to ${normalizedName}`,
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

export function prepareSetResourceFavorite(
    projectValue: unknown,
    selector: EditorResourceSelector,
    favorite: boolean,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    if (!resource) return missingResource(selector);
    if ((resource.favorite === true) === favorite) {
        return { ok: false, code: "resource_favorite_unchanged", message: "Resource favorite state is unchanged." };
    }
    return {
        ok: true,
        transaction: {
            summary: `${favorite ? "Favorite" : "Unfavorite"} resource ${resource.name || resource.id}`,
            operation: { opId: createOpId("set-resource-favorite"), kind: "setResourceFavorite", selector, favorite },
            inverseOperation: { opId: createOpId("set-resource-favorite-undo"), kind: "setResourceFavorite", selector, favorite: !favorite },
        },
    };
}

export function prepareSetResourceFolderFavorite(
    projectValue: unknown,
    selector: EditorResourceFolderSelector,
    favorite: boolean,
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    const folder = pkg && findResourceFolder(pkg, selector);
    if (!folder) return missingResourceFolder(selector);
    const branch = selector.branch || "";
    const folderPath = String(folder.path || "");
    const operations: Array<SetResourceFolderFavoriteOperation | SetResourceFavoriteOperation> = [];
    const inverseOperations: Array<SetResourceFolderFavoriteOperation | SetResourceFavoriteOperation> = [];
    for (const candidate of pkg.folders || []) {
        const candidatePath = String(candidate.path || "");
        if ((candidate.branch || "") !== branch || !candidatePath.startsWith(folderPath)) continue;
        const previous = candidate.favorite === true;
        if (previous === favorite) continue;
        operations.push({
            opId: createOpId("set-resource-folder-favorite"),
            kind: "setResourceFolderFavorite",
            selector: { packageId: selector.packageId, branch, path: candidatePath },
            favorite,
        });
        inverseOperations.unshift({
            opId: createOpId("set-resource-folder-favorite-undo"),
            kind: "setResourceFolderFavorite",
            selector: { packageId: selector.packageId, branch, path: candidatePath },
            favorite: previous,
        });
    }
    for (const resource of pkg.resources || []) {
        if ((resource.branch || "") !== branch || !String(resource.path || "/").startsWith(folderPath)) continue;
        const previous = resource.favorite === true;
        if (previous === favorite) continue;
        const resourceSelector = { packageId: selector.packageId, resourceId: String(resource.id) };
        operations.push({
            opId: createOpId("set-resource-favorite"),
            kind: "setResourceFavorite",
            selector: resourceSelector,
            favorite,
        });
        inverseOperations.unshift({
            opId: createOpId("set-resource-favorite-undo"),
            kind: "setResourceFavorite",
            selector: resourceSelector,
            favorite: previous,
        });
    }
    if (operations.length === 0) {
        return { ok: false, code: "resource_folder_favorite_unchanged", message: "Resource folder favorite state is unchanged." };
    }
    return {
        ok: true,
        transaction: {
            summary: `${favorite ? "Favorite" : "Unfavorite"} resource folder ${folderPath} and descendants`,
            operation: operations[0],
            inverseOperation: inverseOperations[0],
            operations,
            inverseOperations,
        },
    };
}

export function prepareSetResourceExported(
    projectValue: unknown,
    selector: EditorResourceSelector,
    exported: boolean,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    if (!resource) return missingResource(selector);
    if ((resource.exported !== false) === exported) {
        return { ok: false, code: "resource_exported_unchanged", message: "Resource exported state is unchanged." };
    }
    return {
        ok: true,
        transaction: {
            summary: `${exported ? "Export" : "Unexport"} resource ${resource.name || resource.id}`,
            operation: { opId: createOpId("set-resource-exported"), kind: "setResourceExported", selector, exported },
            inverseOperation: { opId: createOpId("set-resource-exported-undo"), kind: "setResourceExported", selector, exported: !exported },
        },
    };
}

export function prepareAddResourceFolder(
    projectValue: unknown,
    packageId: string,
    path: string,
    options: { branch?: string; favorite?: boolean; atlas?: string } = {},
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${packageId} was not found.` };
    const normalizedPath = normalizeResourceFolderPath(path, false);
    if (!normalizedPath) return invalidResourceFolderPath();
    const branch = options.branch || "";
    if (findResourceFolder(pkg, { packageId, branch, path: normalizedPath })) {
        return { ok: false, code: "resource_folder_conflict", message: `Resource folder ${normalizedPath} already exists.` };
    }
    const parentPath = getResourceFolderParentPath(normalizedPath);
    if (parentPath !== "/" && !findResourceFolder(pkg, { packageId, branch, path: parentPath })) {
        return { ok: false, code: "resource_folder_parent_not_found", message: `Parent folder ${parentPath} does not exist.` };
    }
    return {
        ok: true,
        transaction: {
            summary: `Add resource folder ${normalizedPath}`,
            operation: {
                opId: createOpId("add-resource-folder"),
                kind: "addResourceFolder",
                selector: { packageId },
                path: normalizedPath,
                branch,
                favorite: options.favorite === true,
                atlas: options.atlas || "",
            },
            inverseOperation: {
                opId: createOpId("remove-resource-folder-undo"),
                kind: "removeResourceFolder",
                selector: { packageId, branch, path: normalizedPath },
            },
        },
    };
}

export function prepareRenameResourceFolder(
    projectValue: unknown,
    selector: EditorResourceFolderSelector,
    newName: string,
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    const folder = pkg && findResourceFolder(pkg, selector);
    if (!folder) return missingResourceFolder(selector);
    const normalizedName = newName.trim();
    if (!isSafeResourceFolderName(normalizedName)) return invalidResourceFolderPath();
    const oldName = getResourceFolderName(String(folder.path));
    if (normalizedName === oldName) {
        return { ok: false, code: "resource_folder_name_unchanged", message: "Resource folder name is unchanged." };
    }
    const branch = selector.branch || "";
    const destination = `${getResourceFolderParentPath(String(folder.path))}${normalizedName}/`;
    return {
        ok: true,
        transaction: {
            summary: `Rename resource folder ${folder.path} to ${normalizedName}`,
            operation: { opId: createOpId("rename-resource-folder"), kind: "renameResourceFolder", selector: { ...selector, branch }, newName: normalizedName },
            inverseOperation: {
                opId: createOpId("rename-resource-folder-undo"),
                kind: "renameResourceFolder",
                selector: { packageId: selector.packageId, branch, path: destination },
                newName: oldName,
            },
        },
    };
}

export function prepareMoveResourceFolder(
    projectValue: unknown,
    selector: EditorResourceFolderSelector,
    toPath: string,
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    const folder = pkg && findResourceFolder(pkg, selector);
    if (!folder) return missingResourceFolder(selector);
    const normalizedParent = normalizeResourceFolderPath(toPath, true);
    if (!normalizedParent) return invalidResourceFolderPath();
    const oldParent = getResourceFolderParentPath(String(folder.path));
    if (normalizedParent === oldParent) {
        return { ok: false, code: "resource_folder_path_unchanged", message: "Resource folder path is unchanged." };
    }
    const branch = selector.branch || "";
    const destination = `${normalizedParent}${getResourceFolderName(String(folder.path))}/`;
    return {
        ok: true,
        transaction: {
            summary: `Move resource folder ${folder.path} to ${normalizedParent}`,
            operation: { opId: createOpId("move-resource-folder"), kind: "moveResourceFolder", selector: { ...selector, branch }, toPath: normalizedParent },
            inverseOperation: {
                opId: createOpId("move-resource-folder-undo"),
                kind: "moveResourceFolder",
                selector: { packageId: selector.packageId, branch, path: destination },
                toPath: oldParent,
            },
        },
    };
}

export function prepareRemoveResourceFolder(
    projectValue: unknown,
    selector: EditorResourceFolderSelector,
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    const folder = pkg && findResourceFolder(pkg, selector);
    if (!folder) return missingResourceFolder(selector);
    const branch = selector.branch || "";
    return {
        ok: true,
        transaction: {
            summary: `Remove empty resource folder ${folder.path}`,
            operation: { opId: createOpId("remove-resource-folder"), kind: "removeResourceFolder", selector: { ...selector, branch } },
            inverseOperation: {
                opId: createOpId("add-resource-folder-undo"),
                kind: "addResourceFolder",
                selector: { packageId: selector.packageId },
                path: String(folder.path),
                branch,
                favorite: folder.favorite === true,
                atlas: String(folder.atlas || ""),
            },
        },
    };
}

function normalizeResourceFolderPath(value: string, allowRoot: boolean): string | null {
    const segments = value.trim().replaceAll("\\", "/").split("/").filter(Boolean);
    if (segments.some((segment) => !isSafeResourceFolderName(segment))) return null;
    if (segments.length === 0) return allowRoot ? "/" : null;
    return `/${segments.join("/")}/`;
}

function isSafeResourceFolderName(value: string): boolean {
    return value.length > 0 && value !== "." && value !== ".." && !/[\\/:]/.test(value);
}

function getResourceFolderParentPath(value: string): string {
    const segments = value.split("/").filter(Boolean);
    segments.pop();
    return segments.length ? `/${segments.join("/")}/` : "/";
}

function getResourceFolderName(value: string): string {
    return value.split("/").filter(Boolean).pop() || "";
}

function findResourceFolder(pkg: UamPackageLike, selector: EditorResourceFolderSelector) {
    const branch = selector.branch || "";
    return (pkg.folders || []).find((folder) => (folder.branch || "") === branch && folder.path === selector.path) || null;
}

function missingResourceFolder(selector: EditorResourceFolderSelector): HighRiskTransactionPreparation {
    return { ok: false, code: "resource_folder_not_found", message: `Resource folder ${selector.path} was not found.` };
}

function invalidResourceFolderPath(): HighRiskTransactionPreparation {
    return { ok: false, code: "invalid_resource_folder_path", message: "Resource folder path must be canonical, traversal-free, and use safe names." };
}

export function prepareAddBinaryResource(
    projectValue: unknown,
    selector: { packageId: string },
    fileInput: BinaryFileInput,
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    const normalizedFile = normalizeBinaryFileInput(fileInput);
    if (normalizedFile.ok === false) return normalizedFile;
    const id = createCopyId(pkg.resources || [], "imported_binary");
    const identity = createBinaryResourceIdentity(pkg.resources || [], normalizedFile.fileName);
    const resource: UamResourceLike = {
        kind: "misc",
        id,
        name: identity.name,
        path: "/imported/binary",
        exported: false,
        favorite: false,
        branch: "",
        branchItemIds: [],
        file: identity.fileName,
        metadata: null,
        sourceBytes: new Uint8Array(normalizedFile.sourceBytes),
    };
    return {
        ok: true,
        transaction: {
            summary: `Add binary resource ${identity.fileName}`,
            operation: {
                opId: createOpId("add-binary-resource"),
                kind: "addResource",
                selector,
                resource,
            },
            inverseOperation: {
                opId: createOpId("remove-binary-resource-undo"),
                kind: "removeResource",
                selector: { packageId: selector.packageId, resourceId: id },
            },
        },
    };
}

export function prepareImportImageResource(
    projectValue: unknown,
    selector: { packageId: string },
    fileInput: BinaryFileInput,
    dimensions: { width: number; height: number },
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    const normalizedFile = normalizeBinaryFileInput(fileInput);
    if (normalizedFile.ok === false) return normalizedFile;
    const extension = normalizedFile.fileName.slice(normalizedFile.fileName.lastIndexOf(".")).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(extension)) {
        return {
            ok: false,
            code: "unsupported_image_file",
            message: "Image import accepts PNG, JPEG, WebP, and validated self-contained SVG files.",
        };
    }
    if (normalizedFile.sourceBytes.byteLength > MAX_BROWSER_IMAGE_SOURCE_BYTES) {
        return { ok: false, code: "image_source_too_large", message: "Browser image imports are limited to 8 MiB." };
    }
    if (
        !Number.isInteger(dimensions.width)
        || !Number.isInteger(dimensions.height)
        || dimensions.width <= 0
        || dimensions.height <= 0
        || dimensions.width > Math.floor(MAX_BROWSER_IMAGE_SOURCE_PIXELS / dimensions.height)
    ) {
        return { ok: false, code: "invalid_image_dimensions", message: "Imported image dimensions must be positive integers within the 8 Mi-pixel limit." };
    }

    const id = createCopyId(pkg.resources || [], "imported_image");
    const identity = createBinaryResourceIdentity(pkg.resources || [], normalizedFile.fileName);
    const resource: UamResourceLike = {
        kind: "image",
        id,
        name: identity.name,
        path: "/imported/images/",
        exported: false,
        favorite: false,
        branch: "",
        branchItemIds: [],
        fileName: identity.fileName,
        dimensions: { width: dimensions.width, height: dimensions.height },
        metadata: null,
        image: {
            textureSetMode: "",
            qualityOption: "",
            quality: 80,
            smoothing: true,
            duplicatePadding: false,
            scaleOption: 0,
            scale9Grid: null,
            tileGridIndice: 0,
        },
        sourceBytes: new Uint8Array(normalizedFile.sourceBytes),
    };
    return {
        ok: true,
        transaction: {
            summary: `Import image resource ${identity.fileName}`,
            operation: {
                opId: createOpId("import-image-resource"),
                kind: "addResource",
                selector,
                resource,
            },
            inverseOperation: {
                opId: createOpId("remove-imported-image-undo"),
                kind: "removeResource",
                selector: { packageId: selector.packageId, resourceId: id },
            },
        },
    };
}

export function readImageResourceProps(resource: UamResourceLike): ImageResourceEditableProps {
    return {
        textureSetMode: resource.image?.textureSetMode || "",
        qualityOption: resource.image?.qualityOption || "",
        quality: resource.image?.quality ?? 80,
        smoothing: resource.image?.smoothing ?? true,
        duplicatePadding: resource.image?.duplicatePadding ?? false,
        scaleOption: resource.image?.scaleOption ?? 0,
        scale9Grid: resource.image?.scale9Grid ? [...resource.image.scale9Grid] : null,
        tileGridIndice: resource.image?.tileGridIndice ?? 0,
    };
}

export function prepareSetImageResourceProps(
    projectValue: unknown,
    selector: EditorResourceSelector,
    props: ImageResourceEditableProps,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    if (!resource || resource.kind !== "image") {
        return { ok: false, code: "image_resource_not_found", message: "The selected resource is not an image." };
    }
    const grid = props.scale9Grid;
    const width = Number(resource.dimensions?.width || 0);
    const height = Number(resource.dimensions?.height || 0);
    if (
        ![0, 1, 2].includes(props.scaleOption)
        || typeof props.textureSetMode !== "string"
        || typeof props.qualityOption !== "string"
        || !Number.isInteger(props.quality)
        || props.quality < 0
        || props.quality > 100
        || typeof props.smoothing !== "boolean"
        || typeof props.duplicatePadding !== "boolean"
        || !Number.isInteger(props.tileGridIndice)
        || props.tileGridIndice < 0
        || props.tileGridIndice > 31
        || (
            props.scaleOption === 1
            && (
                !grid
                || grid.some((value) => !Number.isInteger(value) || value < 0)
                || grid[2] <= 0
                || grid[3] <= 0
                || grid[0] + grid[2] > width
                || grid[1] + grid[3] > height
            )
        )
    ) {
        return { ok: false, code: "invalid_image_properties", message: "Image scale, 9-grid, tile, smoothing, quality, or atlas values are invalid." };
    }
    const current = readImageResourceProps(resource);
    if (JSON.stringify(current) === JSON.stringify(props)) {
        return { ok: false, code: "image_properties_unchanged", message: "Image properties are unchanged." };
    }
    return {
        ok: true,
        transaction: {
            summary: `Update image properties for ${resource.name || resource.id || selector.resourceId}`,
            operation: {
                opId: createOpId("set-image-resource-props"),
                kind: "setImageResourceProps",
                selector,
                props,
            },
            inverseOperation: {
                opId: createOpId("set-image-resource-props-undo"),
                kind: "setImageResourceProps",
                selector,
                props: current,
            },
        },
    };
}

export function prepareImportBitmapFontResources(
    projectValue: unknown,
    selector: { packageId: string },
    fontFileInput: BinaryFileInput,
    textureFileInput: BinaryFileInput,
    textureDimensions: { width: number; height: number },
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    const normalizedFont = normalizeBinaryFileInput(fontFileInput);
    if (normalizedFont.ok === false) return normalizedFont;
    if (!normalizedFont.fileName.toLowerCase().endsWith(".fnt")) {
        return { ok: false, code: "unsupported_bitmap_font_file", message: "Bitmap font import requires a text .fnt file." };
    }

    let fontText: string;
    try {
        fontText = new TextDecoder("utf-8", { fatal: true }).decode(normalizedFont.sourceBytes);
    } catch {
        return { ok: false, code: "invalid_bitmap_font_text", message: "The selected .fnt file is not valid UTF-8 text." };
    }
    const pageCount = Number(fontText.match(/^common\b[^\r\n]*\bpages=(\d+)/m)?.[1]);
    const pageLines = fontText.match(/^page\b[^\r\n]*$/gm) || [];
    const characterCount = Number(fontText.match(/^chars\b[^\r\n]*\bcount=(\d+)/m)?.[1]);
    if (
        !/^info\b/m.test(fontText)
        || !Number.isInteger(characterCount)
        || characterCount <= 0
        || !/^char\b/m.test(fontText)
    ) {
        return { ok: false, code: "invalid_bitmap_font_text", message: "The selected file is not a valid text BMFont descriptor." };
    }
    if (
        pageCount !== 1
        || pageLines.length !== 1
        || !/\bid=0\b/.test(pageLines[0])
        || !/\bfile=(?:"[^"]+"|\S+)/.test(pageLines[0])
    ) {
        return { ok: false, code: "unsupported_bitmap_font_pages", message: "Bitmap font import currently supports one texture page." };
    }

    const imagePreparation = prepareImportImageResource(
        projectValue,
        selector,
        textureFileInput,
        textureDimensions,
    );
    if (imagePreparation.ok === false) return imagePreparation;
    const imageOperation = imagePreparation.transaction.operation;
    if (imageOperation.kind !== "addResource") {
        return { ok: false, code: "invalid_bitmap_font_texture", message: "The bitmap font texture could not be prepared." };
    }
    const imageResource = imageOperation.resource as UamResourceLike;
    const occupiedResources = [...(pkg.resources || []), imageResource];
    const fontId = createCopyId(occupiedResources, "imported_font");
    const fontIdentity = createBinaryResourceIdentity(occupiedResources, normalizedFont.fileName);
    const fontResource: UamResourceLike = {
        kind: "font",
        id: fontId,
        name: fontIdentity.name,
        path: "/imported/fonts/",
        exported: false,
        favorite: false,
        branch: "",
        branchItemIds: [],
        fileName: fontIdentity.fileName,
        metadata: {
            textureId: imageResource.id,
            renderMode: "",
            samplePointSize: 0,
            ttf: false,
            tint: false,
            autoScale: false,
            hasChannel: false,
            fontSize: 0,
            xAdvance: 0,
            lineHeight: 0,
        },
        sourceBytes: new Uint8Array(normalizedFont.sourceBytes),
    };
    const operations = [
        imageOperation,
        {
            opId: createOpId("import-bitmap-font"),
            kind: "addResource" as const,
            selector,
            resource: fontResource,
        },
    ];
    const inverseOperations = [
        {
            opId: createOpId("remove-imported-font-undo"),
            kind: "removeResource" as const,
            selector: { packageId: selector.packageId, resourceId: fontId },
        },
        imagePreparation.transaction.inverseOperation,
    ];
    return {
        ok: true,
        transaction: {
            summary: `Import bitmap font ${fontIdentity.fileName}`,
            operation: operations[0],
            inverseOperation: inverseOperations[0],
            operations,
            inverseOperations,
        },
    };
}

export function prepareImportSoundResource(
    projectValue: unknown,
    selector: { packageId: string },
    fileInput: BinaryFileInput,
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    const normalizedFile = normalizeBinaryFileInput(fileInput);
    if (normalizedFile.ok === false) return normalizedFile;
    const extension = normalizedFile.fileName.slice(normalizedFile.fileName.lastIndexOf(".")).toLowerCase();
    if (![".wav", ".mp3", ".ogg"].includes(extension)) {
        return {
            ok: false,
            code: "unsupported_sound_file",
            message: "Sound import accepts WAV, MP3, and OGG files.",
        };
    }

    const id = createCopyId(pkg.resources || [], "imported_sound");
    const identity = createBinaryResourceIdentity(pkg.resources || [], normalizedFile.fileName);
    const resource: UamResourceLike = {
        kind: "sound",
        id,
        name: identity.name,
        path: "/imported/sounds/",
        exported: false,
        favorite: false,
        branch: "",
        branchItemIds: [],
        file: identity.fileName,
        metadata: null,
        sourceBytes: new Uint8Array(normalizedFile.sourceBytes),
    };
    return {
        ok: true,
        transaction: {
            summary: `Import sound resource ${identity.fileName}`,
            operation: {
                opId: createOpId("import-sound-resource"),
                kind: "addResource",
                selector,
                resource,
            },
            inverseOperation: {
                opId: createOpId("remove-imported-sound-undo"),
                kind: "removeResource",
                selector: { packageId: selector.packageId, resourceId: id },
            },
        },
    };
}

export function prepareReplaceBinaryResource(
    projectValue: unknown,
    selector: EditorResourceSelector,
    fileInput: BinaryFileInput,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    if (!resource) return missingResource(selector);
    if (resource.kind !== "misc" || !resource.sourceBytes) {
        return { ok: false, code: "binary_resource_required", message: "Select a hydrated misc binary resource first." };
    }
    const normalizedFile = normalizeBinaryFileInput(fileInput);
    if (normalizedFile.ok === false) return normalizedFile;
    return {
        ok: true,
        transaction: {
            summary: `Replace bytes for ${resource.name || resource.id} from ${normalizedFile.fileName}`,
            operation: {
                opId: createOpId("replace-resource-bytes"),
                kind: "replaceResourceBytes",
                selector,
                sourceBytes: new Uint8Array(normalizedFile.sourceBytes),
            },
            inverseOperation: {
                opId: createOpId("replace-resource-bytes-undo"),
                kind: "replaceResourceBytes",
                selector,
                sourceBytes: new Uint8Array(resource.sourceBytes),
            },
        },
    };
}

export function prepareRemoveBinaryResource(
    projectValue: unknown,
    selector: EditorResourceSelector,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    if (!resource) return missingResource(selector);
    if (resource.kind !== "misc" || !resource.sourceBytes) {
        return { ok: false, code: "binary_resource_required", message: "Select a hydrated misc binary resource first." };
    }
    return {
        ok: true,
        transaction: {
            summary: `Remove binary resource ${resource.name || resource.id}`,
            operation: {
                opId: createOpId("remove-binary-resource"),
                kind: "removeResource",
                selector,
            },
            inverseOperation: {
                opId: createOpId("add-binary-resource-undo"),
                kind: "addResource",
                selector: { packageId: selector.packageId },
                resource: createAddResourceSnapshot(resource),
            },
        },
    };
}

export function prepareResourceMove(
    projectValue: unknown,
    selector: EditorResourceSelector,
    toPath: string,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    if (!resource) return missingResource(selector);
    if (resource.kind !== "component" && !SUPPORTED_ASSET_KINDS.has(String(resource.kind))) {
        return {
            ok: false,
            code: "unsupported_resource_move",
            message: "Move is verified for component, image, sound, font, and movieClip resources only.",
        };
    }

    const normalizedPath = normalizeResourcePath(toPath);
    if (!normalizedPath) {
        return { ok: false, code: "invalid_resource_path", message: "Resource path must be an absolute /path/." };
    }
    if (normalizedPath === resource.path) {
        return { ok: false, code: "resource_path_unchanged", message: "Resource path is unchanged." };
    }

    return {
        ok: true,
        transaction: {
            summary: `Move resource to ${normalizedPath}`,
            operation: {
                opId: createOpId("move-resource"),
                kind: "moveResource",
                selector,
                toPath: normalizedPath,
            },
            inverseOperation: {
                opId: createOpId("move-resource-undo"),
                kind: "moveResource",
                selector,
                toPath: String(resource.path || "/"),
            },
        },
    };
}

export function prepareDuplicateAssetResource(
    projectValue: unknown,
    selector: EditorResourceSelector,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    if (!resource) return missingResource(selector);
    if (!SUPPORTED_ASSET_KINDS.has(String(resource.kind)) || !(resource.sourceBytes instanceof Uint8Array)) {
        return {
            ok: false,
            code: "asset_resource_required",
            message: "Duplicate is verified for hydrated image, sound, font, and movieClip resources only.",
        };
    }
    const pkg = findPackage(projectValue, selector.packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    const copy = createAssetCopy(resource, pkg.resources || []);
    const copySelector = { packageId: selector.packageId, resourceId: String(copy.id) };
    return {
        ok: true,
        transaction: {
            summary: `Duplicate ${resource.kind} resource ${resource.name || resource.id}`,
            operation: {
                opId: createOpId("add-asset-resource"),
                kind: "addResource",
                selector: { packageId: selector.packageId },
                resource: copy,
            },
            inverseOperation: {
                opId: createOpId("remove-asset-resource-undo"),
                kind: "removeResource",
                selector: copySelector,
            },
        },
    };
}

const SUPPORTED_BATCH_RESOURCE_KINDS = new Set([
    "component",
    "image",
    "sound",
    "font",
    "movieClip",
    "misc",
]);

interface BatchResourceEntry {
    selector: EditorResourceSelector;
    resource: UamResourceLike;
    index: number;
}

type BatchResourceSelection =
    | { ok: true; packageId: string; resources: UamResourceLike[]; entries: BatchResourceEntry[] }
    | { ok: false; code: string; message: string };

function collectBatchResourceSelection(
    projectValue: unknown,
    selectors: EditorResourceSelector[],
): BatchResourceSelection {
    if (selectors.length === 0) {
        return { ok: false, code: "resource_selection_empty", message: "Select at least one resource." };
    }
    const packageId = selectors[0].packageId;
    if (selectors.some((selector) => selector.packageId !== packageId)) {
        return {
            ok: false,
            code: "resource_batch_package_mismatch",
            message: "Batch resource operations require one package, matching the AIR Library selection contract.",
        };
    }
    const pkg = findPackage(projectValue, packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${packageId} was not found.` };
    const resources = pkg.resources || [];
    const entries: BatchResourceEntry[] = [];
    const seen = new Set<string>();
    for (const selector of selectors) {
        if (seen.has(selector.resourceId)) {
            return {
                ok: false,
                code: "duplicate_resource_selector",
                message: `Resource ${selector.resourceId} is selected more than once.`,
            };
        }
        seen.add(selector.resourceId);
        const index = resources.findIndex((resource) => resource.id === selector.resourceId);
        const resource = resources[index];
        if (!resource || index < 0) {
            return {
                ok: false,
                code: "resource_not_found",
                message: `Resource ${selector.resourceId} was not found.`,
            };
        }
        const kind = String(resource.kind || "");
        if (!SUPPORTED_BATCH_RESOURCE_KINDS.has(kind)) {
            return {
                ok: false,
                code: "unsupported_batch_resource_kind",
                message: `Batch resource operations do not support ${kind || "unknown"}.`,
            };
        }
        if (kind === "component") {
            if (!resource.component) {
                return {
                    ok: false,
                    code: "invalid_component_resource",
                    message: `Component ${selector.resourceId} has no component snapshot.`,
                };
            }
        } else if (!(resource.sourceBytes instanceof Uint8Array)) {
            return {
                ok: false,
                code: "unavailable_resource_source_bytes",
                message: `Resource ${selector.resourceId} must be hydrated before batch duplicate or delete.`,
            };
        }
        entries.push({ selector, resource, index });
    }
    return { ok: true, packageId, resources, entries };
}

function createBatchResourceCopy(
    resource: UamResourceLike,
    occupiedResources: UamResourceLike[],
): UamResourceLike {
    const copy = createAddResourceSnapshot(resource);
    const originalName = String(resource.name || resource.id || resource.kind || "resource");
    copy.id = createCopyId(occupiedResources, String(resource.id || resource.kind || "resource"));
    copy.name = createCopyName(occupiedResources, originalName);
    copy.path = String(resource.path || "/");
    copy.branch = String(resource.branch || "");
    const originalFileName = String(resource.fileName || resource.file || "");
    const extensionIndex = originalFileName.lastIndexOf(".");
    const extension = extensionIndex > 0 ? originalFileName.slice(extensionIndex) : "";
    if (resource.fileName !== undefined) copy.fileName = `${copy.name}${extension}`;
    if (resource.file !== undefined) copy.file = `${copy.name}${extension}`;
    return copy;
}

export function prepareDuplicateResources(
    projectValue: unknown,
    selectors: EditorResourceSelector[],
): HighRiskTransactionPreparation {
    const selection = collectBatchResourceSelection(projectValue, selectors);
    if (selection.ok === false) return selection;
    const occupiedResources = [...selection.resources];
    const operations: EditorCommandOperation[] = [];
    const inverseOperations: EditorCommandOperation[] = [];
    for (const entry of selection.entries) {
        const copy = createBatchResourceCopy(entry.resource, occupiedResources);
        const atIndex = occupiedResources.length;
        occupiedResources.push(copy);
        if (copy.kind === "component") {
            operations.push({
                opId: createOpId("duplicate-component-resource"),
                kind: "addComponent",
                selector: { packageId: selection.packageId },
                component: copy,
                atIndex,
            });
            inverseOperations.unshift({
                opId: createOpId("duplicate-component-resource-undo"),
                kind: "removeComponent",
                selector: { packageId: selection.packageId, componentResourceId: String(copy.id) },
            });
        } else {
            operations.push({
                opId: createOpId("duplicate-asset-resource"),
                kind: "addResource",
                selector: { packageId: selection.packageId },
                resource: copy,
            });
            inverseOperations.unshift({
                opId: createOpId("duplicate-asset-resource-undo"),
                kind: "removeResource",
                selector: { packageId: selection.packageId, resourceId: String(copy.id) },
            });
        }
    }
    return {
        ok: true,
        transaction: {
            summary: `Duplicate ${selection.entries.length} resources`,
            operation: operations[0] as EditorHighRiskTransaction["operation"],
            inverseOperation: inverseOperations[0],
            operations,
            inverseOperations,
        },
    };
}

function resourceSelectionKey(packageId: string, resourceId: string): string {
    return `${packageId}\0${resourceId}`;
}

function findExternalResourceReference(
    projectValue: unknown,
    selector: EditorResourceSelector,
    removedResourceKeys: Set<string>,
): ProjectResourceReference | null {
    return queryProjectResourceReferences(projectValue, selector, "incoming").find((reference) => (
        reference.kind === "projectSettings"
        || !removedResourceKeys.has(resourceSelectionKey(reference.packageId, reference.resourceId))
    )) || null;
}

export function prepareRemoveResources(
    projectValue: unknown,
    selectors: EditorResourceSelector[],
): HighRiskTransactionPreparation {
    const selection = collectBatchResourceSelection(projectValue, selectors);
    if (selection.ok === false) return selection;
    const entries = [...selection.entries];
    const removedResourceKeys = new Set(entries.map((entry) => resourceSelectionKey(
        entry.selector.packageId,
        entry.selector.resourceId,
    )));

    for (const entry of selection.entries) {
        if (entry.resource.kind !== "font") continue;
        const textureId = String((entry.resource.metadata as { textureId?: unknown } | null | undefined)?.textureId || "");
        if (!textureId) continue;
        const textureSelector = { packageId: selection.packageId, resourceId: textureId };
        const textureKey = resourceSelectionKey(selection.packageId, textureId);
        if (removedResourceKeys.has(textureKey)) continue;
        const textureIndex = selection.resources.findIndex((resource) => resource.id === textureId);
        const texture = selection.resources[textureIndex];
        if (!texture || texture.kind !== "image") {
            return {
                ok: false,
                code: "invalid_font_texture_dependency",
                message: `Font ${entry.selector.resourceId} references missing image ${textureId}.`,
            };
        }
        if (!isEditorCreatedAsset(texture)) continue;
        if (findExternalResourceReference(projectValue, textureSelector, removedResourceKeys)) continue;
        if (!(texture.sourceBytes instanceof Uint8Array)) {
            return {
                ok: false,
                code: "unavailable_resource_source_bytes",
                message: `Font texture ${textureId} must be hydrated before batch delete.`,
            };
        }
        removedResourceKeys.add(textureKey);
        entries.push({ selector: textureSelector, resource: texture, index: textureIndex });
    }

    for (const entry of entries) {
        const reference = findExternalResourceReference(projectValue, entry.selector, removedResourceKeys);
        if (reference) {
            return {
                ok: false,
                code: "resource_in_use",
                message: `${entry.resource.name || entry.selector.resourceId} is still referenced by ${reference.label}.`,
            };
        }
    }

    const componentEntries = entries
        .filter((entry) => entry.resource.kind === "component")
        .sort((left, right) => right.index - left.index);
    const assetEntries = entries
        .filter((entry) => entry.resource.kind !== "component")
        .sort((left, right) => (
            Number(right.resource.kind === "font") - Number(left.resource.kind === "font")
            || right.index - left.index
        ));
    const operations: EditorCommandOperation[] = [
        ...componentEntries.map((entry) => ({
            opId: createOpId("remove-component-resource"),
            kind: "removeComponent" as const,
            selector: {
                packageId: selection.packageId,
                componentResourceId: entry.selector.resourceId,
            },
        })),
        ...assetEntries.map((entry) => ({
            opId: createOpId("remove-asset-resource"),
            kind: "removeResource" as const,
            selector: entry.selector,
        })),
    ];
    const inverseOperations: EditorCommandOperation[] = [...entries]
        .sort((left, right) => left.index - right.index)
        .map((entry) => entry.resource.kind === "component" ? {
            opId: createOpId("add-component-resource-undo"),
            kind: "addComponent" as const,
            selector: { packageId: selection.packageId },
            component: createAddResourceSnapshot(entry.resource),
            atIndex: entry.index,
        } : {
            opId: createOpId("add-asset-resource-undo"),
            kind: "addResource" as const,
            selector: { packageId: selection.packageId },
            resource: createAddResourceSnapshot(entry.resource),
            atIndex: entry.index,
        });
    return {
        ok: true,
        transaction: {
            summary: `Remove ${selection.entries.length} resources${entries.length > selection.entries.length ? ` and ${entries.length - selection.entries.length} unused font texture` : ""}`,
            operation: operations[0] as EditorHighRiskTransaction["operation"],
            inverseOperation: inverseOperations[0],
            operations,
            inverseOperations,
        },
    };
}

export function prepareReplaceAssetBytes(
    projectValue: unknown,
    selector: EditorResourceSelector,
    fileInput: BinaryFileInput,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    if (!resource) return missingResource(selector);
    if (!SUPPORTED_ASSET_KINDS.has(String(resource.kind)) || !(resource.sourceBytes instanceof Uint8Array)) {
        return {
            ok: false,
            code: "asset_resource_required",
            message: "Byte replacement is verified for hydrated image, sound, font, and movieClip resources only.",
        };
    }
    const normalizedFile = normalizeBinaryFileInput(fileInput);
    if (normalizedFile.ok === false) return normalizedFile;
    return {
        ok: true,
        transaction: {
            summary: `Replace ${resource.kind} bytes for ${resource.name || resource.id} from ${normalizedFile.fileName}`,
            operation: {
                opId: createOpId("replace-asset-bytes"),
                kind: "replaceResourceBytes",
                selector,
                sourceBytes: new Uint8Array(normalizedFile.sourceBytes),
            },
            inverseOperation: {
                opId: createOpId("replace-asset-bytes-undo"),
                kind: "replaceResourceBytes",
                selector,
                sourceBytes: new Uint8Array(resource.sourceBytes),
            },
        },
    };
}

function isEditorCreatedAsset(resource: UamResourceLike): boolean {
    // Older workspaces used /phase9-user/ for editor-created resources.
    return ["/phase9-user/", "/imported/"].some((prefix) =>
        String(resource.path || "").startsWith(prefix)
    );
}

export type ProjectResourceReferenceDirection = "incoming" | "outgoing";

export interface ProjectResourceReference {
    kind: "resource" | "projectSettings";
    packageId: string;
    resourceId: string;
    resourceKind: string;
    count: number;
    label: string;
}

export function getProjectResourceUrl(selector: EditorResourceSelector): string {
    return `ui://${selector.packageId}${selector.resourceId}`;
}

export function parseProjectResourceUrl(
    projectValue: unknown,
    value: string,
): EditorResourceSelector | null {
    const project = getHighRiskWorkingProject(projectValue);
    const url = value.trim();
    if (!project || !url) return null;
    for (const pkg of project.packages || []) {
        const packageId = String(pkg.id || "");
        for (const resource of pkg.resources || []) {
            const resourceId = String(resource.id || "");
            if (resourceId && url === getProjectResourceUrl({ packageId, resourceId })) {
                return { packageId, resourceId };
            }
        }
    }
    return null;
}

function countResourceReferences(
    value: unknown,
    ownerPackageId: string,
    selector: EditorResourceSelector,
): number {
    const uri = `ui://${selector.packageId}${selector.resourceId}`;
    if (typeof value === "string") return value.split(uri).length - 1;
    if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return 0;
    if (Array.isArray(value)) {
        return value.reduce(
            (count, item) => count + countResourceReferences(item, ownerPackageId, selector),
            0,
        );
    }

    const record = value as Record<string, unknown>;
    const referencedPackageId = String(record.packageId || ownerPackageId);
    const directCount = (
        (record.resourceId === selector.resourceId || record.src === selector.resourceId)
        && referencedPackageId === selector.packageId
    ) ? 1 : 0;
    return Object.values(record).reduce<number>(
        (count, item) => count + countResourceReferences(item, ownerPackageId, selector),
        directCount,
    );
}

function createProjectResourceReference(
    pkg: UamPackageLike,
    resource: UamResourceLike,
    count: number,
): ProjectResourceReference {
    const packageId = String(pkg.id || "");
    const packageName = String(pkg.name || packageId);
    const resourceId = String(resource.id || "");
    const resourceName = String(resource.name || resourceId);
    const path = String(resource.path || "").replace(/^\/+|\/+$/g, "");
    return {
        kind: "resource",
        packageId,
        resourceId,
        resourceKind: String(resource.kind || "resource"),
        count,
        label: `${packageName}/${path ? `${path}/` : ""}${resourceName}`,
    };
}

function collectIncomingResourceReferences(
    projectValue: unknown,
    selector: EditorResourceSelector,
    ignoredResourceId = "",
): ProjectResourceReference[] {
    const project = getHighRiskWorkingProject(projectValue);
    if (!project || !findResource(projectValue, selector)) return [];
    const results: ProjectResourceReference[] = [];
    const settings = (project as Record<string, unknown>).settings;
    const settingsCount = countResourceReferences(settings, selector.packageId, selector);
    if (settingsCount > 0) {
        results.push({
            kind: "projectSettings",
            packageId: selector.packageId,
            resourceId: "",
            resourceKind: "projectSettings",
            count: settingsCount,
            label: "Project settings",
        });
    }

    for (const pkg of project.packages || []) {
        const ownerPackageId = String(pkg.id || "");
        for (const resource of pkg.resources || []) {
            if (ownerPackageId === selector.packageId && resource.id === ignoredResourceId) continue;
            const metadata = resource.metadata as { textureId?: unknown } | null | undefined;
            const textureCount = (
                ownerPackageId === selector.packageId
                && metadata?.textureId === selector.resourceId
            ) ? 1 : 0;
            const count = textureCount
                + countResourceReferences(resource.component, ownerPackageId, selector);
            if (count > 0) results.push(createProjectResourceReference(pkg, resource, count));
        }
    }
    return results;
}

export function queryProjectResourceReferences(
    projectValue: unknown,
    selector: EditorResourceSelector,
    direction: ProjectResourceReferenceDirection,
): ProjectResourceReference[] {
    const project = getHighRiskWorkingProject(projectValue);
    const sourceResource = findResource(projectValue, selector);
    if (!project || !sourceResource) return [];
    if (direction === "incoming") {
        return collectIncomingResourceReferences(projectValue, selector)
            .sort((left, right) => left.label.localeCompare(right.label));
    }

    const sourceMetadata = sourceResource.metadata as { textureId?: unknown } | null | undefined;
    const results: ProjectResourceReference[] = [];
    // ponytail: quadratic scan is fine for current project sizes; build a reference index if it becomes measurable.
    for (const pkg of project.packages || []) {
        const packageId = String(pkg.id || "");
        for (const resource of pkg.resources || []) {
            const candidate = { packageId, resourceId: String(resource.id || "") };
            if (!candidate.resourceId) continue;
            const textureCount = (
                packageId === selector.packageId
                && sourceMetadata?.textureId === candidate.resourceId
            ) ? 1 : 0;
            const count = textureCount
                + countResourceReferences(sourceResource.component, selector.packageId, candidate);
            if (count > 0) results.push(createProjectResourceReference(pkg, resource, count));
        }
    }
    return results.sort((left, right) => left.label.localeCompare(right.label));
}

export function isProjectResourceInUse(
    projectValue: unknown,
    selector: EditorResourceSelector,
    ignoredResourceId = "",
): boolean {
    return collectIncomingResourceReferences(projectValue, selector, ignoredResourceId).length > 0;
}

export function prepareRemoveAssetResource(
    projectValue: unknown,
    selector: EditorResourceSelector,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    if (!resource) return missingResource(selector);
    if (!SUPPORTED_ASSET_KINDS.has(String(resource.kind)) || !isEditorCreatedAsset(resource)) {
        return {
            ok: false,
            code: "editor_created_asset_required",
            message: "Removal is limited to editor-created assets so existing project references are not orphaned.",
        };
    }
    if (isProjectResourceInUse(projectValue, selector)) {
        return {
            ok: false,
            code: "resource_in_use",
            message: "This resource is still referenced by the project. Remove those references before deleting it.",
        };
    }

    const metadata = resource.metadata as { textureId?: unknown } | null | undefined;
    const textureId = resource.kind === "font" ? String(metadata?.textureId || "") : "";
    const textureSelector = { packageId: selector.packageId, resourceId: textureId };
    const texture = textureId ? findResource(projectValue, textureSelector) : null;
    const removeTexture = Boolean(
        texture
        && isEditorCreatedAsset(texture)
        && !isProjectResourceInUse(projectValue, textureSelector, selector.resourceId),
    );
    const operations = [
        {
            opId: createOpId("remove-asset-resource"),
            kind: "removeResource" as const,
            selector,
        },
        ...(removeTexture ? [{
            opId: createOpId("remove-font-texture"),
            kind: "removeResource" as const,
            selector: textureSelector,
        }] : []),
    ];
    const inverseOperations = [
        ...(removeTexture ? [{
            opId: createOpId("restore-font-texture"),
            kind: "addResource" as const,
            selector: { packageId: selector.packageId },
            resource: createAddResourceSnapshot(texture!),
        }] : []),
        {
            opId: createOpId("add-asset-resource-undo"),
            kind: "addResource" as const,
            selector: { packageId: selector.packageId },
            resource: createAddResourceSnapshot(resource),
        },
    ];
    return {
        ok: true,
        transaction: {
            summary: removeTexture
                ? `Remove bitmap font ${resource.name || resource.id} and its unused texture`
                : `Remove editor-created asset ${resource.name || resource.id}`,
            operation: operations[0],
            inverseOperation: inverseOperations[0],
            operations,
            inverseOperations,
        },
    };
}
