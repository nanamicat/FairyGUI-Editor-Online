import { findResource } from "../commands/AuthoringTransactionSupport";
import { parseMovieClipJta, type MovieClipJta } from "../commands/MovieClipJtaCodec";
import type {
    ProjectSnapshotComponent,
    ProjectSnapshotPackage,
    ProjectSnapshotResource,
} from "../model/ProjectSnapshot";

export class ResourcePreviewController {
    private readonly desc: fgui.GTextField;
    private readonly playButton: fgui.GButton;
    private readonly optionButton: fgui.GObject;
    private readonly host = new fgui.GComponent();
    private readonly loader = new fgui.GLoader();
    private active: { packageId: string; resourceId: string } | null = null;
    private movieClip: MovieClipJta | null = null;
    private frameIndex = 0;
    private frameDirection: 1 | -1 = 1;
    private repeated = false;
    private timer: number | null = null;
    private audio: HTMLAudioElement | null = null;
    private urls: string[] = [];
    private readonly externalUrls = new Map<string, number>();
    private componentPreview: fgui.GObject | null = null;
    private optionsMenu: fgui.PopupMenu | null = null;
    private componentRevision = 0;
    private activeComponent: {
        projectId: string;
        pkg: ProjectSnapshotPackage;
        component: ProjectSnapshotComponent;
    } | null = null;

    constructor(
        private readonly panel: fgui.GComponent,
        private readonly getWorkingProject: () => unknown,
        private readonly createComponentPreview: (
            projectId: string,
            packageName: string,
            componentName: string,
        ) => Promise<fgui.GObject | null>,
        private readonly getComponentPreviewEnabled: () => boolean,
        private readonly setComponentPreviewEnabled: (enabled: boolean) => void,
        private readonly setDebugAttribute: (name: string, value: string) => void,
        private readonly setStatus: (message: string) => void,
    ) {
        this.desc = panel.getChild("desc").asTextField;
        this.playButton = panel.getChild("play").asButton;
        this.optionButton = panel.getChild("option");
        const holder = panel.getChild("holder");
        this.host.name = "resourcePreviewHost";
        this.host.touchable = false;
        this.host.setXY(holder.x, holder.y);
        this.host.setSize(holder.width, holder.height);
        this.host.addRelation(holder, fgui.RelationType.Left_Left);
        this.host.addRelation(holder, fgui.RelationType.Top_Top);
        this.host.addRelation(holder, fgui.RelationType.Size);
        this.host.on(fgui.Events.SIZE_CHANGED, this, this.renderCurrent);
        this.loader.name = "resourcePreviewLoader";
        this.loader.touchable = false;
        this.loader.fill = fgui.LoaderFillType.Scale;
        this.loader.shrinkOnly = true;
        this.loader.align = "center";
        this.loader.verticalAlign = "middle";
        this.host.addChild(this.loader);
        this.host.visible = false;
        panel.addChild(this.host);
        this.optionButton.asButton.onClick(this, this.showOptionsMenu);
    }

    matches(packageId: string, resourceId: string): boolean {
        return this.active?.packageId === packageId && this.active.resourceId === resourceId;
    }

