export function resolveDesktopHierarchyDropIndex(
    sourceIndex: number,
    targetIndex: number,
    afterTarget: boolean,
    itemCount: number,
): number | null {
    if (
        !Number.isInteger(sourceIndex)
        || !Number.isInteger(targetIndex)
        || itemCount < 2
        || sourceIndex < 0
        || targetIndex < 0
        || sourceIndex >= itemCount
        || targetIndex >= itemCount
        || sourceIndex === targetIndex
    ) {
        return null;
    }

    const index = targetIndex + (afterTarget ? 1 : 0) - (sourceIndex < targetIndex ? 1 : 0);
    return index === sourceIndex ? null : Math.max(0, Math.min(itemCount - 1, index));
}
