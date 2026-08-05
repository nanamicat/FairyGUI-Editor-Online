import { inspectComponent } from "../commands/HighRiskAuthoringTransactions";
import type { EditorComponentSelector } from "../model/EditorCommand";
import type { ProjectSnapshotComponent, ProjectSnapshotPackage } from "../model/ProjectSnapshot";
import {
    readPublishedTestAdaptationSettings,
    resolvePublishedTestViewport,
    type PublishedTestAdaptationSettings,
    type PublishedTestViewportState,
} from "./PublishedTestViewport";

const PUBLISHED_TEST_VIEW_STORAGE_KEY = "fairygui-editor-online.test-view.v1";

type PublishedTestItemData =
    | { kind: "controller"; name: string; pageCount: number }
    | { kind: "transition"; name: string }
    | { kind: "popup" }
    | { kind: "tooltips" };

export type PublishedTestControllerContext = {
    getSelectedPackage(): ProjectSnapshotPackage | null;
    getSelectedComponent(): ProjectSnapshotComponent | null;
    getSelectedComponentSelector(): EditorComponentSelector | null;
    getWorkingProject(): unknown;
    isDirty(): boolean;
    requiresRuntimePublish(): boolean;
    setToolbarActive(active: boolean): void;
    requestLayout(): void;
    setDebugAttribute(name: string, value: string): void;
    setStatus(message: string): void;
};

export class PublishedTestController {
    private readonly container: fgui.GComponent;
    private readonly viewportHost = new fgui.GComponent();
    private readonly viewportFrame = new fgui.GGraph();
    private previewRoot: fgui.GComponent | null = null;
    private runtimeAdaptationSettings: PublishedTestAdaptationSettings | null = null;
    private viewportState: PublishedTestViewportState = {
        adaptation: true,
        deviceName: "",
        orientation: "landscape",
        screenMatch: "",
    };
    private previewOriginalSize = { width: 1, height: 1 };
    private debugMenu: fgui.PopupMenu | null = null;
    private tooltipsVisible = false;
    private active = false;

    constructor(
        private readonly view: fgui.GComponent,
        private readonly context: PublishedTestControllerContext,
    ) {
        this.container = view.getChild("docContainer").asCom;
        this.configure();
        this.bind();
    }

    isActive(): boolean {
        return this.active;
    }

    start(): void {
        const pkg = this.context.getSelectedPackage();
        const component = this.context.getSelectedComponent();
        if (!pkg || !component) {
            this.context.setStatus("Runtime test unavailable: open a component first.");
            return;
        }
        if (this.context.isDirty()) {
            this.context.setStatus("Runtime test blocked: Save and Publish the current authoring changes first.");
            return;
        }
        if (this.context.requiresRuntimePublish()) {
            this.context.setStatus("Runtime test blocked: Publish the saved workspace first.");
            return;
        }
        if (!fgui.UIPackage.getByName(pkg.name)) {
            this.context.setStatus(`Runtime test unavailable: published package ${pkg.name} is not loaded.`);
            return;
        }

        const created = fgui.UIPackage.createObject(pkg.name, component.name);
        if (!created?.asCom) {
            created?.dispose();
            this.context.setStatus(`Runtime test unavailable: ${pkg.name}/${component.name} is not a published component.`);
            return;
        }

        this.clear();
        this.previewRoot = created.asCom;
        this.previewRoot.name = "desktopPublishedTestRoot";
        this.previewOriginalSize = {
            width: Math.max(1, this.previewRoot.width),
            height: Math.max(1, this.previewRoot.height),
        };
        this.runtimeAdaptationSettings = readPublishedTestAdaptationSettings(this.context.getWorkingProject());
        this.syncViewportControls();
        this.viewportHost.addChild(this.previewRoot);
        this.viewportHost.visible = true;
        this.active = true;
        this.context.setToolbarActive(true);
        this.populateControllers();
        this.context.requestLayout();
        this.context.setDebugAttribute("data-fairy-editor-test-mode", "running");
        this.context.setDebugAttribute("data-fairy-editor-test-component", `${pkg.id}/${component.id}`);
        this.context.setDebugAttribute("data-fairy-editor-test-runtime", "published");
        this.context.setStatus(`Runtime test started: ${pkg.name}/${component.name}. F5 reloads; Escape exits.`);
    }

    reload(): void {
        this.stop(false);
        this.start();
    }

