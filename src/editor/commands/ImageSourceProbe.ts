export type ImageSourceFormat = "png" | "jpeg";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export function detectImageSourceFormat(sourceBytes: Uint8Array): ImageSourceFormat | null {
    if (sourceBytes.byteLength >= PNG_SIGNATURE.length
        && PNG_SIGNATURE.every((value, index) => sourceBytes[index] === value)) return "png";
    return sourceBytes.byteLength >= 3
        && sourceBytes[0] === 0xff && sourceBytes[1] === 0xd8 && sourceBytes[2] === 0xff
        ? "jpeg"
        : null;
}

export function imageSourceFormatFromFileName(fileName: string): ImageSourceFormat | null {
    const extension = fileName.trim().toLowerCase().match(/\.([^.]+)$/)?.[1];
    if (extension === "png") return "png";
    if (extension === "jpg" || extension === "jpeg") return "jpeg";
    return null;
}

export function probeImageSourceDimensions(sourceBytes: Uint8Array): { width: number; height: number } | null {
    const format = detectImageSourceFormat(sourceBytes);
    if (format === "png") {
        if (sourceBytes.byteLength < 24 || sourceBytes[8] !== 0 || sourceBytes[9] !== 0
            || sourceBytes[10] !== 0 || sourceBytes[11] !== 13 || sourceBytes[12] !== 0x49
            || sourceBytes[13] !== 0x48 || sourceBytes[14] !== 0x44 || sourceBytes[15] !== 0x52) return null;
        const view = new DataView(sourceBytes.buffer, sourceBytes.byteOffset, sourceBytes.byteLength);
        const width = view.getUint32(16, false);
        const height = view.getUint32(20, false);
        return width > 0 && height > 0 ? { width, height } : null;
    }
    if (format !== "jpeg") return null;

    let offset = 2;
    while (offset < sourceBytes.byteLength) {
        while (offset < sourceBytes.byteLength && sourceBytes[offset] === 0xff) offset += 1;
        if (offset >= sourceBytes.byteLength) return null;
        const marker = sourceBytes[offset++];
        if (marker === 0xd9 || marker === 0xda) return null;
        if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > sourceBytes.byteLength) return null;
        const segmentLength = sourceBytes[offset] * 0x100 + sourceBytes[offset + 1];
        if (segmentLength < 2 || offset + segmentLength > sourceBytes.byteLength) return null;
        const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf
            && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isStartOfFrame) {
            if (segmentLength < 7) return null;
            const height = sourceBytes[offset + 3] * 0x100 + sourceBytes[offset + 4];
            const width = sourceBytes[offset + 5] * 0x100 + sourceBytes[offset + 6];
            return width > 0 && height > 0 ? { width, height } : null;
        }
        offset += segmentLength;
    }
    return null;
}
