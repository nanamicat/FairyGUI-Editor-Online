import { findResource } from "../commands/AuthoringTransactionSupport";
import {
    MAX_BROWSER_IMAGE_SOURCE_BYTES,
    MAX_BROWSER_IMAGE_SOURCE_PIXELS,
    detectImageSourceFormat,
    findOpaqueBounds,
    imageSourceFormatFromFileName,
    parseMovieClipJta,
    parseMovieClipSpriteSheetDescriptor,
    prepareReplaceImageSource,
    prepareReplaceAssetBytes,
    prepareReplaceMovieClipResource,
    prepareReplaceMovieClipSpriteSheetResource,
    prepareSetImageResourceProps,
    prepareUpdateMovieClipResource,
    probeImageSourceDimensions,
    readImageResourceProps,
    type HighRiskTransactionPreparation,
    type MovieClipFrameInput,
    type MovieClipJta,
    type MovieClipSpriteSheetFrame,
    type MovieClipSpriteSheetFrameInput,
    type MovieClipTimingUpdate,
} from "../commands/HighRiskAuthoringTransactions";
import {
    MAX_MOVIECLIP_DESCRIPTOR_BYTES,
    MAX_MOVIECLIP_FRAME_COUNT,
    MAX_MOVIECLIP_IMAGE_SOURCE_BYTES,
    MAX_MOVIECLIP_IMAGE_SOURCE_PIXELS,
    MAX_MOVIECLIP_TOTAL_DECODED_PIXELS,
    MAX_MOVIECLIP_TOTAL_SOURCE_BYTES,
    probeMovieClipPngDimensions,
} from "../commands/MovieClipTransactions";
import type { ImageResourceEditableProps } from "../model/EditorCommand";
import type { ProjectSnapshotPackage, ProjectSnapshotResource } from "../model/ProjectSnapshot";
import { pickBrowserFile, pickBrowserFiles } from "../services/BrowserFilePicker";
import { createStoredZipBlob } from "../services/BrowserProjectStorage";
import { addDialogBackground } from "../ui/EditorFormControls";

export type ResourceEditorContext = {
    resource: ProjectSnapshotResource | null;
    selectedPackage: ProjectSnapshotPackage | null;
    getWorkingProject(): unknown | null;
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    applyPreparation(preparation: HighRiskTransactionPreparation): Promise<boolean>;
    download(blob: Blob, fileName: string): void;
    setStatus(message: string): void;
    setDebugAttribute(name: string, value: string): void;
    eventOwner: object;
};