    stop(updateStatus = true): void {
        if (!this.active && !this.previewRoot) return;
        this.clear();
        this.active = false;
        this.context.setToolbarActive(false);
        this.context.requestLayout();
        this.context.setDebugAttribute("data-fairy-editor-test-mode", "stopped");
        this.context.setDebugAttribute("data-fairy-editor-test-component", "");
        this.context.setDebugAttribute("data-fairy-editor-test-runtime", "");
        this.context.setDebugAttribute("data-fairy-editor-test-viewport", "");
        if (updateStatus) this.context.setStatus("Runtime test stopped.");
    }

    layout(): void {
        this.layoutControls();
        this.layoutPreview();
    }

    dispose(): void {
        this.stop(false);
        this.unbind();
        this.hideOverlays();
    }

    private configure(): void {
        for (const childName of [
            "adaptation", "device", "screenMatch", "contentScaler", "landscape", "portrait",
        ]) {
            this.view.getChild(childName).visible = true;
        }
        this.view.getChild("n38").visible = false;
        this.view.getChild("n39").visible = false;
        this.viewportHost.name = "desktopPublishedTestViewport";
        this.viewportHost.touchable = true;
        this.viewportFrame.name = "desktopPublishedTestViewportFrame";
        this.viewportFrame.touchable = false;
        this.viewportFrame.drawRect(1, "#606060", "#202020");
        this.viewportHost.addChild(this.viewportFrame);
        this.container.addChild(this.viewportHost);
        this.viewportHost.visible = false;
        this.view.getChild("controllerList").asList.selectionMode = fgui.ListSelectionMode.None;
        this.view.getChild("contentScaler").tooltips = "Open Project Settings for adaptation settings.";
        this.loadViewportState();
    }

    private bind(): void {
        this.view.getChild("controllerList").asList.on(fgui.Events.CLICK_ITEM, this, this.onControllerClick);
        for (const childName of ["adaptation", "device", "screenMatch"]) {
            this.view.getChild(childName).on(fgui.Events.STATE_CHANGED, this, this.onViewportControlChanged);
        }
        this.view.getController("orientation").on(fgui.Events.STATE_CHANGED, this, this.onViewportControlChanged);
    }

    private unbind(): void {
        this.view.getChild("controllerList").asList.off(fgui.Events.CLICK_ITEM, this, this.onControllerClick);
        for (const childName of ["adaptation", "device", "screenMatch"]) {
            this.view.getChild(childName).off(fgui.Events.STATE_CHANGED, this, this.onViewportControlChanged);
        }
        this.view.getController("orientation").off(fgui.Events.STATE_CHANGED, this, this.onViewportControlChanged);
    }

    private layoutControls(): void {
        const width = this.view.width;
        const landscape = this.view.getChild("landscape");
        const portrait = this.view.getChild("portrait");
        const screenMatch = this.view.getChild("screenMatch");
        const device = this.view.getChild("device");
        this.view.getChild("adaptation").setXY(10, 6);
        this.view.getChild("contentScaler").setXY(64, 6);
        screenMatch.setXY(92, 6);
        screenMatch.setSize(Math.min(142, Math.max(88, Math.floor((width - 176) * 0.45))), 20);
        landscape.setXY(Math.max(294, width - 58), 3);
        portrait.setXY(Math.max(320, width - 32), 3);
        device.setXY(screenMatch.x + screenMatch.width + 8, 6);
        device.setSize(Math.min(197, Math.max(90, landscape.x - device.x - 8)), 20);
    }

    private clear(): void {
        this.hideOverlays();
        if (this.previewRoot?.parent === this.viewportHost) {
            this.viewportHost.removeChild(this.previewRoot, true);
        } else {
            this.previewRoot?.dispose();
        }
        this.previewRoot = null;
        this.viewportHost.visible = false;
        this.runtimeAdaptationSettings = null;
        this.view.getChild("controllerList").asList.removeChildrenToPool();
    }

