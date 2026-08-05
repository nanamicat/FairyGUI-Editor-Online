import type { ProjectSnapshotDisplayNode, ProjectSnapshotPackage } from "../model/ProjectSnapshot";
import { resolveDesktopCanvasSharedValue } from "../runtime/DesktopCanvasInteraction";
import {
    addInspectorLine,
    createInspectorButton,
    createInspectorNumericInput,
    createTimelineComboBox,
    setActionEnabled,
} from "./EditorFormControls";
import type { EditorNumericInput, EditorTextInput } from "./EditorUiExtensions";

const INSPECTOR_LINE_HEIGHT = 18;

export type InspectorPanelAction =
    | "command:apply"
    | "command:sourceSize"
    | "properties:common"
    | "properties:text"
    | "properties:graph"
    | "properties:group"
    | "properties:loader"
    | "properties:loader3d"
    | "properties:list"
    | "properties:componentInstance"
    | "properties:componentCustomValues"
    | "display:relations"
    | "display:gears";

type InspectorPanelFields = {
    x: EditorNumericInput | null;
    y: EditorNumericInput | null;
    width: EditorNumericInput | null;
    height: EditorNumericInput | null;
    minWidth: EditorNumericInput | null;
    minHeight: EditorNumericInput | null;
    maxWidth: EditorNumericInput | null;
    maxHeight: EditorNumericInput | null;
    scaleX: EditorNumericInput | null;
    scaleY: EditorNumericInput | null;
    skewX: EditorNumericInput | null;
    skewY: EditorNumericInput | null;
    aspect: fgui.GButton | null;
    visible: fgui.GButton | null;
    touchable: fgui.GButton | null;
    grayed: fgui.GButton | null;
    alpha: EditorNumericInput | null;
    rotation: EditorNumericInput | null;
    multiVisible: fgui.GComboBox | null;
    multiTouchable: fgui.GComboBox | null;
    multiGrayed: fgui.GComboBox | null;
    pivotX: EditorNumericInput | null;
    pivotY: EditorNumericInput | null;
    pivotAnchor: fgui.GButton | null;
    tooltips: fgui.GTextInput | null;
    customData: fgui.GTextInput | null;
    blendMode: fgui.GComboBox | null;
    filter: fgui.GComboBox | null;
    textEditor: {
        text: fgui.GLabel;
        font: fgui.GLabel;
        fontSize: fgui.GLabel;
        color: string;
        leading: EditorNumericInput;
        letterSpacing: EditorNumericInput;
        align: fgui.Controller;
        verticalAlign: fgui.Controller;
        autoSize: fgui.GComboBox;
        ubbEnabled: fgui.GButton;
        varsEnabled: fgui.GButton;
        singleLine: fgui.GButton;
        bold: fgui.GButton;
        italic: fgui.GButton;
        underline: fgui.GButton;
        strike: fgui.GButton;
        clearOnPublish: fgui.GButton;
    } | null;
};

type CommandEditorOptions = {
    selectedNode: ProjectSnapshotDisplayNode;
    selectedPackage: ProjectSnapshotPackage;
    liveSession: boolean;
    componentCustomPropertiesEditable: boolean;
    relationCount: number;
    gearCount: number;
    actionsEnabled: boolean;
};

type MultiSelectionEditorOptions = {
    selectedNodes: ProjectSnapshotDisplayNode[];
    liveSession: boolean;
};

function createFields(): InspectorPanelFields {
    return {
        x: null,
        y: null,
        width: null,
        height: null,
        minWidth: null,
        minHeight: null,
        maxWidth: null,
        maxHeight: null,
        scaleX: null,
        scaleY: null,
        skewX: null,
        skewY: null,
        aspect: null,
        visible: null,
        touchable: null,
        grayed: null,
        alpha: null,
        rotation: null,
        multiVisible: null,
        multiTouchable: null,
        multiGrayed: null,
        pivotX: null,
        pivotY: null,
        pivotAnchor: null,
        tooltips: null,
        customData: null,
        blendMode: null,
        filter: null,
        textEditor: null,
    };
}

