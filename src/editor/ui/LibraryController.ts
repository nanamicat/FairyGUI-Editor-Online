import type {
    EditorProjectSnapshot,
    ProjectSnapshotResource,
    ProjectSnapshotResourceFolder,
} from "../model/ProjectSnapshot";
import type { EditorResourceSelector } from "../model/EditorCommand";
import {
    type LibraryItemData,
    type ProjectTreeInteractionController,
} from "./ProjectTreeInteractionController";
import { readPackageGroups } from "../dialogs/PackageGroupsEditor";

interface LibraryControllerOptions {
    getSnapshot: () => EditorProjectSnapshot | null;
    getSelectedPackageId: () => string;
    getWorkingProject: () => unknown;
    editPackageGroups: () => void;
    applySelection: (data: LibraryItemData, preserveResourceSelection: boolean) => void;
    clearSelection: () => void;
    setDebugAttribute: (name: string, value: string) => void;
    setStatus: (message: string) => void;
    onViewStateChanged: () => void;
}

export type LibraryResourceFolderSelector = {
    packageId: string;
    branch: string;
    path: string;
};

export type LibraryInspectorSelection =
    | { kind: "resource"; packageId: string; resourceId: string }
    | ({ kind: "folder" } & LibraryResourceFolderSelector)
    | null;

const RESOURCE_ICONS: Record<string, string> = {
    Component: "icon_component",
    FontResource: "icon_font",
    ImageResource: "icon_image",
    MiscResource: "icon_misc",
    MovieClipResource: "icon_movieclip",
    SoundResource: "icon_sound",
};

export class LibraryController {
    private currentPackageId = "";
    private currentFilter = "all";
    private localPackageIds: string[] = [];
    private activeBranch = "";
    private iconSizeStep = 0;
    private restoredExpandedKeys: Set<string> | null = null;
    private selectedResourceSelectors: EditorResourceSelector[] = [];
    private inspectorSelection: LibraryInspectorSelection = null;

    constructor(
        private readonly libraryView: fgui.GComponent,
        private readonly favoritesView: fgui.GComponent,
        private readonly treeInteraction: ProjectTreeInteractionController,
        private readonly options: LibraryControllerOptions,
    ) {}

    get packageId(): string { return this.currentPackageId; }
    get resourceSelectors(): EditorResourceSelector[] {
        return this.selectedResourceSelectors.map((selector) => ({ ...selector }));
    }

    setPackageId(packageId: string): void {
        this.currentPackageId = packageId;
    }

    setActiveBranch(branch: string): void {
        this.activeBranch = branch;
    }

    setIconSizeStep(step: number): void {
        this.iconSizeStep = Math.max(0, Math.min(5, Math.trunc(step)));
        this.options.onViewStateChanged();
    }

    getLocalPackageIds(): string[] { return this.localPackageIds.slice(); }
    setLocalPackageIds(ids: string[]): void {
        this.localPackageIds = [...new Set(ids)];
        this.options.onViewStateChanged();
    }

    getViewState(): { filter: string; localPackageIds: string[]; iconSizeStep: number; expandedKeys: string[] } {
        return {
            filter: this.currentFilter,
            localPackageIds: [...this.localPackageIds],
            iconSizeStep: this.iconSizeStep,
            expandedKeys: this.collectExpandedKeys(),
        };
    }

    restoreViewState(state: { filter?: unknown; localPackageIds?: unknown; iconSizeStep?: unknown; expandedKeys?: unknown }): void {
        this.currentFilter = typeof state.filter === "string" ? state.filter : "all";
        this.localPackageIds = Array.isArray(state.localPackageIds) ? state.localPackageIds.filter((id): id is string => typeof id === "string") : [];
        this.iconSizeStep = Math.max(0, Math.min(5, Number(state.iconSizeStep) || 0));
        this.restoredExpandedKeys = Array.isArray(state.expandedKeys)
            ? new Set(state.expandedKeys.filter((key): key is string => typeof key === "string"))
            : null;
    }

