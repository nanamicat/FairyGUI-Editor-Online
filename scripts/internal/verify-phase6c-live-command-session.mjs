import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	resolveAuthoringProjectPath,
	resolveOpenFairyGuiModuleRoot,
} from '../project-boundary.mjs';
import { findDisplayNode, importFile, readJson } from '../verification-helpers.mjs';

const openfairyguiModuleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const outputPath = path.resolve(
	process.argv[3] ?? 'verification/reports/phase6c-live-session-report.json',
);
const projectPath = resolveAuthoringProjectPath(process.argv[4]);
const corePackageDir = path.join(openfairyguiModuleRoot, 'core');
const backendPackageDir = path.join(openfairyguiModuleRoot, 'backend');
const coreNodeEntry = path.join(corePackageDir, 'dist', 'node.js');
const coreEntry = path.join(corePackageDir, 'dist', 'index.js');
const coreUamEntry = path.join(corePackageDir, 'dist', 'uam', 'index.js');
const backendEntry = path.join(backendPackageDir, 'dist', 'index.mjs');

function cloneJson(value) {
	return JSON.parse(JSON.stringify(value));
}

function findPhase6Target(project) {
	const basicPackage = project.packages?.find((pkg) => pkg.name === 'Basic');
	const button = basicPackage?.resources?.find((resource) => resource.name === 'Button');
	const title = button?.component?.displayList?.find((node) => node.name === 'title' && node.id);
	if (basicPackage && button && title) {
		return buildTarget(basicPackage, button, title);
	}

	for (const pkg of project.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			for (const node of resource.component?.displayList ?? []) {
				if (node.kind === 'text' && node.id) return buildTarget(pkg, resource, node);
			}
		}
	}

	return null;
}

function buildTarget(pkg, resource, node) {
	return {
		packageId: pkg.id,
		packageName: pkg.name ?? '',
		componentResourceId: resource.id,
		componentName: resource.name ?? '',
		displayNodeId: node.id,
		displayNodeName: node.name ?? node.id,
	};
}

function summarizeNode(node) {
	return {
		id: String(node.id ?? ''),
		name: String(node.name ?? node.id ?? ''),
		type: String(node.kind ?? ''),
		x: Number(node.position?.x ?? 0),
		y: Number(node.position?.y ?? 0),
		width: Number(node.size?.width ?? 0),
		height: Number(node.size?.height ?? 0),
		text: String(node.text ?? ''),
		visible: node.visible !== false,
	};
}

function summarizeResult(result) {
	if (result.ok) {
		return {
			ok: true,
			stage: result.meta?.stage,
			revision: result.data?.revision,
			dirty: result.data?.dirty,
			durationMs: result.meta?.durationMs,
			contractVersion: result.meta?.contractVersion,
			capabilitySchemaVersion: result.meta?.capabilitySchemaVersion,
		};
	}

	return {
		ok: false,
		stage: result.meta?.stage,
		revision: result.session?.revision ?? result.snapshot?.revision,
		durationMs: result.meta?.durationMs,
		error: {
			code: result.error?.code ?? 'unknown_error',
			message: result.error?.message ?? 'Unknown backend error.',
			expectedRevision: result.error?.expectedRevision,
			actualRevision: result.error?.actualRevision,
			opIndex: result.error?.opIndex,
			opKind: result.error?.opKind,
			issues: result.error?.issues ?? [],
			capability: result.error?.capability,
			requiredAdapter: result.error?.requiredAdapter,
		},
		diagnostics: result.meta?.diagnostics ?? result.diagnostics ?? [],
	};
}

