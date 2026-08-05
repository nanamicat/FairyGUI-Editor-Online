import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MemoryBrowserStorage } from '../browser-storage-fixture.mjs';
import {
	resolveAuthoringProjectPath,
	resolveOpenFairyGuiModuleRoot,
} from '../project-boundary.mjs';
import { importFile, readJson } from '../verification-helpers.mjs';

const root = process.cwd();
const openfairyguiModuleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const reportPath = path.resolve(
	process.argv[3] ?? 'verification/reports/phase8-clean-materialize-report.json',
);
const sourceProjectPath = resolveAuthoringProjectPath(process.argv[4]);
const browserFairyPath = path.basename(sourceProjectPath);

const corePackageDir = path.join(openfairyguiModuleRoot, 'core');
const backendPackageDir = path.join(openfairyguiModuleRoot, 'backend');
const corePackageJsonPath = path.join(corePackageDir, 'package.json');
const functionsPackageJsonPath = path.join(openfairyguiModuleRoot, 'functions', 'package.json');
const backendPackageJsonPath = path.join(backendPackageDir, 'package.json');
const cliPackageJsonPath = path.join(openfairyguiModuleRoot, 'cli', 'package.json');
const coreEntry = path.join(corePackageDir, 'dist', 'index.js');
const coreNodeEntry = path.join(corePackageDir, 'dist', 'node.js');
const coreProjectIoEntry = path.join(corePackageDir, 'dist', 'project-io.js');
const backendEntry = path.join(backendPackageDir, 'dist', 'index.mjs');

function cloneJson(value) {
	return JSON.parse(JSON.stringify(value));
}

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

function summarizeBackendResult(result) {
	if (result.ok) {
		return {
			ok: true,
			stage: result.meta?.stage,
			revision: result.data?.revision,
			dirty: result.data?.dirty,
			lastSavedRevision: result.data?.lastSavedRevision,
			materializeRevision: result.data?.materializeRevision,
			saveRevision: result.data?.saveRevision,
			writtenPaths: result.data?.writtenPaths ?? [],
			skippedPaths: result.data?.skippedPaths ?? [],
			durationMs: result.meta?.durationMs,
			contractVersion: result.meta?.contractVersion,
			capabilitySchemaVersion: result.meta?.capabilitySchemaVersion,
			diagnostics: result.data?.diagnostics ?? result.meta?.diagnostics ?? [],
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
			attemptedRevision: result.error?.attemptedRevision,
			lastSavedRevision: result.error?.lastSavedRevision,
		},
		diagnostics: result.meta?.diagnostics ?? result.diagnostics ?? [],
	};
}

async function readProjectFromStorage(ProjectReader, liftDocumentToUamProject, fileSystem) {
	const reader = new ProjectReader(fileSystem);
	const doc = await reader.read(browserFairyPath);
	return liftDocumentToUamProject(doc);
}

function makeBrowserStorageSession(BackendRuntime, createBackendStorageFileSystem, project, canonicalPathKey) {
	const storage = new MemoryBrowserStorage();
	const fileSystem = createBackendStorageFileSystem(storage);
	const runtime = new BackendRuntime();
	const opened = runtime.openProjectSession({
		project: cloneJson(project),
		storage: {
			fileSystem,
			fairyPath: browserFairyPath,
			canonicalProjectPath: canonicalPathKey,
			canonicalPathKey,
		},
	});
	assert(opened.ok, `openProjectSession with empty browser storage failed: ${JSON.stringify(opened)}`);
	return { runtime, storage, fileSystem, opened };
}

function propertyOverrideSnapshot(project) {
	const resource = project.packages[0]?.resources.find((candidate) => candidate.id === 'main1');
	assert.equal(resource?.kind, 'component', 'Property override fixture Main component is missing.');
	const list = resource.component.displayList.find((node) => node.id === 'list1');
	const instance = resource.component.displayList.find((node) => node.id === 'instance1');
	assert.equal(list?.kind, 'list', 'Property override fixture list is missing.');
	assert.equal(instance?.kind, 'component', 'Property override fixture component instance is missing.');
	return {
		listItemOverrides: list.listItems[0]?.propertyOverrides,
		instanceOverrides: instance.propertyOverrides,
	};
}

