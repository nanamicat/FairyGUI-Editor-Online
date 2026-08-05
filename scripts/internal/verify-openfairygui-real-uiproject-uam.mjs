import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
	resolveAuthoringProjectPath,
	resolveOpenFairyGuiModuleRoot,
} from '../project-boundary.mjs';
import { importFile, readJson } from '../verification-helpers.mjs';

const OPENFAIRYGUI_MODULE_ROOT = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const PROJECT_PATH = resolveAuthoringProjectPath(process.argv[3]);
const CORE_PACKAGE_DIR = path.join(OPENFAIRYGUI_MODULE_ROOT, 'core');
const FUNCTIONS_PACKAGE_DIR = path.join(OPENFAIRYGUI_MODULE_ROOT, 'functions');
const BACKEND_PACKAGE_DIR = path.join(OPENFAIRYGUI_MODULE_ROOT, 'backend');

function packageVersion(packageDir) {
	return String(readJson(path.join(packageDir, 'package.json')).version);
}

function summarizeSupportIssues(issues) {
	const unsupportedDisplayNodeKinds = new Map();

	for (const issue of issues) {
		const match = /display node kind "([^"]+)"/.exec(issue.message ?? '');
		if (match) {
			unsupportedDisplayNodeKinds.set(
				match[1],
				(unsupportedDisplayNodeKinds.get(match[1]) ?? 0) + 1,
			);
		}
	}

	return {
		ok: issues.length === 0,
		issueCount: issues.length,
		unsupportedDisplayNodeKinds: Object.fromEntries(
			[...unsupportedDisplayNodeKinds.entries()].sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
		samples: issues.slice(0, 8),
	};
}

function findTransactionSmokeTarget(project) {
	for (const pkg of project.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			for (const node of resource.component?.displayList ?? []) {
				if (node.kind !== 'text' || !node.id) continue;

				return {
					packageId: pkg.id,
					componentResourceId: resource.id,
					displayNodeId: node.id,
					before: {
						name: node.name ?? '',
						text: node.text ?? '',
						x: node.position?.x ?? 0,
						y: node.position?.y ?? 0,
					},
				};
			}
		}
	}

	return null;
}

function summarizeTransactionResult(result) {
	if (result.ok) {
		return {
			ok: true,
			revision: result.data?.revision,
			dirty: result.data?.dirty,
		};
	}

	return {
		ok: false,
		error: result.error,
		diagnostics: result.diagnostics ?? [],
	};
}

async function main() {
	for (const packageDir of [CORE_PACKAGE_DIR, FUNCTIONS_PACKAGE_DIR, BACKEND_PACKAGE_DIR]) {
		assert(existsSync(packageDir), `Missing OpenFairyGUI package directory: ${packageDir}`);
	}
	assert(existsSync(PROJECT_PATH), `Missing authoring project file: ${PROJECT_PATH}`);

	const [
		{ NodeIO },
		{ inspect },
		{ liftDocumentToUamProject },
		{ validateTransactionSupport },
		{ BackendRuntime },
	] = await Promise.all([
		importFile(path.join(CORE_PACKAGE_DIR, 'dist', 'node.js')),
		importFile(path.join(FUNCTIONS_PACKAGE_DIR, 'dist', 'index.js')),
		importFile(path.join(CORE_PACKAGE_DIR, 'dist', 'index.js')),
		importFile(path.join(CORE_PACKAGE_DIR, 'dist', 'uam', 'index.js')),
		importFile(path.join(BACKEND_PACKAGE_DIR, 'dist', 'index.mjs')),
	]);

	const io = new NodeIO();
	const doc = await io.readProject(PROJECT_PATH);
	const report = inspect(doc);

	let uamProject;
	let uamLift;
	try {
		uamProject = liftDocumentToUamProject(doc);
		uamLift = { ok: true };
	} catch (error) {
		uamLift = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	let openProjectSession = { ok: false, error: 'UAM lift did not complete.' };
	let transactionSupport = {
		ok: false,
		issueCount: 0,
		unsupportedDisplayNodeKinds: {},
		samples: [],
	};
	let transactionSmoke = { ok: false, skipped: 'UAM lift did not complete.' };

	if (uamProject) {
		const runtime = new BackendRuntime();
		const opened = runtime.openProjectSession({
			project: uamProject,
			canonicalProjectPath: 'memory://fairygui-editor-online-authoring-sample',
		});

		openProjectSession = opened.ok
			? {
					ok: true,
					revision: opened.data.revision,
					dirty: opened.data.dirty,
					browserSafe: opened.data.capabilities.manifest.browserSafe,
				}
			: {
					ok: false,
					error: opened.error,
				};

		transactionSupport = summarizeSupportIssues(validateTransactionSupport(uamProject, []));

		if (opened.ok) {
			const target = findTransactionSmokeTarget(uamProject);
			if (target) {
				const selector = {
					packageId: target.packageId,
					componentResourceId: target.componentResourceId,
					displayNodeId: target.displayNodeId,
				};
				const apply = await runtime.applyTransaction({
					sessionId: opened.data.sessionId,
					expectedRevision: 0,
					operations: [
						{
									opId: 'authoring-sample-smoke-apply-position',
							kind: 'setDisplayNodeProps',
							selector,
							props: {
								position: {
									x: target.before.x + 1,
									y: target.before.y,
								},
							},
						},
					],
				});
				const undo = apply.ok
					? await runtime.applyTransaction({
							sessionId: opened.data.sessionId,
							expectedRevision: apply.data.revision,
							operations: [
								{
									opId: 'authoring-sample-smoke-undo-position',
									kind: 'setDisplayNodeProps',
									selector,
									props: {
										position: {
											x: target.before.x,
											y: target.before.y,
										},
									},
								},
							],
						})
					: null;
				const saved = await runtime.saveSession({ sessionId: opened.data.sessionId });

				transactionSmoke = {
					ok: apply.ok && undo?.ok === true && !saved.ok,
					target,
					apply: summarizeTransactionResult(apply),
					undo: undo ? summarizeTransactionResult(undo) : null,
					saveWithoutFileSystem: saved.ok
						? { ok: true }
						: {
								ok: false,
								code: saved.error?.code,
								capability: saved.error?.capability,
							},
				};
			} else {
				transactionSmoke = {
					ok: false,
					skipped: 'No text display node found for authoring project transaction smoke test.',
				};
			}
		}
	}

	const summary = {
		ok: uamLift.ok && openProjectSession.ok && transactionSupport.ok && transactionSmoke.ok,
		openfairyguiModuleRoot: path
			.relative(process.cwd(), OPENFAIRYGUI_MODULE_ROOT)
			.replaceAll(path.sep, '/'),
		packageVersions: {
			core: packageVersion(CORE_PACKAGE_DIR),
			functions: packageVersion(FUNCTIONS_PACKAGE_DIR),
			backend: packageVersion(BACKEND_PACKAGE_DIR),
		},
		projectPath: path.relative(process.cwd(), PROJECT_PATH).replaceAll(path.sep, '/'),
		totals: report.totals,
		uamLift,
		openProjectSession,
		transactionSupport,
		transactionSmoke,
	};

	console.log(JSON.stringify(summary, null, 2));

	if (!summary.ok) {
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(
		JSON.stringify(
			{
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				openfairyguiModuleRoot: OPENFAIRYGUI_MODULE_ROOT,
				projectPath: PROJECT_PATH,
			},
			null,
			2,
		),
	);
	process.exit(1);
});