    getInspectorSelection(): LibraryInspectorSelection {
        return this.inspectorSelection ? { ...this.inspectorSelection } : null;
    }

    setInspectorSelection(selection: LibraryInspectorSelection): void {
        this.inspectorSelection = selection ? { ...selection } : null;
    }

    clearInspectorSelection(): void {
        this.inspectorSelection = null;
    }

    reconcileInspectorSelection(snapshot: EditorProjectSnapshot): void {
        const selection = this.inspectorSelection;
        if (!selection) return;
        const pkg = snapshot.packages.find((candidate) => candidate.id === selection.packageId);
        const survives = selection.kind === "resource"
            ? pkg?.resources.some((resource) => resource.id === selection.resourceId)
            : pkg?.folders?.some((folder) => (
                folder.branch === selection.branch && folder.path === selection.path
            ));
        if (!survives) this.clearInspectorSelection();
    }

    populateFallback(): void {
        const tree = this.libraryView.getChild("treeView").asTree;
        this.treeInteraction.resetTree(tree);
        this.treeInteraction.configureLibraryTree(tree);

        const basicNode = this.createTreeNode(true, "Basic", "icon_package", "icon_package_open");
        basicNode.expanded = true;
        basicNode.addChild(this.createTreeLeaf("Buttons"));
        basicNode.addChild(this.createTreeLeaf("Inputs"));
        basicNode.addChild(this.createTreeLeaf("Lists"));

        const builderNode = this.createTreeNode(true, "Builder", "icon_package", "icon_package_open");
        builderNode.expanded = true;
        for (const name of ["MainView", "LibraryView", "DocumentView", "HierarchyView", "InspectorView", "PreviewView"]) {
            builderNode.addChild(this.createTreeLeaf(name));
        }
        tree.rootNode.addChild(basicNode);
        tree.rootNode.addChild(builderNode);

        const list = this.libraryView.getChild("listView").asList;
        list.removeChildrenToPool();
        for (const resource of ["MainView", "LibraryView", "DocumentView", "HierarchyView", "InspectorView", "PreviewView"]) {
            const item = list.addItemFromPool().asButton;
            item.title = resource;
            item.icon = this.iconUrl("icon_component");
            item.data = null;
        }
    }

