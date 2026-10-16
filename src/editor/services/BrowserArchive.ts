import { Inflate } from "fflate";
import type { BrowserWorkspaceFile } from "../model/BrowserWorkspace";

export async function readZipArchiveFiles(file: File): Promise<BrowserWorkspaceFile[]> {
    if (file.size > ZIP_MAX_ARCHIVE_BYTES) {
        throw new Error(`ZIP archive exceeds the ${ZIP_MAX_ARCHIVE_BYTES / 1024 / 1024} MB limit.`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = readZipEntries(bytes);
    const files: BrowserWorkspaceFile[] = [];
    for (const entry of entries) {
        if (entry.directory || entry.path.startsWith("__MACOSX/")) continue;
        files.push({ path: entry.path, data: extractZipEntry(bytes, entry) });
    }

    if (files.length === 0) {
        throw new Error("ZIP archive does not contain files.");
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
}

const ZIP_MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const ZIP_MAX_ENTRY_COUNT = 10_000;
const ZIP_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const ZIP_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const ZIP_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    return crc >>> 0;
});

interface ZipEntry {
    path: string;
    directory: boolean;
    flags: number;
    compression: number;
    crc: number;
    compressedSize: number;
    size: number;
    localHeaderOffset: number;
}

function readZipEntries(bytes: Uint8Array): ZipEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findZipEndOfCentralDirectory(view);
    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralSize = view.getUint32(eocdOffset + 12, true);
    const centralOffset = view.getUint32(eocdOffset + 16, true);
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
        throw new Error("ZIP64 archives are not supported.");
    }
    if (entryCount > ZIP_MAX_ENTRY_COUNT) throw new Error(`ZIP archive exceeds the ${ZIP_MAX_ENTRY_COUNT} entry limit.`);
    if (centralOffset + centralSize > eocdOffset) throw new Error("ZIP central directory is out of bounds.");

    const entries: ZipEntry[] = [];
    const paths = new Set<string>();
    let offset = centralOffset;
    let totalSize = 0;
    for (let index = 0; index < entryCount; index += 1) {
        if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
            throw new Error("ZIP central directory entry is invalid.");
        }
        const flags = view.getUint16(offset + 8, true);
        const compression = view.getUint16(offset + 10, true);
        const crc = view.getUint32(offset + 16, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const size = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);
        const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
        if (entryEnd > bytes.byteLength) throw new Error("ZIP central directory entry is truncated.");
        if ((flags & 1) !== 0) throw new Error("Encrypted ZIP entries are not supported.");
        if (compression !== 0 && compression !== 8) throw new Error(`ZIP compression method ${compression} is not supported.`);
        if (size > ZIP_MAX_ENTRY_BYTES) throw new Error(`ZIP entry exceeds the ${ZIP_MAX_ENTRY_BYTES / 1024 / 1024} MB limit.`);
        totalSize += size;
        if (totalSize > ZIP_MAX_TOTAL_BYTES) throw new Error(`ZIP contents exceed the ${ZIP_MAX_TOTAL_BYTES / 1024 / 1024} MB limit.`);

        const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
        const extraBytes = bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
        const rawName = decodeZipEntryName(nameBytes, extraBytes, (flags & 0x0800) !== 0);
        const normalized = normalizeZipEntryPath(rawName);
        const duplicateKey = normalized.path.replace(/\/$/, "");
        if (paths.has(duplicateKey)) throw new Error(`ZIP archive contains a duplicate path: ${duplicateKey}`);
        paths.add(duplicateKey);
        entries.push({
            path: normalized.path,
            directory: normalized.directory,
            flags,
            compression,
            crc,
            compressedSize,
            size,
            localHeaderOffset,
        });
        offset = entryEnd;
    }
    if (offset !== centralOffset + centralSize) throw new Error("ZIP central directory size does not match its entries.");
    return entries;
}

