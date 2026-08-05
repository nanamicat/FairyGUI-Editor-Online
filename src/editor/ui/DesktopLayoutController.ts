import { DESKTOP_TIMELINE_HEIGHT } from "../EditorShellConfig";
import { DEFAULT_BROWSER_WORKSPACE_ID } from "../runtime/BrowserWorkspaceRegistry";

export const DESKTOP_PANEL_GAP = 4;

export type DesktopLeftTopPanelMode =
    | "library"
    | "favorites"
    | "search"
    | "reference"
    | "transition";

export interface DesktopLayoutPanels {
    library: fgui.GComponent;
    document: fgui.GComponent;
    preview: fgui.GComponent;
    hierarchy: fgui.GComponent;
    inspector: fgui.GComponent;
}

interface DesktopLayoutOptions {
    mainView: fgui.GComponent;
    holder: fgui.GObject;
    startScene: fgui.GComponent;
    statusLine: fgui.GButton;
    panels: DesktopLayoutPanels;
    libraryDock: fgui.GComponent;
    hierarchyDock: fgui.GComponent;
    favoritesView: fgui.GComponent;
    searchView: fgui.GComponent;
    referenceView: fgui.GComponent;
    transitionListView: fgui.GComponent;
    timelineView: fgui.GComponent;
    consoleView: fgui.GComponent;
    testView: fgui.GComponent;
    getComponentPreviewEnabled: () => boolean;
    getSelectedTransitionName: () => string;
    getWorkspaceName: () => string;
    isTestActive: () => boolean;
    afterLayout: () => void;
    setDebugAttribute: (name: string, value: string) => void;
    setStatus: (message: string) => void;
}

type DockSplitterKind = "left" | "right" | "library" | "preview";

interface DockSplitterDragState {
    kind: DockSplitterKind;
    startStageX: number;
    startStageY: number;
    startValue: number;
}

const DESKTOP_LAYOUT_STORAGE_KEY = "fairygui-editor-online.desktop-layout.v1";
const LEFT_PANEL_MIN_WIDTH = 283;
const LEFT_PANEL_MAX_WIDTH = 480;
const LEFT_PANEL_RATIO = 0.16;
const RIGHT_PANEL_MIN_WIDTH = 286;
const RIGHT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_RATIO = 0.21;
const MIN_DOCUMENT_WIDTH = 360;
const MIN_LEFT_STACK_PANEL_HEIGHT = 96;
const MIN_HIERARCHY_DOCK_HEIGHT = 122;

export class DesktopLayoutController {
    leftDockVisible = true;
    leftTopPanelMode: DesktopLeftTopPanelMode = "library";
    inspectorDockVisible = true;
    timelineVisible = false;
    consoleVisible = false;

    private readonly splitters: Record<DockSplitterKind, fgui.GGraph>;
    private splitterDragState: DockSplitterDragState | null = null;
    private preferredLeftWidth: number | null = null;
    private preferredRightWidth: number | null = null;
    private preferredLibraryHeight: number | null = null;
    private preferredPreviewHeight: number | null = null;

    constructor(private readonly options: DesktopLayoutOptions) {
        this.splitters = {
            left: this.createSplitter("desktopLeftDockSplitter", "left"),
            right: this.createSplitter("desktopRightDockSplitter", "right"),
            library: this.createSplitter("desktopLibraryDockSplitter", "library"),
            preview: this.createSplitter("desktopPreviewDockSplitter", "preview"),
        };
    }

    dispose(): void {
        this.cancelSplitterDrag(false);
        for (const splitter of Object.values(this.splitters)) {
            splitter.removeFromParent();
            splitter.dispose();
        }
    }