    populate(): void {
        const snapshot = this.options.getSnapshot();
        if (!snapshot) return;
        if (!snapshot.packages.some((pkg) => pkg.id === this.currentPackageId)) {
            const selectedPackageId = this.options.getSelectedPackageId();
            this.currentPackageId = snapshot.packages.some((pkg) => pkg.id === selectedPackageId)
                ? selectedPackageId
                : snapshot.packages[0]?.id || "";
        }

        const groups = readPackageGroups(this.options.getWorkingProject());
        const packageSelector = this.libraryView.getChild("group").asComboBox;
        packageSelector.items = ["所有包", "我的工作区(本地)", ...groups.map((group) => group.name), "编辑分组…"];
        packageSelector.values = ["all", "local", ...groups.map((_, index) => `group:${index}`), "edit"];
        if (!packageSelector.values.includes(this.currentFilter)) this.currentFilter = "all";
        packageSelector.selectedIndex = packageSelector.values.indexOf(this.currentFilter);
        this.options.setDebugAttribute("data-fairy-editor-library-package", this.currentPackageId);
        this.options.setDebugAttribute("data-fairy-editor-library-filter", this.currentFilter);

        const tree = this.libraryView.getChild("treeView").asTree;
        this.treeInteraction.resetTree(tree);
        this.treeInteraction.configureLibraryTree(tree);
        const selectedKeys = this.getSelectedKeys();
        const selectedTreeNodes: fgui.GTreeNode[] = [];
        const groupIndex = this.currentFilter.startsWith("group:") ? Number(this.currentFilter.slice(6)) : -1;
        const visiblePackageIds = this.currentFilter === "local"
            ? new Set(this.localPackageIds.length > 0 ? this.localPackageIds : snapshot.packages.map((pkg) => pkg.id))
            : groupIndex >= 0
                ? new Set(groups[groupIndex]?.pkgs || [])
                : null;
        const visiblePackages = visiblePackageIds
            ? snapshot.packages.filter((pkg) => visiblePackageIds.has(pkg.id))
            : snapshot.packages;
        if (!visiblePackages.some((pkg) => pkg.id === this.currentPackageId)) {
            this.currentPackageId = visiblePackages[0]?.id || "";
        }
        for (const pkg of visiblePackages) {
            const packageNode = this.createTreeNode(
                true,
                `${pkg.name} (${pkg.resources.length})`,
                "icon_package",
                "icon_package_open",
            );
            packageNode.data = { kind: "package", packageId: pkg.id } as LibraryItemData;
            packageNode.expanded = this.isExpanded(packageNode.data as LibraryItemData, pkg.id === this.currentPackageId);

            const folderPathKey = (path: string): string => {
                const segments = path.split("/").filter(Boolean);
                return segments.length ? `/${segments.join("/")}/` : "/";
            };
            const parentFolderPathKey = (path: string): string => {
                const segments = path.split("/").filter(Boolean);
                segments.pop();
                return segments.length ? `/${segments.join("/")}/` : "/";
            };
            const appendedResourceIds = new Set<string>();
            const appendResourceNode = (parent: fgui.GTreeNode, resource: ProjectSnapshotResource): void => {
                const component = resource.type === "Component"
                    ? pkg.components.find((candidate) => candidate.id === resource.id)
                    : null;
                const node = this.createTreeLeaf(resource.name || resource.id, this.resourceIcon(resource));
                node.data = component
                    ? { kind: "component", packageId: pkg.id, componentId: component.id } as LibraryItemData
                    : { kind: "resource", packageId: pkg.id, resourceId: resource.id } as LibraryItemData;
                if (selectedKeys.has(`${pkg.id}/${resource.id}`)) selectedTreeNodes.push(node);
                appendedResourceIds.add(resource.id);
                parent.addChild(node);
            };
            const appendFolderNode = (parent: fgui.GTreeNode, folder: ProjectSnapshotResourceFolder): void => {
                const node = this.createTreeNode(
                    true,
                    `${folder.path.split("/").filter(Boolean).pop() || folder.path}${folder.favorite ? " ★" : ""}`,
                );
                node.data = {
                    kind: "folder",
                    packageId: pkg.id,
                    branch: folder.branch,
                    path: folder.path,
                } as LibraryItemData;
                node.expanded = this.isExpanded(node.data as LibraryItemData, pkg.id === this.currentPackageId);
                const folderKey = folderPathKey(folder.path);
                for (const child of (pkg.folders || []).filter((candidate) => (
                    candidate.branch === folder.branch && parentFolderPathKey(candidate.path) === folderKey
                ))) appendFolderNode(node, child);
                for (const resource of pkg.resources.filter((candidate) => (
                    candidate.branch === folder.branch && folderPathKey(candidate.path) === folderKey
                ))) appendResourceNode(node, resource);
                parent.addChild(node);
            }
            for (const folder of (pkg.folders || []).filter((candidate) => parentFolderPathKey(candidate.path) === "/")) {
                appendFolderNode(packageNode, folder);
            }
            for (const resource of pkg.resources.filter((candidate) => (
                !candidate.branch || candidate.branch === this.activeBranch
            ))) {
                if (!appendedResourceIds.has(resource.id)) appendResourceNode(packageNode, resource);
            }
            tree.rootNode.addChild(packageNode);
        }
        for (const node of selectedTreeNodes) tree.selectNode(node);

        const selectedPackage = visiblePackages.find((pkg) => pkg.id === this.currentPackageId);
        const list = this.libraryView.getChild("listView").asList;
        list.removeChildrenToPool();
        this.treeInteraction.resetLibrarySelection(list);
        if (!selectedPackage) return;

        const selectedIndexes: number[] = [];
        const visibleResources = selectedPackage.resources.filter((resource) => (
            !resource.branch || resource.branch === this.activeBranch
        ));
        const iconSizes = [20, 28, 36, 48, 64, 88];
        const iconSize = iconSizes[this.iconSizeStep];
        for (const [index, resource] of visibleResources.entries()) {
            const component = resource.type === "Component"
                ? selectedPackage.components.find((candidate) => candidate.id === resource.id)
                : null;
            const item = list.addItemFromPool().asButton;
            item.title = resource.name || resource.id;
            item.icon = this.iconUrl(this.resourceIcon(resource));
            item.setSize(Math.max(96, list.width), iconSize + 24);
            const icon = item.getChild("icon");
            if (icon) {
                icon.setSize(iconSize, iconSize);
                if (icon.asLoader) {
                    icon.asLoader.fill = fgui.LoaderFillType.Scale;
                    icon.asLoader.shrinkOnly = true;
                }
            }
            item.selected = false;
            if (selectedKeys.has(`${selectedPackage.id}/${resource.id}`)) selectedIndexes.push(index);
            item.data = component
                ? { kind: "component", packageId: selectedPackage.id, componentId: component.id } as LibraryItemData
                : { kind: "resource", packageId: selectedPackage.id, resourceId: resource.id } as LibraryItemData;
            this.treeInteraction.configureLibraryCell(item, item.data as LibraryItemData);
        }
        for (const index of selectedIndexes) list.addSelection(index);
    }

