/** Native pickers and permission requests must be called directly from a user gesture. */
type DirectoryPickerWindow = Window & {
    showDirectoryPicker?: (options: { id: string; mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

type PermissionDirectory = FileSystemDirectoryHandle & {
    requestPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
};

export function supportsLocalDirectories(): boolean {
    return window.isSecureContext && typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
}

export function pickLocalDirectory(): Promise<FileSystemDirectoryHandle> {
    if (!supportsLocalDirectories()) {
        return Promise.reject(new Error("本地目录读写需要在 HTTPS 或 localhost 下使用 Chrome / Edge。当前浏览器不支持本地项目目录读写。"));
    }
    // Calling an extracted picker without its Window receiver can cause Illegal invocation.
    return (window as DirectoryPickerWindow).showDirectoryPicker!({ id: "fairygui-project", mode: "readwrite" }).then((directory) => {
        console.info("[FileSystemAccess] Directory picker returned a handle", { name: directory.name, kind: directory.kind });
        return directory;
    });
}

export async function authorizeLocalDirectory(directory: FileSystemDirectoryHandle): Promise<void> {
    const permission = await (directory as PermissionDirectory).requestPermission?.({ mode: "readwrite" });
    if (permission !== "granted") throw new Error("目录读写授权未获准，请重新选择文件夹并允许访问。");
}

export function isFilePickerCancelled(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

export function validateLocalProjectName(value: string): string {
    const name = value.trim();
    if (!name || name === "." || name === ".." || /[<>:"/\\|?*\x00-\x1f]/.test(name)
        || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        throw new Error("请输入有效的项目名称，不能包含路径分隔符或文件名保留字符。");
    }
    return name;
}

/** Create only in an empty directory, so an existing project can never be overwritten. */
export async function createLocalProject(
    parent: FileSystemDirectoryHandle,
    projectName: string,
    createSubfolder: boolean,
): Promise<FileSystemDirectoryHandle> {
    const name = validateLocalProjectName(projectName);
    const directory = createSubfolder ? await parent.getDirectoryHandle(name, { create: true }) : parent;
    const iterator = (directory as FileSystemDirectoryHandle & {
        keys(): { next(): Promise<{ done?: boolean }> };
    }).keys();
    if (!(await iterator.next()).done) throw new Error("项目目录不是空目录，请选择空目录或使用新的项目名称。");
    const id = crypto.randomUUID().replace(/-/g, "");
    const file = await directory.getFileHandle(`${name}.fairy`, { create: true });
    const writer = await file.createWritable();
    try {
        await writer.write(`<?xml version="1.0" encoding="utf-8"?>\n<projectDescription id="${id}" type="Layabox" version="3.0"/>\n`);
        await writer.close();
    } catch (error) {
        await writer.abort().catch(() => undefined);
        throw error;
    }
    await directory.getDirectoryHandle("assets", { create: true });
    return directory;
}
