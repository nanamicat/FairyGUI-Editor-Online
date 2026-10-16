export async function pickBrowserFile(
    accept: string,
    cancelledMessage: string,
    debugName = "",
): Promise<File> {
    return (await pickBrowserFiles(accept, cancelledMessage, debugName, false))[0];
}

export async function pickBrowserFiles(
    accept: string,
    cancelledMessage: string,
    debugName = "",
    multiple = true,
): Promise<File[]> {
    return await new Promise<File[]>((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.multiple = multiple;
        if (debugName) input.dataset.fairyEditorFilePicker = debugName;
        input.style.display = "none";

        const cleanup = (): void => {
            input.remove();
            window.removeEventListener("focus", onFocus);
        };
        const onFocus = (): void => {
            window.setTimeout(() => {
                if (!input.files || input.files.length === 0) {
                    cleanup();
                    reject(new Error(cancelledMessage));
                }
            }, 300);
        };

        input.onchange = () => {
            const files = input.files ? Array.from(input.files) : [];
            cleanup();
            if (files.length === 0) {
                reject(new Error(cancelledMessage));
                return;
            }
            resolve(files);
        };

        document.body.appendChild(input);
        window.addEventListener("focus", onFocus);
        input.click();
    });
}