    layout(): void {
        const {
            mainView,
            holder,
            startScene,
            statusLine,
            panels,
            libraryDock,
            hierarchyDock,
            favoritesView,
            searchView,
            referenceView,
            transitionListView,
            testView,
        } = this.options;
        mainView.makeFullScreen();

        const availableWidth = Math.max(720, holder.width);
        const availableHeight = Math.max(420, holder.height);
        const leftGap = this.leftDockVisible ? DESKTOP_PANEL_GAP : 0;
        const rightGap = this.inspectorDockVisible ? DESKTOP_PANEL_GAP : 0;
        let leftWidth = this.leftDockVisible
            ? this.clamp(
                this.preferredLeftWidth ?? Math.floor(availableWidth * LEFT_PANEL_RATIO),
                LEFT_PANEL_MIN_WIDTH,
                LEFT_PANEL_MAX_WIDTH,
            )
            : 0;
        let rightWidth = this.inspectorDockVisible
            ? this.clamp(
                this.preferredRightWidth ?? Math.floor(availableWidth * RIGHT_PANEL_RATIO),
                RIGHT_PANEL_MIN_WIDTH,
                RIGHT_PANEL_MAX_WIDTH,
            )
            : 0;
        const documentSpaceDeficit = MIN_DOCUMENT_WIDTH
            - (availableWidth - leftWidth - rightWidth - leftGap - rightGap);
        if (documentSpaceDeficit > 0) {
            const rightReduction = Math.min(
                documentSpaceDeficit,
                Math.max(0, rightWidth - RIGHT_PANEL_MIN_WIDTH),
            );
            rightWidth -= rightReduction;
            const remainingDeficit = documentSpaceDeficit - rightReduction;
            if (remainingDeficit > 0 && this.leftDockVisible) {
                leftWidth = Math.max(LEFT_PANEL_MIN_WIDTH, leftWidth - remainingDeficit);
            }
        }
        const documentWidth = Math.max(
            MIN_DOCUMENT_WIDTH,
            availableWidth - leftWidth - rightWidth - leftGap - rightGap,
        );
        const documentX = holder.x + leftWidth + leftGap;
        const rightX = documentX + documentWidth + rightGap;
        const componentPreviewEnabled = true;
        const libraryHeight = this.clamp(
            this.preferredLibraryHeight ?? Math.floor(availableHeight * 0.38),
            MIN_LEFT_STACK_PANEL_HEIGHT,
            availableHeight
                - MIN_HIERARCHY_DOCK_HEIGHT
                - MIN_LEFT_STACK_PANEL_HEIGHT * (componentPreviewEnabled ? 1 : 0)
                - DESKTOP_PANEL_GAP * (componentPreviewEnabled ? 2 : 1),
        );
        const previewHeight = componentPreviewEnabled
            ? this.clamp(
                this.preferredPreviewHeight ?? Math.floor(availableHeight * 0.18),
                MIN_LEFT_STACK_PANEL_HEIGHT,
                availableHeight - libraryHeight - MIN_HIERARCHY_DOCK_HEIGHT - DESKTOP_PANEL_GAP * 2,
            )
            : 0;
        const hierarchyHeight = Math.max(
            MIN_HIERARCHY_DOCK_HEIGHT,
            availableHeight - libraryHeight - DESKTOP_PANEL_GAP
                - (componentPreviewEnabled ? previewHeight + DESKTOP_PANEL_GAP : 0),
        );
        const previewY = holder.y + libraryHeight + DESKTOP_PANEL_GAP + hierarchyHeight
            + (componentPreviewEnabled ? DESKTOP_PANEL_GAP : 0);

        const workspaceVisible = !startScene.visible;
        const libraryDockVisible = workspaceVisible
            && this.leftDockVisible
            && ["library", "favorites", "search"].includes(this.leftTopPanelMode);
        libraryDock.visible = libraryDockVisible;
        panels.library.visible = libraryDockVisible && this.leftTopPanelMode === "library";
        favoritesView.visible = libraryDockVisible && this.leftTopPanelMode === "favorites";
        searchView.visible = libraryDockVisible && this.leftTopPanelMode === "search";
        referenceView.visible = workspaceVisible
            && this.leftDockVisible
            && this.leftTopPanelMode === "reference";
        transitionListView.visible = workspaceVisible
            && this.leftDockVisible
            && this.leftTopPanelMode === "transition";
        hierarchyDock.visible = workspaceVisible && this.leftDockVisible;
        panels.hierarchy.visible = hierarchyDock.visible;
        panels.preview.visible = workspaceVisible && this.leftDockVisible && componentPreviewEnabled;
        panels.document.visible = workspaceVisible && !this.options.isTestActive();
        testView.visible = workspaceVisible && this.options.isTestActive();
        panels.inspector.visible = workspaceVisible && this.inspectorDockVisible;

        this.setBounds(libraryDock, holder.x, holder.y, leftWidth, libraryHeight);
        const libraryContent = libraryDock.getChild("content").asCom;
        libraryContent.setSize(Math.max(1, leftWidth - 2), Math.max(1, libraryHeight - 29));
        for (const panel of [panels.library, favoritesView, searchView]) {
            panel.setXY(0, 0);
            panel.setSize(libraryContent.width, libraryContent.height);
        }
        libraryDock.getChild("tab2").asList.selectedIndex = ["library", "favorites", "search"]
            .indexOf(this.leftTopPanelMode);
        this.setBounds(referenceView, holder.x, holder.y, leftWidth, libraryHeight);
        this.setBounds(transitionListView, holder.x, holder.y, leftWidth, libraryHeight);
        this.setBounds(
            hierarchyDock,
            holder.x,
            holder.y + libraryHeight + DESKTOP_PANEL_GAP,
            leftWidth,
            hierarchyHeight,
        );
        const hierarchyContent = hierarchyDock.getChild("content").asCom;
        hierarchyContent.setSize(Math.max(1, leftWidth - 2), Math.max(1, hierarchyHeight - 29));
        panels.hierarchy.setXY(0, 0);
        panels.hierarchy.setSize(hierarchyContent.width, hierarchyContent.height);
        this.setBounds(
            panels.preview,
            holder.x,
            previewY,
            leftWidth,
            availableHeight - (previewY - holder.y),
        );
        this.setBounds(panels.document, documentX, holder.y, documentWidth, availableHeight);
        this.setBounds(testView, documentX, holder.y, documentWidth, availableHeight);
        this.setBounds(panels.inspector, rightX, holder.y, rightWidth, availableHeight);
        this.layoutSplitters({
            workspaceVisible,
            componentPreviewEnabled,
            leftWidth,
            rightX,
            libraryHeight,
            previewY,
            availableHeight,
        });
        this.layoutPanelContents();
        this.options.afterLayout();
        this.setLayoutDebugAttributes();

        statusLine.setXY(holder.x, holder.y + availableHeight + 1);
        statusLine.setSize(availableWidth, 22);
    }

