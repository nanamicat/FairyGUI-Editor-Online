import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class MemoryBrowserStorage {
	constructor() {
		this.files = new Map();
		this.dirs = new Set(['.']);
		this.sessionLocks = new Set();
		this.writeLog = [];
	}

	importDirectory(sourceDir) {
		const walk = (dirPath) => {
			for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
				const absolutePath = path.join(dirPath, entry.name);
				const relative = normalizeStoragePath(path.relative(sourceDir, absolutePath));
				if (entry.isDirectory()) {
					this.ensureDir(relative);
					walk(absolutePath);
				} else if (entry.isFile() && entry.name !== '.openfairygui.backend.lock') {
					this.writeRaw(relative, readFileSync(absolutePath), false);
				}
			}
		};
		walk(sourceDir);
	}

	ensureDir(dirPath) {
		const normalized = normalizeStoragePath(dirPath);
		if (normalized === '.') {
			this.dirs.add('.');
			return;
		}
		const parts = normalized.split('/');
		let cursor = '.';
		for (const part of parts) {
			cursor = cursor === '.' ? part : `${cursor}/${part}`;
			this.dirs.add(cursor);
		}
	}

	writeRaw(filePath, data, logWrite = true) {
		const normalized = normalizeStoragePath(filePath);
		this.ensureDir(dirnameStoragePath(normalized));
		this.files.set(normalized, new Uint8Array(data));
		if (logWrite) this.writeLog.push(normalized);
	}

	async readFile(filePath) {
		return decoder.decode(await this.readFileRaw(filePath));
	}

	async readFileRaw(filePath) {
		const normalized = normalizeStoragePath(filePath);
		const data = this.files.get(normalized);
		if (!data) throw createPathError('ENOENT', `File not found: ${normalized}`);
		return new Uint8Array(data);
	}

	async writeFile(filePath, content) {
		this.writeRaw(filePath, encoder.encode(String(content)));
	}

	async writeFileRaw(filePath, data) {
		this.writeRaw(filePath, data);
	}

	async mkdir(dirPath, options = {}) {
		const normalized = normalizeStoragePath(dirPath);
		if (options.recursive === false && dirnameStoragePath(normalized) !== '.' && !this.dirs.has(dirnameStoragePath(normalized))) {
			throw createPathError('ENOENT', `Parent directory not found: ${normalized}`);
		}
		this.ensureDir(normalized);
	}

	async readdir(dirPath) {
		const normalized = normalizeStoragePath(dirPath);
		if (!this.dirs.has(normalized)) throw createPathError('ENOTDIR', `Directory not found: ${normalized}`);
		const prefix = normalized === '.' ? '' : `${normalized}/`;
		const names = new Set();
		for (const dir of this.dirs) {
			if (dir === normalized || !dir.startsWith(prefix)) continue;
			const rest = dir.slice(prefix.length);
			if (rest) names.add(rest.split('/')[0]);
		}
		for (const file of this.files.keys()) {
			if (!file.startsWith(prefix)) continue;
			const rest = file.slice(prefix.length);
			if (rest) names.add(rest.split('/')[0]);
		}
		return Array.from(names).sort();
	}

	async exists(filePath) {
		const normalized = normalizeStoragePath(filePath);
		return this.files.has(normalized) || this.dirs.has(normalized);
	}

	async stat(filePath) {
		const normalized = normalizeStoragePath(filePath);
		if (this.files.has(normalized)) return { kind: 'file' };
		if (this.dirs.has(normalized)) return { kind: 'directory' };
		throw createPathError('ENOENT', `Path not found: ${normalized}`);
	}

	async acquireSessionLock(lockPath) {
		const normalized = normalizeStoragePath(lockPath);
		if (this.sessionLocks.has(normalized)) {
			throw createPathError('EEXIST', `Session lock is already held: ${normalized}`);
		}
		this.sessionLocks.add(normalized);
		let released = false;
		return {
			writeMetadata: async () => undefined,
			release: async () => {
				if (!released) this.sessionLocks.delete(normalized);
				released = true;
			},
		};
	}

	async unlink(filePath) {
		this.files.delete(normalizeStoragePath(filePath));
	}

	async rmdir(dirPath) {
		const normalized = normalizeStoragePath(dirPath);
		if (normalized === '.') throw createPathError('EBUSY', 'Cannot remove the storage root.');
		if (!this.dirs.has(normalized)) throw createPathError('ENOENT', `Directory not found: ${normalized}`);
		const prefix = `${normalized}/`;
		if ([...this.dirs].some((dir) => dir.startsWith(prefix))
			|| [...this.files.keys()].some((file) => file.startsWith(prefix))) {
			throw createPathError('ENOTEMPTY', `Directory is not empty: ${normalized}`);
		}
		this.dirs.delete(normalized);
	}

	join(...paths) {
		return joinStoragePath(...paths);
	}

	dirname(filePath) {
		return dirnameStoragePath(filePath);
	}

	resolve(...paths) {
		return joinStoragePath(...paths);
	}

	summary() {
		let bytes = 0;
		for (const data of this.files.values()) bytes += data.byteLength;
		return {
			fileCount: this.files.size,
			directoryCount: this.dirs.size,
			totalBytes: bytes,
			writeCount: this.writeLog.length,
			writtenPaths: Array.from(new Set(this.writeLog)).sort(),
		};
	}

	snapshot() {
		return {
			files: [...this.files.entries()]
				.map(([filePath, data]) => [filePath, [...data]])
				.sort(([left], [right]) => left.localeCompare(right)),
			directories: [...this.dirs].sort(),
		};
	}
}

function normalizeStoragePath(value) {
	const normalized = String(value ?? '.').replace(/\\/g, '/').replace(/\/+/g, '/');
	const rawSegments = normalized.split('/').filter((segment) => segment.length > 0);
	const segments = [];
	for (const segment of rawSegments) {
		if (segment === '.') continue;
		if (segment === '..') {
			if (segments.length > 0) segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments.join('/') || '.';
}

function dirnameStoragePath(filePath) {
	const normalized = normalizeStoragePath(filePath);
	if (normalized === '.') return '.';
	const parts = normalized.split('/');
	parts.pop();
	return parts.join('/') || '.';
}

function joinStoragePath(...parts) {
	return normalizeStoragePath(parts.filter((part) => part && part !== '.').join('/'));
}

function createPathError(code, message) {
	const error = new Error(message);
	error.code = code;
	return error;
}
