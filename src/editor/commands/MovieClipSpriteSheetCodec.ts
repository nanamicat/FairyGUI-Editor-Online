export interface MovieClipFrameRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface MovieClipSpriteSheetFrame {
    name: string;
    atlas: MovieClipFrameRect;
    rect: MovieClipFrameRect;
    rotated: boolean;
}

export interface MovieClipSpriteSheetDescriptor {
    imageFileName: string;
    frames: MovieClipSpriteSheetFrame[];
}

export type MovieClipSpriteSheetParseResult =
    | ({ ok: true } & MovieClipSpriteSheetDescriptor)
    | { ok: false; code: string; message: string };

function readInteger(value: unknown, label: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer.`);
    return parsed;
}

function readRect(value: unknown, label: string): MovieClipFrameRect {
    if (!value || typeof value !== "object") throw new Error(`${label} is missing.`);
    const record = value as Record<string, unknown>;
    return {
        x: readInteger(record.x, `${label}.x`),
        y: readInteger(record.y, `${label}.y`),
        width: readInteger(record.w ?? record.width, `${label}.width`),
        height: readInteger(record.h ?? record.height, `${label}.height`),
    };
}

function decodeXmlText(value: string): string {
    return value
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function readXmlAttributes(value: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const match of value.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attributes[match[1]] = decodeXmlText(match[2] ?? match[3] ?? "");
    }
    return attributes;
}

function parsePlistValue(source: string): unknown {
    const tokens = source
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<\?[\s\S]*?\?>/g, "")
        .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
        .replace(/<\/?plist\b[^>]*>/gi, "")
        .match(/<\/?(?:dict|array|key|string|integer|real|data|date)\s*>|<(?:true|false)\s*\/>|[^<]+/gi) || [];
    let index = 0;
    const skipWhitespace = (): void => {
        while (index < tokens.length && !tokens[index].trim()) index += 1;
    };
    const readValue = (): unknown => {
        skipWhitespace();
        const token = tokens[index++]?.trim();
        if (!token) throw new Error("Unexpected end of plist.");
        if (/^<dict>$/i.test(token)) {
            const result: Record<string, unknown> = {};
            while (true) {
                skipWhitespace();
                if (/^<\/dict>$/i.test(tokens[index]?.trim() || "")) {
                    index += 1;
                    return result;
                }
                const key = readValue();
                if (typeof key !== "string") throw new Error("Plist dictionary key must be text.");
                result[key] = readValue();
            }
        }
        if (/^<array>$/i.test(token)) {
            const result: unknown[] = [];
            while (true) {
                skipWhitespace();
                if (/^<\/array>$/i.test(tokens[index]?.trim() || "")) {
                    index += 1;
                    return result;
                }
                result.push(readValue());
            }
        }
        if (/^<true\s*\/>$/i.test(token)) return true;
        if (/^<false\s*\/>$/i.test(token)) return false;
        const primitive = token.match(/^<(key|string|integer|real|data|date)>$/i);
        if (!primitive) throw new Error(`Unsupported plist token ${token}.`);
        let text = "";
        while (index < tokens.length && !new RegExp(`^</${primitive[1]}>$`, "i").test(tokens[index].trim())) {
            text += tokens[index++];
        }
        if (index >= tokens.length) throw new Error(`Unclosed plist ${primitive[1]} value.`);
        index += 1;
        const decoded = decodeXmlText(text.trim());
        if (/^(integer|real)$/i.test(primitive[1])) {
            const number = Number(decoded);
            if (!Number.isFinite(number)) throw new Error(`Invalid plist number ${decoded}.`);
            return number;
        }
        return decoded;
    };
    return readValue();
}

function readPlistTuple(value: unknown, label: string): number[] {
    if (Array.isArray(value)) return value.map((item, index) => readInteger(item, `${label}[${index}]`));
    if (typeof value !== "string") throw new Error(`${label} is missing.`);
    return value
        .replace(/[{}]/g, "")
        .split(",")
        .map((item, index) => readInteger(item.trim(), `${label}[${index}]`));
}

function validateFrames(frames: MovieClipSpriteSheetFrame[]): MovieClipSpriteSheetFrame[] {
    if (frames.length === 0 || frames.length > 32767) {
        throw new Error("Sprite Sheet requires 1 to 32767 frames.");
    }
    for (const [index, frame] of frames.entries()) {
        const values = [
            frame.atlas.x,
            frame.atlas.y,
            frame.atlas.width,
            frame.atlas.height,
            frame.rect.x,
            frame.rect.y,
            frame.rect.width,
            frame.rect.height,
        ];
        if (
            !values.every(Number.isInteger)
            || frame.atlas.x < 0
            || frame.atlas.y < 0
            || frame.atlas.width < 0
            || frame.atlas.height < 0
            || frame.rect.width < 0
            || frame.rect.height < 0
            || (frame.atlas.width === 0) !== (frame.atlas.height === 0)
            || (frame.rect.width === 0) !== (frame.rect.height === 0)
            || frame.atlas.width > 32767
            || frame.atlas.height > 32767
            || frame.rect.width > 32767
            || frame.rect.height > 32767
        ) {
            throw new Error(`Sprite Sheet frame ${index + 1} has invalid bounds.`);
        }
    }
    return frames;
}

export function parseMovieClipSpriteSheetDescriptor(
    fileName: string,
    source: string,
): MovieClipSpriteSheetParseResult {
    try {
        const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
        let imageFileName = "";
        let frames: MovieClipSpriteSheetFrame[];
        if (extension === ".json" || extension === ".eas") {
            const root = JSON.parse(source) as Record<string, unknown>;
            const frameCollection = root.frames;
            const entries = Array.isArray(frameCollection)
                ? frameCollection.map((item, index) => [
                    String((item as Record<string, unknown>)?.filename || index),
                    item,
                ] as const)
                : Object.entries((frameCollection && typeof frameCollection === "object")
                    ? frameCollection as Record<string, unknown>
                    : {});
            frames = entries.map(([name, value], index) => {
                if (!value || typeof value !== "object") throw new Error(`Sprite Sheet frame ${index + 1} is invalid.`);
                const record = value as Record<string, unknown>;
                const atlas = readRect(record.frame, `frames[${index}].frame`);
                const sourceRect = record.spriteSourceSize && typeof record.spriteSourceSize === "object"
                    ? record.spriteSourceSize as Record<string, unknown>
                    : {};
                return {
                    name: String(record.filename || name),
                    atlas,
                    rect: {
                        x: readInteger(sourceRect.x ?? 0, `frames[${index}].spriteSourceSize.x`),
                        y: readInteger(sourceRect.y ?? 0, `frames[${index}].spriteSourceSize.y`),
                        width: atlas.width,
                        height: atlas.height,
                    },
                    rotated: record.rotated === true,
                };
            });
            const meta = root.meta && typeof root.meta === "object" ? root.meta as Record<string, unknown> : {};
            imageFileName = typeof meta.image === "string" ? meta.image : "";
        } else if (extension === ".xml") {
            const rootMatch = source.match(/<TextureAtlas\b([^>]*)>/i);
            imageFileName = rootMatch ? readXmlAttributes(rootMatch[1]).imagePath || "" : "";
            frames = [...source.matchAll(/<SubTexture\b([^>]*)\/?>/gi)].map((match, index) => {
                const attributes = readXmlAttributes(match[1]);
                const atlas = {
                    x: readInteger(attributes.x, `SubTexture[${index}].x`),
                    y: readInteger(attributes.y, `SubTexture[${index}].y`),
                    width: readInteger(attributes.width, `SubTexture[${index}].width`),
                    height: readInteger(attributes.height, `SubTexture[${index}].height`),
                };
                return {
                    name: attributes.name || String(index),
                    atlas,
                    rect: {
                        x: readInteger(attributes.frameX || 0, `SubTexture[${index}].frameX`),
                        y: readInteger(attributes.frameY || 0, `SubTexture[${index}].frameY`),
                        width: atlas.width,
                        height: atlas.height,
                    },
                    rotated: attributes.rotated === "true",
                };
            });
        } else if (extension === ".plist") {
            const root = parsePlistValue(source) as Record<string, unknown>;
            const frameCollection = root.frames && typeof root.frames === "object"
                ? root.frames as Record<string, unknown>
                : {};
            frames = Object.entries(frameCollection).map(([name, value], index) => {
                if (!value || typeof value !== "object") throw new Error(`Sprite Sheet frame ${index + 1} is invalid.`);
                const record = value as Record<string, unknown>;
                let atlasTuple: number[];
                let offsetTuple: number[];
                if (record.frame !== undefined) {
                    atlasTuple = readPlistTuple(record.frame, `frames.${name}.frame`);
                    offsetTuple = readPlistTuple(
                        record.sourceColorRect ?? record.offset ?? "{0,0}",
                        `frames.${name}.sourceColorRect`,
                    );
                } else if (record.textureRect !== undefined) {
                    atlasTuple = readPlistTuple(record.textureRect, `frames.${name}.textureRect`);
                    offsetTuple = readPlistTuple(record.spriteOffset ?? "{0,0}", `frames.${name}.spriteOffset`);
                } else {
                    atlasTuple = [
                        readInteger(record.x, `frames.${name}.x`),
                        readInteger(record.y, `frames.${name}.y`),
                        readInteger(record.width, `frames.${name}.width`),
                        readInteger(record.height, `frames.${name}.height`),
                    ];
                    offsetTuple = [
                        Math.trunc(-atlasTuple[2] / 2 + readInteger(record.offsetX ?? 0, `frames.${name}.offsetX`)),
                        Math.trunc(-atlasTuple[3] / 2 + readInteger(record.offsetY ?? 0, `frames.${name}.offsetY`)),
                    ];
                }
                if (atlasTuple.length < 4 || offsetTuple.length < 2) {
                    throw new Error(`Sprite Sheet frame ${name} has an invalid plist rectangle.`);
                }
                const atlas = {
                    x: atlasTuple[0],
                    y: atlasTuple[1],
                    width: atlasTuple[2],
                    height: atlasTuple[3],
                };
                return {
                    name,
                    atlas,
                    rect: { x: offsetTuple[0], y: offsetTuple[1], width: atlas.width, height: atlas.height },
                    rotated: record.textureRotated === true || record.rotated === true,
                };
            });
            const metadata = root.metadata && typeof root.metadata === "object"
                ? root.metadata as Record<string, unknown>
                : {};
            imageFileName = String(
                metadata.textureFileName
                || metadata.realTextureFileName
                || root.textureFileName
                || "",
            );
        } else {
            return {
                ok: false,
                code: "unsupported_sprite_sheet_descriptor",
                message: "Sprite Sheet descriptors must be TexturePacker JSON/EAS, XML, or plist.",
            };
        }
        return { ok: true, imageFileName, frames: validateFrames(frames) };
    } catch (error) {
        return {
            ok: false,
            code: "invalid_sprite_sheet_descriptor",
            message: error instanceof Error ? error.message : String(error),
        };
    }
}
