export interface PublishedTestDevice {
    name: string;
    resolutionX: number;
    resolutionY: number;
}

export interface PublishedTestAdaptationSettings {
    designResolutionX: number;
    designResolutionY: number;
    scaleMode: string;
    screenMathMode: string;
    devices: PublishedTestDevice[];
}

export interface PublishedTestViewportState {
    adaptation: boolean;
    deviceName: string;
    orientation: "landscape" | "portrait";
    screenMatch: "" | "FitSize" | "FitHeightAndSetCenter" | "FitWidthAndSetMiddle";
}

export interface PublishedTestViewportLayout {
    device: PublishedTestDevice;
    scaleFactor: number;
    viewportWidth: number;
    viewportHeight: number;
    contentX: number;
    contentY: number;
    contentWidth: number;
    contentHeight: number;
}

const DEFAULT_DEVICES: PublishedTestDevice[] = [
    { name: "Phone 720p", resolutionX: 1280, resolutionY: 720 },
    { name: "Phone 1080p", resolutionX: 1920, resolutionY: 1080 },
    { name: "Phone 1440p", resolutionX: 2560, resolutionY: 1440 },
    { name: "Tablet 4:3", resolutionX: 2048, resolutionY: 1536 },
    { name: "Tablet 16:10", resolutionX: 1920, resolutionY: 1200 },
];

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function finitePositive(value: unknown): number | null {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function readDevice(value: unknown): PublishedTestDevice | null {
    const candidate = record(value);
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const resolutionX = finitePositive(candidate.resolutionX);
    const resolutionY = finitePositive(candidate.resolutionY);
    return name && resolutionX && resolutionY ? { name, resolutionX, resolutionY } : null;
}

export function readPublishedTestAdaptationSettings(project: unknown): PublishedTestAdaptationSettings {
    const adaptation = record(record(project).settings).adaptation;
    const settings = record(adaptation);
    const customDevices = Array.isArray(settings.devices)
        ? settings.devices.map(readDevice).filter((device): device is PublishedTestDevice => Boolean(device))
        : [];
    const names = new Set(customDevices.map((device) => device.name));
    return {
        designResolutionX: finitePositive(settings.designResolutionX) || 0,
        designResolutionY: finitePositive(settings.designResolutionY) || 0,
        scaleMode: typeof settings.scaleMode === "string" ? settings.scaleMode : "ConstantPixelSize",
        screenMathMode: typeof settings.screenMathMode === "string"
            ? settings.screenMathMode
            : "MatchWidthOrHeight",
        devices: [...customDevices, ...DEFAULT_DEVICES.filter((device) => !names.has(device.name))],
    };
}

export function resolvePublishedTestViewport(
    settings: PublishedTestAdaptationSettings,
    state: PublishedTestViewportState,
    originalWidth: number,
    originalHeight: number,
): PublishedTestViewportLayout {
    const device = settings.devices.find((candidate) => candidate.name === state.deviceName)
        || settings.devices[0]
        || DEFAULT_DEVICES[0];
    const landscape = state.orientation === "landscape";
    const deviceWidth = landscape ? Math.max(device.resolutionX, device.resolutionY) : Math.min(device.resolutionX, device.resolutionY);
    const deviceHeight = landscape ? Math.min(device.resolutionX, device.resolutionY) : Math.max(device.resolutionX, device.resolutionY);
    let scaleFactor = 1;
    if (
        state.adaptation
        && settings.scaleMode === "ScaleWithScreenSize"
        && settings.designResolutionX > 0
        && settings.designResolutionY > 0
    ) {
        const designWidth = landscape
            ? Math.max(settings.designResolutionX, settings.designResolutionY)
            : Math.min(settings.designResolutionX, settings.designResolutionY);
        const designHeight = landscape
            ? Math.min(settings.designResolutionX, settings.designResolutionY)
            : Math.max(settings.designResolutionX, settings.designResolutionY);
        const widthScale = deviceWidth / designWidth;
        const heightScale = deviceHeight / designHeight;
        scaleFactor = settings.screenMathMode === "MatchWidth"
            ? widthScale
            : settings.screenMathMode === "MatchHeight"
                ? heightScale
                : Math.min(widthScale, heightScale);
    }
    const viewportWidth = state.adaptation ? Math.ceil(deviceWidth / scaleFactor) : Math.max(1, originalWidth);
    const viewportHeight = state.adaptation ? Math.ceil(deviceHeight / scaleFactor) : Math.max(1, originalHeight);
    let contentWidth = Math.max(1, originalWidth);
    let contentHeight = Math.max(1, originalHeight);
    let contentX = Math.floor((viewportWidth - contentWidth) / 2);
    let contentY = Math.floor((viewportHeight - contentHeight) / 2);
    if (state.screenMatch === "FitSize") {
        contentWidth = viewportWidth;
        contentHeight = viewportHeight;
        contentX = 0;
        contentY = 0;
    } else if (state.screenMatch === "FitWidthAndSetMiddle") {
        contentWidth = viewportWidth;
        contentX = 0;
    } else if (state.screenMatch === "FitHeightAndSetCenter") {
        contentHeight = viewportHeight;
        contentY = 0;
    }
    return {
        device,
        scaleFactor,
        viewportWidth,
        viewportHeight,
        contentX,
        contentY,
        contentWidth,
        contentHeight,
    };
}
