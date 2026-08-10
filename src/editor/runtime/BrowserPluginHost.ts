import type {
    EditorDisplayNodeSelector,
    SetDisplayNodePropsCommand,
} from "../model/EditorCommand";

const STORAGE_KEY = "fairygui-editor-browser-plugins-v1";
const REMOVED_BUILT_IN_PLUGIN_ID = "fairygui.selection-summary";
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 3000;
const PERMISSIONS = ["project.read", "project.write", "ui.menu", "ui.panel"] as const;

export type BrowserPluginPermission = typeof PERMISSIONS[number];

export interface BrowserPluginContribution {
    id: string;
    title: string;
}

export interface BrowserPluginManifest {
    schemaVersion: 1;
    id: string;
    name: string;
    version: string;
    description: string;
    entry: string;
    permissions: BrowserPluginPermission[];
    contributes: {
        commands: BrowserPluginContribution[];
        panels: BrowserPluginContribution[];
    };
}

export interface BrowserPluginSummary {
    id: string;
    name: string;
    version: string;
    description: string;
    manifestUrl: string;
    permissions: BrowserPluginPermission[];
    commands: BrowserPluginContribution[];
    panels: BrowserPluginContribution[];
    enabled: boolean;
    state: "disabled" | "ready" | "error";
    environment: { dom: boolean; opfs: boolean } | null;
    error: string;
}

export interface BrowserPluginMenuContribution extends BrowserPluginContribution {
    pluginId: string;
    kind: "command" | "panel";
}

export interface BrowserPluginInvokeResult {
    panel?: {
        title: string;
        lines: string[];
    };
    commands?: unknown[];
}

interface PersistedBrowserPlugin {
    manifestUrl: string;
    manifest: BrowserPluginManifest;
    source: string;
    enabled: boolean;
}

interface BrowserPluginRecord extends PersistedBrowserPlugin {
    state: BrowserPluginSummary["state"];
    environment: BrowserPluginSummary["environment"];
    error: string;
    sandbox: BrowserPluginSandbox | null;
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
    return value as Record<string, unknown>;
}

function shortText(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
        throw new Error(`${field} must be a non-empty string up to ${maxLength} characters.`);
    }
    return value.trim();
}

function contribution(value: unknown, pluginId: string): BrowserPluginContribution {
    const item = object(value);
    const id = shortText(item.id, "contribution.id", 96);
    if (!id.startsWith(`${pluginId}.`) || !/^[a-z][a-z0-9.-]+$/.test(id)) {
        throw new Error(`Contribution id ${id} must be namespaced by ${pluginId}.`);
    }
    return { id, title: shortText(item.title, "contribution.title", 96) };
}

export function parseBrowserPluginManifest(value: unknown): BrowserPluginManifest {
    const manifest = object(value);
    if (manifest.schemaVersion !== 1) throw new Error("Only browser plugin schemaVersion 1 is supported.");
    const id = shortText(manifest.id, "id", 64);
    if (!/^[a-z][a-z0-9.-]{2,63}$/.test(id)) throw new Error("Plugin id is invalid.");
    const permissions = Array.isArray(manifest.permissions)
        ? manifest.permissions.map((permission) => {
            if (!PERMISSIONS.includes(permission as BrowserPluginPermission)) {
                throw new Error(`Unsupported plugin permission: ${String(permission)}.`);
            }
            return permission as BrowserPluginPermission;
        })
        : [];
    const contributes = object(manifest.contributes || {});
    const commands = (Array.isArray(contributes.commands) ? contributes.commands : []).map((item) => contribution(item, id));
    const panels = (Array.isArray(contributes.panels) ? contributes.panels : []).map((item) => contribution(item, id));
    const contributionIds = [...commands, ...panels].map((item) => item.id);
    if (contributionIds.length > 32 || new Set(contributionIds).size !== contributionIds.length) {
        throw new Error("Plugin contributions must be unique and limited to 32 entries.");
    }
    if (commands.length > 0 && !permissions.includes("ui.menu")) throw new Error("Command contributions require ui.menu.");
    if (panels.length > 0 && !permissions.includes("ui.panel")) throw new Error("Panel contributions require ui.panel.");
    return {
        schemaVersion: 1,
        id,
        name: shortText(manifest.name, "name", 96),
        version: shortText(manifest.version, "version", 64),
        description: typeof manifest.description === "string" ? manifest.description.slice(0, 500) : "",
        entry: shortText(manifest.entry, "entry", 256),
        permissions: [...new Set(permissions)],
        contributes: { commands, panels },
    };
}

