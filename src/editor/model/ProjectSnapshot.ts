import type {
    DisplayNodeBlendMode,
    GraphEditableProperties,
    GroupEditableProperties,
    ComponentInstanceEditableProperties,
    ComponentCustomPropertyDefinition,
    ComponentCustomPropertyValue,
    ComponentControllerPageOverride,
    ListEditableProperties,
    Loader3DEditableProperties,
    LoaderEditableProperties,
    TextEditableProperties,
    TextInputEditableProperties,
    TreeEditableProperties,
} from "./EditorCommand";

export interface EditorProjectSnapshot {
    schemaVersion: 1;
    generatedAt?: string;
    source: ProjectSnapshotSource;
    project: ProjectSnapshotProject;
    totals: ProjectSnapshotTotals;
    packages: ProjectSnapshotPackage[];
    diagnostics: ProjectSnapshotDiagnostic[];
}

export interface ProjectSnapshotSource {
    projectPath?: string;
    openfairyguiVersion?: string;
    reader?: "NodeIO" | "BrowserWorkspace" | "UamBaseline";
    uamLift: ProjectSnapshotProbe;
}

export interface ProjectSnapshotProbe {
    ok: boolean;
    error?: string;
}

export interface ProjectSnapshotProject {
    id: string;
    type: number | string;
    version: string;
}

export interface ProjectSnapshotTotals {
    packages: number;
    images: number;
    sounds: number;
    fonts: number;
    movieClips: number;
    components: number;
    displayObjects: number;
    gears: number;
    controllers: number;
    transitions: number;
}

export interface ProjectSnapshotPackage {
    id: string;
    name: string;
    publishName: string;
    folders: ProjectSnapshotResourceFolder[];
    resources: ProjectSnapshotResource[];
    components: ProjectSnapshotComponent[];
}

export interface ProjectSnapshotResource {
    id: string;
    name: string;
    branch: string;
    path: string;
    type: string;
    exported: boolean;
    favorite: boolean;
    fileName: string;
    width?: number;
    height?: number;
}

export interface ProjectSnapshotComponent {
    id: string;
    name: string;
    path: string;
    exported: boolean;
    favorite: boolean;
    width: number;
    height: number;
    childCount: number;
    controllerCount: number;
    transitionCount: number;
    bgColor?: string;
    bgColorEnabled?: boolean;
    customProperties: ComponentCustomPropertyDefinition[];
    children: ProjectSnapshotDisplayNode[];
}

export interface ProjectSnapshotResourceFolder {
    branch: string;
    path: string;
    favorite: boolean;
    atlas: string;
}

export interface ProjectSnapshotDisplayNode {
    id: string;
    name: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    locked: boolean;
    aspect: boolean;
    minSize: { width: number; height: number };
    maxSize: { width: number; height: number };
    scale: { x: number; y: number };
    skew: { x: number; y: number };
    src: string;
    visible: boolean;
    touchable: boolean;
    grayed: boolean;
    alpha: number;
    rotation: number;
    tooltips: string;
    blendMode: DisplayNodeBlendMode;
    filter: string;
    filterData: string;
    pivotX: number;
    pivotY: number;
    pivotAsAnchor: boolean;
    customData: string;
    text: string;
    font: string;
    fontSize: number;
    color: string;
    textProperties: TextEditableProperties;
    textInputProperties?: TextInputEditableProperties;
    graphProperties?: GraphEditableProperties;
    groupProperties?: GroupEditableProperties;
    loaderProperties?: LoaderEditableProperties;
    loader3DProperties?: Loader3DEditableProperties;
    listProperties?: ListEditableProperties | TreeEditableProperties;
    componentInstanceProperties?: ComponentInstanceEditableProperties;
    componentInstancePropertiesExplicit?: boolean;
    componentCustomPropertyValues?: ComponentCustomPropertyValue[];
    componentCustomPropertyValuesExplicit?: boolean;
    componentControllerPageOverrides?: ComponentControllerPageOverride[];
    componentControllerPageOverridesExplicit?: boolean;
    group: string;
    gearCount: number;
    relationCount: number;
}

export interface ProjectSnapshotDiagnostic {
    severity: "info" | "warning" | "error";
    code: string;
    message: string;
}
