import type { EditorResourceSelector } from "../model/EditorCommand";
import type {
    BinaryFileInput,
    HighRiskTransactionPreparation,
} from "./AuthoringTransactionTypes";
import {
    createBinaryResourceIdentity,
    createAddResourceSnapshot,
    createCopyId,
    createOpId,
    findPackage,
    findResource,
    missingResource,
    normalizeBinaryFileInput,
    type UamResourceLike,
} from "./AuthoringTransactionSupport";
import {
    detectImageSourceFormat,
    imageSourceFormatFromFileName,
    probeImageSourceDimensions,
} from "./ImageSourceProbe";
import {
    encodeMovieClipJta,
    parseMovieClipJta,
    type MovieClipJta,
    type MovieClipJtaFrame,
} from "./MovieClipJtaCodec";
import type { MovieClipFrameRect } from "./MovieClipSpriteSheetCodec";

export const MAX_MOVIECLIP_IMAGE_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_MOVIECLIP_IMAGE_SOURCE_PIXELS = 8 * 1024 * 1024;
export const MAX_MOVIECLIP_DESCRIPTOR_BYTES = 2 * 1024 * 1024;
export const MAX_MOVIECLIP_FRAME_COUNT = 512;
export const MAX_MOVIECLIP_TOTAL_SOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_MOVIECLIP_TOTAL_DECODED_PIXELS = 64 * 1024 * 1024;
export const MAX_MOVIECLIP_JTA_BYTES = 64 * 1024 * 1024;

export function probeMovieClipPngDimensions(
    sourceBytes: Uint8Array,
): { width: number; height: number } | null {
    return sourceBytes[0] === 0x89 ? probeImageSourceDimensions(sourceBytes) : null;
}

function createMovieClipModel(movieClip: MovieClipJta, smoothing: boolean): NonNullable<UamResourceLike["movieClip"]> {
    const millisecondsPerFrame = 1000 / movieClip.fps;
    return {
        interval: Math.trunc(millisecondsPerFrame * (movieClip.speed || 1)),
        repeatDelay: Math.trunc(millisecondsPerFrame * movieClip.repeatDelay),
        swing: movieClip.swing,
        smoothing,
        frames: movieClip.frames.map((frame) => ({
            rectX: frame.rectX,
            rectY: frame.rectY,
            rectWidth: frame.rectWidth,
            rectHeight: frame.rectHeight,
            addDelay: Math.trunc(millisecondsPerFrame * frame.delay),
            spriteId: "",
        })),
    };
}

function estimateMovieClipJtaBytes(frameCount: number, textures: Uint8Array[]): number {
    return 30 + frameCount * 12 + textures.length * 4
        + textures.reduce((total, texture) => total + texture.byteLength, 0);
}

function invalidMovieClipJtaSize(frameCount: number, textures: Uint8Array[]): HighRiskTransactionPreparation | null {
    return estimateMovieClipJtaBytes(frameCount, textures) > MAX_MOVIECLIP_JTA_BYTES
        ? {
            ok: false,
            code: "movieclip_jta_too_large",
            message: "Generated MovieClip JTA must not exceed 64 MiB.",
        }
        : null;
}