    private populateControllers(): void {
        const list = this.view.getChild("controllerList").asList;
        list.removeChildrenToPool();
        const selector = this.context.getSelectedComponentSelector();
        const inspection = selector ? inspectComponent(this.context.getWorkingProject(), selector) : null;
        for (const controller of inspection?.controllers || []) {
            const item = list.addItemFromPool().asButton;
            item.title = controller.name;
            item.data = {
                kind: "controller",
                name: controller.name,
                pageCount: controller.pageCount,
            } satisfies PublishedTestItemData;
        }
        for (const transition of inspection?.transitions || []) {
            const item = list.addItemFromPool().asButton;
            item.title = `Play ${transition.name}`;
            item.data = { kind: "transition", name: transition.name } satisfies PublishedTestItemData;
        }
        const popup = list.addItemFromPool().asButton;
        popup.title = "Popup";
        popup.data = { kind: "popup" } satisfies PublishedTestItemData;
        const tooltips = list.addItemFromPool().asButton;
        tooltips.title = "Tooltips";
        tooltips.data = { kind: "tooltips" } satisfies PublishedTestItemData;
        list.visible = true;
    }

    private onControllerClick(itemObject: fgui.GObject): void {
        const data = itemObject.data as PublishedTestItemData | null;
        if (data?.kind === "controller") {
            const controller = this.previewRoot?.getController(data.name);
            if (!controller || data.pageCount === 0) return;
            controller.selectedIndex = (controller.selectedIndex + 1) % data.pageCount;
            itemObject.asButton.title = `${data.name}: Page ${controller.selectedIndex + 1}`;
            this.context.setDebugAttribute("data-fairy-editor-test-controller", `${data.name}:${controller.selectedIndex}`);
            return;
        }
        if (data?.kind === "transition") {
            this.previewRoot?.getTransition(data.name)?.play();
            this.context.setDebugAttribute("data-fairy-editor-test-transition", data.name);
            this.context.setStatus(`Runtime test transition played: ${data.name}.`);
            return;
        }
        if (data?.kind === "popup") {
            this.showPopup(itemObject);
            return;
        }
        if (data?.kind === "tooltips") this.toggleTooltips(itemObject);
    }

    private layoutPreview(): void {
        const root = this.previewRoot;
        const settings = this.runtimeAdaptationSettings;
        if (!root || !settings) return;
        const viewport = resolvePublishedTestViewport(
            settings,
            this.viewportState,
            this.previewOriginalSize.width,
            this.previewOriginalSize.height,
        );
        root.setScale(1, 1);
        root.setSize(viewport.contentWidth, viewport.contentHeight);
        const renderScale = Math.min(
            1,
            Math.max(1, this.container.width - 24) / viewport.viewportWidth,
            Math.max(1, this.container.height - 24) / viewport.viewportHeight,
        );
        const viewportWidth = Math.max(1, Math.floor(viewport.viewportWidth * renderScale));
        const viewportHeight = Math.max(1, Math.floor(viewport.viewportHeight * renderScale));
        this.viewportHost.setSize(viewportWidth, viewportHeight);
        this.viewportHost.setXY(
            Math.max(0, Math.floor((this.container.width - viewportWidth) / 2)),
            Math.max(0, Math.floor((this.container.height - viewportHeight) / 2)),
        );
        this.viewportHost.displayObject.scrollRect = new Laya.Rectangle(0, 0, viewportWidth, viewportHeight);
        this.viewportFrame.setSize(viewportWidth, viewportHeight);
        root.setScale(renderScale, renderScale);
        root.setXY(
            Math.floor(viewport.contentX * renderScale),
            Math.floor(viewport.contentY * renderScale),
        );
        this.context.setDebugAttribute("data-fairy-editor-test-device", viewport.device.name);
        this.context.setDebugAttribute("data-fairy-editor-test-orientation", this.viewportState.orientation);
        this.context.setDebugAttribute("data-fairy-editor-test-screen-match", this.viewportState.screenMatch || "none");
        this.context.setDebugAttribute("data-fairy-editor-test-adaptation", this.viewportState.adaptation ? "on" : "off");
        this.context.setDebugAttribute(
            "data-fairy-editor-test-viewport",
            `${viewport.viewportWidth}x${viewport.viewportHeight}@${viewport.scaleFactor.toFixed(4)}`,
        );
    }

    private onViewportControlChanged(): void {
        if (!this.active) return;
        const screenMatch = this.view.getChild("screenMatch").asComboBox.value;
        this.viewportState = {
            adaptation: this.view.getChild("adaptation").asButton.selected,
            deviceName: this.view.getChild("device").asComboBox.value,
            orientation: this.view.getController("orientation").selectedIndex === 1 ? "portrait" : "landscape",
            screenMatch: screenMatch === "FitSize"
                || screenMatch === "FitHeightAndSetCenter"
                || screenMatch === "FitWidthAndSetMiddle"
                ? screenMatch
                : "",
        };
        this.saveViewportState();
        this.layoutPreview();
        this.context.setStatus(`Runtime test viewport: ${this.viewportState.deviceName}, ${this.viewportState.orientation}.`);
    }

