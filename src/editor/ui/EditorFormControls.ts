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
