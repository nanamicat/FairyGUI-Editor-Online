import { inspectDisplayNode } from "../commands/HighRiskAuthoringTransactions";
import type {
    DisplayNodeEditableProps,
    EditorCommandSessionState,
    SetDisplayNodePropsCommand,
} from "../model/EditorCommand";
import type {
    EditorProjectSnapshot,
    ProjectSnapshotComponent,
    ProjectSnapshotDisplayNode,
    ProjectSnapshotPackage,
    ProjectSnapshotResource,
    ProjectSnapshotResourceFolder,
} from "../model/ProjectSnapshot";
import {
    InspectorCommandPanel,
    type InspectorPanelAction,
} from "./InspectorCommandPanel";
import { buildSnapshotInspectorPresentation } from "./InspectorPresentation";
import type { CommonDisplayNodePropsValues } from "../commands/DisplayNodePropsLogic";

interface InspectorSnapshotOptions {
    snapshot: EditorProjectSnapshot;
    workingProject: Parameters<typeof inspectDisplayNode>[0];
    selectedPackage: ProjectSnapshotPackage | null;
    selectedComponent: ProjectSnapshotComponent | null;
    selectedNode: ProjectSnapshotDisplayNode | null;
    selectedNodes: ProjectSnapshotDisplayNode[];
    commandSession: EditorCommandSessionState;
    componentCustomPropertiesEditable: boolean;
}

export type InspectorMultiSelectionValuesResult =
    | { ok: true; values: CommonDisplayNodePropsValues }
    | { ok: false; message: string };

export class InspectorController {
    private readonly panel: InspectorCommandPanel;

    constructor(
        list: fgui.GList,
        onAction: (action: InspectorPanelAction) => void,
        setDebugAttribute: (name: string, value: string) => void,
    ) {
        this.panel = new InspectorCommandPanel(list, onAction, setDebugAttribute);
    }

    get fields(): InspectorCommandPanel["fields"] {
        return this.panel.fields;
    }

    clear(): void {
        this.panel.clear();
    }

    renderLines(details: string[]): void {
        this.panel.renderLines(details);
    }

    appendLines(details: string[], namePrefix: string, y: number, firstColor: string): number {
        return this.panel.appendLines(details, namePrefix, y, firstColor);
    }

    layout(): void {
        this.panel.layout();
    }

    readMultiSelectionValues(): InspectorMultiSelectionValuesResult {
        const readOptionalBoolean = (input: fgui.GComboBox | null): boolean | undefined => {
            if (input?.value === "true") return true;
            if (input?.value === "false") return false;
            return undefined;
        };
        const values: CommonDisplayNodePropsValues = {
            x: this.fields.x?.optionalNumber,
            y: this.fields.y?.optionalNumber,
            width: this.fields.width?.optionalNumber,
            height: this.fields.height?.optionalNumber,
            alpha: this.fields.alpha?.optionalNumber,
            rotation: this.fields.rotation?.optionalNumber,
            visible: readOptionalBoolean(this.fields.multiVisible),
            touchable: readOptionalBoolean(this.fields.multiTouchable),
            grayed: readOptionalBoolean(this.fields.multiGrayed),
        };
        const numbers = [
            ["X", values.x],
            ["Y", values.y],
            ["Width", values.width],
            ["Height", values.height],
            ["Alpha", values.alpha],
            ["Rotation", values.rotation],
        ] as const;
        const invalidNumber = numbers.find(([, value]) => value !== undefined && !Number.isFinite(value));
        if (invalidNumber) return { ok: false, message: `Multi-selection ${invalidNumber[0]} must be a finite number.` };
        if ((values.width !== undefined && values.width <= 0) || (values.height !== undefined && values.height <= 0)) {
            return { ok: false, message: "Multi-selection width and height must be greater than zero." };
        }
        if (values.alpha !== undefined && (values.alpha < 0 || values.alpha > 1)) {
            return { ok: false, message: "Multi-selection alpha must be between 0 and 1." };
        }
        return { ok: true, values };
    }

