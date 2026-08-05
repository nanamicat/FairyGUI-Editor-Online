export type DesktopConsoleLevel = "info" | "warning" | "error";

export interface DesktopConsoleEntry {
    level: DesktopConsoleLevel;
    message: string;
}

export function appendDesktopConsoleEntry(
    entries: DesktopConsoleEntry[],
    message: string,
    level: DesktopConsoleLevel = "info",
    now: Date = new Date(),
): DesktopConsoleEntry[] {
    const next = entries.concat({
        level,
        message: `[${now.toISOString().slice(11, 23)}] ${message}`,
    });
    return next.length > 100 ? next.slice(-100) : next;
}

export function getDesktopConsoleCopyText(
    entries: DesktopConsoleEntry[],
    selectedIndices: number[],
): string {
    return selectedIndices
        .flatMap((index) => entries[index]?.message ?? [])
        .join("\n");
}
