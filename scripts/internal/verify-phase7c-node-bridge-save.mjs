import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
	resolveAuthoringProjectPath,
	resolveOpenFairyGuiModuleRoot,
} from '../project-boundary.mjs';
import { findDisplayNode, importFile, readJson } from '../verification-helpers.mjs';

const root = process.cwd();
const openfairyguiModuleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const reportPath = path.resolve(
	process.argv[3] ?? 'verification/reports/phase7c-save-bridge-report.json',
);
const workspaceDir = path.resolve(process.argv[4] ?? '.tmp/phase7c-node-bridge-save');
const sourceProjectPath = resolveAuthoringProjectPath(process.argv[5]);
const sourceProjectDir = path.dirname(sourceProjectPath);
const copiedProjectDir = path.join(workspaceDir, 'EditableProject');
const copiedProjectPath = path.join(copiedProjectDir, path.basename(sourceProjectPath));
const publishOutputDir = path.join(workspaceDir, 'publish');

const corePackageDir = path.join(openfairyguiModuleRoot, 'core');
const backendPackageDir = path.join(openfairyguiModuleRoot, 'backend');
const cliPackageDir = path.join(openfairyguiModuleRoot, 'cli');
const coreNodeEntry = path.join(corePackageDir, 'dist', 'node.js');
const coreEntry = path.join(corePackageDir, 'dist', 'index.js');
const backendNodeEntry = path.join(backendPackageDir, 'dist', 'node.mjs');
const cliEntry = path.join(cliPackageDir, 'bin', 'cli.cjs');

function relativePath(filePath) {
	return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function assertInsideWorkspaceTmp(dirPath, label) {
	const workspaceRelative = path.relative(root, dirPath);
	const tmpRelative = path.relative(path.resolve('.tmp'), dirPath);
	const insideWorkspace =
		Boolean(workspaceRelative) && !workspaceRelative.startsWith('..') && !path.isAbsolute(workspaceRelative);
	const insideTmp = Boolean(tmpRelative) && !tmpRelative.startsWith('..') && !path.isAbsolute(tmpRelative);

	assert(insideWorkspace && insideTmp, `${label} must stay inside workspace .tmp: ${dirPath}`);
}

function resetWorkspace() {
	assertInsideWorkspaceTmp(workspaceDir, 'Phase 7C workspace');
	if (existsSync(workspaceDir)) {
		rmSync(workspaceDir, { recursive: true, force: true });
	}
	mkdirSync(workspaceDir, { recursive: true });
	cpSync(sourceProjectDir, copiedProjectDir, {
		recursive: true,
		filter: (source) => !source.endsWith('.openfairygui.backend.lock'),
	});
}

function sha256File(filePath) {
	const hash = createHash('sha256');
	hash.update(readFileSync(filePath));
	return hash.digest('hex');
}

function findPhase7Target(project) {
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
		text: String(node?.text ?? ''),
		visible: node?.visible !== false,
	};
}

function applyPropsToState(state, props) {
	return {
		...state,
		x: props.position ? props.position.x : state.x,
		y: props.position ? props.position.y : state.y,
		width: props.size ? props.size.width : state.width,
		height: props.size ? props.size.height : state.height,
		text: props.text !== undefined ? props.text : state.text,
		visible: props.visible !== undefined ? props.visible : state.visible,
	};
}

function statesMatch(actual, expected) {
	return (
		actual.x === expected.x &&
		actual.y === expected.y &&
		actual.width === expected.width &&
		actual.height === expected.height &&
		actual.text === expected.text &&
		actual.visible === expected.visible
	);
}

