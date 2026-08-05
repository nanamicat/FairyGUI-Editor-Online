import { EditorShell } from "./editor/EditorShell";
import { registerEditorUiExtensions } from "./editor/ui/EditorUiExtensions";

const { regClass } = Laya;

const EDITOR_PACKAGE_PATHS = ["resources/ui/Basic", "resources/ui/Builder"];
const MAIN_SCENE_SCRIPT_ASSET_ID = "7bad1742-6eed-4d8d-81c0-501dc5bf03d6";

let standaloneMainOwner: Laya.Sprite | undefined;
let standaloneMainScript: Main | undefined;

@regClass(MAIN_SCENE_SCRIPT_ASSET_ID)
export class Main extends Laya.Script {
    private editorShell?: EditorShell;
    private started = false;

    onStart(): void {
        if (this.started) {
            return;
        }
        this.started = true;
        this.bootFairyGui();
    }

    onDestroy(): void {
        this.editorShell?.dispose();
        this.editorShell = undefined;
    }

    private bootFairyGui(): void {
        if (!(window as any).fgui) {
            console.error("[FairyGUI Editor] FairyGUI runtime is not available. Check assets/fairygui/fairygui.js plugin settings.");
            return;
        }

        if (!fgui.GRoot.inst.displayObject.parent) {
            Laya.stage.addChild(fgui.GRoot.inst.displayObject);
        }

        this.configureFairyGui();
        this.showRuntimeProbe("FairyGUI runtime ready. Loading Basic/Builder packages from assets/resources/ui.");
        this.ensureRawInflate()
            .then(() => this.tryLoadEditorPackages())
            .catch((error) => {
                console.error("[FairyGUI Editor] rawinflate.min.js is required for compressed FairyGUI descriptions.", error);
                this.tryLoadEditorPackages();
            });
    }

    private configureFairyGui(): void {
        fgui.UIConfig.verticalScrollBar = "ui://Basic/ScrollBar_VT";
        fgui.UIConfig.horizontalScrollBar = "ui://Basic/ScrollBar_HZ";
        fgui.UIConfig.popupMenu = "ui://Basic/PopupMenu";
        fgui.UIConfig.popupMenu_seperator = "ui://Basic/MenuSeperator";
        fgui.UIConfig.tooltipsWin = "ui://Basic/TooltipsWin";
        fgui.UIConfig.buttonSound = "";
    }

    private ensureRawInflate(): Promise<void> {
        const win = window as any;
        if (win.Zlib && win.Zlib.RawInflate) {
            return Promise.resolve();
        }

        return this.loadScript("fairygui/rawinflate.min.js").then(() => {
            if (!win.Zlib?.RawInflate) throw new Error("rawinflate.min.js loaded without Zlib.RawInflate.");
        });
    }

    private loadScript(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = url;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load ${url}`));
            document.head.appendChild(script);
        });
    }

    private tryLoadEditorPackages(): void {
        fgui.UIPackage.loadPackage(
            EDITOR_PACKAGE_PATHS,
            Laya.Handler.create(this, this.onEditorPackagesLoaded),
            Laya.Handler.create(this, this.onEditorPackagesProgress, null, false),
        );
    }

    private onEditorPackagesProgress(progress: number): void {
        console.log(`[FairyGUI Editor] Loading editor packages: ${Math.round(progress * 100)}%`);
    }

    private onEditorPackagesLoaded(): void {
        const basicPackage = fgui.UIPackage.getByName("Basic");
        const builderPackage = fgui.UIPackage.getByName("Builder");

        if (!basicPackage || !builderPackage) {
            console.warn("[FairyGUI Editor] Editor packages were not loaded. Run npm run publish:editor-ui first.");
            return;
        }

        registerEditorUiExtensions();
        fgui.GRoot.inst.removeChildren(0, -1, true);
        const mainView = fgui.UIPackage.createObject("Builder", "MainView").asCom;
        mainView.makeFullScreen();
        fgui.GRoot.inst.addChild(mainView);
        this.editorShell = new EditorShell(mainView);

        console.log("[FairyGUI Editor] Editor packages loaded and Builder/MainView shell is mounted.");
    }

    private showRuntimeProbe(message: string): void {
        const root = fgui.GRoot.inst;
        root.removeChildren(0, -1, true);

        const panel = new fgui.GComponent();
        panel.name = "runtimeProbe";
        panel.setSize(460, 108);
        panel.setXY(16, 16);

        const background = new fgui.GGraph();
        background.setSize(460, 108);
        background.drawRect(1, "#506070", "#202833", [6, 6, 6, 6]);
        panel.addChild(background);

        const title = new fgui.GTextField();
        title.text = "FairyGUI Editor Online";
        title.fontSize = 18;
        title.color = "#ffffff";
        title.singleLine = true;
        title.setXY(16, 14);
        title.setSize(420, 28);
        panel.addChild(title);

        const detail = new fgui.GTextField();
        detail.text = message;
        detail.fontSize = 12;
        detail.color = "#b7c0cc";
        detail.singleLine = false;
        detail.autoSize = fgui.AutoSizeType.None;
        detail.setXY(16, 50);
        detail.setSize(420, 40);
        panel.addChild(detail);

        root.addChild(panel);
        console.log("[FairyGUI Editor] FairyGUI GRoot mounted.", {
            stageChildren: Laya.stage.numChildren,
            rootChildren: root.numChildren,
        });
    }
}

(window as any).$_main_ = (): void => {
    if (standaloneMainScript) {
        standaloneMainScript.onStart();
        return;
    }

    standaloneMainOwner = new Laya.Sprite();
    standaloneMainOwner.name = "FairyGUIEditorOnlineRoot";
    Laya.stage.addChild(standaloneMainOwner);

    standaloneMainScript = standaloneMainOwner.addComponent(Main) as Main;
    standaloneMainScript.onStart();
};
