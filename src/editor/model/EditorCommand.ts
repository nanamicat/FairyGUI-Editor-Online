export interface EditorDisplayNodeSelector {
    packageId: string;
    componentResourceId: string;
    displayNodeId: string;
}

export interface SetDisplayNodePropsCommand {
    kind: "setDisplayNodeProps";
    selector: EditorDisplayNodeSelector;
    props: DisplayNodeEditableProps;
}

export interface EditorResourceSelector {
    packageId: string;
    resourceId: string;
}

export interface EditorPackageSelector {
    packageId: string;
}

export interface EditorComponentSelector {
    packageId: string;
    componentResourceId: string;
}

export interface EditorControllerSelector extends EditorComponentSelector {
    controllerName: string;
}

export interface EditorTransitionSelector extends EditorComponentSelector {
    transitionName: string;
}

export interface EditorGearSelector extends EditorDisplayNodeSelector {
    kind: string;
    controllerName: string;
}

export interface DisplayNodeEditableProps {
    position?: {
        x: number;
        y: number;
    };
    size?: {
        width: number;
        height: number;
    };
    locked?: boolean;
    aspect?: boolean;
    minSize?: {
        width: number;
        height: number;
    };
    maxSize?: {
        width: number;
        height: number;
    };
    scale?: {
        x: number;
        y: number;
    };
    skew?: {
        x: number;
        y: number;
    };
    visible?: boolean;
    touchable?: boolean;
    grayed?: boolean;
    alpha?: number;
    rotation?: number;
    tooltips?: string;
    blendMode?: DisplayNodeBlendMode;
    filter?: string;
    filterData?: string;
    pivot?: {
        x: number;
        y: number;
    };
    pivotAsAnchor?: boolean;
    customData?: string;
    text?: string;
    font?: string;
    fontSize?: number;
    color?: string;
    textProperties?: TextEditableProperties;
    textInputProperties?: TextInputEditableProperties;
    graphProperties?: GraphEditableProperties;
    groupProperties?: GroupEditableProperties;
    loaderProperties?: LoaderEditableProperties;
    loader3DProperties?: Loader3DEditableProperties;
    listProperties?: ListEditableProperties | TreeEditableProperties;
    componentInstanceProperties?: ComponentInstanceEditableProperties | null;
    componentCustomPropertyValues?: ComponentCustomPropertyValue[] | null;
    componentControllerPageOverrides?: ComponentControllerPageOverride[] | null;
    group?: string;
}

export type DisplayNodeBlendMode = "normal" | "none" | "add" | "multiply" | "screen" | "erase";

export interface DisplayNodeCommonEditableProperties {
    locked: boolean;
    aspect: boolean;
    minSize: { width: number; height: number };
    maxSize: { width: number; height: number };
    scale: { x: number; y: number };
    skew: { x: number; y: number };
    tooltips: string;
    blendMode: DisplayNodeBlendMode;
    filter: string;
    filterData: string;
}

export interface GroupEditableProperties {
    layout: number;
    lineGap: number;
    columnGap: number;
    advanced: boolean;
    excludeInvisibles: boolean;
    autoSizeDisabled: boolean;
    mainGridIndex: number;
}

export interface ComponentCustomPropertyDefinition {
    target: string;
    propertyId: 0 | 1;
    label: string;
}

export interface ComponentCustomPropertyValue {
    target: string;
    propertyId: 0 | 1;
    value: string;
}

export interface ComponentControllerPageOverride {
    controllerName: string;
    pageId: string;
}

export interface ComponentInstanceComboItem {
    title: string | null;
    value: string | null;
    icon: string | null;
}

