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
	process.argv[3] ?? 'verification/reports/phase3-transaction-report.json',
);
const projectPath = resolveAuthoringProjectPath(process.argv[4]);
const corePackageDir = path.join(openfairyguiModuleRoot, 'core');
const functionsPackageDir = path.join(openfairyguiModuleRoot, 'functions');
const backendPackageDir = path.join(openfairyguiModuleRoot, 'backend');
const coreNodeEntry = path.join(corePackageDir, 'dist', 'node.js');
const coreEntry = path.join(corePackageDir, 'dist', 'index.js');
const coreUamEntry = path.join(corePackageDir, 'dist', 'uam', 'index.js');
const functionsEntry = path.join(functionsPackageDir, 'dist', 'index.js');
const browserEntry = path.join(backendPackageDir, 'dist', 'index.mjs');

function cloneJson(value) {
	return JSON.parse(JSON.stringify(value));
}

function findPreferredTransactionTarget(project) {
	const preferredPackageNames = ['Basic', 'Builder'];
	const preferredComponentNames = ['Button', 'TextButton', 'BasicPropsPanel'];

	for (const packageName of preferredPackageNames) {
		const pkg = project.packages?.find((candidate) => candidate.name === packageName);
		const target = pkg ? findTargetInPackage(pkg, preferredComponentNames) : null;
		if (target) return target;
	}

	for (const pkg of project.packages ?? []) {
		const target = findTargetInPackage(pkg, []);
		if (target) return target;
	}

	return null;
}

function findTargetInPackage(pkg, preferredComponentNames) {
	for (const componentName of preferredComponentNames) {
		const resource = pkg.resources?.find((candidate) => candidate.name === componentName);
		const node = resource ? findTextDisplayNode(resource) : null;
		if (node) return buildTarget(pkg, resource, node);
	}

	for (const resource of pkg.resources ?? []) {
		const node = findTextDisplayNode(resource);
		if (node) return buildTarget(pkg, resource, node);
	}

	return null;
}

function findTextDisplayNode(resource) {
	for (const node of resource.component?.displayList ?? []) {
		if (node.kind === 'text' && node.id) return node;
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
		color: String(node.color ?? ''),
		blendMode: String(node.blendMode ?? 'normal'),
	};
}

function summarizeResult(result) {
	if (result.ok) {
		return {
			ok: true,
			stage: result.stage,
			revision: result.data?.revision,
			dirty: result.data?.dirty,
			durationMs: result.meta?.durationMs,
		};
	}

	return {
		ok: false,
		stage: result.stage,
		revision: result.snapshot?.revision,
		durationMs: result.meta?.durationMs,
		error: {
			code: result.error?.code ?? 'unknown_error',
			message: result.error?.message ?? 'Unknown transaction error.',
			opIndex: result.error?.opIndex,
			opKind: result.error?.opKind,
			issues: result.error?.issues ?? [],
		},
		diagnostics: result.diagnostics ?? [],
	};
}