    cancelSplitterDrag(restore: boolean): boolean {
        const state = this.splitterDragState;
        if (!state) return false;
        if (restore) {
            if (state.kind === "left") this.preferredLeftWidth = state.startValue;
            else if (state.kind === "right") this.preferredRightWidth = state.startValue;
            else if (state.kind === "library") this.preferredLibraryHeight = state.startValue;
            else this.preferredPreviewHeight = state.startValue;
        }
        this.splitterDragState = null;
        Laya.stage.off(Laya.Event.MOUSE_MOVE, this, this.onSplitterMouseMove);
        Laya.stage.off(Laya.Event.MOUSE_UP, this, this.onSplitterMouseUp);
        if (restore) this.layout();
        return true;
    }

    toggleDock(dock: "left" | "inspector"): void {
        const { panels, libraryDock } = this.options;
        if (dock === "left") {
            if (this.leftDockVisible) this.preferredLeftWidth = libraryDock.width;
            this.leftDockVisible = !this.leftDockVisible;
        } else {
            if (this.inspectorDockVisible) this.preferredRightWidth = panels.inspector.width;
            this.inspectorDockVisible = !this.inspectorDockVisible;
        }
        this.layout();
        this.save();
        const visible = dock === "left" ? this.leftDockVisible : this.inspectorDockVisible;
        this.options.setStatus(
            `${dock === "left" ? "Left" : "Inspector"} dock ${visible ? "shown" : "hidden"}.`,
        );
    }