function summarizeResult(result) {
	if (result.ok) {
		return {
			ok: true,
			stage: result.meta?.stage,
			revision: result.data?.revision ?? result.meta?.revision,
			dirty: result.data?.dirty,
			lastSavedRevision: result.data?.lastSavedRevision,
			uamFidelity: result.data?.uamFidelity,
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
		uamFidelity: result.session?.uamFidelity ?? result.snapshot?.uamFidelity,
		durationMs: result.meta?.durationMs,
		error: {
			code: result.error?.code ?? 'unknown_error',
			message: truncateText(result.error?.message ?? 'Unknown backend error.'),
			expectedRevision: result.error?.expectedRevision,
			actualRevision: result.error?.actualRevision,
			capability: result.error?.capability,
			requiredAdapter: result.error?.requiredAdapter,
			opIndex: result.error?.opIndex,
			opKind: result.error?.opKind,
			attemptedRevision: result.error?.attemptedRevision,
			lastSavedRevision: result.error?.lastSavedRevision,
			diskMayBePartiallyUpdated: result.error?.diskMayBePartiallyUpdated,
			committedPaths: result.error?.committedPaths ?? [],
			failedPaths: result.error?.failedPaths ?? [],
		},
		diagnostics: sanitizeDiagnostics(result.meta?.diagnostics ?? result.diagnostics ?? []),
	};
}

function truncateText(value, maxLength = 1200) {
	const text = String(value ?? '');
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
}

function sanitizeDiagnostics(diagnostics) {
	if (!Array.isArray(diagnostics)) return [];

	return diagnostics.slice(0, 20).map((diagnostic) => ({
		...diagnostic,
		message: truncateText(diagnostic?.message ?? ''),
	}));
}

function summarizeValidationMessage(message) {
	const issueLines = String(message)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith('- '));

	return {
		issueCount: issueLines.length,
		samples: issueLines.slice(0, 12).map((line) => line.replace(/^- /, '')),
		truncated: issueLines.length > 12,
	};
}

function listOutputFiles(dirPath) {
	if (!existsSync(dirPath)) return [];

	return readdirSync(dirPath)
		.map((fileName) => {
			const filePath = path.join(dirPath, fileName);
			const stats = statSync(filePath);
			return {
				name: fileName,
				path: relativePath(filePath),
				bytes: stats.isFile() ? stats.size : 0,
			};
		})
		.filter((file) => file.bytes > 0);
}

function runNodeCli(args) {
	const startedAt = Date.now();

	return new Promise((resolve) => {
		const child = spawn(process.execPath, [cliEntry, ...args], {
			cwd: root,
			windowsHide: true,
		});
		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});
		child.on('error', (error) => {
			resolve({
				exitCode: 1,
				stdout,
				stderr: `${stderr}${error instanceof Error ? error.message : String(error)}`,
				durationMs: Date.now() - startedAt,
			});
		});
		child.on('close', (exitCode) => {
			resolve({
				exitCode: exitCode ?? 1,
				stdout,
				stderr,
				durationMs: Date.now() - startedAt,
			});
		});
	});
}

function toAsciiLogLines(value) {
	return String(value)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, 20);
}

async function readUamProject(NodeIO, liftDocumentToUamProject, projectPath) {
	const io = new NodeIO();
	const doc = await io.readProject(projectPath);
	return liftDocumentToUamProject(doc);
}