export function validateBrowserPluginInvokeResult(value: unknown): BrowserPluginInvokeResult {
    if (value === undefined || value === null) return {};
    const result = object(value);
    const output: BrowserPluginInvokeResult = {};
    if (result.panel !== undefined) {
        const panel = object(result.panel);
        if (!Array.isArray(panel.lines) || panel.lines.length > 24) throw new Error("Plugin panel lines are invalid.");
        output.panel = {
            title: shortText(panel.title, "panel.title", 96),
            lines: panel.lines.map((line) => String(line).slice(0, 240)),
        };
    }
    if (result.commands !== undefined) {
        if (!Array.isArray(result.commands) || result.commands.length > 20) throw new Error("Plugin commands are invalid.");
        output.commands = result.commands;
    }
    return output;
}

export function validateBrowserPluginWriteCommands(
    result: BrowserPluginInvokeResult,
    selected: EditorDisplayNodeSelector | null,
): SetDisplayNodePropsCommand[] {
    if (!result.commands?.length) return [];
    if (!selected) throw new Error("Plugin write requires one selected display object.");
    return result.commands.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("Plugin command must be an object.");
        }
        const command = value as Record<string, unknown>;
        if (command.kind !== "setDisplayNodeProps") throw new Error("Plugin v1 only supports setDisplayNodeProps.");
        const selector = command.selector as Record<string, unknown> | null;
        if (!selector
            || selector.packageId !== selected.packageId
            || selector.componentResourceId !== selected.componentResourceId
            || selector.displayNodeId !== selected.displayNodeId) {
            throw new Error("Plugin v1 commands may target only the current selection.");
        }
        const props = command.props as Record<string, unknown> | null;
        const position = props?.position as Record<string, unknown> | null;
        if (!props || Object.keys(props).some((key) => key !== "position")
            || !position || Object.keys(position).some((key) => key !== "x" && key !== "y")
            || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
            throw new Error("Plugin v1 write supports only finite position.x/y.");
        }
        return {
            kind: "setDisplayNodeProps",
            selector: { ...selected },
            props: { position: { x: Number(position.x), y: Number(position.y) } },
        };
    });
}

export class BrowserPluginHost {
    private readonly plugins = new Map<string, BrowserPluginRecord>();
    private disposed = false;

    async initialize(): Promise<void> {
        this.assertActive();
        if (this.restore()) this.persist();
        for (const plugin of this.plugins.values()) {
            if (plugin.enabled) await this.activate(plugin);
        }
    }

    list(): BrowserPluginSummary[] {
        return [...this.plugins.values()].map((plugin) => ({
            id: plugin.manifest.id,
            name: plugin.manifest.name,
            version: plugin.manifest.version,
            description: plugin.manifest.description,
            manifestUrl: plugin.manifestUrl,
            permissions: plugin.manifest.permissions.slice(),
            commands: plugin.manifest.contributes.commands.slice(),
            panels: plugin.manifest.contributes.panels.slice(),
            enabled: plugin.enabled,
            state: plugin.state,
            environment: plugin.environment,
            error: plugin.error,
        }));
    }

    menuContributions(): BrowserPluginMenuContribution[] {
        return this.list().flatMap((plugin) => plugin.enabled && plugin.state === "ready"
            ? [
                ...plugin.commands.map((item) => ({ ...item, pluginId: plugin.id, kind: "command" as const })),
                ...plugin.panels.map((item) => ({ ...item, pluginId: plugin.id, kind: "panel" as const })),
            ]
            : []);
    }

    async install(manifestUrl: string, enabled = false): Promise<BrowserPluginSummary> {
        this.assertActive();
        const loaded = await loadBrowserPlugin(manifestUrl);
        this.assertActive();
        const existing = this.plugins.get(loaded.manifest.id);
        existing?.sandbox?.dispose();
        const plugin: BrowserPluginRecord = {
            ...loaded,
            enabled,
            state: "disabled",
            environment: null,
            error: "",
            sandbox: null,
        };
        this.plugins.set(plugin.manifest.id, plugin);
        if (enabled) await this.activate(plugin);
        this.persist();
        return this.list().find((item) => item.id === plugin.manifest.id)!;
    }

