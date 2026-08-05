import type { HighRiskTransactionPreparation } from "../commands/HighRiskAuthoringTransactions";
import {
    showCommonDisplayPropertiesEditor,
    showGroupPropertiesEditor,
} from "../dialogs/CommonDisplayPropertyEditors";
import {
    showComponentCustomPropertyValuesEditor,
    showComponentInstancePropertiesEditor,
    type ExportedControllerDefinition,
} from "../dialogs/ComponentInstancePropertyEditors";
import {
    showComponentCustomPropertyDefinitionsEditor,
    showComponentExtensionPropertiesEditor,
    showComponentPropertiesEditor,
    type ComponentPropertyEditorContext,
} from "../dialogs/ComponentPropertyEditors";
import {
    showButtonTemplateEditor,
    showComboBoxTemplateEditor,
    showLabelTemplateEditor,
    showPopupMenuTemplateEditor,
    showProgressBarTemplateEditor,
    showScrollBarTemplateEditor,
    showSliderTemplateEditor,
    showWindowFrameTemplateEditor,
    type ComponentTemplateEditorContext,
} from "../dialogs/ComponentTemplateEditors";
import {
    showControllerEditor,
    type ControllerEditorContext,
} from "../dialogs/ControllerEditors";
import {
    requestEditorPackage,
    requestEditorTextInput,
    requestPasteConflictStrategy,
    showEditorConfirmation,
    type EditorDialogContext,
    type EditorPackageChoice,
} from "../dialogs/EditorDialogs";
import { showListPropertiesEditor } from "../dialogs/ListPropertyEditors";
import {
    showLoader3DPropertiesEditor,
    showLoaderPropertiesEditor,
} from "../dialogs/LoaderPropertyEditors";
import type { PropertyEditorContext } from "../dialogs/PropertyEditorContext";
import {
    showDesktopGearEditor,
    showDesktopRelationEditor,
    type RelationGearEditorContext,
} from "../dialogs/RelationGearEditors";
import {
    showFontEditor,
    showImageEditor,
    showMovieClipEditor,
    type ResourceEditorContext,
} from "../dialogs/ResourceEditors";
import {
    showGraphPropertiesEditor,
    showTextPropertiesEditor,
} from "../dialogs/TextGraphPropertyEditors";
import {
    showTimelineItemEditor,
    type TimelineItemEditorContext,
} from "../dialogs/TimelineItemEditor";
import type {
    ComponentCustomPropertyDefinition,
    EditorComponentSelector,
    EditorDisplayNodeSelector,
    SetDisplayNodePropsCommand,
} from "../model/EditorCommand";
import type {
    EditorProjectSnapshot,
    ProjectSnapshotComponent,
    ProjectSnapshotDisplayNode,
    ProjectSnapshotPackage,
    ProjectSnapshotResource,
} from "../model/ProjectSnapshot";
import type { FairyPackageImportConflictStrategy } from "../services/FairyPackageTransfer";

export type ComponentTemplateKind =
    | "label"
    | "button"
    | "comboBox"
    | "progressBar"
    | "slider"
    | "scrollBar"
    | "popupMenu"
    | "windowFrame";