async function main() {
	for (const filePath of [coreNodeEntry, coreEntry, backendNodeEntry, cliEntry]) {
		assert(existsSync(filePath), `Missing OpenFairyGUI entry: ${filePath}`);
	}
	assert(existsSync(sourceProjectPath), `Missing authoring project file: ${sourceProjectPath}`);

	const sourceHashBefore = sha256File(sourceProjectPath);
	resetWorkspace();

	const [
		{ NodeIO },
		{ liftDocumentToUamProject },
		backendNode,
		corePackageJson,
		functionsPackageJson,
		backendPackageJson,
		cliPackageJson,
	] = await Promise.all([
		importFile(coreNodeEntry),
		importFile(coreEntry),
		importFile(backendNodeEntry),
		Promise.resolve(readJson(path.join(corePackageDir, 'package.json'))),
		Promise.resolve(readJson(path.join(openfairyguiModuleRoot, 'functions', 'package.json'))),
		Promise.resolve(readJson(path.join(backendPackageDir, 'package.json'))),
		Promise.resolve(readJson(path.join(cliPackageDir, 'package.json'))),
	]);

	const beforeProject = await readUamProject(NodeIO, liftDocumentToUamProject, copiedProjectPath);
	const target = findPhase7Target(beforeProject);
	assert(target, 'No display node target found for Phase 7C save bridge verification.');

	const before = summarizeNode(findDisplayNode(beforeProject, target));
	const props = {
		position: {
			x: before.x + 31,
			y: before.y + 9,
		},
		size: {
			width: Math.max(1, before.width + 15),
			height: Math.max(1, before.height + 5),
		},
		visible: false,
		text: before.text ? `${before.text} saved` : 'Phase 7C saved',
	};
	const expectedAfter = applyPropsToState(before, props);
	const operation = {
		opId: 'phase7c-node-bridge-save-display-props',
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: target.packageId,
			componentResourceId: target.componentResourceId,
			displayNodeId: target.displayNodeId,
		},
		props,
	};

	const runtime = backendNode.createNodeBackendRuntime();
	const opened = await runtime.openSession({ projectPath: copiedProjectDir });
	assert(opened.ok, `Phase 7C openSession failed: ${JSON.stringify(opened)}`);

	const applied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: opened.data.revision,
		operations: [operation],
	});
	assert(applied.ok, `Phase 7C applyTransaction failed: ${JSON.stringify(applied)}`);

	const saved = await runtime.saveSession({
		sessionId: opened.data.sessionId,
		expectedRevision: applied.data.revision,
	});
	const events = runtime.getEvents({ sessionId: opened.data.sessionId, limit: 40 });
	const closed = await runtime.closeSession({ sessionId: opened.data.sessionId });

	let reload = {
		ok: false,
		status: 'skipped_save_failed',
		before,
		expectedAfter,
		reloaded: null,
	};
	let publish = {
		ok: false,
		status: 'skipped_save_failed',
		command: null,
		outputDir: relativePath(publishOutputDir),
		outputFileCount: 0,
		outputFiles: [],
		stdout: [],
		stderr: [],
	};

	if (saved.ok) {
		const reloadedProject = await readUamProject(NodeIO, liftDocumentToUamProject, copiedProjectPath);
		const reloaded = summarizeNode(findDisplayNode(reloadedProject, target));
		const reloadMatches = statesMatch(reloaded, expectedAfter);
		reload = {
			ok: reloadMatches,
			status: reloadMatches ? 'verified' : 'state_mismatch',
			before,
			expectedAfter,
			reloaded,
		};

		mkdirSync(publishOutputDir, { recursive: true });
		const cliArgs = [
			'publish',
			copiedProjectDir,
			'--output',
			publishOutputDir,
			'--project-type',
			'layabox',
		];
		const publishExecution = await runNodeCli(cliArgs);
		const outputFiles = listOutputFiles(publishOutputDir);
		const expectedDescriptors = (beforeProject.packages ?? [])
			.map((pkg) => String(pkg.publishName ?? pkg.name ?? ''))
			.filter(Boolean)
			.map((name) => `${name}.fui`);
		const publishOk =
			publishExecution.exitCode === 0 &&
			expectedDescriptors.length > 0 &&
			expectedDescriptors.every((fileName) =>
				outputFiles.some((file) => file.name === fileName && file.bytes > 0),
			);
		publish = {
			ok: publishOk,
			status: publishOk ? 'verified' : 'publish_failed',
			command: {
				executable: process.execPath,
				script: relativePath(cliEntry),
				args: cliArgs.map((arg) => (path.isAbsolute(arg) ? relativePath(arg) : arg)),
				exitCode: publishExecution.exitCode,
				durationMs: publishExecution.durationMs,
			},
			outputDir: relativePath(publishOutputDir),
			outputFileCount: outputFiles.length,
			outputFiles,
			stdout: toAsciiLogLines(publishExecution.stdout),
			stderr: toAsciiLogLines(publishExecution.stderr),
		};
	}

	const sourceHashAfter = sha256File(sourceProjectPath);
	const sourceUnchanged = sourceHashBefore === sourceHashAfter;
	assert(sourceUnchanged, 'Phase 7C verification unexpectedly changed the source authoring project .fairy file.');
	const validationSummary = saved.ok
		? { issueCount: 0, samples: [], truncated: false }
		: summarizeValidationMessage(saved.error?.message ?? '');
	const persistentLoopOk = saved.ok && reload.ok && publish.ok;
	const uamFidelity = opened.data.uamFidelity ?? 'unknown';
	const fidelityGuarded = saved.error?.code === 'uam_fidelity_unsupported';

	const report = {
		schemaVersion: 2,
		generatedAt: new Date().toISOString(),
		source: {
			packageName: backendPackageJson.name,
			packageVersion: backendPackageJson.version,
			packageVersions: {
				core: corePackageJson.version,
				functions: functionsPackageJson.version,
				backend: backendPackageJson.version,
				cli: cliPackageJson.version,
			},
			openfairyguiModuleRoot: relativePath(openfairyguiModuleRoot),
			backendNodeEntry: relativePath(backendNodeEntry),
			cliEntry: relativePath(cliEntry),
			mode: 'phase7c_node_bridge_save_copy_verification',
			uamFidelity,
		},
		project: {
			sourcePath: relativePath(sourceProjectPath),
			workspaceDir: relativePath(workspaceDir),
			copiedProjectPath: relativePath(copiedProjectPath),
			sourceHashBefore,
			sourceHashAfter,
			sourceUnchanged,
		},
		target,
		operation,
		results: {
			openSession: summarizeResult(opened),
			apply: summarizeResult(applied),
			save: summarizeResult(saved),
			close: summarizeResult(closed),
			reload,
			publish,
			events: events.ok
				? {
					ok: true,
					kinds: events.data.events.map((event) => event.kind),
					lastSequence: events.data.lastSequence,
				}
				: summarizeResult(events),
		},
		gap: persistentLoopOk
			? null
			: {
				id: fidelityGuarded ? 'GAP-20260724-01' : 'GAP-20260517-01',
				title: fidelityGuarded
					? 'OpenFairyGUI Node backend refuses write-back when the lifted UAM is not source-fidelity complete.'
					: 'OpenFairyGUI Node backend save rejects lifted authoring project UAM during materialization validation.',
				owner: 'OpenFairyGUI',
				blocking: true,
				safetyGuard: fidelityGuarded,
				saveErrorCode: saved.error?.code ?? '',
				validationIssueCount: validationSummary.issueCount,
				validationSamples: validationSummary.samples,
				validationSamplesTruncated: validationSummary.truncated,
				expected: fidelityGuarded
					? 'A Node file-backed session must refuse write-back rather than rewrite a project whose UAM round trip loses persisted properties.'
					: 'An editable authoring project that can lift to UAM, open a Node backend session, and apply a supported setDisplayNodeProps transaction should be materializable and savable back to the opened project path.',
				actual: fidelityGuarded
					? `${backendPackageJson.version} opened the sample with uamFidelity=unsupported and saveSession returned uam_fidelity_unsupported before writing any file.`
					: 'saveSession fails before persistence with save_partial_failure and UAM validation diagnostics such as unknown resource refs and empty relation targetNodeId values.',
			},
		diagnostics: [
			persistentLoopOk
				? {
					severity: 'info',
					code: 'PHASE7C_NODE_BRIDGE_SAVE_VERIFIED',
					message:
						'OpenFairyGUI Node backend session saved a setDisplayNodeProps transaction into a copied authoring project and reload confirmed the persisted state.',
				}
				: fidelityGuarded
					? {
						severity: 'warning',
						code: 'PHASE7C_NODE_FIDELITY_GUARD',
						message:
							`OpenFairyGUI ${backendPackageJson.version} refused Node file write-back because the source project does not round-trip with full UAM fidelity; no copied project files were written.`,
					}
					: {
						severity: 'error',
						code: 'GAP_20260517_01_SAVE_MATERIALIZATION_BLOCKED',
						message:
							'OpenFairyGUI Node backend saveSession failed while materializing the lifted authoring project UAM; persistent save verification cannot advance until upstream accepts its own lifted project shape.',
					},
			{
				severity: 'info',
				code: 'PHASE7C_SOURCE_PROJECT_UNCHANGED',
				message:
					'The verification writes only to the .tmp project copy; the source authoring project .fairy hash stayed unchanged.',
			},
			{
				severity: 'warning',
				code: 'PHASE7C_BROWSER_STORAGE_BRIDGE_PENDING',
				message:
					'The browser editor product path remains Phase 8 browser storage; this Node guard does not invalidate its independent save/reload verification.',
			},
		],
	};

	mkdirSync(path.dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

	console.log(
		JSON.stringify(
			{
				ok: persistentLoopOk,
				report: relativePath(reportPath),
				workspaceDir: relativePath(workspaceDir),
				packageVersion: report.source.packageVersion,
				packageVersions: report.source.packageVersions,
				target: report.target,
				saveRevision: report.results.save.revision,
				saveOk: report.results.save.ok,
				saveErrorCode: report.results.save.error?.code,
				uamFidelity,
				validationIssueCount: validationSummary.issueCount,
				reloadOk: report.results.reload.ok,
				publishOk: report.results.publish.ok,
				publishOutputDir: report.results.publish.outputDir,
				sourceUnchanged,
				gap: report.gap?.id ?? null,
			},
			null,
			2,
		),
	);

	if (!persistentLoopOk) {
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(
		JSON.stringify(
			{
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				openfairyguiModuleRoot,
				sourceProjectPath,
				workspaceDir,
				reportPath,
			},
			null,
			2,
		),
	);
	process.exit(1);
});