    async reload(pluginId: string): Promise<BrowserPluginSummary> {
        this.assertActive();
        const current = this.require(pluginId);
        const enabled = current.enabled;
        const loaded = await loadBrowserPlugin(current.manifestUrl);
        this.assertActive();
        if (loaded.manifest.id !== pluginId) throw new Error("Reloaded plugin id does not match the installed plugin.");
        current.sandbox?.dispose();
        Object.assign(current, loaded, {
            enabled,
            state: "disabled",
            environment: null,
            error: "",
            sandbox: null,
        });
        if (enabled) await this.activate(current);
        this.persist();
        return this.list().find((item) => item.id === pluginId)!;
    }

    async setEnabled(pluginId: string, enabled: boolean): Promise<BrowserPluginSummary> {
        this.assertActive();
        const plugin = this.require(pluginId);
        plugin.enabled = enabled;
        if (enabled) await this.activate(plugin);
        else {
            plugin.sandbox?.dispose();
            plugin.sandbox = null;
            plugin.state = "disabled";
            plugin.environment = null;
            plugin.error = "";
        }
        this.persist();
        return this.list().find((item) => item.id === pluginId)!;
    }

    async invoke(pluginId: string, contributionId: string, context: unknown): Promise<BrowserPluginInvokeResult> {
        this.assertActive();
        const plugin = this.require(pluginId);
        if (!plugin.enabled) throw new Error("Plugin is disabled.");
        if (!plugin.sandbox) await this.activate(plugin);
        const contribution = [
            ...plugin.manifest.contributes.commands,
            ...plugin.manifest.contributes.panels,
        ].find((item) => item.id === contributionId);
        if (!contribution) throw new Error("Plugin contribution is not declared by its manifest.");
        try {
            const result = validateBrowserPluginInvokeResult(await plugin.sandbox!.invoke(
                contributionId,
                plugin.manifest.permissions.includes("project.read") ? context : {},
            ));
            if (result.commands?.length && !plugin.manifest.permissions.includes("project.write")) {
                throw new Error("Plugin returned commands without project.write permission.");
            }
            return result;
        } catch (error) {
            this.fail(plugin, error);
            throw error;
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const plugin of this.plugins.values()) plugin.sandbox?.dispose();
        this.plugins.clear();
    }

    private async activate(plugin: BrowserPluginRecord): Promise<void> {
        plugin.sandbox?.dispose();
        plugin.sandbox = null;
        plugin.error = "";
        try {
            const sandbox = await BrowserPluginSandbox.create(plugin.source, plugin.manifest);
            if (this.disposed) {
                sandbox.dispose();
                throw new Error("Browser plugin host was disposed during activation.");
            }
            plugin.sandbox = sandbox;
            plugin.environment = sandbox.environment;
            plugin.state = "ready";
        } catch (error) {
            this.fail(plugin, error);
            throw error;
        }
    }

    private fail(plugin: BrowserPluginRecord, error: unknown): void {
        plugin.sandbox?.dispose();
        plugin.sandbox = null;
        plugin.enabled = false;
        plugin.state = "error";
        plugin.environment = null;
        plugin.error = error instanceof Error ? error.message : String(error);
        this.persist();
    }