export function showImageEditor(options: ResourceEditorContext): void {
    const resource = options.resource;
    const selectedPackage = options.selectedPackage;
    const liveResource = resource && selectedPackage
        ? findResource(options.getWorkingProject(), {
            packageId: selectedPackage.id,
            resourceId: resource.id,
        })
        : null;
    if (!resource || !selectedPackage || resource.type !== "ImageResource" || liveResource?.kind !== "image") {
        options.setStatus("Image editor unavailable: choose an image resource.");
        return;
    }

    const current = readImageResourceProps(liveResource);
    const width = Number(liveResource.dimensions?.width || 0);
    const height = Number(liveResource.dimensions?.height || 0);
    const initialGrid = current.scale9Grid || [
        Math.floor(width / 3),
        Math.floor(height / 3),
        Math.max(1, Math.floor(width / 3)),
        Math.max(1, Math.floor(height / 3)),
    ] as [number, number, number, number];

    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopImageEditDialog";
    const content = fgui.UIPackage.createObject("Builder", "ImageEditDialog").asCom;
    addDialogBackground(content);
    dialog.contentPane = content;
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `${resource.name || resource.id} - Image`;

    const widthInput = content.getChild("width").asLabel;
    const heightInput = content.getChild("height").asLabel;
    widthInput.title = String(width);
    heightInput.title = String(height);
    widthInput.enabled = false;
    heightInput.enabled = false;
    content.getChild("fileSize").text = liveResource.sourceBytes instanceof Uint8Array
        ? `${liveResource.sourceBytes.byteLength} bytes`
        : "Not hydrated";

    const scaleController = content.getController("scaleOption");
    scaleController.selectedIndex = current.scaleOption;
    const grid0 = content.getChild("grid0").asLabel;
    const grid1 = content.getChild("grid1").asLabel;
    const grid2 = content.getChild("grid2").asLabel;
    const grid3 = content.getChild("grid3").asLabel;
    grid0.title = String(initialGrid[1]);
    grid1.title = String(Math.max(0, height - initialGrid[1] - initialGrid[3]));
    grid2.title = String(initialGrid[0]);
    grid3.title = String(Math.max(0, width - initialGrid[0] - initialGrid[2]));

    const tileController = content.getController("tileGrid");
    tileController.selectedIndex = current.tileGridIndice === 0 ? 0 : 1;
    for (let index = 0; index < 5; index += 1) {
        content.getChild(`gridTile${index}`).asButton.selected = (current.tileGridIndice & (1 << index)) !== 0;
    }
    const smoothing = content.getChild("smoothing").asButton;
    smoothing.selected = current.smoothing;
    const duplicatePadding = content.getChild("duplicatePadding").asButton;
    duplicatePadding.selected = current.duplicatePadding;

    const quality = content.getChild("qualityOption").asComboBox;
    const qualityValues = ["", "source", "custom"];
    quality.items = ["Default", "Use source data", "Custom"];
    quality.values = [...qualityValues];
    if (current.qualityOption && !qualityValues.includes(current.qualityOption)) {
        quality.items = [...quality.items, `Current: ${current.qualityOption}`];
        quality.values = [...quality.values, current.qualityOption];
    }
    quality.selectedIndex = Math.max(0, quality.values.indexOf(current.qualityOption));
    content.getController("qualityOption").selectedIndex = quality.selectedIndex;
    const qualityValue = content.getChild("quality").asLabel;
    qualityValue.title = String(current.quality);
    qualityValue.enabled = quality.value === "custom";
    quality.on(fgui.Events.STATE_CHANGED, options.eventOwner, () => {
        content.getController("qualityOption").selectedIndex = quality.selectedIndex;
        qualityValue.enabled = quality.value === "custom";
    });

    const atlas = content.getChild("atlas").asComboBox;
    const atlasValues = ["", "alone", "alone_npot", "alone_mof", ...Array.from({ length: 11 }, (_, index) => String(index))];
    atlas.items = ["Default", "Standalone", "Standalone (NPOT)", "Standalone (multiple of 4)", ...Array.from({ length: 11 }, (_, index) => `Atlas page ${index}`)];
    atlas.values = [...atlasValues];
    if (current.textureSetMode && !atlasValues.includes(current.textureSetMode)) {
        atlas.items = [...atlas.items, `Current: ${current.textureSetMode}`];
        atlas.values = [...atlas.values, current.textureSetMode];
    }
    atlas.selectedIndex = Math.max(0, atlas.values.indexOf(current.textureSetMode));

    const sourceBytes = liveResource.sourceBytes instanceof Uint8Array ? liveResource.sourceBytes : null;
    const sourceFileName = String(liveResource.fileName || liveResource.file || "");
    const sourceFormat = imageSourceFormatFromFileName(sourceFileName);
    const detectedSourceFormat = sourceBytes ? detectImageSourceFormat(sourceBytes) : null;
    const sourceUpdateEnabled = Boolean(sourceBytes && sourceFormat && detectedSourceFormat === sourceFormat);
    const updateSource = content.getChild("import").asButton;
    updateSource.enabled = sourceUpdateEnabled;
    updateSource.tooltips = sourceUpdateEnabled
        ? `Replace ${sourceFileName} with a decoded ${sourceFormat === "png" ? "PNG" : "JPEG"} file.`
        : "Source update requires a hydrated PNG or JPEG resource.";
    const sourceDimensions = sourceBytes ? probeImageSourceDimensions(sourceBytes) : null;
    const sourceWithinPixelLimit = Boolean(
        sourceDimensions
        && sourceDimensions.width <= Math.floor(MAX_BROWSER_IMAGE_SOURCE_PIXELS / sourceDimensions.height),
    );
    const cutAlphaBaseEnabled = Boolean(
        sourceUpdateEnabled
        && sourceFormat === "png"
        && sourceBytes
        && sourceBytes.byteLength <= MAX_BROWSER_IMAGE_SOURCE_BYTES
        && sourceWithinPixelLimit,
    );
    const cutAlpha = content.getChild("cutAlpha").asButton;
    const disableTrim = content.getChild("disableTrim");
    disableTrim.enabled = false;
    disableTrim.tooltips = "Disable Trim is read-only in this editor version.";

    let previewUrl = "";
    let preview: fgui.GLoader | null = null;
    if (liveResource.sourceBytes instanceof Uint8Array) {
        previewUrl = URL.createObjectURL(new Blob(
            [new Uint8Array(liveResource.sourceBytes)],
            { type: detectImageMimeType(liveResource.sourceBytes) },
        ));
        const previewHost = content.getChild("imageContainer").asCom;
        preview = new fgui.GLoader();
        preview.name = "imageResourcePreview";
        preview.setSize(previewHost.width, previewHost.height);
        preview.fill = fgui.LoaderFillType.Scale;
        preview.shrinkOnly = true;
        preview.touchable = false;
        preview.url = previewUrl;
        previewHost.addChild(preview);
    }

    let busy = false;
    let disposed = false;
    let appliedProps = structuredClone(current);
    const readInteger = (input: fgui.GLabel): number => Number(input.title.trim());
    const readProps = (): ImageResourceEditableProps => {
        const scaleOption = scaleController.selectedIndex as 0 | 1 | 2;
        const left = readInteger(grid2);
        const top = readInteger(grid0);
        const right = readInteger(grid3);
        const bottom = readInteger(grid1);
        const customQuality = readInteger(qualityValue);
        let tileGridIndice = 0;
        if (scaleOption === 1 && tileController.selectedIndex === 1) {
            for (let index = 0; index < 5; index += 1) {
                if (content.getChild(`gridTile${index}`).asButton.selected) tileGridIndice |= 1 << index;
            }
        }
        return {
            textureSetMode: atlas.value || "",
            qualityOption: quality.value || "",
            quality: customQuality,
            smoothing: smoothing.selected,
            duplicatePadding: duplicatePadding.selected,
            scaleOption,
            scale9Grid: scaleOption === 1
                ? [left, top, width - left - right, height - top - bottom]
                : null,
            tileGridIndice,
        };
    };
    const propsAreEqual = (left: ImageResourceEditableProps, right: ImageResourceEditableProps): boolean => (
        left.textureSetMode === right.textureSetMode
        && left.qualityOption === right.qualityOption
        && left.quality === right.quality
        && left.smoothing === right.smoothing
        && left.duplicatePadding === right.duplicatePadding
        && left.scaleOption === right.scaleOption
        && left.tileGridIndice === right.tileGridIndice
        && JSON.stringify(left.scale9Grid) === JSON.stringify(right.scale9Grid)
    );
    const requireAppliedProps = (action: string): boolean => {
        if (propsAreEqual(readProps(), appliedProps)) return true;
        options.setStatus(`${action} unavailable: Apply image properties before changing source bytes.`);
        return false;
    };
    const refreshCutAlphaState = (): void => {
        cutAlpha.enabled = cutAlphaBaseEnabled && scaleController.selectedIndex === 0;
        cutAlpha.tooltips = cutAlpha.enabled
            ? "Crop fully transparent edge pixels and re-encode this PNG."
            : scaleController.selectedIndex !== 0
                ? "Alpha crop is disabled for scale9 and tiled images. Apply None before cropping."
                : "Alpha crop requires a hydrated PNG within the browser byte and pixel limits.";
    };
    scaleController.on(fgui.Events.STATE_CHANGED, options.eventOwner, refreshCutAlphaState);
    refreshCutAlphaState();
    const apply = async (close: boolean): Promise<void> => {
        if (busy || disposed) return;
        busy = true;
        try {
            const props = readProps();
            const preparation = prepareSetImageResourceProps(
                options.getWorkingProject(),
                { packageId: selectedPackage.id, resourceId: resource.id },
                props,
            );
            if (preparation.ok === false && preparation.code === "image_properties_unchanged") {
                options.setStatus("Image properties are unchanged.");
                if (close) dialog.dispose();
                return;
            }
            if (disposed) return;
            const applied = await options.applyPreparation(preparation);
            if (disposed || !applied) return;
            appliedProps = structuredClone(props);
            options.setDebugAttribute(
                "data-fairy-editor-image-edit",
                `${resource.id}:${props.scaleOption}:${props.scale9Grid?.join(",") || "none"}:${props.textureSetMode || "default"}:${props.smoothing}:${props.duplicatePadding}`,
            );
            if (close) dialog.dispose();
        } finally {
            busy = false;
        }
    };
    const applySourceUpdate = async (): Promise<void> => {
        if (busy || disposed || !sourceFormat || !requireAppliedProps("Image source update")) return;
        busy = true;
        let bitmap: ImageBitmap | null = null;
        try {
            const file = await pickBrowserFile(
                sourceFormat === "png" ? ".png,image/png" : ".jpg,.jpeg,image/jpeg",
                "Image source update was cancelled.",
                "image-source-update",
            );
            if (disposed) return;
            if (file.size > MAX_BROWSER_IMAGE_SOURCE_BYTES) {
                options.setStatus("Image source update skipped: browser image updates are limited to 8 MiB.");
                return;
            }
            const replacementBytes = new Uint8Array(await file.arrayBuffer());
            if (disposed) return;
            const selectedFormat = imageSourceFormatFromFileName(file.name);
            const detectedFormat = detectImageSourceFormat(replacementBytes);
            const headerDimensions = probeImageSourceDimensions(replacementBytes);
            if (selectedFormat !== sourceFormat || detectedFormat !== sourceFormat || !headerDimensions) {
                options.setStatus(`Image source update skipped: choose a valid ${sourceFormat === "png" ? "PNG" : "JPEG"} file.`);
                return;
            }
            if (headerDimensions.width > Math.floor(MAX_BROWSER_IMAGE_SOURCE_PIXELS / headerDimensions.height)) {
                options.setStatus(`Image source update skipped: decoded images are limited to ${MAX_BROWSER_IMAGE_SOURCE_PIXELS} pixels.`);
                return;
            }
            const replacementBlob = new Blob(
                [replacementBytes],
                { type: sourceFormat === "png" ? "image/png" : "image/jpeg" },
            );
            bitmap = sourceFormat === "jpeg"
                ? await createImageBitmap(replacementBlob, { imageOrientation: "none" })
                : await createImageBitmap(replacementBlob);
            if (disposed) return;
            if (bitmap.width !== headerDimensions.width || bitmap.height !== headerDimensions.height) {
                options.setStatus(
                    `Image source update skipped: decoded dimensions ${bitmap.width}×${bitmap.height} do not match image bytes ${headerDimensions.width}×${headerDimensions.height}.`,
                );
                return;
            }
            const preparation = prepareReplaceImageSource(
                options.getWorkingProject(),
                { packageId: selectedPackage.id, resourceId: resource.id },
                {
                    fileName: file.name,
                    sourceBytes: replacementBytes,
                    dimensions: { width: bitmap.width, height: bitmap.height },
                },
            );
            if (preparation.ok === false) {
                options.setStatus(`Image source update unavailable: ${preparation.code}. ${preparation.message}`);
                return;
            }
            if (disposed) return;
            const applied = await options.applyPreparation(preparation);
            if (disposed || !applied) return;
            options.setDebugAttribute(
                "data-fairy-editor-image-source-update",
                `${resource.id}:${sourceFormat}:${bitmap.width}x${bitmap.height}`,
            );
            dialog.dispose();
        } catch (error) {
            if (!disposed) {
                options.setStatus(`Image source update skipped: ${error instanceof Error ? error.message : String(error)}`);
            }
        } finally {
            bitmap?.close();
            busy = false;
        }
    };
    const applyAlphaCrop = async (): Promise<void> => {
        if (
            busy
            || disposed
            || sourceFormat !== "png"
            || !sourceBytes
            || !requireAppliedProps("Image alpha crop")
        ) return;
        if (scaleController.selectedIndex !== 0) {
            options.setStatus("Image alpha crop unavailable: scale9 and tiled images must use None before cropping.");
            return;
        }
        busy = true;
        let bitmap: ImageBitmap | null = null;
        try {
            const headerDimensions = probeImageSourceDimensions(sourceBytes);
            if (
                sourceBytes.byteLength > MAX_BROWSER_IMAGE_SOURCE_BYTES
                || !headerDimensions
                || headerDimensions.width > Math.floor(MAX_BROWSER_IMAGE_SOURCE_PIXELS / headerDimensions.height)
            ) {
                options.setStatus("Image alpha crop skipped: source bytes exceed browser image limits or have invalid dimensions.");
                return;
            }
            bitmap = await createImageBitmap(new Blob([new Uint8Array(sourceBytes)], { type: "image/png" }));
            if (disposed) return;
            if (
                bitmap.width !== headerDimensions.width
                || bitmap.height !== headerDimensions.height
                || bitmap.width !== width
                || bitmap.height !== height
            ) {
                options.setStatus("Image alpha crop skipped: source header, decoded, and resource dimensions do not match.");
                return;
            }
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context) throw new Error("Browser canvas is unavailable for image alpha crop.");
            context.drawImage(bitmap, 0, 0);
            const bounds = findOpaqueBounds(
                context.getImageData(0, 0, bitmap.width, bitmap.height).data,
                bitmap.width,
                bitmap.height,
            );
            if (bounds.width === 0 || bounds.height === 0) {
                options.setStatus("Image alpha crop skipped: the PNG is fully transparent.");
                return;
            }
            if (
                bounds.x === 0
                && bounds.y === 0
                && bounds.width === bitmap.width
                && bounds.height === bitmap.height
            ) {
                options.setStatus("Image alpha crop skipped: transparent edge bounds are unchanged.");
                return;
            }

            const cropped = document.createElement("canvas");
            cropped.width = bounds.width;
            cropped.height = bounds.height;
            const croppedContext = cropped.getContext("2d");
            if (!croppedContext) throw new Error("Browser canvas is unavailable for image alpha crop.");
            croppedContext.drawImage(
                canvas,
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
                0,
                0,
                bounds.width,
                bounds.height,
            );
            const croppedBytes = await encodeCanvasPng(cropped, "Image alpha-crop PNG encoding failed.");
            if (disposed) return;
            const preparation = prepareReplaceImageSource(
                options.getWorkingProject(),
                { packageId: selectedPackage.id, resourceId: resource.id },
                {
                    fileName: sourceFileName,
                    sourceBytes: croppedBytes,
                    dimensions: { width: bounds.width, height: bounds.height },
                },
            );
            if (preparation.ok === false) {
                options.setStatus(`Image alpha crop unavailable: ${preparation.code}. ${preparation.message}`);
                return;
            }
            if (disposed) return;
            const applied = await options.applyPreparation(preparation);
            if (disposed || !applied) return;
            options.setDebugAttribute(
                "data-fairy-editor-image-cut-alpha",
                `${resource.id}:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`,
            );
            dialog.dispose();
        } catch (error) {
            if (!disposed) {
                options.setStatus(`Image alpha crop skipped: ${error instanceof Error ? error.message : String(error)}`);
            }
        } finally {
            bitmap?.close();
            busy = false;
        }
    };
    const cleanup = (): void => {
        if (disposed) return;
        disposed = true;
        if (preview) preview.url = "";
        if (previewUrl) releaseLayaObjectUrl(previewUrl);
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    };
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, cleanup);
    updateSource.onClick(options.eventOwner, () => void applySourceUpdate());
    cutAlpha.onClick(options.eventOwner, () => void applyAlphaCrop());
    content.getChild("apply").asButton.onClick(options.eventOwner, () => void apply(false));
    content.getChild("save").asButton.onClick(options.eventOwner, () => void apply(true));
    content.getChild("close").asButton.onClick(options.eventOwner, () => {
        if (busy) {
            options.setStatus("Image operation is still running; wait for it to finish before closing.");
            return;
        }
        options.setStatus("Image edit cancelled.");
        dialog.dispose();
    });
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute(
        "data-fairy-editor-image-editor",
        `${resource.id}:${width}x${height}:${current.scaleOption}:${current.textureSetMode || "default"}`,
    );
    options.setStatus(`Editing image ${resource.name || resource.id}.`);
}