function configurePanelNumericInput(
    panel: fgui.GComponent,
    name: string,
    value: number,
    editable: boolean,
    options: Parameters<EditorNumericInput["configure"]>[0] = {},
): EditorNumericInput {
    const input = panel.getChild(name) as EditorNumericInput;
    input.configure(options);
    input.text = String(value);
    input.touchable = editable;
    input.grayed = !editable;
    input.editable = editable;
    input.titleColor = editable ? "#bdbdbd" : "#878787";
    return input;
}

function configurePanelButton(
    panel: fgui.GComponent,
    name: string,
    title: string,
    selected: boolean,
    editable: boolean,
): fgui.GButton {
    const button = panel.getChild(name).asButton;
    button.title = title;
    button.selected = selected;
    button.touchable = editable;
    button.grayed = !editable;
    return button;
}

export class InspectorCommandPanel {
    fields = createFields();
    private textColorPicker: HTMLInputElement | null = null;
    private textFontMenu: fgui.PopupMenu | null = null;
    private readonly sectionPanels = new Set<fgui.GComponent>();

    constructor(
        private readonly list: fgui.GList,
        private readonly onAction: (action: InspectorPanelAction) => void,
        private readonly setDebugAttribute: (name: string, value: string) => void,
    ) {}

    clear(): void {
        this.textColorPicker?.remove();
        this.textColorPicker = null;
        this.textFontMenu?.dispose();
        this.textFontMenu = null;
        for (const panel of this.sectionPanels) {
            if (!panel.parent) panel.dispose();
        }
        this.sectionPanels.clear();
        this.fields = createFields();
    }

    renderLines(details: string[]): void {
        this.clear();
        this.list.removeChildren(0, -1, true);
        this.appendLines(details, "projectInspectorLine", 8, "#ffffff");
    }

    renderSummary(title: string, details: string[]): void {
        this.clear();
        this.list.removeChildren(0, -1, true);
        const lineWidth = Math.max(120, this.list.width - 16);
        const panel = new fgui.GComponent();
        panel.name = "inspectorSummaryPanel";
        panel.setSize(lineWidth, Math.max(30, 10 + details.length * INSPECTOR_LINE_HEIGHT));
        this.appendLinesTo(panel, details);
        this.appendSection("Summary", title, panel, lineWidth);
    }

    private appendLinesTo(panel: fgui.GComponent, details: string[]): void {
        for (let index = 0; index < details.length; index += 1) {
            addInspectorLine(
                panel,
                `summaryLine${index}`,
                details[index],
                10,
                7 + index * INSPECTOR_LINE_HEIGHT,
                Math.max(100, panel.width - 20),
                index === 0 ? "#ffffff" : "#bdbdbd",
            );
        }
    }

    appendLines(
        details: string[],
        namePrefix: string,
        y: number,
        firstColor: string,
    ): number {
        for (let index = 0; index < details.length; index += 1) {
            addInspectorLine(
                this.list,
                `${namePrefix}${index}`,
                details[index],
                10,
                y + index * INSPECTOR_LINE_HEIGHT,
                260,
                index === 0 ? firstColor : "#bdbdbd",
            );
        }
        return y + details.length * INSPECTOR_LINE_HEIGHT;
    }

    layout(): void {
        const lineWidth = Math.max(120, this.list.width - 16);
        for (let index = 0; index < this.list.numChildren; index += 1) {
            const child = this.list.getChildAt(index);
            if (child.name.indexOf("projectInspectorLine") === 0) {
                child.setSize(lineWidth, 20);
            } else if (child.name.startsWith("inspectorSectionTitle")) {
                child.setSize(lineWidth, 20);
            } else if (
                child.name === "inspectorInfoPanel"
                || child.name === "commandBasicPanel"
                || child.name === "commandTextPanel"
                || child.name === "commandEffectPanel"
                || child.name === "commandOtherPanel"
                || child.name === "multiSelectionPanel"
            ) {
                child.setSize(lineWidth, child.height);
            } else if (child.name.startsWith("inspectorActionPanel")) {
                child.setSize(lineWidth, child.height);
                const label = child.asCom.getChild("label");
                const action = child.asCom.getChild("action");
                label?.setSize(76, 20);
                action?.setXY(87, 5);
                action?.setSize(Math.max(72, lineWidth - 97), 22);
            } else if (child.name === "multiSelectionCommonPanel") {
                child.setSize(lineWidth, child.height);
                child.asCom.getChild("multiSelectionInputRotation")?.setSize(Math.max(54, lineWidth - 184), 20);
                for (const name of ["multiSelectionVisible", "multiSelectionTouchable", "multiSelectionGrayed"]) {
                    child.asCom.getChild(name)?.setSize(Math.max(90, lineWidth - 86), 20);
                }
            } else if (child.name === "inspectorSummaryPanel") {
                child.setSize(lineWidth, child.height);
                for (let lineIndex = 0; lineIndex < child.asCom.numChildren; lineIndex += 1) {
                    child.asCom.getChildAt(lineIndex).setSize(Math.max(100, lineWidth - 20), 20);
                }
            }
        }
    }

