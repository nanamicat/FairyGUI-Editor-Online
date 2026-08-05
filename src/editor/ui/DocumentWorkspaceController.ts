import type { EditorProjectSnapshot, ProjectSnapshotComponent } from "../model/ProjectSnapshot";
import {
    getDesktopGroupPath,
    getDesktopGroupScopeNodeIds,
    reconcileDesktopGroupPath,
} from "../runtime/DesktopGroupIsolation";
import {
    closeDesktopDocumentTab,
    cycleDesktopDocumentTab,
    getDesktopDocumentTabId,
    openDesktopDocumentTab,
    reconcileDesktopDocumentTabs,
    type DesktopDocumentTab,
} from "../runtime/DesktopDocumentTabs";

export type DocumentNodeSelection = { nodeIds: string[]; primaryNodeId: string };
export type PersistedDocumentGroupPath = DesktopDocumentTab & { groupIds: string[] };

export type DocumentWorkspaceContext = {
    activateDocument(documentTab: DesktopDocumentTab): void;
    closeDocument(documentTab: DesktopDocumentTab, event?: Laya.Event): void;
    changeGroupPathDepth(targetDepth: number): void;
    setDebugAttribute(name: string, value: string): void;
};

export class DocumentWorkspaceController {
    private openTabs: DesktopDocumentTab[] = [];
    private readonly nodeSelections = new Map<string, DocumentNodeSelection>();
    private readonly groupPaths = new Map<string, string[]>();
    private readonly tabs: fgui.GList;
    private readonly groupPathBar: fgui.GComponent;
    private readonly groupPathList: fgui.GList;

    constructor(documentPanel: fgui.GComponent, private readonly context: DocumentWorkspaceContext) {
        this.tabs = documentPanel.getChild("tabs").asList;
        this.groupPathBar = documentPanel.getChild("groupPathBar").asCom;
        this.groupPathList = this.groupPathBar.getChild("list").asList;
        this.tabs.on(fgui.Events.CLICK_ITEM, this, this.onTabClick);
        this.groupPathList.on(fgui.Events.CLICK_ITEM, this, this.onGroupPathClick);
    }

    get count(): number {
        return this.openTabs.length;
    }

    getOpenTabs(): DesktopDocumentTab[] {
        return this.openTabs.map((tab) => ({ ...tab }));
    }

    clear(): void {
        this.openTabs = [];
        this.nodeSelections.clear();
        this.groupPaths.clear();
    }

    dispose(): void {
        this.tabs.off(fgui.Events.CLICK_ITEM, this, this.onTabClick);
        this.groupPathList.off(fgui.Events.CLICK_ITEM, this, this.onGroupPathClick);
        this.clear();
    }

    render(snapshot: EditorProjectSnapshot, activeDocument: DesktopDocumentTab | null): void {
        const availableDocuments = this.getAvailableDocuments(snapshot);
        this.openTabs = reconcileDesktopDocumentTabs(
            this.openTabs,
            availableDocuments,
            activeDocument,
        ).tabs;
        this.tabs.removeChildrenToPool();
        for (const documentTab of this.openTabs) {
            const pkg = snapshot.packages.find((candidate) => candidate.id === documentTab.packageId);
            const component = pkg?.components.find((candidate) => candidate.id === documentTab.componentId);
            if (!pkg || !component) continue;
            const tab = this.tabs.addItemFromPool().asButton;
            tab.name = `desktopDocumentTab-${component.id}`;
            tab.title = `${pkg.name}/${component.name}`;
            tab.data = documentTab;
            tab.setSize(Math.min(220, Math.max(110, tab.title.length * 7 + 48)), 28);
            tab.selected = getDesktopDocumentTabId(documentTab) === (
                activeDocument ? getDesktopDocumentTabId(activeDocument) : ""
            );
            tab.asCom.getController("modified").selectedIndex = 0;
            const closeButton = tab.asCom.getChild("closeButton");
            closeButton.tooltips = `Close ${tab.title}`;
            closeButton.offClick(this, this.onTabClose);
            closeButton.onClick(this, this.onTabClose, [documentTab]);
        }
        this.tabs.selectedIndex = this.openTabs.findIndex((tab) => (
            activeDocument && getDesktopDocumentTabId(tab) === getDesktopDocumentTabId(activeDocument)
        ));
        this.context.setDebugAttribute("data-fairy-editor-document-tabs", this.openTabs.map(getDesktopDocumentTabId).join("|"));
        this.context.setDebugAttribute("data-fairy-editor-document-tab-count", String(this.openTabs.length));
        this.context.setDebugAttribute("data-fairy-editor-active-document", activeDocument ? getDesktopDocumentTabId(activeDocument) : "");
        const activeComponent = activeDocument
            ? snapshot.packages.find((pkg) => pkg.id === activeDocument.packageId)?.components
                .find((component) => component.id === activeDocument.componentId) || null
            : null;
        this.renderGroupPath(activeDocument, activeComponent);
    }

    open(documentTab: DesktopDocumentTab): void {
        this.openTabs = openDesktopDocumentTab(this.openTabs, documentTab);
    }

    close(documentTab: DesktopDocumentTab, activeDocument: DesktopDocumentTab | null): DesktopDocumentTab | null {
        const state = closeDesktopDocumentTab(this.openTabs, documentTab, activeDocument);
        this.openTabs = state.tabs;
        const key = getDesktopDocumentTabId(documentTab);
        this.nodeSelections.delete(key);
        this.groupPaths.delete(key);
        return state.active;
    }

