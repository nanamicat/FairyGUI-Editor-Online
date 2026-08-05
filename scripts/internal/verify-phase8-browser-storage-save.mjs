import assert from 'node:assert/strict';
import {
	existsSync,
	mkdirSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { MemoryBrowserStorage } from '../browser-storage-fixture.mjs';
import { importTypeScriptModule } from '../import-typescript-module.mjs';
import {
	resolveAuthoringProjectPath,
	resolveOpenFairyGuiModuleRoot,
} from '../project-boundary.mjs';
import { cloneJson, findDisplayNode, importFile, readJson } from '../verification-helpers.mjs';

const root = process.cwd();
const openfairyguiModuleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const reportPath = path.resolve(
	process.argv[3] ?? 'verification/reports/phase8-browser-storage-save-report.json',
);
const sourceProjectPath = resolveAuthoringProjectPath(process.argv[4]);
const commonPropsPersistenceExpectation = process.env.FAIRYGUI_EXPECT_COMMON_PROPS_PERSIST;
const expectCommonPropsPersisted = commonPropsPersistenceExpectation === '1'
	? true
	: commonPropsPersistenceExpectation === '0'
		? false
		: true;
const sourceProjectDir = path.dirname(sourceProjectPath);
const browserFairyPath = path.basename(sourceProjectPath);

const corePackageDir = path.join(openfairyguiModuleRoot, 'core');
const backendPackageDir = path.join(openfairyguiModuleRoot, 'backend');
const corePackageJsonPath = path.join(corePackageDir, 'package.json');
const functionsPackageJsonPath = path.join(openfairyguiModuleRoot, 'functions', 'package.json');
const backendPackageJsonPath = path.join(backendPackageDir, 'package.json');
const cliPackageJsonPath = path.join(openfairyguiModuleRoot, 'cli', 'package.json');
const coreEntry = path.join(corePackageDir, 'dist', 'index.js');
const coreUamEntry = path.join(corePackageDir, 'dist', 'uam', 'index.js');
const coreProjectIoEntry = path.join(corePackageDir, 'dist', 'project-io.js');
const backendEntry = path.join(backendPackageDir, 'dist', 'index.mjs');
const isWorkspaceSource = path.basename(openfairyguiModuleRoot) === 'packages';

function relativePath(filePath) {
	return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function readPackageVersions() {
	return {
		core: readJson(corePackageJsonPath).version,
		functions: readJson(functionsPackageJsonPath).version,
		backend: readJson(backendPackageJsonPath).version,
		cli: existsSync(cliPackageJsonPath) ? readJson(cliPackageJsonPath).version : '',
	};
}

function findPhase8Target(project) {
	const basicPackage = project.packages?.find((pkg) => pkg.name === 'Basic');
	const button = basicPackage?.resources?.find((resource) => resource.name === 'Button');
	const title = button?.component?.displayList?.find((node) => node.name === 'title' && node.id);
	if (basicPackage && button && title) return buildTarget(basicPackage, button, title);

	for (const pkg of project.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			for (const node of resource.component?.displayList ?? []) {
				if (node.kind === 'text' && node.id) return buildTarget(pkg, resource, node);
			}
		}
	}
	return null;
}

function findComponentInstanceTarget(project, extensionType) {
	for (const pkg of project.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			const node = resource.component?.displayList?.find(
				(candidate) => candidate.kind === 'component'
					&& candidate.id
					&& candidate.instanceProperties?.extensionType === extensionType,
			);
			if (!node) continue;
			return {
				packageId: pkg.id,
				packageName: pkg.name ?? '',
				componentResourceId: resource.id,
				componentName: resource.name ?? '',
				displayNodeId: node.id,
				displayNodeName: node.name ?? node.id,
			};
		}
	}
	return null;
}

function findDisplayNodeTarget(project, kind) {
	for (const pkg of project.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			const node = resource.component?.displayList?.find((candidate) => candidate.kind === kind && candidate.id);
			if (node) return buildTarget(pkg, resource, node);
		}
	}
	return null;
}

function findHydratedMainImage(project) {
	for (const pkg of project.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			if (resource.kind !== 'image' || resource.branch || !(resource.sourceBytes instanceof Uint8Array)) continue;
			return { packageId: pkg.id, packageName: pkg.name, resource };
		}
	}
	return null;
}

function findNonLookGearTarget(project) {
	for (const pkg of project.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			if (resource.kind !== 'component' || resource.branch) continue;
			for (const controller of resource.component.controllers ?? []) {
				const page = controller.pages?.[0];
				if (!page) continue;
				const node = resource.component.displayList?.find((candidate) =>
					!candidate.gears?.some((gear) => gear.kind === 'xy' && gear.controllerName === controller.name),
				);
				if (node) {
					return {
						packageId: pkg.id,
						componentResourceId: resource.id,
						node,
						controllerName: controller.name,
						pageId: page.id,
					};
				}
			}
		}
	}
	return null;
}

function buildTarget(pkg, resource, node) {
	return {
		packageId: String(pkg.id ?? ''),
		packageName: String(pkg.name ?? ''),
		componentResourceId: String(resource.id ?? ''),
		componentName: String(resource.name ?? ''),
		displayNodeId: String(node.id ?? ''),
		displayNodeName: String(node.name ?? node.id ?? ''),
	};
}