    private require(pluginId: string): BrowserPluginRecord {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) throw new Error(`Browser plugin ${pluginId} is not installed.`);
        return plugin;
    }

    private assertActive(): void {
        if (this.disposed) throw new Error("Browser plugin host is disposed.");
    }

    private restore(): boolean {
        let values: unknown[] = [];
        let removedBuiltIn = false;
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
            values = Array.isArray(parsed) ? parsed : [];
        } catch {
            values = [];
        }
        for (const value of values) {
            try {
                const persisted = object(value);
                const manifest = parseBrowserPluginManifest(persisted.manifest);
                if (manifest.id === REMOVED_BUILT_IN_PLUGIN_ID) {
                    removedBuiltIn = true;
                    continue;
                }
                const manifestUrl = browserUrl(persisted.manifestUrl, "manifestUrl");
                const source = typeof persisted.source === "string" ? persisted.source : "";
                if (!source || new TextEncoder().encode(source).byteLength > MAX_ENTRY_BYTES) continue;
                this.plugins.set(manifest.id, {
                    manifestUrl,
                    manifest,
                    source,
                    enabled: persisted.enabled === true,
                    state: "disabled",
                    environment: null,
                    error: "",
                    sandbox: null,
                });
            } catch {
                // Ignore invalid persisted plugin records.
            }
        }
        return removedBuiltIn;
    }

    private persist(): void {
        try {
            const values: PersistedBrowserPlugin[] = [...this.plugins.values()].map((plugin) => ({
                manifestUrl: plugin.manifestUrl,
                manifest: plugin.manifest,
                source: plugin.source,
                enabled: plugin.enabled,
            }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
        } catch {
            // Plugin persistence is optional; the active sandbox remains usable.
        }
    }
}

async function loadBrowserPlugin(manifestUrlValue: string): Promise<PersistedBrowserPlugin> {
    const manifestUrl = browserUrl(manifestUrlValue, "manifest URL");
    const manifestResponse = await fetch(manifestUrl, { cache: "no-store", credentials: "omit" });
    if (!manifestResponse.ok) throw new Error(`Plugin manifest request failed: ${manifestResponse.status}.`);
    const manifestText = await manifestResponse.text();
    if (new TextEncoder().encode(manifestText).byteLength > MAX_MANIFEST_BYTES) throw new Error("Plugin manifest is too large.");
    const manifest = parseBrowserPluginManifest(JSON.parse(manifestText));
    const entryUrl = browserUrl(new URL(manifest.entry, manifestUrl).href, "entry URL");
    const sourceResponse = await fetch(entryUrl, { cache: "no-store", credentials: "omit" });
    if (!sourceResponse.ok) throw new Error(`Plugin entry request failed: ${sourceResponse.status}.`);
    const source = await sourceResponse.text();
    if (!source || new TextEncoder().encode(source).byteLength > MAX_ENTRY_BYTES) throw new Error("Plugin entry is empty or too large.");
    return { manifestUrl, manifest, source, enabled: false };
}

function browserUrl(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
    const url = new URL(value, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${field} must use HTTP or HTTPS.`);
    return url.href;
}

class BrowserPluginSandbox {
    readonly environment: { dom: boolean; opfs: boolean };
    private readonly frame: HTMLIFrameElement;
    private readonly token: string;
    private readonly pending = new Map<string, {
        resolve(value: unknown): void;
        reject(error: Error): void;
        timeout: number;
    }>();
    private readonly listener: (event: MessageEvent) => void;

    private constructor(frame: HTMLIFrameElement, token: string, environment: { dom: boolean; opfs: boolean }) {
        this.frame = frame;
        this.token = token;
        this.environment = environment;
        this.listener = (event) => this.onMessage(event);
        window.addEventListener("message", this.listener);
    }

    static async create(source: string, manifest: BrowserPluginManifest): Promise<BrowserPluginSandbox> {
        const frame = document.createElement("iframe");
        frame.sandbox.add("allow-scripts");
        frame.style.display = "none";
        frame.setAttribute("aria-hidden", "true");
        const token = crypto.randomUUID();
        const ready = waitForSandboxReady(frame, token, manifest);
        frame.srcdoc = sandboxDocument(token, source);
        document.body.appendChild(frame);
        const environment = await ready;
        return new BrowserPluginSandbox(frame, token, environment);
    }

    invoke(contributionId: string, context: unknown): Promise<unknown> {
        const requestId = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`Plugin contribution ${contributionId} timed out.`));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(requestId, { resolve, reject, timeout });
            this.frame.contentWindow?.postMessage({
                token: this.token,
                payload: { type: "invoke", requestId, contributionId, context },
            }, "*");
        });
    }

    dispose(): void {
        window.removeEventListener("message", this.listener);
        for (const pending of this.pending.values()) {
            window.clearTimeout(pending.timeout);
            pending.reject(new Error("Plugin sandbox was disposed."));
        }
        this.pending.clear();
        this.frame.remove();
    }

    private onMessage(event: MessageEvent): void {
        if (event.source !== this.frame.contentWindow) return;
        const envelope = event.data as { token?: unknown; payload?: unknown } | null;
        if (!envelope || envelope.token !== this.token) return;
        const payload = object(envelope.payload);
        if (payload.type !== "result" || typeof payload.requestId !== "string") return;
        const pending = this.pending.get(payload.requestId);
        if (!pending) return;
        this.pending.delete(payload.requestId);
        window.clearTimeout(pending.timeout);
        if (payload.ok === true) pending.resolve(payload.result);
        else pending.reject(new Error(typeof payload.error === "string" ? payload.error : "Plugin command failed."));
    }
}

function waitForSandboxReady(
    frame: HTMLIFrameElement,
    token: string,
    manifest: BrowserPluginManifest,
): Promise<{ dom: boolean; opfs: boolean }> {
    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => finish(new Error("Plugin activation timed out.")), REQUEST_TIMEOUT_MS);
        const finish = (error: Error | null, environment?: { dom: boolean; opfs: boolean }): void => {
            window.clearTimeout(timeout);
            window.removeEventListener("message", onMessage);
            if (error) {
                frame.remove();
                reject(error);
            } else resolve(environment!);
        };
        const onMessage = (event: MessageEvent): void => {
            if (event.source !== frame.contentWindow) return;
            const envelope = event.data as { token?: unknown; payload?: unknown } | null;
            if (!envelope || envelope.token !== token) return;
            const payload = object(envelope.payload);
            if (payload.type === "fatal") {
                finish(new Error(typeof payload.error === "string" ? payload.error : "Plugin activation failed."));
                return;
            }
            if (payload.type !== "ready") return;
            const commands = Array.isArray(payload.commands) ? payload.commands.map(String).sort() : [];
            const panels = Array.isArray(payload.panels) ? payload.panels.map(String).sort() : [];
            const expectedCommands = manifest.contributes.commands.map((item) => item.id).sort();
            const expectedPanels = manifest.contributes.panels.map((item) => item.id).sort();
            if (commands.join("\0") !== expectedCommands.join("\0") || panels.join("\0") !== expectedPanels.join("\0")) {
                finish(new Error("Plugin registrations do not match its manifest contributions."));
                return;
            }
            const environment = object(payload.environment);
            finish(null, { dom: environment.dom === true, opfs: environment.opfs === true });
        };
        window.addEventListener("message", onMessage);
    });
}

function sandboxDocument(token: string, source: string): string {
    const sourceBase64 = base64(source);
    const workerSource = `(async () => {
const handlers = new Map();
const panels = new Map();
const moduleUrl = "data:text/javascript;base64,${sourceBase64}";
const validId = value => typeof value === "string" && /^[a-z][a-z0-9.-]+$/.test(value);
const api = Object.freeze({
  registerCommand(id, handler) {
    if (!validId(id) || typeof handler !== "function" || handlers.has(id)) throw new Error("Invalid plugin command registration.");
    handlers.set(id, handler);
  },
  registerPanel(id, handler) {
    if (!validId(id) || typeof handler !== "function" || panels.has(id)) throw new Error("Invalid plugin panel registration.");
    panels.set(id, handler);
  },
});
try {
  const plugin = await import(moduleUrl);
  if (typeof plugin.activate !== "function") throw new Error("Plugin entry must export activate(api).");
  await plugin.activate(api);
  let opfs = false;
  try { opfs = Boolean(await navigator.storage?.getDirectory?.()); } catch {}
  self.postMessage({ type: "ready", commands: [...handlers.keys()], panels: [...panels.keys()], environment: { dom: typeof document !== "undefined", opfs } });
} catch (error) {
  self.postMessage({ type: "fatal", error: error instanceof Error ? error.message : String(error) });
}
self.onmessage = async event => {
  const message = event.data || {};
  if (message.type !== "invoke" || typeof message.requestId !== "string") return;
  try {
    const handler = handlers.get(message.contributionId) || panels.get(message.contributionId);
    if (!handler) throw new Error("Plugin contribution is not registered.");
    const result = await handler(message.context);
    self.postMessage({ type: "result", requestId: message.requestId, ok: true, result });
  } catch (error) {
    self.postMessage({ type: "result", requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
})();`;
    const workerBase64 = base64(workerSource);
    return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob: data:; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'">
<script>
const token = ${JSON.stringify(token)};
const workerSource = new TextDecoder().decode(Uint8Array.from(atob(${JSON.stringify(workerBase64)}), character => character.charCodeAt(0)));
const worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));
worker.onmessage = event => parent.postMessage({ token, payload: event.data }, "*");
worker.onerror = event => parent.postMessage({ token, payload: { type: "fatal", error: event.message || "Plugin worker failed." } }, "*");
addEventListener("message", event => {
  if (event.source === parent && event.data?.token === token) worker.postMessage(event.data.payload);
});
</script>`;
}

function base64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}