type BitmapFontChar = {
    id: number;
    imageId: string;
    xoffset: number;
    yoffset: number;
    xadvance: number;
};

export function parseBitmapFont(source: string): {
    lines: string[];
    ttf: boolean;
    size: number;
    xadvance: number;
    resizable: boolean;
    colored: boolean;
    chars: BitmapFontChar[];
} {
    const lines = source.split(/\r?\n/);
    const fields = (line: string): Record<string, string> => Object.fromEntries(
        [...line.matchAll(/([A-Za-z][A-Za-z0-9]*)=(?:"([^"]*)"|(\S+))/g)]
            .map((match) => [match[1], match[2] ?? match[3]]),
    );
    const infoLine = lines.find((line) => line.trimStart().startsWith("info ")) || "";
    const commonLine = lines.find((line) => line.trimStart().startsWith("common ")) || "";
    const info = fields(infoLine);
    const common = fields(commonLine);
    const ttf = "face" in info;
    return {
        lines,
        ttf,
        size: Number(info.size || common.lineHeight || 0),
        xadvance: Number(common.xadvance || 0),
        resizable: info.resizable === "true",
        colored: info.colored === undefined ? ttf : info.colored === "true",
        chars: lines.flatMap((line): BitmapFontChar[] => {
            if (!line.trimStart().startsWith("char ")) return [];
            const value = fields(line);
            return [{
                id: Number(value.id || 0),
                imageId: value.img || "",
                xoffset: Number(value.xoffset || 0),
                yoffset: Number(value.yoffset || 0),
                xadvance: Number(value.xadvance || 0),
            }];
        }),
    };
}

function setBitmapFontFlag(line: string, name: string, value: boolean): string {
    const expression = new RegExp(`(^|\\s)${name}=\\S+`);
    return expression.test(line)
        ? line.replace(expression, `$1${name}=${value}`)
        : `${line} ${name}=${value}`;
}

export function showFontEditor(options: ResourceEditorContext): void {
    const resource = options.resource;
    const selectedPackage = options.selectedPackage;
    const liveResource = resource && selectedPackage
        ? findResource(options.getWorkingProject(), {
            packageId: selectedPackage.id,
            resourceId: resource.id,
        })
        : null;
    if (
        !resource
        || !selectedPackage
        || resource.type !== "FontResource"
        || liveResource?.kind !== "font"
        || !(liveResource.sourceBytes instanceof Uint8Array)
    ) {
        options.setStatus("Font editor unavailable: choose a hydrated bitmap font resource.");
        return;
    }

    let source = "";
    try {
        source = new TextDecoder("utf-8", { fatal: true }).decode(liveResource.sourceBytes);
    } catch {
        options.setStatus("Font editor unavailable: the FNT file is not UTF-8 text.");
        return;
    }
    const font = parseBitmapFont(source);
    if (font.chars.length === 0) {
        options.setStatus("Font editor unavailable: the FNT file has no character records.");
        return;
    }

    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopFontEditDialog";
    const content = fgui.UIPackage.createObject("Builder", "FontEditDialog").asCom;
    addDialogBackground(content);
    dialog.contentPane = content;
    content.getChild("frame").asLabel.title = `${resource.name || resource.id} - Font`;
    content.getController("ttf").selectedIndex = font.ttf ? 1 : 0;

    const list = content.getChild("list").asList;
    list.removeChildrenToPool();
    for (const character of font.chars) {
        const row = list.addItemFromPool().asCom;
        row.data = character;
        row.getChild("res").text = character.imageId
            ? selectedPackage.resources.find((candidate) => candidate.id === character.imageId)?.name || character.imageId
            : "";
        row.getChild("char").text = Number.isInteger(character.id) && character.id > 0 && character.id <= 0x10ffff
            ? String.fromCodePoint(character.id)
            : "";
        row.getChild("char").enabled = !font.ttf;
        row.getChild("xoffset").text = String(character.xoffset);
        row.getChild("yoffset").text = String(character.yoffset);
        row.getChild("xadvance").text = String(character.xadvance);
    }

    const size = content.getChild("size").asLabel;
    const xadvance = content.getChild("xadvance").asLabel;
    const resizable = content.getChild("resizable").asButton;
    const colored = content.getChild("colored").asButton;
    size.title = String(font.size);
    xadvance.title = String(font.xadvance);
    size.enabled = !font.ttf;
    xadvance.enabled = !font.ttf;
    resizable.selected = font.resizable;
    colored.selected = font.colored;
    content.getChild("deleteChar").visible = !font.ttf;

    const textureId = String(
        (liveResource.metadata as { textureId?: unknown } | null | undefined)?.textureId || "",
    );
    const texture = textureId
        ? findResource(options.getWorkingProject(), { packageId: selectedPackage.id, resourceId: textureId })
        : null;
    content.getChild("atlas").visible = Boolean(textureId);
    content.getChild("fontTexture").text = textureId ? `ui://${selectedPackage.id}${textureId}` : "";
    content.getChild("fontTexture").enabled = false;
    const preview = new fgui.GLoader();
    const previewHost = content.getChild("imageContainer").asCom;
    preview.touchable = false;
    preview.fill = fgui.LoaderFillType.Scale;
    preview.shrinkOnly = true;
    preview.setSize(previewHost.width, previewHost.height);
    previewHost.addChild(preview);
    let previewUrl = "";
    const showPreview = (candidate: ReturnType<typeof findResource>): void => {
        preview.url = "";
        if (previewUrl) releaseLayaObjectUrl(previewUrl);
        previewUrl = "";
        if (!(candidate?.sourceBytes instanceof Uint8Array)) {
            content.getChild("imageInfo").text = "";
            return;
        }
        previewUrl = URL.createObjectURL(new Blob(
            [new Uint8Array(candidate.sourceBytes)],
            { type: detectImageMimeType(candidate.sourceBytes) },
        ));
        preview.url = previewUrl;
        content.getChild("imageInfo").text = candidate.dimensions
            ? `${candidate.dimensions.width}x${candidate.dimensions.height}`
            : "";
    };
    showPreview(texture);
    list.on(fgui.Events.CLICK_ITEM, options.eventOwner, (item: fgui.GObject) => {
        if (font.ttf) return;
        const character = item.data as BitmapFontChar;
        showPreview(character.imageId
            ? findResource(options.getWorkingProject(), {
                packageId: selectedPackage.id,
                resourceId: character.imageId,
            })
            : null);
    });
    content.getChild("deleteChar").asButton.onClick(options.eventOwner, () => {
        if (list.selectedIndex >= 0) list.removeChildToPoolAt(list.selectedIndex);
    });

    let busy = false;
    const readInteger = (value: string, label: string): number | null => {
        const parsed = Number(value.trim());
        if (!Number.isInteger(parsed)) {
            options.setStatus(`${label} must be an integer.`);
            return null;
        }
        return parsed;
    };
    const apply = async (close: boolean): Promise<void> => {
        if (busy) return;
        let nextSource = source;
        if (font.ttf) {
            const infoIndex = font.lines.findIndex((line) => line.trimStart().startsWith("info "));
            if (infoIndex < 0) return;
            const lines = [...font.lines];
            lines[infoIndex] = setBitmapFontFlag(
                setBitmapFontFlag(lines[infoIndex], "resizable", resizable.selected),
                "colored",
                colored.selected,
            );
            nextSource = lines.join(source.includes("\r\n") ? "\r\n" : "\n");
        } else {
            const fontSize = readInteger(size.title, "Font size");
            const defaultAdvance = readInteger(xadvance.title, "Default advance");
            if (fontSize === null || defaultAdvance === null) return;
            const charLines: string[] = [];
            for (let index = 0; index < list.numChildren; index += 1) {
                const row = list.getChildAt(index).asCom;
                const original = row.data as BitmapFontChar;
                const character = row.getChild("char").text;
                const xoffsetValue = readInteger(row.getChild("xoffset").text, "X offset");
                const yoffsetValue = readInteger(row.getChild("yoffset").text, "Y offset");
                const advanceValue = readInteger(row.getChild("xadvance").text, "Character advance");
                if (!character || xoffsetValue === null || yoffsetValue === null || advanceValue === null) return;
                charLines.push(
                    `char id=${character.codePointAt(0)} img=${original.imageId}`
                    + ` xoffset=${xoffsetValue} yoffset=${yoffsetValue} xadvance=${advanceValue}`,
                );
            }
            nextSource = [
                `info creator=UIBuilder${fontSize ? ` size=${fontSize}` : ""}`
                    + `${resizable.selected ? " resizable=true" : ""}`
                    + `${colored.selected ? " colored=true" : ""}`,
                ...(defaultAdvance ? [`common xadvance=${defaultAdvance}`] : []),
                ...charLines,
                "",
            ].join(source.includes("\r\n") ? "\r\n" : "\n");
        }
        if (nextSource === source) {
            options.setStatus("Font properties are unchanged.");
            if (close) dialog.dispose();
            return;
        }
        busy = true;
        try {
            const applied = await options.applyPreparation(prepareReplaceAssetBytes(
                options.getWorkingProject(),
                { packageId: selectedPackage.id, resourceId: resource.id },
                {
                    fileName: resource.fileName || `${resource.name || resource.id}.fnt`,
                    sourceBytes: new TextEncoder().encode(nextSource),
                },
            ));
            if (!applied) return;
            source = nextSource;
            options.setStatus(`Updated bitmap font ${resource.name || resource.id}.`);
            if (close) dialog.dispose();
        } finally {
            busy = false;
        }
    };
    const cleanup = (): void => {
        preview.url = "";
        if (previewUrl) releaseLayaObjectUrl(previewUrl);
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    };
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, cleanup);
    content.getChild("apply").asButton.onClick(options.eventOwner, () => void apply(false));
    content.getChild("save").asButton.onClick(options.eventOwner, () => void apply(true));
    content.getChild("cancel").asButton.onClick(options.eventOwner, () => dialog.dispose());
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute("data-fairy-editor-font-editor", `${resource.id}:${font.chars.length}:${font.ttf ? "ttf" : "images"}`);
    options.setStatus(`Editing bitmap font ${resource.name || resource.id}.`);
}