export function prepareImportMovieClipResource(
    projectValue: unknown,
    selector: { packageId: string },
    frameInputs: MovieClipFrameInput[],
    sourceFileName = "",
    fps = 24,
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    if (frameInputs.length === 0 || frameInputs.length > MAX_MOVIECLIP_FRAME_COUNT) {
        return { ok: false, code: "invalid_movieclip_frame_count", message: "MovieClip import requires 1 to 512 frames." };
    }
    if (!Number.isInteger(fps) || fps < 1 || fps > 127) {
        return { ok: false, code: "invalid_movieclip_fps", message: "MovieClip FPS must be an integer from 1 to 127." };
    }

    const frames: Array<{
        fileName: string;
        sourceBytes: Uint8Array;
        width: number;
        height: number;
        crop: MovieClipFrameRect;
        delay: number;
    }> = [];
    let totalSourceBytes = 0;
    let totalDecodedPixels = 0;
    for (const input of [...frameInputs].sort((a, b) =>
        a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" })
    )) {
        const normalized = normalizeBinaryFileInput(input);
        if (normalized.ok === false) return normalized;
        const sourceFormat = imageSourceFormatFromFileName(normalized.fileName);
        if (!sourceFormat) {
            return {
                ok: false,
                code: "unsupported_movieclip_frame",
                message: "MovieClip frames must be PNG or JPEG files.",
            };
        }
        const { width, height } = input.dimensions;
        if (
            !Number.isInteger(width)
            || !Number.isInteger(height)
            || width <= 0
            || height <= 0
            || width > 32767
            || height > 32767
        ) {
            return {
                ok: false,
                code: "invalid_movieclip_frame_dimensions",
                message: "MovieClip frame dimensions must be positive integers no larger than 32767.",
            };
        }
        const crop = input.crop || { x: 0, y: 0, width, height };
        const delay = input.delay ?? 0;
        if (
            ![crop.x, crop.y, crop.width, crop.height].every(Number.isInteger)
            || crop.x < 0
            || crop.y < 0
            || crop.width < 0
            || crop.height < 0
            || crop.x + crop.width > width
            || crop.y + crop.height > height
            || ((crop.width === 0 || crop.height === 0) && (crop.width !== 0 || crop.height !== 0))
            || (crop.width > 0 && normalized.sourceBytes.byteLength === 0)
            || !Number.isInteger(delay)
            || delay < 0
            || delay > 32767
        ) {
            return {
                ok: false,
                code: "invalid_movieclip_frame_crop",
                message: "MovieClip crop rectangles must stay inside their source frame.",
            };
        }
        if (normalized.sourceBytes.byteLength > MAX_MOVIECLIP_IMAGE_SOURCE_BYTES) {
            return {
                ok: false,
                code: "movieclip_frame_too_large",
                message: "Each MovieClip frame must not exceed 8 MiB.",
            };
        }
        const decodedPixels = width * height;
        if (decodedPixels > MAX_MOVIECLIP_IMAGE_SOURCE_PIXELS) {
            return {
                ok: false,
                code: "movieclip_frame_pixels_exceeded",
                message: "Each MovieClip PNG must not exceed 8 Mi-pixels.",
            };
        }
        totalSourceBytes += normalized.sourceBytes.byteLength;
        totalDecodedPixels += decodedPixels;
        if (totalSourceBytes > MAX_MOVIECLIP_TOTAL_SOURCE_BYTES) {
            return {
                ok: false,
                code: "movieclip_total_source_too_large",
                message: "MovieClip frame source bytes must not exceed 64 MiB in total.",
            };
        }
        if (totalDecodedPixels > MAX_MOVIECLIP_TOTAL_DECODED_PIXELS) {
            return {
                ok: false,
                code: "movieclip_total_pixels_exceeded",
                message: "MovieClip decoded pixels must not exceed 64 Mi-pixels in total.",
            };
        }
        if (crop.width > 0) {
            const sourceDimensions = probeImageSourceDimensions(normalized.sourceBytes);
            if (!sourceDimensions || detectImageSourceFormat(normalized.sourceBytes) !== sourceFormat) {
                return { ok: false, code: "invalid_movieclip_frame_image", message: "MovieClip frame bytes must match their PNG or JPEG file extension." };
            }
            if (sourceDimensions.width !== crop.width || sourceDimensions.height !== crop.height) {
                return {
                    ok: false,
                    code: "movieclip_frame_dimensions_mismatch",
                    message: "MovieClip image dimensions must match the stored crop dimensions.",
                };
            }
        }
        frames.push({
            fileName: normalized.fileName,
            sourceBytes: normalized.sourceBytes,
            width,
            height,
            crop,
            delay,
        });
    }

    const firstFileName = sourceFileName || frames[0].fileName;
    const baseName = firstFileName.slice(0, Math.max(0, firstFileName.lastIndexOf("."))) || "MovieClip";
    const identity = createBinaryResourceIdentity(pkg.resources || [], `${baseName}.jta`);
    const id = createCopyId(pkg.resources || [], "imported_movieclip");
    const jtaSizeFailure = invalidMovieClipJtaSize(frames.length, frames.map((frame) => frame.sourceBytes));
    if (jtaSizeFailure) return jtaSizeFailure;
    let sourceBytes: Uint8Array;
    try {
        sourceBytes = encodeMovieClipFrames(frames, fps);
    } catch (error) {
        return {
            ok: false,
            code: "invalid_movieclip_frames",
            message: error instanceof Error ? error.message : String(error),
        };
    }
    if (sourceBytes.byteLength > MAX_MOVIECLIP_JTA_BYTES) {
        return { ok: false, code: "movieclip_jta_too_large", message: "Generated MovieClip JTA must not exceed 64 MiB." };
    }
    const movieClip = parseMovieClipJta(sourceBytes);
    const resource: UamResourceLike = {
        kind: "movieClip",
        id,
        name: identity.name,
        path: "/imported/movieclips/",
        exported: false,
        favorite: false,
        branch: "",
        branchItemIds: [],
        fileName: identity.fileName,
        dimensions: { width: movieClip.boundsWidth, height: movieClip.boundsHeight },
        movieClip: createMovieClipModel(movieClip, true),
        sourceBytes,
    };
    return {
        ok: true,
        transaction: {
            summary: `Import MovieClip ${identity.fileName} (${frames.length} frames)`,
            operation: {
                opId: createOpId("import-movieclip-resource"),
                kind: "addResource",
                selector,
                resource,
            },
            inverseOperation: {
                opId: createOpId("remove-imported-movieclip-undo"),
                kind: "removeResource",
                selector: { packageId: selector.packageId, resourceId: id },
            },
        },
    };
}