interface AuthoringDialogControllerOptions {
    eventOwner: object;
    getWorkingProject: () => unknown | null;
    getProjectSnapshot: () => EditorProjectSnapshot | null;
    getSelectedPackage: () => ProjectSnapshotPackage | null;
    getSelectedComponent: () => ProjectSnapshotComponent | null;
    getSelectedResource: () => ProjectSnapshotResource | null;
    getSelectedDisplayNode: () => ProjectSnapshotDisplayNode | null;
    getSelectedDisplayNodeSelector: () => EditorDisplayNodeSelector | null;
    getSelectedComponentSelector: () => EditorComponentSelector | null;
    getSelectedControllerName: () => string;
    setSelectedControllerName: (name: string) => void;
    getSelectedTransitionName: () => string;
    isLiveSession: () => boolean;
    getCustomPropertyDefinitions: () => ComponentCustomPropertyDefinition[];
    getExportedControllers: () => ExportedControllerDefinition[];
    applyDisplayNodeCommand: (command: SetDisplayNodePropsCommand, summary: string) => Promise<boolean>;
    setGraphPointEditing: (enabled: boolean, shapeLocked?: boolean) => void;
    isGraphPointEditing: () => boolean;
    isGraphShapeLocked: () => boolean;
    applyPreparation: (preparation: HighRiskTransactionPreparation) => Promise<boolean>;
    download: (blob: Blob, fileName: string) => void;
    activateDocument: (packageId: string, componentId: string) => boolean;
    onTimelineItemApplied: (itemIndex: number) => void;
    createActionMenu: () => fgui.PopupMenu;
    addMenuItem: (
        menu: fgui.PopupMenu,
        name: string,
        title: string,
        handler: () => void,
    ) => fgui.GButton;
    setStatus: (message: string) => void;
    setDebugAttribute: (name: string, value: string) => void;
}

const componentTemplateEditors: Record<ComponentTemplateKind, (context: ComponentTemplateEditorContext) => void> = {
    label: showLabelTemplateEditor,
    button: showButtonTemplateEditor,
    comboBox: showComboBoxTemplateEditor,
    progressBar: showProgressBarTemplateEditor,
    slider: showSliderTemplateEditor,
    scrollBar: showScrollBarTemplateEditor,
    popupMenu: showPopupMenuTemplateEditor,
    windowFrame: showWindowFrameTemplateEditor,
};

export class AuthoringDialogController {
    private activeDialog: fgui.Window | null = null;
    private controllerDialog: fgui.Window | null = null;

    constructor(private readonly options: AuthoringDialogControllerOptions) {}

    dispose(): void {
        this.activeDialog?.dispose();
        this.activeDialog = null;
        this.controllerDialog?.dispose();
        this.controllerDialog = null;
    }

    showCommonDisplayProperties(): void {
        showCommonDisplayPropertiesEditor(this.createPropertyEditorContext());
    }

    showGraphProperties(): void {
        showGraphPropertiesEditor(this.createPropertyEditorContext());
    }

    showTextProperties(): void {
        showTextPropertiesEditor(this.createPropertyEditorContext());
    }

    showGroupProperties(): void {
        showGroupPropertiesEditor(this.createPropertyEditorContext());
    }

    showLoaderProperties(): void {
        showLoaderPropertiesEditor(this.createPropertyEditorContext());
    }

    showLoader3DProperties(): void {
        showLoader3DPropertiesEditor(this.createPropertyEditorContext());
    }

    showListProperties(): void {
        showListPropertiesEditor(this.createPropertyEditorContext());
    }

    showComponentCustomPropertyValues(): void {
        showComponentCustomPropertyValuesEditor(
            this.createPropertyEditorContext(),
            this.options.getCustomPropertyDefinitions(),
            this.options.getExportedControllers(),
        );
    }

    showComponentInstanceProperties(): void {
        showComponentInstancePropertiesEditor(this.createPropertyEditorContext());
    }

    showComponentCustomPropertyDefinitions(): void {
        showComponentCustomPropertyDefinitionsEditor(this.createComponentPropertyEditorContext());
    }

    showComponentProperties(): void {
        showComponentPropertiesEditor(this.createComponentPropertyEditorContext());
    }

    showComponentExtensionProperties(): void {
        showComponentExtensionPropertiesEditor(this.createComponentPropertyEditorContext());
    }

    showComponentTemplate(kind: ComponentTemplateKind): void {
        componentTemplateEditors[kind](this.createComponentTemplateEditorContext());
    }

    showRelationEditor(): void {
        showDesktopRelationEditor(this.createRelationGearEditorContext());
    }

    showGearEditor(): void {
        showDesktopGearEditor(this.createRelationGearEditorContext());
    }

    showControllerEditor(controllerName = this.options.getSelectedControllerName()): void {
        showControllerEditor(this.createControllerEditorContext(), controllerName);
    }

