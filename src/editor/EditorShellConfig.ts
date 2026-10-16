import type { PrimitiveDisplayNodeKind } from "./commands/HighRiskAuthoringTransactions";
import type {
    DesktopCanvasAlignmentMode,
    DesktopCanvasCustomArrangeMode,
} from "./runtime/DesktopCanvasInteraction";
import type { EditorShortcutId } from "./runtime/EditorPreferences";

export type ShellAction =
    | "menu:file"
    | "menu:edit"
    | "menu:resource"
    | "menu:tools"
    | "menu:view"
    | "menu:publish"
    | "menu:help"
    | "workspace:showPanel"
    | "workspace:importProject"
    | "toolbar:createPackage"
    | "toolbar:createComponent"
    | "toolbar:createButton"
    | "toolbar:createLabel"
    | "toolbar:createComboBox"
    | "toolbar:createProgressBar"
    | "toolbar:createSlider"
    | "toolbar:createBitmapFont"
    | "toolbar:createMovieClip"
    | "toolbar:importProjectDirectory"
    | "workspace:importProjectDirectory"
    | "resource:importFairyPackage"
    | "resource:importFairyPackageResources"
    | "resource:exportFairyPackage"
    | "resource:exportFairyPackageResources"
    | "toolbar:save"
    | "toolbar:publish"
    | "toolbar:publishSettings"
    | "toolbar:canvasSettings"
    | "toolbar:branchSettings"
    | "toolbar:languageSettings"
    | "toolbar:test"
    | "toolbar:stopTest"
    | "toolbar:reloadTest"
    | "library:refresh"
    | "hierarchy:expand"
    | "preview:play";

export type EditorActionId = ShellAction | EditorShortcutId;

export type ShellEventListener = (...args: any[]) => unknown;

export type ShellEventTarget = {
    on(type: string, caller: object, listener: ShellEventListener, args?: any[]): unknown;
    off(type: string, caller: object, listener: ShellEventListener): unknown;
};

export const PROJECT_SELECTION_STORAGE_KEY = "fairygui-editor-online.selection.v1";
export const DESKTOP_TIMELINE_HEIGHT = 132;

export const ALIGN_TOOLBAR_ACTIONS: Array<{ childName: string; mode: DesktopCanvasAlignmentMode }> = [
    { childName: "n33", mode: "left" },
    { childName: "n34", mode: "centerX" },
    { childName: "n35", mode: "right" },
    { childName: "n36", mode: "top" },
    { childName: "n37", mode: "centerY" },
    { childName: "n38", mode: "bottom" },
    { childName: "n39", mode: "sameWidth" },
    { childName: "n40", mode: "sameHeight" },
];

export const CUSTOM_ARRANGE_ACTIONS: Array<{ childName: string; mode: DesktopCanvasCustomArrangeMode }> = [
    { childName: "n41", mode: "rows" },
    { childName: "n96", mode: "columns" },
    { childName: "n97", mode: "table" },
];

export const OBJECT_TOOLBAR_ACTIONS: Array<{ childName: string; kind: PrimitiveDisplayNodeKind }> = [
    { childName: "text", kind: "text" },
    { childName: "richtext", kind: "richText" },
    { childName: "inputtext", kind: "textInput" },
    { childName: "graph", kind: "graph" },
    { childName: "list", kind: "list" },
    { childName: "loader", kind: "loader" },
    { childName: "loader3D", kind: "loader3D" },
];

export const MENU_ITEMS: Array<{ title: string; action: ShellAction }> = [
    { title: "文件", action: "menu:file" },
    { title: "编辑", action: "menu:edit" },
    { title: "资源", action: "menu:resource" },
    { title: "工具", action: "menu:tools" },
    { title: "视图", action: "menu:view" },
    { title: "帮助", action: "menu:help" },
];

export const TOOLBAR_ACTIONS: Array<{ childName: string; action: ShellAction }> = [
    { childName: "tbCreatePkg", action: "toolbar:createPackage" },
    { childName: "tbCreateCom", action: "toolbar:createComponent" },
    { childName: "tbCreateButton", action: "toolbar:createButton" },
    { childName: "tbCreateLabel", action: "toolbar:createLabel" },
    { childName: "tbCreateComboBox", action: "toolbar:createComboBox" },
    { childName: "tbCreateProgressBar", action: "toolbar:createProgressBar" },
    { childName: "tbCreateSlider", action: "toolbar:createSlider" },
    { childName: "tbCreateFont", action: "toolbar:createBitmapFont" },
    { childName: "tbCreateMc", action: "toolbar:createMovieClip" },
    { childName: "tbImport", action: "toolbar:importProjectDirectory" },
    { childName: "tbSave", action: "toolbar:save" },
    { childName: "tbPublish", action: "toolbar:publish" },
    { childName: "tbPublishSettings", action: "toolbar:publishSettings" },
    { childName: "tbCanvas", action: "toolbar:canvasSettings" },
    { childName: "tbBranch", action: "toolbar:branchSettings" },
    { childName: "tbLang", action: "toolbar:languageSettings" },
    { childName: "tbTest", action: "toolbar:test" },
    { childName: "tbStopTest", action: "toolbar:stopTest" },
    { childName: "tbReload", action: "toolbar:reloadTest" },
];