    private appendSection(name: string, title: string, panel: fgui.GComponent, lineWidth: number): void {
        const titleBar = fgui.UIPackage.createObject("Builder", "TitleBar").asButton;
        titleBar.name = `inspectorSectionTitle${name}`;
        titleBar.title = title;
        titleBar.changeStateOnClick = false;
        titleBar.setSize(lineWidth, 20);
        this.sectionPanels.add(panel);
        this.list.addChild(titleBar);
        this.list.addChild(panel);
        titleBar.getChild("button").onClick(this, () => {
            titleBar.selected = !titleBar.selected;
            if (titleBar.selected) {
                if (panel.parent) this.list.removeChild(panel);
            } else if (!panel.parent) {
                this.list.addChildAt(panel, this.list.getChildIndex(titleBar) + 1);
            }
        });
    }

    private appendActionSection(
        name: string,
        title: string,
        label: string,
        actionTitle: string,
        action: InspectorPanelAction,
        enabled: boolean,
        lineWidth: number,
    ): void {
        const panel = new fgui.GComponent();
        panel.name = `inspectorActionPanel${name}`;
        panel.setSize(lineWidth, 32);
        addInspectorLine(panel, "label", label, 4, 9, 76, "#bdbdbd");
        const button = createInspectorButton(panel, "action", actionTitle, 87, 5, Math.max(72, lineWidth - 97));
        setActionEnabled(button, enabled);
        this.bind(button, action);
        this.appendSection(name, title, panel, lineWidth);
    }

    private bindInputCommit(input: fgui.GTextInput | null): void {
        if (!input) return;
        input.on(Laya.Event.BLUR, this, this.emit, ["command:apply"]);
        input.on(Laya.Event.KEY_DOWN, this, (event: Laya.Event) => {
            if (event.key === "Enter" && input.singleLine) input.nativeInput.focus = false;
        });
    }

    private bindStateCommit(target: fgui.GObject | fgui.Controller | null): void {
        target?.on(fgui.Events.STATE_CHANGED, this, this.emit, ["command:apply"]);
    }

