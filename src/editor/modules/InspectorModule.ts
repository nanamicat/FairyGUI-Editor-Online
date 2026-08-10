import {
    InspectorController,
    type InspectorPanelAction,
} from "../ui/InspectorController";
import { createCommonDisplayNodePropsCommands } from "../commands/DisplayNodePropsLogic";
import type { EditorModule } from "../workbench/EditorWorkbench";
import type { FairyGuiEditorWorkbenchHost } from "../workbench/EditorShellModuleHost";
import { DOCUMENT_AUTHORING_SERVICE, EditorDocumentAuthoring } from "./DocumentAuthoringModule";
import { EditorProjectExplorer, PROJECT_EXPLORER_SERVICE } from "./ProjectExplorerModule";
import { EditorProjectSession, PROJECT_SESSION_SERVICE } from "./ProjectSessionModule";
import { EditorShellChrome, SHELL_CHROME_SERVICE } from "./ShellChromeModule";

export const INSPECTOR_SERVICE = "fairygui.inspector";

export class EditorInspector extends InspectorController {
    private actionHandler: ((action: InspectorPanelAction) => void) | null = null;
    private componentCustomPropertiesEditable = false;

    constructor(
        private readonly chrome: EditorShellChrome,
        private readonly session: EditorProjectSession,
        private readonly document: EditorDocumentAuthoring,
        private readonly explorer: EditorProjectExplorer,
    ) {
        super(
            chrome.panels.inspector.getChild("list").asList,
            (action) => this.handleAction(action),
            (name, value) => chrome.setDebugAttribute(name, value),
        );
    }

    renderCurrent(componentCustomPropertiesEditable: boolean): void {
        this.componentCustomPropertiesEditable = componentCustomPropertiesEditable;
        const snapshot = this.session.snapshot;
        if (!snapshot) return;
        const selection = this.explorer.library.getInspectorSelection();
        if (selection?.kind === "resource") {
            this.renderResource(this.explorer.findResource(selection.packageId, selection.resourceId));
            return;
        }
        if (selection?.kind === "folder") {
            const folder = snapshot.packages.find((pkg) => pkg.id === selection.packageId)?.folders?.find(
                (candidate) => candidate.branch === selection.branch && candidate.path === selection.path,
            ) || null;
            this.renderResourceFolder(folder, this.session.commandAdapter.getSessionState().liveSession);
            return;
        }
        this.renderSnapshot({
            snapshot,
            workingProject: this.session.liveSessionBridge.getWorkingProject(),
            selectedPackage: this.document.getSelectedPackage(),
            selectedComponent: this.document.getSelectedComponent(),
            selectedNode: this.document.getSelectedNode(),
            selectedNodes: this.document.getSelectedNodes(),
            commandSession: this.session.commandAdapter.getSessionState(),
            componentCustomPropertiesEditable,
        });
    }

    bindActions(handler: (action: InspectorPanelAction) => void): () => void {
        if (this.actionHandler) throw new Error("Inspector actions are already bound.");
        this.actionHandler = handler;
        return () => {
            if (this.actionHandler === handler) this.actionHandler = null;
        };
    }

    dispose(): void {
        this.actionHandler = null;
        this.clear();
    }

    private handleAction(action: InspectorPanelAction): void {
        if (action === "command:apply") {
            void (this.document.nodeIds.length > 1
                ? this.applyMultiSelectionCommand()
                : this.applyInspectorCommand());
            return;
        }
        this.actionHandler?.(action);
    }

    private async applyMultiSelectionCommand(): Promise<void> {
        const selectedPackage = this.document.getSelectedPackage();
        const selectedComponent = this.document.getSelectedComponent();
        const selectedIds = this.document.nodeIds;
        if (!selectedPackage || !selectedComponent || selectedIds.length < 2) {
            this.chrome.setStatus("Multi-selection command skipped: select at least two display nodes.");
            return;
        }
        const readResult = this.readMultiSelectionValues();
        if (!readResult.ok) {
            this.chrome.setStatus(readResult.message);
            return;
        }
        await this.session.runExclusive(async () => {
            if (!this.sameSelection(selectedIds, this.document.nodeIds)) {
                this.chrome.setStatus("Multi-selection command cancelled because the selection changed.");
                return false;
            }
            const selectedNodes = this.document.getSelectedNodes();
            if (selectedNodes.length !== selectedIds.length) return false;
            const { commands, changedFields } = createCommonDisplayNodePropsCommands(
                selectedPackage.id,
                selectedComponent.id,
                selectedNodes,
                readResult.values,
            );
            if (commands.length === 0) {
                this.chrome.setStatus("Multi-selection common properties are unchanged.");
                this.chrome.setDebugAttribute("data-fairy-editor-multi-inspector", "unchanged");
                return true;
            }
            const applied = await this.applyCommands(
                commands,
                `multi-selection common properties (${commands.length} nodes)`,
            );
            if (applied) {
                this.chrome.setDebugAttribute(
                    "data-fairy-editor-multi-inspector",
                    `${commands.length}:${changedFields.join(",")}`,
                );
                this.chrome.setDebugAttribute("data-fairy-editor-multi-inspector-selection", selectedIds.join(","));
            }
            return applied;
        });
    }

    private async applyInspectorCommand(): Promise<void> {
        const selectedPackage = this.document.getSelectedPackage();
        const selectedComponent = this.document.getSelectedComponent();
        const selectedNode = this.document.getSelectedNode();
        if (!selectedPackage || !selectedComponent || !selectedNode) {
            this.chrome.setStatus("Command skipped: no display node selected.");
            return;
        }
        const command = this.createDisplayNodeCommand(selectedPackage, selectedComponent, selectedNode);
        if (Object.keys(command.props).length === 0) return;
        await this.session.runExclusive(() => this.applyCommands([command], "setDisplayNodeProps"));
    }

    private async applyCommands(
        commands: Parameters<EditorProjectSession["applyDisplayNodePropsNow"]>[0],
        summary: string,
    ): Promise<boolean> {
        try {
            const { result } = await this.session.applyDisplayNodePropsNow(commands, summary);
            if (result.ok) {
                this.chrome.setStatus(`${summary}.`);
                return true;
            }
            this.document.refreshPreview();
            this.renderCurrent(this.componentCustomPropertiesEditable);
            this.chrome.setStatus(`Command failed: ${result.error?.code || "unknown_error"}.`);
            return false;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.document.refreshPreview();
            this.renderCurrent(this.componentCustomPropertiesEditable);
            this.chrome.setStatus(`Command failed: ${message}`, "error");
            console.error("[Editor Session] inspector command apply failed", error);
            return false;
        }
    }

    private sameSelection(left: string[], right: string[]): boolean {
        return left.length === right.length && left.every((nodeId) => right.includes(nodeId));
    }
}

export function createInspectorModule(): EditorModule<FairyGuiEditorWorkbenchHost> {
    return {
        id: "fairygui.inspector",
        hotReloadable: false,
        activate(context) {
            const inspector = new EditorInspector(
                context.requireService<EditorShellChrome>(SHELL_CHROME_SERVICE),
                context.requireService<EditorProjectSession>(PROJECT_SESSION_SERVICE),
                context.requireService<EditorDocumentAuthoring>(DOCUMENT_AUTHORING_SERVICE),
                context.requireService<EditorProjectExplorer>(PROJECT_EXPLORER_SERVICE),
            );
            context.provideService(INSPECTOR_SERVICE, inspector);
            return () => inspector.dispose();
        },
    };
}