export type ComponentInstanceEditableProperties =
    | {
        extensionType: "Button";
        title: string;
        selectedTitle: string;
        icon: string;
        selectedIcon: string;
        titleColor: string;
        titleFontSize: number;
        controller: string;
        page: string;
        checked: boolean;
        sound: string;
        soundVolumeScale: number;
    }
    | {
        extensionType: "Label";
        title: string;
        icon: string;
        titleColor: string;
        titleFontSize: number;
        promptText: string;
    }
    | {
        extensionType: "ComboBox";
        title: string;
        icon: string;
    visibleItemCount: number;
    selectionController: string;
    autoClearItems: boolean;
    items: ComponentInstanceComboItem[];
    }
    | {
        extensionType: "ProgressBar" | "Slider";
        value: number;
        max: number;
        min: number;
    }
    | {
        extensionType: "ScrollBar";
    };

export interface GraphEditableProperties {
    graphType: number;
    lineSize: number;
    lineColor: string;
    fillColor: string;
    cornerRadius: [number, number, number, number] | null;
    points: number[] | null;
    sides: number;
    startAngle: number;
    distances: number[] | null;
}

export interface LoaderEditableProperties {
    url: string;
    fill: number;
    shrinkOnly: boolean;
    autoSize: boolean;
    useResize: boolean;
    align: number;
    vAlign: number;
    frame: number;
    playing: boolean;
    color: string;
    fillMethod: number;
    fillOrigin: number;
    fillClockwise: boolean;
    fillAmount: number;
    clearOnPublish: boolean;
}

export interface Loader3DEditableProperties {
    url: string;
    fill: number;
    shrinkOnly: boolean;
    autoSize: boolean;
    align: number;
    vAlign: number;
    animationName: string;
    skinName: string;
    playing: boolean;
    frame: number;
    loop: boolean;
    color: string;
    clearOnPublish: boolean;
}

export interface ListItemEditableProperties {
    title: string | null;
    icon: string | null;
    url: string | null;
    name: string | null;
    selectedTitle: string | null;
    selectedIcon: string | null;
    level: number;
    isFolder: boolean | null;
    controllers?: string | null;
    propertyOverrides?: Array<{ target: string; propertyId: number; value: string }>;
}

export interface ListEditableProperties {
    layout: number;
    align: number;
    vAlign: number;
    lineGap: number;
    columnGap: number;
    lineCount: number;
    columnCount: number;
    selectionMode: number;
    defaultItem: string;
    autoResizeItem: boolean;
    childrenRenderOrder: number;
    apexIndex: number;
    src: string;
    overflow: number;
    scrollType: number;
    scrollBarFlags: number;
    scrollBarMargin: { top: number; bottom: number; left: number; right: number };
    vtScrollBarRes: string;
    hzScrollBarRes: string;
    headerRes: string;
    footerRes: string;
    margin: { top: number; bottom: number; left: number; right: number };
    clipSoftness: { x: number; y: number };
    scrollItemToViewOnClick: boolean;
    foldInvisibleItems: boolean;
    autoClearItems: boolean;
    listItems: ListItemEditableProperties[];
    pageController: string;
    controllerOverrides: string;
    selectionController: string;
}

export interface TreeEditableProperties extends ListEditableProperties {
    treeView: boolean;
    indent: number;
    clickToExpand: number;
}

export interface TextEditableProperties {
    align: number;
    vAlign: number;
    leading: number;
    letterSpacing: number;
    autoSize: number;
    singleLine: boolean;
    autoClearText: boolean;
    demoText?: string;
    templateVarsEnabled?: boolean;
    faceDilate?: number;
    underlaySoftness: number;
    ubbEnabled: boolean;
    underline: boolean;
    italic: boolean;
    bold: boolean;
    strikethrough: boolean;
    strokeColor: string | null;
    strokeSize: number;
    shadowColor: string | null;
    shadowOffset: { x: number; y: number };
}

export interface TextInputEditableProperties {
    promptText: string;
    maxLength: number;
    restrict: string;
    password: boolean;
    keyboardType: number;
}

export type EditorCommand = SetDisplayNodePropsCommand;

export type EditorCommandAdapterMode =
    | "browser_working_copy"
    | "openfairygui_browser_live_session";

export interface SetDisplayNodePropsOperation {
    opId: string;
    kind: "setDisplayNodeProps";
    selector: EditorDisplayNodeSelector;
    props: DisplayNodeEditableProps;
}