    show(packageId: string, resource: ProjectSnapshotResource): void {
        this.resetMedia();
        this.activeComponent = null;
        this.active = { packageId, resourceId: resource.id };
        this.playButton.visible = false;
        this.playButton.selected = false;
        this.optionButton.visible = false;
        this.host.visible = false;

        const liveResource = findResource(this.getWorkingProject(), { packageId, resourceId: resource.id });
        const bytes = liveResource?.sourceBytes;
        const dimensions = liveResource?.dimensions;
        const size = this.formatSize(
            resource.width ?? dimensions?.width,
            resource.height ?? dimensions?.height,
        );
        const label = `${resource.name || resource.id}${size ? ` ${size}` : ""}`;

        try {
            if (resource.type === "MovieClipResource" && bytes instanceof Uint8Array) {
                this.showMovieClip(bytes);
                this.desc.text = `${label} · JTA · ${this.movieClip?.frames.length || 0} frames`;
            } else if (resource.type === "FontResource") {
                const textureId = String(
                    (liveResource?.metadata as { textureId?: unknown } | null | undefined)?.textureId || "",
                );
                const texture = textureId
                    ? findResource(this.getWorkingProject(), { packageId, resourceId: textureId })
                    : null;
                if (!(texture?.sourceBytes instanceof Uint8Array)) throw new Error("bitmap font texture is unavailable");
                this.showImage(texture.sourceBytes, texture.fileName || "");
                this.desc.text = `${label} · Bitmap font`;
            } else if (resource.type === "SoundResource" && bytes instanceof Uint8Array) {
                this.showSound(bytes, resource.fileName);
                this.desc.text = `${label} · Sound`;
            } else if (bytes instanceof Uint8Array && this.showImage(bytes, resource.fileName)) {
                this.desc.text = `${label} · ${resource.type === "ImageResource" ? "Image" : resource.type}`;
            } else {
                throw new Error("preview bytes are unavailable or unsupported");
            }
            this.setDebugAttribute(
                "data-fairy-editor-resource-preview",
                `${resource.type}:${packageId}/${resource.id}`,
            );
            this.setStatus(`Previewing resource ${resource.name || resource.id}.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.resetMedia();
            this.host.visible = false;
            this.playButton.visible = false;
            this.desc.text = `${label} · Preview unavailable`;
            this.setDebugAttribute("data-fairy-editor-resource-preview", `unavailable:${packageId}/${resource.id}`);
            this.setStatus(`Resource preview unavailable: ${message}.`);
        }
    }

    showComponent(
        projectId: string,
        pkg: ProjectSnapshotPackage,
        component: ProjectSnapshotComponent,
    ): void {
        this.resetMedia();
        this.activeComponent = { projectId, pkg, component };
        const revision = this.componentRevision;
        this.active = { packageId: pkg.id, resourceId: component.id };
        this.playButton.visible = false;
        this.optionButton.visible = true;
        this.optionButton.tooltips = this.getComponentPreviewEnabled() ? "关闭组件缩略预览" : "开启组件缩略预览";
        this.host.visible = false;
        this.desc.text = `${pkg.name}/${component.name} ${component.width}x${component.height}`;
        this.setDebugAttribute("data-fairy-editor-resource-preview", `Component:${pkg.id}/${component.id}`);
        this.setStatus(`Previewing component ${component.name || component.id}.`);
        if (!this.getComponentPreviewEnabled()) {
            this.desc.text += " · Preview disabled";
            return;
        }
        void this.createComponentPreview(projectId, pkg.name, component.name).then((preview) => {
            if (
                !preview
                || revision !== this.componentRevision
                || !this.matches(pkg.id, component.id)
            ) {
                preview?.dispose();
                if (!preview && revision === this.componentRevision) {
                    this.desc.text = `${pkg.name}/${component.name} ${component.width}x${component.height} · Preview unavailable`;
                }
                return;
            }
            if (preview.width <= 0 || preview.height <= 0) {
                preview.setSize(Math.max(1, component.width), Math.max(1, component.height));
            }
            preview.touchable = false;
            this.componentPreview = preview;
            this.loader.visible = false;
            this.host.addChild(preview);
            this.host.visible = true;
            this.renderCurrent();
        });
    }

    play(): boolean {
        if (!this.audio) return false;
        if (!this.audio.paused) {
            this.audio.pause();
            this.playButton.selected = false;
            return true;
        }
        void this.audio.play().then(() => {
            this.playButton.selected = true;
        }).catch((error) => {
            this.playButton.selected = false;
            this.setStatus(`Sound preview failed: ${error instanceof Error ? error.message : String(error)}.`);
        });
        return true;
    }

    openWithBrowser(packageId: string, resource: ProjectSnapshotResource): boolean {
        const liveResource = findResource(this.getWorkingProject(), { packageId, resourceId: resource.id });
        if (!(liveResource?.sourceBytes instanceof Uint8Array)) {
            this.setStatus(`Resource open unavailable: ${resource.name || resource.id} is not hydrated.`);
            return false;
        }
        const mimeType = resource.type === "SoundResource"
            ? detectSoundMimeType(liveResource.sourceBytes, resource.fileName)
            : detectImageMimeType(liveResource.sourceBytes, resource.fileName);
        const url = URL.createObjectURL(new Blob(
            [new Uint8Array(liveResource.sourceBytes)],
            { type: mimeType || "application/octet-stream" },
        ));
        const opened = window.open(url, "_blank");
        if (!opened) {
            URL.revokeObjectURL(url);
            this.setStatus("Resource open was blocked by the browser.");
            return false;
        }
        opened.opener = null;
        const timer = window.setTimeout(() => {
            URL.revokeObjectURL(url);
            this.externalUrls.delete(url);
        }, 60_000);
        this.externalUrls.set(url, timer);
        this.setStatus(`Opened resource ${resource.name || resource.id} in the browser.`);
        return true;
    }

    clear(): void {
        this.active = null;
        this.activeComponent = null;
        this.resetMedia();
        this.host.visible = false;
        this.playButton.visible = true;
        this.playButton.selected = false;
        this.optionButton.visible = true;
        this.setDebugAttribute("data-fairy-editor-resource-preview", "none");
    }

    dispose(): void {
        this.clear();
        for (const [url, timer] of this.externalUrls) {
            window.clearTimeout(timer);
            URL.revokeObjectURL(url);
        }
        this.externalUrls.clear();
        this.host.off(fgui.Events.SIZE_CHANGED, this, this.renderCurrent);
        this.optionButton.asButton.offClick(this, this.showOptionsMenu);
        this.optionsMenu?.dispose();
        this.optionsMenu = null;
        this.host.removeFromParent();
        this.host.dispose();
    }

    private showImage(bytes: Uint8Array, fileName: string): boolean {
        const mimeType = detectImageMimeType(bytes, fileName);
        if (!mimeType) return false;
        this.loader.url = this.createUrl(bytes, mimeType);
        this.host.visible = true;
        this.renderCurrent();
        return true;
    }

    private toggleComponentPreview(): void {
        const enabled = !this.getComponentPreviewEnabled();
        this.setComponentPreviewEnabled(enabled);
        if (this.activeComponent) {
            const { projectId, pkg, component } = this.activeComponent;
            this.showComponent(projectId, pkg, component);
        }
    }

    private showOptionsMenu(): void {
        this.optionsMenu?.dispose();
        const menu = new fgui.PopupMenu();
        const item = menu.addItem("组件缩略图", this.toggleComponentPreview.bind(this));
        item.selected = this.getComponentPreviewEnabled();
        item.name = "resourcePreviewComponentThumbnail";
        this.optionsMenu = menu;
        menu.show(this.optionButton);
    }

    private showSound(bytes: Uint8Array, fileName: string): void {
        const mimeType = detectSoundMimeType(bytes, fileName);
        if (!mimeType) throw new Error("unsupported sound format");
        const audio = new Audio(this.createUrl(bytes, mimeType));
        audio.preload = "metadata";
        audio.onended = () => { this.playButton.selected = false; };
        this.audio = audio;
        this.playButton.visible = true;
    }

    private showMovieClip(bytes: Uint8Array): void {
        const movieClip = parseMovieClipJta(bytes);
        if (movieClip.frames.length === 0) throw new Error("MovieClip JTA has no frames");
        this.movieClip = movieClip;
        this.urls = movieClip.textures.map((texture) => {
            if (texture.byteLength === 0) return "";
            const mimeType = detectImageMimeType(texture, "");
            return mimeType ? this.createUrl(texture, mimeType) : "";
        });
        this.host.visible = true;
        this.renderMovieClipFrame();
        this.scheduleMovieClipFrame();
    }

    private renderCurrent(): void {
        if (!this.host.visible) return;
        if (this.componentPreview) {
            const scale = Math.min(
                1,
                this.host.width / Math.max(1, this.componentPreview.width),
                this.host.height / Math.max(1, this.componentPreview.height),
            );
            this.componentPreview.setScale(scale, scale);
            this.componentPreview.setXY(
                (this.host.width - this.componentPreview.width * scale) / 2,
                (this.host.height - this.componentPreview.height * scale) / 2,
            );
            return;
        }
        if (this.movieClip) {
            this.renderMovieClipFrame();
            return;
        }
        this.loader.setXY(0, 0);
        this.loader.setSize(this.host.width, this.host.height);
    }

    private renderMovieClipFrame(): void {
        const movieClip = this.movieClip;
        const frame = movieClip?.frames[this.frameIndex];
        if (!movieClip || !frame) return;
        const scale = Math.min(
            1,
            this.host.width / Math.max(1, movieClip.boundsWidth),
            this.host.height / Math.max(1, movieClip.boundsHeight),
        );
        this.loader.setXY(
            (this.host.width - movieClip.boundsWidth * scale) / 2 + (frame.rectX - movieClip.boundsX) * scale,
            (this.host.height - movieClip.boundsHeight * scale) / 2 + (frame.rectY - movieClip.boundsY) * scale,
        );
        this.loader.setSize(Math.max(1, frame.rectWidth * scale), Math.max(1, frame.rectHeight * scale));
        this.loader.url = frame.textureIndex >= 0 ? this.urls[frame.textureIndex] || "" : "";
        this.loader.visible = Boolean(this.loader.url && frame.rectWidth > 0 && frame.rectHeight > 0);
        this.setDebugAttribute(
            "data-fairy-editor-resource-preview-frame",
            `${this.frameIndex + 1}/${movieClip.frames.length}`,
        );
    }

    private scheduleMovieClipFrame(): void {
        const movieClip = this.movieClip;
        if (!movieClip) return;
        const frame = movieClip.frames[this.frameIndex];
        const delayUnits = Math.max(
            1,
            movieClip.speed + frame.delay + (this.frameIndex === 0 && this.repeated ? movieClip.repeatDelay : 0),
        );
        this.timer = window.setTimeout(() => {
            if (!this.movieClip) return;
            if (movieClip.swing) {
                let next = this.frameIndex + this.frameDirection;
                if (next >= movieClip.frames.length) {
                    this.frameDirection = -1;
                    next = Math.max(0, movieClip.frames.length - 2);
                    this.repeated = true;
                } else if (next < 0) {
                    this.frameDirection = 1;
                    next = Math.min(1, movieClip.frames.length - 1);
                    this.repeated = true;
                }
                this.frameIndex = next;
            } else {
                this.frameIndex = (this.frameIndex + 1) % movieClip.frames.length;
                if (this.frameIndex === 0) this.repeated = true;
            }
            this.renderMovieClipFrame();
            this.scheduleMovieClipFrame();
        }, Math.max(1, Math.trunc(1000 / movieClip.fps * delayUnits)));
    }

    private createUrl(bytes: Uint8Array, mimeType: string): string {
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
        this.urls.push(url);
        return url;
    }

    private resetMedia(): void {
        this.componentRevision += 1;
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
        this.loader.url = "";
        this.loader.visible = true;
        if (this.audio) {
            this.audio.pause();
            this.audio.onended = null;
            this.audio.removeAttribute("src");
            this.audio.load();
        }
        this.audio = null;
        this.componentPreview?.dispose();
        this.componentPreview = null;
        for (const url of new Set(this.urls)) {
            Laya.loader.clearRes(url);
            window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        }
        this.urls = [];
        this.movieClip = null;
        this.frameIndex = 0;
        this.frameDirection = 1;
        this.repeated = false;
    }

    private formatSize(width: number | undefined, height: number | undefined): string {
        return Number.isFinite(width) && Number.isFinite(height) ? `${width}x${height}` : "";
    }
}

export function detectImageMimeType(bytes: Uint8Array, fileName: string): string | null {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    if (
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) return "image/webp";
    const extension = fileName.toLowerCase().match(/\.(png|jpe?g|gif|webp|svg)$/)?.[1];
    if (extension === "svg" || new TextDecoder().decode(bytes.subarray(0, 256)).includes("<svg")) return "image/svg+xml";
    return extension ? `image/${extension === "jpg" ? "jpeg" : extension}` : null;
}

export function detectSoundMimeType(bytes: Uint8Array, fileName: string): string | null {
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57) return "audio/wav";
    if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return "audio/ogg";
    if (
        bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33
        || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
    ) return "audio/mpeg";
    const extension = fileName.toLowerCase().match(/\.(wav|mp3|ogg)$/)?.[1];
    return extension ? `audio/${extension === "mp3" ? "mpeg" : extension}` : null;
}
