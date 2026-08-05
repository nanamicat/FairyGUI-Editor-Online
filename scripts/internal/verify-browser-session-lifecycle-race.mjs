import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { MemoryBrowserStorage } from '../browser-storage-fixture.mjs';
import { resolveAuthoringProjectPath } from '../project-boundary.mjs';

const root = process.cwd();
const baseline = JSON.parse(await readFile(
	path.join(root, 'assets/resources/editor/runtime/uam-baseline.json'),
	'utf8',
));
for (const pkg of baseline.uamProject.packages ?? []) {
	for (const resource of pkg.resources ?? []) {
		const encoded = resource.sourceBytes;
		if (encoded?.encoding === 'base64') resource.sourceBytes = new Uint8Array(Buffer.from(encoded.data, 'base64'));
	}
}

const backend = await import(pathToFileURL(
	path.join(root, 'assets/resources/editor/runtime/openfairygui-backend-browser.js'),
).href);
const fidelityStorage = new MemoryBrowserStorage();
const fidelityProjectPath = resolveAuthoringProjectPath();
fidelityStorage.importDirectory(path.dirname(fidelityProjectPath));
const fidelityFileSystem = backend.createBackendStorageFileSystem(fidelityStorage);
const fidelityDocument = await new backend.ProjectReader(fidelityFileSystem).read(path.basename(fidelityProjectPath), {
	hydrateResourceBytes: true,
});
const fidelityProject = backend.liftDocumentToUamProject(fidelityDocument);
let fidelityTarget = null;
for (const pkg of fidelityProject.packages ?? []) {
	for (const resource of pkg.resources ?? []) {
		const node = resource.component?.displayList?.find((candidate) => candidate.id && candidate.position);
		if (!node) continue;
		fidelityTarget = { pkg, resource, node };
		break;
	}
	if (fidelityTarget) break;
}
assert(fidelityTarget, 'Expected a display node target for browser source-fidelity verification.');
const fidelityRuntime = new backend.BackendRuntime({ fileSystem: fidelityFileSystem });
const fidelityOpened = await fidelityRuntime.openSession({ projectPath: '.' });
assert.equal(fidelityOpened.ok, true, JSON.stringify(fidelityOpened));
assert.equal(fidelityOpened.data.uamFidelity, 'unsupported');
const fidelityApplied = await fidelityRuntime.applyTransaction({
	sessionId: fidelityOpened.data.sessionId,
	expectedRevision: fidelityOpened.data.revision,
	operations: [{
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: fidelityTarget.pkg.id,
			componentResourceId: fidelityTarget.resource.id,
			displayNodeId: fidelityTarget.node.id,
		},
		props: {
			position: {
				x: fidelityTarget.node.position.x + 1,
				y: fidelityTarget.node.position.y,
			},
		},
	}],
});
assert.equal(fidelityApplied.ok, true, JSON.stringify(fidelityApplied));
const fidelityBeforeWrites = fidelityStorage.snapshot();
const fidelitySave = await fidelityRuntime.saveSession({
	sessionId: fidelityOpened.data.sessionId,
	expectedRevision: fidelityApplied.data.revision,
});
assert.equal(fidelitySave.ok, false);
assert.equal(fidelitySave.error.code, 'uam_fidelity_unsupported');
assert.deepEqual(fidelitySave.error.committedPaths ?? [], []);
assert.deepEqual(fidelityStorage.snapshot(), fidelityBeforeWrites);
const fidelityMaterialize = await fidelityRuntime.materializeSession({
	sessionId: fidelityOpened.data.sessionId,
	expectedRevision: fidelityApplied.data.revision,
	mode: 'fullProject',
	reason: 'browser_source_fidelity_verification',
});
assert.equal(fidelityMaterialize.ok, false);
assert.equal(fidelityMaterialize.error.code, 'uam_fidelity_unsupported');
assert.deepEqual(fidelityMaterialize.error.committedPaths ?? [], []);
assert.deepEqual(fidelityStorage.snapshot(), fidelityBeforeWrites);
await fidelityRuntime.closeSession({ sessionId: fidelityOpened.data.sessionId });
const fullStorage = new MemoryBrowserStorage();
const fullFileSystem = backend.createBackendStorageFileSystem(fullStorage);
const fullBootstrapRuntime = new backend.BackendRuntime();
const fullBootstrap = fullBootstrapRuntime.openProjectSession({
	project: structuredClone(baseline.uamProject),
	storage: { fileSystem: fullFileSystem, fairyPath: 'VerifiedProject.fairy' },
});
assert.equal(fullBootstrap.ok, true, JSON.stringify(fullBootstrap));
const fullMaterialized = await fullBootstrapRuntime.materializeSession({
	sessionId: fullBootstrap.data.sessionId,
	expectedRevision: fullBootstrap.data.revision,
	mode: 'fullProject',
	reason: 'browser_full_fidelity_bootstrap',
});
assert.equal(fullMaterialized.ok, true, JSON.stringify(fullMaterialized));
await fullBootstrapRuntime.closeSession({ sessionId: fullBootstrap.data.sessionId });
const fullRuntime = new backend.BackendRuntime({ fileSystem: fullFileSystem });
const fullOpened = await fullRuntime.openSession({ projectPath: '.' });
assert.equal(fullOpened.ok, true, JSON.stringify(fullOpened));
assert.equal(fullOpened.data.uamFidelity, 'full');
const fullTargetNode = baseline.uamProject.packages
	.find((pkg) => pkg.id === baseline.target.packageId)?.resources
	.find((resource) => resource.id === baseline.target.componentResourceId)?.component?.displayList
	.find((candidate) => candidate.id === baseline.target.displayNodeId);