function writeReport(report) {
	mkdirSync(path.dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
	for (const filePath of [coreNodeEntry, coreEntry, coreUamEntry, backendEntry]) {
		assert(existsSync(filePath), `Missing OpenFairyGUI entry: ${filePath}`);
	}
	assert(existsSync(projectPath), `Missing authoring project file: ${projectPath}`);

	const packageJson = readJson(path.join(backendPackageDir, 'package.json'));
	const [
		{ NodeIO },
		{ liftDocumentToUamProject },
		{ validateTransactionSupport, applyUamTransaction },
		{ BackendRuntime, BACKEND_CONTRACT_VERSION, BACKEND_CAPABILITY_SCHEMA_VERSION },
	] = await Promise.all([
		importFile(coreNodeEntry),
		importFile(coreEntry),
		importFile(coreUamEntry),
		importFile(backendEntry),
	]);

	const io = new NodeIO();
	const doc = await io.readProject(projectPath);
	const project = liftDocumentToUamProject(doc);
	const supportIssues = validateTransactionSupport(project, []);
	assert(
		supportIssues.length === 0,
		`Authoring project transaction support failed with ${supportIssues.length} issue(s).`,
	);

	const target = findPhase6Target(project);
	assert(target, 'No display node target found for Phase 6C live command session verification.');

	const beforeNode = summarizeNode(findDisplayNode(project, target));
	const selector = {
		packageId: target.packageId,
		componentResourceId: target.componentResourceId,
		displayNodeId: target.displayNodeId,
	};
	const operation = {
		opId: 'phase6c-live-session-set-display-node-props',
		kind: 'setDisplayNodeProps',
		selector,
		props: {
			position: {
				x: beforeNode.x + 24,
				y: beforeNode.y + 8,
			},
			text: beforeNode.text ? `${beforeNode.text}*` : 'Phase 6C',
		},
	};
	const inverseOperation = {
		opId: 'phase6c-live-session-undo-display-node-props',
		kind: 'setDisplayNodeProps',
		selector,
		props: {
			position: {
				x: beforeNode.x,
				y: beforeNode.y,
			},
			text: beforeNode.text,
		},
	};

	const appliedProject = applyUamTransaction(cloneJson(project), [operation]);
	const undoneProject = applyUamTransaction(cloneJson(appliedProject), [inverseOperation]);
	const afterNode = summarizeNode(findDisplayNode(appliedProject, target));
	const undoneNode = summarizeNode(findDisplayNode(undoneProject, target));

	const runtime = new BackendRuntime();
	const opened = runtime.openProjectSession({
		project,
		canonicalProjectPath: 'memory://phase6c-live-command-session',
	});
	assert(opened.ok, `openProjectSession failed: ${JSON.stringify(opened)}`);

	const sessionId = opened.data.sessionId;
	const applied = await runtime.applyTransaction({
		sessionId,
		expectedRevision: opened.data.revision,
		operations: [operation],
	});
	assert(applied.ok, `Phase 6C applyTransaction failed: ${JSON.stringify(applied)}`);

	const staleWrite = await runtime.applyTransaction({
		sessionId,
		expectedRevision: opened.data.revision,
		operations: [inverseOperation],
	});
	assert(!staleWrite.ok, 'Phase 6C stale write unexpectedly succeeded.');

	const undone = await runtime.applyTransaction({
		sessionId,
		expectedRevision: applied.data.revision,
		operations: [inverseOperation],
	});
	assert(undone.ok, `Phase 6C undo transaction failed: ${JSON.stringify(undone)}`);

	const saved = await runtime.saveSession({ sessionId });
	assert(!saved.ok, 'saveSession unexpectedly succeeded without a filesystem adapter.');

	const events = runtime.getEvents({ sessionId, limit: 20 });
	const capabilities = runtime.getCapabilities();

	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		source: {
			packageName: packageJson.name,
			packageVersion: packageJson.version,
			backendPackageDir: path.relative(process.cwd(), backendPackageDir).replaceAll(path.sep, '/'),
			browserEntry: path.relative(process.cwd(), backendEntry).replaceAll(path.sep, '/'),
			backendContractVersion: BACKEND_CONTRACT_VERSION,
			capabilitySchemaVersion: BACKEND_CAPABILITY_SCHEMA_VERSION,
			canonicalProjectPath: 'memory://phase6c-live-command-session',
			mode: 'authoring_sample_openfairygui_live_session_contract',
		},
		project: {
			id: project.projectId ?? '',
			type: project.projectType ?? '',
			version: project.version ?? '',
			sourcePath: path.relative(process.cwd(), projectPath).replaceAll(path.sep, '/'),
		},
		target,
		command: {
			kind: 'setDisplayNodeProps',
			status: 'verified_with_openfairygui_live_session',
			adapterPlan: 'replace_browser_working_copy_with_live_session_or_worker_bridge',
		},
		operation,
		inverseOperation,
		results: {
			capabilities: capabilities.ok
				? {
						ok: true,
						browserSafe: capabilities.data.manifest.browserSafe,
						projectSessionBoundary: capabilities.data.manifest.executionBoundaries.projectSession,
						fileBackedSessionBoundary: capabilities.data.manifest.executionBoundaries.fileBackedSession,
						applyTransaction: capabilities.data.authoring.applyTransaction,
						saveSession: capabilities.data.authoring.saveSession,
					}
				: { ok: false, error: capabilities.error },
			openSession: summarizeResult(opened),
			apply: summarizeResult(applied),
			staleWrite: summarizeResult(staleWrite),
			undo: summarizeResult(undone),
			save: summarizeResult(saved),
			events: events.ok
				? {
						ok: true,
						count: events.data.events.length,
						kinds: events.data.events.map((event) => event.kind),
						currentSequence: events.data.currentSequence,
					}
				: { ok: false, error: events.error },
		},
		preview: {
			before: beforeNode,
			after: afterNode,
			undone: undoneNode,
		},
		integration: {
			browserRuntimeAdapter: 'pending',
			reason:
				'The LayaAir project does not yet have a stable root package/bundler entry for importing @openfairygui/backend into the browser bundle.',
			nextStep:
				'Add a browser backend bundle or Worker/session bridge, then route EditorCommandAdapter apply/undo through BackendRuntime.applyTransaction.',
		},
		diagnostics: [
			{
				severity: 'info',
				code: 'PHASE6C_OPENFAIRYGUI_LIVE_SESSION_VERIFIED',
				message:
					'OpenFairyGUI browser-safe BackendRuntime accepted the Phase 6 command shape on the editable authoring sample UAM session.',
			},
			{
				severity: 'info',
				code: 'PHASE6C_STALE_REVISION_PROTECTION',
				message:
					'BackendRuntime rejected a stale expectedRevision after the first transaction, confirming revision protection for command sessions.',
			},
			{
				severity: 'info',
				code: 'PHASE6C_SAVE_BOUNDARY_UNCHANGED',
				message:
					'Persisting a memory session still requires a browser storage adapter; memory-only sessions cannot write project files by themselves.',
			},
		],
	};

	writeReport(report);
	console.log(
		JSON.stringify(
			{
				ok: true,
				output: path.relative(process.cwd(), outputPath).replaceAll(path.sep, '/'),
				packageVersion: packageJson.version,
				contractVersion: BACKEND_CONTRACT_VERSION,
				target,
				applyRevision: report.results.apply.revision,
				staleWriteCode: report.results.staleWrite.error.code,
				undoRevision: report.results.undo.revision,
				saveWithoutFileSystem: report.results.save.error.code,
				eventKinds: report.results.events.kinds,
				browserRuntimeAdapter: report.integration.browserRuntimeAdapter,
			},
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error(
		JSON.stringify(
			{
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				openfairyguiModuleRoot,
				projectPath,
				outputPath,
			},
			null,
			2,
		),
	);
	process.exit(1);
});