function findZipEndOfCentralDirectory(view: DataView): number {
    const minimum = Math.max(0, view.byteLength - 22 - 0xffff);
    for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
        if (view.getUint32(offset, true) !== 0x06054b50) continue;
        const commentLength = view.getUint16(offset + 20, true);
        if (offset + 22 + commentLength !== view.byteLength) continue;
        if (view.getUint16(offset + 4, true) !== 0 || view.getUint16(offset + 6, true) !== 0) {
            throw new Error("Multi-disk ZIP archives are not supported.");
        }
        if (view.getUint16(offset + 8, true) !== view.getUint16(offset + 10, true)) {
            throw new Error("ZIP central directory entry count is inconsistent.");
        }
        return offset;
    }
    throw new Error("ZIP end-of-central-directory record was not found.");
}

function decodeZipEntryName(nameBytes: Uint8Array, extraBytes: Uint8Array, utf8: boolean): string {
    for (let offset = 0; offset + 4 <= extraBytes.byteLength;) {
        const view = new DataView(extraBytes.buffer, extraBytes.byteOffset + offset, extraBytes.byteLength - offset);
        const id = view.getUint16(0, true);
        const size = view.getUint16(2, true);
        if (offset + 4 + size > extraBytes.byteLength) throw new Error("ZIP extra field is truncated.");
        if (id === 0x7075 && size >= 5 && extraBytes[offset + 4] === 1) {
            const expectedCrc = view.getUint32(5, true);
            if (expectedCrc === crc32(nameBytes)) {
                return new TextDecoder("utf-8", { fatal: true }).decode(extraBytes.subarray(offset + 9, offset + 4 + size));
            }
        }
        offset += 4 + size;
    }
    return new TextDecoder(utf8 ? "utf-8" : "gbk", { fatal: true }).decode(nameBytes);
}

function normalizeZipEntryPath(value: string): { path: string; directory: boolean } {
    if (!value || value.includes("\0") || /^[\\/]/.test(value) || /^[A-Za-z]:/.test(value)) {
        throw new Error(`ZIP archive contains an invalid absolute path: ${value || "(empty)"}`);
    }
    const normalized = value.replace(/\\/g, "/");
    const directory = normalized.endsWith("/");
    const segments = normalized.split("/");
    if (directory) segments.pop();
    if (segments.length === 0 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error(`ZIP archive contains an unsafe path: ${value}`);
    }
    return { path: `${segments.join("/")}${directory ? "/" : ""}`, directory };
}

function extractZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offset = entry.localHeaderOffset;
    if (offset + 30 > bytes.byteLength || view.getUint32(offset, true) !== 0x04034b50) {
        throw new Error(`ZIP local header is invalid for ${entry.path}.`);
    }
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataOffset = offset + 30 + nameLength + extraLength;
    if (dataOffset + entry.compressedSize > bytes.byteLength) throw new Error(`ZIP entry data is truncated for ${entry.path}.`);
    const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
    const data = entry.compression === 0
        ? new Uint8Array(compressed)
        : inflateZipEntry(compressed, entry);
    if (data.byteLength !== entry.size || crc32(data) !== entry.crc) {
        throw new Error(`ZIP entry integrity check failed for ${entry.path}.`);
    }
    return data;
}

function inflateZipEntry(compressed: Uint8Array, entry: ZipEntry): Uint8Array {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const inflater = new Inflate((chunk) => {
        size += chunk.byteLength;
        if (size > entry.size) {
            throw new Error(`ZIP entry inflated size exceeds its declared size for ${entry.path}.`);
        }
        chunks.push(chunk);
    });
    const chunkSize = entry.size <= 1024 * 1024 ? 1024 : 64 * 1024;
    if (compressed.byteLength === 0) {
        inflater.push(compressed, true);
    } else {
        for (let offset = 0; offset < compressed.byteLength; offset += chunkSize) {
            inflater.push(compressed.subarray(offset, offset + chunkSize), offset + chunkSize >= compressed.byteLength);
        }
    }
    if (size !== entry.size) {
        throw new Error(`ZIP entry inflated size does not match its declared size for ${entry.path}.`);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return data;
}

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ ZIP_CRC_TABLE[(crc ^ byte) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
}
