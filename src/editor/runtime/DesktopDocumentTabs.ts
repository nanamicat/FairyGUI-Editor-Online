export interface DesktopDocumentTab {
    packageId: string;
    componentId: string;
}

export interface DesktopDocumentTabState {
    tabs: DesktopDocumentTab[];
    active: DesktopDocumentTab | null;
}

interface DesktopDocumentProjectLike {
    packages?: Array<{
        id?: string;
        resources?: Array<{
            id?: string;
            kind?: string;
            component?: {
                displayList?: Array<{
                    id?: string;
                    kind?: string;
                    resource?: { packageId?: string; resourceId?: string };
                }>;
            };
        }>;
    }>;
}

export function getDesktopDocumentTabId(tab: DesktopDocumentTab): string {
    return `${tab.packageId}/${tab.componentId}`;
}

export function openDesktopDocumentTab(
    tabs: DesktopDocumentTab[],
    target: DesktopDocumentTab,
): DesktopDocumentTab[] {
    const targetId = getDesktopDocumentTabId(target);
    return tabs.some((tab) => getDesktopDocumentTabId(tab) === targetId)
        ? tabs
        : [...tabs, { ...target }];
}

export function closeDesktopDocumentTab(
    tabs: DesktopDocumentTab[],
    target: DesktopDocumentTab,
    active: DesktopDocumentTab | null,
): DesktopDocumentTabState {
    const targetId = getDesktopDocumentTabId(target);
    const index = tabs.findIndex((tab) => getDesktopDocumentTabId(tab) === targetId);
    if (index < 0) return { tabs, active };
    const nextTabs = tabs.filter((_, tabIndex) => tabIndex !== index);
    if (!active || getDesktopDocumentTabId(active) !== targetId) {
        return { tabs: nextTabs, active };
    }
    return {
        tabs: nextTabs,
        active: nextTabs[Math.min(index, nextTabs.length - 1)] || null,
    };
}

export function cycleDesktopDocumentTab(
    tabs: DesktopDocumentTab[],
    active: DesktopDocumentTab | null,
    delta: number,
): DesktopDocumentTab | null {
    if (tabs.length === 0) return null;
    const activeId = active ? getDesktopDocumentTabId(active) : "";
    const activeIndex = tabs.findIndex((tab) => getDesktopDocumentTabId(tab) === activeId);
    const startIndex = activeIndex < 0 ? 0 : activeIndex;
    return tabs[(startIndex + delta % tabs.length + tabs.length) % tabs.length];
}

export function reconcileDesktopDocumentTabs(
    tabs: DesktopDocumentTab[],
    available: DesktopDocumentTab[],
    active: DesktopDocumentTab | null,
): DesktopDocumentTabState {
    const availableIds = new Set(available.map(getDesktopDocumentTabId));
    const seen = new Set<string>();
    const nextTabs = tabs.filter((tab) => {
        const id = getDesktopDocumentTabId(tab);
        if (!availableIds.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
    const activeId = active ? getDesktopDocumentTabId(active) : "";
    const nextActive = activeId && availableIds.has(activeId) ? active : nextTabs[0] || null;
    return {
        tabs: nextActive ? openDesktopDocumentTab(nextTabs, nextActive) : nextTabs,
        active: nextActive,
    };
}

export function resolveDesktopReferencedComponentTab(
    projectValue: unknown,
    owner: DesktopDocumentTab,
    displayNodeId: string,
): DesktopDocumentTab | null {
    const project = projectValue as DesktopDocumentProjectLike | null;
    const ownerPackage = project?.packages?.find((pkg) => pkg.id === owner.packageId);
    const ownerComponent = ownerPackage?.resources?.find((resource) => (
        resource.id === owner.componentId && resource.kind === "component"
    ));
    const node = ownerComponent?.component?.displayList?.find((item) => item.id === displayNodeId);
    const componentId = node?.kind === "component" ? node.resource?.resourceId : "";
    if (!componentId) return null;
    const packageId = node?.resource?.packageId || owner.packageId;
    const target = project?.packages
        ?.find((pkg) => pkg.id === packageId)
        ?.resources?.find((resource) => resource.id === componentId && resource.kind === "component");
    return target?.component ? { packageId, componentId } : null;
}
