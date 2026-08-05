import "./Main";

const stageConfig: Laya.IStageConfig = {
    scaleMode: "full",
    backgroundColor: "#383838",
    designWidth: 1334,
    designHeight: 750,
    alignV: "top",
    alignH: "left",
    screenMode: "none",
};

async function startEditor(): Promise<void> {
    Object.assign(Laya.PlayerConfig, { resolution: stageConfig });
    Object.assign(Laya.Config, {
        FPS: 60,
        isAntialias: true,
        useRetinalCanvas: false,
        isAlpha: false,
        defaultFont: "Arial",
        defaultFontSize: 20,
    });

    await Laya.init(stageConfig);

    const main = (window as any).$_main_ as (() => void) | undefined;
    if (!main) {
        throw new Error("FairyGUI editor entry $_main_ was not registered.");
    }
    main();
}

void startEditor().catch((error) => {
    console.error("[Vite] FairyGUI editor initialization failed.", error);
});