    populateFavorites(): void {
        const tree = this.favoritesView.getChild("treeView").asTree;
        this.treeInteraction.resetTree(tree);
        this.treeInteraction.configureLibraryTree(tree);
        const selectedKeys = this.getSelectedKeys();
        const selectedTreeNodes: fgui.GTreeNode[] = [];
        let favoriteCount = 0;
        for (const pkg of this.options.getSnapshot()?.packages || []) {
            const folderPathKey = (path: string): string => {
                const segments = path.split("/").filter(Boolean);
                return segments.length ? `/${segments.join("/")}/` : "/";
            };
            const parentFolderPathKey = (path: string): string => {
                const segments = path.split("/").filter(Boolean);
                segments.pop();
                return `/${segments.join("/")}${segments.length ? "/" : ""}`;
            };
            const favoriteFolders = (pkg.folders || []).filter((folder) => folder.favorite);
            const folders = favoriteFolders.filter((folder) => !favoriteFolders.some((ancestor) => (
                ancestor.branch === folder.branch
                && ancestor.path !== folder.path
                && folderPathKey(folder.path).startsWith(folderPathKey(ancestor.path))
            )));
            const resources = pkg.resources.filter((resource) => resource.favorite && !favoriteFolders.some((folder) => (
                folder.branch === resource.branch && folderPathKey(resource.path).startsWith(folderPathKey(folder.path))
            )));
            if (folders.length + resources.length === 0) continue;
            favoriteCount += folders.length + resources.length;
            const packageNode = this.createTreeNode(
                true,
                `${pkg.name} (${folders.length + resources.length})`,
                "icon_package",
                "icon_package_open",
            );
            packageNode.expanded = true;
            packageNode.data = { kind: "package", packageId: pkg.id } as LibraryItemData;
            const appendResourceNode = (parent: fgui.GTreeNode, resource: ProjectSnapshotResource): void => {
                const component = resource.type === "Component"
                    ? pkg.components.find((candidate) => candidate.id === resource.id)
                    : null;
                const node = this.createTreeLeaf(resource.name || resource.id, this.resourceIcon(resource));
                node.data = component
                    ? { kind: "component", packageId: pkg.id, componentId: component.id } as LibraryItemData
                    : { kind: "resource", packageId: pkg.id, resourceId: resource.id } as LibraryItemData;
                if (selectedKeys.has(`${pkg.id}/${resource.id}`)) selectedTreeNodes.push(node);
                parent.addChild(node);
            };
            const appendFolderContents = (parent: fgui.GTreeNode, folder: ProjectSnapshotResourceFolder): void => {
                const folderKey = folderPathKey(folder.path);
                for (const childFolder of (pkg.folders || []).filter((candidate) => (
                    candidate.branch === folder.branch
                    && parentFolderPathKey(candidate.path) === folderKey
                ))) {
                    const node = this.createTreeNode(
                        true,
                        childFolder.path.split("/").filter(Boolean).pop() || childFolder.path,
                    );
                    node.data = {
                        kind: "folder",
                        packageId: pkg.id,
                        branch: childFolder.branch,
                        path: childFolder.path,
                    } as LibraryItemData;
                    appendFolderContents(node, childFolder);
                    parent.addChild(node);
                }
                for (const resource of pkg.resources.filter((candidate) => (
                    candidate.branch === folder.branch && folderPathKey(candidate.path) === folderKey
                ))) appendResourceNode(parent, resource);
            };
            for (const folder of folders) {
                const node = this.createTreeNode(true, folder.path);
                node.data = {
                    kind: "folder",
                    packageId: pkg.id,
                    branch: folder.branch,
                    path: folder.path,
                } as LibraryItemData;
                node.expanded = true;
                appendFolderContents(node, folder);
                packageNode.addChild(node);
            }
            for (const resource of resources) appendResourceNode(packageNode, resource);
            tree.rootNode.addChild(packageNode);
        }
        for (const node of selectedTreeNodes) tree.selectNode(node);
        this.options.setDebugAttribute("data-fairy-editor-favorites-count", String(favoriteCount));
    }

