import type {
    DesktopCanvasCustomArrangeMode,
    DesktopCanvasCustomArrangeOptions,
} from "../runtime/DesktopCanvasInteraction";
import type { DesktopConsoleEntry, DesktopConsoleLevel } from "../runtime/DesktopConsoleLog";

export interface EditorNumericInputOptions {
    integer?: boolean;
    min?: number;
    max?: number;
}

export class EditorTextInput extends fgui.GLabel {
    private clearButton: fgui.GObject | null = null;

    get input(): fgui.GTextInput {
        const textField = this.getTextField();
        if (!(textField instanceof fgui.GTextInput)) {
            throw new Error(`${this.name || "EditorTextInput"} must contain a GTextInput title.`);
        }
        return textField;
    }

    get trimmedText(): string {
        return this.text.trim();
    }

    get promptText(): string {
        return this.input.promptText;
    }

    set promptText(value: string) {
        this.input.promptText = value;
    }

    protected override constructExtension(buffer: fgui.ByteBuffer): void {
        super.constructExtension(buffer);
        this.clearButton = this.getChild("clear");
        if (this.clearButton) {
            this.clearButton.onClick(this, this.clear);
            this.input.on(Laya.Event.INPUT, this, this.syncClearButton);
            this.syncClearButton();
        }
    }

    override dispose(): void {
        if (this.clearButton) {
            this.clearButton.offClick(this, this.clear);
            this.input.off(Laya.Event.INPUT, this, this.syncClearButton);
        }
        super.dispose();
    }

    private clear(): void {
        this.text = "";
        this.syncClearButton();
    }

    private syncClearButton(): void {
        if (this.clearButton) this.clearButton.visible = this.text.length > 0;
    }
}

export class EditorNumericInput extends EditorTextInput {
    private integer = false;
    private min = Number.NEGATIVE_INFINITY;
    private max = Number.POSITIVE_INFINITY;

    get optionalNumber(): number | undefined {
        if (!this.trimmedText) return undefined;
        const value = Number(this.trimmedText);
        if (
            !Number.isFinite(value)
            || (this.integer && !Number.isInteger(value))
            || value < this.min
            || value > this.max
        ) {
            return Number.NaN;
        }
        return value;
    }

    get numberValue(): number {
        return this.optionalNumber ?? Number.NaN;
    }

    configure(options: EditorNumericInputOptions = {}): this {
        this.integer = options.integer ?? false;
        this.min = options.min ?? Number.NEGATIVE_INFINITY;
        this.max = options.max ?? Number.POSITIVE_INFINITY;
        return this;
    }

    setNumber(value: number): void {
        this.text = String(value);
    }
}

export class EditorTooltipsWin extends fgui.GLabel {
    override get text(): string {
        return super.text;
    }

    override set text(value: string) {
        super.text = value;
        const title = this.getTextField();
        title.ensureSizeCorrect();
        this.setSize(
            Math.max(40, Math.ceil(title.textWidth) + 10),
            Math.max(30, Math.ceil(title.height) + 10),
        );
    }
}

export class EditorIconLoader extends fgui.GLoader {
    override setup_beforeAdd(buffer: fgui.ByteBuffer, beginPos: number): void {
        super.setup_beforeAdd(buffer, beginPos);
        if (this.name !== "icon") return;
        this.fill = fgui.LoaderFillType.Scale;
        this.shrinkOnly = true;
    }
}

export class EditorCustomArrangePanel extends fgui.GComponent {
    private modeController!: fgui.Controller;
    private lineSpacingInput!: EditorNumericInput;
    private columnSpacingInput!: EditorNumericInput;
    private columnCountInput!: EditorNumericInput;

    get okButton(): fgui.GObject {
        return this.getChild("ok");
    }

    get mode(): DesktopCanvasCustomArrangeMode {
        return (["rows", "columns", "table"] as const)[this.modeController.selectedIndex] || "rows";
    }

    protected override onConstruct(): void {
        super.onConstruct();
        this.modeController = this.getController("c1");
        this.lineSpacingInput = this.requireNumericInput("lineSpacing").configure({ integer: true });
        this.columnSpacingInput = this.requireNumericInput("columnSpacing").configure({ integer: true });
        this.columnCountInput = this.requireNumericInput("columnCount").configure({ integer: true, min: 1 });
    }

    setOptions(mode: DesktopCanvasCustomArrangeMode, options: DesktopCanvasCustomArrangeOptions): void {
        this.modeController.selectedIndex = ["rows", "columns", "table"].indexOf(mode);
        this.lineSpacingInput.setNumber(options.lineSpacing);
        this.columnSpacingInput.setNumber(options.columnSpacing);
        this.columnCountInput.setNumber(options.columnCount);
    }

    readOptions(): DesktopCanvasCustomArrangeOptions | null {
        const options = {
            columnCount: this.columnCountInput.numberValue,
            columnSpacing: this.columnSpacingInput.numberValue,
            lineSpacing: this.lineSpacingInput.numberValue,
        };
        return Object.values(options).every(Number.isFinite) ? options : null;
    }

    private requireNumericInput(name: string): EditorNumericInput {
        const child = this.getChild(name);
        if (!(child instanceof EditorNumericInput)) {
            throw new Error(`CustomArrangePanel/${name} must use the registered NumericInput extension.`);
        }
        return child;
    }
}

const CONSOLE_LEVEL_INDEX: Record<DesktopConsoleLevel, number> = {
    info: 0,
    warning: 1,
    error: 2,
};

let editorWindowAutoCenterRegistered = false;

export class EditorConsoleItem extends fgui.GButton {
    private typeController!: fgui.Controller;
    private backgroundController!: fgui.Controller;

    protected override constructExtension(buffer: fgui.ByteBuffer): void {
        super.constructExtension(buffer);
        this.typeController = this.getController("type");
        this.backgroundController = this.getController("bg");
    }

    render(entry: DesktopConsoleEntry, index: number, width: number): void {
        this.title = entry.message;
        this.data = entry;
        this.setSize(width, 22);
        this.typeController.selectedIndex = CONSOLE_LEVEL_INDEX[entry.level];
        this.backgroundController.selectedIndex = index % 2;
    }
}

export function registerEditorUiExtensions(): void {
    if (!editorWindowAutoCenterRegistered) {
        const showWindow = fgui.Window.prototype.show;
        fgui.Window.prototype.show = function(this: fgui.Window): void {
            showWindow.call(this);
            this.centerOn(fgui.GRoot.inst, true);
        };
        editorWindowAutoCenterRegistered = true;
    }
    fgui.UIObjectFactory.setLoaderExtension(EditorIconLoader);
    fgui.UIObjectFactory.setExtension("ui://Basic/TextInput", EditorTextInput);
    fgui.UIObjectFactory.setExtension("ui://Basic/TextArea", EditorTextInput);
    fgui.UIObjectFactory.setExtension("ui://Basic/ResourceInput", EditorTextInput);
    fgui.UIObjectFactory.setExtension("ui://Basic/NumericInput", EditorNumericInput);
    fgui.UIObjectFactory.setExtension("ui://Basic/XYInput", EditorNumericInput);
    fgui.UIObjectFactory.setExtension("ui://Basic/TooltipsWin", EditorTooltipsWin);
    fgui.UIObjectFactory.setExtension("ui://Builder/CustomArrangePanel", EditorCustomArrangePanel);
    fgui.UIObjectFactory.setExtension("ui://Builder/ConsoleView_item", EditorConsoleItem);
}