async function verifyPropertyOverrideWhitespace(
	ProjectReader,
	liftDocumentToUamProject,
	BackendRuntime,
	createBackendStorageFileSystem,
) {
	const fairyPath = 'Overrides.fairy';
	const sourceStorage = new MemoryBrowserStorage();
	await Promise.all([
		sourceStorage.writeFile(fairyPath, '<?xml version="1.0" encoding="utf-8"?>\n<projectDescription id="property-overrides" type="Unity" version="3.0"/>\n'),
		sourceStorage.writeFile('assets/Overrides/package.xml', '<?xml version="1.0" encoding="utf-8"?>\n<packageDescription id="pkgoverrides"><resources><component id="main1" name="Main.xml" path="/" exported="true"/><component id="template1" name="Template.xml" path="/" exported="true"/></resources></packageDescription>\n'),
		sourceStorage.writeFile('assets/Overrides/Main.xml', '<?xml version="1.0" encoding="utf-8"?>\n<component size="640,480"><displayList><list id="list1"><item title="First"><property target="title" propertyId="0" value="  First override  "/><property target="space" propertyId="1" value=" "/><property target="empty" propertyId="2" value=""/></item></list><component id="instance1" src="template1"><property target="title" propertyId="0" value=" Instance override "/><property target="space" propertyId="1" value=" "/><property target="empty" propertyId="2" value=""/></component></displayList></component>\n'),
		sourceStorage.writeFile('assets/Overrides/Template.xml', '<?xml version="1.0" encoding="utf-8"?>\n<component size="100,40"/>\n'),
	]);
	const expected = {
		listItemOverrides: [
			{ target: 'title', propertyId: 0, value: '  First override  ' },
			{ target: 'space', propertyId: 1, value: ' ' },
			{ target: 'empty', propertyId: 2, value: '' },
		],
		instanceOverrides: [
			{ target: 'title', propertyId: 0, value: ' Instance override ' },
			{ target: 'space', propertyId: 1, value: ' ' },
			{ target: 'empty', propertyId: 2, value: '' },
		],
	};
	const sourceFileSystem = createBackendStorageFileSystem(sourceStorage);
	const sourceProject = liftDocumentToUamProject(await new ProjectReader(sourceFileSystem).read(fairyPath));
	assert.deepEqual(propertyOverrideSnapshot(sourceProject), expected);

	const outputStorage = new MemoryBrowserStorage();
	const outputFileSystem = createBackendStorageFileSystem(outputStorage);
	const runtime = new BackendRuntime();
	const opened = runtime.openProjectSession({
		project: cloneJson(sourceProject),
		storage: {
			fileSystem: outputFileSystem,
			fairyPath,
			canonicalProjectPath: 'opfs://phase8-property-override-whitespace',
			canonicalPathKey: 'opfs://phase8-property-override-whitespace',
		},
	});
	assert(opened.ok, `Property override fixture open failed: ${JSON.stringify(opened)}`);
	const saved = await runtime.saveSession({
		sessionId: opened.data.sessionId,
		expectedRevision: opened.data.revision,
		mode: 'materializeCleanSession',
	});
	assert(saved.ok, `Property override fixture save failed: ${JSON.stringify(saved)}`);
	const reloaded = liftDocumentToUamProject(await new ProjectReader(outputFileSystem).read(fairyPath));
	assert.deepEqual(propertyOverrideSnapshot(reloaded), expected);
	const outputXml = await outputStorage.readFile('assets/Overrides/Main.xml');
	for (const value of ['value="  First override  "', 'value=" Instance override "', 'value=" "', 'value=""']) {
		assert(outputXml.includes(value), `Saved property override XML lost ${value}.`);
	}
	return {
		ok: true,
		hosts: ['component-instance', 'list-item'],
		values: ['leading-and-trailing', 'single-space', 'empty-string'],
		save: summarizeBackendResult(saved),
		reload: true,
	};
}