    restore(): void {
        try {
            const value = JSON.parse(this.readWorkspaceLocalStorage() || "null") as {
                leftWidth?: unknown;
                rightWidth?: unknown;
                libraryHeight?: unknown;
                previewHeight?: unknown;
                leftDockVisible?: unknown;
                inspectorDockVisible?: unknown;
                timelineVisible?: unknown;
                consoleVisible?: unknown;
            } | null;
            if (!value) return;
            if (Number.isFinite(value.leftWidth)) this.preferredLeftWidth = Number(value.leftWidth);
            if (Number.isFinite(value.rightWidth)) this.preferredRightWidth = Number(value.rightWidth);
            if (Number.isFinite(value.libraryHeight)) this.preferredLibraryHeight = Number(value.libraryHeight);
            if (Number.isFinite(value.previewHeight)) this.preferredPreviewHeight = Number(value.previewHeight);
            if (typeof value.leftDockVisible === "boolean") this.leftDockVisible = value.leftDockVisible;
            if (typeof value.inspectorDockVisible === "boolean") {
                this.inspectorDockVisible = value.inspectorDockVisible;
            }
            if (typeof value.timelineVisible === "boolean") this.timelineVisible = value.timelineVisible;
            if (typeof value.consoleVisible === "boolean") this.consoleVisible = value.consoleVisible;
            if (this.timelineVisible) this.consoleVisible = false;
        } catch {
            localStorage.removeItem(this.getWorkspaceLocalStorageKey());
        }
    }

    save(): void {
        try {
            const { panels, libraryDock } = this.options;
            localStorage.setItem(this.getWorkspaceLocalStorageKey(), JSON.stringify({
                leftWidth: this.preferredLeftWidth ?? libraryDock.width,
                rightWidth: this.preferredRightWidth ?? panels.inspector.width,
                libraryHeight: this.preferredLibraryHeight ?? libraryDock.height,
                previewHeight: this.preferredPreviewHeight ?? panels.preview.height,
                leftDockVisible: this.leftDockVisible,
                inspectorDockVisible: this.inspectorDockVisible,
                timelineVisible: this.timelineVisible,
                consoleVisible: this.consoleVisible,
            }));
        } catch {
            // Layout persistence is optional and must not block authoring.
        }
    }

    applyDefaults(): void {
        this.preferredLeftWidth = null;
        this.preferredRightWidth = null;
        this.preferredLibraryHeight = null;
        this.preferredPreviewHeight = null;
        this.leftDockVisible = true;
        this.inspectorDockVisible = true;
        this.timelineVisible = false;
        this.consoleVisible = false;
    }

    reset(): void {
        this.applyDefaults();
        try {
            localStorage.removeItem(this.getWorkspaceLocalStorageKey());
            if (this.options.getWorkspaceName() === DEFAULT_BROWSER_WORKSPACE_ID) {
                localStorage.removeItem(DESKTOP_LAYOUT_STORAGE_KEY);
            }
        } catch {
            // Layout persistence is optional and must not block reset.
        }
        this.layout();
        this.options.setStatus("Desktop layout reset to defaults.");
    }

    private createSplitter(name: string, kind: DockSplitterKind): fgui.GGraph {
        const splitter = new fgui.GGraph();
        splitter.name = name;
        splitter.drawRect(0, "#000000", "#505050");
        splitter.on(Laya.Event.MOUSE_DOWN, this, this.onSplitterMouseDown, [kind]);
        this.options.mainView.addChild(splitter);
        return splitter;
    }