    cycle(activeDocument: DesktopDocumentTab | null, delta: number): DesktopDocumentTab | null {
        return cycleDesktopDocumentTab(this.openTabs, activeDocument, delta);
    }

    rememberSelection(documentTab: DesktopDocumentTab | null, selection: DocumentNodeSelection): void {
        if (!documentTab) return;
        this.nodeSelections.set(getDesktopDocumentTabId(documentTab), {
            nodeIds: selection.nodeIds.slice(),
            primaryNodeId: selection.primaryNodeId,
        });
    }

    getSelection(documentTab: DesktopDocumentTab): DocumentNodeSelection | null {
        const selection = this.nodeSelections.get(getDesktopDocumentTabId(documentTab));
        return selection ? { nodeIds: selection.nodeIds.slice(), primaryNodeId: selection.primaryNodeId } : null;
    }

    getGroupPath(documentTab: DesktopDocumentTab | null, component: ProjectSnapshotComponent | null): string[] {
        if (!documentTab || !component) return [];
        const key = getDesktopDocumentTabId(documentTab);
        const requested = this.groupPaths.get(key) || [];
        const reconciled = reconcileDesktopGroupPath(component.children, requested);
        if (reconciled.length !== requested.length) this.setGroupPath(documentTab, reconciled);
        return reconciled;
    }

    setGroupPath(documentTab: DesktopDocumentTab | null, groupIds: string[]): void {
        if (!documentTab) return;
        const key = getDesktopDocumentTabId(documentTab);
        if (groupIds.length > 0) this.groupPaths.set(key, [...groupIds]);
        else this.groupPaths.delete(key);
    }

    getScopedNodeIds(documentTab: DesktopDocumentTab | null, component: ProjectSnapshotComponent): string[] {
        return getDesktopGroupScopeNodeIds(component.children, this.getGroupPath(documentTab, component));
    }

    getPathForGroup(component: ProjectSnapshotComponent, groupId: string): string[] {
        return getDesktopGroupPath(component.children, groupId);
    }

    restore(
        snapshot: EditorProjectSnapshot,
        requestedTabs: DesktopDocumentTab[],
        requestedGroupPaths: PersistedDocumentGroupPath[],
        activeDocument: DesktopDocumentTab | null,
    ): DesktopDocumentTab | null {
        const reconciled = reconcileDesktopDocumentTabs(
            requestedTabs,
            this.getAvailableDocuments(snapshot),
            activeDocument,
        );
        this.openTabs = reconciled.tabs;
        this.groupPaths.clear();
        for (const entry of requestedGroupPaths) {
            const component = snapshot.packages
                .find((pkg) => pkg.id === entry.packageId)?.components
                .find((candidate) => candidate.id === entry.componentId);
            if (!component) continue;
            const groupIds = reconcileDesktopGroupPath(component.children, entry.groupIds);
            if (groupIds.length > 0) this.groupPaths.set(getDesktopDocumentTabId(entry), groupIds);
        }
        return reconciled.active;
    }

    getPersistedGroupPaths(): PersistedDocumentGroupPath[] {
        return this.openTabs.flatMap((tab) => {
            const groupIds = this.groupPaths.get(getDesktopDocumentTabId(tab));
            return groupIds?.length ? [{ ...tab, groupIds: [...groupIds] }] : [];
        });
    }

    private renderGroupPath(
        activeDocument: DesktopDocumentTab | null,
        component: ProjectSnapshotComponent | null,
    ): void {
        this.groupPathList.removeChildrenToPool();
        const path = this.getGroupPath(activeDocument, component);
        this.groupPathBar.visible = path.length > 0;
        if (!component || path.length === 0) {
            this.context.setDebugAttribute("data-fairy-editor-group-path", "root");
            return;
        }
        const root = this.groupPathList.addItemFromPool().asButton;
        root.name = "desktopGroupPathRoot";
        root.data = 0;
        root.tooltips = component.name;
        path.forEach((groupId, index) => {
            const group = component.children.find((node) => node.id === groupId);
            const item = this.groupPathList.addItemFromPool().asButton;
            item.name = `desktopGroupPath-${groupId}`;
            item.data = index + 1;
            item.tooltips = group?.name || groupId;
        });
        this.context.setDebugAttribute("data-fairy-editor-group-path", path.join("/"));
    }

    private getAvailableDocuments(snapshot: EditorProjectSnapshot): DesktopDocumentTab[] {
        return snapshot.packages.flatMap((pkg) => (
            pkg.components.map((component) => ({ packageId: pkg.id, componentId: component.id }))
        ));
    }

    private onTabClick(itemObject: fgui.GObject): void {
        const documentTab = itemObject.data as DesktopDocumentTab | null;
        if (documentTab) this.context.activateDocument(documentTab);
    }

    private onTabClose(documentTab: DesktopDocumentTab, event?: Laya.Event): void {
        this.context.closeDocument(documentTab, event);
    }

    private onGroupPathClick(itemObject: fgui.GObject): void {
        const targetDepth = Number(itemObject.data);
        if (Number.isInteger(targetDepth)) this.context.changeGroupPathDepth(targetDepth);
    }
}