export interface RenameResourceOperation {
    opId: string;
    kind: "renameResource";
    selector: EditorResourceSelector;
    newName: string;
}

export interface MoveResourceOperation {
    opId: string;
    kind: "moveResource";
    selector: EditorResourceSelector;
    toPath: string;
}

export interface SetResourceFavoriteOperation {
    opId: string;
    kind: "setResourceFavorite";
    selector: EditorResourceSelector;
    favorite: boolean;
}

export interface SetResourceExportedOperation {
    opId: string;
    kind: "setResourceExported";
    selector: EditorResourceSelector;
    exported: boolean;
}

export interface EditorResourceFolderSelector {
    packageId: string;
    branch?: string;
    path: string;
}

export interface SetResourceFolderFavoriteOperation {
    opId: string;
    kind: "setResourceFolderFavorite";
    selector: EditorResourceFolderSelector;
    favorite: boolean;
}

export interface AddResourceFolderOperation {
    opId: string;
    kind: "addResourceFolder";
    selector: EditorPackageSelector;
    path: string;
    branch?: string;
    favorite?: boolean;
    atlas?: string;
}

export interface RenameResourceFolderOperation {
    opId: string;
    kind: "renameResourceFolder";
    selector: EditorResourceFolderSelector;
    newName: string;
}

export interface MoveResourceFolderOperation {
    opId: string;
    kind: "moveResourceFolder";
    selector: EditorResourceFolderSelector;
    toPath: string;
}

export interface RemoveResourceFolderOperation {
    opId: string;
    kind: "removeResourceFolder";
    selector: EditorResourceFolderSelector;
}

export interface AddResourceOperation {
    opId: string;
    kind: "addResource";
    selector: { packageId: string };
    resource: unknown;
    atIndex?: number;
}

export interface ImageResourceEditableProps {
    textureSetMode: string;
    qualityOption: string;
    quality: number;
    smoothing: boolean;
    duplicatePadding: boolean;
    scaleOption: 0 | 1 | 2;
    scale9Grid: [number, number, number, number] | null;
    tileGridIndice: number;
}

export interface ComponentEditableProperties {
    minSize: { width: number; height: number };
    maxSize: { width: number; height: number };
    pivot: { x: number; y: number };
    pivotAsAnchor: boolean;
    overflow: number;
    margin: { top: number; bottom: number; left: number; right: number };
    clipSoftness: { x: number; y: number };
    hitTest: string;
    mask: string;
    reversedMask: boolean;
    scrollType: number;
    scrollBarDisplay: number;
    scrollBarFlags: number;
    scrollBarMargin: { top: number; bottom: number; left: number; right: number };
    vtScrollBarRes: string;
    hzScrollBarRes: string;
    headerRes: string;
    footerRes: string;
    bgColor: string;
    bgColorEnabled: boolean;
    designImageAlpha: number;
    designImageLayer: number;
    designImageOffset: { x: number; y: number };
    idNum: number;
    initName: string;
    remark: string;
    extensionType: string;
    opaque: boolean;
    buttonMode: number;
    sound: string;
    soundVolumeScale: number;
    downEffect: number;
    downEffectValue: number;
    dropdown: string;
    promptText: string;
    selectionController: string;
    titleType: number;
    reverse: boolean;
    wholeNumbers: boolean;
    changeOnClick: boolean;
    fixedGripSize: boolean;
    autoClearItems: boolean;
    customProperties: ComponentCustomPropertyDefinition[];
}

export interface SetImageResourcePropsOperation {
    opId: string;
    kind: "setImageResourceProps";
    selector: EditorResourceSelector;
    props: ImageResourceEditableProps;
}

export interface ReplaceResourceBytesOperation {
    opId: string;
    kind: "replaceResourceBytes";
    selector: EditorResourceSelector;
    sourceBytes: Uint8Array;
}