export interface MovieClipFrameInput extends BinaryFileInput {
    dimensions: { width: number; height: number };
    crop?: MovieClipFrameRect;
    delay?: number;
}

export interface MovieClipSpriteSheetFrameInput {
    name: string;
    textureKey: string;
    sourceBytes: Uint8Array;
    rect: MovieClipFrameRect;
}

export function prepareImportMovieClipSpriteSheetResource(
    projectValue: unknown,
    selector: { packageId: string },
    descriptorFileName: string,
    frameInputs: MovieClipSpriteSheetFrameInput[],
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    if (!pkg) return { ok: false, code: "package_not_found", message: `Package ${selector.packageId} was not found.` };
    if (frameInputs.length === 0 || frameInputs.length > MAX_MOVIECLIP_FRAME_COUNT) {
        return { ok: false, code: "invalid_movieclip_frame_count", message: "Sprite Sheet requires 1 to 512 frames." };
    }
    const textureIndexes = new Map<string, number>();
    const textures: Uint8Array[] = [];
    const nonEmpty = frameInputs.filter((frame) => frame.rect.width > 0 && frame.rect.height > 0);
    const minX = nonEmpty.length > 0 ? Math.min(...nonEmpty.map((frame) => frame.rect.x)) : 0;
    const minY = nonEmpty.length > 0 ? Math.min(...nonEmpty.map((frame) => frame.rect.y)) : 0;
    const shiftX = Math.max(0, -minX);
    const shiftY = Math.max(0, -minY);
    const boundsWidth = nonEmpty.length > 0
        ? Math.max(...nonEmpty.map((frame) => frame.rect.x + frame.rect.width)) + shiftX
        : 0;
    const boundsHeight = nonEmpty.length > 0
        ? Math.max(...nonEmpty.map((frame) => frame.rect.y + frame.rect.height)) + shiftY
        : 0;
    const frames: MovieClipJtaFrame[] = [];
    let totalSourceBytes = 0;
    let totalDecodedPixels = 0;
    for (const [index, input] of frameInputs.entries()) {
        const rect = input.rect;
        if (
            ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)
            || rect.width < 0
            || rect.height < 0
            || (rect.width === 0) !== (rect.height === 0)
            || (rect.width > 0 && (!(input.sourceBytes instanceof Uint8Array) || input.sourceBytes.byteLength === 0))
        ) {
            return {
                ok: false,
                code: "invalid_sprite_sheet_frame",
                message: `Sprite Sheet frame ${index + 1} has invalid pixels or bounds.`,
            };
        }
        let textureIndex = -1;
        if (rect.width > 0) {
            textureIndex = textureIndexes.get(input.textureKey) ?? -1;
            if (textureIndex < 0) {
                if (input.sourceBytes.byteLength > MAX_MOVIECLIP_IMAGE_SOURCE_BYTES) {
                    return {
                        ok: false,
                        code: "movieclip_frame_too_large",
                        message: "Each Sprite Sheet frame PNG must not exceed 8 MiB.",
                    };
                }
                const pngDimensions = probeMovieClipPngDimensions(input.sourceBytes);
                if (!pngDimensions) {
                    return {
                        ok: false,
                        code: "invalid_movieclip_frame_png",
                        message: `Sprite Sheet frame ${index + 1} bytes must contain a PNG image.`,
                    };
                }
                const decodedPixels = pngDimensions.width * pngDimensions.height;
                if (decodedPixels > MAX_MOVIECLIP_IMAGE_SOURCE_PIXELS) {
                    return {
                        ok: false,
                        code: "movieclip_frame_pixels_exceeded",
                        message: "Each Sprite Sheet frame PNG must not exceed 8 Mi-pixels.",
                    };
                }
                totalSourceBytes += input.sourceBytes.byteLength;
                totalDecodedPixels += decodedPixels;
                if (totalSourceBytes > MAX_MOVIECLIP_TOTAL_SOURCE_BYTES) {
                    return {
                        ok: false,
                        code: "movieclip_total_source_too_large",
                        message: "Sprite Sheet frame source bytes must not exceed 64 MiB in total.",
                    };
                }
                if (totalDecodedPixels > MAX_MOVIECLIP_TOTAL_DECODED_PIXELS) {
                    return {
                        ok: false,
                        code: "movieclip_total_pixels_exceeded",
                        message: "Sprite Sheet decoded frame pixels must not exceed 64 Mi-pixels in total.",
                    };
                }
                textureIndex = textures.length;
                textureIndexes.set(input.textureKey, textureIndex);
                textures.push(new Uint8Array(input.sourceBytes));
            }
        }
        frames.push({
            delay: 0,
            rectX: rect.x + shiftX,
            rectY: rect.y + shiftY,
            rectWidth: rect.width,
            rectHeight: rect.height,
            textureIndex,
        });
    }
    if (boundsWidth > 65535 || boundsHeight > 65535) {
        return { ok: false, code: "invalid_sprite_sheet_bounds", message: "Sprite Sheet bounds exceed the JTA v102 range." };
    }
    const extensionIndex = descriptorFileName.lastIndexOf(".");
    const baseName = descriptorFileName.slice(0, Math.max(0, extensionIndex)) || "MovieClip";
    const identity = createBinaryResourceIdentity(pkg.resources || [], `${baseName}.jta`);
    const id = createCopyId(pkg.resources || [], "imported_movieclip");
    const jtaSizeFailure = invalidMovieClipJtaSize(frames.length, textures);
    if (jtaSizeFailure) return jtaSizeFailure;
    let sourceBytes: Uint8Array;
    try {
        sourceBytes = encodeMovieClipJta({
            fps: 24,
            speed: 1,
            repeatDelay: 0,
            swing: false,
            boundsX: 0,
            boundsY: 0,
            boundsWidth,
            boundsHeight,
            frames,
            textures,
        });
    } catch (error) {
        return {
            ok: false,
            code: "invalid_sprite_sheet_frames",
            message: error instanceof Error ? error.message : String(error),
        };
    }
    if (sourceBytes.byteLength > MAX_MOVIECLIP_JTA_BYTES) {
        return { ok: false, code: "movieclip_jta_too_large", message: "Generated MovieClip JTA must not exceed 64 MiB." };
    }
    const parsedMovieClip = parseMovieClipJta(sourceBytes);
    const resource: UamResourceLike = {
        kind: "movieClip",
        id,
        name: identity.name,
        path: "/imported/movieclips/",
        exported: false,
        favorite: false,
        branch: "",
        branchItemIds: [],
        fileName: identity.fileName,
        dimensions: { width: boundsWidth, height: boundsHeight },
        movieClip: createMovieClipModel(parsedMovieClip, true),
        sourceBytes,
    };
    return {
        ok: true,
        transaction: {
            summary: `Import MovieClip Sprite Sheet ${identity.fileName} (${frames.length} frames)`,
            operation: {
                opId: createOpId("import-movieclip-sprite-sheet"),
                kind: "addResource",
                selector,
                resource,
            },
            inverseOperation: {
                opId: createOpId("remove-imported-movieclip-sprite-sheet-undo"),
                kind: "removeResource",
                selector: { packageId: selector.packageId, resourceId: id },
            },
        },
    };
}

