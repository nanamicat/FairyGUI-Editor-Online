import path from 'node:path';

export const DEFAULT_OPENFAIRYGUI_MODULE_ROOT = path.resolve(
	'node_modules',
	'@openfairygui',
);

export const EDITOR_SHELL_PROJECT_PATH = path.resolve(
	'vendor',
	'FairyGUI-Editor',
	'ui',
	'FairyGUI-Editor.fairy',
);

export const DEFAULT_AUTHORING_PROJECT_PATH = path.resolve(
	'samples',
	'FairyGUI-layabox',
	'demo',
	'UIProject',
	'FairyGUI-layabox-demo.fairy',
);

export function resolveOpenFairyGuiModuleRoot(value) {
	return path.resolve(value ?? process.env.OPENFAIRYGUI_MODULE_ROOT ?? DEFAULT_OPENFAIRYGUI_MODULE_ROOT);
}

export function resolveAuthoringProjectPath(value) {
	return path.resolve(value ?? process.env.FAIRYGUI_AUTHORING_PROJECT ?? DEFAULT_AUTHORING_PROJECT_PATH);
}

export function relativeWorkspacePath(filePath, root = process.cwd()) {
	return path.relative(root, filePath).replaceAll(path.sep, '/');
}