export interface UpdateProjectSettingsOperation {
    opId: string;
    kind: "updateProjectSettings";
    settings: unknown;
}

export interface UpdatePackageSettingsOperation {
    opId: string;
    kind: "updatePackageSettings";
    selector: EditorPackageSelector;
    settings: unknown;
}

export interface AddBranchOperation {
    opId: string;
    kind: "addBranch";
    branch: string;
}

export interface RenameBranchOperation {
    opId: string;
    kind: "renameBranch";
    selector: { branch: string };
    newName: string;
}

export interface RemoveBranchOperation {
    opId: string;
    kind: "removeBranch";
    selector: { branch: string };
}

export interface RemoveResourceOperation {
    opId: string;
    kind: "removeResource";
    selector: EditorResourceSelector;
}

export interface AddPackageOperation {
    opId: string;
    kind: "addPackage";
    package: unknown;
    atIndex: number;
}

export interface RenamePackageOperation {
    opId: string;
    kind: "renamePackage";
    selector: EditorPackageSelector;
    newName: string;
}

export interface RemovePackageOperation {
    opId: string;
    kind: "removePackage";
    selector: EditorPackageSelector;
}

export interface AddComponentOperation {
    opId: string;
    kind: "addComponent";
    selector: EditorPackageSelector;
    component: unknown;
    atIndex: number;
}

export interface SetComponentPropsOperation {
    opId: string;
    kind: "setComponentProps";
    selector: EditorComponentSelector;
    props: {
        size?: {
            width: number;
            height: number;
        };
        properties?: ComponentEditableProperties;
    };
}

export interface MoveComponentOperation {
    opId: string;
    kind: "moveComponent";
    selector: EditorComponentSelector;
    toPackageId: string;
    toIndex: number;
}

export interface RemoveComponentOperation {
    opId: string;
    kind: "removeComponent";
    selector: EditorComponentSelector;
}

export interface AttachDisplayNodeOperation {
    opId: string;
    kind: "attachDisplayNode";
    selector: EditorComponentSelector;
    atIndex: number;
    node: unknown;
}

export interface DetachDisplayNodeOperation {
    opId: string;
    kind: "detachDisplayNode";
    selector: EditorDisplayNodeSelector;
}

export interface AddControllerOperation {
    opId: string;
    kind: "addController";
    selector: EditorControllerSelector;
    controller: unknown;
}

export interface UpdateControllerOperation {
    opId: string;
    kind: "updateController";
    selector: EditorControllerSelector;
    controller: unknown;
}

export interface RemoveControllerOperation {
    opId: string;
    kind: "removeController";
    selector: EditorControllerSelector;
}

export interface AddTransitionOperation {
    opId: string;
    kind: "addTransition";
    selector: EditorTransitionSelector;
    transition: unknown;
}

export interface UpdateTransitionOperation {
    opId: string;
    kind: "updateTransition";
    selector: EditorTransitionSelector;
    transition: unknown;
}

export interface RemoveTransitionOperation {
    opId: string;
    kind: "removeTransition";
    selector: EditorTransitionSelector;
}

export interface AddLookGearOperation {
    opId: string;
    kind: "addLookGear";
    selector: EditorGearSelector;
    gear: unknown;
}

export interface UpdateLookGearOperation {
    opId: string;
    kind: "updateLookGear";
    selector: EditorGearSelector;
    gear: unknown;
}

export interface RemoveLookGearOperation {
    opId: string;
    kind: "removeLookGear";
    selector: EditorGearSelector;
}

export interface AddGearOperation {
    opId: string;
    kind: "addGear";
    selector: EditorGearSelector;
    gear: unknown;
}

export interface UpdateGearOperation {
    opId: string;
    kind: "updateGear";
    selector: EditorGearSelector;
    gear: unknown;
}

export interface RemoveGearOperation {
    opId: string;
    kind: "removeGear";
    selector: EditorGearSelector;
}