assert(fullTargetNode, 'Phase 7 baseline target is missing for full-fidelity save verification.');
const fullExpectedX = fullTargetNode.position.x + 2;
const fullApplied = await fullRuntime.applyTransaction({
	sessionId: fullOpened.data.sessionId,
	expectedRevision: fullOpened.data.revision,
	operations: [{
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: baseline.target.packageId,
			componentResourceId: baseline.target.componentResourceId,
			displayNodeId: baseline.target.displayNodeId,
		},
		props: { position: { x: fullExpectedX, y: fullTargetNode.position.y } },
	}],
});
assert.equal(fullApplied.ok, true, JSON.stringify(fullApplied));
const fullSaved = await fullRuntime.saveSession({
	sessionId: fullOpened.data.sessionId,
	expectedRevision: fullApplied.data.revision,
});
assert.equal(fullSaved.ok, true, JSON.stringify(fullSaved));
const fullReloadedDocument = await new backend.ProjectReader(fullFileSystem).read('VerifiedProject.fairy', {
	hydrateResourceBytes: true,
});
const fullReloadedProject = backend.liftDocumentToUamProject(fullReloadedDocument);
const fullReloadedNode = fullReloadedProject.packages
	.find((pkg) => pkg.id === baseline.target.packageId)?.resources
	.find((resource) => resource.id === baseline.target.componentResourceId)?.component?.displayList
	.find((candidate) => candidate.id === baseline.target.displayNodeId);
