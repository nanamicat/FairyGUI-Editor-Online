import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
	resolveAuthoringProjectPath,
	resolveOpenFairyGuiModuleRoot,
} from './project-boundary.mjs';
import { importFile } from './verification-helpers.mjs';

const OPENFAIRYGUI_MODULE_ROOT = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const CORE_PACKAGE_DIR = path.join(OPENFAIRYGUI_MODULE_ROOT, 'core');
const FUNCTIONS_PACKAGE_DIR = path.join(OPENFAIRYGUI_MODULE_ROOT, 'functions');
const PROJECT_PATH = resolveAuthoringProjectPath(process.argv[3]);
const OUTPUT_PATH = path.resolve(
	'assets',
	'resources',
	'editor',
	'project-snapshot.json',
);
const OUTPUT_META_PATH = `${OUTPUT_PATH}.meta`;

function callOptional(object, methodName, fallback) {
	if (!object || typeof object[methodName] !== 'function') return fallback;
	const value = object[methodName]();
	return value === undefined || value === null ? fallback : value;
}

function toStringValue(value, fallback = '') {
	if (value === undefined || value === null) return fallback;
	return String(value);
}

function toNumberValue(value, fallback = 0) {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	return fallback;
}

function toBooleanValue(value, fallback = false) {
	if (typeof value === 'boolean') return value;
	return fallback;
}

function countOptional(object, methodName) {
	const value = callOptional(object, methodName, []);
	return Array.isArray(value) ? value.length : 0;
}

function typeOfProperty(object, fallback) {
	return toStringValue(object?.propertyType || object?.constructor?.name, fallback);
}

function buildResource(resource) {
	return {
		id: toStringValue(callOptional(resource, 'getId', '')),
		name: toStringValue(callOptional(resource, 'getName', '')),
		path: toStringValue(callOptional(resource, 'getPath', '')),
		type: typeOfProperty(resource, 'Resource'),
		exported: toBooleanValue(callOptional(resource, 'getExported', false)),
		fileName: toStringValue(callOptional(resource, 'getFileName', '')),
		width: optionalNumber(callOptional(resource, 'getWidth', undefined)),
		height: optionalNumber(callOptional(resource, 'getHeight', undefined)),
	};
}

function buildComponent(component) {
	const children = callOptional(component, 'listChildren', []);
	const controllers = callOptional(component, 'listControllers', []);
	const transitions = callOptional(component, 'listTransitions', []);

	return {
		id: toStringValue(callOptional(component, 'getId', '')),
		name: toStringValue(callOptional(component, 'getName', '')),
		path: toStringValue(callOptional(component, 'getPath', '')),
		exported: toBooleanValue(callOptional(component, 'getExported', false)),
		width: toNumberValue(callOptional(component, 'getWidth', 0)),
		height: toNumberValue(callOptional(component, 'getHeight', 0)),
		childCount: Array.isArray(children) ? children.length : 0,
		controllerCount: Array.isArray(controllers) ? controllers.length : 0,
		transitionCount: Array.isArray(transitions) ? transitions.length : 0,
		children: Array.isArray(children) ? children.map(buildDisplayNode) : [],
	};
}

function buildDisplayNode(node) {
	return {
		id: toStringValue(callOptional(node, 'getId', '')),
		name: toStringValue(callOptional(node, 'getName', '')),
		type: typeOfProperty(node, 'GObject'),
		x: toNumberValue(callOptional(node, 'getX', 0)),
		y: toNumberValue(callOptional(node, 'getY', 0)),
		width: toNumberValue(callOptional(node, 'getWidth', 0)),
		height: toNumberValue(callOptional(node, 'getHeight', 0)),
		src: toStringValue(callOptional(node, 'getSrc', '')),
		visible: toBooleanValue(callOptional(node, 'getVisible', true), true),
		touchable: toBooleanValue(callOptional(node, 'getTouchable', true), true),
		grayed: toBooleanValue(callOptional(node, 'getGrayed', false), false),
		alpha: toNumberValue(callOptional(node, 'getAlpha', 1)),
		rotation: toNumberValue(callOptional(node, 'getRotation', 0)),
		pivotX: toNumberValue(callOptional(node, 'getPivotX', 0)),
		pivotY: toNumberValue(callOptional(node, 'getPivotY', 0)),
		pivotAsAnchor: toBooleanValue(callOptional(node, 'getPivotAsAnchor', false), false),
		text: toStringValue(callOptional(node, 'getText', '')),
		font: toStringValue(callOptional(node, 'getFont', '')),
		fontSize: toNumberValue(callOptional(node, 'getFontSize', 0)),
		color: toStringValue(callOptional(node, 'getColor', '')),
		group: toStringValue(callOptional(node, 'getGroup', '')),
		gearCount: countOptional(node, 'listGears'),
		relationCount: countOptional(node, 'getRelations'),
	};
}

function optionalNumber(value) {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function tryLiftToUam(liftDocumentToUamProject, doc) {
	try {
		liftDocumentToUamProject(doc);
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

const [{ NodeIO }, { inspect }, { liftDocumentToUamProject }] =
	await Promise.all([
		importFile(path.join(CORE_PACKAGE_DIR, 'dist', 'node.js')),
		importFile(path.join(FUNCTIONS_PACKAGE_DIR, 'dist', 'index.js')),
		importFile(path.join(CORE_PACKAGE_DIR, 'dist', 'index.js')),
	]);

const io = new NodeIO();
const doc = await io.readProject(PROJECT_PATH);
const report = inspect(doc);
const root = doc.getRoot();
const uamLift = tryLiftToUam(liftDocumentToUamProject, doc);
const diagnostics = [];

if (!uamLift.ok) {
	diagnostics.push({
		severity: 'warning',
		code: 'PROJECT_MODEL_LOAD_FAILED',
		message: `Project model load failed: ${uamLift.error}`,
	});
}

const packages = root.listPackages().map((pkg) => ({
	id: toStringValue(callOptional(pkg, 'getId', '')),
	name: toStringValue(callOptional(pkg, 'getName', '')),
	publishName: toStringValue(callOptional(pkg, 'getPublishName', '')),
	resources: callOptional(pkg, 'listResources', []).map(buildResource),
	components: callOptional(pkg, 'listComponents', []).map(buildComponent),
}));

const snapshot = {
	schemaVersion: 1,
	source: {
		uamLift,
	},
	project: {
		id: toStringValue(callOptional(root, 'getProjectId', '')),
		type: callOptional(root, 'getProjectType', ''),
		version: toStringValue(callOptional(root, 'getVersion', '')),
	},
	totals: report.totals,
	packages,
	diagnostics,
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
await writeFile(
	OUTPUT_META_PATH,
	`${JSON.stringify({ uuid: '437ccad5-fbc5-45d4-970d-46f83241a7e9' }, null, 2)}\n`,
	'utf8',
);

console.log(
	JSON.stringify(
		{
			ok: true,
			output: path.relative(process.cwd(), OUTPUT_PATH).replaceAll(path.sep, '/'),
			openfairyguiModuleRoot: path.relative(process.cwd(), OPENFAIRYGUI_MODULE_ROOT).replaceAll(path.sep, '/'),
			packageCount: snapshot.totals.packages,
			componentCount: snapshot.totals.components,
			displayObjectCount: snapshot.totals.displayObjects,
			uamLift,
			diagnosticCount: diagnostics.length,
		},
		null,
		2,
	),
);