export type EditorCommandOperation =
    | SetDisplayNodePropsOperation
    | RenameResourceOperation
    | MoveResourceOperation
    | SetResourceFavoriteOperation
    | SetResourceFolderFavoriteOperation
    | SetResourceExportedOperation
    | AddResourceFolderOperation
    | RenameResourceFolderOperation
    | MoveResourceFolderOperation
    | RemoveResourceFolderOperation
    | AddResourceOperation
    | SetImageResourcePropsOperation
    | ReplaceResourceBytesOperation
    | UpdateProjectSettingsOperation
    | UpdatePackageSettingsOperation
    | AddBranchOperation
    | RenameBranchOperation
    | RemoveBranchOperation
    | RemoveResourceOperation
    | AddPackageOperation
    | RenamePackageOperation
    | RemovePackageOperation
    | AddComponentOperation
    | SetComponentPropsOperation
    | MoveComponentOperation
    | RemoveComponentOperation
    | AttachDisplayNodeOperation
    | DetachDisplayNodeOperation
    | AddControllerOperation
    | UpdateControllerOperation
    | RemoveControllerOperation
    | AddTransitionOperation
    | UpdateTransitionOperation
    | RemoveTransitionOperation
    | AddLookGearOperation
    | UpdateLookGearOperation
    | RemoveLookGearOperation
    | AddGearOperation
    | UpdateGearOperation
    | RemoveGearOperation;

export interface EditorHighRiskTransaction {
    summary: string;
    operation: Exclude<EditorCommandOperation, SetDisplayNodePropsOperation>;
    inverseOperation: EditorCommandOperation;
    operations?: EditorCommandOperation[];
    inverseOperations?: EditorCommandOperation[];
}

export interface EditorCommandNodeState {
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
    text: string;
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
    font: string;
    fontSize: number;
    color: string;
    textProperties?: TextEditableProperties;
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
}

export interface EditorCommandResult {
    ok: boolean;
    stage: "apply" | "undo" | "redo" | "validate";
    revision: number;
    dirty: boolean;
    command?: EditorCommand;
    operation?: EditorCommandOperation;
    operations?: EditorCommandOperation[];
    summary?: string;
    before?: EditorCommandNodeState;
    after?: EditorCommandNodeState;
    error?: EditorCommandError;
    diagnostics: EditorCommandDiagnostic[];
}

export interface EditorCommandHistoryEntry {
    id: string;
    sequence: number;
    createdAt: string;
    ok: boolean;
    stage: "apply" | "undo" | "redo" | "validate";
    revision: number;
    dirty: boolean;
    commandKind: string;
    operationKind?: string;
    summary?: string;
    target?: EditorDisplayNodeSelector;
    before?: EditorCommandNodeState;
    after?: EditorCommandNodeState;
    error?: EditorCommandError;
    diagnostics: EditorCommandDiagnostic[];
}

export interface EditorCommandSessionState {
    adapterMode: EditorCommandAdapterMode;
    revision: number;
    dirty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    undoDepth: number;
    redoDepth: number;
    currentStateId: number;
    savedStateId: number;
    historyCount: number;
    liveSession: boolean;
    browserRuntimeStatus?: "idle" | "loading" | "connected" | "failed";
    browserRuntimeBoundary?: string;
    browserRuntimeError?: string;
    browserRuntimeProjectSource?: "uam_baseline" | "browser_workspace";
    browserRuntimeWorkspaceRestoreStatus?: "unavailable" | "unsupported" | "missing" | "restored" | "failed";
    browserRuntimeWorkspaceRestoreMessage?: string;
    browserRuntimeUamFidelity?: "full" | "unsupported";
    browserRuntimeLockHeld?: boolean;
    backendBundleUrl?: string;
    uamBaselineUrl?: string;
    backendPackageVersion?: string;
    backendBuildSource?: "npm_package" | "workspace_source";
    backendContractVersion?: string;
    boundary: string;
}

export interface EditorCommandError {
    code: string;
    message: string;
    field?: string;
}

export interface EditorCommandDiagnostic {
    severity: "info" | "warning" | "error";
    code: string;
    message: string;
}