assert.equal(fullReloadedNode?.position.x, fullExpectedX);
await fullRuntime.closeSession({ sessionId: fullOpened.data.sessionId });
const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true } });
try {
	const { BrowserLiveSessionBridge } = await vite.ssrLoadModule('/src/editor/services/BrowserLiveSessionBridge.ts');
	const unreadableWorkspaceBridge = new BrowserLiveSessionBridge({
		getAdapter: () => ({ exists: async () => true }),
		getFairyPath: () => 'UnreadableProject.fairy',
	});
	await assert.rejects(
		unreadableWorkspaceBridge.resolveSessionProject(
			baseline,
			{
				ProjectReader: class {
					async read() {
						throw new Error('unreadable browser project');
					}
				},
				liftDocumentToUamProject: () => ({}),
			},
			{ fileSystem: {}, fairyPath: 'UnreadableProject.fairy' },
			{ generation: 0, runtime: null, sessionId: '', revision: 0 },
		),
		/unreadable browser project/,
		'An existing project whose fidelity cannot be established must not fall back to authoritative UAM bootstrap.',
	);
	const runtime = new backend.BackendRuntime();
	const opened = runtime.openProjectSession({
		project: structuredClone(baseline.uamProject),
		canonicalProjectPath: 'memory://browser-session-lifecycle-race',
	});
	assert.equal(opened.ok, true, JSON.stringify(opened));

	let markApplyStarted;
	const applyStarted = new Promise((resolve) => {
		markApplyStarted = resolve;
	});
	let releaseApply;
	const applyGate = new Promise((resolve) => {
		releaseApply = resolve;
	});
	const realApply = runtime.applyTransaction.bind(runtime);
	runtime.applyTransaction = async (input) => {
		markApplyStarted();
		await applyGate;
		return await realApply(input);
	};

	const bridge = new BrowserLiveSessionBridge();
	Object.assign(bridge, {
		status: 'connected',
		runtime,
		backendModule: backend,
		sessionId: opened.data.sessionId,
		revision: opened.data.revision,
		dirty: opened.data.dirty,
		workingProject: structuredClone(baseline.uamProject),
		projectSource: 'uam_baseline',
	});
	const interactionIdentity = bridge.captureSessionIdentity();
	assert(interactionIdentity, 'Connected bridge must expose a live session identity.');
	assert.equal(bridge.isSessionIdentityCurrent(interactionIdentity), true);
	Object.assign(bridge, { revision: interactionIdentity.revision + 1 });
	assert.equal(bridge.isSessionIdentityCurrent(interactionIdentity), false, 'Revision changes must invalidate interaction identity.');
	Object.assign(bridge, { revision: interactionIdentity.revision });
	assert.equal(bridge.isSessionIdentityCurrent(interactionIdentity), true);
	const pngImages = baseline.uamProject.packages.flatMap((pkg) => pkg.resources.flatMap((resource) => (
		resource.kind === 'image'
			&& resource.fileName?.toLowerCase().endsWith('.png')
			&& resource.sourceBytes instanceof Uint8Array
			? [{ pkg, resource }]
			: []
	)));
	assert.ok(pngImages.length >= 2, 'Expected two hydrated PNG resources for inverse preflight.');
	const imageTarget = pngImages[0];
	const imageDonor = pngImages[1];
	const byteSelector = { packageId: imageTarget.pkg.id, resourceId: imageTarget.resource.id };
	const invalidInverse = await bridge.applyTransaction([{
		kind: 'replaceResourceBytes',
		selector: byteSelector,
		sourceBytes: new Uint8Array(imageDonor.resource.sourceBytes),
	}], opened.data.revision, [{
		kind: 'replaceResourceBytes',
		selector: byteSelector,
		sourceBytes: new Uint8Array([1, 2, 3]),
	}]);
	assert.equal(invalidInverse.ok, false, 'Invalid byte replacement inverse must fail before backend apply.');
	assert.equal(invalidInverse.error?.code, 'uam_snapshot_apply_failed');
	assert.equal(
		runtime.getSession({ sessionId: opened.data.sessionId }).data.revision,
		opened.data.revision,
		'Inverse preflight failure must leave the backend revision unchanged.',
	);
	assert.equal(
		bridge.isSessionIdentityCurrent(interactionIdentity),
		true,
		'A rejected transaction must not invalidate the captured interaction identity.',
	);
	const node = baseline.uamProject.packages
		.find((pkg) => pkg.id === baseline.target.packageId)?.resources
		.find((resource) => resource.id === baseline.target.componentResourceId)?.component?.displayList
		.find((candidate) => candidate.id === baseline.target.displayNodeId);
	assert.ok(node, 'Phase 7 baseline target is missing.');

	const applying = bridge.applyTransaction([{
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: baseline.target.packageId,
			componentResourceId: baseline.target.componentResourceId,
			displayNodeId: baseline.target.displayNodeId,
		},
		props: { position: { x: node.position.x + 1, y: node.position.y } },
	}], opened.data.revision);
	await applyStarted;
	const resetting = bridge.reset();
	assert.equal(
		bridge.isSessionIdentityCurrent(interactionIdentity),
		false,
		'Reset must invalidate a captured interaction identity before waiting for in-flight work.',
	);
	let resetSettled = false;
	void resetting.then(() => {
		resetSettled = true;
	});
	await Promise.resolve();
	assert.equal(resetSettled, false, 'reset must wait for the in-flight transaction.');

	releaseApply();
	const applied = await applying;
	assert.equal(applied.ok, false, 'an operation invalidated by reset must not report success');
	assert.equal(applied.error?.code, 'live_session_reset');
	const reset = await resetting;
	assert.deepEqual(reset, { ok: true });
	assert.equal(bridge.getState().status, 'idle');
	assert.equal(runtime.getSession({ sessionId: opened.data.sessionId }).ok, false);

	let markSaveStarted;
	const saveStarted = new Promise((resolve) => {
		markSaveStarted = resolve;
	});
	let releaseSave;
	const saveGate = new Promise((resolve) => {
		releaseSave = resolve;
	});
	const saveRuntime = {
		saveSession: async () => {
			markSaveStarted();
			await saveGate;
			return { ok: true, data: { revision: 7, dirty: false } };
		},
		getEvents: () => ({ ok: true, data: { events: [] } }),
	};
	const saveBridge = new BrowserLiveSessionBridge();
	Object.assign(saveBridge, {
		status: 'connected',
		runtime: saveRuntime,
		sessionId: 'save-race-session',
		revision: 7,
		dirty: true,
		fileSystem: {},
	});
	const saving = saveBridge.saveWorkspace();
	await saveStarted;
	Object.assign(saveBridge, { revision: 8, dirty: true });
	releaseSave();
	const staleSave = await saving;
	assert.equal(staleSave.save.ok, false, 'An old save result must not succeed after a newer revision appears.');
	assert.equal(staleSave.save.errorCode, 'live_session_stale');
	assert.equal(saveBridge.getState().revision, 8, 'An old save result must not overwrite the newer revision.');
	assert.equal(saveBridge.getState().dirty, true, 'An old save result must not mark the newer revision clean.');

	let markPublishReadStarted;
	const publishReadStarted = new Promise((resolve) => {
		markPublishReadStarted = resolve;
	});
	let releasePublishRead;
	const publishReadGate = new Promise((resolve) => {
		releasePublishRead = resolve;
	});
	let publishCalls = 0;
	let manifestWrites = 0;
	const publishAdapter = {
		exists: async () => true,
		writeFile: async () => {
			manifestWrites += 1;
		},
	};
	const publishStorage = {
		getAdapter: () => publishAdapter,
		getFairyPath: () => 'PublishRace.fairy',
	};
	const publishRuntime = {};
	const publishBridge = new BrowserLiveSessionBridge(publishStorage);
	Object.assign(publishBridge, {
		status: 'connected',
		runtime: publishRuntime,
		backendModule: {
			ProjectReader: class {
				async read() {
					markPublishReadStarted();
					await publishReadGate;
					return {};
				}
			},
			publishBrowser: async () => {
				publishCalls += 1;
				return { success: true, files: [], diagnostics: [] };
			},
		},
		fileSystem: {},
		sessionId: 'publish-race-session',
		revision: 11,
		dirty: false,
	});
	const publishing = publishBridge.publishRuntimeBundle({ project: { id: 'publish-race-project' }, packages: [] });
	await publishReadStarted;
	Object.assign(publishBridge, { revision: 12, dirty: true });
	releasePublishRead();
	await assert.rejects(
		publishing,
		(error) => error?.code === 'live_session_stale',
		'A publish based on an old revision must fail with the stable stale-session code.',
	);
	assert.equal(publishCalls, 0, 'Stale publish must stop before writing runtime files.');
	assert.equal(manifestWrites, 0, 'Stale publish must not write a manifest.');
	assert.equal(publishBridge.getState().revision, 12);
	assert.equal(publishBridge.getState().dirty, true);

	console.log(JSON.stringify({
		ok: true,
		backendVersion: baseline.source.packageVersion,
		uamFidelity: fidelityOpened.data.uamFidelity,
		fidelitySaveGuard: fidelitySave.error.code,
		fidelityMaterializeGuard: fidelityMaterialize.error.code,
		fidelityStorageUnchanged: true,
		fullFidelity: fullOpened.data.uamFidelity,
		fullSaveReload: true,
		unreadableWorkspaceRejected: true,
		invalidInverseRejected: true,
		inFlightResult: applied.error?.code,
		resetWaited: true,
		interactionIdentityInvalidated: true,
		revisionIdentityInvalidated: true,
		sessionClosed: true,
		staleSaveRejected: true,
		stalePublishRejected: true,
	}));
} finally {
	await vite.close();
}
