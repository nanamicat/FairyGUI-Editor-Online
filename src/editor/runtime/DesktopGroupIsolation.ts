export interface DesktopGroupIsolationNode {
    id: string;
    type: string;
    group: string;
}

export function reconcileDesktopGroupPath(
    nodes: DesktopGroupIsolationNode[],
    requestedPath: string[],
): string[] {
    const path: string[] = [];
    let parentId = "";
    for (const groupId of requestedPath) {
        const group = nodes.find((node) => node.id === groupId);
        if (!group || group.type !== "GGroup" || group.group !== parentId) break;
        path.push(groupId);
        parentId = groupId;
    }
    return path;
}

export function getDesktopGroupPath(
    nodes: DesktopGroupIsolationNode[],
    groupId: string,
): string[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const path: string[] = [];
    const seen = new Set<string>();
    let currentId = groupId;
    while (currentId) {
        if (seen.has(currentId)) return [];
        seen.add(currentId);
        const group = byId.get(currentId);
        if (!group || group.type !== "GGroup") return [];
        path.unshift(group.id);
        currentId = group.group;
    }
    return reconcileDesktopGroupPath(nodes, path);
}

export function getDesktopGroupScopeNodeIds(
    nodes: DesktopGroupIsolationNode[],
    groupPath: string[],
): string[] {
    const reconciled = reconcileDesktopGroupPath(nodes, groupPath);
    const activeGroupId = reconciled[reconciled.length - 1];
    return activeGroupId
        ? nodes.filter((node) => node.group === activeGroupId).map((node) => node.id)
        : nodes.map((node) => node.id);
}