    showTimelineItemEditor(
        mode: "add" | "edit",
        sourceModel: Parameters<typeof showTimelineItemEditor>[2],
        itemIndex: number,
    ): void {
        showTimelineItemEditor(this.createTimelineItemEditorContext(), mode, sourceModel, itemIndex);
    }

    showImageEditor(): void {
        showImageEditor(this.createResourceEditorContext());
    }

    showFontEditor(): void {
        showFontEditor(this.createResourceEditorContext());
    }

    showMovieClipEditor(): void {
        showMovieClipEditor(this.createResourceEditorContext());
    }

    showConfirmation(
        dialogName: string,
        title: string,
        message: string,
        confirmTitle: string,
        debugAttribute: string,
        pendingMessage: string,
        cancelMessage: string,
        onConfirm: () => void,
    ): void {
        showEditorConfirmation(
            this.createDialogContext(),
            dialogName,
            title,
            message,
            confirmTitle,
            debugAttribute,
            pendingMessage,
            cancelMessage,
            onConfirm,
        );
    }

    requestTextInput(
        dialogName: string,
        title: string,
        prompt: string,
        initialValue: string,
        confirmTitle: string,
        validate?: (value: string) => string | null,
    ): Promise<string | null> {
        return requestEditorTextInput(
            this.createDialogContext(),
            dialogName,
            title,
            prompt,
            initialValue,
            confirmTitle,
            validate,
        );
    }

    requestPackage(title: string, packages: EditorPackageChoice[], initialId = ""): Promise<string | null> {
        return requestEditorPackage(this.createDialogContext(), title, packages, initialId);
    }

    requestPasteConflictStrategy(summary: string): Promise<FairyPackageImportConflictStrategy | null> {
        return requestPasteConflictStrategy(this.createDialogContext(), summary);
    }

    private createPropertyEditorContext(): PropertyEditorContext {
        return {
            selector: this.options.getSelectedDisplayNodeSelector(),
            selectedNode: this.options.getSelectedDisplayNode(),
            selectedPackage: this.options.getSelectedPackage(),
            getWorkingProject: this.options.getWorkingProject,
            getActiveDialog: () => this.activeDialog,
            setActiveDialog: (dialog) => { this.activeDialog = dialog; },
            applyCommand: this.options.applyDisplayNodeCommand,
            setGraphPointEditing: this.options.setGraphPointEditing,
            isGraphPointEditing: this.options.isGraphPointEditing,
            isGraphShapeLocked: this.options.isGraphShapeLocked,
            setStatus: this.options.setStatus,
            setDebugAttribute: this.options.setDebugAttribute,
            eventOwner: this.options.eventOwner,
        };
    }

    private createComponentPropertyEditorContext(): ComponentPropertyEditorContext {
        return {
            getSelectedComponentSelector: this.options.getSelectedComponentSelector,
            getSelectedComponent: this.options.getSelectedComponent,
            getWorkingProject: this.options.getWorkingProject,
            getActiveDialog: () => this.activeDialog,
            setActiveDialog: (dialog) => { this.activeDialog = dialog; },
            applyPreparation: this.options.applyPreparation,
            setStatus: this.options.setStatus,
            setDebugAttribute: this.options.setDebugAttribute,
            eventOwner: this.options.eventOwner,
        };
    }

    private createComponentTemplateEditorContext(): ComponentTemplateEditorContext {
        const selectedPackage = this.options.getSelectedPackage();
        return {
            packageId: selectedPackage && this.options.isLiveSession() ? selectedPackage.id : null,
            packageName: selectedPackage?.name || "selected package",
            getWorkingProject: this.options.getWorkingProject,
            getActiveDialog: () => this.activeDialog,
            setActiveDialog: (dialog) => { this.activeDialog = dialog; },
            createAvailableName: (baseName) => this.createAvailableResourceName(baseName),
            applyPreparation: this.options.applyPreparation,
            onApplied: (componentId, templateKind) => {
                if (componentId && selectedPackage) {
                    this.options.activateDocument(selectedPackage.id, componentId);
                }
                this.options.setDebugAttribute(
                    "data-fairy-editor-component-template-dialog",
                    `${templateKind}:created:${componentId}`,
                );
            },
            setStatus: this.options.setStatus,
            setDebugAttribute: this.options.setDebugAttribute,
            eventOwner: this.options.eventOwner,
        };
    }

