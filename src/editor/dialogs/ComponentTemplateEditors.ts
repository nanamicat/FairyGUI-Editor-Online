import type { HighRiskTransactionPreparation } from "../commands/AuthoringTransactionTypes";
import {
    prepareAddButtonComponent,
    prepareAddComboBoxComponent,
    prepareAddLabelComponent,
    prepareAddPopupMenuComponent,
    prepareAddProgressBarComponent,
    prepareAddScrollBarComponent,
    prepareAddSliderComponent,
    prepareAddWindowFrameComponent,
} from "../commands/PackageComponentTransactions";

export type ComponentTemplateEditorContext = {
    packageId: string | null;
    packageName: string;
    getWorkingProject(): unknown;
    getActiveDialog(): fgui.Window | null;
    setActiveDialog(dialog: fgui.Window | null): void;
    createAvailableName(baseName: string): string;
    applyPreparation(preparation: HighRiskTransactionPreparation): Promise<boolean>;
    onApplied(componentId: string, templateKind: string): void;
    setStatus(message: string): void;
    setDebugAttribute(name: string, value: string): void;
    eventOwner: object;
};

type TemplateDialogOptions = {
    templateKind: string;
    dialogResource: string;
    submitChild: string;
    cancelChild?: string;
    nameChild?: string;
    pathChild?: string;
    configure?(content: fgui.GComponent): void;
    prepare(content: fgui.GComponent, name: string, path: string): HighRiskTransactionPreparation;
};

export function showLabelTemplateEditor(options: ComponentTemplateEditorContext): void {
    showTemplateDialog(options, {
        templateKind: "Label",
        dialogResource: "CreateLabelDialog",
        submitChild: "n6",
        configure: (content) => {
            content.getChild("n14").visible = false;
            const widthInput = getEmbeddedTextInput(content, "n8");
            const heightInput = getEmbeddedTextInput(content, "n10");
            widthInput.text = "400";
            heightInput.text = "400";
            widthInput.editable = true;
            heightInput.editable = true;
        },
        prepare: (content, name, path) => prepareAddLabelComponent(
            options.getWorkingProject(),
            { packageId: options.packageId! },
            {
                name,
                path,
                width: Number(getEmbeddedTextInput(content, "n8").text),
                height: Number(getEmbeddedTextInput(content, "n10").text),
            },
        ),
    });
}

export function showButtonTemplateEditor(options: ComponentTemplateEditorContext): void {
    showTemplateDialog(options, {
        templateKind: "Button",
        dialogResource: "CreateButtonDialog",
        submitChild: "n13",
        cancelChild: "n14",
        nameChild: "n2",
        pathChild: "n16",
        configure: (content) => {
            content.setSize(407, 240);
            content.getChild("frame").asCom.setSize(407, 240);
            content.getController("c1").selectedIndex = 1;
            hideChildren(content, [
                "n23", "n22", "n25", "n26", "n27", "n17",
                "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10",
            ]);
            const positions: Record<string, [number, number]> = {
                n19: [134, 60], n20: [211, 62], n21: [230, 60], n28: [6, 94],
                mode: [90, 92], n11: [90, 121], n12: [209, 121], n15: [6, 150],
                n16: [90, 148], n13: [108, 197], n14: [226, 197],
            };
            for (const [childName, [x, y]] of Object.entries(positions)) {
                content.getChild(childName)?.setXY(x, y);
            }
            const widthInput = getEmbeddedTextInput(content, "n19");
            const heightInput = getEmbeddedTextInput(content, "n21");
            widthInput.text = "200";
            heightInput.text = "100";
            widthInput.editable = true;
            heightInput.editable = true;
            const mode = content.getChild("mode").asComboBox;
            mode.items = ["Common", "Check", "Radio"];
            mode.values = ["0", "1", "2"];
            mode.selectedIndex = 0;
            content.getChild("n11").asButton.selected = true;
            content.getChild("n12").asButton.selected = false;
        },
        prepare: (content, name, path) => prepareAddButtonComponent(
            options.getWorkingProject(),
            { packageId: options.packageId! },
            {
                name,
                path,
                width: Number(getEmbeddedTextInput(content, "n19").text),
                height: Number(getEmbeddedTextInput(content, "n21").text),
                buttonMode: Number(content.getChild("mode").asComboBox.value),
                includeTitle: content.getChild("n11").asButton.selected,
                includeIcon: content.getChild("n12").asButton.selected,
            },
        ),
    });
}

export function showComboBoxTemplateEditor(options: ComponentTemplateEditorContext): void {
    showTemplateDialog(options, {
        templateKind: "ComboBox",
        dialogResource: "CreateComboBoxDialog",
        submitChild: "n18",
        configure: (content) => {
            content.getController("c1").selectedIndex = 0;
            content.getChild("n18").asButton.title = "Create";
        },
        prepare: (_content, name, path) => prepareAddComboBoxComponent(
            options.getWorkingProject(), { packageId: options.packageId! }, { name, path },
        ),
    });
}

export function showProgressBarTemplateEditor(options: ComponentTemplateEditorContext): void {
    showTemplateDialog(options, {
        templateKind: "ProgressBar",
        dialogResource: "CreateProgressBarDialog",
        submitChild: "n6",
        configure: (content) => {
            hideChildren(content, ["n36", "n38", "n82", "n83"]);
            const titleType = content.getChild("titleType").asComboBox;
            titleType.items = ["None", "Percent", "Value / Max", "Value", "Max"];
            titleType.values = ["0", "1", "2", "3", "4"];
            titleType.selectedIndex = 0;
        },
        prepare: (content, name, path) => prepareAddProgressBarComponent(
            options.getWorkingProject(),
            { packageId: options.packageId! },
            {
                name,
                path,
                titleType: Number(content.getChild("titleType").asComboBox.value),
                reverse: content.getChild("reverse").asButton.selected,
            },
        ),
    });
}