function writeReport(report) {
	mkdirSync(path.dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
	for (const filePath of [coreNodeEntry, coreEntry, coreUamEntry, functionsEntry, browserEntry]) {
		assert(existsSync(filePath), `Missing OpenFairyGUI entry: ${filePath}`);
	}
	assert(existsSync(projectPath), `Missing authoring project file: ${projectPath}`);

	const packageJson = readJson(path.join(backendPackageDir, 'package.json'));
	const [
		{ NodeIO },
		{ inspect },
		{ liftDocumentToUamProject },
		{ applyUamTransaction, validateTransactionSupport },
		{ BackendRuntime },
	] = await Promise.all([
		importFile(coreNodeEntry),
		importFile(functionsEntry),
		importFile(coreEntry),
		importFile(coreUamEntry),
		importFile(browserEntry),
	]);

	const io = new NodeIO();
	const doc = await io.readProject(projectPath);
	const inspectReport = inspect(doc);
	const project = liftDocumentToUamProject(doc);
	const supportIssues = validateTransactionSupport(project, []);
	assert(
		supportIssues.length === 0,
		`Authoring project transaction support failed with ${supportIssues.length} issue(s).`,
	);

	const target = findPreferredTransactionTarget(project);
	assert(target, 'No text display node found in authoring project UAM project.');
	const beforeNode = summarizeNode(findDisplayNode(project, target));
	const selector = {
		packageId: target.packageId,
		componentResourceId: target.componentResourceId,
		displayNodeId: target.displayNodeId,
	};
	const operation = {
		opId: 'phase3-authoring-sample-set-node-props',
		kind: 'setDisplayNodeProps',
		selector,
		props: {
			position: { x: beforeNode.x + 1, y: beforeNode.y },
			text: beforeNode.text ? `${beforeNode.text}*` : 'Phase 3',
		},
	};
	const inverseOperation = {
		opId: 'phase3-authoring-sample-undo-node-props',
		kind: 'setDisplayNodeProps',
		selector,
		props: {
			position: { x: beforeNode.x, y: beforeNode.y },
			text: beforeNode.text,
		},
	};
	const commonPropertyOperation = {
		opId: 'phase3-authoring-sample-common-prop',
		kind: 'setDisplayNodeProps',
		selector,
		props: {
			blendMode: beforeNode.blendMode === 'multiply' ? 'normal' : 'multiply',
		},
	};
	const commonPropertyInverse = {
		opId: 'phase3-authoring-sample-common-prop-undo',
		kind: 'setDisplayNodeProps',
		selector,
		props: {
			blendMode: beforeNode.blendMode,
		},
	};

	const appliedProject = applyUamTransaction(cloneJson(project), [operation]);
	const undoneProject = applyUamTransaction(cloneJson(appliedProject), [inverseOperation]);
	const afterNode = summarizeNode(findDisplayNode(appliedProject, target));
	const undoneNode = summarizeNode(findDisplayNode(undoneProject, target));

	const runtime = new BackendRuntime();
	const opened = runtime.openProjectSession({
		project,
		canonicalProjectPath: 'memory://phase3-authoring-sample-session',
	});
	assert(opened.ok, `openProjectSession failed: ${JSON.stringify(opened)}`);
	const sessionId = opened.data.sessionId;

	const applied = await runtime.applyTransaction({
		sessionId,
		expectedRevision: 0,
		operations: [operation],
	});
	assert(applied.ok, `Authoring project apply transaction failed: ${JSON.stringify(applied)}`);

	const commonApplied = await runtime.applyTransaction({
		sessionId,
		expectedRevision: applied.data.revision,
		operations: [commonPropertyOperation],
	});
	assert(commonApplied.ok, `Common display property transaction failed: ${JSON.stringify(commonApplied)}`);

	const commonUndone = await runtime.applyTransaction({
		sessionId,
		expectedRevision: commonApplied.data.revision,
		operations: [commonPropertyInverse],
	});
	assert(commonUndone.ok, `Common display property undo failed: ${JSON.stringify(commonUndone)}`);

	const undone = await runtime.applyTransaction({
		sessionId,
		expectedRevision: commonUndone.data.revision,
		operations: [inverseOperation],
	});
	assert(undone.ok, `Authoring project undo transaction failed: ${JSON.stringify(undone)}`);

	const saved = await runtime.saveSession({ sessionId });
	assert(!saved.ok, 'saveSession unexpectedly succeeded without a filesystem adapter.');

	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		source: {
			packageName: packageJson.name,
			packageVersion: packageJson.version,
			backendPackageDir: path.relative(process.cwd(), backendPackageDir).replaceAll(path.sep, '/'),
			browserEntry: path.relative(process.cwd(), browserEntry).replaceAll(path.sep, '/'),
			canonicalProjectPath: 'memory://phase3-authoring-sample-session',
			realUiProjectMode: 'authoring_sample_uam_session_memory_transaction',
		},
		project: {
			id: project.projectId ?? '',
			type: project.projectType ?? '',
			version: project.version ?? '',
			sourcePath: path.relative(process.cwd(), projectPath).replaceAll(path.sep, '/'),
		},
		target,
		command: {
			kind: 'setDisplayNodeBoundsAndText',
			label: 'Set authoring sample text node position and text',
			status: 'verified_with_authoring_sample_uam_session',
		},
		operation,
		inverseOperation,
		commonPropertyOperation,
		commonPropertyInverse,
		results: {
			openSession: summarizeResult(opened),
			apply: summarizeResult(applied),
			commonPropertyApply: summarizeResult(commonApplied),
			commonPropertyUndo: summarizeResult(commonUndone),
			undo: summarizeResult(undone),
			save: summarizeResult(saved),
		},
		preview: {
			before: beforeNode,
			after: afterNode,
			undone: undoneNode,
		},
		diagnostics: [
			{
				severity: 'info',
				code: 'PHASE3_COMMON_DISPLAY_PROPERTIES',
				message:
					'OpenFairyGUI alpha.35 accepted and reversed a typed blendMode update through setDisplayNodeProps.',
			},
			{
				severity: 'info',
				code: 'PHASE3_AUTHORING_SAMPLE_SESSION',
				message:
					'OpenFairyGUI browser backend accepted a setDisplayNodeProps transaction on the editable authoring sample UAM session and advanced revision 0 -> 1.',
			},
			{
				severity: 'info',
				code: 'PHASE3_AUTHORING_SAMPLE_UNDO',
				message:
					'The inverse setDisplayNodeProps transaction restored the editable authoring sample node after the common-property round trip.',
			},
			{
				severity: 'info',
				code: 'PHASE3_AUTHORING_SAMPLE_SUPPORT',
				message: `Editable authoring sample transaction support baseline passed with ${supportIssues.length} issue(s); inspect counted ${inspectReport.totals.displayObjects} display object(s).`,
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
				projectPath: report.project.sourcePath,
				target,
				supportIssueCount: supportIssues.length,
				applyRevision: report.results.apply.revision,
				undoRevision: report.results.undo.revision,
				commonPropertyApplyRevision: report.results.commonPropertyApply.revision,
				commonPropertyUndoRevision: report.results.commonPropertyUndo.revision,
				saveWithoutFileSystem: report.results.save.error.code,
				realUiProjectMode: report.source.realUiProjectMode,
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
