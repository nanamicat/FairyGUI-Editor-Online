import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
	resolveAuthoringProjectPath,
	resolveOpenFairyGuiModuleRoot,
} from './project-boundary.mjs';
import {
	cloneJson,
	findDisplayNode,
	importFile,
	readJson,
} from './verification-helpers.mjs';

const openfairyguiModuleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const outputDir = path.resolve(process.argv[3] ?? 'assets/resources/editor/runtime');
const projectPath = resolveAuthoringProjectPath(process.argv[4]);
const root = process.cwd();
const corePackageDir = path.join(openfairyguiModuleRoot, 'core');
const backendPackageDir = path.join(openfairyguiModuleRoot, 'backend');
const functionsPackageDir = path.join(openfairyguiModuleRoot, 'functions');
const cliPackageDir = path.join(openfairyguiModuleRoot, 'cli');
const isWorkspaceSource = path.basename(openfairyguiModuleRoot) === 'packages'
	&& existsSync(path.join(backendPackageDir, 'node_modules', '@openfairygui', 'core'));
const bundleEntryDirectory = isWorkspaceSource
	? backendPackageDir
	: path.dirname(path.dirname(openfairyguiModuleRoot));
const coreNodeEntry = path.join(corePackageDir, 'dist', 'node.js');
const coreEntry = path.join(corePackageDir, 'dist', 'index.js');
const coreUamEntry = path.join(corePackageDir, 'dist', 'uam', 'index.js');
const backendPackageJsonPath = path.join(backendPackageDir, 'package.json');
const bundleEntryPath = path.join(bundleEntryDirectory, 'openfairygui-browser-runtime-entry.mjs');
const workerEntryPath = createRequire(path.join(bundleEntryDirectory, 'package.json')).resolve(
	'@openfairygui/core/image-validation-worker',
);
const removeBundleEntryAfterBuild = !existsSync(bundleEntryPath);
const sourceKind = isWorkspaceSource ? 'workspace_source' : 'npm_package';
const bundleOutputPath = path.join(outputDir, 'openfairygui-backend-browser.js');
const workerOutputPath = path.join(outputDir, 'image-validation-worker.js');
const baselineOutputPath = path.join(outputDir, 'uam-baseline.json');
const reportOutputPath = path.resolve('verification/reports/phase7-browser-live-session-report.json');

function readPackageVersion(packageDir) {
	const packageJsonPath = path.join(packageDir, 'package.json');
	if (!existsSync(packageJsonPath)) return undefined;
	return readJson(packageJsonPath).version;
}

function readPackageVersions() {
	return {
		core: readPackageVersion(corePackageDir),
		functions: readPackageVersion(functionsPackageDir),
		backend: readPackageVersion(backendPackageDir),
		cli: readPackageVersion(cliPackageDir),
	};
}

function encodeUamProjectBinaryData(project) {
	const encoded = cloneJson(project);
	for (const pkg of encoded.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			const bytes = resource.sourceBytes ?? resource.binaryData;
			if (!(bytes instanceof Uint8Array)) continue;
			delete resource.binaryData;
			resource.sourceBytes = {
				encoding: 'base64',
				data: Buffer.from(bytes).toString('base64'),
			};
		}
	}
	return encoded;
}

function relativePath(filePath) {
	return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function ensureLayaMeta(filePath) {
	const metaPath = `${filePath}.meta`;
	if (existsSync(metaPath)) return;

	writeFileSync(metaPath, `${JSON.stringify({ uuid: randomUUID() }, null, 2)}\n`, 'utf8');
}

function findBrowserRuntimeTarget(project) {
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
		touchable: node.touchable !== false,
		grayed: node.grayed === true,
		alpha: Number(node.alpha ?? 1),
		rotation: Number(node.rotation ?? 0),
	};
}

function summarizeApplyResult(result) {
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
		},
	};
}