    private layoutPanelContents(): void {
        const {
            panels,
            searchView,
            referenceView,
            transitionListView,
            timelineView,
            consoleView,
        } = this.options;
        const library = panels.library;
        const tree = library.getChild("treeView");
        const list = library.getChild("listView");
        const separator = library.getChild("sep");
        const slider = library.getChild("iconSize");
        const twoColumn = library.getChild("btnTwoColumn").asButton.selected;
        list.visible = separator.visible = slider.visible = twoColumn;
        tree.setSize(
            twoColumn ? Math.max(96, Math.round(library.width * 137 / 283)) : library.width,
            Math.max(1, library.height - tree.y),
        );
        if (twoColumn) {
            const listX = tree.width + separator.width;
            const sliderX = Math.max(0, listX - 3);
            list.setXY(listX, list.y);
            slider.setXY(sliderX, Math.max(27, library.height - slider.height));
            slider.setSize(Math.max(1, library.width - sliderX), slider.height);
            list.setSize(Math.max(96, library.width - listX), Math.max(1, slider.y - list.y));
            separator.setXY(tree.width, separator.y);
            separator.setSize(separator.width, Math.max(1, library.height - separator.y));
        }
        this.options.setDebugAttribute("data-fairy-editor-library-columns", twoColumn ? "two" : "one");

        const searchList = searchView.getChild("list");
        const searchSeparator = searchView.getChild("n12");
        const keyword = searchView.getChild("keyword");
        const find = searchView.getChild("find");
        const result = searchView.getChild("result");
        searchList.setSize(searchView.width, Math.max(1, searchView.height - 59));
        searchSeparator.setSize(searchView.width, searchSeparator.height);
        keyword.setSize(Math.max(80, searchView.width - 91), keyword.height);
        find.setXY(searchView.width - 61, find.y);
        result.setSize(Math.max(80, searchView.width - 52), result.height);

        const referenceList = referenceView.getChild("list");
        const referenceSeparator = referenceView.getChild("n12");
        const referenceSource = referenceView.getChild("source");
        const referenceFind = referenceView.getChild("find");
        const referenceResult = referenceView.getChild("result");
        referenceList.setSize(referenceView.width, Math.max(1, referenceView.height - 111));
        referenceSeparator.setSize(referenceView.width, referenceSeparator.height);
        referenceSource.setSize(Math.max(80, referenceView.width - 119), referenceSource.height);
        referenceFind.setXY(referenceView.width - 78, referenceFind.y);
        referenceResult.setSize(Math.max(80, referenceView.width - 30), referenceResult.height);

        transitionListView.getChild("list").setSize(
            transitionListView.width,
            Math.max(1, transitionListView.height - 27),
        );
        transitionListView.getChild("n30").setSize(transitionListView.width, 1);
        transitionListView.getChild("rename").setXY(transitionListView.width - 87, 4);
        transitionListView.getChild("duplicate").setXY(transitionListView.width - 62, 4);
        transitionListView.getChild("delete").setXY(transitionListView.width - 35, 4);

        const hierarchy = panels.hierarchy;
        hierarchy.getChild("list").setSize(hierarchy.width, Math.max(1, hierarchy.height - 25));

        const documentPanel = panels.document;
        const documentContainer = documentPanel.getChild("docContainer");
        const documentBackground = documentPanel.getChild("docBg");
        const bottomPanelVisible = this.timelineVisible || this.consoleVisible;
        const bottomPanelHeight = bottomPanelVisible
            ? Math.min(DESKTOP_TIMELINE_HEIGHT, Math.max(103, documentPanel.height - 220))
            : 0;
        const bottomPanelY = documentPanel.height - bottomPanelHeight;
        const canvasBottom = bottomPanelVisible
            ? bottomPanelY - DESKTOP_PANEL_GAP
            : documentPanel.height - 1;
        const canvasWidth = Math.max(1, documentPanel.width - documentContainer.x - 1);
        const canvasHeight = Math.max(1, canvasBottom - documentContainer.y);
        documentContainer.setSize(canvasWidth, canvasHeight);
        documentBackground.setSize(canvasWidth, canvasHeight);
        timelineView.visible = documentPanel.visible && this.timelineVisible;
        timelineView.setXY(documentContainer.x, bottomPanelY);
        timelineView.setSize(canvasWidth, bottomPanelHeight);
        consoleView.visible = documentPanel.visible && this.consoleVisible;
        consoleView.setXY(documentContainer.x, bottomPanelY);
        consoleView.setSize(canvasWidth, bottomPanelHeight);
        const consoleList = consoleView.getChild("list").asList;
        consoleList.setSize(canvasWidth, Math.max(1, bottomPanelHeight - 27));
        for (let index = 0; index < consoleList.numChildren; index += 1) {
            const item = consoleList.getChildAt(index);
            item.setSize(canvasWidth, item.height);
        }
        consoleView.getChild("n12").setSize(canvasWidth, 1);
        consoleView.getChild("btnCopy").setXY(canvasWidth - 56, 2);
        consoleView.getChild("btnClear").setXY(canvasWidth - 29, 2);
        documentPanel.getController("timelineMode").selectedIndex = this.timelineVisible ? 1 : 0;
        this.options.setDebugAttribute(
            "data-fairy-editor-timeline",
            `${this.timelineVisible ? "open" : "closed"}:${this.options.getSelectedTransitionName() || "none"}`,
        );
        this.options.setDebugAttribute(
            "data-fairy-editor-console",
            this.consoleVisible ? "open" : "closed",
        );
    }