function summarizeNode(node) {
	return {
		id: String(node?.id ?? ''),
		name: String(node?.name ?? node?.id ?? ''),
		type: String(node?.kind ?? ''),
		x: Number(node?.position?.x ?? 0),
		y: Number(node?.position?.y ?? 0),
		width: Number(node?.size?.width ?? 0),
		height: Number(node?.size?.height ?? 0),
		locked: node?.locked === true,
		aspect: node?.aspect === true,
		minSize: cloneJson(node?.minSize ?? { width: 0, height: 0 }),
		maxSize: cloneJson(node?.maxSize ?? { width: 0, height: 0 }),
		scale: cloneJson(node?.scale ?? { x: 1, y: 1 }),
		skew: cloneJson(node?.skew ?? { x: 0, y: 0 }),
		text: String(node?.text ?? ''),
		visible: node?.visible !== false,
		touchable: node?.touchable !== false,
		grayed: node?.grayed === true,
		alpha: Number(node?.alpha ?? 1),
		rotation: Number(node?.rotation ?? 0),
		tooltips: String(node?.tooltips ?? ''),
		blendMode: String(node?.blendMode ?? 'normal'),
		filter: String(node?.filter ?? ''),
		filterData: String(node?.filterData ?? ''),
		pivotX: Number(node?.pivot?.x ?? 0),
		pivotY: Number(node?.pivot?.y ?? 0),
		pivotAsAnchor: node?.pivotAsAnchor === true,
		customData: String(node?.customData ?? ''),
		font: String(node?.font ?? ''),
		fontSize: Number(node?.fontSize ?? 0),
		color: String(node?.color ?? ''),
	};
}

function applyPropsToState(state, props) {
	return {
		...state,
		x: props.position ? props.position.x : state.x,
		y: props.position ? props.position.y : state.y,
		width: props.size ? props.size.width : state.width,
		height: props.size ? props.size.height : state.height,
		locked: props.locked !== undefined ? props.locked : state.locked,
		aspect: props.aspect !== undefined ? props.aspect : state.aspect,
		minSize: props.minSize ?? state.minSize,
		maxSize: props.maxSize ?? state.maxSize,
		scale: props.scale ?? state.scale,
		skew: props.skew ?? state.skew,
		text: props.text !== undefined ? props.text : state.text,
		visible: props.visible !== undefined ? props.visible : state.visible,
		touchable: props.touchable !== undefined ? props.touchable : state.touchable,
		grayed: props.grayed !== undefined ? props.grayed : state.grayed,
		alpha: props.alpha !== undefined ? props.alpha : state.alpha,
		rotation: props.rotation !== undefined ? props.rotation : state.rotation,
		tooltips: props.tooltips !== undefined ? props.tooltips : state.tooltips,
		blendMode: props.blendMode !== undefined ? props.blendMode : state.blendMode,
		filter: props.filter !== undefined ? props.filter : state.filter,
		filterData: props.filterData !== undefined ? props.filterData : state.filterData,
		pivotX: props.pivot ? props.pivot.x : state.pivotX,
		pivotY: props.pivot ? props.pivot.y : state.pivotY,
		pivotAsAnchor: props.pivotAsAnchor !== undefined ? props.pivotAsAnchor : state.pivotAsAnchor,
		customData: props.customData !== undefined ? props.customData : state.customData,
		font: props.font !== undefined ? props.font : state.font,
		fontSize: props.fontSize !== undefined ? props.fontSize : state.fontSize,
		color: props.color !== undefined ? props.color : state.color,
	};
}

function statesMatch(actual, expected) {
	return (
		actual.x === expected.x &&
		actual.y === expected.y &&
		actual.width === expected.width &&
		actual.height === expected.height &&
		actual.text === expected.text &&
		actual.visible === expected.visible &&
		actual.font === expected.font &&
		actual.fontSize === expected.fontSize &&
		actual.color === expected.color
	);
}

function commonPropsMatch(actual, expected) {
	return actual.locked === expected.locked
		&& actual.aspect === expected.aspect
		&& JSON.stringify(actual.minSize) === JSON.stringify(expected.minSize)
		&& JSON.stringify(actual.maxSize) === JSON.stringify(expected.maxSize)
		&& JSON.stringify(actual.scale) === JSON.stringify(expected.scale)
		&& JSON.stringify(actual.skew) === JSON.stringify(expected.skew)
		&& actual.touchable === expected.touchable
		&& actual.grayed === expected.grayed
		&& actual.alpha === expected.alpha
		&& actual.rotation === expected.rotation
		&& actual.tooltips === expected.tooltips
		&& actual.blendMode === expected.blendMode
		&& actual.filter === expected.filter
		&& actual.filterData === expected.filterData
		&& actual.pivotX === expected.pivotX
		&& actual.pivotY === expected.pivotY
		&& actual.pivotAsAnchor === expected.pivotAsAnchor
		&& actual.customData === expected.customData;
}