export interface MovieClipTimingUpdate {
    fps: number;
    speed: number;
    repeatDelay: number;
    swing: boolean;
    smoothing: boolean;
    frameDelays: number[];
}

export function prepareReplaceMovieClipResource(
    projectValue: unknown,
    selector: EditorResourceSelector,
    frameInputs: MovieClipFrameInput[],
    timing: MovieClipTimingUpdate,
): HighRiskTransactionPreparation {
    return prepareReplaceMovieClipFromImport(
        projectValue,
        selector,
        timing,
        prepareImportMovieClipResource(projectValue, { packageId: selector.packageId }, frameInputs),
    );
}

export function prepareReplaceMovieClipSpriteSheetResource(
    projectValue: unknown,
    selector: EditorResourceSelector,
    descriptorFileName: string,
    frameInputs: MovieClipSpriteSheetFrameInput[],
    timing: MovieClipTimingUpdate,
): HighRiskTransactionPreparation {
    return prepareReplaceMovieClipFromImport(
        projectValue,
        selector,
        timing,
        prepareImportMovieClipSpriteSheetResource(
            projectValue,
            { packageId: selector.packageId },
            descriptorFileName,
            frameInputs,
        ),
    );
}

function prepareReplaceMovieClipFromImport(
    projectValue: unknown,
    selector: EditorResourceSelector,
    timing: MovieClipTimingUpdate,
    imported: HighRiskTransactionPreparation,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    if (!resource) return missingResource(selector);
    if (resource.kind !== "movieClip" || !(resource.sourceBytes instanceof Uint8Array)) {
        return { ok: false, code: "movieclip_resource_required", message: "Choose a hydrated MovieClip resource." };
    }
    if (imported.ok === false) return imported;
    if (imported.transaction.operation.kind !== "addResource") {
        return { ok: false, code: "invalid_movieclip_import", message: "MovieClip replacement requires imported JTA bytes." };
    }
    const replacementBytes = (imported.transaction.operation.resource as UamResourceLike).sourceBytes;
    if (!(replacementBytes instanceof Uint8Array)) {
        return { ok: false, code: "invalid_movieclip_import", message: "MovieClip import did not produce JTA bytes." };
    }

    let current: MovieClipJta;
    let replacement: MovieClipJta;
    try {
        current = parseMovieClipJta(resource.sourceBytes);
        replacement = parseMovieClipJta(replacementBytes);
    } catch (error) {
        return {
            ok: false,
            code: "invalid_movieclip_jta",
            message: error instanceof Error ? error.message : String(error),
        };
    }
    if (invalidMovieClipTiming(timing, current.frames.length)) {
        return {
            ok: false,
            code: "invalid_movieclip_timing",
            message: "FPS must be 1-127, speed 1-255, repeat delay 0-255, and every existing frame delay 0-32767.",
        };
    }

    let sourceBytes: Uint8Array;
    try {
        sourceBytes = encodeMovieClipJta({
            ...replacement,
            fps: timing.fps,
            speed: timing.speed,
            repeatDelay: timing.repeatDelay,
            swing: timing.swing,
            frames: replacement.frames.map((frame, index) => ({
                ...frame,
                delay: timing.frameDelays[index] ?? 0,
            })),
        });
    } catch (error) {
        return { ok: false, code: "invalid_movieclip_frames", message: error instanceof Error ? error.message : String(error) };
    }
    if (sourceBytes.byteLength > MAX_MOVIECLIP_JTA_BYTES) {
        return { ok: false, code: "movieclip_jta_too_large", message: "Generated MovieClip JTA must not exceed 64 MiB." };
    }
    const sourceUnchanged = (
        sourceBytes.byteLength === resource.sourceBytes.byteLength
        && sourceBytes.every((value, index) => value === resource.sourceBytes![index])
    );
    const smoothingUnchanged = timing.smoothing === (resource.movieClip?.smoothing ?? true);
    if (sourceUnchanged && smoothingUnchanged) {
        return { ok: false, code: "movieclip_source_unchanged", message: "MovieClip source is unchanged." };
    }
    if (!smoothingUnchanged) {
        return prepareReplaceMovieClipSnapshot(
            projectValue,
            selector,
            resource,
            sourceBytes,
            timing.smoothing,
            `Replace MovieClip source for ${resource.name || resource.id} (${current.frames.length} -> ${replacement.frames.length} frames)`,
        );
    }
    return {
        ok: true,
        transaction: {
            summary: `Replace MovieClip source for ${resource.name || resource.id} (${current.frames.length} -> ${replacement.frames.length} frames)`,
            operation: {
                opId: createOpId("replace-movieclip-source"),
                kind: "replaceResourceBytes",
                selector,
                sourceBytes,
            },
            inverseOperation: {
                opId: createOpId("replace-movieclip-source-undo"),
                kind: "replaceResourceBytes",
                selector,
                sourceBytes: new Uint8Array(resource.sourceBytes),
            },
        },
    };
}