    private layoutSplitters(layout: {
        workspaceVisible: boolean;
        componentPreviewEnabled: boolean;
        leftWidth: number;
        rightX: number;
        libraryHeight: number;
        previewY: number;
        availableHeight: number;
    }): void {
        const { holder, mainView } = this.options;
        const left = this.splitters.left;
        left.visible = layout.workspaceVisible && this.leftDockVisible;
        left.setXY(holder.x + layout.leftWidth, holder.y);
        left.setSize(DESKTOP_PANEL_GAP, layout.availableHeight);

        const right = this.splitters.right;
        right.visible = layout.workspaceVisible && this.inspectorDockVisible;
        right.setXY(layout.rightX - DESKTOP_PANEL_GAP, holder.y);
        right.setSize(DESKTOP_PANEL_GAP, layout.availableHeight);

        const library = this.splitters.library;
        library.visible = layout.workspaceVisible && this.leftDockVisible;
        library.setXY(holder.x, holder.y + layout.libraryHeight);
        library.setSize(layout.leftWidth, DESKTOP_PANEL_GAP);

        const preview = this.splitters.preview;
        preview.visible = layout.workspaceVisible && this.leftDockVisible && layout.componentPreviewEnabled;
        preview.setXY(holder.x, layout.previewY - DESKTOP_PANEL_GAP);
        preview.setSize(layout.leftWidth, DESKTOP_PANEL_GAP);

        for (const splitter of Object.values(this.splitters)) {
            mainView.setChildIndex(splitter, mainView.numChildren - 1);
        }
    }

    private onSplitterMouseDown(kind: DockSplitterKind, event: Laya.Event): void {
        if (event.button !== 0) return;
        event.stopPropagation();
        this.cancelSplitterDrag(false);
        const { panels, libraryDock } = this.options;
        this.splitterDragState = {
            kind,
            startStageX: event.stageX,
            startStageY: event.stageY,
            startValue: kind === "left"
                ? libraryDock.width
                : kind === "right"
                    ? panels.inspector.width
                    : kind === "library"
                        ? libraryDock.height
                        : panels.preview.height,
        };
        Laya.stage.on(Laya.Event.MOUSE_MOVE, this, this.onSplitterMouseMove);
        Laya.stage.on(Laya.Event.MOUSE_UP, this, this.onSplitterMouseUp);
        this.options.setDebugAttribute("data-fairy-editor-splitter", `${kind}:active`);
    }

    private onSplitterMouseMove(event: Laya.Event): void {
        const state = this.splitterDragState;
        if (!state) return;
        const { holder, panels, libraryDock } = this.options;
        const dx = event.stageX - state.startStageX;
        const dy = event.stageY - state.startStageY;
        const availableWidth = Math.max(720, holder.width);
        const availableHeight = Math.max(420, holder.height);
        if (state.kind === "left") {
            const max = Math.min(
                LEFT_PANEL_MAX_WIDTH,
                availableWidth - panels.inspector.width - MIN_DOCUMENT_WIDTH - DESKTOP_PANEL_GAP * 2,
            );
            this.preferredLeftWidth = this.clamp(
                state.startValue + dx,
                LEFT_PANEL_MIN_WIDTH,
                Math.max(LEFT_PANEL_MIN_WIDTH, max),
            );
        } else if (state.kind === "right") {
            const max = Math.min(
                RIGHT_PANEL_MAX_WIDTH,
                availableWidth - panels.library.width - MIN_DOCUMENT_WIDTH - DESKTOP_PANEL_GAP * 2,
            );
            this.preferredRightWidth = this.clamp(
                state.startValue - dx,
                RIGHT_PANEL_MIN_WIDTH,
                Math.max(RIGHT_PANEL_MIN_WIDTH, max),
            );
        } else if (state.kind === "library") {
            const componentPreviewEnabled = true;
            const max = availableHeight
                - (componentPreviewEnabled ? panels.preview.height : 0)
                - MIN_HIERARCHY_DOCK_HEIGHT
                - DESKTOP_PANEL_GAP * (componentPreviewEnabled ? 2 : 1);
            this.preferredLibraryHeight = this.clamp(
                state.startValue + dy,
                MIN_LEFT_STACK_PANEL_HEIGHT,
                Math.max(MIN_LEFT_STACK_PANEL_HEIGHT, max),
            );
        } else {
            const max = availableHeight
                - libraryDock.height
                - MIN_HIERARCHY_DOCK_HEIGHT
                - DESKTOP_PANEL_GAP * 2;
            this.preferredPreviewHeight = this.clamp(
                state.startValue - dy,
                MIN_LEFT_STACK_PANEL_HEIGHT,
                Math.max(MIN_LEFT_STACK_PANEL_HEIGHT, max),
            );
        }
        this.layout();
    }