    appendCommandEditor(options: CommandEditorOptions): void {
        const {
            selectedNode,
            selectedPackage,
            liveSession,
            componentCustomPropertiesEditable,
            relationCount,
            gearCount,
            actionsEnabled,
        } = options;
        const lineWidth = Math.max(120, this.list.width - 16);
        const textEditable = isInspectorTextEditable(selectedNode);
        const graphEditable = selectedNode.type === "GGraph";
        const groupEditable = selectedNode.type === "GGroup";
        const loaderEditable = selectedNode.type === "GLoader";
        const loader3DEditable = selectedNode.type === "GLoader3D";
        const listEditable = selectedNode.type === "GList" || selectedNode.type === "GTree";
        const componentInstanceEditable = selectedNode.type === "GComponent"
            && Boolean(selectedNode.componentInstanceProperties);
        const pivotEditable = selectedNode.type !== "GGroup" && selectedNode.type !== "GLoader3D";
        const pivotAnchorEditable = pivotEditable && selectedNode.type !== "GMovieClip";
        if (selectedNode.src) {
            const infoPanel = fgui.UIPackage.createObject("Builder", "InfoPropsPanel").asCom;
            infoPanel.name = "inspectorInfoPanel";
            infoPanel.getChild("title").text = `${selectedNode.type} · ${selectedNode.name || selectedNode.id}`;
            this.list.addChild(infoPanel);
        }

        if (!groupEditable) {
            const basicPanel = fgui.UIPackage.createObject("Builder", "BasicPropsPanel").asCom;
            basicPanel.name = "commandBasicPanel";
            const name = basicPanel.getChild("name").asComboBox;
            name.text = selectedNode.name || selectedNode.id;
            name.touchable = false;
            name.grayed = true;
            this.fields.x = configurePanelNumericInput(basicPanel, "x", selectedNode.x, liveSession);
            this.fields.y = configurePanelNumericInput(basicPanel, "y", selectedNode.y, liveSession);
            this.fields.width = configurePanelNumericInput(basicPanel, "width", selectedNode.width, liveSession, { min: 0 });
            this.fields.height = configurePanelNumericInput(basicPanel, "height", selectedNode.height, liveSession, { min: 0 });
            this.fields.minWidth = configurePanelNumericInput(basicPanel, "minWidth", selectedNode.minSize.width, liveSession, { min: 0 });
            this.fields.minHeight = configurePanelNumericInput(basicPanel, "minHeight", selectedNode.minSize.height, liveSession, { min: 0 });
            this.fields.maxWidth = configurePanelNumericInput(basicPanel, "maxWidth", selectedNode.maxSize.width, liveSession, { min: 0 });
            this.fields.maxHeight = configurePanelNumericInput(basicPanel, "maxHeight", selectedNode.maxSize.height, liveSession, { min: 0 });
            this.fields.scaleX = configurePanelNumericInput(basicPanel, "scaleX", selectedNode.scale.x, liveSession);
            this.fields.scaleY = configurePanelNumericInput(basicPanel, "scaleY", selectedNode.scale.y, liveSession);
            this.fields.skewX = configurePanelNumericInput(basicPanel, "skewX", selectedNode.skew.x, liveSession);
            this.fields.skewY = configurePanelNumericInput(basicPanel, "skewY", selectedNode.skew.y, liveSession);
            this.fields.pivotX = configurePanelNumericInput(basicPanel, "pivotX", selectedNode.pivotX, liveSession && pivotEditable, { min: 0, max: 1 });
            this.fields.pivotY = configurePanelNumericInput(basicPanel, "pivotY", selectedNode.pivotY, liveSession && pivotEditable, { min: 0, max: 1 });
            this.fields.alpha = configurePanelNumericInput(basicPanel, "alpha", selectedNode.alpha, liveSession, { min: 0, max: 1 });
            this.fields.rotation = configurePanelNumericInput(basicPanel, "rotation", selectedNode.rotation, liveSession);
            this.fields.aspect = configurePanelButton(basicPanel, "aspectLocked", "保持比例", selectedNode.aspect, liveSession);
            this.fields.visible = configurePanelButton(basicPanel, "visible", "不可见", !selectedNode.visible, liveSession);
            this.fields.grayed = configurePanelButton(basicPanel, "grayed", "变灰", selectedNode.grayed, liveSession);
            this.fields.touchable = configurePanelButton(basicPanel, "touchable", "不可触摸", !selectedNode.touchable, liveSession);
            this.fields.pivotAnchor = configurePanelButton(
                basicPanel,
                "anchor",
                "同时作为锚点",
                selectedNode.pivotAsAnchor,
                liveSession && pivotAnchorEditable,
            );
            const useSourceSize = basicPanel.getChild("useSourceSize");
            useSourceSize.visible = true;
            useSourceSize.touchable = liveSession && Boolean(selectedNode.src);
            useSourceSize.grayed = !useSourceSize.touchable;
            useSourceSize.tooltips = selectedNode.src ? "恢复为资源原始尺寸" : "当前对象没有源资源。";
            if (useSourceSize.touchable) this.bind(useSourceSize.asButton, "command:sourceSize");
            basicPanel.getController("showRestrictSize").selectedIndex = (
                selectedNode.minSize.width
                || selectedNode.minSize.height
                || selectedNode.maxSize.width
                || selectedNode.maxSize.height
            ) ? 1 : 0;
            this.appendSection("Basic", "基本属性", basicPanel, lineWidth);
            for (const input of [
                this.fields.x, this.fields.y, this.fields.width, this.fields.height,
                this.fields.minWidth, this.fields.minHeight, this.fields.maxWidth, this.fields.maxHeight,
                this.fields.scaleX, this.fields.scaleY, this.fields.skewX, this.fields.skewY,
                this.fields.pivotX, this.fields.pivotY, this.fields.alpha, this.fields.rotation,
            ]) this.bindInputCommit(input?.input || null);
            for (const button of [
                this.fields.aspect, this.fields.visible, this.fields.grayed,
                this.fields.touchable, this.fields.pivotAnchor,
            ]) this.bindStateCommit(button);
        }

        if (textEditable) {
            const textPanel = this.appendTextEditor(selectedPackage, selectedNode, liveSession, lineWidth);
            this.appendSection("Text", "文本", textPanel, lineWidth);
        } else if (graphEditable) {
            this.appendActionSection("Graph", "图形", "形状与颜色", "编辑…", "properties:graph", liveSession, lineWidth);
        } else if (groupEditable) {
            this.appendActionSection("Group", "组", "布局与包围", "编辑…", "properties:group", liveSession, lineWidth);
        } else if (loaderEditable) {
            this.appendActionSection("Loader", "装载器", "内容与填充", "编辑…", "properties:loader", liveSession, lineWidth);
        } else if (loader3DEditable) {
            this.appendActionSection("Loader3D", "3D 装载器", "播放与填充", "编辑…", "properties:loader3d", liveSession, lineWidth);
        } else if (listEditable) {
            this.appendActionSection("List", selectedNode.type === "GTree" ? "树" : "列表", "内容与滚动", "编辑…", "properties:list", liveSession, lineWidth);
        } else if (componentInstanceEditable) {
            const extensionType = selectedNode.componentInstanceProperties!.extensionType;
            this.appendActionSection("ComponentInstance", extensionType, "实例属性", "编辑…", "properties:componentInstance", liveSession, lineWidth);
        }

        if (componentCustomPropertiesEditable) {
            this.appendActionSection("Custom", "自定义属性", "组件属性值", "编辑…", "properties:componentCustomValues", liveSession, lineWidth);
        }

        this.appendActionSection("Gear", "齿轮", `${gearCount} 个齿轮`, "编辑…", "display:gears", actionsEnabled && liveSession, lineWidth);
        this.appendActionSection("Relation", "关联", `${relationCount} 个关联`, "编辑…", "display:relations", actionsEnabled && liveSession, lineWidth);

        if (!groupEditable) {
            const effectPanel = fgui.UIPackage.createObject("Builder", "EffectPropsPanel").asCom;
            effectPanel.name = "commandEffectPanel";
            const blendModes = ["normal", "none", "add", "multiply", "screen", "erase"];
            this.fields.blendMode = effectPanel.getChild("blendMode").asComboBox;
            this.fields.blendMode.items = ["正常", "无", "叠加", "正片叠底", "屏幕", "擦除"];
            this.fields.blendMode.values = blendModes;
            this.fields.blendMode.selectedIndex = Math.max(0, blendModes.indexOf(selectedNode.blendMode));
            this.fields.filter = effectPanel.getChild("filter").asComboBox;
            this.fields.filter.items = ["无", "颜色调整"];
            this.fields.filter.values = ["", "color"];
            this.fields.filter.selectedIndex = selectedNode.filter === "color" ? 1 : 0;
            for (const control of [this.fields.blendMode, this.fields.filter]) {
                control.touchable = liveSession;
                control.grayed = !liveSession;
                this.bindStateCommit(control);
            }
            const filterEdit = effectPanel.getChild("filterEdit").asButton;
            filterEdit.visible = selectedNode.filter === "color";
            setActionEnabled(filterEdit, liveSession);
            this.bind(filterEdit, "properties:common");
            this.appendSection("Effect", "效果", effectPanel, lineWidth);
        }

        if (!groupEditable || selectedNode.groupProperties?.advanced) {
            const otherPanel = fgui.UIPackage.createObject("Builder", "EtcPropsPanel").asCom;
            otherPanel.name = "commandOtherPanel";
            otherPanel.getController("noTips").selectedIndex = 0;
            const tooltips = otherPanel.getChild("tooltips") as EditorTextInput;
            const customData = otherPanel.getChild("customData") as EditorTextInput;
            for (const [field, value] of [[tooltips, selectedNode.tooltips], [customData, selectedNode.customData]] as const) {
                field.text = value;
                field.touchable = liveSession;
                field.grayed = !liveSession;
                field.input.editable = liveSession;
                this.bindInputCommit(field.input);
            }
            this.fields.tooltips = tooltips.input;
            this.fields.customData = customData.input;
            this.appendSection("Other", "其他", otherPanel, lineWidth);
        }

        this.setDebugAttribute(
            "data-fairy-editor-inspector-sections",
            [
                selectedNode.src ? "info" : "",
                groupEditable ? "" : "basic",
                textEditable ? "text" : graphEditable || groupEditable || loaderEditable || loader3DEditable || listEditable || componentInstanceEditable ? "type" : "",
                componentCustomPropertiesEditable ? "custom" : "",
                "gear", "relation",
                groupEditable ? "" : "effect",
                !groupEditable || selectedNode.groupProperties?.advanced ? "other" : "",
            ].filter(Boolean).join(","),
        );
    }