function summarizeBackendResult(result) {
	if (result.ok) {
		return {
			ok: true,
			stage: result.meta?.stage,
			revision: result.data?.revision,
			dirty: result.data?.dirty,
			lastSavedRevision: result.data?.lastSavedRevision,
			durationMs: result.meta?.durationMs,
			contractVersion: result.meta?.contractVersion,
			capabilitySchemaVersion: result.meta?.capabilitySchemaVersion,
		};
	}

	return {
		ok: false,
		stage: result.meta?.stage,
		revision: result.session?.revision ?? result.snapshot?.revision,
		dirty: result.session?.dirty ?? result.snapshot?.dirty,
		durationMs: result.meta?.durationMs,
		error: {
			code: result.error?.code ?? 'unknown_error',
			message: result.error?.message ?? 'Unknown backend error.',
			capability: result.error?.capability,
			requiredAdapter: result.error?.requiredAdapter,
			attemptedRevision: result.error?.attemptedRevision,
			lastSavedRevision: result.error?.lastSavedRevision,
			committedPaths: result.error?.committedPaths ?? [],
			failedPaths: result.error?.failedPaths ?? [],
		},
		diagnostics: result.meta?.diagnostics ?? result.diagnostics ?? [],
	};
}

async function readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem) {
	const reader = new ProjectReader(fileSystem);
	const doc = await reader.read(browserFairyPath, { includeBinaryData: true, hydrateResourceBytes: true });
	return liftDocumentToUamProject(doc);
}