function encodeMovieClipFrames(
    frames: Array<{
        sourceBytes: Uint8Array;
        width: number;
        height: number;
        crop: MovieClipFrameRect;
        delay: number;
    }>,
    fps: number,
): Uint8Array {
    const boundsWidth = Math.max(...frames.map((frame) => frame.width));
    const boundsHeight = Math.max(...frames.map((frame) => frame.height));
    return encodeMovieClipJta({
        fps,
        speed: 1,
        repeatDelay: 0,
        swing: false,
        boundsX: 0,
        boundsY: 0,
        boundsWidth,
        boundsHeight,
        frames: frames.map((frame, index) => ({
            delay: frame.delay,
            rectX: Math.trunc(frame.crop.x - Math.trunc(frame.width / 2) + boundsWidth / 2),
            rectY: Math.trunc(frame.crop.y - Math.trunc(frame.height / 2) + boundsHeight / 2),
            rectWidth: frame.crop.width,
            rectHeight: frame.crop.height,
            textureIndex: frame.crop.width > 0 ? index : -1,
        })),
        textures: frames.map((frame) => frame.sourceBytes),
    });
}

export function prepareUpdateMovieClipResource(
    projectValue: unknown,
    selector: EditorResourceSelector,
    update: MovieClipTimingUpdate,
): HighRiskTransactionPreparation {
    const resource = findResource(projectValue, selector);
    if (!resource) return missingResource(selector);
    if (resource.kind !== "movieClip" || !(resource.sourceBytes instanceof Uint8Array)) {
        return { ok: false, code: "movieclip_resource_required", message: "Choose a hydrated MovieClip resource." };
    }
    let movieClip: MovieClipJta;
    try {
        movieClip = parseMovieClipJta(resource.sourceBytes);
    } catch (error) {
        return {
            ok: false,
            code: "invalid_movieclip_jta",
            message: error instanceof Error ? error.message : String(error),
        };
    }
    if (invalidMovieClipTiming(update, movieClip.frames.length)) {
        return {
            ok: false,
            code: "invalid_movieclip_timing",
            message: "FPS must be 1-127, speed 1-255, repeat delay 0-255, and every frame delay 0-32767.",
        };
    }
    if (invalidMovieClipJtaSize(movieClip.frames.length, movieClip.textures)) {
        return { ok: false, code: "movieclip_jta_too_large", message: "Generated MovieClip JTA must not exceed 64 MiB." };
    }
    let sourceBytes: Uint8Array;
    try {
        sourceBytes = encodeMovieClipJta({
            ...movieClip,
            fps: update.fps,
            speed: update.speed,
            repeatDelay: update.repeatDelay,
            swing: update.swing,
            frames: movieClip.frames.map((frame, index) => ({ ...frame, delay: update.frameDelays[index] })),
        });
    } catch (error) {
        return { ok: false, code: "invalid_movieclip_jta", message: error instanceof Error ? error.message : String(error) };
    }
    const sourceUnchanged = (
        sourceBytes.byteLength === resource.sourceBytes.byteLength
        && sourceBytes.every((value, index) => value === resource.sourceBytes![index])
    );
    const smoothingUnchanged = update.smoothing === (resource.movieClip?.smoothing ?? true);
    if (sourceUnchanged && smoothingUnchanged) {
        return { ok: false, code: "movieclip_timing_unchanged", message: "MovieClip timing is unchanged." };
    }
    if (!smoothingUnchanged) {
        return prepareReplaceMovieClipSnapshot(
            projectValue,
            selector,
            resource,
            sourceBytes,
            update.smoothing,
            `Update MovieClip timing for ${resource.name || resource.id}`,
        );
    }
    return {
        ok: true,
        transaction: {
            summary: `Update MovieClip timing for ${resource.name || resource.id}`,
            operation: {
                opId: createOpId("update-movieclip-timing"),
                kind: "replaceResourceBytes",
                selector,
                sourceBytes,
            },
            inverseOperation: {
                opId: createOpId("update-movieclip-timing-undo"),
                kind: "replaceResourceBytes",
                selector,
                sourceBytes: new Uint8Array(resource.sourceBytes),
            },
        },
    };
}