    private syncViewportControls(): void {
        const settings = this.runtimeAdaptationSettings;
        if (!settings) return;
        const device = this.view.getChild("device").asComboBox;
        device.items = settings.devices.map((item) => `${item.name} (${item.resolutionX}x${item.resolutionY})`);
        device.values = settings.devices.map((item) => item.name);
        if (!device.values.includes(this.viewportState.deviceName)) this.viewportState.deviceName = device.values[0] || "";
        device.value = this.viewportState.deviceName;
        this.view.getChild("adaptation").asButton.selected = this.viewportState.adaptation;
        this.view.getChild("screenMatch").asComboBox.value = this.viewportState.screenMatch;
        this.view.getController("orientation").setSelectedIndex(this.viewportState.orientation === "portrait" ? 1 : 0);
        this.view.getChild("contentScaler").tooltips = settings.designResolutionX > 0 && settings.designResolutionY > 0
            ? `Published design resolution: ${settings.designResolutionX}x${settings.designResolutionY}. Open Project Settings.`
            : "Published design resolution is unset. Open Project Settings.";
    }

    private loadViewportState(): void {
        try {
            const saved = JSON.parse(localStorage.getItem(PUBLISHED_TEST_VIEW_STORAGE_KEY) || "null") as Partial<PublishedTestViewportState> | null;
            if (!saved) return;
            this.viewportState = {
                adaptation: saved.adaptation !== false,
                deviceName: typeof saved.deviceName === "string" ? saved.deviceName : "",
                orientation: saved.orientation === "portrait" ? "portrait" : "landscape",
                screenMatch: saved.screenMatch === "FitSize"
                    || saved.screenMatch === "FitHeightAndSetCenter"
                    || saved.screenMatch === "FitWidthAndSetMiddle"
                    ? saved.screenMatch
                    : "",
            };
        } catch {
            localStorage.removeItem(PUBLISHED_TEST_VIEW_STORAGE_KEY);
        }
    }

    private saveViewportState(): void {
        localStorage.setItem(PUBLISHED_TEST_VIEW_STORAGE_KEY, JSON.stringify(this.viewportState));
    }

    private showPopup(anchor: fgui.GObject): void {
        this.debugMenu?.dispose();
        const menu = new fgui.PopupMenu();
        menu.addItem(`Device: ${this.viewportState.deviceName}`);
        menu.addItem(`Orientation: ${this.viewportState.orientation}`);
        menu.addItem(`Screen match: ${this.viewportState.screenMatch || "none"}`);
        this.debugMenu = menu;
        menu.show(anchor);
        this.context.setDebugAttribute("data-fairy-editor-test-popup", "open");
        this.context.setStatus("Runtime test popup opened; click outside to dismiss.");
    }

    private toggleTooltips(anchor: fgui.GObject): void {
        this.tooltipsVisible = !this.tooltipsVisible;
        if (this.tooltipsVisible) {
            fgui.GRoot.inst.showTooltips(`Runtime tooltip: ${this.viewportState.deviceName}`);
            anchor.asButton.title = "Hide Tooltips";
        } else {
            fgui.GRoot.inst.hideTooltips();
            anchor.asButton.title = "Tooltips";
        }
        this.context.setDebugAttribute("data-fairy-editor-test-tooltips", this.tooltipsVisible ? "visible" : "hidden");
        this.context.setStatus(`Runtime test tooltips ${this.tooltipsVisible ? "shown" : "hidden"}.`);
    }

    private hideOverlays(): void {
        if (this.debugMenu) {
            fgui.GRoot.inst.hidePopup(this.debugMenu.contentPane);
            this.debugMenu.dispose();
            this.debugMenu = null;
        }
        fgui.GRoot.inst.hideTooltips();
        this.tooltipsVisible = false;
        this.context.setDebugAttribute("data-fairy-editor-test-popup", "closed");
        this.context.setDebugAttribute("data-fairy-editor-test-tooltips", "hidden");
    }
}