export function showSliderTemplateEditor(options: ComponentTemplateEditorContext): void {
    showTemplateDialog(options, {
        templateKind: "Slider",
        dialogResource: "CreateSliderDialog",
        submitChild: "n18",
        configure: (content) => {
            content.getController("c1").selectedIndex = 0;
            content.getChild("n18").asButton.title = "Create";
            const titleType = content.getChild("titleType").asComboBox;
            titleType.items = ["None", "Percent", "Value / Max", "Value", "Max"];
            titleType.values = ["0", "1", "2", "3", "4"];
            titleType.selectedIndex = 0;
        },
        prepare: (content, name, path) => prepareAddSliderComponent(
            options.getWorkingProject(),
            { packageId: options.packageId! },
            {
                name,
                path,
                orientation: content.getController("c4").selectedIndex,
                titleType: Number(content.getChild("titleType").asComboBox.value),
            },
        ),
    });
}

export function showScrollBarTemplateEditor(options: ComponentTemplateEditorContext): void {
    showTemplateDialog(options, {
        templateKind: "ScrollBar",
        dialogResource: "CreateScrollBarDialog",
        submitChild: "n18",
        configure: (content) => {
            content.getController("c1").selectedIndex = 0;
            content.getChild("n18").asButton.title = "Create";
        },
        prepare: (content, name, path) => prepareAddScrollBarComponent(
            options.getWorkingProject(),
            { packageId: options.packageId! },
            {
                name,
                path,
                orientation: content.getController("c4").selectedIndex,
                includeArrows: !content.getChild("n66").asButton.selected,
            },
        ),
    });
}

export function showWindowFrameTemplateEditor(options: ComponentTemplateEditorContext): void {
    showTemplateDialog(options, {
        templateKind: "WindowFrame",
        dialogResource: "CreateWindowFrameDialog",
        submitChild: "n6",
        configure: (content) => {
            hideChildren(content, ["n36", "n38", "n104", "n105"]);
            content.getChild("n107").asButton.selected = true;
            content.getChild("n108").asButton.selected = false;
        },
        prepare: (content, name, path) => prepareAddWindowFrameComponent(
            options.getWorkingProject(),
            { packageId: options.packageId! },
            {
                name,
                path,
                titleKind: content.getChild("n107").asButton.selected
                    ? "text"
                    : content.getChild("n108").asButton.selected ? "graph" : "none",
                includeCloseButton: true,
            },
        ),
    });
}

export function showPopupMenuTemplateEditor(options: ComponentTemplateEditorContext): void {
    showTemplateDialog(options, {
        templateKind: "PopupMenu",
        dialogResource: "CreatePopupMenuDialog",
        submitChild: "n6",
        configure: (content) => hideChildren(content, [
            "n36", "n38", "n93", "n94", "n95", "n96",
            "n97", "n98", "n99", "n100", "n101", "n102", "n103",
        ]),
        prepare: (_content, name, path) => prepareAddPopupMenuComponent(
            options.getWorkingProject(), { packageId: options.packageId! }, { name, path },
        ),
    });
}

function showTemplateDialog(options: ComponentTemplateEditorContext, config: TemplateDialogOptions): void {
    if (!options.packageId) {
        options.setStatus(`${config.templateKind} creation requires a selected package and connected browser live session.`);
        return;
    }
    options.getActiveDialog()?.dispose();
    const dialog = new fgui.Window();
    dialog.modal = true;
    dialog.name = `desktopCreate${config.templateKind}Dialog`;
    const content = fgui.UIPackage.createObject("Builder", config.dialogResource).asCom;
    dialog.contentPane = content;
    content.getChild("frame").asLabel.title = `Create ${config.templateKind} in ${options.packageName}`;
    const nameInput = getEmbeddedTextInput(content, config.nameChild || "n3");
    const pathInput = getEmbeddedTextInput(content, config.pathChild || "n13");
    nameInput.text = options.createAvailableName(config.templateKind);
    pathInput.text = "/";
    nameInput.editable = true;
    pathInput.editable = true;
    config.configure?.(content);

    const close = (): void => {
        dialog.dispose();
        if (options.getActiveDialog() === dialog) options.setActiveDialog(null);
    };
    content.getChild(config.cancelChild || "n7").asButton.onClick(options.eventOwner, close);
    content.getChild(config.submitChild).asButton.onClick(options.eventOwner, async () => {
        const preparation = config.prepare(content, nameInput.text, pathInput.text);
        const operation = preparation.ok ? preparation.transaction.operation : null;
        const componentId = operation?.kind === "addComponent"
            ? String((operation.component as { id?: unknown }).id || "")
            : "";
        if (!await options.applyPreparation(preparation)) return;
        close();
        options.onApplied(componentId, config.templateKind);
    });
    options.setActiveDialog(dialog);
    dialog.show();
    nameInput.requestFocus();
    options.setDebugAttribute("data-fairy-editor-component-template-dialog", `${config.templateKind}:open`);
    options.setStatus(`Editing ${config.templateKind} component recipe.`);
}

function getEmbeddedTextInput(content: fgui.GComponent, childName: string): fgui.GTextInput {
    return content.getChild(childName).asCom.getChild("title").asTextInput;
}

function hideChildren(content: fgui.GComponent, childNames: string[]): void {
    for (const childName of childNames) {
        const child = content.getChild(childName);
        if (child) child.visible = false;
    }
}
