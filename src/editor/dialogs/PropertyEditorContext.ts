import type {
    EditorDisplayNodeSelector,
    SetDisplayNodePropsCommand,
} from "../model/EditorCommand";
import type {
    ProjectSnapshotDisplayNode,
    ProjectSnapshotPackage,
} from "../model/ProjectSnapshot";

export type PropertyEditorContext = {
    selector: EditorDisplayNodeSelector | null;
    selectedNode: ProjectSnapshotDisplayNode | null;
    selectedPackage: ProjectSnapshotPackage | null;
    getWorkingProject: () => unknown;
    getActiveDialog: () => fgui.Window | null;
    setActiveDialog: (dialog: fgui.Window | null) => void;
    applyCommand: (command: SetDisplayNodePropsCommand, summary: string) => Promise<boolean>;
    setGraphPointEditing: (enabled: boolean, shapeLocked?: boolean) => void;
    isGraphPointEditing: () => boolean;
    isGraphShapeLocked: () => boolean;
    setStatus: (message: string) => void;
    setDebugAttribute: (name: string, value: string) => void;
    eventOwner: object;
};