    createDisplayNodeCommand(
        selectedPackage: ProjectSnapshotPackage,
        selectedComponent: ProjectSnapshotComponent,
        selectedNode: ProjectSnapshotDisplayNode,
    ): SetDisplayNodePropsCommand {
        const props: DisplayNodeEditableProps = {};
        const position = {
            x: this.fields.x?.numberValue ?? selectedNode.x,
            y: this.fields.y?.numberValue ?? selectedNode.y,
        };
        if (position.x !== selectedNode.x || position.y !== selectedNode.y) props.position = position;
        const size = {
            width: this.fields.width?.numberValue ?? selectedNode.width,
            height: this.fields.height?.numberValue ?? selectedNode.height,
        };
        if (size.width !== selectedNode.width || size.height !== selectedNode.height) props.size = size;
        const minSize = {
            width: this.fields.minWidth?.numberValue ?? selectedNode.minSize.width,
            height: this.fields.minHeight?.numberValue ?? selectedNode.minSize.height,
        };
        if (minSize.width !== selectedNode.minSize.width || minSize.height !== selectedNode.minSize.height) props.minSize = minSize;
        const maxSize = {
            width: this.fields.maxWidth?.numberValue ?? selectedNode.maxSize.width,
            height: this.fields.maxHeight?.numberValue ?? selectedNode.maxSize.height,
        };
        if (maxSize.width !== selectedNode.maxSize.width || maxSize.height !== selectedNode.maxSize.height) props.maxSize = maxSize;
        const scale = {
            x: this.fields.scaleX?.numberValue ?? selectedNode.scale.x,
            y: this.fields.scaleY?.numberValue ?? selectedNode.scale.y,
        };
        if (scale.x !== selectedNode.scale.x || scale.y !== selectedNode.scale.y) props.scale = scale;
        const skew = {
            x: this.fields.skewX?.numberValue ?? selectedNode.skew.x,
            y: this.fields.skewY?.numberValue ?? selectedNode.skew.y,
        };
        if (skew.x !== selectedNode.skew.x || skew.y !== selectedNode.skew.y) props.skew = skew;
        const aspect = this.fields.aspect?.selected ?? selectedNode.aspect;
        if (aspect !== selectedNode.aspect) props.aspect = aspect;
        const visible = this.fields.visible ? !this.fields.visible.selected : selectedNode.visible;
        if (visible !== selectedNode.visible) props.visible = visible;
        const touchable = this.fields.touchable ? !this.fields.touchable.selected : selectedNode.touchable;
        if (touchable !== selectedNode.touchable) props.touchable = touchable;
        const grayed = this.fields.grayed?.selected ?? selectedNode.grayed;
        if (grayed !== selectedNode.grayed) props.grayed = grayed;
        const alpha = this.fields.alpha?.numberValue ?? selectedNode.alpha;
        if (alpha !== selectedNode.alpha) props.alpha = alpha;
        const rotation = this.fields.rotation?.numberValue ?? selectedNode.rotation;
        if (rotation !== selectedNode.rotation) props.rotation = rotation;
        const tooltips = this.fields.tooltips?.text ?? selectedNode.tooltips;
        if (tooltips !== selectedNode.tooltips) props.tooltips = tooltips;
        const customData = this.fields.customData?.text ?? selectedNode.customData;
        if (customData !== selectedNode.customData) props.customData = customData;
        const blendMode = (this.fields.blendMode?.value || selectedNode.blendMode) as ProjectSnapshotDisplayNode["blendMode"];
        if (blendMode !== selectedNode.blendMode) props.blendMode = blendMode;
        const filter = this.fields.filter?.value ?? selectedNode.filter;
        if (filter !== selectedNode.filter) {
            props.filter = filter;
            const values = selectedNode.filterData.split(",").map((value) => Number(value.trim()));
            props.filterData = filter === "color"
                ? values.length === 4 && values.every(Number.isFinite) ? selectedNode.filterData : "0,0,0,0"
                : "";
        }
        const textEditor = this.fields.textEditor;
        if (textEditor) {
            const text = textEditor.text.title;
            const font = textEditor.font.title.trim();
            const fontSize = Number(textEditor.fontSize.title.trim());
            if (text !== selectedNode.text) props.text = text;
            if (font !== selectedNode.font) props.font = font;
            if (fontSize !== selectedNode.fontSize) props.fontSize = fontSize;
            if (textEditor.color !== selectedNode.color) props.color = textEditor.color;
            const textProperties = {
                ...structuredClone(selectedNode.textProperties),
                text,
                font,
                fontSize,
                color: textEditor.color,
                align: textEditor.align.selectedIndex,
                vAlign: textEditor.verticalAlign.selectedIndex,
                leading: textEditor.leading.numberValue,
                letterSpacing: textEditor.letterSpacing.numberValue,
                autoSize: textEditor.autoSize.selectedIndex,
                singleLine: textEditor.singleLine.selected,
                autoClearText: textEditor.clearOnPublish.selected,
                templateVarsEnabled: textEditor.varsEnabled.selected,
                ubbEnabled: textEditor.ubbEnabled.selected,
                underline: textEditor.underline.selected,
                italic: textEditor.italic.selected,
                bold: textEditor.bold.selected,
                strikethrough: textEditor.strike.selected,
            };
            if (JSON.stringify(textProperties) !== JSON.stringify(selectedNode.textProperties)) {
                props.textProperties = textProperties;
            }
        }
        const pivotEditable = selectedNode.type !== "GGroup" && selectedNode.type !== "GLoader3D";
        if (pivotEditable) {
            const pivot = {
                x: this.fields.pivotX?.numberValue ?? selectedNode.pivotX,
                y: this.fields.pivotY?.numberValue ?? selectedNode.pivotY,
            };
            if (pivot.x !== selectedNode.pivotX || pivot.y !== selectedNode.pivotY) props.pivot = pivot;
            if (selectedNode.type !== "GMovieClip") {
                const pivotAsAnchor = this.fields.pivotAnchor
                    ? this.fields.pivotAnchor.selected
                    : selectedNode.pivotAsAnchor;
                if (pivotAsAnchor !== selectedNode.pivotAsAnchor) props.pivotAsAnchor = pivotAsAnchor;
            }
        }
        return {
            kind: "setDisplayNodeProps",
            selector: {
                packageId: selectedPackage.id,
                componentResourceId: selectedComponent.id,
                displayNodeId: selectedNode.id,
            },
            props,
        };
    }