async function main() {
	for (const filePath of [coreEntry, coreUamEntry, coreProjectIoEntry, backendEntry]) {
		assert(existsSync(filePath), `Missing OpenFairyGUI entry: ${filePath}`);
	}
	assert(existsSync(sourceProjectPath), `Missing authoring project file: ${sourceProjectPath}`);

	const [
		{ liftDocumentToUamProject },
		{ applyUamTransaction, validateTransactionSupport },
		{ ProjectReader },
		backend,
	] = await Promise.all([
		importFile(coreEntry),
		importFile(coreUamEntry),
		importFile(coreProjectIoEntry),
		importFile(backendEntry),
	]);
	const { BackendRuntime, createBackendStorageFileSystem } = backend;
	assert(typeof BackendRuntime === 'function', 'Backend root does not export BackendRuntime.');
	assert(typeof createBackendStorageFileSystem === 'function', 'Backend root does not export createBackendStorageFileSystem.');

	const storage = new MemoryBrowserStorage();
	storage.importDirectory(sourceProjectDir);
	const fileSystem = createBackendStorageFileSystem(storage);
	const project = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
	const supportIssues = validateTransactionSupport(project, []);
	assert(supportIssues.length === 0, `Transaction support failed with ${supportIssues.length} issue(s).`);

	const target = findPhase8Target(project);
	assert(target, 'No display node target found for Phase 8 browser storage save verification.');
	const groupTarget = findDisplayNodeTarget(project, 'group');
	assert(groupTarget, 'No group node found for Phase 8 browser storage save verification.');
	const groupNode = findDisplayNode(project, groupTarget);
	const groupBefore = {
		layout: Number(groupNode.layout ?? 0),
		lineGap: Number(groupNode.lineGap ?? 0),
		columnGap: Number(groupNode.columnGap ?? 0),
		advanced: groupNode.advanced === true,
		excludeInvisibles: groupNode.excludeInvisibles === true,
		autoSizeDisabled: groupNode.autoSizeDisabled === true,
		mainGridIndex: Number(groupNode.mainGridIndex ?? -1),
	};
	const componentInstanceTarget = findComponentInstanceTarget(project, 'Button');
	assert(componentInstanceTarget, 'No Button component instance found for Phase 8 browser storage save verification.');
	const componentInstanceBefore = cloneJson(
		findDisplayNode(project, componentInstanceTarget).instanceProperties,
	);
	const componentInstanceAfter = {
		...componentInstanceBefore,
		title: `${componentInstanceBefore.title || 'Button'} Phase 8`,
		selectedTitle: `${componentInstanceBefore.selectedTitle || 'Selected'} Phase 8`,
		checked: !componentInstanceBefore.checked,
		soundVolumeScale: componentInstanceBefore.soundVolumeScale === 0.65 ? 0.8 : 0.65,
	};
	const binaryImage = findHydratedMainImage(project);
	const gearTarget = findNonLookGearTarget(project);
	assert(binaryImage, 'No hydrated main-branch image found for Phase 8 binary resource verification.');
	assert(gearTarget, 'No display node/controller pair found for Phase 8 non-look gear verification.');
	const originalImageFileName = binaryImage.resource.fileName ?? binaryImage.resource.file ?? binaryImage.resource.name;
	const originalImageName = binaryImage.resource.name;
	const imageExtension = path.extname(originalImageFileName);
	const renamedImageName = `${originalImageName}-phase8-resource`;
	const renamedImageFileName = imageExtension && !renamedImageName.endsWith(imageExtension)
		? `${renamedImageName}${imageExtension}`
		: renamedImageName;
	const binaryResourceId = `${binaryImage.resource.id}-phase8-binary`;
	const binaryResourceName = 'phase8-browser-storage.bin';
	const binaryResource = {
		kind: 'misc',
		id: binaryResourceId,
		name: binaryResourceName,
		path: '/phase8-contract',
		exported: false,
		branch: '',
		branchItemIds: [],
		file: binaryResourceName,
		metadata: null,
		sourceBytes: new Uint8Array([1, 3, 5, 7]),
	};
	const initialGear = {
		kind: 'xy',
		name: 'phase8-browser-storage-xy',
		controllerName: gearTarget.controllerName,
		states: [{ pageId: gearTarget.pageId, value: { x: gearTarget.node.position.x + 1, y: gearTarget.node.position.y + 2 } }],
		defaultValue: { x: gearTarget.node.position.x, y: gearTarget.node.position.y },
		condition: '',
		positionsInPercent: false,
		tween: false,
		tweenDuration: 0.3,
		tweenDelay: 0,
		easeType: 5,
		customEasePath: '',
	};
	const updatedGear = {
		...initialGear,
		states: [{ pageId: gearTarget.pageId, value: { x: gearTarget.node.position.x + 5, y: gearTarget.node.position.y + 6 } }],
	};
	const before = summarizeNode(findDisplayNode(project, target));
	const selector = {
		packageId: target.packageId,
		componentResourceId: target.componentResourceId,
		displayNodeId: target.displayNodeId,
	};
	const props = {
		position: { x: before.x + 13, y: before.y + 7 },
		size: { width: Math.max(1, before.width + 9), height: Math.max(1, before.height + 3) },
		visible: before.visible,
		text: before.text ? `${before.text}@phase8` : 'Phase 8',
		font: before.font === '微软雅黑' ? '' : '微软雅黑',
		fontSize: Math.max(1, before.fontSize + 2),
		color: before.color.toLowerCase() === '#0099ff' ? '#ff0099' : '#0099ff',
	};
	const operation = {
		opId: 'phase8-browser-storage-save-set-display-node-props',
		kind: 'setDisplayNodeProps',
		selector,
		props,
	};
	const expectedAfter = applyPropsToState(before, props);

	const runtime = new BackendRuntime();
	const opened = runtime.openProjectSession({
		project: cloneJson(project),
		storage: {
			fileSystem,
			fairyPath: browserFairyPath,
			canonicalProjectPath: 'opfs://phase8-browser-storage-save',
			canonicalPathKey: 'opfs://phase8-browser-storage-save',
		},
	});
	assert(opened.ok, `openProjectSession with storage failed: ${JSON.stringify(opened)}`);
	const resourceApplied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: opened.data.revision,
		operations: [
			{
				kind: 'renameResource',
				selector: { packageId: binaryImage.packageId, resourceId: binaryImage.resource.id },
				newName: renamedImageName,
			},
			{
				kind: 'addResource',
				selector: { packageId: binaryImage.packageId },
				resource: binaryResource,
			},
			{
				kind: 'addGear',
				selector: {
					packageId: gearTarget.packageId,
					componentResourceId: gearTarget.componentResourceId,
					displayNodeId: gearTarget.node.id,
					kind: 'xy',
					controllerName: gearTarget.controllerName,
				},
				gear: initialGear,
			},
		],
	});
	assert(resourceApplied.ok, `Binary resource lifecycle applyTransaction failed: ${JSON.stringify(resourceApplied)}`);
	const resourceUpdated = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: resourceApplied.data.revision,
		operations: [
			{
				kind: 'replaceResourceBytes',
				selector: { packageId: binaryImage.packageId, resourceId: binaryResourceId },
				sourceBytes: new Uint8Array([9, 7, 5, 3]),
			},
			{
				kind: 'updateGear',
				selector: {
					packageId: gearTarget.packageId,
					componentResourceId: gearTarget.componentResourceId,
					displayNodeId: gearTarget.node.id,
					kind: 'xy',
					controllerName: gearTarget.controllerName,
				},
				gear: updatedGear,
			},
		],
	});
	assert(resourceUpdated.ok, `Binary resource lifecycle updateTransaction failed: ${JSON.stringify(resourceUpdated)}`);
	const resourceSaved = await runtime.saveSession({
		sessionId: opened.data.sessionId,
		expectedRevision: resourceUpdated.data.revision,
	});
	assert(resourceSaved.ok, `Binary resource lifecycle saveSession failed: ${JSON.stringify(resourceSaved)}`);
	const resourceReloadedProject = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
	const resourceReloadedPackage = resourceReloadedProject.packages?.find((pkg) => pkg.id === binaryImage.packageId);
	const resourceReloadedImage = resourceReloadedPackage?.resources?.find((resource) => resource.id === binaryImage.resource.id);
	const resourceReloadedBinary = resourceReloadedPackage?.resources?.find((resource) => resource.id === binaryResourceId);
	const resourceReloadedComponent = resourceReloadedProject.packages
		?.find((pkg) => pkg.id === gearTarget.packageId)
		?.resources?.find((resource) => resource.id === gearTarget.componentResourceId);
	assert(
		resourceReloadedImage?.kind === 'image'
			&& resourceReloadedBinary?.kind === 'misc'
			&& resourceReloadedComponent?.kind === 'component',
		'Binary resource lifecycle reload did not preserve image, misc resource, and component.',
	);
	const resourceReloadedNode = resourceReloadedComponent.component.displayList.find((node) => node.id === gearTarget.node.id);
	const resourceReloadedGear = resourceReloadedNode?.gears.find((gear) => gear.kind === 'xy' && gear.controllerName === gearTarget.controllerName);
	const resourceReloadOk = resourceReloadedImage.name === renamedImageName
		&& resourceReloadedImage.fileName === renamedImageFileName
		&& Array.from(resourceReloadedBinary.sourceBytes ?? []).join(',') === '9,7,5,3'
		&& resourceReloadedGear?.kind === 'xy'
		&& JSON.stringify(resourceReloadedGear.states) === JSON.stringify(updatedGear.states);
	assert(resourceReloadOk, 'Binary resource lifecycle did not persist through browser storage save/reload.');

	const applied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: resourceSaved.data.revision,
		operations: [operation],
	});
	assert(applied.ok, `applyTransaction failed: ${JSON.stringify(applied)}`);

	const saved = await runtime.saveSession({
		sessionId: opened.data.sessionId,
		expectedRevision: applied.data.revision,
	});
	assert(saved.ok, `saveSession with browser storage adapter failed: ${JSON.stringify(saved)}`);

	const reloadedProject = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
	const reloaded = summarizeNode(findDisplayNode(reloadedProject, target));
	const reloadOk = statesMatch(reloaded, expectedAfter);
	assert(reloadOk, `Reloaded node state did not match expected state: ${JSON.stringify({ reloaded, expectedAfter })}`);

	const commonProps = {
		locked: !reloaded.locked,
		aspect: !reloaded.aspect,
		minSize: { width: reloaded.minSize.width + 1, height: reloaded.minSize.height + 2 },
		maxSize: { width: 900, height: 700 },
		scale: { x: 1.25, y: 0.75 },
		skew: { x: 5, y: 7 },
		touchable: !reloaded.touchable,
		grayed: !reloaded.grayed,
		alpha: reloaded.alpha === 1 ? 0.65 : 1,
		rotation: reloaded.rotation + 15,
		tooltips: 'Phase 8 tooltip',
		blendMode: 'add',
		filter: 'color',
		filterData: '1,0,0,0',
		pivot: {
			x: reloaded.pivotX + 0.125,
			y: reloaded.pivotY + 0.25,
		},
		pivotAsAnchor: !reloaded.pivotAsAnchor,
		customData: reloaded.customData === 'Phase 8 custom data' ? '' : 'Phase 8 custom data',
	};
	const commonPropsOperation = {
		opId: 'phase8-browser-storage-save-common-display-props-boundary',
		kind: 'setDisplayNodeProps',
		selector,
		props: commonProps,
	};
	const commonPropsExpectedAfter = applyPropsToState(reloaded, commonProps);
	const commonPropsApplied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: saved.data.revision,
		operations: [commonPropsOperation],
	});
	assert(commonPropsApplied.ok, `Common display props applyTransaction failed: ${JSON.stringify(commonPropsApplied)}`);
	const commonPropsSaved = await runtime.saveSession({
		sessionId: opened.data.sessionId,
		expectedRevision: commonPropsApplied.data.revision,
	});
	assert(commonPropsSaved.ok, `Common display props saveSession failed: ${JSON.stringify(commonPropsSaved)}`);
	const commonPropsReloadedProject = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
	const commonPropsReloaded = summarizeNode(findDisplayNode(commonPropsReloadedProject, target));
	const commonPropsPersisted = commonPropsMatch(commonPropsReloaded, commonPropsExpectedAfter);
	if (expectCommonPropsPersisted !== undefined) {
		assert(
			commonPropsPersisted === expectCommonPropsPersisted,
			expectCommonPropsPersisted
				? 'Common display props did not persist after save/reload.'
				: 'Common display props unexpectedly persisted after save/reload.',
		);
	}
	const groupAfter = {
		layout: 1,
		lineGap: 4,
		columnGap: 6,
		advanced: true,
		excludeInvisibles: true,
		autoSizeDisabled: true,
		mainGridIndex: 0,
	};
	const groupOperation = {
		opId: 'phase8-browser-storage-save-group-properties',
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: groupTarget.packageId,
			componentResourceId: groupTarget.componentResourceId,
			displayNodeId: groupTarget.displayNodeId,
		},
		props: { groupProperties: groupAfter },
	};
	const groupApplied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: commonPropsSaved.data.revision,
		operations: [groupOperation],
	});
	assert(groupApplied.ok, `Group properties applyTransaction failed: ${JSON.stringify(groupApplied)}`);
	const groupSaved = await runtime.saveSession({
		sessionId: opened.data.sessionId,
		expectedRevision: groupApplied.data.revision,
	});
	assert(groupSaved.ok, `Group properties saveSession failed: ${JSON.stringify(groupSaved)}`);
	const groupReloadedProject = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
	const groupReloaded = findDisplayNode(groupReloadedProject, groupTarget);
	assert(
		Object.entries(groupAfter).every(([key, value]) => groupReloaded?.[key] === value),
		'Group properties did not persist through browser storage save/reload.',
	);
	const groupRestored = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: groupSaved.data.revision,
		operations: [{ ...groupOperation, opId: 'phase8-browser-storage-save-group-properties-undo', props: { groupProperties: groupBefore } }],
	});
	assert(groupRestored.ok, `Group properties inverse failed: ${JSON.stringify(groupRestored)}`);
	const groupRestoreSaved = await runtime.saveSession({
		sessionId: opened.data.sessionId,
		expectedRevision: groupRestored.data.revision,
	});
	assert(groupRestoreSaved.ok, `Restored group properties saveSession failed: ${JSON.stringify(groupRestoreSaved)}`);
	const groupRestoreReloadedProject = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
	const groupRestoreReloaded = findDisplayNode(groupRestoreReloadedProject, groupTarget);
	assert(
		Object.entries(groupBefore).every(([key, value]) => groupRestoreReloaded?.[key] === value),
		'Group property inverse did not persist through browser storage save/reload.',
	);
	const componentInstanceOperation = {
		opId: 'phase8-browser-storage-save-component-instance-properties',
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: componentInstanceTarget.packageId,
			componentResourceId: componentInstanceTarget.componentResourceId,
			displayNodeId: componentInstanceTarget.displayNodeId,
		},
		props: { componentInstanceProperties: componentInstanceAfter },
	};
	const componentInstanceApplied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: groupRestoreSaved.data.revision,
		operations: [componentInstanceOperation],
	});
	assert(
		componentInstanceApplied.ok,
		`Component instance properties applyTransaction failed: ${JSON.stringify(componentInstanceApplied)}`,
	);
	const componentInstanceSaved = await runtime.saveSession({
		sessionId: opened.data.sessionId,
		expectedRevision: componentInstanceApplied.data.revision,
	});
	assert(
		componentInstanceSaved.ok,
		`Component instance properties saveSession failed: ${JSON.stringify(componentInstanceSaved)}`,
	);
	const componentInstanceReloadedProject = await readProjectFromStorage(
		ProjectReader,
		liftDocumentToUamProject,
		fileSystem,
	);
	assert(
		JSON.stringify(
			findDisplayNode(componentInstanceReloadedProject, componentInstanceTarget)?.instanceProperties,
		) === JSON.stringify(componentInstanceAfter),
		'Component instance properties did not persist through browser storage save/reload.',
	);
	const componentInstanceRestored = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: componentInstanceSaved.data.revision,
		operations: [{
			...componentInstanceOperation,
			opId: 'phase8-browser-storage-save-component-instance-properties-undo',
			props: { componentInstanceProperties: componentInstanceBefore },
		}],
	});
	assert(
		componentInstanceRestored.ok,
		`Component instance properties inverse failed: ${JSON.stringify(componentInstanceRestored)}`,
	);
	const componentInstanceRestoreSaved = await runtime.saveSession({
		sessionId: opened.data.sessionId,
		expectedRevision: componentInstanceRestored.data.revision,
	});
	assert(
		componentInstanceRestoreSaved.ok,
		`Component instance properties inverse save failed: ${JSON.stringify(componentInstanceRestoreSaved)}`,
	);
	const componentInstanceRestoreReloadedProject = await readProjectFromStorage(
		ProjectReader,
		liftDocumentToUamProject,
		fileSystem,
	);
	assert(
		JSON.stringify(
			findDisplayNode(componentInstanceRestoreReloadedProject, componentInstanceTarget)?.instanceProperties,
		) === JSON.stringify(componentInstanceBefore),
		'Component instance properties inverse did not restore the browser storage baseline.',
	);
	const {
		prepareAddComboBoxComponent,
		prepareAddPopupMenuComponent,
		prepareAddProgressBarComponent,
		prepareAddScrollBarComponent,
		prepareAddSliderComponent,
		prepareAddWindowFrameComponent,
	} = await importTypeScriptModule('src/editor/commands/PackageComponentTransactions.ts');
	const recipePackageId = componentInstanceRestoreReloadedProject.packages[0].id;
	const componentTemplateRecipes = [
		['ComboBox', prepareAddComboBoxComponent, { name: 'Phase8ComboBox', path: '/' }],
		['ProgressBar', prepareAddProgressBarComponent, { name: 'Phase8ProgressBar', path: '/', titleType: 1, reverse: true }],
		['Slider', prepareAddSliderComponent, { name: 'Phase8Slider', path: '/', orientation: 0, titleType: 1 }],
		['ScrollBar', prepareAddScrollBarComponent, { name: 'Phase8ScrollBar', path: '/', orientation: 0, includeArrows: true }],
		['WindowFrame', prepareAddWindowFrameComponent, { name: 'Phase8WindowFrame', path: '/', titleKind: 'text', includeCloseButton: true }],
		['PopupMenu', prepareAddPopupMenuComponent, { name: 'Phase8PopupMenu', path: '/' }],
	];
	let recipeProject = componentInstanceRestoreReloadedProject;
	const recipeTransactions = componentTemplateRecipes.map(([kind, prepare, input]) => {
		const prepared = prepare(recipeProject, { packageId: recipePackageId }, input);
		assert(prepared.ok, `${kind} recipe preparation failed: ${JSON.stringify(prepared)}`);
		const operations = prepared.transaction.operations ?? [prepared.transaction.operation];
		recipeProject = applyUamTransaction(recipeProject, operations);
		return prepared.transaction;
	});
	const recipeOperations = recipeTransactions.flatMap((transaction) =>
		transaction.operations ?? [transaction.operation]);
	const recipeInverseOperations = [...recipeTransactions].reverse().flatMap((transaction) =>
		transaction.inverseOperations ?? [transaction.inverseOperation]);
	const recipesApplied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: componentInstanceRestoreSaved.data.revision,
		operations: recipeOperations,
	});
	assert(recipesApplied.ok, `Component template recipes apply failed: ${JSON.stringify(recipesApplied)}`);
	const recipesSaved = await runtime.saveSession({
		sessionId: opened.data.sessionId,
		expectedRevision: recipesApplied.data.revision,
	});
	assert(recipesSaved.ok, `Component template recipes save failed: ${JSON.stringify(recipesSaved)}`);
	const recipesReloadedProject = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
	const recipesReloadedPackage = recipesReloadedProject.packages.find((pkg) => pkg.id === recipePackageId);
	const recipeNames = componentTemplateRecipes.map(([, , input]) => input.name);
	assert(
		recipeNames.every((name) => recipesReloadedPackage?.resources.some((resource) => resource.name === name)),
		'Component template recipes did not persist through browser storage save/reload.',
	);
	const recipesRestored = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: recipesSaved.data.revision,
		operations: recipeInverseOperations,
	});
	assert(recipesRestored.ok, `Component template recipe inverse failed: ${JSON.stringify(recipesRestored)}`);
	const recipesRestoreSaved = await runtime.saveSession({
		sessionId: opened.data.sessionId,
		expectedRevision: recipesRestored.data.revision,
	});
	assert(recipesRestoreSaved.ok, `Component template recipe inverse save failed: ${JSON.stringify(recipesRestoreSaved)}`);
	const recipesRestoreReloadedProject = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
	const recipesRestoreReloadedPackage = recipesRestoreReloadedProject.packages.find((pkg) => pkg.id === recipePackageId);
	assert(
		recipeNames.every((name) => !recipesRestoreReloadedPackage?.resources.some((resource) => resource.name === name)),
		'Component template recipe inverse did not restore the browser storage baseline.',
	);
	const resourceRemoved = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: recipesRestoreSaved.data.revision,
		operations: [
			{
				kind: 'renameResource',
				selector: { packageId: binaryImage.packageId, resourceId: binaryImage.resource.id },
				newName: originalImageName,
			},
			{ kind: 'removeResource', selector: { packageId: binaryImage.packageId, resourceId: binaryResourceId } },
			{
				kind: 'removeGear',
				selector: {
					packageId: gearTarget.packageId,
					componentResourceId: gearTarget.componentResourceId,
					displayNodeId: gearTarget.node.id,
					kind: 'xy',
					controllerName: gearTarget.controllerName,
				},
			},
		],
	});
	assert(resourceRemoved.ok, `Binary resource lifecycle removeTransaction failed: ${JSON.stringify(resourceRemoved)}`);
	const resourceRemovedSaved = await runtime.saveSession({
		sessionId: opened.data.sessionId,
		expectedRevision: resourceRemoved.data.revision,
	});
	assert(resourceRemovedSaved.ok, `Binary resource lifecycle cleanup saveSession failed: ${JSON.stringify(resourceRemovedSaved)}`);
	const cleanupReloadedProject = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem);
	const cleanupPackage = cleanupReloadedProject.packages?.find((pkg) => pkg.id === binaryImage.packageId);
	const cleanupImage = cleanupPackage?.resources?.find((resource) => resource.id === binaryImage.resource.id);
	const cleanupBinary = cleanupPackage?.resources?.find((resource) => resource.id === binaryResourceId);
	const cleanupComponent = cleanupReloadedProject.packages
		?.find((pkg) => pkg.id === gearTarget.packageId)
		?.resources?.find((resource) => resource.id === gearTarget.componentResourceId);
	const cleanupNode = cleanupComponent?.kind === 'component'
		? cleanupComponent.component.displayList.find((node) => node.id === gearTarget.node.id)
		: null;
	const resourceCleanupOk = cleanupImage?.kind === 'image'
		&& cleanupImage.name === originalImageName
		&& cleanupBinary === undefined
		&& !cleanupNode?.gears.some((gear) => gear.kind === 'xy' && gear.controllerName === gearTarget.controllerName);
	assert(resourceCleanupOk, 'Binary resource lifecycle cleanup did not persist through browser storage save/reload.');
	const commonPropsFixSource = isWorkspaceSource ? 'source' : 'npm';

	const events = runtime.getEvents({
		sessionId: opened.data.sessionId,
		afterSeq: 0,
		limit: 20,
	});

	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		source: {
			packageName: readJson(backendPackageJsonPath).name,
			packageVersion: readJson(backendPackageJsonPath).version,
			sourceKind: isWorkspaceSource ? 'workspace_source' : 'npm_package',
			packageVersions: readPackageVersions(),
			projectPath: relativePath(sourceProjectPath),
			mode: 'phase8_browser_storage_adapter_save',
			backendContractVersion: backend.BACKEND_CONTRACT_VERSION,
			capabilitySchemaVersion: backend.BACKEND_CAPABILITY_SCHEMA_VERSION,
		},
		storage: {
			kind: 'memory_browser_storage_adapter',
			represents: ['OPFS', 'IndexedDB', 'ZIP virtual filesystem'],
			...storage.summary(),
		},
		target,
		operation,
		commonPropsOperation,
		groupOperation,
		componentInstanceOperation,
		results: {
			readFromStorage: {
				ok: true,
				transactionSupportIssueCount: supportIssues.length,
			},
			openSession: summarizeBackendResult(opened),
			binaryResourceLifecycle: {
				ok: resourceReloadOk && resourceCleanupOk,
				add: summarizeBackendResult(resourceApplied),
				update: summarizeBackendResult(resourceUpdated),
				save: summarizeBackendResult(resourceSaved),
				reload: {
					ok: resourceReloadOk,
					renamedImageName,
					renamedImageFileName,
					binaryResourceId,
					gearKind: updatedGear.kind,
				},
				remove: summarizeBackendResult(resourceRemoved),
				cleanupSave: summarizeBackendResult(resourceRemovedSaved),
				cleanupReload: {
					ok: resourceCleanupOk,
					originalImageName,
				},
			},
			apply: summarizeBackendResult(applied),
			save: summarizeBackendResult(saved),
			reload: {
				ok: reloadOk,
				before,
				expectedAfter,
				reloaded,
			},
			commonPropsSaveBoundary: {
				ok: true,
				apply: summarizeBackendResult(commonPropsApplied),
				save: summarizeBackendResult(commonPropsSaved),
				expectedPersisted: expectCommonPropsPersisted,
				persisted: commonPropsPersisted,
				expectedAfter: commonPropsExpectedAfter,
				reloaded: commonPropsReloaded,
			},
			groupProperties: {
				target: groupTarget,
				before: groupBefore,
				after: groupAfter,
				apply: summarizeBackendResult(groupApplied),
				save: summarizeBackendResult(groupSaved),
				reload: { ok: true },
				inverse: summarizeBackendResult(groupRestored),
				inverseSave: summarizeBackendResult(groupRestoreSaved),
				inverseReload: { ok: true },
			},
			componentInstance: {
				target: componentInstanceTarget,
				before: componentInstanceBefore,
				after: componentInstanceAfter,
				apply: summarizeBackendResult(componentInstanceApplied),
				save: summarizeBackendResult(componentInstanceSaved),
				reload: { ok: true },
				inverse: summarizeBackendResult(componentInstanceRestored),
				inverseSave: summarizeBackendResult(componentInstanceRestoreSaved),
				inverseReload: { ok: true },
			},
			componentTemplateRecipes: {
				names: recipeNames,
				operationCount: recipeOperations.length,
				apply: summarizeBackendResult(recipesApplied),
				save: summarizeBackendResult(recipesSaved),
				reload: { ok: true },
				inverse: summarizeBackendResult(recipesRestored),
				inverseSave: summarizeBackendResult(recipesRestoreSaved),
				inverseReload: { ok: true },
			},
			events: events.ok
				? {
					ok: true,
					kinds: events.data.events.map((event) => event.kind),
				}
				: summarizeBackendResult(events),
		},
		gap: commonPropsPersisted
			? {
				id: 'GAP-20260721-01',
				status: isWorkspaceSource ? 'fixed_in_source' : 'closed_in_npm',
				area: 'OpenFairyGUI materialize/save',
				message:
					`OpenFairyGUI ${commonPropsFixSource} package persists the typed common display-object property surface through browser storage save/reload.`,
			}
			: {
				id: 'GAP-20260721-01',
				status: 'open',
				area: 'OpenFairyGUI materialize/save',
				message:
					'OpenFairyGUI alpha9 accepts touchable, grayed, alpha, and rotation in a browser transaction, but saveSession followed by ProjectReader reload restores their original/default values.',
			},
		diagnostics: [
			...(commonPropsPersisted
				? [{
					severity: 'info',
					code: isWorkspaceSource ? 'GAP-20260721-01_SOURCE_FIXED' : 'GAP-20260721-01_NPM_RELEASE_VERIFIED',
					message:
						`Common display props persisted through browser storage save/reload in the supplied OpenFairyGUI ${commonPropsFixSource} package set.`,
				}]
				: [{
					severity: 'warning',
					code: 'GAP-20260721-01',
					message:
						'Common display props are intentionally excluded from the editor write surface until OpenFairyGUI materializes them through browser storage save/reload.',
				}]),
			{
				severity: 'info',
				code: 'BROWSER_STORAGE_SAVE_VERIFIED',
				message:
					'OpenFairyGUI browser-safe backend accepted an injected async storage adapter and saveSession persisted display and component instance extension transactions into browser-like storage.',
			},
			{
				severity: 'info',
				code: 'NODE_BRIDGE_NOT_USED_FOR_SAVE',
				message:
					'This verification imports the authoring project fixture into memory, then uses @openfairygui/backend root plus createBackendStorageFileSystem for read/apply/save/reload. It does not use @openfairygui/backend/node for Save.',
			},
		],
	};

	mkdirSync(path.dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	console.log(
		JSON.stringify(
			{
				ok: true,
				reportPath: relativePath(reportPath),
				packageVersions: report.source.packageVersions,
				openSessionOk: report.results.openSession.ok,
				applyOk: report.results.apply.ok,
				saveOk: report.results.save.ok,
				reloadOk: report.results.reload.ok,
				binaryResourceLifecycleOk: report.results.binaryResourceLifecycle.ok,
				commonPropsPersisted: report.results.commonPropsSaveBoundary.persisted,
				groupPropertiesSaveReloadOk: report.results.groupProperties.reload.ok && report.results.groupProperties.inverseReload.ok,
				componentInstanceSaveReloadOk: report.results.componentInstance.reload.ok,
				componentTemplateRecipesSaveReloadOk: report.results.componentTemplateRecipes.reload.ok
					&& report.results.componentTemplateRecipes.inverseReload.ok,
				writtenPaths: report.storage.writtenPaths,
				gap: report.gap.id,
			},
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