export function showMovieClipEditor(options: ResourceEditorContext): void {
    const resource = options.resource;
    const selectedPackage = options.selectedPackage;
    const liveResource = resource && selectedPackage
        ? findResource(options.getWorkingProject(), {
            packageId: selectedPackage.id,
            resourceId: resource.id,
        })
        : null;
    if (
        !resource
        || !selectedPackage
        || resource.type !== "MovieClipResource"
        || !(liveResource?.sourceBytes instanceof Uint8Array)
    ) {
        options.setStatus("MovieClip editor unavailable: choose a hydrated MovieClip resource.");
        return;
    }

    let movieClip: MovieClipJta;
    try {
        movieClip = parseMovieClipJta(liveResource.sourceBytes);
    } catch (error) {
        options.setStatus(`MovieClip editor unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    if (movieClip.frames.length === 0) {
        options.setStatus("MovieClip editor unavailable: the selected JTA has no frames.");
        return;
    }

    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = "desktopMovieClipEditDialog";
    const content = fgui.UIPackage.createObject("Builder", "MovieClipEditDialog").asCom;
    addDialogBackground(content);
    dialog.contentPane = content;
    const frame = content.getChild("frame");
    if (frame) frame.asLabel.title = `${resource.name || resource.id} - MovieClip`;

    const fps = content.getChild("fps").asComboBox;
    const fpsValues = [...new Set([movieClip.fps, 24, 30, 60])].sort((a, b) => a - b).map(String);
    fps.items = fpsValues;
    fps.values = fpsValues;
    fps.selectedIndex = fpsValues.indexOf(String(movieClip.fps));
    const speed = content.getChild("speed").asLabel;
    const repeatDelay = content.getChild("repeatDelay").asLabel;
    const frameDelay = content.getChild("frameDelay").asLabel;
    const swing = content.getChild("swing").asButton;
    const smoothing = content.getChild("smoothing").asButton;
    speed.title = String(movieClip.speed);
    repeatDelay.title = String(movieClip.repeatDelay);
    swing.selected = movieClip.swing;
    swing.title = "";
    smoothing.selected = liveResource.movieClip?.smoothing ?? true;
    smoothing.title = "";
    smoothing.enabled = true;

    const atlas = content.getChild("atlas").asComboBox;
    const croppedCount = movieClip.frames.filter((item) =>
        item.rectX !== 0
        || item.rectY !== 0
        || item.rectWidth !== movieClip.boundsWidth
        || item.rectHeight !== movieClip.boundsHeight
    ).length;
    atlas.items = [`${croppedCount}/${movieClip.frames.length} frames`];
    atlas.values = atlas.items;
    atlas.selectedIndex = 0;
    atlas.enabled = false;
    content.getChild("n19").text = "Alpha crop";
    content.getChild("btnExport").visible = true;
    content.getChild("n88").visible = true;

    const previewHost = content.getChild("container").asCom;
    const preview = new fgui.GLoader();
    preview.name = "movieClipFramePreview";
    preview.touchable = false;
    preview.shrinkOnly = true;
    previewHost.addChild(preview);
    const previewUrls = movieClip.textures.map((texture) =>
        texture.byteLength > 0
            ? URL.createObjectURL(new Blob([new Uint8Array(texture)], { type: detectImageMimeType(texture) }))
            : ""
    );
    const currentFrame = content.getChild("currentFrame").asLabel;
    const play = content.getChild("play").asButton;
    const frameDelays = movieClip.frames.map((item) => item.delay);
    let frameIndex = 0;
    let direction: 1 | -1 = 1;
    let repeated = false;
    let timer: number | null = null;
    let cleaned = false;
    let replacementBusy = false;
    const clearTimer = (): void => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
    };
    const readInteger = (label: fgui.GLabel): number => Number(label.title.trim());
    const commitFrameDelay = (): boolean => {
        const value = readInteger(frameDelay);
        if (!Number.isInteger(value) || value < 0 || value > 32767) {
            options.setStatus("MovieClip frame delay must be an integer from 0 to 32767.");
            return false;
        }
        frameDelays[frameIndex] = value;
        return true;
    };
    const renderFrame = (): void => {
        const item = movieClip.frames[frameIndex];
        const scale = Math.min(
            1,
            previewHost.width / Math.max(1, movieClip.boundsWidth),
            previewHost.height / Math.max(1, movieClip.boundsHeight),
        );
        preview.setXY(
            (previewHost.width - movieClip.boundsWidth * scale) / 2 + (item.rectX - movieClip.boundsX) * scale,
            (previewHost.height - movieClip.boundsHeight * scale) / 2 + (item.rectY - movieClip.boundsY) * scale,
        );
        preview.setSize(Math.max(1, item.rectWidth * scale), Math.max(1, item.rectHeight * scale));
        preview.url = item.textureIndex >= 0 ? previewUrls[item.textureIndex] || "" : "";
        preview.visible = Boolean(preview.url && item.rectWidth > 0 && item.rectHeight > 0);
        currentFrame.title = `${frameIndex + 1}/${movieClip.frames.length}`;
        frameDelay.title = String(frameDelays[frameIndex]);
        options.setDebugAttribute(
            "data-fairy-editor-movieclip-frame",
            `${frameIndex + 1}/${movieClip.frames.length}:${item.rectX},${item.rectY},${item.rectWidth},${item.rectHeight}`,
        );
    };
    const advance = (delta: 1 | -1): void => {
        if (movieClip.frames.length < 2) return;
        if (swing.selected && delta === 1) {
            let next = frameIndex + direction;
            if (next >= movieClip.frames.length) {
                direction = -1;
                next = movieClip.frames.length - 2;
                repeated = true;
            } else if (next < 0) {
                direction = 1;
                next = 1;
                repeated = true;
            }
            frameIndex = next;
        } else {
            frameIndex = (frameIndex + delta + movieClip.frames.length) % movieClip.frames.length;
            if (delta === 1 && frameIndex === 0) repeated = true;
        }
        renderFrame();
    };
    const schedule = (): void => {
        clearTimer();
        if (!play.selected || cleaned || movieClip.frames.length === 0) return;
        const currentFps = Number(fps.value);
        const currentSpeed = readInteger(speed);
        const currentRepeatDelay = readInteger(repeatDelay);
        const speedUnits = Number.isInteger(currentSpeed) && currentSpeed > 0 ? currentSpeed : 1;
        const repeatUnits = Number.isInteger(currentRepeatDelay) && currentRepeatDelay >= 0 ? currentRepeatDelay : 0;
        const delayUnits = Math.max(1, speedUnits + frameDelays[frameIndex]
            + (frameIndex === 0 && repeated ? repeatUnits : 0));
        const delay = Number.isFinite(currentFps) && currentFps > 0
            ? Math.max(1, Math.trunc(1000 / currentFps * delayUnits))
            : 42;
        timer = window.setTimeout(() => {
            advance(1);
            schedule();
        }, delay);
    };
    const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        clearTimer();
        preview.url = "";
        for (const url of previewUrls) if (url) releaseLayaObjectUrl(url);
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    };
    content.getChild("btnExport").asButton.onClick(options.eventOwner, () => {
        void exportMovieClipFrames(movieClip).then((blob) => {
            options.download(blob, `${resource.name || resource.id}-frames.zip`);
            options.setDebugAttribute("data-fairy-editor-movieclip-export", `${resource.id}:${movieClip.frames.length}`);
            options.setStatus(`Exported ${movieClip.frames.length} MovieClip frames.`);
        }).catch((error) => {
            options.setStatus(`MovieClip export failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    });
    dialog.on(Laya.Event.UNDISPLAY, options.eventOwner, cleanup);
    play.selected = true;
    play.onClick(options.eventOwner, schedule);
    const readReplacementTiming = (): MovieClipTimingUpdate | null => {
        if (!commitFrameDelay()) return null;
        return {
            fps: Number(fps.value),
            speed: readInteger(speed),
            repeatDelay: readInteger(repeatDelay),
            swing: swing.selected,
            smoothing: smoothing.selected,
            frameDelays: [...frameDelays],
        };
    };
    const confirmFrameCountChange = (nextFrameCount: number): boolean => {
        if (nextFrameCount === frameDelays.length) return true;
        const detail = nextFrameCount > frameDelays.length
            ? `${nextFrameCount - frameDelays.length} new frame delay(s) will start at 0.`
            : `${frameDelays.length - nextFrameCount} trailing frame delay(s) will be removed.`;
        return window.confirm(
            `Replace ${frameDelays.length} MovieClip frames with ${nextFrameCount}?\n\n`
            + `Existing delays are preserved by frame index. ${detail}`,
        );
    };
    const applyReplacement = async (
        preparation: HighRiskTransactionPreparation,
        source: "frames" | "sprite-sheet",
        nextFrameCount: number,
    ): Promise<void> => {
        if (cleaned) return;
        const applied = await options.applyPreparation(preparation);
        if (cleaned || !applied) return;
        options.setDebugAttribute(
            "data-fairy-editor-movieclip-replace",
            `${resource.id}:${source}:${frameDelays.length}->${nextFrameCount}`,
        );
        options.setStatus(`Replaced MovieClip ${resource.name || resource.id} from ${source} (${nextFrameCount} frames).`);
        showMovieClipEditor(options);
    };
    content.getChild("btnImport").asButton.onClick(options.eventOwner, () => {
        void (async () => {
            if (cleaned) return;
            if (replacementBusy) {
                options.setStatus("A MovieClip replacement is already running.");
                return;
            }
            replacementBusy = true;
            try {
                const timing = readReplacementTiming();
                if (!timing || cleaned) return;
                const files = await pickBrowserFiles(
                    ".png,.jpg,.jpeg,image/png,image/jpeg",
                    "MovieClip frame replacement was cancelled.",
                    "movieclip-resource-replace",
                );
                if (cleaned) return;
                if (files.length === 0 || files.length > MAX_MOVIECLIP_FRAME_COUNT) {
                    throw new Error(`Choose 1 to ${MAX_MOVIECLIP_FRAME_COUNT} PNG or JPEG frames.`);
                }
                let totalSourceBytes = 0;
                for (const file of files) {
                    const format = imageSourceFormatFromFileName(file.name);
                    if (!format || file.type && file.type !== (format === "png" ? "image/png" : "image/jpeg")) {
                        throw new Error(`${file.name} is not a PNG or JPEG frame.`);
                    }
                    if (file.size > MAX_MOVIECLIP_IMAGE_SOURCE_BYTES) {
                        throw new Error(`${file.name} exceeds the 8 MiB per-frame limit.`);
                    }
                    totalSourceBytes += file.size;
                    if (totalSourceBytes > MAX_MOVIECLIP_TOTAL_SOURCE_BYTES) {
                        throw new Error("MovieClip frame source bytes exceed the 64 MiB total limit.");
                    }
                }
                const frames: MovieClipFrameInput[] = [];
                let totalDecodedPixels = 0;
                for (const file of files) {
                    if (cleaned) return;
                    const prepared = await prepareMovieClipFrame(
                        file,
                        () => cleaned,
                        MAX_MOVIECLIP_TOTAL_DECODED_PIXELS - totalDecodedPixels,
                    );
                    if (cleaned) return;
                    totalDecodedPixels += prepared.dimensions.width * prepared.dimensions.height;
                    frames.push(prepared);
                }
                if (cleaned) return;
                if (!confirmFrameCountChange(frames.length)) {
                    options.setStatus("MovieClip frame replacement cancelled.");
                    return;
                }
                await applyReplacement(
                    prepareReplaceMovieClipResource(
                        options.getWorkingProject(),
                        { packageId: selectedPackage.id, resourceId: resource.id },
                        frames,
                        timing,
                    ),
                    "frames",
                    frames.length,
                );
                if (cleaned) return;
            } catch (error) {
                if (!cleaned) {
                    options.setStatus(`MovieClip frame replacement skipped: ${error instanceof Error ? error.message : String(error)}`);
                }
            } finally {
                replacementBusy = false;
            }
        })();
    });
    content.getChild("btnImport2").asButton.onClick(options.eventOwner, () => {
        void (async () => {
            if (cleaned) return;
            if (replacementBusy) {
                options.setStatus("A MovieClip replacement is already running.");
                return;
            }
            replacementBusy = true;
            try {
                const timing = readReplacementTiming();
                if (!timing || cleaned) return;
                const files = await pickBrowserFiles(
                    ".json,.eas,.xml,.plist,.png,application/json,text/xml,application/xml,image/png",
                    "MovieClip Sprite Sheet replacement was cancelled.",
                    "movieclip-sprite-sheet-replace",
                );
                if (cleaned) return;
                const descriptors = files.filter((file) => /\.(?:json|eas|xml|plist)$/i.test(file.name));
                const images = files.filter((file) => /\.png$/i.test(file.name));
                if (files.length !== 2 || descriptors.length !== 1 || images.length !== 1) {
                    throw new Error("Choose exactly one TexturePacker JSON/EAS/XML/plist descriptor and one PNG atlas.");
                }
                const descriptorFile = descriptors[0];
                if (descriptorFile.size > MAX_MOVIECLIP_DESCRIPTOR_BYTES) {
                    throw new Error("Sprite Sheet descriptor exceeds the 2 MiB limit.");
                }
                if (images[0].size > MAX_MOVIECLIP_IMAGE_SOURCE_BYTES) {
                    throw new Error("Sprite Sheet PNG exceeds the 8 MiB limit.");
                }
                const descriptorText = await descriptorFile.text();
                if (cleaned) return;
                const parsed = parseMovieClipSpriteSheetDescriptor(descriptorFile.name, descriptorText);
                if (parsed.ok === false) {
                    options.setStatus(`MovieClip Sprite Sheet replacement unavailable: ${parsed.code}. ${parsed.message}`);
                    return;
                }
                if (parsed.frames.length === 0 || parsed.frames.length > MAX_MOVIECLIP_FRAME_COUNT) {
                    throw new Error(`Sprite Sheet must contain 1 to ${MAX_MOVIECLIP_FRAME_COUNT} frames.`);
                }
                if (cleaned) return;
                if (!confirmFrameCountChange(parsed.frames.length)) {
                    options.setStatus("MovieClip Sprite Sheet replacement cancelled.");
                    return;
                }
                const frames = await prepareMovieClipSpriteSheetFrames(images[0], parsed.frames, () => cleaned);
                if (cleaned) return;
                await applyReplacement(
                    prepareReplaceMovieClipSpriteSheetResource(
                        options.getWorkingProject(),
                        { packageId: selectedPackage.id, resourceId: resource.id },
                        descriptorFile.name,
                        frames,
                        timing,
                    ),
                    "sprite-sheet",
                    frames.length,
                );
                if (cleaned) return;
            } catch (error) {
                if (!cleaned) {
                    options.setStatus(`MovieClip Sprite Sheet replacement skipped: ${error instanceof Error ? error.message : String(error)}`);
                }
            } finally {
                replacementBusy = false;
            }
        })();
    });
    content.getChild("prevFrame").asButton.onClick(options.eventOwner, () => {
        if (!commitFrameDelay()) return;
        play.selected = false;
        clearTimer();
        advance(-1);
    });
    content.getChild("nextFrame").asButton.onClick(options.eventOwner, () => {
        if (!commitFrameDelay()) return;
        play.selected = false;
        clearTimer();
        advance(1);
    });
    content.getChild("btnSave").asButton.onClick(options.eventOwner, () => {
        if (replacementBusy) {
            options.setStatus("A MovieClip replacement is still running.");
            return;
        }
        if (!commitFrameDelay()) return;
        const preparation = prepareUpdateMovieClipResource(
            options.getWorkingProject(),
            { packageId: selectedPackage.id, resourceId: resource.id },
            {
                fps: Number(fps.value),
                speed: readInteger(speed),
                repeatDelay: readInteger(repeatDelay),
                swing: swing.selected,
                smoothing: smoothing.selected,
                frameDelays,
            },
        );
        if (preparation.ok === false && preparation.code === "movieclip_timing_unchanged") {
            options.setStatus("MovieClip timing is unchanged.");
            dialog.dispose();
            return;
        }
        replacementBusy = true;
        void (async () => {
            try {
                const applied = await options.applyPreparation(preparation);
                if (cleaned || !applied) return;
                options.setDebugAttribute(
                    "data-fairy-editor-movieclip-edit",
                    `${resource.id}:${fps.value}:${speed.title}:${repeatDelay.title}:${swing.selected}`,
                );
                dialog.dispose();
            } catch (error) {
                if (!cleaned) {
                    options.setStatus(`MovieClip timing update skipped: ${error instanceof Error ? error.message : String(error)}`);
                }
            } finally {
                replacementBusy = false;
            }
        })();
    });
    content.getChild("btnClose").asButton.onClick(options.eventOwner, () => {
        if (replacementBusy) {
            options.setStatus("MovieClip replacement is still running; wait for it to finish before closing.");
            return;
        }
        options.setStatus("MovieClip edit cancelled.");
        dialog.dispose();
    });
    renderFrame();
    schedule();
    dialog.show();
    dialog.centerOn(fgui.GRoot.inst, true);
    options.setActiveDialog(dialog);
    options.setDebugAttribute(
        "data-fairy-editor-movieclip-editor",
        `${resource.id}:${movieClip.frames.length}:cropped=${croppedCount}`,
    );
    options.setStatus(`Editing MovieClip ${resource.name || resource.id}.`);
}

