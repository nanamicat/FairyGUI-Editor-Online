export interface MovieClipJtaFrame {
    delay: number;
    rectX: number;
    rectY: number;
    rectWidth: number;
    rectHeight: number;
    textureIndex: number;
}

export interface MovieClipJta {
    fps: number;
    speed: number;
    repeatDelay: number;
    swing: boolean;
    boundsX: number;
    boundsY: number;
    boundsWidth: number;
    boundsHeight: number;
    frames: MovieClipJtaFrame[];
    textures: Uint8Array[];
}

export function encodeMovieClipJta(movieClip: MovieClipJta): Uint8Array {
    validateMovieClipJta(movieClip);
    const mark = new TextEncoder().encode("yytou");
    const byteLength = 30 + movieClip.frames.length * 12 + movieClip.textures.length * 4
        + movieClip.textures.reduce((total, texture) => total + texture.byteLength, 0);
    const bytes = new Uint8Array(byteLength);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    const writeByte = (value: number): void => { bytes[offset++] = value; };
    const writeInt16 = (value: number): void => { view.setInt16(offset, value); offset += 2; };
    const writeUint16 = (value: number): void => { view.setUint16(offset, value); offset += 2; };
    const writeInt32 = (value: number): void => { view.setInt32(offset, value); offset += 4; };

    writeUint16(mark.byteLength);
    bytes.set(mark, offset);
    offset += mark.byteLength;
    writeInt32(102);
    writeByte(movieClip.fps === 24 ? 0 : movieClip.fps);
    writeByte(0);
    writeByte(0);
    writeByte(0);
    writeUint16(movieClip.boundsX);
    writeUint16(movieClip.boundsY);
    writeUint16(movieClip.boundsWidth);
    writeUint16(movieClip.boundsHeight);
    writeByte(movieClip.speed);
    writeByte(movieClip.repeatDelay);
    writeByte(movieClip.swing ? 1 : 0);
    writeInt16(movieClip.frames.length);
    movieClip.frames.forEach((frame) => {
        writeInt16(frame.delay);
        writeInt16(frame.rectX);
        writeInt16(frame.rectY);
        writeInt16(frame.rectWidth);
        writeInt16(frame.rectHeight);
        writeInt16(frame.textureIndex);
    });
    writeInt16(movieClip.textures.length);
    for (const texture of movieClip.textures) {
        writeInt32(texture.byteLength);
        bytes.set(texture, offset);
        offset += texture.byteLength;
    }
    return bytes;
}