    getSelectedResourceSelectors(leftPanelMode: string): EditorResourceSelector[] {
        if (leftPanelMode !== "library" && leftPanelMode !== "favorites") return [];
        return this.selectedResourceSelectors.filter((selector) => {
            const pkg = this.options.getSnapshot()?.packages.find((candidate) => candidate.id === selector.packageId);
            return Boolean(pkg?.components.some((component) => component.id === selector.resourceId)
                || pkg?.resources.some((resource) => resource.id === selector.resourceId));
        }).map((selector) => ({ ...selector }));
    }

    handleItemClick(data: LibraryItemData | null, list: fgui.GList): void {
        const selectors = this.captureResourceSelection(list);
        const clickedSelector = data?.kind === "resource"
            ? { packageId: data.packageId, resourceId: data.resourceId }
            : data?.kind === "component"
                ? { packageId: data.packageId, resourceId: data.componentId }
                : null;
        if (!clickedSelector || selectors.some((selector) => (
            selector.packageId === clickedSelector.packageId && selector.resourceId === clickedSelector.resourceId
        ))) {
            if (data) this.options.applySelection(data, true);
            return;
        }
        const surviving = selectors[0];
        const pkg = surviving && this.options.getSnapshot()?.packages.find(
            (candidate) => candidate.id === surviving.packageId,
        );
        const component = pkg?.components.find((candidate) => candidate.id === surviving?.resourceId);
        if (surviving) {
            this.options.applySelection(component
                ? { kind: "component", packageId: surviving.packageId, componentId: surviving.resourceId }
                : { kind: "resource", packageId: surviving.packageId, resourceId: surviving.resourceId }, true);
            return;
        }
        this.options.clearSelection();
    }

    handleFilterChanged(): void {
        const filter = this.libraryView.getChild("group").asComboBox.value;
        if (filter === "edit") {
            this.libraryView.getChild("group").asComboBox.value = this.currentFilter;
            this.options.editPackageGroups();
            return;
        }
        if (!filter || filter === this.currentFilter) return;
        this.currentFilter = filter;
        this.options.onViewStateChanged();
        this.populate();
        const label = this.libraryView.getChild("group").asComboBox.text;
        this.options.setStatus(`资源筛选：${label}。`);
    }

    setResourceSelection(selectors: EditorResourceSelector[]): void {
        this.selectedResourceSelectors = [...new Map(selectors.map((selector) => [
            `${selector.packageId}/${selector.resourceId}`,
            { ...selector },
        ])).values()];
        this.options.setDebugAttribute(
            "data-fairy-editor-library-resource-selection",
            this.selectedResourceSelectors.map((selector) => `${selector.packageId}/${selector.resourceId}`).join("|"),
        );
    }