function detectImageMimeType(bytes: Uint8Array): string {
return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    ? "image/png"
    : bytes[0] === 0xff && bytes[1] === 0xd8
        ? "image/jpeg"
        : "application/octet-stream";
}

async function exportMovieClipFrames(movieClip: MovieClipJta): Promise<Blob> {
    const digits = String(movieClip.frames.length).length;
    const files = [];
    for (let index = 0; index < movieClip.frames.length; index++) {
        const frame = movieClip.frames[index];
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, movieClip.boundsWidth);
        canvas.height = Math.max(1, movieClip.boundsHeight);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Browser canvas is unavailable for MovieClip export.");
        const texture = movieClip.textures[frame.textureIndex];
        if (texture?.byteLength) {
            const bitmap = await createImageBitmap(new Blob([new Uint8Array(texture)], { type: detectImageMimeType(texture) }));
            try {
                context.drawImage(
                    bitmap,
                    frame.rectX - movieClip.boundsX,
                    frame.rectY - movieClip.boundsY,
                    frame.rectWidth,
                    frame.rectHeight,
                );
            } finally {
                bitmap.close();
            }
        }
        files.push({
            path: `frame_${String(index + 1).padStart(digits, "0")}.png`,
            data: await encodeCanvasPng(canvas, "MovieClip frame PNG encoding failed."),
        });
        canvas.width = canvas.height = 1;
    }
    return createStoredZipBlob(files);
}

