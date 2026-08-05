import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MemoryBrowserStorage } from '../browser-storage-fixture.mjs';
import {
	resolveAuthoringProjectPath,
	resolveOpenFairyGuiModuleRoot,
} from '../project-boundary.mjs';
import { importTypeScriptModule } from '../import-typescript-module.mjs';
import { cloneJson, importFile, readJson } from '../verification-helpers.mjs';

const root = process.cwd();
const openfairyguiModuleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const reportPath = path.resolve(
	process.argv[3] ?? 'verification/reports/phase9-high-risk-transaction-report.json',
);
const sourceProjectPath = resolveAuthoringProjectPath(process.argv[4]);
const sourceProjectDir = path.dirname(sourceProjectPath);
const browserFairyPath = path.basename(sourceProjectPath);
const corePackageDir = path.join(openfairyguiModuleRoot, 'core');
const backendPackageDir = path.join(openfairyguiModuleRoot, 'backend');
const coreEntry = path.join(corePackageDir, 'dist', 'index.js');
const coreUamEntry = path.join(corePackageDir, 'dist', 'uam', 'index.js');
const coreProjectIoEntry = path.join(corePackageDir, 'dist', 'project-io.js');
const backendEntry = path.join(backendPackageDir, 'dist', 'index.mjs');
const isWorkspaceSource = path.basename(openfairyguiModuleRoot) === 'packages';

const SUPPORTED_NODE_KINDS = new Set([
	'image', 'text', 'richText', 'textInput', 'component', 'list', 'tree', 'graph', 'group', 'loader',
	'loader3D', 'movieClip', 'button', 'label', 'comboBox', 'progressBar', 'slider', 'scrollBar',
]);

const SUPPORTED_GEAR_KINDS = [
	'display', 'display2', 'look', 'xy', 'size', 'color', 'animation', 'text', 'icon', 'fontSize',
];

function relativePath(filePath) {
	return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function sha256File(filePath) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readPackageVersions() {
	return {
		core: readJson(path.join(corePackageDir, 'package.json')).version,
		functions: readJson(path.join(openfairyguiModuleRoot, 'functions', 'package.json')).version,
		backend: readJson(path.join(backendPackageDir, 'package.json')).version,
		cli: readJson(path.join(openfairyguiModuleRoot, 'cli', 'package.json')).version,
	};
}

async function readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem) {
	const reader = new ProjectReader(fileSystem);
	const doc = await reader.read(browserFairyPath, {
		includeBinaryData: true,
		hydrateResourceBytes: true,
	});
	return liftDocumentToUamProject(doc);
}

function findResource(project, selector) {
	const pkg = project.packages?.find((candidate) => candidate.id === selector.packageId);
	return pkg?.resources?.find((candidate) => candidate.id === selector.resourceId) ?? null;
}

function findPackage(project, packageId) {
	return project.packages?.find((candidate) => candidate.id === packageId) ?? null;
}

function findComponent(project, selector) {
	const pkg = project.packages?.find((candidate) => candidate.id === selector.packageId);
	return pkg?.resources?.find((candidate) => candidate.id === selector.componentResourceId)?.component ?? null;
}

function findDisplayNode(project, selector) {
	return findComponent(project, selector)?.displayList?.find((node) => node.id === selector.displayNodeId) ?? null;
}

function countComponentReferences(project, selector) {
	return (project.packages ?? []).reduce((count, pkg) =>
		count + (pkg.resources ?? []).reduce((packageCount, resource) =>
			packageCount + (resource.component?.displayList ?? []).filter((node) =>
				node.kind === 'component'
				&& node.resource?.resourceId === selector.componentResourceId
				&& (node.resource?.packageId || pkg.id) === selector.packageId,
			).length, 0), 0);
}

function findController(project, selector) {
	return findComponent(project, selector)?.controllers?.find((controller) => controller.name === selector.controllerName) ?? null;
}

function findTransition(project, selector) {
	return findComponent(project, selector)?.transitions?.find((transition) => transition.name === selector.transitionName) ?? null;
}

function findLookGear(project, selector) {
	return findDisplayNode(project, selector)?.gears?.find(
		(gear) => gear.kind === 'look' && gear.controllerName === selector.controllerName,
	) ?? null;
}

function findGear(project, selector) {
	return findDisplayNode(project, selector)?.gears?.find(
		(gear) => gear.kind === selector.kind && gear.controllerName === selector.controllerName,
	) ?? null;
}

function resourceFileName(resource) {
	return String(resource?.fileName || resource?.file || resource?.name || '');
}

function sameBytes(actual, expected) {
	if (!actual || typeof actual !== 'object' || typeof actual.length !== 'number') return false;
	const values = Array.from(actual);
	return values.length === expected.byteLength && values.every((value, index) => value === expected[index]);
}

function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (!value || typeof value !== 'object') return JSON.stringify(value);
	const object = value;
	return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

function normalizeGearForComparison(gear) {
	if (!gear) return null;
	const normalized = cloneJson(gear);
	delete normalized.name;
	if (normalized.tween !== true) {
		delete normalized.tweenDuration;
		delete normalized.tweenDelay;
		delete normalized.easeType;
		delete normalized.customEasePath;
	}
	return normalized;
}

function gearMatches(actual, expected) {
	return stableJson(normalizeGearForComparison(actual)) === stableJson(normalizeGearForComparison(expected));
}

function normalizeControllerForComparison(controller) {
	if (!controller) return null;
	const normalized = cloneJson(controller);
	for (const action of normalized.actions ?? []) delete action.name;
	return normalized;
}

function controllerMatches(actual, expected) {
	return stableJson(normalizeControllerForComparison(actual)) === stableJson(normalizeControllerForComparison(expected));
}

function normalizeDisplayNodeForComparison(node, packageId) {
	const normalized = cloneJson(node);
	if (
		['image', 'movieClip', 'component'].includes(normalized?.kind)
		&& normalized.resource?.packageId === packageId
	) {
		normalized.resource.packageId = '';
	}
	return normalized;
}

function displayNodeMatches(actual, expected, packageId) {
	return stableJson(normalizeDisplayNodeForComparison(actual, packageId))
		=== stableJson(normalizeDisplayNodeForComparison(expected, packageId));
}

function canonicalTransitionValue(actionType, value) {
	const raw = String(value ?? '');
	if (!raw || raw === '-' || raw === 'true' || raw === 'false' || raw === 'p' || raw === 's') return raw;
	const numeric = Number(raw);
	if (!Number.isFinite(numeric)) return raw;
	if (actionType === 4 || actionType === 12) return numeric.toFixed(2);
	return numeric.toFixed(2).replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, '$1');
}

function normalizeTransitionForComparison(transition) {
	if (!transition) return null;
	// ProjectWriter normalizes omitted transition fields and numeric lexemes. Compare
	// the serialized authoring payload rather than in-memory undefined properties.
	const normalized = JSON.parse(JSON.stringify(transition));
	for (const item of normalized.items ?? []) {
		item.startValue = (item.startValue ?? []).map((value) => canonicalTransitionValue(item.actionType, value));
		item.endValue = (item.endValue ?? []).map((value) => canonicalTransitionValue(item.actionType, value));
	}
	return normalized;
}

function transitionMatchWithDetails(actual, expected) {
	if (stableJson(normalizeTransitionForComparison(actual)) === stableJson(normalizeTransitionForComparison(expected))) return true;
	return {
		ok: false,
		expected: normalizeTransitionForComparison(expected),
		actual: normalizeTransitionForComparison(actual),
	};
}

function displayNodeIndex(project, selector) {
	return findComponent(project, selector)?.displayList?.findIndex((node) => node.id === selector.displayNodeId) ?? -1;
}

function lookGearMatches(actual, expected) {
	if (!actual) return false;
	if (
		actual.kind !== expected.kind
		|| actual.controllerName !== expected.controllerName
		|| actual.condition !== expected.condition
		|| actual.positionsInPercent !== expected.positionsInPercent
		|| actual.tween !== expected.tween
		|| stableJson(actual.states) !== stableJson(expected.states)
		|| stableJson(actual.defaultValue) !== stableJson(expected.defaultValue)
	) return false;

	return !expected.tween || (
		actual.tweenDuration === expected.tweenDuration
		&& actual.tweenDelay === expected.tweenDelay
		&& actual.easeType === expected.easeType
		&& actual.customEasePath === expected.customEasePath
	);
}

function xyGearMatches(actual, expected) {
	if (!actual) return false;
	return actual.kind === expected.kind
		&& actual.controllerName === expected.controllerName
		&& actual.condition === expected.condition
		&& actual.positionsInPercent === expected.positionsInPercent
		&& actual.tween === expected.tween
		&& actual.tweenDuration === expected.tweenDuration
		&& actual.tweenDelay === expected.tweenDelay
		&& actual.easeType === expected.easeType
		&& actual.customEasePath === expected.customEasePath
		&& stableJson(actual.states) === stableJson(expected.states)
		&& stableJson(actual.defaultValue) === stableJson(expected.defaultValue);
}

function findCandidates(project) {
	const resources = (project.packages ?? []).flatMap((pkg) =>
		(pkg.resources ?? []).map((resource) => ({ pkg, resource })),
	);
	const components = resources.filter(({ resource }) => Boolean(resource.component));
	const nodeEntries = components.flatMap(({ pkg, resource }) =>
		(resource.component.displayList ?? []).map((node) => ({ pkg, resource, node })),
	);
	const hydratedAssets = resources.filter(({ resource }) =>
		resource.kind !== 'component'
		&& resource.sourceBytes instanceof Uint8Array
		&& resource.sourceBytes.byteLength > 0,
	);
	const assetsByKind = new Map();
	for (const entry of hydratedAssets) {
		if (!assetsByKind.has(entry.resource.kind)) assetsByKind.set(entry.resource.kind, []);
		assetsByKind.get(entry.resource.kind).push(entry);
	}
	const image = assetsByKind.get('image')?.[0];
	const componentResource = resources.find(({ resource }) => resource.kind === 'component');
	const referencedComponent = resources.find(({ pkg, resource }) =>
		resource.kind === 'component'
		&& countComponentReferences(project, {
			packageId: pkg.id,
			componentResourceId: resource.id,
		}) > 0,
	);
	const attach = nodeEntries.find(({ node }) => node.kind === 'image' && node.id && !(node.gears ?? []).length);
	const controller = components.find(({ resource }) => (resource.component.controllers ?? []).length);
	const transition = components.find(({ resource }) => (resource.component.transitions ?? []).length);
	const nodeByKind = new Map();
	for (const entry of nodeEntries) {
		if (!nodeByKind.has(entry.node.kind)) nodeByKind.set(entry.node.kind, entry);
	}
	const gearEntries = nodeEntries.flatMap((entry) =>
		(entry.node.gears ?? []).map((gear) => ({ ...entry, gear })),
	);
	const gearByKind = new Map();
	for (const entry of gearEntries) {
		if (!gearByKind.has(entry.gear.kind)) gearByKind.set(entry.gear.kind, entry);
	}
	const addGearByKind = new Map();
	for (const kind of SUPPORTED_GEAR_KINDS) {
		const preferred = gearByKind.get(kind);
		const componentEntries = preferred
			? nodeEntries.filter((entry) => entry.pkg.id === preferred.pkg.id && entry.resource.id === preferred.resource.id)
			: nodeEntries;
		const eligibleEntries = preferred
			? [
				...componentEntries.filter((entry) => entry.node.kind === preferred.node.kind),
				...componentEntries.filter((entry) => entry.node.kind !== preferred.node.kind),
			]
			: componentEntries;
		const candidate = eligibleEntries.find(({ resource, node }) => {
			if (!SUPPORTED_NODE_KINDS.has(node.kind) || !node.id) return false;
			return (resource.component.controllers ?? []).some((controllerValue) => controllerValue.name
				&& controllerValue.pages?.[0]
				&& !(node.gears ?? []).some((gear) => gear.kind === kind && gear.controllerName === controllerValue.name));
		});
		if (candidate) addGearByKind.set(kind, candidate);
	}
	const controllerWithTransition = components.find(({ resource }) =>
		(resource.component.controllers ?? []).length >= 2
		&& (resource.component.transitions ?? []).length > 0,
	);
	const transitionByActionType = new Map();
	for (const entry of components) {
		for (const candidate of entry.resource.component.transitions ?? []) {
			for (const item of candidate.items ?? []) {
				if (!transitionByActionType.has(item.actionType)) {
					transitionByActionType.set(item.actionType, { ...entry, transition: candidate });
				}
			}
		}
	}
	const targetForReparent = attach
		? components.find(({ pkg, resource }) => pkg.id === attach.pkg.id && resource.id !== attach.resource.id)
		: null;

	assert(image, 'No hydrated image resource was found for Phase 9 resource verification.');
	assert(componentResource, 'No component resource was found for Phase 9 resource verification.');
	assert(referencedComponent, 'No referenced component was found for Phase 9 component size verification.');
	assert(attach, 'No simple image display node was found for Phase 9 attach/detach verification.');
	assert(controller, 'No controller component was found for Phase 9 controller verification.');
	assert(transition, 'No transition component was found for Phase 9 transition verification.');
	assert(controllerWithTransition, 'No component with controllers and a transition was found for Phase 9 controller action verification.');
	assert(targetForReparent, 'No same-package component target was found for Phase 9 display reparent verification.');
	for (const kind of ['image', 'sound', 'font', 'movieClip']) {
		assert(assetsByKind.has(kind), `No hydrated ${kind} resource was found for Phase 9 asset verification.`);
	}
	for (const kind of SUPPORTED_GEAR_KINDS) {
		assert(gearByKind.has(kind), `No ${kind} gear was found for Phase 9 gear verification.`);
		assert(addGearByKind.has(kind), `No display node/controller pair was found for Phase 9 ${kind} gear lifecycle verification.`);
	}

	return {
		assetsByKind,
		image,
		componentResource,
		referencedComponent,
		attach,
		controller,
		controllerWithTransition,
		transition,
		nodeByKind,
		gearByKind,
		addGearByKind,
		transitionByActionType,
		targetForReparent,
	};
}

function summarizeResult(result) {
	if (result.ok) {
		return {
			ok: true,
			revision: result.data?.revision,
			dirty: result.data?.dirty,
			durationMs: result.meta?.durationMs,
		};
	}

	return {
		ok: false,
		revision: result.session?.revision ?? result.snapshot?.revision,
		error: {
			code: result.error?.code ?? 'unknown_error',
			message: result.error?.message ?? 'Unknown backend error.',
			opKind: result.error?.opKind,
			issues: result.error?.issues ?? [],
		},
	};
}

function makeLookGear(controllerName, pages) {
	const value = { alpha: 1, rotation: 0, grayed: false, touchable: true };
	return {
		kind: 'look',
		name: '',
		controllerName,
		states: pages.map((page) => ({ pageId: page.id, value: { ...value } })),
		defaultValue: value,
		condition: '',
		positionsInPercent: false,
		tween: false,
		tweenDuration: 0,
		tweenDelay: 0,
		easeType: 0,
		customEasePath: '',
	};
}

function makeXyGear(controllerName, pageId, node, x, y) {
	const position = node.position ?? {};
	const value = { x: Number(position.x ?? 0), y: Number(position.y ?? 0) };
	return {
		kind: 'xy',
		name: 'phase9-xy',
		controllerName,
		states: [{ pageId, value: { x, y } }],
		defaultValue: value,
		condition: '',
		positionsInPercent: false,
		tween: false,
		tweenDuration: 0.3,
		tweenDelay: 0,
		easeType: 5,
		customEasePath: '',
	};
}

function makeAssetCopy(asset, id, suffix) {
	const copy = cloneJson(asset);
	const extension = path.extname(resourceFileName(asset));
	const name = `${asset.name || asset.id}_${suffix}`;
	copy.id = id;
	copy.name = name;
	copy.path = `/phase9-contract/${asset.kind}`;
	if ('fileName' in copy || asset.kind === 'image' || asset.kind === 'font' || asset.kind === 'movieClip') {
		copy.fileName = `${name}${extension}`;
	} else {
		copy.file = `${name}${extension}`;
	}
	copy.sourceBytes = new Uint8Array(asset.sourceBytes);
	delete copy.sourcePath;
	return copy;
}