    prepareSelection(data: LibraryItemData, preserveResourceSelection: boolean): void {
        if (preserveResourceSelection) return;
        this.setResourceSelection(data.kind === "resource"
            ? [{ packageId: data.packageId, resourceId: data.resourceId }]
            : data.kind === "component"
                ? [{ packageId: data.packageId, resourceId: data.componentId }]
                : []);
    }

    clearResourceSelection(): void {
        this.setResourceSelection([]);
    }

    collapseLibrary(): void {
        this.libraryView.getChild("treeView").asTree.collapseAll();
        this.restoredExpandedKeys = new Set();
        this.options.onViewStateChanged();
        this.options.setDebugAttribute("data-fairy-editor-library-collapse", "collapsed");
    }

    captureExpansionState(): void {
        this.restoredExpandedKeys = new Set(this.collectExpandedKeys());
        this.options.onViewStateChanged();
    }

    collapseFavorites(): void {
        this.favoritesView.getChild("treeView").asTree.collapseAll();
    }

    expandFavorites(): void {
        this.favoritesView.getChild("treeView").asTree.expandAll();
    }

    private captureResourceSelection(list: fgui.GList): EditorResourceSelector[] {
        const selectors = list.getSelection().flatMap((index): EditorResourceSelector[] => {
            const item = list.getChildAt(index);
            const data = (item.treeNode?.data || item.data) as LibraryItemData | null;
            if (data?.kind === "resource") return [{ packageId: data.packageId, resourceId: data.resourceId }];
            if (data?.kind === "component") return [{ packageId: data.packageId, resourceId: data.componentId }];
            return [];
        });
        this.setResourceSelection(selectors);
        return this.resourceSelectors;
    }

    private getSelectedKeys(): Set<string> {
        return new Set(this.selectedResourceSelectors.map((selector) => `${selector.packageId}/${selector.resourceId}`));
    }

    private createTreeNode(
        hasChildren: boolean,
        text: string,
        icon = "icon_folder",
        expandedIcon = "icon_folder_open",
    ): fgui.GTreeNode {
        const node = new fgui.GTreeNode(hasChildren);
        this.treeInteraction.setNodeLabel(node, text);
        this.treeInteraction.setNodeIcon(node, icon, expandedIcon);
        return node;
    }

    private createTreeLeaf(text: string, icon = "icon_folder"): fgui.GTreeNode {
        return this.createTreeNode(false, text, icon);
    }

    private isExpanded(data: LibraryItemData, fallback: boolean): boolean {
        return this.restoredExpandedKeys?.has(this.getExpansionKey(data)) ?? fallback;
    }

    private collectExpandedKeys(): string[] {
        const keys: string[] = [];
        const visit = (node: fgui.GTreeNode): void => {
            if (!node.isFolder) return;
            const data = node.data as LibraryItemData | null;
            if (node.expanded && data) keys.push(this.getExpansionKey(data));
            for (let index = 0; index < node.numChildren; index += 1) visit(node.getChildAt(index));
        };
        const root = this.libraryView.getChild("treeView").asTree.rootNode;
        for (let index = 0; index < root.numChildren; index += 1) visit(root.getChildAt(index));
        return keys.sort();
    }

    private getExpansionKey(data: LibraryItemData): string {
        if (data.kind === "package") return `package:${data.packageId}`;
        if (data.kind === "folder") return `folder:${data.packageId}:${data.branch}:${data.path}`;
        return `${data.kind}:${data.packageId}:${data.kind === "component" ? data.componentId : data.resourceId}`;
    }

    private resourceIcon(resource: ProjectSnapshotResource): string {
        return RESOURCE_ICONS[resource.type] || "icon_misc";
    }

    private iconUrl(name: string): string {
        return fgui.UIPackage.getItemURL("Builder", name);
    }
}