    renderResource(resource: ProjectSnapshotResource | null): void {
        if (!resource) {
            this.renderLines(["未选择资源"]);
            return;
        }
        const lines = [
            resource.name || "未命名资源",
            `${resource.type} · ${resource.path || "/"}`,
        ];
        if (resource.width !== undefined || resource.height !== undefined) {
            lines.push(`${resource.width ?? "-"} × ${resource.height ?? "-"}`);
        }
        this.panel.renderSummary("资源", lines);
        this.layout();
    }

    renderResourceFolder(folder: ProjectSnapshotResourceFolder | null): void {
        if (!folder) {
            this.renderLines(["未选择资源文件夹"]);
            return;
        }
        const lines = [
            folder.path || "根目录",
            `分支：${folder.branch || "main"}${folder.atlas ? ` · 图集：${folder.atlas}` : ""}`,
        ];
        this.panel.renderSummary("文件夹", lines);
        this.layout();
    }

    renderSnapshot(options: InspectorSnapshotOptions): void {
        const {
            snapshot,
            workingProject,
            selectedPackage,
            selectedComponent,
            selectedNode,
            selectedNodes,
            commandSession,
        } = options;
        const { leadingLines } = buildSnapshotInspectorPresentation({
            snapshot,
            selectedPackage,
            selectedComponent,
            selectedNode,
            selectedNodeCount: selectedNodes.length,
        });
        if (selectedNode) this.renderLines([]);
        else this.panel.renderSummary(selectedComponent ? "组件" : selectedPackage ? "资源包" : "项目", leadingLines);
        if (selectedPackage && selectedComponent && !selectedNode) {
            this.panel.appendComponentEditor(selectedComponent, commandSession.liveSession);
        } else if (selectedPackage && selectedComponent && selectedNode && selectedNodes.length === 1) {
            const inspection = inspectDisplayNode(workingProject, {
                packageId: selectedPackage.id,
                componentResourceId: selectedComponent.id,
                displayNodeId: selectedNode.id,
            });
            this.panel.appendCommandEditor({
                selectedNode,
                selectedPackage,
                liveSession: commandSession.liveSession,
                componentCustomPropertiesEditable: options.componentCustomPropertiesEditable,
                relationCount: inspection?.relationCount || 0,
                gearCount: inspection?.gears.length || 0,
                actionsEnabled: Boolean(inspection?.duplicateEnabled),
            });
        } else if (selectedPackage && selectedComponent && selectedNode) {
            this.panel.appendMultiSelectionEditor({
                selectedNodes,
                liveSession: commandSession.liveSession,
            });
        }
        this.layout();
    }
}

export {
    isInspectorTextEditable,
    type InspectorPanelAction,
} from "./InspectorCommandPanel";