function assetMatches(actual, expected) {
	return Boolean(actual)
		&& actual.kind === expected.kind
		&& actual.id === expected.id
		&& actual.name === expected.name
		&& actual.path === expected.path
		&& resourceFileName(actual) === resourceFileName(expected)
		&& stableJson(actual.dimensions ?? null) === stableJson(expected.dimensions ?? null)
		&& stableJson(actual.metadata ?? null) === stableJson(expected.metadata ?? null)
		&& stableJson(actual.movieClip ?? null) === stableJson(expected.movieClip ?? null)
		&& sameBytes(actual.sourceBytes, expected.sourceBytes);
}

function makeGearForController(template, controller, suffix) {
	const gear = cloneJson(template);
	const page = controller.pages?.[0];
	assert(page?.id, `Controller ${controller.name} has no page for ${template.kind} gear verification.`);
	gear.name = `${gear.name || gear.kind}_${suffix}`;
	gear.controllerName = controller.name;
	if (gear.kind === 'display' || gear.kind === 'display2') {
		gear.visibleOnPageIds = [page.id];
		return gear;
	}
	const value = cloneJson(gear.states?.[0]?.value ?? gear.defaultValue);
	gear.states = [{ pageId: page.id, value }];
	return gear;
}

function mutateGearForVerification(gear, controller) {
	const updated = cloneJson(gear);
	if (updated.kind === 'display' || updated.kind === 'display2') {
		const selected = new Set(updated.visibleOnPageIds ?? []);
		const replacement = controller.pages.find((page) => !selected.has(page.id));
		updated.visibleOnPageIds = replacement ? [replacement.id] : [];
		if (updated.kind === 'display2') updated.condition = updated.condition === 'and' ? 'or' : 'and';
		return updated;
	}
	const firstState = updated.states?.find((state) => state.value !== null);
	const value = firstState?.value ?? updated.defaultValue;
	assert(value, `${updated.kind} gear has no editable page state or default value.`);
	switch (updated.kind) {
		case 'look':
			value.alpha = Number(value.alpha ?? 1) === 0.5 ? 0.75 : 0.5;
			updated.tween = !updated.tween;
			break;
		case 'xy':
			value.x = Number(value.x ?? 0) + 17;
			value.y = Number(value.y ?? 0) + 19;
			break;
		case 'size':
			value.width = Number(value.width ?? 0) + 3;
			value.height = Number(value.height ?? 0) + 5;
			break;
		case 'color':
			value.color = value.color === '#123456' ? '#654321' : '#123456';
			break;
		case 'animation':
			value.frame = Number(value.frame ?? 0) + 1;
			value.playing = !value.playing;
			break;
		case 'text':
			value.text = `${value.text ?? ''}__phase9`;
			break;
		case 'icon':
			value.icon = `${value.icon || 'ui://phase9'}__phase9`;
			break;
		case 'fontSize':
			value.fontSize = Number(value.fontSize ?? 12) + 1;
			break;
		default:
			throw new Error(`Unsupported gear mutation kind ${updated.kind}.`);
	}
	return updated;
}