async function main() {
	for (const filePath of [coreEntry, coreNodeEntry, coreProjectIoEntry, backendEntry]) {
		assert(existsSync(filePath), `Missing OpenFairyGUI entry: ${filePath}`);
	}
	assert(existsSync(sourceProjectPath), `Missing authoring project file: ${sourceProjectPath}`);

	const [
		{ NodeIO },
		{ liftDocumentToUamProject },
		{ ProjectReader },
		backend,
	] = await Promise.all([
		importFile(coreNodeEntry),
		importFile(coreEntry),
		importFile(coreProjectIoEntry),
		importFile(backendEntry),
	]);
	const { BackendRuntime, createBackendStorageFileSystem } = backend;
	assert(typeof BackendRuntime === 'function', 'Backend root does not export BackendRuntime.');
	assert(typeof createBackendStorageFileSystem === 'function', 'Backend root does not export createBackendStorageFileSystem.');

	const io = new NodeIO();
	const doc = await io.readProject(sourceProjectPath);
	const project = liftDocumentToUamProject(doc);
	assert(project?.packages?.length > 0, 'liftDocumentToUamProject did not return packages.');

	const materializeSessionApi = typeof BackendRuntime.prototype.materializeSession === 'function';
	assert(materializeSessionApi, 'BackendRuntime does not expose materializeSession.');

	const direct = makeBrowserStorageSession(
		BackendRuntime,
		createBackendStorageFileSystem,
		project,
		'opfs://phase8-clean-materialize-direct',
	);
	const cleanSaved = await direct.runtime.saveSession({
		sessionId: direct.opened.data.sessionId,
		expectedRevision: direct.opened.data.revision,
	});
	const projectFileBeforeMaterialize = await direct.storage.exists(browserFairyPath);
	assert(cleanSaved.ok, `clean saveSession returned failure: ${JSON.stringify(cleanSaved)}`);
	assert(!projectFileBeforeMaterialize, 'Plain clean saveSession unexpectedly wrote the project file.');

	const materialized = await direct.runtime.materializeSession({
		sessionId: direct.opened.data.sessionId,
		expectedRevision: direct.opened.data.revision,
		mode: 'fullProject',
		reason: 'workspace_bootstrap',
	});
	assert(materialized.ok, `materializeSession failed: ${JSON.stringify(materialized)}`);
	assert(await direct.storage.exists(browserFairyPath), 'materializeSession did not write the project file.');
	assert(materialized.data.revision === direct.opened.data.revision, 'materializeSession changed the session revision.');
	assert(materialized.data.dirty === false, 'materializeSession left the session dirty.');

	const reloadedProject = await readProjectFromStorage(ProjectReader, liftDocumentToUamProject, direct.fileSystem);
	assert(reloadedProject?.packages?.length === project.packages.length, 'Reloaded project package count changed after materializeSession.');

	const force = makeBrowserStorageSession(
		BackendRuntime,
		createBackendStorageFileSystem,
		project,
		'opfs://phase8-clean-materialize-force',
	);
	const forceSaved = await force.runtime.saveSession({
		sessionId: force.opened.data.sessionId,
		expectedRevision: force.opened.data.revision,
		force: true,
	});
	assert(forceSaved.ok, `force saveSession failed: ${JSON.stringify(forceSaved)}`);
	assert(await force.storage.exists(browserFairyPath), 'force saveSession did not write the project file.');

	const mode = makeBrowserStorageSession(
		BackendRuntime,
		createBackendStorageFileSystem,
		project,
		'opfs://phase8-clean-materialize-mode',
	);
	const modeSaved = await mode.runtime.saveSession({
		sessionId: mode.opened.data.sessionId,
		expectedRevision: mode.opened.data.revision,
		mode: 'materializeCleanSession',
	});
	assert(modeSaved.ok, `materializeCleanSession saveSession failed: ${JSON.stringify(modeSaved)}`);
	assert(await mode.storage.exists(browserFairyPath), 'materializeCleanSession saveSession did not write the project file.');
	const propertyOverrideWhitespace = await verifyPropertyOverrideWhitespace(
		ProjectReader,
		liftDocumentToUamProject,
		BackendRuntime,
		createBackendStorageFileSystem,
	);

	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		source: {
			packageName: readJson(backendPackageJsonPath).name,
			packageVersion: readJson(backendPackageJsonPath).version,
			packageVersions: readPackageVersions(),
			projectPath: relativePath(sourceProjectPath),
			mode: 'phase8_clean_session_materialize',
			backendContractVersion: backend.BACKEND_CONTRACT_VERSION,
			capabilitySchemaVersion: backend.BACKEND_CAPABILITY_SCHEMA_VERSION,
		},
		api: {
			materializeSession: materializeSessionApi,
			saveSessionForce: true,
			saveSessionMode: 'materializeCleanSession',
		},
		baseline: {
			packageCount: project.packages.length,
			browserFairyPath,
		},
		results: {
			openSession: summarizeBackendResult(direct.opened),
			plainCleanSave: {
				...summarizeBackendResult(cleanSaved),
				projectFileExistsAfterSave: projectFileBeforeMaterialize,
			},
			materializeSession: {
				...summarizeBackendResult(materialized),
				storage: direct.storage.summary(),
			},
			forceSave: {
				...summarizeBackendResult(forceSaved),
				storage: force.storage.summary(),
			},
			materializeCleanSessionSave: {
				...summarizeBackendResult(modeSaved),
				storage: mode.storage.summary(),
			},
			propertyOverrideWhitespace,
			reload: {
				ok: true,
				packageCount: reloadedProject.packages.length,
			},
		},
		gap: null,
		diagnostics: [
			{
				severity: 'info',
				code: 'PHASE8_CLEAN_MATERIALIZE_VERIFIED',
				message:
					'OpenFairyGUI can materialize a clean browser project session into an empty async storage workspace without a synthetic transaction.',
			},
			{
				severity: 'info',
				code: 'WORKSPACE_BOOTSTRAP_HACK_CAN_BE_REMOVED',
				message:
					'The project should prefer materializeSession, saveSession(force), or saveSession(mode=materializeCleanSession) over the alpha7 no-op transaction bootstrap fallback.',
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
				materializeSessionOk: report.results.materializeSession.ok,
				forceSaveOk: report.results.forceSave.ok,
				materializeCleanSessionSaveOk: report.results.materializeCleanSessionSave.ok,
				propertyOverrideWhitespaceOk: report.results.propertyOverrideWhitespace.ok,
				reloadOk: report.results.reload.ok,
				plainCleanSaveProjectFileExists: report.results.plainCleanSave.projectFileExistsAfterSave,
				gap: report.gap,
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