    private appendTextEditor(
        selectedPackage: ProjectSnapshotPackage,
        selectedNode: ProjectSnapshotDisplayNode,
        editable: boolean,
        lineWidth: number,
    ): fgui.GComponent {
        const panel = fgui.UIPackage.createObject("Builder", "TextPropsPanel").asCom;
        panel.name = "commandTextPanel";
        panel.setSize(lineWidth, 255);
        const label = (name: string): fgui.GLabel => panel.getChild(name).asLabel;
        const check = (name: string): fgui.GButton => panel.getChild(name).asButton;
        const setEditable = (child: fgui.GObject): void => {
            child.touchable = editable;
            child.grayed = !editable;
        };
        label("text").title = selectedNode.text;
        label("font").title = selectedNode.font;
        label("fontSize").title = String(selectedNode.fontSize);
        const leading = panel.getChild("leading") as EditorNumericInput;
        const letterSpacing = panel.getChild("letterSpacing") as EditorNumericInput;
        leading.text = String(selectedNode.textProperties.leading);
        letterSpacing.text = String(selectedNode.textProperties.letterSpacing);
        panel.getController("align").selectedIndex = selectedNode.textProperties.align;
        panel.getController("verticalAlign").selectedIndex = selectedNode.textProperties.vAlign;
        const autoSize = panel.getChild("autoSize").asComboBox;
        autoSize.items = ["无", "宽高", "高度", "缩小", "省略"];
        autoSize.values = ["0", "1", "2", "3", "4"];
        autoSize.selectedIndex = selectedNode.textProperties.autoSize;
        check("ubbEnabled").selected = selectedNode.textProperties.ubbEnabled;
        check("varsEnabled").selected = selectedNode.textProperties.templateVarsEnabled === true;
        check("singleLine").selected = selectedNode.textProperties.singleLine;
        check("bold").selected = selectedNode.textProperties.bold;
        check("italic").selected = selectedNode.textProperties.italic;
        check("underline").selected = selectedNode.textProperties.underline;
        check("strike").selected = selectedNode.textProperties.strikethrough;
        const clearOnPublish = check("clearOnPublish");
        clearOnPublish.selected = selectedNode.textProperties.autoClearText;
        setEditable(clearOnPublish);
        clearOnPublish.tooltips = "发布时清除文本";
        const inputEdit = panel.getChild("inputEdit").asButton;
        inputEdit.visible = true;
        inputEdit.tooltips = "编辑文本、输入和效果属性";
        setActionEnabled(inputEdit, editable);
        this.bind(inputEdit, "properties:text");
        for (const name of [
            "text", "font", "fontSize", "color", "leading", "letterSpacing", "autoSize",
            "ubbEnabled", "singleLine", "bold", "italic", "underline", "strike",
            "align", "btnAlignCenter", "btnAlignRight", "verticalAlign", "btnAlignMiddle", "btnAlignBottom",
        ]) setEditable(panel.getChild(name));
        setEditable(panel.getChild("varsEnabled"));
        if (selectedNode.type === "GRichTextField") {
            const varsEnabled = panel.getChild("varsEnabled");
            varsEnabled.touchable = false;
            varsEnabled.grayed = true;
            varsEnabled.tooltips = "富文本节点不支持模板变量。";
        }

        const color = /^#[0-9a-f]{6}$/i.test(selectedNode.color) ? selectedNode.color : "#000000";
        const colorButton = panel.getChild("color").asButton;
        const colorSwatch = colorButton.getChild("n1").asGraph;
        colorSwatch.fillColor = color;
        colorButton.tooltips = `文本颜色：${color}`;
        const textEditor = {
            text: label("text"),
            font: label("font"),
            fontSize: label("fontSize"),
            color,
            leading,
            letterSpacing,
            align: panel.getController("align"),
            verticalAlign: panel.getController("verticalAlign"),
            autoSize,
            ubbEnabled: check("ubbEnabled"),
            varsEnabled: check("varsEnabled"),
            singleLine: check("singleLine"),
            bold: check("bold"),
            italic: check("italic"),
            underline: check("underline"),
            strike: check("strike"),
            clearOnPublish,
        };
        this.fields.textEditor = textEditor;
        if (!editable) return panel;

        for (const field of [textEditor.text, textEditor.font, textEditor.fontSize]) {
            const input = field.getTextField();
            if (input instanceof fgui.GTextInput) this.bindInputCommit(input);
        }
        this.bindInputCommit(leading.input);
        this.bindInputCommit(letterSpacing.input);
        for (const button of [
            textEditor.ubbEnabled, textEditor.varsEnabled, textEditor.singleLine,
            textEditor.bold, textEditor.italic, textEditor.underline, textEditor.strike,
            textEditor.clearOnPublish,
        ]) this.bindStateCommit(button);
        this.bindStateCommit(textEditor.autoSize);
        this.bindStateCommit(textEditor.align);
        this.bindStateCommit(textEditor.verticalAlign);

        colorButton.onClick(this, () => {
            this.textColorPicker?.remove();
            const input = document.createElement("input");
            input.type = "color";
            input.value = textEditor.color;
            input.setAttribute("aria-label", "Text color");
            input.setAttribute("data-fairy-editor-text-color", selectedNode.id);
            input.style.position = "fixed";
            input.style.left = "-100px";
            input.style.top = "-100px";
            input.addEventListener("input", () => {
                textEditor.color = input.value;
                colorSwatch.fillColor = input.value;
                colorButton.tooltips = `文本颜色：${input.value}`;
            });
            input.addEventListener("change", () => {
                this.emit("command:apply");
                input.remove();
                if (this.textColorPicker === input) this.textColorPicker = null;
            }, { once: true });
            document.body.appendChild(input);
            this.textColorPicker = input;
            input.click();
        });
        const fontControl = panel.getChild("font").asCom;
        const showFontMenu = (anchor: fgui.GObject): void => {
            this.textFontMenu?.dispose();
            const menu = new fgui.PopupMenu();
            this.textFontMenu = menu;
            const manual = menu.addItem("系统 / 自定义（手动输入）", () => undefined);
            manual.enabled = false;
            for (const resource of selectedPackage.resources) {
                if (resource.type !== "FontResource") continue;
                menu.addItem(resource.name || resource.id, () => {
                    textEditor.font.title = `ui://${selectedPackage.id}${resource.id}`;
                    this.setDebugAttribute("data-fairy-editor-font-resource", resource.id);
                    this.emit("command:apply");
                });
            }
            menu.show(anchor);
        };
        for (const name of ["chooseFont", "preset"]) {
            const child = fontControl.getChild(name);
            child?.onClick(this, () => showFontMenu(child));
        }
        return panel;
    }