function releaseLayaObjectUrl(url: string): void {
    Laya.loader.clearRes(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function prepareMovieClipSpriteSheetFrames(
    imageFile: File,
    frames: MovieClipSpriteSheetFrame[],
    isCancelled: () => boolean = () => false,
    report: (completed: number, total: number, label?: string) => void = () => undefined,
): Promise<MovieClipSpriteSheetFrameInput[]> {
    throwIfMovieClipPreparationCancelled(isCancelled);
    if (!/\.png$/i.test(imageFile.name) || imageFile.type && imageFile.type !== "image/png") {
        throw new Error("Sprite Sheet atlas must be a PNG image.");
    }
    if (imageFile.size > MAX_MOVIECLIP_IMAGE_SOURCE_BYTES) {
        throw new Error("Sprite Sheet PNG exceeds the 8 MiB limit.");
    }
    if (frames.length === 0 || frames.length > MAX_MOVIECLIP_FRAME_COUNT) {
        throw new Error(`Sprite Sheet must contain 1 to ${MAX_MOVIECLIP_FRAME_COUNT} frames.`);
    }
    const imageBytes = new Uint8Array(await imageFile.arrayBuffer());
    throwIfMovieClipPreparationCancelled(isCancelled);
    if (imageBytes.byteLength > MAX_MOVIECLIP_IMAGE_SOURCE_BYTES) {
        throw new Error("Sprite Sheet PNG exceeds the 8 MiB limit.");
    }
    const declaredDimensions = probeMovieClipPngDimensions(imageBytes);
    if (!declaredDimensions) throw new Error("Sprite Sheet atlas bytes are not a valid PNG header.");
    const atlasPixels = declaredDimensions.width * declaredDimensions.height;
    if (atlasPixels > MAX_MOVIECLIP_IMAGE_SOURCE_PIXELS || atlasPixels > MAX_MOVIECLIP_TOTAL_DECODED_PIXELS) {
        throw new Error("Sprite Sheet decoded pixels exceed the 8 Mi-pixel limit.");
    }
    const bitmap = await createImageBitmap(new Blob([imageBytes], { type: "image/png" }));
    try {
        throwIfMovieClipPreparationCancelled(isCancelled);
        if (bitmap.width !== declaredDimensions.width || bitmap.height !== declaredDimensions.height) {
            throw new Error("Sprite Sheet decoded dimensions do not match its PNG header.");
        }
        const textures = new Map<string, Uint8Array>();
        const result: MovieClipSpriteSheetFrameInput[] = [];
        let totalTextureBytes = 0;
        let totalDecodedPixels = atlasPixels;
        for (const frame of frames) {
            throwIfMovieClipPreparationCancelled(isCancelled);
            const { x, y, width, height } = frame.atlas;
            const sourceWidth = frame.rotated ? height : width;
            const sourceHeight = frame.rotated ? width : height;
            if (
                x < 0
                || y < 0
                || x + sourceWidth > bitmap.width
                || y + sourceHeight > bitmap.height
            ) {
                throw new Error(`Sprite Sheet frame ${frame.name} lies outside ${imageFile.name}.`);
            }
            const textureKey = `${x},${y},${width},${height},${frame.rotated}`;
            let sourceBytes = textures.get(textureKey);
            if (!sourceBytes) {
                if (width === 0 || height === 0) {
                    sourceBytes = new Uint8Array();
                } else {
                    const framePixels = width * height;
                    if (framePixels > MAX_MOVIECLIP_IMAGE_SOURCE_PIXELS) {
                        throw new Error(`Sprite Sheet frame ${frame.name} exceeds the 8 Mi-pixel limit.`);
                    }
                    totalDecodedPixels += framePixels;
                    if (totalDecodedPixels > MAX_MOVIECLIP_TOTAL_DECODED_PIXELS) {
                        throw new Error("Sprite Sheet decoded pixels exceed the 64 Mi-pixel total limit.");
                    }
                    const canvas = document.createElement("canvas");
                    canvas.width = width;
                    canvas.height = height;
                    const context = canvas.getContext("2d");
                    if (!context) throw new Error("Browser canvas is unavailable for Sprite Sheet slicing.");
                    if (frame.rotated) {
                        context.setTransform(0, -1, 1, 0, -y, x + height);
                        context.drawImage(bitmap, 0, 0);
                    } else {
                        context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
                    }
                    sourceBytes = await encodeCanvasPng(canvas, "Sprite Sheet frame PNG encoding failed.");
                    throwIfMovieClipPreparationCancelled(isCancelled);
                    if (sourceBytes.byteLength > MAX_MOVIECLIP_IMAGE_SOURCE_BYTES) {
                        throw new Error(`Sprite Sheet frame ${frame.name} exceeds the 8 MiB encoded limit.`);
                    }
                    totalTextureBytes += sourceBytes.byteLength;
                    if (totalTextureBytes > MAX_MOVIECLIP_TOTAL_SOURCE_BYTES) {
                        throw new Error("Sprite Sheet frame bytes exceed the 64 MiB total limit.");
                    }
                }
                textures.set(textureKey, sourceBytes);
            }
            result.push({
                name: frame.name,
                textureKey,
                sourceBytes,
                rect: { ...frame.rect },
            });
            report(result.length, frames.length, frame.name);
        }
        return result;
    } finally {
        bitmap.close();
    }
}

async function encodeCanvasPng(
    canvas: HTMLCanvasElement,
    errorMessage: string,
): Promise<Uint8Array<ArrayBuffer>> {
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (value) => value ? resolve(value) : reject(new Error(errorMessage)),
            "image/png",
        );
    });
    return new Uint8Array(await blob.arrayBuffer());
}

