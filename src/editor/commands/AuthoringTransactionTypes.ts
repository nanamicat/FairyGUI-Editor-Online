import type {
    EditorComponentSelector,
    EditorDisplayNodeSelector,
    EditorHighRiskTransaction,
    EditorResourceSelector,
} from "../model/EditorCommand";

export type HighRiskTransactionPreparation =
    | { ok: true; transaction: EditorHighRiskTransaction }
    | { ok: false; code: string; message: string };

export interface DisplayNodeClipboard {
    packageId: string;
    componentResourceId: string;
    nodes: unknown[];
}

export type DisplayNodeClipboardPreparation =
    | { ok: true; clipboard: DisplayNodeClipboard }
    | { ok: false; code: string; message: string };

export interface BinaryFileInput {
    fileName: string;
    sourceBytes: Uint8Array;
}

export interface ControllerOption {
    name: string;
    selectedIndex: number;
    pageCount: number;
}

export interface TransitionOption {
    name: string;
    autoPlay: boolean;
}

export interface GearOption {
    kind: string;
    controllerName: string;
    tween?: boolean;
    x?: number;
    y?: number;
}

export interface ComponentInspection {
    controllers: ControllerOption[];
    transitions: TransitionOption[];
}

export interface DisplayNodeInspection {
    nodeKind: string;
    index: number;
    duplicateEnabled: boolean;
    relationCount: number;
    controllers: ControllerOption[];
    lookGears: GearOption[];
    xyGears: GearOption[];
    gears: GearOption[];
}

export interface DisplayNodeRelationModel {
    relations: Array<{
        targetNodeId: string;
        type: number;
        usePercent: boolean;
    }>;
    targets: Array<{
        id: string;
        name: string;
        kind: string;
    }>;
}