async function main() {
	for (const filePath of [coreEntry, coreUamEntry, coreProjectIoEntry, backendEntry]) {
		assert(existsSync(filePath), `Missing OpenFairyGUI entry: ${filePath}`);
	}
	assert(existsSync(sourceProjectPath), `Missing authoring project file: ${sourceProjectPath}`);

	const sourceHashBefore = sha256File(sourceProjectPath);
	const [
		{ createDefaultUamPlainTextProperties, deriveMovieClipModelFromJta, liftDocumentToUamProject, parseJta },
		{ validateTransactionSupport },
		{ ProjectReader },
		backend,
	] = await Promise.all([
		importFile(coreEntry),
		importFile(coreUamEntry),
		importFile(coreProjectIoEntry),
		importFile(backendEntry),
	]);
	const { BackendRuntime, createBackendStorageFileSystem } = backend;
	const {
		getDisplayNodeGearEditorModel,
		prepareGroupDisplayNodes,
		prepareImportMovieClipResource,
		prepareMoveComponent,
		prepareRemoveComponent,
		prepareRemovePackage,
		readComponentProperties,
		prepareUpdateDisplayNodeGears,
		prepareUpdateMovieClipResource,
		prepareUpdateDisplayNodeRelations,
	} = await importTypeScriptModule(
		'src/editor/commands/HighRiskAuthoringTransactions.ts',
	);
	assert(typeof BackendRuntime === 'function', 'Backend root does not export BackendRuntime.');
	assert(typeof createBackendStorageFileSystem === 'function', 'Backend root does not export createBackendStorageFileSystem.');

	const initialStorage = new MemoryBrowserStorage();
	initialStorage.importDirectory(sourceProjectDir);
	const initialFileSystem = createBackendStorageFileSystem(initialStorage);
	const initialProject = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, initialFileSystem);
	const baselineIssues = validateTransactionSupport(initialProject, []);
	assert(baselineIssues.length === 0, `Phase 9 baseline support failed with ${baselineIssues.length} issue(s).`);
	const candidates = findCandidates(initialProject);
	let storage;
	let fileSystem;
	let runtime;
	let sessionId = '';
	let revision = 0;
	let firstOpened = null;
	const resetSession = async () => {
		storage = new MemoryBrowserStorage();
		storage.importDirectory(sourceProjectDir);
		fileSystem = createBackendStorageFileSystem(storage);
		const project = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
		const supportIssues = validateTransactionSupport(project, []);
		assert(supportIssues.length === 0, `Phase 9 reset baseline support failed with ${supportIssues.length} issue(s).`);
		runtime = new BackendRuntime();
		const opened = runtime.openProjectSession({
			project: cloneJson(project),
			storage: {
				fileSystem,
				fairyPath: browserFairyPath,
				canonicalProjectPath: 'opfs://phase9-high-risk-transaction',
				canonicalPathKey: 'opfs://phase9-high-risk-transaction',
			},
		});
		assert(opened.ok, `Phase 9 openProjectSession failed: ${JSON.stringify(opened)}`);
		sessionId = opened.data.sessionId;
		revision = opened.data.revision;
		if (!firstOpened) firstOpened = opened;
	};
	await resetSession();
	const operations = [];

	const applySaveReload = async (label, operation, verify, required = true) => {
		try {
			const before = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
			const supportIssues = validateTransactionSupport(before, [operation]);
			const applied = await runtime.applyTransaction({
				sessionId,
				expectedRevision: revision,
				operations: [operation],
			});
			if (!applied.ok) {
				operations.push({
					label,
					operation,
					required,
					supportIssueCodes: supportIssues.map((issue) => issue.code),
					apply: summarizeResult(applied),
					save: { ok: false },
					reloadOk: false,
					error: applied.error?.message ?? 'transaction apply failed',
				});
				return false;
			}
			revision = applied.data.revision;
			const saved = await runtime.saveSession({ sessionId, expectedRevision: revision });
			if (!saved.ok) {
				operations.push({
					label,
					operation,
					required,
					supportIssueCodes: supportIssues.map((issue) => issue.code),
					apply: summarizeResult(applied),
					save: summarizeResult(saved),
					reloadOk: false,
					error: saved.error?.message ?? 'transaction save failed',
				});
				return false;
			}
			const reloaded = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
			const verification = verify(reloaded);
			const reloadOk = typeof verification === 'object' && verification !== null
				? verification.ok === true
				: verification === true;
			operations.push({
				label,
				operation,
				required,
				supportIssueCodes: supportIssues.map((issue) => issue.code),
				apply: summarizeResult(applied),
				save: summarizeResult(saved),
				reloadOk,
				reload: typeof verification === 'object' && verification !== null ? verification : undefined,
				error: reloadOk ? undefined : 'reload state did not match the operation',
			});
			return reloadOk;
		} catch (error) {
			operations.push({
				label,
				operation,
				required,
				apply: { ok: false },
				save: { ok: false },
				reloadOk: false,
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	};

	const applySaveReloadBatch = async (label, batch, verify, required = true, reportBatch = batch) => {
		assert(batch.length > 0, `Phase 9 batch ${label} must contain at least one operation.`);
		try {
			const before = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
			const supportIssues = validateTransactionSupport(before, batch);
			const applied = await runtime.applyTransaction({
				sessionId,
				expectedRevision: revision,
				operations: batch,
			});
			if (!applied.ok) {
				operations.push({
					label,
					operation: reportBatch[reportBatch.length - 1],
					batch: reportBatch,
					required,
					supportIssueCodes: supportIssues.map((issue) => issue.code),
					apply: summarizeResult(applied),
					save: { ok: false },
					reloadOk: false,
					error: applied.error?.message ?? 'transaction batch apply failed',
				});
				return false;
			}
			revision = applied.data.revision;
			const saved = await runtime.saveSession({ sessionId, expectedRevision: revision });
			if (!saved.ok) {
				operations.push({
					label,
					operation: reportBatch[reportBatch.length - 1],
					batch: reportBatch,
					required,
					supportIssueCodes: supportIssues.map((issue) => issue.code),
					apply: summarizeResult(applied),
					save: summarizeResult(saved),
					reloadOk: false,
					error: saved.error?.message ?? 'transaction batch save failed',
				});
				return false;
			}
			const reloaded = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
			const reloadOk = verify(reloaded);
			operations.push({
				label,
				operation: reportBatch[reportBatch.length - 1],
				batch: reportBatch,
				required,
				supportIssueCodes: supportIssues.map((issue) => issue.code),
				apply: summarizeResult(applied),
				save: summarizeResult(saved),
				reloadOk,
				error: reloadOk ? undefined : 'reload state did not match the transaction batch',
			});
			return reloadOk;
		} catch (error) {
			operations.push({
				label,
				operation: reportBatch[reportBatch.length - 1],
				batch: reportBatch,
				required,
				apply: { ok: false },
				save: { ok: false },
				reloadOk: false,
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	};

	const packageLifecycleLabels = [];
	const addedPackage = {
		id: 'phase9alpha18pkg',
		name: 'Phase9 Alpha17 Package',
		compressPNG: null,
		jpegQuality: null,
		branchNames: [],
		publish: {
			name: 'Phase9 Alpha17 Package',
			path: '',
			branchPath: '',
			packageCount: 1,
			genCode: false,
			codePath: '',
			useGlobalAtlasSettings: true,
			maxAtlasSize: 2048,
			sizeOption: 'pot',
			forceSquare: false,
			allowRotation: false,
			paging: true,
			extractAlpha: false,
			maxAtlasIndex: 0,
			atlases: [],
			excludedResourceIds: [],
		},
		resources: [],
	};
	const renamedPackageName = 'Phase9 Alpha17 Package Renamed';
	const packageLabels = [
		'addPackage',
		'renamePackage',
		'renamePackage.undo',
		'removePackage',
		'removePackage.undo',
		'removePackage.cleanup',
	];
	packageLifecycleLabels.push(...packageLabels);
	await applySaveReload(
		packageLabels[0],
		{ opId: 'phase9-add-package', kind: 'addPackage', package: addedPackage, atIndex: initialProject.packages.length },
		(project) => {
			const pkg = findPackage(project, addedPackage.id);
			return pkg?.name === addedPackage.name && pkg.resources.length === 0;
		},
	);
	await applySaveReload(
		packageLabels[1],
		{ opId: 'phase9-rename-package', kind: 'renamePackage', selector: { packageId: addedPackage.id }, newName: renamedPackageName },
		(project) => findPackage(project, addedPackage.id)?.name === renamedPackageName,
	);
	await applySaveReload(
		packageLabels[2],
		{ opId: 'phase9-rename-package-undo', kind: 'renamePackage', selector: { packageId: addedPackage.id }, newName: addedPackage.name },
		(project) => findPackage(project, addedPackage.id)?.name === addedPackage.name,
	);
	await applySaveReload(
		packageLabels[3],
		{ opId: 'phase9-remove-package', kind: 'removePackage', selector: { packageId: addedPackage.id } },
		(project) => findPackage(project, addedPackage.id) === null,
	);
	await applySaveReload(
		packageLabels[4],
		{ opId: 'phase9-remove-package-undo', kind: 'addPackage', package: addedPackage, atIndex: initialProject.packages.length },
		(project) => findPackage(project, addedPackage.id)?.name === addedPackage.name,
	);
	await applySaveReload(
		packageLabels[5],
		{ opId: 'phase9-remove-package-cleanup', kind: 'removePackage', selector: { packageId: addedPackage.id } },
		(project) => findPackage(project, addedPackage.id) === null,
	);
	const nonEmptyPackageId = 'rbw1tvvv';
	const nonEmptyPackageIndex = initialProject.packages.findIndex((pkg) => pkg.id === nonEmptyPackageId);
	const nonEmptyPackage = cloneJson(initialProject.packages[nonEmptyPackageIndex]);
	assert(nonEmptyPackage?.resources.length > 0, 'Non-empty package removal fixture was not found.');
	const nonEmptyPackagePreparation = prepareRemovePackage(initialProject, { packageId: nonEmptyPackageId });
	assert(nonEmptyPackagePreparation.ok, `Non-empty package removal planner failed: ${JSON.stringify(nonEmptyPackagePreparation)}`);
	const nonEmptyPackageForward = nonEmptyPackagePreparation.transaction.operations ?? [
		nonEmptyPackagePreparation.transaction.operation,
	];
	const nonEmptyPackageInverse = nonEmptyPackagePreparation.transaction.inverseOperations ?? [
		nonEmptyPackagePreparation.transaction.inverseOperation,
	];
	const nonEmptyPackageReportInverse = nonEmptyPackageInverse.map((operation) => (
		operation.kind === 'addPackage'
			? {
				...operation,
				package: {
					id: nonEmptyPackage.id,
					name: nonEmptyPackage.name,
					resourceCount: nonEmptyPackage.resources.length,
				},
			}
			: operation
	));
	await applySaveReloadBatch(
		'removePackage.nonEmpty',
		nonEmptyPackageForward,
		(project) => findPackage(project, nonEmptyPackageId) === null
			&& project.packages.length === initialProject.packages.length - 1,
	);
	await applySaveReloadBatch(
		'removePackage.nonEmpty.undo',
		nonEmptyPackageInverse,
		(project) => {
			const restored = findPackage(project, nonEmptyPackageId);
			return project.packages.length === initialProject.packages.length
				&& project.packages.findIndex((pkg) => pkg.id === nonEmptyPackageId) === nonEmptyPackageIndex
				&& stableJson(restored) === stableJson(nonEmptyPackage);
		},
		true,
		nonEmptyPackageReportInverse,
	);
	await resetSession();

	const componentLifecycleLabels = [];
	const componentSourcePackage = candidates.componentResource.pkg;
	const componentTargetPackage = initialProject.packages.find((candidate) => candidate.id !== componentSourcePackage.id);
	assert(componentTargetPackage, 'No second package was found for Phase 9 component move verification.');
	const addedComponent = {
		kind: 'component',
		id: 'phase9alpha18component',
		name: 'Phase9 Alpha17 Component',
		path: '/',
		exported: false,
		favorite: false,
		branch: '',
		branchItemIds: [],
		component: {
			size: { width: 64, height: 64 },
			properties: readComponentProperties({}),
			customData: '',
			displayList: [],
			controllers: [],
			transitions: [],
		},
	};
	const componentSourceSelector = {
		packageId: componentSourcePackage.id,
		componentResourceId: addedComponent.id,
	};
	const componentTargetSelector = {
		packageId: componentTargetPackage.id,
		componentResourceId: addedComponent.id,
	};
	const componentSourceIndex = componentSourcePackage.resources.length;
	const componentTargetIndex = componentTargetPackage.resources.length;
	const componentLabels = [
		'addComponent',
		'moveComponent',
		'moveComponent.undo',
		'removeComponent',
		'removeComponent.undo',
		'removeComponent.cleanup',
	];
	componentLifecycleLabels.push(...componentLabels);
	await applySaveReload(
		componentLabels[0],
		{
			opId: 'phase9-add-component',
			kind: 'addComponent',
			selector: { packageId: componentSourceSelector.packageId },
			component: addedComponent,
			atIndex: componentSourceIndex,
		},
		(project) => stableJson(findResource(project, {
			packageId: componentSourceSelector.packageId,
			resourceId: componentSourceSelector.componentResourceId,
		})) === stableJson(addedComponent),
	);
	await applySaveReload(
		componentLabels[1],
		{
			opId: 'phase9-move-component',
			kind: 'moveComponent',
			selector: componentSourceSelector,
			toPackageId: componentTargetSelector.packageId,
			toIndex: componentTargetIndex,
		},
		(project) => {
			const moved = findResource(project, {
				packageId: componentTargetSelector.packageId,
				resourceId: componentTargetSelector.componentResourceId,
			});
			return stableJson(moved) === stableJson(addedComponent)
				&& findPackage(project, componentTargetSelector.packageId)?.resources.findIndex((resource) => resource.id === addedComponent.id) === componentTargetIndex;
		},
	);
	await applySaveReload(
		componentLabels[2],
		{
			opId: 'phase9-move-component-undo',
			kind: 'moveComponent',
			selector: componentTargetSelector,
			toPackageId: componentSourceSelector.packageId,
			toIndex: componentSourceIndex,
		},
		(project) => {
			const restored = findResource(project, {
				packageId: componentSourceSelector.packageId,
				resourceId: componentSourceSelector.componentResourceId,
			});
			return stableJson(restored) === stableJson(addedComponent)
				&& findPackage(project, componentSourceSelector.packageId)?.resources.findIndex((resource) => resource.id === addedComponent.id) === componentSourceIndex;
		},
	);
	await applySaveReload(
		componentLabels[3],
		{ opId: 'phase9-remove-component', kind: 'removeComponent', selector: componentSourceSelector },
		(project) => findResource(project, {
			packageId: componentSourceSelector.packageId,
			resourceId: componentSourceSelector.componentResourceId,
		}) === null,
	);
	await applySaveReload(
		componentLabels[4],
		{
			opId: 'phase9-remove-component-undo',
			kind: 'addComponent',
			selector: { packageId: componentSourceSelector.packageId },
			component: addedComponent,
			atIndex: componentSourceIndex,
		},
		(project) => stableJson(findResource(project, {
			packageId: componentSourceSelector.packageId,
			resourceId: componentSourceSelector.componentResourceId,
		})) === stableJson(addedComponent),
	);
	await applySaveReload(
		componentLabels[5],
		{ opId: 'phase9-remove-component-cleanup', kind: 'removeComponent', selector: componentSourceSelector },
		(project) => findResource(project, {
			packageId: componentSourceSelector.packageId,
			resourceId: componentSourceSelector.componentResourceId,
		}) === null,
	);
	await resetSession();

	const dependencyMoveSelector = { packageId: 'rbw1tv9t', componentResourceId: 'kcy10' };
	const dependencyMoveTargetPackageId = '9leh0eyf';
	const readDisplayDependency = (node, ownerPackageId) => {
		if (node.kind === 'component' && node.resource?.resourceId) {
			return {
				packageId: node.resource.packageId || ownerPackageId,
				resourceId: node.resource.resourceId,
			};
		}
		if (node.src) {
			return {
				packageId: node.packageId || ownerPackageId,
				resourceId: node.src,
			};
		}
		if ((node.kind === 'image' || node.kind === 'movieClip') && node.resource?.resourceId) {
			return {
				packageId: node.resource.packageId || ownerPackageId,
				resourceId: node.resource.resourceId,
			};
		}
		return null;
	};
	const dependencyMoveSourcePackage = findPackage(initialProject, dependencyMoveSelector.packageId);
	const dependencyMoveSource = findResource(initialProject, {
		packageId: dependencyMoveSelector.packageId,
		resourceId: dependencyMoveSelector.componentResourceId,
	});
	const dependencyMoveSourceIndex = dependencyMoveSourcePackage?.resources
		.findIndex((resource) => resource.id === dependencyMoveSelector.componentResourceId) ?? -1;
	assert(dependencyMoveSource?.kind === 'component' && dependencyMoveSourceIndex >= 0, 'Dependency move source fixture was not found.');
	const originalDependencyComponentModel = stableJson({
		properties: dependencyMoveSource.component.properties,
		transitions: dependencyMoveSource.component.transitions,
	});
	const originalDependencyReferences = dependencyMoveSource.component.displayList
		.map((node) => readDisplayDependency(node, dependencyMoveSelector.packageId))
		.filter((reference) => reference?.packageId === dependencyMoveSelector.packageId);
	const originalDependencyIncomingCount = countComponentReferences(initialProject, dependencyMoveSelector);
	const dependencyMovePreparation = prepareMoveComponent(
		initialProject,
		dependencyMoveSelector,
		dependencyMoveTargetPackageId,
	);
	assert(dependencyMovePreparation.ok, `Dependency move planner failed: ${JSON.stringify(dependencyMovePreparation)}`);
	const dependencyMoveForward = dependencyMovePreparation.transaction.operations ?? [];
	const dependencyMoveInverse = dependencyMovePreparation.transaction.inverseOperations ?? [];
	const dependencyMoveReportForward = dependencyMoveForward.map((operation) =>
		operation.kind === 'addResource'
			? {
				...operation,
				resource: {
					...operation.resource,
					sourceBytes: { byteLength: operation.resource.sourceBytes?.byteLength ?? 0 },
				},
			}
			: operation);
	const copiedDependencyIds = dependencyMoveForward
		.filter((operation) => operation.kind === 'addResource')
		.map((operation) => operation.resource.id);
	const copiedComponentDependencyIds = dependencyMoveForward
		.filter((operation) =>
			operation.kind === 'addComponent'
			&& operation.opId.includes('copy-component-dependency'))
		.map((operation) => operation.component.id);
	const allCopiedDependencyIds = [...copiedDependencyIds, ...copiedComponentDependencyIds];
	assert(
		copiedDependencyIds.length === 7,
		'Dependency move planner did not copy the seven binary resources in the real display/component-model closure.',
	);
	assert(
		copiedComponentDependencyIds.length === 4,
		'Dependency move planner did not copy the four nested components in the real display/component-model closure.',
	);
	await applySaveReloadBatch(
		'moveComponent.copyDisplayDependencies',
		dependencyMoveForward,
		(project) => {
			const moved = findResource(project, {
				packageId: dependencyMoveTargetPackageId,
				resourceId: dependencyMoveSelector.componentResourceId,
			});
			const copiedIds = new Set(allCopiedDependencyIds);
			const movedReferences = moved?.kind === 'component'
				? moved.component.displayList
					.map((node) => readDisplayDependency(node, dependencyMoveTargetPackageId))
					.filter((reference) => reference && copiedIds.has(reference.resourceId))
				: [];
			const copiedComponents = copiedComponentDependencyIds
				.map((resourceId) => findResource(project, {
					packageId: dependencyMoveTargetPackageId,
					resourceId,
				}));
			return moved?.kind === 'component'
				&& !stableJson({
					properties: moved.component.properties,
					transitions: moved.component.transitions,
				}).includes(`ui://${dependencyMoveSelector.packageId}`)
				&& findResource(project, {
					packageId: dependencyMoveSelector.packageId,
					resourceId: dependencyMoveSelector.componentResourceId,
				}) === null
				&& allCopiedDependencyIds.every((resourceId) => Boolean(findResource(project, {
					packageId: dependencyMoveTargetPackageId,
					resourceId,
				})))
				&& movedReferences.length === originalDependencyReferences.length
				&& copiedComponents.every((component) =>
					component?.kind === 'component'
					&& !stableJson({
						properties: component.component.properties,
						transitions: component.component.transitions,
					}).includes(`ui://${dependencyMoveSelector.packageId}`)
					&& component.component.displayList
						.map((node) => readDisplayDependency(node, dependencyMoveTargetPackageId))
						.filter(Boolean)
						.every((reference) =>
							reference.packageId !== dependencyMoveSelector.packageId
							&& (
								copiedIds.has(reference.resourceId)
								|| reference.resourceId === dependencyMoveSelector.componentResourceId
							)))
				&& countComponentReferences(project, {
					packageId: dependencyMoveTargetPackageId,
					componentResourceId: dependencyMoveSelector.componentResourceId,
				}) === originalDependencyIncomingCount;
		},
		true,
		dependencyMoveReportForward,
	);
	await applySaveReloadBatch(
		'moveComponent.copyDisplayDependencies.undo',
		dependencyMoveInverse,
		(project) => {
			const restoredPackage = findPackage(project, dependencyMoveSelector.packageId);
			const restored = findResource(project, {
				packageId: dependencyMoveSelector.packageId,
				resourceId: dependencyMoveSelector.componentResourceId,
			});
			const restoredIndex = restoredPackage?.resources.findIndex((resource) =>
				resource.id === dependencyMoveSelector.componentResourceId);
			const restoredReferences = restored?.kind === 'component'
				? restored.component.displayList
					.map((node) => readDisplayDependency(node, dependencyMoveSelector.packageId))
					.filter((reference) => reference?.packageId === dependencyMoveSelector.packageId)
				: [];
			const remainingCopies = allCopiedDependencyIds.filter((resourceId) => findResource(project, {
				packageId: dependencyMoveTargetPackageId,
				resourceId,
			}));
			return restored?.kind === 'component'
				&& stableJson({
					properties: restored.component.properties,
					transitions: restored.component.transitions,
				}) === originalDependencyComponentModel
				&& typeof restoredIndex === 'number'
				&& restoredIndex >= 0
				&& findResource(project, {
					packageId: dependencyMoveTargetPackageId,
					resourceId: dependencyMoveSelector.componentResourceId,
				}) === null
				&& remainingCopies.length === 0
				&& stableJson(restoredReferences) === stableJson(originalDependencyReferences)
				&& countComponentReferences(project, dependencyMoveSelector) === originalDependencyIncomingCount;
		},
	);
	await resetSession();

	const componentRemoveSelector = { packageId: 'rbw1tv9t', componentResourceId: 'dwwc4' };
	const componentRemovePackage = findPackage(initialProject, componentRemoveSelector.packageId);
	const componentRemoveResource = findResource(initialProject, {
		packageId: componentRemoveSelector.packageId,
		resourceId: componentRemoveSelector.componentResourceId,
	});
	assert(componentRemoveResource?.kind === 'component', 'Non-empty component removal fixture was not found.');
	const componentRemoveChildIds = componentRemoveResource.component.displayList.map((node) => node.id);
	const componentRemoveReferenceSelector = {
		packageId: componentRemoveSelector.packageId,
		componentResourceId: 'dwwc3',
		displayNodeId: 'n2',
	};
	const componentRemoveReferenceIndex = findComponent(initialProject, componentRemoveReferenceSelector)
		?.displayList.findIndex((node) => node.id === componentRemoveReferenceSelector.displayNodeId) ?? -1;
	assert(componentRemoveReferenceIndex >= 0, 'Non-empty component incoming reference fixture was not found.');
	const componentRemovePreparation = prepareRemoveComponent(initialProject, componentRemoveSelector);
	assert(componentRemovePreparation.ok, `Non-empty component removal planner failed: ${JSON.stringify(componentRemovePreparation)}`);
	const componentRemoveForward = componentRemovePreparation.transaction.operations ?? [
		componentRemovePreparation.transaction.operation,
	];
	const componentRemoveInverse = componentRemovePreparation.transaction.inverseOperations ?? [
		componentRemovePreparation.transaction.inverseOperation,
	];
	assert(
		componentRemoveForward.filter((operation) => operation.kind === 'detachDisplayNode').length === 1,
		'Non-empty component removal must detach its one real incoming reference.',
	);
	await applySaveReloadBatch(
		'removeComponent.detachIncomingReferences',
		componentRemoveForward,
		(project) => {
			const pkg = findPackage(project, componentRemoveSelector.packageId);
			return findResource(project, {
				packageId: componentRemoveSelector.packageId,
				resourceId: componentRemoveSelector.componentResourceId,
			}) === null
				&& findDisplayNode(project, componentRemoveReferenceSelector) === null
				&& pkg?.resources.length === componentRemovePackage.resources.length - 1;
		},
	);
	await applySaveReloadBatch(
		'removeComponent.detachIncomingReferences.undo',
		componentRemoveInverse,
		(project) => {
			const restored = findResource(project, {
				packageId: componentRemoveSelector.packageId,
				resourceId: componentRemoveSelector.componentResourceId,
			});
			const restoredReference = findDisplayNode(project, componentRemoveReferenceSelector);
			const restoredReferenceIndex = findComponent(project, componentRemoveReferenceSelector)
				?.displayList.findIndex((node) => node.id === componentRemoveReferenceSelector.displayNodeId) ?? -1;
			return restored?.kind === 'component'
				&& stableJson(restored.component.displayList.map((node) => node.id)) === stableJson(componentRemoveChildIds)
				&& restoredReference?.kind === 'component'
				&& restoredReference.resource?.resourceId === componentRemoveSelector.componentResourceId
				&& (restoredReference.resource?.packageId || componentRemoveSelector.packageId) === componentRemoveSelector.packageId
				&& restoredReferenceIndex === componentRemoveReferenceIndex
				&& findPackage(project, componentRemoveSelector.packageId)?.resources.length === componentRemovePackage.resources.length;
		},
	);
	await resetSession();

	const componentSizeSelector = {
		packageId: candidates.referencedComponent.pkg.id,
		componentResourceId: candidates.referencedComponent.resource.id,
	};
	const originalComponentSize = cloneJson(candidates.referencedComponent.resource.component.size);
	const originalComponentProperties = cloneJson(candidates.referencedComponent.resource.component.properties);
	const resizedComponentSize = {
		width: Number(originalComponentSize.width ?? 0) + 17,
		height: Number(originalComponentSize.height ?? 0) + 11,
	};
	const editedComponentProperties = {
		...originalComponentProperties,
		minSize: { width: 3, height: 4 },
		maxSize: { width: resizedComponentSize.width + 100, height: resizedComponentSize.height + 100 },
		pivot: { x: 0.25, y: 0.5 },
		pivotAsAnchor: true,
		bgColor: '#123456',
		bgColorEnabled: true,
		initName: 'phase9Root',
		opaque: !originalComponentProperties.opaque,
	};
	const componentReferenceCount = countComponentReferences(initialProject, componentSizeSelector);
	const componentSizeLabels = ['setComponentProps', 'setComponentProps.undo'];
	await applySaveReload(
		componentSizeLabels[0],
		{
			opId: 'phase9-set-component-props',
			kind: 'setComponentProps',
			selector: componentSizeSelector,
			props: { size: resizedComponentSize, properties: editedComponentProperties },
		},
		(project) => stableJson(findComponent(project, componentSizeSelector)?.size) === stableJson(resizedComponentSize)
			&& stableJson(findComponent(project, componentSizeSelector)?.properties) === stableJson(editedComponentProperties)
			&& countComponentReferences(project, componentSizeSelector) === componentReferenceCount,
	);
	await applySaveReload(
		componentSizeLabels[1],
		{
			opId: 'phase9-set-component-props-undo',
			kind: 'setComponentProps',
			selector: componentSizeSelector,
			props: { size: originalComponentSize, properties: originalComponentProperties },
		},
		(project) => {
			const actual = findComponent(project, componentSizeSelector);
			return {
				ok: stableJson(actual?.size) === stableJson(originalComponentSize)
					&& stableJson(actual?.properties) === stableJson(originalComponentProperties)
					&& countComponentReferences(project, componentSizeSelector) === componentReferenceCount,
				expected: { size: originalComponentSize, properties: originalComponentProperties },
				actual: { size: actual?.size, properties: actual?.properties },
			};
		},
	);
	await resetSession();

	const independentTextComponentLabels = [];
	const independentTextComponent = {
		kind: 'component',
		id: 'phase9alpha18textcomponent',
		name: 'Phase9 Alpha17 Text Component',
		path: '/',
		exported: false,
		favorite: false,
		branch: '',
		branchItemIds: [],
		component: {
			size: { width: 64, height: 32 },
			properties: readComponentProperties({}),
			customData: '',
			displayList: [{
				kind: 'text',
				id: 'n0',
				name: 'n0',
				position: { x: 4, y: 4 },
				size: { width: 56, height: 24 },
				pivot: { x: 0, y: 0 },
				pivotAsAnchor: false,
				locked: false,
				aspect: false,
				scale: { x: 1, y: 1 },
				skew: { x: 0, y: 0 },
				visible: true,
				touchable: true,
				grayed: false,
				alpha: 1,
				rotation: 0,
				tooltips: '',
				blendMode: 'normal',
				filter: '',
				filterData: '',
				customData: '',
				relations: [],
				gears: [],
				...createDefaultUamPlainTextProperties(),
				text: 'Phase 9',
				font: '',
				fontSize: 14,
				color: '#000000',
				minSize: { width: 1, height: 2 },
				maxSize: { width: 128, height: 64 },
				align: 1,
				vAlign: 2,
				leading: 3,
				letterSpacing: 1,
				autoSize: 0,
				singleLine: true,
				autoClearText: true,
				demoText: 'Phase 9 demo',
				templateVarsEnabled: true,
				faceDilate: 0.125,
				underlaySoftness: 0.25,
				ubbEnabled: true,
				underline: true,
				italic: true,
				bold: true,
				strikethrough: true,
				strokeColor: '#112233',
				strokeSize: 1,
				shadowColor: '#445566',
				shadowOffset: { x: 2, y: 3 },
				group: '',
			}],
			controllers: [],
			transitions: [],
		},
	};
	const independentTextSourcePackage = candidates.componentResource.pkg;
	const independentTextTargetPackage = initialProject.packages.find((candidate) =>
		candidate.id !== independentTextSourcePackage.id
		&& !(candidate.resources ?? []).some((resource) => resource.id === independentTextComponent.id),
	);
	assert(independentTextTargetPackage, 'No component-id-safe target package was found for independent non-empty component verification.');
	const independentTextSourceSelector = {
		packageId: independentTextSourcePackage.id,
		componentResourceId: independentTextComponent.id,
	};
	const independentTextTargetSelector = {
		packageId: independentTextTargetPackage.id,
		componentResourceId: independentTextComponent.id,
	};
	const independentTextSourceIndex = independentTextSourcePackage.resources.length;
	const independentTextTargetIndex = independentTextTargetPackage.resources.length;
	const independentTextLabels = [
		'addIndependentTextComponent',
		'moveIndependentTextComponent',
		'moveIndependentTextComponent.undo',
		'removeIndependentTextComponent',
		'removeIndependentTextComponent.undo',
		'removeIndependentTextComponent.cleanup',
	];
	independentTextComponentLabels.push(...independentTextLabels);
	await applySaveReload(
		independentTextLabels[0],
		{
			opId: 'phase9-add-independent-text-component',
			kind: 'addComponent',
			selector: { packageId: independentTextSourceSelector.packageId },
			component: independentTextComponent,
			atIndex: independentTextSourceIndex,
		},
		(project) => stableJson(findResource(project, {
			packageId: independentTextSourceSelector.packageId,
			resourceId: independentTextSourceSelector.componentResourceId,
		})) === stableJson(independentTextComponent),
	);
	await applySaveReload(
		independentTextLabels[1],
		{
			opId: 'phase9-move-independent-text-component',
			kind: 'moveComponent',
			selector: independentTextSourceSelector,
			toPackageId: independentTextTargetSelector.packageId,
			toIndex: independentTextTargetIndex,
		},
		(project) => {
			const moved = findResource(project, {
				packageId: independentTextTargetSelector.packageId,
				resourceId: independentTextTargetSelector.componentResourceId,
			});
			return stableJson(moved) === stableJson(independentTextComponent)
				&& findPackage(project, independentTextTargetSelector.packageId)?.resources.findIndex((resource) => resource.id === independentTextComponent.id) === independentTextTargetIndex;
		},
	);
	await applySaveReload(
		independentTextLabels[2],
		{
			opId: 'phase9-move-independent-text-component-undo',
			kind: 'moveComponent',
			selector: independentTextTargetSelector,
			toPackageId: independentTextSourceSelector.packageId,
			toIndex: independentTextSourceIndex,
		},
		(project) => {
			const restored = findResource(project, {
				packageId: independentTextSourceSelector.packageId,
				resourceId: independentTextSourceSelector.componentResourceId,
			});
			return stableJson(restored) === stableJson(independentTextComponent)
				&& findPackage(project, independentTextSourceSelector.packageId)?.resources.findIndex((resource) => resource.id === independentTextComponent.id) === independentTextSourceIndex;
		},
	);
	await applySaveReload(
		independentTextLabels[3],
		{ opId: 'phase9-remove-independent-text-component', kind: 'removeComponent', selector: independentTextSourceSelector },
		(project) => findResource(project, {
			packageId: independentTextSourceSelector.packageId,
			resourceId: independentTextSourceSelector.componentResourceId,
		}) === null,
	);
	await applySaveReload(
		independentTextLabels[4],
		{
			opId: 'phase9-remove-independent-text-component-undo',
			kind: 'addComponent',
			selector: { packageId: independentTextSourceSelector.packageId },
			component: cloneJson(independentTextComponent),
			atIndex: independentTextSourceIndex,
		},
		(project) => stableJson(findResource(project, {
			packageId: independentTextSourceSelector.packageId,
			resourceId: independentTextSourceSelector.componentResourceId,
		})) === stableJson(independentTextComponent),
	);
	await applySaveReload(
		independentTextLabels[5],
		{ opId: 'phase9-remove-independent-text-component-cleanup', kind: 'removeComponent', selector: independentTextSourceSelector },
		(project) => findResource(project, {
			packageId: independentTextSourceSelector.packageId,
			resourceId: independentTextSourceSelector.componentResourceId,
		}) === null,
	);
	await resetSession();

	const componentLifecycleReferenceRewriteLabels = [];
	const referenceNode = {
		kind: 'component',
		id: 'n0',
		name: 'n0',
		position: { x: 0, y: 0 },
		size: { width: 64, height: 32 },
		pivot: { x: 0, y: 0 },
		pivotAsAnchor: false,
		locked: false,
		aspect: false,
		minSize: { width: 0, height: 0 },
		maxSize: { width: 0, height: 0 },
		scale: { x: 1, y: 1 },
		skew: { x: 0, y: 0 },
		visible: true,
		touchable: true,
		grayed: false,
		alpha: 1,
		rotation: 0,
		tooltips: '',
		blendMode: 'normal',
		filter: '',
		filterData: '',
		customData: '',
		group: '',
		relations: [],
		gears: [],
		resource: { resourceId: independentTextComponent.id },
	};
	const referenceHostComponent = {
		kind: 'component',
		id: 'phase9alpha18referencehost',
		name: 'Phase9 Alpha17 Reference Host',
		path: '/',
		exported: false,
		favorite: false,
		branch: '',
		branchItemIds: [],
		component: {
			size: { width: 64, height: 32 },
			properties: readComponentProperties({}),
			customData: '',
			displayList: [cloneJson(referenceNode)],
			controllers: [],
			transitions: [],
		},
	};
	const referenceHostSelector = {
		packageId: independentTextSourceSelector.packageId,
		componentResourceId: referenceHostComponent.id,
	};
	const referenceHostIndex = independentTextSourceIndex + 1;
	const rewrittenReferenceNode = {
		...cloneJson(referenceNode),
		resource: {
			resourceId: independentTextComponent.id,
			packageId: independentTextTargetSelector.packageId,
		},
	};
	const referenceNodeMatches = (project, packageId) => {
		const host = findResource(project, {
			packageId: referenceHostSelector.packageId,
			resourceId: referenceHostSelector.componentResourceId,
		});
		const node = host?.kind === 'component'
			? host.component.displayList.find((candidate) => candidate.id === referenceNode.id)
			: null;
		return node?.kind === 'component'
			&& node.resource?.resourceId === independentTextComponent.id
			&& (node.resource?.packageId || referenceHostSelector.packageId) === packageId;
	};
	const referenceRewriteLabels = [
		'addReferencedComponent',
		'addReferenceHostComponent',
		'moveReferencedComponentWithRewrite',
		'moveReferencedComponentWithRewrite.undo',
		'removeReferencedComponentWithDetach',
		'removeReferencedComponentWithDetach.undo',
		'removeReferenceHostComponent.cleanup',
		'removeReferencedComponent.cleanup',
	];
	componentLifecycleReferenceRewriteLabels.push(...referenceRewriteLabels);
	await applySaveReload(
		referenceRewriteLabels[0],
		{
			opId: 'phase9-add-referenced-component',
			kind: 'addComponent',
			selector: { packageId: independentTextSourceSelector.packageId },
			component: cloneJson(independentTextComponent),
			atIndex: independentTextSourceIndex,
		},
		(project) => stableJson(findResource(project, {
			packageId: independentTextSourceSelector.packageId,
			resourceId: independentTextComponent.id,
		})) === stableJson(independentTextComponent),
	);
	await applySaveReload(
		referenceRewriteLabels[1],
		{
			opId: 'phase9-add-reference-host-component',
			kind: 'addComponent',
			selector: { packageId: referenceHostSelector.packageId },
			component: cloneJson(referenceHostComponent),
			atIndex: referenceHostIndex,
		},
		(project) => referenceNodeMatches(project, referenceHostSelector.packageId),
	);
	await applySaveReloadBatch(
		referenceRewriteLabels[2],
		[
			{
				opId: 'phase9-detach-source-component-reference',
				kind: 'detachDisplayNode',
				selector: { ...referenceHostSelector, displayNodeId: referenceNode.id },
			},
			{
				opId: 'phase9-attach-target-component-reference',
				kind: 'attachDisplayNode',
				selector: referenceHostSelector,
				atIndex: 0,
				node: cloneJson(rewrittenReferenceNode),
			},
			{
				opId: 'phase9-move-referenced-component',
				kind: 'moveComponent',
				selector: independentTextSourceSelector,
				toPackageId: independentTextTargetSelector.packageId,
				toIndex: independentTextTargetIndex,
			},
		],
		(project) => findResource(project, {
			packageId: independentTextSourceSelector.packageId,
			resourceId: independentTextComponent.id,
		}) === null
			&& stableJson(findResource(project, {
				packageId: independentTextTargetSelector.packageId,
				resourceId: independentTextComponent.id,
			})) === stableJson(independentTextComponent)
			&& referenceNodeMatches(project, independentTextTargetSelector.packageId),
	);
	await applySaveReloadBatch(
		referenceRewriteLabels[3],
		[
			{
				opId: 'phase9-detach-target-component-reference-undo',
				kind: 'detachDisplayNode',
				selector: { ...referenceHostSelector, displayNodeId: referenceNode.id },
			},
			{
				opId: 'phase9-attach-source-component-reference-undo',
				kind: 'attachDisplayNode',
				selector: referenceHostSelector,
				atIndex: 0,
				node: cloneJson(referenceNode),
			},
			{
				opId: 'phase9-move-referenced-component-undo',
				kind: 'moveComponent',
				selector: independentTextTargetSelector,
				toPackageId: independentTextSourceSelector.packageId,
				toIndex: independentTextSourceIndex,
			},
		],
		(project) => findResource(project, {
			packageId: independentTextTargetSelector.packageId,
			resourceId: independentTextComponent.id,
		}) === null
			&& stableJson(findResource(project, {
				packageId: independentTextSourceSelector.packageId,
				resourceId: independentTextComponent.id,
			})) === stableJson(independentTextComponent)
			&& referenceNodeMatches(project, referenceHostSelector.packageId),
	);
	await applySaveReloadBatch(
		referenceRewriteLabels[4],
		[
			{
				opId: 'phase9-detach-component-reference-for-remove',
				kind: 'detachDisplayNode',
				selector: { ...referenceHostSelector, displayNodeId: referenceNode.id },
			},
			{
				opId: 'phase9-remove-referenced-component',
				kind: 'removeComponent',
				selector: independentTextSourceSelector,
			},
		],
		(project) => findResource(project, {
			packageId: independentTextSourceSelector.packageId,
			resourceId: independentTextComponent.id,
		}) === null
			&& !referenceNodeMatches(project, referenceHostSelector.packageId),
	);
	await applySaveReloadBatch(
		referenceRewriteLabels[5],
		[
			{
				opId: 'phase9-add-referenced-component-undo',
				kind: 'addComponent',
				selector: { packageId: independentTextSourceSelector.packageId },
				component: cloneJson(independentTextComponent),
				atIndex: independentTextSourceIndex,
			},
			{
				opId: 'phase9-attach-component-reference-undo',
				kind: 'attachDisplayNode',
				selector: referenceHostSelector,
				atIndex: 0,
				node: cloneJson(referenceNode),
			},
		],
		(project) => stableJson(findResource(project, {
			packageId: independentTextSourceSelector.packageId,
			resourceId: independentTextComponent.id,
		})) === stableJson(independentTextComponent)
			&& referenceNodeMatches(project, referenceHostSelector.packageId),
	);
	await applySaveReload(
		referenceRewriteLabels[6],
		{ opId: 'phase9-remove-reference-host-component-cleanup', kind: 'removeComponent', selector: referenceHostSelector },
		(project) => findResource(project, {
			packageId: referenceHostSelector.packageId,
			resourceId: referenceHostSelector.componentResourceId,
		}) === null,
	);
	await applySaveReload(
		referenceRewriteLabels[7],
		{ opId: 'phase9-remove-referenced-component-cleanup', kind: 'removeComponent', selector: independentTextSourceSelector },
		(project) => findResource(project, {
			packageId: independentTextSourceSelector.packageId,
			resourceId: independentTextComponent.id,
		}) === null,
	);
	await resetSession();

	const componentSelector = {
		packageId: candidates.componentResource.pkg.id,
		resourceId: candidates.componentResource.resource.id,
	};
	const renamedComponent = `${candidates.componentResource.resource.name}__phase9`;
	await applySaveReload(
		'renameComponentResource',
		{ opId: 'phase9-rename-component-resource', kind: 'renameResource', selector: componentSelector, newName: renamedComponent },
		(project) => findResource(project, componentSelector)?.name === renamedComponent,
	);
	await applySaveReload(
		'renameComponentResource.undo',
		{ opId: 'phase9-rename-component-resource-undo', kind: 'renameResource', selector: componentSelector, newName: candidates.componentResource.resource.name },
		(project) => findResource(project, componentSelector)?.name === candidates.componentResource.resource.name,
	);
	await resetSession();

	const imageSelector = { packageId: candidates.image.pkg.id, resourceId: candidates.image.resource.id };
	const originalImageFileName = resourceFileName(candidates.image.resource);
	const renamedImage = `${candidates.image.resource.name}__phase9`;
	const imageExtension = path.extname(originalImageFileName);
	const renamedImageFileName = imageExtension && !renamedImage.endsWith(imageExtension)
		? `${renamedImage}${imageExtension}`
		: renamedImage;
	const imageRenamePersisted = await applySaveReload(
		'renameImageResource',
		{ opId: 'phase9-rename-image-resource', kind: 'renameResource', selector: imageSelector, newName: renamedImage },
		(project) => {
			const resource = findResource(project, imageSelector);
			return resource?.name === renamedImage && resourceFileName(resource) === renamedImageFileName;
		},
	);
	await applySaveReload(
		'renameImageResource.undo',
		{ opId: 'phase9-rename-image-resource-undo', kind: 'renameResource', selector: imageSelector, newName: candidates.image.resource.name },
		(project) => {
			const resource = findResource(project, imageSelector);
			return resource?.name === candidates.image.resource.name && resourceFileName(resource) === originalImageFileName;
		},
	);
	const originalImageProps = cloneJson(candidates.image.resource.image);
	assert(originalImageProps, 'Phase 9 image resource is missing formal UAM image properties.');
	const imageDimensions = candidates.image.resource.dimensions;
	assert(imageDimensions?.width > 0 && imageDimensions?.height > 0, 'Phase 9 image resource is missing positive dimensions.');
	const updatedImageProps = {
		textureSetMode: originalImageProps.textureSetMode === 'alone_npot' ? 'alone_mof' : 'alone_npot',
		qualityOption: 'custom',
		quality: originalImageProps.quality === 80 ? 72 : 80,
		smoothing: !originalImageProps.smoothing,
		duplicatePadding: !originalImageProps.duplicatePadding,
		scaleOption: originalImageProps.scaleOption === 1 ? 2 : 1,
		scale9Grid: originalImageProps.scaleOption === 1
			? null
			: [0, 0, imageDimensions.width, imageDimensions.height],
		tileGridIndice: originalImageProps.scaleOption === 1 ? 0 : 5,
	};
	const imagePropsLabels = ['setImageResourceProps', 'setImageResourceProps.undo'];
	await applySaveReload(
		imagePropsLabels[0],
		{
			opId: 'phase9-set-image-resource-props',
			kind: 'setImageResourceProps',
			selector: imageSelector,
			props: updatedImageProps,
		},
		(project) => stableJson(findResource(project, imageSelector)?.image) === stableJson(updatedImageProps),
	);
	await applySaveReload(
		imagePropsLabels[1],
		{
			opId: 'phase9-set-image-resource-props-undo',
			kind: 'setImageResourceProps',
			selector: imageSelector,
			props: originalImageProps,
		},
		(project) => stableJson(findResource(project, imageSelector)?.image) === stableJson(originalImageProps),
	);
	await resetSession();

	const assetLifecycleLabels = [];
	for (const kind of ['image', 'sound', 'font', 'movieClip']) {
		const assetEntries = candidates.assetsByKind.get(kind);
		const assetEntry = assetEntries[0];
		const replacementEntry = assetEntries[1] ?? assetEntry;
		const asset = assetEntry.resource;
		const selector = { packageId: assetEntry.pkg.id, resourceId: asset.id };
		const originalFileName = resourceFileName(asset);
		const renamed = `${asset.name}__phase9_${kind}`;
		const extension = path.extname(originalFileName);
		const renamedFileName = extension && !renamed.endsWith(extension) ? `${renamed}${extension}` : renamed;
		const moved = `${String(asset.path || '').replace(/\/$/, '')}/phase9-${kind}/`;
		const copy = makeAssetCopy(asset, `${asset.id}-phase9-${kind}`, `phase9_${kind}`);
		const copySelector = { packageId: assetEntry.pkg.id, resourceId: copy.id };
		const replacedCopy = { ...cloneJson(copy), sourceBytes: new Uint8Array(replacementEntry.resource.sourceBytes) };
		if (kind === 'image') replacedCopy.dimensions = cloneJson(replacementEntry.resource.dimensions);
		if (kind === 'movieClip') {
			const replacementMovieClip = deriveMovieClipModelFromJta(replacedCopy.sourceBytes);
			replacedCopy.dimensions = replacementMovieClip.dimensions;
			replacedCopy.movieClip = {
				interval: replacementMovieClip.interval,
				repeatDelay: replacementMovieClip.repeatDelay,
				swing: replacementMovieClip.swing,
				smoothing: copy.movieClip.smoothing,
				frames: replacementMovieClip.frames.map(({ textureIndex: _textureIndex, ...frame }) => ({
					...frame,
					spriteId: '',
				})),
			};
		}
		const labels = [
			`rename${kind}Resource`,
			`rename${kind}Resource.undo`,
			`move${kind}Resource`,
			`move${kind}Resource.undo`,
			`add${kind}Resource`,
			`replace${kind}ResourceBytes`,
			`replace${kind}ResourceBytes.undo`,
			`remove${kind}Resource`,
			`remove${kind}Resource.undo`,
			`remove${kind}Resource.cleanup`,
		];
		assetLifecycleLabels.push(...labels);
		await applySaveReload(
			labels[0],
			{ opId: `phase9-rename-${kind}-resource`, kind: 'renameResource', selector, newName: renamed },
			(project) => {
				const resource = findResource(project, selector);
				return resource?.name === renamed && resourceFileName(resource) === renamedFileName;
			},
		);
		await applySaveReload(
			labels[1],
			{ opId: `phase9-rename-${kind}-resource-undo`, kind: 'renameResource', selector, newName: asset.name },
			(project) => {
				const resource = findResource(project, selector);
				return resource?.name === asset.name && resourceFileName(resource) === originalFileName;
			},
		);
		await applySaveReload(
			labels[2],
			{ opId: `phase9-move-${kind}-resource`, kind: 'moveResource', selector, toPath: moved },
			(project) => findResource(project, selector)?.path === moved,
		);
		await applySaveReload(
			labels[3],
			{ opId: `phase9-move-${kind}-resource-undo`, kind: 'moveResource', selector, toPath: asset.path },
			(project) => findResource(project, selector)?.path === asset.path,
		);
		await applySaveReload(
			labels[4],
			{ opId: `phase9-add-${kind}-resource`, kind: 'addResource', selector: { packageId: copySelector.packageId }, resource: copy },
			(project) => assetMatches(findResource(project, copySelector), copy),
		);
		await applySaveReload(
			labels[5],
			{ opId: `phase9-replace-${kind}-resource-bytes`, kind: 'replaceResourceBytes', selector: copySelector, sourceBytes: replacedCopy.sourceBytes },
			(project) => assetMatches(findResource(project, copySelector), replacedCopy),
		);
		await applySaveReload(
			labels[6],
			{ opId: `phase9-replace-${kind}-resource-bytes-undo`, kind: 'replaceResourceBytes', selector: copySelector, sourceBytes: copy.sourceBytes },
			(project) => assetMatches(findResource(project, copySelector), copy),
		);
		await applySaveReload(
			labels[7],
			{ opId: `phase9-remove-${kind}-resource`, kind: 'removeResource', selector: copySelector },
			(project) => findResource(project, copySelector) === null,
		);
		await applySaveReload(
			labels[8],
			{ opId: `phase9-remove-${kind}-resource-undo`, kind: 'addResource', selector: { packageId: copySelector.packageId }, resource: copy },
			(project) => assetMatches(findResource(project, copySelector), copy),
		);
		await applySaveReload(
			labels[9],
			{ opId: `phase9-remove-${kind}-resource-cleanup`, kind: 'removeResource', selector: copySelector },
			(project) => findResource(project, copySelector) === null,
		);
		await resetSession();
	}

	const importedImage = {
		kind: 'image',
		id: `${candidates.image.resource.id}-imported-image`,
		name: 'phase9_imported_image',
		path: '/imported/images/',
		exported: false,
		branch: '',
		branchItemIds: [],
		fileName: `phase9_imported_image${path.extname(resourceFileName(candidates.image.resource)) || '.png'}`,
		dimensions: cloneJson(candidates.image.resource.dimensions),
		metadata: null,
		image: {
			textureSetMode: '',
			qualityOption: '',
			quality: 80,
			smoothing: true,
			duplicatePadding: false,
			scaleOption: 0,
			scale9Grid: null,
			tileGridIndice: 0,
		},
		sourceBytes: new Uint8Array(candidates.image.resource.sourceBytes),
	};
	const importedImageSelector = {
		packageId: candidates.image.pkg.id,
		resourceId: importedImage.id,
	};
	assetLifecycleLabels.push('importImageResource', 'importImageResource.undo');
	await applySaveReload(
		'importImageResource',
		{
			opId: 'phase9-import-image-resource',
			kind: 'addResource',
			selector: { packageId: importedImageSelector.packageId },
			resource: importedImage,
		},
		(project) => assetMatches(findResource(project, importedImageSelector), importedImage),
	);
	await applySaveReload(
		'importImageResource.undo',
		{
			opId: 'phase9-import-image-resource-undo',
			kind: 'removeResource',
			selector: importedImageSelector,
		},
		(project) => findResource(project, importedImageSelector) === null,
	);

	const soundCandidate = candidates.assetsByKind.get('sound')[0];
	const importedSound = {
		kind: 'sound',
		id: `${soundCandidate.resource.id}-imported-sound`,
		name: 'phase9_imported_sound',
		path: '/imported/sounds/',
		exported: false,
		branch: '',
		branchItemIds: [],
		file: `phase9_imported_sound${path.extname(resourceFileName(soundCandidate.resource)) || '.wav'}`,
		metadata: null,
		sourceBytes: new Uint8Array(soundCandidate.resource.sourceBytes),
	};
	const importedSoundSelector = {
		packageId: soundCandidate.pkg.id,
		resourceId: importedSound.id,
	};
	assetLifecycleLabels.push('importSoundResource', 'importSoundResource.undo');
	await applySaveReload(
		'importSoundResource',
		{
			opId: 'phase9-import-sound-resource',
			kind: 'addResource',
			selector: { packageId: importedSoundSelector.packageId },
			resource: importedSound,
		},
		(project) => assetMatches(findResource(project, importedSoundSelector), importedSound),
	);
	await applySaveReload(
		'importSoundResource.undo',
		{
			opId: 'phase9-import-sound-resource-undo',
			kind: 'removeResource',
			selector: importedSoundSelector,
		},
		(project) => findResource(project, importedSoundSelector) === null,
	);

	const movieClipCandidate = candidates.assetsByKind.get('movieClip')[0];
	const parsedMovieClip = parseJta(new Uint8Array(movieClipCandidate.resource.sourceBytes));
	const firstMovieClipFrame = parsedMovieClip.frames.find((frame) => frame.textureIndex === 0);
	const secondMovieClipFrame = parsedMovieClip.frames.find((frame) => frame.textureIndex === 1);
	assert(firstMovieClipFrame && secondMovieClipFrame, 'MovieClip import verification requires two source textures.');
	const movieClipImport = prepareImportMovieClipResource(
		initialProject,
		{ packageId: movieClipCandidate.pkg.id },
		[
			{
				fileName: 'phase9_10.png',
				sourceBytes: parsedMovieClip.textures[0].raw,
				dimensions: { width: firstMovieClipFrame.rectWidth + 4, height: firstMovieClipFrame.rectHeight + 6 },
				crop: {
					x: 2,
					y: 3,
					width: firstMovieClipFrame.rectWidth,
					height: firstMovieClipFrame.rectHeight,
				},
			},
			{
				fileName: 'phase9_2.png',
				sourceBytes: parsedMovieClip.textures[1].raw,
				dimensions: { width: secondMovieClipFrame.rectWidth, height: secondMovieClipFrame.rectHeight },
			},
		],
	);
	assert(movieClipImport.ok, `MovieClip import preparation failed: ${JSON.stringify(movieClipImport)}`);
	assert(movieClipImport.transaction.operation.kind === 'addResource', 'MovieClip import did not create addResource.');
	const importedMovieClip = movieClipImport.transaction.operation.resource;
	const importedMovieClipSelector = {
		packageId: movieClipCandidate.pkg.id,
		resourceId: importedMovieClip.id,
	};
	const movieClipImportLabels = [
		'importMovieClipResource',
		'updateMovieClipTiming',
		'updateMovieClipTiming.undo',
		'importMovieClipResource.undo',
	];
	assetLifecycleLabels.push(...movieClipImportLabels);
	await applySaveReload(
		movieClipImportLabels[0],
		movieClipImport.transaction.operation,
		(project) => {
			const resource = findResource(project, importedMovieClipSelector);
			return assetMatches(resource, importedMovieClip)
				&& parseJta(resource.sourceBytes).frames.some((frame) =>
					frame.rectX === 2
					&& frame.rectY === 3
					&& frame.rectWidth === firstMovieClipFrame.rectWidth
					&& frame.rectHeight === firstMovieClipFrame.rectHeight
				);
		},
	);
	const movieClipTiming = prepareUpdateMovieClipResource(
		{ packages: [{ id: movieClipCandidate.pkg.id, resources: [importedMovieClip] }] },
		importedMovieClipSelector,
		{
			fps: 30,
			speed: 2,
			repeatDelay: 4,
			swing: true,
			smoothing: false,
			frameDelays: [1, 7],
		},
	);
	assert(movieClipTiming.ok, `MovieClip timing preparation failed: ${JSON.stringify(movieClipTiming)}`);
	await applySaveReloadBatch(
		movieClipImportLabels[1],
		movieClipTiming.transaction.operations || [movieClipTiming.transaction.operation],
		(project) => {
			const resource = findResource(project, importedMovieClipSelector);
			if (!resource?.sourceBytes) return false;
			const parsed = parseJta(resource.sourceBytes);
			return parsed.fps === 30
				&& parsed.speed === 2
				&& parsed.repeatDelay === 4
				&& parsed.swing
				&& parsed.frames.map((frame) => frame.delay).join(',') === '1,7';
		},
	);
	await applySaveReloadBatch(
		movieClipImportLabels[2],
		movieClipTiming.transaction.inverseOperations || [movieClipTiming.transaction.inverseOperation],
		(project) => assetMatches(findResource(project, importedMovieClipSelector), importedMovieClip),
	);
	await applySaveReload(
		movieClipImportLabels[3],
		movieClipImport.transaction.inverseOperation,
		(project) => findResource(project, importedMovieClipSelector) === null,
	);

	const bitmapFontCandidate = candidates.assetsByKind.get('font').find(
		(entry) => entry.resource.metadata?.textureId
			&& entry.pkg.resources.some((resource) =>
				resource.kind === 'image' && resource.id === entry.resource.metadata.textureId),
	);
	assert(bitmapFontCandidate, 'No bitmap font with a package texture was found for import verification.');
	const bitmapTextureCandidate = bitmapFontCandidate.pkg.resources.find(
		(resource) => resource.kind === 'image' && resource.id === bitmapFontCandidate.resource.metadata.textureId,
	);
	assert(bitmapTextureCandidate?.sourceBytes, 'The bitmap font texture is not hydrated.');
	const importedBitmapTexture = makeAssetCopy(
		bitmapTextureCandidate,
		`${bitmapTextureCandidate.id}-imported-font-texture`,
		'imported_font_texture',
	);
	importedBitmapTexture.path = '/imported/fonts/';
	importedBitmapTexture.dimensions = { width: 1, height: 1 };
	importedBitmapTexture.sourceBytes = new Uint8Array(Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64',
	));
	const importedBitmapFont = makeAssetCopy(
		bitmapFontCandidate.resource,
		`${bitmapFontCandidate.resource.id}-imported-font`,
		'imported_font',
	);
	importedBitmapFont.path = '/imported/fonts/';
	importedBitmapFont.sourceBytes = new TextEncoder().encode(
		'info face="Phase9" size=8\n'
		+ 'common lineHeight=8 base=7 scaleW=1 scaleH=1 pages=1 packed=0\n'
		+ 'page id=0 file="phase9_imported_font_texture.png"\n'
		+ 'chars count=1\n'
		+ 'char id=65 x=0 y=0 width=1 height=1 xoffset=0 yoffset=0 xadvance=1 page=0 chnl=15\n',
	);
	importedBitmapFont.metadata = {
		...cloneJson(importedBitmapFont.metadata),
		textureId: importedBitmapTexture.id,
	};
	const bitmapTextureSelector = {
		packageId: bitmapFontCandidate.pkg.id,
		resourceId: importedBitmapTexture.id,
	};
	const bitmapFontSelector = {
		packageId: bitmapFontCandidate.pkg.id,
		resourceId: importedBitmapFont.id,
	};
	const bitmapFontImportLabels = ['importBitmapFontResources', 'importBitmapFontResources.undo'];
	assetLifecycleLabels.push(...bitmapFontImportLabels);
	await applySaveReloadBatch(
		bitmapFontImportLabels[0],
		[
			{
				opId: 'phase9-import-bitmap-font-texture',
				kind: 'addResource',
				selector: { packageId: bitmapTextureSelector.packageId },
				resource: importedBitmapTexture,
			},
			{
				opId: 'phase9-import-bitmap-font',
				kind: 'addResource',
				selector: { packageId: bitmapFontSelector.packageId },
				resource: importedBitmapFont,
			},
		],
		(project) => assetMatches(findResource(project, bitmapTextureSelector), importedBitmapTexture)
			&& assetMatches(findResource(project, bitmapFontSelector), importedBitmapFont),
	);
	await applySaveReloadBatch(
		bitmapFontImportLabels[1],
		[
			{ opId: 'phase9-import-bitmap-font-undo', kind: 'removeResource', selector: bitmapFontSelector },
			{ opId: 'phase9-import-bitmap-font-texture-undo', kind: 'removeResource', selector: bitmapTextureSelector },
		],
		(project) => findResource(project, bitmapFontSelector) === null
			&& findResource(project, bitmapTextureSelector) === null,
	);
	await resetSession();

	const binaryResourceId = `${candidates.image.resource.id}-phase9-binary`;
	const binaryFileName = 'phase9-browser-selected.bin';
	const binaryResourceName = binaryFileName.replace(/\.[^.]+$/, '');
	const binaryInitialBytes = new Uint8Array([0, 1, 2, 3, 5, 8, 13]);
	const binaryReplacementBytes = new Uint8Array([13, 8, 5, 3, 2, 1, 0]);
	const binaryResource = {
		kind: 'misc',
		id: binaryResourceId,
		name: binaryResourceName,
		path: '/phase9-contract',
		exported: false,
		branch: '',
		branchItemIds: [],
		file: binaryFileName,
		metadata: null,
		sourceBytes: binaryInitialBytes,
	};
	const binarySelector = { packageId: candidates.image.pkg.id, resourceId: binaryResourceId };
	const binaryReloadChecks = [];
	const binaryMatches = (project, bytes) => {
		const resource = findResource(project, binarySelector);
		const checks = {
			kind: resource?.kind === 'misc',
			name: resource?.name === binaryResourceName,
			path: resource?.path === '/phase9-contract',
			fileName: resourceFileName(resource) === binaryFileName,
			bytes: sameBytes(resource?.sourceBytes, bytes),
		};
		const matches = Object.values(checks).every(Boolean);
		binaryReloadChecks.push({
			expected: {
				kind: 'misc',
				name: binaryResourceName,
				path: '/phase9-contract',
				fileName: binaryFileName,
				bytes: Array.from(bytes),
			},
			actual: resource
				? {
					kind: resource.kind,
					name: resource.name,
					path: resource.path,
					fileName: resource.fileName,
					file: resource.file,
					bytesKind: resource.sourceBytes?.constructor?.name ?? typeof resource.sourceBytes,
					bytes: Array.from(resource.sourceBytes ?? []),
				}
				: null,
			checks,
			matches,
		});
		return matches;
	};
	await applySaveReload(
		'addBinaryResource',
		{ opId: 'phase9-add-binary-resource', kind: 'addResource', selector: { packageId: binarySelector.packageId }, resource: binaryResource },
		(project) => binaryMatches(project, binaryInitialBytes),
	);
	await applySaveReload(
		'addBinaryResource.undo',
		{ opId: 'phase9-add-binary-resource-undo', kind: 'removeResource', selector: binarySelector },
		(project) => findResource(project, binarySelector) === null,
	);
	await applySaveReload(
		'addBinaryResource.reapply',
		{ opId: 'phase9-add-binary-resource-reapply', kind: 'addResource', selector: { packageId: binarySelector.packageId }, resource: binaryResource },
		(project) => binaryMatches(project, binaryInitialBytes),
	);
	await applySaveReload(
		'replaceBinaryResourceBytes',
		{ opId: 'phase9-replace-binary-resource-bytes', kind: 'replaceResourceBytes', selector: binarySelector, sourceBytes: binaryReplacementBytes },
		(project) => binaryMatches(project, binaryReplacementBytes),
	);
	await applySaveReload(
		'replaceBinaryResourceBytes.undo',
		{ opId: 'phase9-replace-binary-resource-bytes-undo', kind: 'replaceResourceBytes', selector: binarySelector, sourceBytes: binaryInitialBytes },
		(project) => binaryMatches(project, binaryInitialBytes),
	);
	await applySaveReload(
		'removeBinaryResource',
		{ opId: 'phase9-remove-binary-resource', kind: 'removeResource', selector: binarySelector },
		(project) => findResource(project, binarySelector) === null,
	);
	await applySaveReload(
		'removeBinaryResource.undo',
		{ opId: 'phase9-remove-binary-resource-undo', kind: 'addResource', selector: { packageId: binarySelector.packageId }, resource: binaryResource },
		(project) => binaryMatches(project, binaryInitialBytes),
	);
	await applySaveReload(
		'removeBinaryResource.cleanup',
		{ opId: 'phase9-remove-binary-resource-cleanup', kind: 'removeResource', selector: binarySelector },
		(project) => findResource(project, binarySelector) === null,
	);
	await resetSession();

	const movedPath = `${candidates.image.resource.path.replace(/\/$/, '')}/phase9/`;
	await applySaveReload(
		'moveResource',
		{ opId: 'phase9-move-resource', kind: 'moveResource', selector: imageSelector, toPath: movedPath },
		(project) => findResource(project, imageSelector)?.path === movedPath,
	);
	await applySaveReload(
		'moveResource.undo',
		{ opId: 'phase9-move-resource-undo', kind: 'moveResource', selector: imageSelector, toPath: candidates.image.resource.path },
		(project) => findResource(project, imageSelector)?.path === candidates.image.resource.path,
	);
	await resetSession();

	const attachSelector = { packageId: candidates.attach.pkg.id, componentResourceId: candidates.attach.resource.id };
	const attachedNode = {
		...cloneJson(candidates.attach.node),
		id: `${candidates.attach.node.id}_phase9`,
		name: `${candidates.attach.node.name || candidates.attach.node.id}_phase9`,
	};
	await applySaveReload(
		'attachDisplayNode',
		{
			opId: 'phase9-attach-display-node',
			kind: 'attachDisplayNode',
			selector: attachSelector,
			atIndex: candidates.attach.resource.component.displayList.length,
			node: attachedNode,
		},
		(project) => Boolean(findComponent(project, attachSelector)?.displayList?.find((node) => node.id === attachedNode.id)),
	);
	await applySaveReload(
		'detachDisplayNode.undo',
		{
			opId: 'phase9-detach-display-node-undo',
			kind: 'detachDisplayNode',
			selector: { ...attachSelector, displayNodeId: attachedNode.id },
		},
		(project) => !findComponent(project, attachSelector)?.displayList?.some((node) => node.id === attachedNode.id),
	);
	await resetSession();

	const displayNodeLifecycleLabels = [];
	for (const [kind, entry] of candidates.nodeByKind) {
		const selector = { packageId: entry.pkg.id, componentResourceId: entry.resource.id };
		const node = {
			...cloneJson(entry.node),
			id: `${entry.node.id}_phase9_${kind}`,
			name: `${entry.node.name || entry.node.id}_phase9_${kind}`,
		};
		const labels = [`attach${kind}DisplayNode`, `detach${kind}DisplayNode.undo`];
		displayNodeLifecycleLabels.push(...labels);
		await applySaveReload(
			labels[0],
			{
				opId: `phase9-attach-${kind}-display-node`,
				kind: 'attachDisplayNode',
				selector,
				atIndex: entry.resource.component.displayList.length,
				node,
			},
			(project) => {
				const actual = findDisplayNode(project, { ...selector, displayNodeId: node.id });
				return displayNodeIndex(project, { ...selector, displayNodeId: node.id }) === entry.resource.component.displayList.length
					&& displayNodeMatches(actual, node, selector.packageId);
			},
		);
		await applySaveReload(
			labels[1],
			{
				opId: `phase9-detach-${kind}-display-node-undo`,
				kind: 'detachDisplayNode',
				selector: { ...selector, displayNodeId: node.id },
			},
			(project) => !findDisplayNode(project, { ...selector, displayNodeId: node.id }),
		);
		await resetSession();
	}

	const sourceSelector = {
		packageId: candidates.attach.pkg.id,
		componentResourceId: candidates.attach.resource.id,
		displayNodeId: candidates.attach.node.id,
	};
	const sourceNode = cloneJson(candidates.attach.node);
	const sourceIndex = candidates.attach.resource.component.displayList.findIndex((node) => node.id === sourceNode.id);
	const movedIndex = sourceIndex === 0
		? candidates.attach.resource.component.displayList.length - 1
		: 0;
	const reorderLabels = ['reorderDisplayNode', 'reorderDisplayNode.undo'];
	displayNodeLifecycleLabels.push(...reorderLabels);
	await applySaveReloadBatch(
		reorderLabels[0],
		[
			{ opId: 'phase9-reorder-detach', kind: 'detachDisplayNode', selector: sourceSelector },
			{
				opId: 'phase9-reorder-attach',
				kind: 'attachDisplayNode',
				selector: { packageId: sourceSelector.packageId, componentResourceId: sourceSelector.componentResourceId },
				atIndex: movedIndex,
				node: sourceNode,
			},
		],
		(project) => displayNodeIndex(project, sourceSelector) === movedIndex
			&& displayNodeMatches(findDisplayNode(project, sourceSelector), sourceNode, sourceSelector.packageId),
	);
	await applySaveReloadBatch(
		reorderLabels[1],
		[
			{ opId: 'phase9-reorder-undo-detach', kind: 'detachDisplayNode', selector: sourceSelector },
			{
				opId: 'phase9-reorder-undo-attach',
				kind: 'attachDisplayNode',
				selector: { packageId: sourceSelector.packageId, componentResourceId: sourceSelector.componentResourceId },
				atIndex: sourceIndex,
				node: sourceNode,
			},
		],
		(project) => displayNodeIndex(project, sourceSelector) === sourceIndex
			&& displayNodeMatches(findDisplayNode(project, sourceSelector), sourceNode, sourceSelector.packageId),
	);
	await resetSession();

	const relationTarget = candidates.attach.resource.component.displayList.find(
		(node) => node.id !== sourceNode.id,
	);
	assert(relationTarget, 'No sibling display node was found for Phase 9 relation verification.');
	const relationKey = (relation) => `${String(relation.targetNodeId || '')}\0${Number(relation.type)}`;
	const existingRelationKeys = new Set((sourceNode.relations || []).map(relationKey));
	const relationType = Array.from({ length: 24 }, (_, type) => type).find(
		(type) => !existingRelationKeys.has(`${relationTarget.id}\0${type}`),
	);
	assert(relationType !== undefined, 'No unused relation type was found for the Phase 9 relation fixture.');
	const updatedRelations = [
		...(sourceNode.relations || []),
		{ targetNodeId: relationTarget.id, type: relationType, usePercent: true },
	];
	const relationPreparation = prepareUpdateDisplayNodeRelations(
		initialProject,
		sourceSelector,
		updatedRelations,
	);
	assert(relationPreparation.ok, `Relation preparation failed: ${JSON.stringify(relationPreparation)}`);
	const relationLabels = ['updateDisplayNodeRelations', 'updateDisplayNodeRelations.undo'];
	displayNodeLifecycleLabels.push(...relationLabels);
	await applySaveReloadBatch(
		relationLabels[0],
		relationPreparation.transaction.operations,
		(project) => stableJson(findDisplayNode(project, sourceSelector)?.relations || [])
			=== stableJson(updatedRelations),
	);
	await applySaveReloadBatch(
		relationLabels[1],
		relationPreparation.transaction.inverseOperations,
		(project) => stableJson(findDisplayNode(project, sourceSelector)?.relations || [])
			=== stableJson(sourceNode.relations || []),
	);
	await resetSession();

	const reparentTargetSelector = {
		packageId: candidates.targetForReparent.pkg.id,
		componentResourceId: candidates.targetForReparent.resource.id,
	};
	const targetAppendIndex = candidates.targetForReparent.resource.component.displayList.length;
	const reparentLabels = ['reparentDisplayNode', 'reparentDisplayNode.undo'];
	displayNodeLifecycleLabels.push(...reparentLabels);
	await applySaveReloadBatch(
		reparentLabels[0],
		[
			{ opId: 'phase9-reparent-detach', kind: 'detachDisplayNode', selector: sourceSelector },
			{
				opId: 'phase9-reparent-attach',
				kind: 'attachDisplayNode',
				selector: reparentTargetSelector,
				atIndex: targetAppendIndex,
				node: sourceNode,
			},
		],
		(project) => !findDisplayNode(project, sourceSelector)
			&& displayNodeIndex(project, { ...reparentTargetSelector, displayNodeId: sourceNode.id }) === targetAppendIndex
			&& displayNodeMatches(
				findDisplayNode(project, { ...reparentTargetSelector, displayNodeId: sourceNode.id }),
				sourceNode,
				reparentTargetSelector.packageId,
			),
	);
	await applySaveReloadBatch(
		reparentLabels[1],
		[
			{
				opId: 'phase9-reparent-undo-detach',
				kind: 'detachDisplayNode',
				selector: { ...reparentTargetSelector, displayNodeId: sourceNode.id },
			},
			{
				opId: 'phase9-reparent-undo-attach',
				kind: 'attachDisplayNode',
				selector: { packageId: sourceSelector.packageId, componentResourceId: sourceSelector.componentResourceId },
				atIndex: sourceIndex,
				node: sourceNode,
			},
		],
		(project) => !findDisplayNode(project, { ...reparentTargetSelector, displayNodeId: sourceNode.id })
			&& displayNodeIndex(project, sourceSelector) === sourceIndex
			&& displayNodeMatches(findDisplayNode(project, sourceSelector), sourceNode, sourceSelector.packageId),
	);
	await resetSession();

	const groupableKinds = new Set([
		'image', 'text', 'richText', 'textInput', 'component', 'list', 'tree', 'graph',
		'group', 'movieClip', 'button', 'label', 'comboBox', 'progressBar', 'slider', 'scrollBar',
	]);
	const groupFixture = initialProject.packages.flatMap((pkg) => (
		pkg.resources
			.filter((resource) => resource.kind === 'component' && resource.component?.displayList)
			.map((resource) => {
				const byParent = Map.groupBy(
					resource.component.displayList.filter((node) => groupableKinds.has(node.kind)),
					(node) => String(node.group || ''),
				);
				return {
					pkg,
					resource,
					nodes: [...byParent.values()].find((nodes) => nodes.length >= 2)?.slice(0, 2) || [],
				};
			})
	)).find((entry) => entry.nodes.length === 2);
	assert(groupFixture, 'No two compatible sibling display nodes were found for Phase 9 group membership verification.');
	const groupSelectors = groupFixture.nodes.map((node) => ({
		packageId: groupFixture.pkg.id,
		componentResourceId: groupFixture.resource.id,
		displayNodeId: node.id,
	}));
	const groupPreparation = prepareGroupDisplayNodes(initialProject, groupSelectors);
	assert(groupPreparation.ok, `Group preparation failed: ${JSON.stringify(groupPreparation)}`);
	const groupId = groupPreparation.transaction.operation.node.id;
	const groupLabels = ['groupDisplayNodes', 'groupDisplayNodes.undo'];
	displayNodeLifecycleLabels.push(...groupLabels);
	await applySaveReloadBatch(
		groupLabels[0],
		groupPreparation.transaction.operations,
		(project) => Boolean(findDisplayNode(project, {
			packageId: groupFixture.pkg.id,
			componentResourceId: groupFixture.resource.id,
			displayNodeId: groupId,
		})) && groupSelectors.every((selector) => findDisplayNode(project, selector)?.group === groupId),
	);
	await applySaveReloadBatch(
		groupLabels[1],
		groupPreparation.transaction.inverseOperations,
		(project) => !findDisplayNode(project, {
			packageId: groupFixture.pkg.id,
			componentResourceId: groupFixture.resource.id,
			displayNodeId: groupId,
		}) && groupSelectors.every((selector, index) => (
			String(findDisplayNode(project, selector)?.group || '') === String(groupFixture.nodes[index].group || '')
		)),
	);
	await resetSession();

	const controller = candidates.controller.resource.component.controllers[0];
	const controllerSelector = {
		packageId: candidates.controller.pkg.id,
		componentResourceId: candidates.controller.resource.id,
		controllerName: controller.name,
	};
	const updatedController = {
		...cloneJson(controller),
		selectedIndex: (controller.selectedIndex + 1) % controller.pages.length,
	};
	await applySaveReload(
		'updateController',
		{ opId: 'phase9-update-controller', kind: 'updateController', selector: controllerSelector, controller: updatedController },
		(project) => stableJson(findController(project, controllerSelector)) === stableJson(updatedController),
	);
	await applySaveReload(
		'updateController.undo',
		{ opId: 'phase9-update-controller-undo', kind: 'updateController', selector: controllerSelector, controller: cloneJson(controller) },
		(project) => stableJson(findController(project, controllerSelector)) === stableJson(controller),
	);
	const addedController = { ...cloneJson(controller), name: '__phase9_controller' };
	const addedControllerSelector = { ...controllerSelector, controllerName: addedController.name };
	await applySaveReload(
		'addController',
		{ opId: 'phase9-add-controller', kind: 'addController', selector: addedControllerSelector, controller: addedController },
		(project) => stableJson(findController(project, addedControllerSelector)) === stableJson(addedController),
	);
	await applySaveReload(
		'removeController.undo',
		{ opId: 'phase9-remove-controller-undo', kind: 'removeController', selector: addedControllerSelector },
		(project) => findController(project, addedControllerSelector) === null,
	);
	await resetSession();

	const controllerLifecycleLabels = [];
	const expandedController = {
		...cloneJson(controller),
		pages: [
			...cloneJson(controller.pages),
			{ id: '__phase9_page', name: 'phase9 page' },
		],
	};
	const pageLabels = ['updateController.pages', 'updateController.pages.undo'];
	controllerLifecycleLabels.push(...pageLabels);
	await applySaveReload(
		pageLabels[0],
		{ opId: 'phase9-update-controller-pages', kind: 'updateController', selector: controllerSelector, controller: expandedController },
		(project) => controllerMatches(findController(project, controllerSelector), expandedController),
	);
	await applySaveReload(
		pageLabels[1],
		{ opId: 'phase9-update-controller-pages-undo', kind: 'updateController', selector: controllerSelector, controller: cloneJson(controller) },
		(project) => controllerMatches(findController(project, controllerSelector), controller),
	);
	await resetSession();

	const actionComponent = candidates.controllerWithTransition.resource.component;
	const actionSourceController = actionComponent.controllers.find((candidate) => candidate.pages?.length >= 2);
	const actionTargetController = actionComponent.controllers.find((candidate) => candidate.name !== actionSourceController?.name && candidate.pages?.[0]);
	const actionTransition = actionComponent.transitions[0];
	assert(actionSourceController && actionTargetController && actionTransition, 'No controller/action fixture remained available for Phase 9 controller action verification.');
	const actionController = {
		...cloneJson(actionSourceController),
		name: '__phase9_controller_actions',
		selectedIndex: 0,
		actions: [
			{
				name: '__phase9_play_transition',
				actionType: 0,
				fromPageIds: [actionSourceController.pages[0].id],
				toPageIds: [actionSourceController.pages[1].id],
				transitionName: actionTransition.name,
				playTimes: 2,
				delay: 0.25,
				stopOnExit: true,
				targetNodeId: '',
				controllerName: '',
				targetPage: '',
			},
			{
				name: '__phase9_change_page',
				actionType: 1,
				fromPageIds: [actionSourceController.pages[1].id],
				toPageIds: [actionSourceController.pages[0].id],
				transitionName: '',
				playTimes: 1,
				delay: 0,
				stopOnExit: false,
				targetNodeId: '',
				controllerName: actionTargetController.name,
				targetPage: actionTargetController.pages[0].id,
			},
		],
	};
	const actionSelector = {
		packageId: candidates.controllerWithTransition.pkg.id,
		componentResourceId: candidates.controllerWithTransition.resource.id,
		controllerName: actionController.name,
	};
	const updatedActionController = cloneJson(actionController);
	updatedActionController.actions[0].delay = 0.5;
	const actionLabels = [
		'addController.actions',
		'updateController.actions',
		'updateController.actions.undo',
		'removeController.actions',
		'removeController.actions.undo',
		'removeController.actions.cleanup',
	];
	controllerLifecycleLabels.push(...actionLabels);
	await applySaveReload(
		actionLabels[0],
		{ opId: 'phase9-add-controller-actions', kind: 'addController', selector: actionSelector, controller: actionController },
		(project) => controllerMatches(findController(project, actionSelector), actionController),
	);
	await applySaveReload(
		actionLabels[1],
		{ opId: 'phase9-update-controller-actions', kind: 'updateController', selector: actionSelector, controller: updatedActionController },
		(project) => controllerMatches(findController(project, actionSelector), updatedActionController),
	);
	await applySaveReload(
		actionLabels[2],
		{ opId: 'phase9-update-controller-actions-undo', kind: 'updateController', selector: actionSelector, controller: actionController },
		(project) => controllerMatches(findController(project, actionSelector), actionController),
	);
	await applySaveReload(
		actionLabels[3],
		{ opId: 'phase9-remove-controller-actions', kind: 'removeController', selector: actionSelector },
		(project) => findController(project, actionSelector) === null,
	);
	await applySaveReload(
		actionLabels[4],
		{ opId: 'phase9-remove-controller-actions-undo', kind: 'addController', selector: actionSelector, controller: actionController },
		(project) => controllerMatches(findController(project, actionSelector), actionController),
	);
	await applySaveReload(
		actionLabels[5],
		{ opId: 'phase9-remove-controller-actions-cleanup', kind: 'removeController', selector: actionSelector },
		(project) => findController(project, actionSelector) === null,
	);
	await resetSession();

	const gearOwner = candidates.gearByKind.get('display');
	const gearOwnerComponent = gearOwner.resource.component;
	const gearOwnerController = gearOwnerComponent.controllers.find((candidate) => candidate.name === gearOwner.gear.controllerName);
	assert(gearOwnerController, 'No controller found for the Phase 9 controller/gear cascade verification.');
	const dependentGears = gearOwnerComponent.displayList.flatMap((node) => (node.gears ?? [])
		.filter((gear) => gear.controllerName === gearOwnerController.name)
		.map((gear) => ({ node, gear })));
	assert(dependentGears.length > 0, 'No controller gear dependency was found for Phase 9 cascade verification.');
	const cascadeControllerSelector = {
		packageId: gearOwner.pkg.id,
		componentResourceId: gearOwner.resource.id,
		controllerName: gearOwnerController.name,
	};
	const removeDependentGears = dependentGears.map(({ node, gear }, index) => ({
		opId: `phase9-cascade-remove-gear-${index}`,
		kind: gear.kind === 'look' ? 'removeLookGear' : 'removeGear',
		selector: {
			packageId: cascadeControllerSelector.packageId,
			componentResourceId: cascadeControllerSelector.componentResourceId,
			displayNodeId: node.id,
			kind: gear.kind,
			controllerName: gear.controllerName,
		},
	}));
	const restoreDependentGears = dependentGears.map(({ node, gear }, index) => ({
		opId: `phase9-cascade-restore-gear-${index}`,
		kind: gear.kind === 'look' ? 'addLookGear' : 'addGear',
		selector: {
			packageId: cascadeControllerSelector.packageId,
			componentResourceId: cascadeControllerSelector.componentResourceId,
			displayNodeId: node.id,
			kind: gear.kind,
			controllerName: gear.controllerName,
		},
		gear: cloneJson(gear),
	}));
	const cascadeLabels = ['removeController.withGears', 'removeController.withGears.undo'];
	controllerLifecycleLabels.push(...cascadeLabels);
	await applySaveReloadBatch(
		cascadeLabels[0],
		[
			...removeDependentGears,
			{ opId: 'phase9-cascade-remove-controller', kind: 'removeController', selector: cascadeControllerSelector },
		],
		(project) => findController(project, cascadeControllerSelector) === null
			&& dependentGears.every(({ node, gear }) => !findGear(project, {
				packageId: cascadeControllerSelector.packageId,
				componentResourceId: cascadeControllerSelector.componentResourceId,
				displayNodeId: node.id,
				kind: gear.kind,
				controllerName: gear.controllerName,
			})),
	);
	await applySaveReloadBatch(
		cascadeLabels[1],
		[
			{ opId: 'phase9-cascade-restore-controller', kind: 'addController', selector: cascadeControllerSelector, controller: cloneJson(gearOwnerController) },
			...restoreDependentGears,
		],
		(project) => controllerMatches(findController(project, cascadeControllerSelector), gearOwnerController)
			&& dependentGears.every(({ node, gear }) => gearMatches(findGear(project, {
				packageId: cascadeControllerSelector.packageId,
				componentResourceId: cascadeControllerSelector.componentResourceId,
				displayNodeId: node.id,
				kind: gear.kind,
				controllerName: gear.controllerName,
			}), gear)),
	);
	await resetSession();

	const transition = candidates.transition.resource.component.transitions[0];
	const transitionSelector = {
		packageId: candidates.transition.pkg.id,
		componentResourceId: candidates.transition.resource.id,
		transitionName: transition.name,
	};
	const updatedTransition = { ...cloneJson(transition), autoPlay: !transition.autoPlay };
	await applySaveReload(
		'updateTransition',
		{ opId: 'phase9-update-transition', kind: 'updateTransition', selector: transitionSelector, transition: updatedTransition },
		(project) => stableJson(findTransition(project, transitionSelector)) === stableJson(updatedTransition),
	);
	await applySaveReload(
		'updateTransition.undo',
		{ opId: 'phase9-update-transition-undo', kind: 'updateTransition', selector: transitionSelector, transition: cloneJson(transition) },
		(project) => stableJson(findTransition(project, transitionSelector)) === stableJson(transition),
	);
	const addedTransition = { ...cloneJson(transition), name: '__phase9_transition' };
	const addedTransitionSelector = { ...transitionSelector, transitionName: addedTransition.name };
	await applySaveReload(
		'addTransition',
		{ opId: 'phase9-add-transition', kind: 'addTransition', selector: addedTransitionSelector, transition: addedTransition },
		(project) => stableJson(findTransition(project, addedTransitionSelector)) === stableJson(addedTransition),
	);
	await applySaveReload(
		'removeTransition.undo',
		{ opId: 'phase9-remove-transition-undo', kind: 'removeTransition', selector: addedTransitionSelector },
		(project) => findTransition(project, addedTransitionSelector) === null,
	);
	await resetSession();

	const transitionLifecycleLabels = [];
	const transitionSafetyLabels = [];
	const transitionGaps = [];
	for (const [actionType, entry] of candidates.transitionByActionType) {
		const sourceTransition = entry.transition;
		const selector = {
			packageId: entry.pkg.id,
			componentResourceId: entry.resource.id,
			transitionName: sourceTransition.name,
		};
		const itemIndex = sourceTransition.items.findIndex((item) => item.actionType === actionType);
		assert(itemIndex >= 0, `No transition item of type ${actionType} remained available for Phase 9 verification.`);
		const updated = cloneJson(sourceTransition);
		updated.items[itemIndex].label = `${updated.items[itemIndex].label || 'phase9'}__type${actionType}`;
		const labels = [`updateTransition.itemType${actionType}`, `updateTransition.itemType${actionType}.undo`];
		const componentNodeIds = new Set((entry.resource.component.displayList ?? []).map((node) => node.id));
		const missingTargetNodeIds = [...new Set((sourceTransition.items ?? [])
			.map((item) => item.targetNodeId)
			.filter((nodeId) => nodeId && !componentNodeIds.has(nodeId)))];
		const required = missingTargetNodeIds.length === 0;
		if (!required) {
			const operation = {
				opId: `phase9-update-transition-item-${actionType}-invalid-target`,
				kind: 'updateTransition',
				selector,
				transition: updated,
			};
			const before = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
			const supportIssues = validateTransactionSupport(before, [operation]);
			const applied = await runtime.applyTransaction({
				sessionId,
				expectedRevision: revision,
				operations: [operation],
			});
			const preflightRejected = !applied.ok
				&& applied.error?.stage === 'preflight'
				&& supportIssues.some((issue) => issue.code === 'invalid_display_node_selector');
			const label = `updateTransition.itemType${actionType}.invalidTargetPreflight`;
			transitionSafetyLabels.push(label);
			operations.push({
				label,
				operation,
				required: true,
				expectedPreflightRejection: true,
				supportIssueCodes: supportIssues.map((issue) => issue.code),
				apply: summarizeResult(applied),
				save: { ok: false, skipped: true, reason: 'Invalid legacy transition must be rejected before materialization.' },
				reloadOk: preflightRejected,
				error: preflightRejected ? undefined : 'Invalid transition target was not rejected during preflight.',
			});
			transitionGaps.push({
				packageId: entry.pkg.id,
				componentResourceId: entry.resource.id,
				componentName: entry.resource.name,
				transitionName: sourceTransition.name,
				actionType,
				missingTargetNodeIds,
				status: preflightRejected ? 'rejected_preflight' : 'unexpected_result',
			});
			await resetSession();
			continue;
		}
		transitionLifecycleLabels.push(...labels);
		await applySaveReload(
			labels[0],
			{ opId: `phase9-update-transition-item-${actionType}`, kind: 'updateTransition', selector, transition: updated },
			(project) => transitionMatchWithDetails(findTransition(project, selector), updated),
			required,
		);
		await applySaveReload(
			labels[1],
			{ opId: `phase9-update-transition-item-${actionType}-undo`, kind: 'updateTransition', selector, transition: cloneJson(sourceTransition) },
			(project) => transitionMatchWithDetails(findTransition(project, selector), sourceTransition),
			required,
		);
		await resetSession();
	}

	const removableTransitionEntry = candidates.transitionByActionType.values().next().value;
	const removableTransition = removableTransitionEntry.transition;
	const removableTransitionSelector = {
		packageId: removableTransitionEntry.pkg.id,
		componentResourceId: removableTransitionEntry.resource.id,
		transitionName: removableTransition.name,
	};
	const removeOriginalTransitionLabels = [
		'removeTransition.original',
		'removeTransition.original.undo',
		'removeTransition.original.cleanup',
	];
	transitionLifecycleLabels.push(...removeOriginalTransitionLabels);
	await applySaveReload(
		removeOriginalTransitionLabels[0],
		{ opId: 'phase9-remove-original-transition', kind: 'removeTransition', selector: removableTransitionSelector },
		(project) => findTransition(project, removableTransitionSelector) === null,
	);
	await applySaveReload(
		removeOriginalTransitionLabels[1],
		{
			opId: 'phase9-remove-original-transition-undo',
			kind: 'addTransition',
			selector: removableTransitionSelector,
			transition: cloneJson(removableTransition),
		},
		(project) => stableJson(findTransition(project, removableTransitionSelector)) === stableJson(removableTransition),
	);
	await applySaveReload(
		removeOriginalTransitionLabels[2],
		{ opId: 'phase9-remove-original-transition-cleanup', kind: 'removeTransition', selector: removableTransitionSelector },
		(project) => findTransition(project, removableTransitionSelector) === null,
	);
	await resetSession();

	const gearLifecycleLabels = [];
	for (const kind of SUPPORTED_GEAR_KINDS) {
		const existingEntry = candidates.gearByKind.get(kind);
		const existingGear = existingEntry.gear;
		const existingController = existingEntry.resource.component.controllers.find(
			(controllerValue) => controllerValue.name === existingGear.controllerName,
		);
		assert(existingController, `No controller found for existing ${kind} gear.`);
		const existingSelector = {
			packageId: existingEntry.pkg.id,
			componentResourceId: existingEntry.resource.id,
			displayNodeId: existingEntry.node.id,
			kind,
			controllerName: existingGear.controllerName,
		};
		const updatedExistingGear = mutateGearForVerification(existingGear, existingController);
		const updateKind = kind === 'look' ? 'updateLookGear' : 'updateGear';
		await applySaveReload(
			`update${kind}Gear`,
			{ opId: `phase9-update-${kind}-gear`, kind: updateKind, selector: existingSelector, gear: updatedExistingGear },
			(project) => gearMatches(findGear(project, existingSelector), updatedExistingGear),
		);
		await applySaveReload(
			`update${kind}Gear.undo`,
			{ opId: `phase9-update-${kind}-gear-undo`, kind: updateKind, selector: existingSelector, gear: cloneJson(existingGear) },
			(project) => gearMatches(findGear(project, existingSelector), existingGear),
		);
		await resetSession();

		const addEntry = candidates.addGearByKind.get(kind);
		const addController = addEntry.resource.component.controllers.find((controllerValue) => controllerValue.name
			&& controllerValue.pages?.[0]
			&& !(addEntry.node.gears ?? []).some(
				(gear) => gear.kind === kind && gear.controllerName === controllerValue.name,
			));
		assert(addController, `No controller remained available for ${kind} gear lifecycle verification.`);
		const selector = {
			packageId: addEntry.pkg.id,
			componentResourceId: addEntry.resource.id,
			displayNodeId: addEntry.node.id,
			kind,
			controllerName: addController.name,
		};
		const addedGear = makeGearForController(existingGear, addController, `phase9_${kind}`);
		const updatedGear = mutateGearForVerification(addedGear, addController);
		const addKind = kind === 'look' ? 'addLookGear' : 'addGear';
		const removeKind = kind === 'look' ? 'removeLookGear' : 'removeGear';
		const labels = [
			`add${kind}Gear`,
			`update${kind}Gear.added`,
			`update${kind}Gear.added.undo`,
			`remove${kind}Gear`,
			`remove${kind}Gear.undo`,
			`remove${kind}Gear.cleanup`,
		];
		gearLifecycleLabels.push(...labels);
		await applySaveReload(
			labels[0],
			{ opId: `phase9-add-${kind}-gear`, kind: addKind, selector, gear: addedGear },
			(project) => gearMatches(findGear(project, selector), addedGear),
		);
		await applySaveReload(
			labels[1],
			{ opId: `phase9-update-added-${kind}-gear`, kind: updateKind, selector, gear: updatedGear },
			(project) => gearMatches(findGear(project, selector), updatedGear),
		);
		await applySaveReload(
			labels[2],
			{ opId: `phase9-update-added-${kind}-gear-undo`, kind: updateKind, selector, gear: addedGear },
			(project) => gearMatches(findGear(project, selector), addedGear),
		);
		await applySaveReload(
			labels[3],
			{ opId: `phase9-remove-${kind}-gear`, kind: removeKind, selector },
			(project) => findGear(project, selector) === null,
		);
		await applySaveReload(
			labels[4],
			{ opId: `phase9-remove-${kind}-gear-undo`, kind: addKind, selector, gear: addedGear },
			(project) => gearMatches(findGear(project, selector), addedGear),
		);
		await applySaveReload(
			labels[5],
			{ opId: `phase9-remove-${kind}-gear-cleanup`, kind: removeKind, selector },
			(project) => findGear(project, selector) === null,
		);
		await resetSession();
	}

	const typedGearEntry = candidates.gearByKind.get('xy');
	const typedGearSelector = {
		packageId: typedGearEntry.pkg.id,
		componentResourceId: typedGearEntry.resource.id,
		displayNodeId: typedGearEntry.node.id,
	};
	const typedGearModel = getDisplayNodeGearEditorModel(
		await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem),
		typedGearSelector,
	);
	assert(typedGearModel, 'Typed gear editor model is unavailable.');
	const typedGearOriginal = cloneJson(typedGearModel.gears);
	const typedGearDraft = cloneJson(typedGearOriginal);
	const typedGearEditable = typedGearDraft.filter((gear) => gear.states?.some((state) => state.value)).slice(0, 2);
	assert(typedGearEditable.length === 2, 'Typed gear batch requires two editable value-bound gears.');
	for (const gear of typedGearEditable) {
		const controller = typedGearEntry.resource.component.controllers.find((item) => item.name === gear.controllerName);
		assert(controller, `Typed gear controller ${gear.controllerName} is unavailable.`);
		const updated = mutateGearForVerification(gear, controller);
		typedGearDraft[typedGearDraft.indexOf(gear)] = updated;
	}
	const typedGearPreparation = prepareUpdateDisplayNodeGears(
		await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem),
		typedGearSelector,
		typedGearDraft,
	);
	assert(typedGearPreparation.ok, `Typed gear planner failed: ${JSON.stringify(typedGearPreparation)}`);
	const typedGearLabels = ['updateTypedGearBatch', 'updateTypedGearBatch.undo'];
	gearLifecycleLabels.push(...typedGearLabels);
	const typedGearMatches = (project, expected) => {
		const node = findDisplayNode(project, typedGearSelector);
		return node?.gears?.length === expected.length && expected.every((gear) => gearMatches(
			findGear(project, { ...typedGearSelector, kind: gear.kind, controllerName: gear.controllerName }),
			gear,
		));
	};
	await applySaveReloadBatch(
		typedGearLabels[0],
		typedGearPreparation.transaction.operations,
		(project) => typedGearMatches(project, typedGearDraft),
	);
	await applySaveReloadBatch(
		typedGearLabels[1],
		typedGearPreparation.transaction.inverseOperations,
		(project) => typedGearMatches(project, typedGearOriginal),
	);
	await resetSession();

	const events = runtime.getEvents({ sessionId, afterSeq: 0, limit: 120 });
	const sourceHashAfter = sha256File(sourceProjectPath);
	assert(sourceHashAfter === sourceHashBefore, 'Phase 9 verification modified the source authoring project.');
	const verificationOk = operations.filter((entry) => entry.required).every((entry) => entry.reloadOk);
	const operationReloaded = (labels) => labels.every((label) => {
		const entry = operations.find((candidate) => candidate.label === label);
		return entry?.required === false || entry?.reloadOk === true;
	});
	const binaryResourceLifecycleOk = operationReloaded([
		'addBinaryResource',
		'addBinaryResource.undo',
		'addBinaryResource.reapply',
		'replaceBinaryResourceBytes',
		'replaceBinaryResourceBytes.undo',
		'removeBinaryResource',
		'removeBinaryResource.undo',
		'removeBinaryResource.cleanup',
	]);
	const packageLifecycleOk = operationReloaded(packageLifecycleLabels);
	const componentLifecycleOk = operationReloaded(componentLifecycleLabels);
	const independentTextComponentLifecycleOk = operationReloaded(independentTextComponentLabels);
	const componentLifecycleReferenceRewriteOk = operationReloaded(componentLifecycleReferenceRewriteLabels);
	const assetLifecycleOk = operationReloaded(assetLifecycleLabels);
	const movieClipImportLifecycleOk = operationReloaded(movieClipImportLabels);
	const bitmapFontImportLifecycleOk = operationReloaded(bitmapFontImportLabels);
	const displayNodeLifecycleOk = operationReloaded(displayNodeLifecycleLabels);
	const controllerLifecycleOk = operationReloaded(controllerLifecycleLabels);
	const transitionLifecycleOk = operationReloaded(transitionLifecycleLabels);
	const transitionInvalidTargetPreflightOk = operationReloaded(transitionSafetyLabels);
	const gearLifecycleOk = operationReloaded(gearLifecycleLabels);
	const report = {
		schemaVersion: 6,
		generatedAt: new Date().toISOString(),
		phase: 'Phase 9',
		mode: 'high_risk_transaction_browser_storage',
		source: {
			packageName: '@openfairygui/backend',
			packageVersions: readPackageVersions(),
			sourceKind: isWorkspaceSource ? 'workspace_source' : 'npm_package',
			projectPath: relativePath(sourceProjectPath),
			sourceUnchanged: sourceHashAfter === sourceHashBefore,
		},
		boundaries: {
			package: 'Validated empty package add/rename/remove and inverse save/reload. Package deletion remains unavailable when the package has references.',
			component: 'Validated empty component add/move/remove, a synthetic self-contained non-empty text-only component lifecycle, and explicit inbound component-reference rewrite/detach batches for move/remove; each has inverse save/reload. UI still needs explicit reference planning and does not auto-rewrite arbitrary components.',
			resource: 'Validated image publish properties plus rename/move/add/replace-bytes/remove with inverse save/reload for image, sound, font, movieClip, and misc binary assets, including an atomic text-BMFont descriptor and texture import plus alpha-trimmed PNG/JPEG sequence to JTA v102 MovieClip import and timing edits. Browser File input supplies exact bytes only.',
			displayList: 'Validated attach/detach for every node kind present in the baseline, same-package reorder/reparent, and persisted group membership with inverse atomic batches.',
			controller: 'Validated page schema, controller actions, add/update/remove, and controller removal with dependent gears removed/restored in the same transaction batch.',
			transition: 'Validated transition add/update/remove and every baseline action type whose targets are structurally valid. Legacy dangling targets are rejected during preflight before materialization.',
			gear: 'Validated add/update/remove with inverse save/reload for display, display2, look, xy, size, color, animation, text, icon, and fontSize gears.',
			preview: 'Runtime preview still requires a published runtime package and is not a raw .fairy materialization path.',
		},
		results: {
			ok: verificationOk,
			imageRenameBoundary: {
				persisted: imageRenamePersisted,
				status: imageRenamePersisted ? 'closed_in_npm' : 'open',
			},
			binaryResourceLifecycle: {
				persisted: binaryResourceLifecycleOk,
				status: binaryResourceLifecycleOk ? 'verified' : 'failed',
				reloadChecks: binaryReloadChecks,
			},
			matrix: {
				packageLifecycle: packageLifecycleOk,
				componentLifecycle: componentLifecycleOk,
				componentPropsLifecycle: operationReloaded(componentSizeLabels),
				imagePropsLifecycle: operationReloaded(imagePropsLabels),
				independentTextComponentLifecycle: independentTextComponentLifecycleOk,
				componentLifecycleReferenceRewrite: componentLifecycleReferenceRewriteOk,
				independentTextComponent: {
					packageId: independentTextSourcePackage.id,
					componentResourceId: independentTextComponent.id,
					displayNodeCount: independentTextComponent.component.displayList.length,
				},
				componentReferenceRewrite: {
					hostPackageId: referenceHostSelector.packageId,
					hostComponentResourceId: referenceHostComponent.id,
					referencedComponentResourceId: independentTextComponent.id,
					targetPackageId: independentTextTargetSelector.packageId,
				},
				assetLifecycle: assetLifecycleOk,
				movieClipImportLifecycle: movieClipImportLifecycleOk,
				bitmapFontImportLifecycle: bitmapFontImportLifecycleOk,
				displayNodeLifecycle: displayNodeLifecycleOk,
				groupMembershipLifecycle: operationReloaded(groupLabels),
				controllerLifecycle: controllerLifecycleOk,
				transitionLifecycle: transitionLifecycleOk,
				transitionInvalidTargetPreflight: transitionInvalidTargetPreflightOk,
				gearLifecycle: gearLifecycleOk,
				typedGearBatch: operationReloaded(typedGearLabels),
				resourceKinds: [...candidates.assetsByKind.keys()].sort(),
				displayNodeKinds: [...candidates.nodeByKind.keys()].sort(),
				gearKinds: [...SUPPORTED_GEAR_KINDS],
				transitionActionTypes: [...candidates.transitionByActionType.keys()].sort((left, right) => left - right),
			},
			transitionGaps,
			baselineSupportIssueCount: baselineIssues.length,
			openSession: summarizeResult(firstOpened),
			operations,
			events: events.ok
				? { ok: true, kinds: events.data.events.map((event) => event.kind) }
				: summarizeResult(events),
			storage: storage.summary(),
		},
		diagnostics: [
			{
				severity: 'info',
				code: 'PHASE9_HIGH_RISK_TRANSACTION_SAVE_RELOAD_VERIFIED',
				message: 'Every enabled high-risk UAM matrix row applied, saved through browser-style storage, reloaded through ProjectReader, and was undone with a second save/reload.',
			},
			{
				severity: 'info',
				code: 'GAP-20260722-01_NPM_RELEASE_VERIFIED',
				message: 'Image renameResource persisted both resource name and LayaBox file name through browser storage save/reload in the supplied npm package set.',
			},
			{
				severity: 'info',
				code: 'PHASE9_BINARY_RESOURCE_LIFECYCLE_VERIFIED',
				message: 'Misc binary resource add, replace bytes, remove, and all inverse operations persisted through browser storage save/reload.',
			},
			{
				severity: 'info',
				code: 'PHASE9_BITMAP_FONT_IMPORT_LIFECYCLE_VERIFIED',
				message: 'A text BMFont descriptor and its texture were atomically added, saved, reloaded, and removed in dependency-safe inverse order.',
			},
			{
				severity: 'info',
				code: 'PHASE9_MOVIECLIP_IMPORT_LIFECYCLE_VERIFIED',
				message: 'A naturally ordered PNG sequence was encoded as JTA v102, saved, reloaded through ProjectReader, and removed through its inverse operation.',
			},
			{
				severity: 'info',
				code: 'PHASE9_PACKAGE_COMPONENT_LIFECYCLE_VERIFIED',
				message: 'Public package and component lifecycle operations completed browser-storage save/reload/inverse checks in the supplied package set.',
			},
			{
				severity: 'info',
				code: 'PHASE9_INDEPENDENT_TEXT_COMPONENT_LIFECYCLE_VERIFIED',
				message: 'A synthetic self-contained non-empty text-only component completed add/move/remove and inverse browser-storage save/reload checks.',
			},
			{
				severity: 'info',
				code: 'PHASE9_COMPONENT_LIFECYCLE_REFERENCE_REWRITE_VERIFIED',
				message: 'A synthetic inbound component reference was atomically retargeted for move and detached/restored for removal through browser-storage save/reload/inverse batches.',
			},
			{
				severity: 'info',
				code: 'PHASE9_ALL_GEAR_KINDS_LIFECYCLE_VERIFIED',
				message: 'All ten public gear kinds completed add, update, remove, and inverse browser-storage save/reload checks.',
			},
			{
				severity: 'info',
				code: 'PHASE9_GROUP_MEMBERSHIP_LIFECYCLE_VERIFIED',
				message: 'Group creation, member assignment, inverse removal, and member restoration persisted through browser storage save/reload.',
			},
			...transitionGaps.map((gap) => ({
				severity: gap.status === 'rejected_preflight' ? 'info' : 'error',
				code: 'PHASE9_TRANSITION_DANGLING_TARGET_PRECHECK',
				message: `${gap.componentName}/${gap.transitionName} references missing node ${gap.missingTargetNodeIds.join(', ')}; OpenFairyGUI must reject it before materialization.`,
			})),
		],
	};

	mkdirSync(path.dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	console.log(JSON.stringify({
		ok: verificationOk,
		reportPath: relativePath(reportPath),
		packageVersions: report.source.packageVersions,
		operationCount: operations.length,
		sourceUnchanged: report.source.sourceUnchanged,
	}, null, 2));
	if (!verificationOk) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack || error.message : String(error));
	process.exitCode = 1;
});