export function parseMovieClipJta(sourceBytes: Uint8Array): MovieClipJta {
    if (!(sourceBytes instanceof Uint8Array)) throw new Error("MovieClip bytes are unavailable.");
    const view = new DataView(sourceBytes.buffer, sourceBytes.byteOffset, sourceBytes.byteLength);
    let offset = 0;
    const requireBytes = (count: number): void => {
        if (offset + count > sourceBytes.byteLength) throw new Error("MovieClip JTA is truncated.");
    };
    const readByte = (): number => { requireBytes(1); return view.getUint8(offset++); };
    const readInt8 = (): number => { requireBytes(1); return view.getInt8(offset++); };
    const readInt16 = (): number => { requireBytes(2); const value = view.getInt16(offset); offset += 2; return value; };
    const readUint16 = (): number => { requireBytes(2); const value = view.getUint16(offset); offset += 2; return value; };
    const readInt32 = (): number => { requireBytes(4); const value = view.getInt32(offset); offset += 4; return value; };

    const markLength = readUint16();
    requireBytes(markLength);
    const mark = new TextDecoder().decode(sourceBytes.subarray(offset, offset + markLength));
    offset += markLength;
    if (mark !== "yytou") throw new Error("Selected resource is not a FairyGUI MovieClip JTA.");
    const version = readInt32();
    if (version < 100 || version > 102) throw new Error(`MovieClip JTA version ${version} is not editable.`);
    const fps = readInt8() || 24;
    readByte();
    readByte();
    readByte();
    let boundsX = 0;
    let boundsY = 0;
    let boundsWidth = 0;
    let boundsHeight = 0;
    if (version >= 102) {
        boundsX = readUint16();
        boundsY = readUint16();
        boundsWidth = readUint16();
        boundsHeight = readUint16();
    }
    const speed = readByte();
    const repeatDelay = readByte();
    const swing = readInt8() === 1;
    const frameCount = readInt16();
    if (frameCount < 0) throw new Error("MovieClip JTA has an invalid frame count.");
    const frames: MovieClipJtaFrame[] = [];
    for (let index = 0; index < frameCount; index += 1) {
        frames.push({
            delay: readInt16(),
            rectX: readInt16(),
            rectY: readInt16(),
            rectWidth: readInt16(),
            rectHeight: readInt16(),
            textureIndex: readInt16(),
        });
    }
    const textureCount = readInt16();
    if (textureCount < 0) throw new Error("MovieClip JTA has an invalid texture count.");
    const textures: Uint8Array[] = [];
    for (let index = 0; index < textureCount; index += 1) {
        const length = readInt32();
        if (length < 0) throw new Error("MovieClip JTA has an invalid texture length.");
        requireBytes(length);
        textures.push(sourceBytes.slice(offset, offset + length));
        offset += length;
    }
    if (version === 101) {
        boundsX = readUint16();
        boundsY = readUint16();
        boundsWidth = readUint16();
        boundsHeight = readUint16();
    } else if (version === 100) {
        const nonEmptyFrames = frames.filter((frame) => frame.rectWidth > 0 && frame.rectHeight > 0);
        if (nonEmptyFrames.length > 0) {
            const minX = Math.min(...nonEmptyFrames.map((frame) => frame.rectX));
            const minY = Math.min(...nonEmptyFrames.map((frame) => frame.rectY));
            const shiftX = Math.min(0, minX);
            const shiftY = Math.min(0, minY);
            for (const frame of frames) {
                frame.rectX -= shiftX;
                frame.rectY -= shiftY;
            }
            boundsWidth = Math.max(...nonEmptyFrames.map((frame) => frame.rectX + frame.rectWidth));
            boundsHeight = Math.max(...nonEmptyFrames.map((frame) => frame.rectY + frame.rectHeight));
        }
    }
    const movieClip = {
        fps,
        speed,
        repeatDelay,
        swing,
        boundsX,
        boundsY,
        boundsWidth,
        boundsHeight,
        frames,
        textures,
    };
    validateMovieClipJta(movieClip);
    return movieClip;
}

function validateMovieClipJta(movieClip: MovieClipJta): void {
    const integerInRange = (value: number, min: number, max: number): boolean =>
        Number.isInteger(value) && value >= min && value <= max;
    if (
        !integerInRange(movieClip.fps, 1, 127)
        || !integerInRange(movieClip.speed, 1, 255)
        || !integerInRange(movieClip.repeatDelay, 0, 255)
        || typeof movieClip.swing !== "boolean"
        || ![movieClip.boundsX, movieClip.boundsY, movieClip.boundsWidth, movieClip.boundsHeight]
            .every((value) => integerInRange(value, 0, 65535))
        || movieClip.frames.length > 32767
        || movieClip.textures.length > 32767
        || movieClip.frames.some((frame) =>
            ![frame.delay, frame.rectX, frame.rectY, frame.rectWidth, frame.rectHeight, frame.textureIndex]
                .every((value) => integerInRange(value, -32768, 32767))
            || (frame.textureIndex < -1 || frame.textureIndex >= movieClip.textures.length)
        )
        || movieClip.textures.some((texture) => !(texture instanceof Uint8Array))
    ) {
        throw new Error("MovieClip JTA contains values outside the supported binary range.");
    }
}