export async function prepareMovieClipFrame(
    file: File,
    isCancelled: () => boolean = () => false,
    remainingDecodedPixels = MAX_MOVIECLIP_TOTAL_DECODED_PIXELS,
): Promise<MovieClipFrameInput> {
    throwIfMovieClipPreparationCancelled(isCancelled);
    const format = imageSourceFormatFromFileName(file.name);
    if (!format || file.type && file.type !== (format === "png" ? "image/png" : "image/jpeg")) {
        throw new Error(`${file.name} is not a PNG or JPEG frame.`);
    }
    if (file.size > MAX_MOVIECLIP_IMAGE_SOURCE_BYTES) {
        throw new Error(`${file.name} exceeds the 8 MiB per-frame limit.`);
    }
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    throwIfMovieClipPreparationCancelled(isCancelled);
    if (fileBytes.byteLength > MAX_MOVIECLIP_IMAGE_SOURCE_BYTES) {
        throw new Error(`${file.name} exceeds the 8 MiB per-frame limit.`);
    }
    if (detectImageSourceFormat(fileBytes) !== format) throw new Error(`${file.name} bytes do not match its extension.`);
    const declaredDimensions = probeImageSourceDimensions(fileBytes);
    if (!declaredDimensions) throw new Error(`${file.name} does not contain a valid PNG or JPEG header.`);
    const decodedPixels = declaredDimensions.width * declaredDimensions.height;
    if (decodedPixels > MAX_MOVIECLIP_IMAGE_SOURCE_PIXELS) {
        throw new Error(`${file.name} exceeds the 8 Mi-pixel per-frame limit.`);
    }
    if (decodedPixels > remainingDecodedPixels) {
        throw new Error("MovieClip decoded pixels exceed the 64 Mi-pixel total limit.");
    }
    const bitmap = await createImageBitmap(new Blob([fileBytes], { type: format === "png" ? "image/png" : "image/jpeg" }));
    try {
        throwIfMovieClipPreparationCancelled(isCancelled);
        if (bitmap.width !== declaredDimensions.width || bitmap.height !== declaredDimensions.height) {
            throw new Error(`${file.name} decoded dimensions do not match its image header.`);
        }
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Browser canvas is unavailable for MovieClip trimming.");
        context.drawImage(bitmap, 0, 0);
        const crop = findOpaqueBounds(
            context.getImageData(0, 0, bitmap.width, bitmap.height).data,
            bitmap.width,
            bitmap.height,
        );
        const fullFrame = crop.x === 0
            && crop.y === 0
            && crop.width === bitmap.width
            && crop.height === bitmap.height;
        let sourceBytes = fileBytes;
        if (!fullFrame) {
            if (crop.width === 0 || crop.height === 0) {
                sourceBytes = new Uint8Array();
            } else {
                const trimmed = document.createElement("canvas");
                trimmed.width = crop.width;
                trimmed.height = crop.height;
                const trimmedContext = trimmed.getContext("2d");
                if (!trimmedContext) throw new Error("Browser canvas is unavailable for MovieClip trimming.");
                trimmedContext.drawImage(
                    canvas,
                    crop.x,
                    crop.y,
                    crop.width,
                    crop.height,
                    0,
                    0,
                    crop.width,
                    crop.height,
                );
                sourceBytes = await encodeCanvasPng(trimmed, "MovieClip frame PNG encoding failed.");
                throwIfMovieClipPreparationCancelled(isCancelled);
                if (sourceBytes.byteLength > MAX_MOVIECLIP_IMAGE_SOURCE_BYTES) {
                    throw new Error(`${file.name} exceeds the 8 MiB encoded frame limit.`);
                }
            }
        }
        return {
            fileName: file.name,
            sourceBytes,
            dimensions: { width: bitmap.width, height: bitmap.height },
            crop,
        };
    } finally {
        bitmap.close();
    }
}