    appendMultiSelectionEditor(options: MultiSelectionEditorOptions): void {
        const { selectedNodes, liveSession } = options;
        const lineWidth = Math.max(120, this.list.width - 16);
        const sharedNumber = (values: number[]): string => {
            const value = resolveDesktopCanvasSharedValue(values);
            return value === undefined ? "" : String(value);
        };
        const createSharedBooleanCombo = (
            name: string,
            label: string,
            top: number,
            values: boolean[],
        ): fgui.GComboBox => {
            const value = resolveDesktopCanvasSharedValue(values);
            addInspectorLine(commonPanel, `${name}Label`, label, 10, top + 4, 62, "#bdbdbd");
            return createTimelineComboBox(
                commonPanel,
                name,
                76,
                top,
                Math.max(90, lineWidth - 86),
                ["保持原值", "是", "否"],
                ["", "true", "false"],
                value === undefined ? 0 : value ? 1 : 2,
            );
        };
        const panel = fgui.UIPackage.createObject("Builder", "MultiSelectionPanel").asCom;
        panel.name = "multiSelectionPanel";
        panel.setSize(lineWidth, panel.height);
        this.appendSection("MultiSelection", "多选属性", panel, lineWidth);
        const configureShared = (
            name: "x" | "y" | "width" | "height",
            values: number[],
            options: Parameters<EditorNumericInput["configure"]>[0] = {},
        ): EditorNumericInput => {
            const input = panel.getChild(name) as EditorNumericInput;
            input.configure(options);
            input.text = sharedNumber(values);
            input.promptText = "混合/保持";
            input.touchable = liveSession;
            input.grayed = !liveSession;
            input.editable = liveSession;
            return input;
        };
        this.fields.x = configureShared("x", selectedNodes.map((node) => node.x));
        this.fields.y = configureShared("y", selectedNodes.map((node) => node.y));
        this.fields.width = configureShared("width", selectedNodes.map((node) => node.width), { min: 0 });
        this.fields.height = configureShared("height", selectedNodes.map((node) => node.height), { min: 0 });
        const commonPanel = new fgui.GComponent();
        commonPanel.name = "multiSelectionCommonPanel";
        commonPanel.setSize(lineWidth, 116);
        addInspectorLine(commonPanel, "multiSelectionAlphaLabel", "透明度", 10, 10, 48, "#bdbdbd");
        this.fields.alpha = createInspectorNumericInput(commonPanel, "multiSelectionInputAlpha", 62, 6, 64, sharedNumber(selectedNodes.map((node) => node.alpha)), liveSession, { min: 0, max: 1 });
        addInspectorLine(commonPanel, "multiSelectionRotationLabel", "旋转", 136, 10, 34, "#bdbdbd");
        this.fields.rotation = createInspectorNumericInput(commonPanel, "multiSelectionInputRotation", 174, 6, Math.max(54, lineWidth - 184), sharedNumber(selectedNodes.map((node) => node.rotation)), liveSession);
        for (const input of [
            this.fields.x,
            this.fields.y,
            this.fields.width,
            this.fields.height,
            this.fields.alpha,
            this.fields.rotation,
        ]) {
            if (input && !input.text) input.promptText = "混合/保持";
            this.bindInputCommit(input?.input || null);
        }
        this.fields.multiVisible = createSharedBooleanCombo("multiSelectionVisible", "可见", 32, selectedNodes.map((node) => node.visible));
        this.fields.multiTouchable = createSharedBooleanCombo("multiSelectionTouchable", "可触摸", 58, selectedNodes.map((node) => node.touchable));
        this.fields.multiGrayed = createSharedBooleanCombo("multiSelectionGrayed", "变灰", 84, selectedNodes.map((node) => node.grayed));
        for (const control of [this.fields.multiVisible, this.fields.multiTouchable, this.fields.multiGrayed]) {
            control.touchable = liveSession;
            control.grayed = !liveSession;
            this.bindStateCommit(control);
        }
        this.appendSection("MultiCommon", "基本属性", commonPanel, lineWidth);
    }

    private bind(button: fgui.GButton, action: InspectorPanelAction): void {
        button.onClick(this, this.emit, [action]);
    }

    private emit(action: InspectorPanelAction): void {
        this.onAction(action);
    }

}

export function isInspectorTextEditable(node: ProjectSnapshotDisplayNode): boolean {
    return node.type.toLowerCase().indexOf("text") >= 0 || node.text.length > 0;
}
