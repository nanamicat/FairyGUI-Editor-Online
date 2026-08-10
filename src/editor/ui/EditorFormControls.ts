import {
    EditorNumericInput,
    EditorTextInput,
    type EditorNumericInputOptions,
} from "./EditorUiExtensions";

export function addDialogBackground(content: fgui.GComponent, color = "#303030"): void {
    const frameBackground = content.getChild("frame")?.asCom?.getChild("n0");
    if (frameBackground)
        frameBackground.visible = false;
    const background = new fgui.GGraph();
    background.name = "desktopDialogBackground";
    background.touchable = false;
    background.setSize(content.width, content.height);
    background.drawRect(0, "#000000", color);
    content.addChildAt(background, 0);
}

export function addInspectorLine(
    list: fgui.GComponent,
    name: string,
    text: string,
    x: number,
    y: number,
    width: number,
    color: string,
): fgui.GTextField {
    const line = new fgui.GTextField();
    line.name = name;
    line.fontSize = 12;
    line.color = color;
    line.singleLine = true;
    line.text = text;
    line.setXY(x, y);
    line.setSize(width, 20);
    list.addChild(line);
    return line;
}

export function createInspectorTextInput(
    list: fgui.GComponent,
    name: string,
    x: number,
    y: number,
    width: number,
    text: string,
    editable: boolean,
): fgui.GTextInput {
    const inputHost = fgui.UIPackage.createObject("Basic", "TextInput") as EditorTextInput;
    inputHost.name = name;
    inputHost.setXY(x, y);
    inputHost.setSize(width, 20);
    inputHost.touchable = editable;
    inputHost.grayed = !editable;
    list.addChild(inputHost);

    const input = inputHost.input;
    input.text = text;
    input.fontSize = 12;
    input.color = editable ? "#bdbdbd" : "#878787";
    input.editable = editable;
    return input;
}

export function createInspectorNumericInput(
    list: fgui.GComponent,
    name: string,
    x: number,
    y: number,
    width: number,
    text: string,
    editable: boolean,
    options: EditorNumericInputOptions = {},
): EditorNumericInput {
    const input = fgui.UIPackage.createObject("Basic", "NumericInput") as EditorNumericInput;
    input.name = name;
    input.setXY(x, y);
    input.setSize(width, 20);
    input.touchable = editable;
    input.grayed = !editable;
    input.text = text;
    input.titleFontSize = 12;
    input.titleColor = editable ? "#bdbdbd" : "#878787";
    input.editable = editable;
    input.configure(options);
    list.addChild(input);
    return input;
}

export function createInspectorButton(
    list: fgui.GComponent,
    name: string,
    title: string,
    x: number,
    y: number,
    width: number,
): fgui.GButton {
    const button = fgui.UIPackage.createObject("Basic", "TextButton").asButton;
    button.name = name;
    button.title = title;
    button.setXY(x, y);
    button.setSize(width, 22);
    list.addChild(button);
    return button;
}

export function setOverflowText(target: fgui.GTextField, value: string): void {
    target.text = value;
    target.singleLine = true;
    target.displayObject.overflow = Laya.Text.ELLIPSIS;
    target.tooltips = value;
}

export function setOverflowButtonTitle(button: fgui.GButton, value: string): void {
    button.title = value;
    button.tooltips = value;
    const title = button.getChild("title")?.asTextField;
    if (title) title.displayObject.overflow = Laya.Text.ELLIPSIS;
}

function estimateSingleLineTextWidth(target: fgui.GTextField, value: string): number {
    const fontSize = target.fontSize || 12;
    let units = 0;
    for (const character of value) {
        if (/\s/.test(character)) units += 0.35;
        else if (/[\u2e80-\u9fff\uf900-\ufaff]/u.test(character)) units += 1;
        else if (/[A-Z0-9]/.test(character)) units += 0.68;
        else units += 0.58;
    }
    return Math.ceil(units * fontSize);
}

export function sizeButtonToTitle(button: fgui.GButton, value: string, minWidth = 0): void {
    setOverflowButtonTitle(button, value);
    const title = button.getChild("title")?.asTextField;
    if (!title) return;
    title.ensureSizeCorrect();
    const textWidth = Math.max(Math.ceil(title.textWidth), estimateSingleLineTextWidth(title, value));
    const width = Math.max(minWidth, title.x + textWidth + 5);
    button.setSize(width, button.height);
    title.setSize(Math.max(1, width - title.x - 5), title.height);
}

export function fitSingleRowButtons(list: fgui.GList, gap = 2): void {
    list.layout = fgui.ListLayoutType.SingleRow;
    list.columnGap = gap;
    const buttons = Array.from({ length: list.numChildren }, (_, index) => list.getChildAt(index).asButton);
    if (buttons.length === 0) return;
    const naturalWidths = buttons.map((button) => {
        const title = button.getChild("title")?.asTextField;
        title?.ensureSizeCorrect();
        return title
            ? title.x + Math.max(
                Math.ceil(title.textWidth),
                estimateSingleLineTextWidth(title, button.title),
            ) + 5
            : button.width;
    });
    const available = Math.max(1, list.width - gap * (buttons.length - 1));
    const cap = naturalWidths.reduce((sum, width) => sum + width, 0) > available
        ? Math.max(1, Math.floor(available / buttons.length))
        : Number.POSITIVE_INFINITY;
    for (let index = 0; index < buttons.length; index += 1) {
        const button = buttons[index];
        const width = Math.min(naturalWidths[index], cap);
        button.setSize(width, button.height);
        const title = button.getChild("title")?.asTextField;
        if (title) {
            title.setSize(Math.max(1, width - title.x - 5), title.height);
            title.displayObject.overflow = Laya.Text.ELLIPSIS;
        }
    }
}

export function setActionEnabled(button: fgui.GButton, enabled: boolean): void {
    button.grayed = !enabled;
    button.touchable = enabled;
}

export function createInspectorCheckButton(
    list: fgui.GComponent,
    name: string,
    title: string,
    x: number,
    y: number,
    width: number,
    selected: boolean,
    onToggle: () => void,
    eventOwner: object,
): { host: fgui.GComponent; button: fgui.GButton } {
    const host = new fgui.GComponent();
    host.name = `${name}Host`;
    host.opaque = true;
    host.touchable = true;
    host.setXY(x, y);
    host.setSize(width, 20);
    host.onClick(eventOwner, onToggle);
    list.addChild(host);

    const button = fgui.UIPackage.createObject("Basic", "Checkbox").asButton;
    button.name = name;
    button.title = title;
    button.selected = selected;
    button.touchable = false;
    button.setXY(0, 0);
    button.setSize(width, 20);
    host.addChild(button);
    return { host, button };
}

export function createTimelineComboBox(
    parent: fgui.GComponent,
    name: string,
    x: number,
    y: number,
    width: number,
    items: string[],
    values: string[],
    selectedIndex: number,
): fgui.GComboBox {
    const combo = fgui.UIPackage.createObject("Basic", "ComboBox").asComboBox;
    combo.name = name;
    combo.setXY(x, y);
    combo.setSize(width, 20);
    combo.items = items;
    combo.values = values;
    combo.selectedIndex = selectedIndex;
    combo.visibleItemCount = Math.min(12, items.length);
    parent.addChild(combo);
    return combo;
}