function runEsbuild() {
	mkdirSync(path.dirname(bundleEntryPath), { recursive: true });
	writeFileSync(
		bundleEntryPath,
		[
			"export {",
			"  BackendRuntime,",
			"  createBackendStorageFileSystem,",
			"  BACKEND_CONTRACT_VERSION,",
			"  BACKEND_CAPABILITY_SCHEMA_VERSION,",
			"  BACKEND_COMPATIBILITY_POLICY,",
			"} from '@openfairygui/backend';",
			"export { ProjectReader } from '@openfairygui/core/project-io';",
			"export { liftDocumentToUamProject } from '@openfairygui/core';",
			"export { applyUamTransaction, applyUamTransactionAsync } from '@openfairygui/core/uam';",
			"export { publishBrowser } from '@openfairygui/functions/web';",
			"",
		].join('\n'),
		'utf8',
	);
	try {
		rmSync(bundleOutputPath, { force: true });
		rmSync(workerOutputPath, { force: true });

		const npx = process.platform === 'win32' ? 'npx.exe' : 'npx';
		const run = (entryPath, outputPath, extraArgs = []) => spawnSync(
			npx,
			[
				'-y',
				'-p',
				'esbuild@0.25.5',
				'esbuild',
				entryPath,
				'--bundle',
				'--format=esm',
				'--platform=browser',
				'--target=es2020',
				'--main-fields=module,main',
				`--outfile=${outputPath}`,
				'--log-level=warning',
				...extraArgs,
			],
			{
				cwd: root,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);
		const result = run(bundleEntryPath, bundleOutputPath);
		const workerResult = run(workerEntryPath, workerOutputPath);

		for (const [label, buildResult] of [['backend', result], ['image worker', workerResult]]) {
			if (buildResult.status === 0) continue;
			throw new Error(
				`${label} esbuild failed with exit ${buildResult.status}${buildResult.error ? ` (${buildResult.error.message})` : ''}.\nSTDOUT:\n${buildResult.stdout}\nSTDERR:\n${buildResult.stderr}`,
			);
		}

		for (const outputPath of [bundleOutputPath, workerOutputPath]) {
			const source = readFileSync(outputPath, 'utf8');
			const normalizedSource = source
				.replace(/^\/\/ .*?(?:\.tmp\/|node_modules\/|FairyGUI-Editor-Online).*?\r?\n/gm, '')
				.replace(/[ \t]+(?=\r?\n)/g, '');
			if (normalizedSource !== source) writeFileSync(outputPath, normalizedSource, 'utf8');
		}
		assert(
			statSync(workerOutputPath).size > 1_000,
			'Phase 7A image validation worker bundle is unexpectedly empty.',
		);
		assert(
			!/^\s*import\s/m.test(readFileSync(workerOutputPath, 'utf8')),
			'Phase 7A image validation worker must be bundled without external imports.',
		);

		return {
			command: [npx, '-y', '-p', 'esbuild@0.25.5', 'esbuild', relativePath(bundleEntryPath)],
			workerCommand: [npx, '-y', '-p', 'esbuild@0.25.5', 'esbuild', relativePath(workerEntryPath)],
			stdout: result.stdout.trim(),
			stderr: result.stderr.trim(),
			workerStdout: workerResult.stdout.trim(),
			workerStderr: workerResult.stderr.trim(),
		};
	} finally {
		if (removeBundleEntryAfterBuild) rmSync(bundleEntryPath, { force: true });
	}
}

async function main() {
	for (const filePath of [coreNodeEntry, coreEntry, coreUamEntry, backendPackageJsonPath]) {
		assert(existsSync(filePath), `Missing OpenFairyGUI entry: ${filePath}`);
	}
	assert(existsSync(projectPath), `Missing authoring project file: ${projectPath}`);

	const packageJson = readJson(backendPackageJsonPath);
	const packageVersions = readPackageVersions();
	const [
		{ NodeIO },
		{ liftDocumentToUamProject },
		{ validateTransactionSupport },
	] = await Promise.all([
		importFile(coreNodeEntry),
		importFile(coreEntry),
		importFile(coreUamEntry),
	]);

	const io = new NodeIO();
	const doc = await io.readProject(projectPath, { includeBinaryData: true, hydrateResourceBytes: true });
	const project = liftDocumentToUamProject(doc);
	const supportIssues = validateTransactionSupport(project, []);
	assert(
		supportIssues.length === 0,
		`Authoring project transaction support failed with ${supportIssues.length} issue(s).`,
	);

	const target = findBrowserRuntimeTarget(project);
	assert(target, 'No display node target found for Phase 7A browser live session verification.');

	const beforeNode = summarizeNode(findDisplayNode(project, target));
	const selector = {
		packageId: target.packageId,
		componentResourceId: target.componentResourceId,
		displayNodeId: target.displayNodeId,
	};
	const operation = {
		opId: 'browser-live-session-set-display-node-props',
		kind: 'setDisplayNodeProps',
		selector,
		props: {
			position: {
				x: beforeNode.x + 24,
				y: beforeNode.y + 8,
			},
			text: beforeNode.text ? `${beforeNode.text}*` : 'Phase 7A',
			touchable: !beforeNode.touchable,
			grayed: !beforeNode.grayed,
			alpha: beforeNode.alpha === 1 ? 0.65 : 1,
			rotation: beforeNode.rotation + 15,
		},
	};
	const inverseOperation = {
		opId: 'browser-live-session-undo-display-node-props',
		kind: 'setDisplayNodeProps',
		selector,
		props: {
			position: {
				x: beforeNode.x,
				y: beforeNode.y,
			},
			text: beforeNode.text,
			touchable: beforeNode.touchable,
			grayed: beforeNode.grayed,
			alpha: beforeNode.alpha,
			rotation: beforeNode.rotation,
		},
	};

	mkdirSync(outputDir, { recursive: true });
	const esbuild = runEsbuild();
	const backendBundle = await importFile(bundleOutputPath);
	assert(
		typeof backendBundle.applyUamTransaction === 'function',
		'Phase 7A generated browser bundle does not export applyUamTransaction for UAM snapshot synchronization.',
	);
	assert(
		typeof backendBundle.applyUamTransactionAsync === 'function',
		'Phase 7A generated browser bundle does not export applyUamTransactionAsync for browser image replacement.',
	);
	const projectedProject = backendBundle.applyUamTransaction(cloneJson(project), [operation]);
	const projectedNode = findDisplayNode(projectedProject, target);
	assert(
		projectedNode?.position?.x === operation.props.position.x
			&& projectedNode?.position?.y === operation.props.position.y
			&& projectedNode?.text === operation.props.text,
		'Phase 7A generated browser bundle applyUamTransaction projection did not match the transaction operation.',
	);
	const imageEntries = (project.packages ?? []).flatMap((pkg) =>
		(pkg.resources ?? [])
			.filter((resource) => resource.kind === 'image' && resource.sourceBytes instanceof Uint8Array)
			.map((resource) => ({ pkg, resource })),
	);
	const imageSource = imageEntries.find(({ resource }) => /\.(?:png|jpe?g)$/i.test(resource.fileName ?? ''));
	const imageReplacement = imageSource && imageEntries.find(({ resource }) =>
		resource.id !== imageSource.resource.id
		&& path.extname(resource.fileName ?? '').toLowerCase() === path.extname(imageSource.resource.fileName ?? '').toLowerCase()
		&& (resource.dimensions?.width !== imageSource.resource.dimensions?.width
			|| resource.dimensions?.height !== imageSource.resource.dimensions?.height),
	);
	assert(imageSource && imageReplacement, 'Phase 7A image projection verification needs two same-format images with different dimensions.');
	const projectedImageProject = await backendBundle.applyUamTransactionAsync(cloneJson(project), [{
		opId: 'browser-live-session-replace-image-bytes',
		kind: 'replaceResourceBytes',
		selector: { packageId: imageSource.pkg.id, resourceId: imageSource.resource.id },
		sourceBytes: new Uint8Array(imageReplacement.resource.sourceBytes),
	}]);
	const projectedImage = projectedImageProject.packages
		.find((pkg) => pkg.id === imageSource.pkg.id)?.resources
		.find((resource) => resource.id === imageSource.resource.id);
	assert.deepEqual(
		projectedImage?.dimensions,
		imageReplacement.resource.dimensions,
		'Phase 7A applyUamTransactionAsync did not project replacement image dimensions.',
	);
	const runtime = new backendBundle.BackendRuntime();
	const opened = runtime.openProjectSession({
		project: cloneJson(project),
		canonicalProjectPath: 'memory://browser-live-session',
	});
	assert(opened.ok, `Phase 7A generated browser bundle openProjectSession failed: ${JSON.stringify(opened)}`);

	const applied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: opened.data.revision,
		operations: [operation],
	});
	assert(applied.ok, `Phase 7A generated browser bundle applyTransaction failed: ${JSON.stringify(applied)}`);

	const undone = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: applied.data.revision,
		operations: [inverseOperation],
	});
	assert(undone.ok, `Phase 7A generated browser bundle undo transaction failed: ${JSON.stringify(undone)}`);

	const saved = await runtime.saveSession({ sessionId: opened.data.sessionId });
	assert(!saved.ok, 'Phase 7A saveSession unexpectedly succeeded without a filesystem adapter.');

	const bundleSizeBytes = statSync(bundleOutputPath).size;
	const baseline = {
		schemaVersion: 2,
		source: {
			packageName: packageJson.name,
			packageVersion: packageJson.version,
			packageVersions,
			sourceKind,
		},
		project: {
			id: project.projectId ?? '',
			type: project.projectType ?? '',
			version: project.version ?? '',
		},
		target,
		uamProject: encodeUamProjectBinaryData(project),
	};
	writeFileSync(baselineOutputPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
	ensureLayaMeta(baselineOutputPath);
	ensureLayaMeta(bundleOutputPath);
	ensureLayaMeta(workerOutputPath);

	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		source: {
			packageName: packageJson.name,
			packageVersion: packageJson.version,
			packageVersions,
			sourceKind,
			openfairyguiModuleRoot: relativePath(openfairyguiModuleRoot),
			projectPath: relativePath(projectPath),
			bundlePath: relativePath(bundleOutputPath),
			workerPath: relativePath(workerOutputPath),
			baselinePath: relativePath(baselineOutputPath),
			backendContractVersion: backendBundle.BACKEND_CONTRACT_VERSION,
			capabilitySchemaVersion: backendBundle.BACKEND_CAPABILITY_SCHEMA_VERSION,
			esbuild: {
				version: '0.25.5',
				command: esbuild.command,
				stdout: esbuild.stdout,
				stderr: esbuild.stderr,
				workerCommand: esbuild.workerCommand,
				workerStdout: esbuild.workerStdout,
				workerStderr: esbuild.workerStderr,
			},
		},
		project: baseline.project,
		target,
		results: {
			bundle: {
				ok: true,
				bytes: bundleSizeBytes,
				importedInNode: true,
				exportsApplyUamTransaction: true,
				exportsApplyUamTransactionAsync: true,
				projectionOk: true,
				imageProjectionOk: true,
				workerBytes: statSync(workerOutputPath).size,
				workerSelfContained: true,
			},
			uamBaseline: {
				ok: true,
				bytes: statSync(baselineOutputPath).size,
				transactionSupportIssueCount: supportIssues.length,
			},
			openSession: summarizeApplyResult(opened),
			apply: summarizeApplyResult(applied),
			undo: summarizeApplyResult(undone),
			save: summarizeApplyResult(saved),
		},
		integration: {
			browserRuntimeAdapter: 'connected_after_laya_rebuild',
			reason:
				'The editor can dynamically import the generated browser bundle and open an in-memory BackendRuntime session from the UAM baseline after the LayaAir bundle is rebuilt.',
			nextStep:
				'Route Inspector Apply/Undo through the BrowserLiveSessionBridge, then attach the Phase 8 browser storage adapter for persistent workspace save.',
		},
		diagnostics: [
			{
				severity: 'info',
				code: 'BROWSER_RUNTIME_GENERATED',
				message:
					'OpenFairyGUI backend was bundled for the browser without Node-only imports blocking esbuild platform=browser.',
			},
			{
				severity: 'info',
				code: 'BROWSER_RUNTIME_SESSION_VERIFIED',
				message:
					'The generated bundle opened an authoring sample UAM memory session and applied/undid setDisplayNodeProps including common display props.',
			},
			{
				severity: 'info',
				code: 'SAVE_BOUNDARY_UNCHANGED',
				message:
					'Persistent save requires the Phase 8 browser storage adapter; memory-only sessions do not write project files.',
			},
		],
	};
	mkdirSync(path.dirname(reportOutputPath), { recursive: true });
	writeFileSync(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

	console.log(
		JSON.stringify(
			{
				ok: true,
				outputs: {
					bundle: relativePath(bundleOutputPath),
					worker: relativePath(workerOutputPath),
					baseline: relativePath(baselineOutputPath),
					report: relativePath(reportOutputPath),
				},
				packageVersion: packageJson.version,
				packageVersions,
				sourceKind,
				contractVersion: backendBundle.BACKEND_CONTRACT_VERSION,
				target,
				bundleBytes: bundleSizeBytes,
				baselineBytes: statSync(baselineOutputPath).size,
				applyRevision: report.results.apply.revision,
				undoRevision: report.results.undo.revision,
				saveWithoutFileSystem: report.results.save.error?.code,
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
				outputDir,
			},
			null,
			2,
		),
	);
	process.exit(1);
});