type BrowserDecodedImage = CanvasImageSource & {
    displayWidth?: number;
    displayHeight?: number;
    codedWidth?: number;
    codedHeight?: number;
    duration?: number | null;
    close(): void;
};

type BrowserImageDecoder = {
    tracks: {
        ready: Promise<void>;
        selectedTrack?: { frameCount: number };
    };
    decode(options: { frameIndex: number; completeFramesOnly: boolean }): Promise<{
        image: BrowserDecodedImage;
        complete?: boolean;
    }>;
    close(): void;
};

type BrowserImageDecoderConstructor = {
    new(options: { data: Uint8Array; type: string; preferAnimation: boolean }): BrowserImageDecoder;
    isTypeSupported?(type: string): Promise<boolean>;
};

export async function prepareGifMovieClipFrames(
    file: File,
    isCancelled: () => boolean = () => false,
    report: (completed: number, total: number, label?: string) => void = () => undefined,
): Promise<MovieClipFrameInput[]> {
    if (!/\.gif$/i.test(file.name) || file.type && file.type !== "image/gif") {
        throw new Error(`${file.name} is not a GIF file.`);
    }
    if (file.size > MAX_MOVIECLIP_IMAGE_SOURCE_BYTES) throw new Error(`${file.name} exceeds the 8 MiB GIF limit.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength < 6 || new TextDecoder("ascii").decode(bytes.subarray(0, 6)) !== "GIF87a"
        && new TextDecoder("ascii").decode(bytes.subarray(0, 6)) !== "GIF89a") {
        throw new Error(`${file.name} does not contain a GIF87a/GIF89a header.`);
    }
    const Decoder = (globalThis as unknown as { ImageDecoder?: BrowserImageDecoderConstructor }).ImageDecoder;
    if (!Decoder || Decoder.isTypeSupported && !await Decoder.isTypeSupported("image/gif")) {
        throw new Error("This browser does not provide native animated GIF decoding.");
    }
    const decoder = new Decoder({ data: bytes, type: "image/gif", preferAnimation: true });
    try {
        await decoder.tracks.ready;
        const frameCount = decoder.tracks.selectedTrack?.frameCount || 0;
        if (frameCount < 1 || frameCount > MAX_MOVIECLIP_FRAME_COUNT) {
            throw new Error(`GIF must contain 1 to ${MAX_MOVIECLIP_FRAME_COUNT} frames.`);
        }
        const frames: MovieClipFrameInput[] = [];
        let decodedPixels = 0;
        const digits = String(frameCount).length;
        const baseName = file.name.replace(/\.gif$/i, "") || "gif";
        for (let index = 0; index < frameCount; index += 1) {
            throwIfMovieClipPreparationCancelled(isCancelled);
            const decoded = await decoder.decode({ frameIndex: index, completeFramesOnly: true });
            const image = decoded.image;
            try {
                if (decoded.complete === false) throw new Error(`GIF frame ${index + 1} is incomplete.`);
                const width = image.displayWidth || image.codedWidth || 0;
                const height = image.displayHeight || image.codedHeight || 0;
                if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
                    throw new Error(`GIF frame ${index + 1} has invalid dimensions.`);
                }
                decodedPixels += width * height;
                if (width * height > MAX_MOVIECLIP_IMAGE_SOURCE_PIXELS || decodedPixels > MAX_MOVIECLIP_TOTAL_DECODED_PIXELS) {
                    throw new Error("GIF decoded pixels exceed the MovieClip browser limit.");
                }
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext("2d");
                if (!context) throw new Error("Browser canvas is unavailable for GIF decoding.");
                context.drawImage(image, 0, 0);
                const png = await encodeCanvasPng(canvas, `GIF frame ${index + 1} PNG encoding failed.`);
                const prepared = await prepareMovieClipFrame(
                    new File([png], `${baseName}-${String(index + 1).padStart(digits, "0")}.png`, { type: "image/png" }),
                    isCancelled,
                    MAX_MOVIECLIP_TOTAL_DECODED_PIXELS - (decodedPixels - width * height),
                );
                const durationUnits = Math.max(1, Math.round(Number(image.duration || 100_000) / 10_000));
                prepared.delay = durationUnits - 1;
                frames.push(prepared);
                report(frames.length, frameCount, prepared.fileName);
            } finally {
                image.close();
            }
        }
        return frames;
    } finally {
        decoder.close();
    }
}

export async function prepareSafeSvgImage(file: File): Promise<{
    sourceBytes: Uint8Array;
    dimensions: { width: number; height: number };
}> {
    if (!/\.svg$/i.test(file.name) || file.type && file.type !== "image/svg+xml") {
        throw new Error(`${file.name} is not an SVG file.`);
    }
    if (file.size > MAX_BROWSER_IMAGE_SOURCE_BYTES) throw new Error(`${file.name} exceeds the 8 MiB image limit.`);
    const sourceBytes = new Uint8Array(await file.arrayBuffer());
    const source = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
    if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) {
        throw new Error("SVG must not contain DTDs, entities, or external stylesheets.");
    }
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    if (document.querySelector("parsererror") || document.documentElement.localName.toLowerCase() !== "svg") {
        throw new Error("SVG XML is invalid.");
    }
    const elements = Array.from(document.querySelectorAll("*"));
    if (elements.length > 50_000) throw new Error("SVG exceeds the 50,000-element browser limit.");
    const forbidden = new Set([
        "script", "foreignobject", "iframe", "object", "embed", "style", "link",
        "animate", "animatemotion", "animatetransform", "set", "audio", "video",
    ]);
    for (const element of elements) {
        if (forbidden.has(element.localName.toLowerCase())) throw new Error(`SVG element <${element.localName}> is not allowed.`);
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.localName.toLowerCase();
            const value = attribute.value.trim();
            if (name.startsWith("on")) throw new Error(`SVG event attribute ${attribute.name} is not allowed.`);
            if (attribute.name === "xmlns" || attribute.prefix === "xmlns") continue;
            if (name === "href") {
                if (!value || value.startsWith("#") || /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value)) continue;
                throw new Error("SVG references must be local fragments or embedded raster images.");
            }
            if (/(?:javascript|vbscript)\s*:|@import|https?:\/\/|(^|[^:])\/\//i.test(value)) {
                throw new Error(`SVG attribute ${attribute.name} contains an external or active reference.`);
            }
            for (const match of value.matchAll(/url\(([^)]*)\)/gi)) {
                const target = match[1].trim().replace(/^['"]|['"]$/g, "");
                if (!target.startsWith("#")) throw new Error(`SVG attribute ${attribute.name} contains an external URL.`);
            }
        }
    }
    const blob = new Blob([sourceBytes], { type: "image/svg+xml" });
    let width = 0;
    let height = 0;
    try {
        const bitmap = await createImageBitmap(blob);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
    } catch {
        const url = URL.createObjectURL(blob);
        try {
            const image = new Image();
            await new Promise<void>((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = () => reject(new Error("The source SVG could not be decoded."));
                image.src = url;
            });
            width = image.naturalWidth;
            height = image.naturalHeight;
        } finally {
            URL.revokeObjectURL(url);
        }
    }
    if (width <= 0 || height <= 0
        || width > Math.floor(MAX_BROWSER_IMAGE_SOURCE_PIXELS / height)) {
            throw new Error("SVG decoded dimensions exceed the 8 Mi-pixel browser limit.");
    }
    return { sourceBytes, dimensions: { width, height } };
}

function throwIfMovieClipPreparationCancelled(isCancelled: () => boolean): void {
    if (isCancelled()) throw new Error("MovieClip replacement was cancelled because its editor was closed.");
}