    private onSplitterMouseUp(): void {
        const state = this.splitterDragState;
        if (!state) return;
        this.splitterDragState = null;
        Laya.stage.off(Laya.Event.MOUSE_MOVE, this, this.onSplitterMouseMove);
        Laya.stage.off(Laya.Event.MOUSE_UP, this, this.onSplitterMouseUp);
        this.save();
        const { panels } = this.options;
        this.options.setDebugAttribute(
            "data-fairy-editor-splitter",
            `${state.kind}:${Math.round(
                state.kind === "left"
                    ? this.options.libraryDock.width
                    : state.kind === "right"
                        ? panels.inspector.width
                        : state.kind === "library"
                            ? this.options.libraryDock.height
                            : panels.preview.height,
            )}`,
        );
    }

    private setLayoutDebugAttributes(): void {
        const { panels, hierarchyDock, libraryDock } = this.options;
        this.options.setDebugAttribute("data-fairy-editor-layout", "desktop_three_column");
        this.options.setDebugAttribute("data-fairy-editor-layout-library", this.formatBounds(libraryDock));
        this.options.setDebugAttribute("data-fairy-editor-layout-hierarchy", this.formatBounds(hierarchyDock));
        this.options.setDebugAttribute("data-fairy-editor-layout-preview", this.formatBounds(panels.preview));
        this.options.setDebugAttribute("data-fairy-editor-layout-document", this.formatBounds(panels.document));
        this.options.setDebugAttribute("data-fairy-editor-layout-inspector", this.formatBounds(panels.inspector));
        this.options.setDebugAttribute("data-fairy-editor-left-top-panel", this.leftTopPanelMode);
        this.options.setDebugAttribute(
            "data-fairy-editor-component-preview",
            this.options.getComponentPreviewEnabled() ? "enabled" : "disabled",
        );
        this.options.setDebugAttribute(
            "data-fairy-editor-docks",
            `left=${this.leftDockVisible ? "open" : "closed"},inspector=${this.inspectorDockVisible ? "open" : "closed"}`,
        );
    }

    private getWorkspaceLocalStorageKey(): string {
        return `${DESKTOP_LAYOUT_STORAGE_KEY}:${this.options.getWorkspaceName()}`;
    }

    private readWorkspaceLocalStorage(): string | null {
        const scoped = localStorage.getItem(this.getWorkspaceLocalStorageKey());
        if (scoped !== null) return scoped;
        return this.options.getWorkspaceName() === DEFAULT_BROWSER_WORKSPACE_ID
            ? localStorage.getItem(DESKTOP_LAYOUT_STORAGE_KEY)
            : null;
    }

    private setBounds(object: fgui.GObject, x: number, y: number, width: number, height: number): void {
        object.setXY(x, y);
        object.setSize(width, height);
    }

    private formatBounds(object: fgui.GObject): string {
        return [
            Math.round(object.x),
            Math.round(object.y),
            Math.round(object.width),
            Math.round(object.height),
        ].join(",");
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }
}