    private createRelationGearEditorContext(): RelationGearEditorContext {
        return {
            selector: this.options.getSelectedDisplayNodeSelector(),
            selectedNode: this.options.getSelectedDisplayNode(),
            getWorkingProject: this.options.getWorkingProject,
            getActiveDialog: () => this.activeDialog,
            setActiveDialog: (dialog) => { this.activeDialog = dialog; },
            applyPreparation: this.options.applyPreparation,
            setStatus: this.options.setStatus,
            setDebugAttribute: this.options.setDebugAttribute,
            eventOwner: this.options.eventOwner,
        };
    }

    private createControllerEditorContext(): ControllerEditorContext {
        return {
            getSelectedComponentSelector: this.options.getSelectedComponentSelector,
            getWorkingProject: this.options.getWorkingProject,
            getControllerDialog: () => this.controllerDialog,
            setControllerDialog: (dialog) => { this.controllerDialog = dialog; },
            getAuxDialog: () => this.activeDialog,
            setAuxDialog: (dialog) => { this.activeDialog = dialog; },
            applyPreparation: this.options.applyPreparation,
            setSelectedControllerName: this.options.setSelectedControllerName,
            createActionMenu: this.options.createActionMenu,
            addMenuItem: this.options.addMenuItem,
            setStatus: this.options.setStatus,
            setDebugAttribute: this.options.setDebugAttribute,
            eventOwner: this.options.eventOwner,
        };
    }

    private createTimelineItemEditorContext(): TimelineItemEditorContext {
        const selector = this.options.getSelectedComponentSelector();
        return {
            selector,
            component: this.options.getSelectedComponent(),
            transitionName: this.options.getSelectedTransitionName(),
            soundResources: selector
                ? this.options.getProjectSnapshot()?.packages
                    .find((pkg) => pkg.id === selector.packageId)
                    ?.resources.filter((resource) => resource.type === "SoundResource") || []
                : [],
            getWorkingProject: this.options.getWorkingProject,
            getActiveDialog: () => this.activeDialog,
            setActiveDialog: (dialog) => { this.activeDialog = dialog; },
            applyPreparation: this.options.applyPreparation,
            onApplied: this.options.onTimelineItemApplied,
            setStatus: this.options.setStatus,
            setDebugAttribute: this.options.setDebugAttribute,
            eventOwner: this.options.eventOwner,
        };
    }

    private createResourceEditorContext(): ResourceEditorContext {
        return {
            resource: this.options.getSelectedResource(),
            selectedPackage: this.options.getSelectedPackage(),
            getWorkingProject: this.options.getWorkingProject,
            getActiveDialog: () => this.activeDialog,
            setActiveDialog: (dialog) => { this.activeDialog = dialog; },
            applyPreparation: this.options.applyPreparation,
            download: this.options.download,
            setStatus: this.options.setStatus,
            setDebugAttribute: this.options.setDebugAttribute,
            eventOwner: this.options.eventOwner,
        };
    }

    private createDialogContext(): EditorDialogContext {
        return {
            getActiveDialog: () => this.activeDialog,
            setActiveDialog: (dialog) => { this.activeDialog = dialog; },
            setStatus: this.options.setStatus,
            setDebugAttribute: this.options.setDebugAttribute,
            eventOwner: this.options.eventOwner,
        };
    }

    private createAvailableResourceName(baseName: string): string {
        const pkg = this.options.getSelectedPackage();
        const names = new Set([
            ...(pkg?.components || []).map((component) => component.name),
            ...(pkg?.resources || []).map((resource) => resource.name),
        ]);
        let name = baseName;
        for (let index = 1; names.has(name); index += 1) name = `${baseName}${index}`;
        return name;
    }
}