function invalidMovieClipTiming(update: MovieClipTimingUpdate, frameCount: number): boolean {
    return !Number.isInteger(update.fps)
        || update.fps < 1
        || update.fps > 127
        || !Number.isInteger(update.speed)
        || update.speed < 1
        || update.speed > 255
        || !Number.isInteger(update.repeatDelay)
        || update.repeatDelay < 0
        || update.repeatDelay > 255
        || typeof update.swing !== "boolean"
        || typeof update.smoothing !== "boolean"
        || update.frameDelays.length !== frameCount
        || update.frameDelays.some((delay) => !Number.isInteger(delay) || delay < 0 || delay > 32767);
}

function prepareReplaceMovieClipSnapshot(
    projectValue: unknown,
    selector: EditorResourceSelector,
    resource: UamResourceLike,
    sourceBytes: Uint8Array,
    smoothing: boolean,
    summary: string,
): HighRiskTransactionPreparation {
    const pkg = findPackage(projectValue, selector.packageId);
    const atIndex = pkg?.resources?.findIndex((item) => item.id === selector.resourceId) ?? -1;
    if (!pkg || atIndex < 0) return missingResource(selector);
    const parsed = parseMovieClipJta(sourceBytes);
    const replacement = createAddResourceSnapshot(resource);
    replacement.sourceBytes = new Uint8Array(sourceBytes);
    replacement.dimensions = { width: parsed.boundsWidth, height: parsed.boundsHeight };
    replacement.movieClip = createMovieClipModel(parsed, smoothing);
    const original = createAddResourceSnapshot(resource);
    if (!original.movieClip && resource.sourceBytes) {
        original.movieClip = createMovieClipModel(parseMovieClipJta(resource.sourceBytes), resource.movieClip?.smoothing ?? true);
    }
    const remove = { opId: createOpId("replace-movieclip-remove"), kind: "removeResource" as const, selector };
    const add = {
        opId: createOpId("replace-movieclip-add"),
        kind: "addResource" as const,
        selector: { packageId: selector.packageId },
        resource: replacement,
        atIndex,
    };
    const undoRemove = { opId: createOpId("replace-movieclip-undo-remove"), kind: "removeResource" as const, selector };
    const undoAdd = {
        opId: createOpId("replace-movieclip-undo-add"),
        kind: "addResource" as const,
        selector: { packageId: selector.packageId },
        resource: original,
        atIndex,
    };
    return {
        ok: true,
        transaction: {
            summary,
            operation: remove,
            inverseOperation: undoRemove,
            operations: [remove, add],
            inverseOperations: [undoRemove, undoAdd],
        },
    };
}

export function findOpaqueBounds(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
): MovieClipFrameRect {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || rgba.length !== width * height * 4) {
        throw new Error("RGBA dimensions do not match the frame pixels.");
    }
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (rgba[(y * width + x) * 4 + 3] === 0) continue;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
        }
    }
    return right < left
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
