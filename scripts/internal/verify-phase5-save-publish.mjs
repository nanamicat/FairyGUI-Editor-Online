import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
	resolveAuthoringProjectPath,
	resolveOpenFairyGuiModuleRoot,
} from '../project-boundary.mjs';
import { importFile, readJson } from '../verification-helpers.mjs';

const openfairyguiModuleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const reportOutputPath = path.resolve(
	process.argv[3] ?? 'verification/reports/phase5-publish-report.json',
);
const publishOutputDir = path.resolve(
	process.argv[4] ?? '.tmp/phase5-openfairygui-publish',
);
const projectPath = resolveAuthoringProjectPath(process.argv[5]);
const projectDir = path.dirname(projectPath);
const corePackageDir = path.join(openfairyguiModuleRoot, 'core');
const functionsPackageDir = path.join(openfairyguiModuleRoot, 'functions');
const cliPackageDir = path.join(openfairyguiModuleRoot, 'cli');
const coreNodeEntry = path.join(corePackageDir, 'dist', 'node.js');
const functionsEntry = path.join(functionsPackageDir, 'dist', 'index.js');
const cliEntry = path.join(cliPackageDir, 'bin', 'cli.cjs');

function readJsonIfExists(filePath, fallback) {
	if (!existsSync(filePath)) return fallback;
	return readJson(filePath);
}

function callOptional(object, methodName, fallback) {
	if (!object || typeof object[methodName] !== 'function') return fallback;
	const value = object[methodName]();
	return value === undefined || value === null ? fallback : value;
}

function toStringValue(value, fallback = '') {
	if (value === undefined || value === null) return fallback;
	return String(value);
}

function toBooleanValue(value, fallback = false) {
	if (typeof value === 'boolean') return value;
	return fallback;
}

function typeOfProperty(object, fallback) {
	return toStringValue(object?.propertyType || object?.constructor?.name, fallback);
}

function relativePath(filePath) {
	return path.relative(process.cwd(), filePath).replaceAll(path.sep, '/');
}

function safeCleanPublishOutput() {
	if (!existsSync(publishOutputDir)) return;

	const workspaceRelative = path.relative(process.cwd(), publishOutputDir);
	const tmpRelative = path.relative(path.resolve('.tmp'), publishOutputDir);
	const insideWorkspace = workspaceRelative && !workspaceRelative.startsWith('..') && !path.isAbsolute(workspaceRelative);
	const insideTmp = tmpRelative && !tmpRelative.startsWith('..') && !path.isAbsolute(tmpRelative);

	assert(
		insideWorkspace && insideTmp,
		`Refusing to clean publish output outside workspace .tmp directory: ${publishOutputDir}`,
	);

	rmSync(publishOutputDir, { recursive: true, force: true });
}

function runNodeCli(args) {
	const startedAt = Date.now();

	return new Promise((resolve) => {
		const child = spawn(process.execPath, [cliEntry, ...args], {
			cwd: process.cwd(),
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

function listOutputFiles() {
	if (!existsSync(publishOutputDir)) return [];

	return readdirSync(publishOutputDir)
		.map((fileName) => {
			const filePath = path.join(publishOutputDir, fileName);
			const stats = statSync(filePath);
			return {
				name: fileName,
				path: relativePath(filePath),
				bytes: stats.isFile() ? stats.size : 0,
			};
		})
		.filter((file) => file.bytes > 0);
}

function findPublishedFile(files, fileName) {
	const found = files.find((file) => file.name === fileName);
	return {
		name: fileName,
		path: found ? found.path : relativePath(path.join(publishOutputDir, fileName)),
		bytes: found ? found.bytes : 0,
		exists: Boolean(found),
	};
}

function summarizePackage(pkg, files, fileExtension) {
	const packageId = toStringValue(callOptional(pkg, 'getId', ''));
	const packageName = toStringValue(callOptional(pkg, 'getName', ''));
	const publishName = toStringValue(callOptional(pkg, 'getPublishName', packageName), packageName) || packageName;
	const resources = callOptional(pkg, 'listResources', []);
	const components = callOptional(pkg, 'listComponents', []);
	const descriptorFile = findPublishedFile(files, `${publishName}.${fileExtension}`);
	const atlasFiles = files
		.filter((file) => file.name.startsWith(`${publishName}_atlas`) && file.name.toLowerCase().endsWith('.png'))
		.map((file) => ({
			name: file.name,
			path: file.path,
			bytes: file.bytes,
			exists: true,
		}));
	const imageResourceCount = Array.isArray(resources)
		? resources.filter((resource) => typeOfProperty(resource, '').toLowerCase().includes('image')).length
		: 0;
	const componentSamples = Array.isArray(components)
		? components
			.filter((component) => toBooleanValue(callOptional(component, 'getExported', true), true))
			.slice(0, 5)
			.map((component) => toStringValue(callOptional(component, 'getName', '')))
			.filter(Boolean)
		: [];
	const itemUrlSamples = componentSamples.map((componentName) => `ui://${packageName}/${componentName}`);
	const ok = descriptorFile.exists && descriptorFile.bytes > 0 && (imageResourceCount === 0 || atlasFiles.length > 0);

	return {
		packageId,
		packageName,
		publishName,
		componentCount: Array.isArray(components) ? components.length : 0,
		resourceCount: Array.isArray(resources) ? resources.length : 0,
		imageResourceCount,
		descriptorFile,
		atlasFiles,
		itemUrlSamples,
		ok,
	};
}

function buildDiagnostics(publish, contracts, saveStatus) {
	const diagnostics = [];

	if (publish.ok && contracts.outputOk) {
		diagnostics.push({
			severity: 'info',
			code: 'PHASE5_PUBLISH_CLI',
			message: `OpenFairyGUI CLI published ${contracts.packageCount} LayaBox package(s) with descriptor and atlas outputs.`,
		});
	} else {
		diagnostics.push({
			severity: 'error',
			code: 'PHASE5_PUBLISH_OUTPUT_INVALID',
			message: 'OpenFairyGUI CLI publish did not produce the expected package outputs.',
		});
	}

	diagnostics.push({
		severity: 'info',
		code: 'PHASE5_SAVE_STORAGE_BOUNDARY',
		message: `Persistent save remains a storage-adapter/Node-bridge boundary; current browser-safe session save status is ${saveStatus}.`,
	});

	diagnostics.push({
		severity: 'warning',
		code: 'PHASE5_RUNTIME_LOAD_NOT_AUTOMATED',
		message:
			'This report validates publish output files. Runtime load should still be observed after publishing or copying the output to the app resource path.',
	});

	return diagnostics;
}

function readPhase3SaveBoundary() {
	const phase3ReportPath = path.resolve('verification/reports/phase3-transaction-report.json');
	if (!existsSync(phase3ReportPath)) {
		return {
			status: 'phase3_report_missing',
			ok: false,
			code: 'missing_phase3_report',
			message: 'Phase 3 transaction report was not found.',
		};
	}

	const report = readJson(phase3ReportPath);
	const saveResult = report?.results?.save;
	const saveError = saveResult?.error;
	return {
		status: saveResult?.ok ? 'unexpected_save_available' : 'storage_adapter_required',
		ok: Boolean(saveResult?.ok),
		code: saveError?.code ?? 'none',
		message: saveError?.message ?? '',
		stage: saveResult?.stage ?? '',
	};
}

function toAsciiLogLines(text) {
	return text
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => line.replaceAll(process.cwd(), '.').replace(/[^\x09\x20-\x7e]/g, '-'))
		.slice(-12);
}

async function main() {
	for (const filePath of [coreNodeEntry, functionsEntry, cliEntry]) {
		assert(existsSync(filePath), `Missing OpenFairyGUI entry: ${filePath}`);
	}
	assert(existsSync(projectPath), `Missing authoring project file: ${projectPath}`);

	const [{ NodeIO }, { inspect }] = await Promise.all([
		importFile(coreNodeEntry),
		importFile(functionsEntry),
	]);
	const cliPackageJson = readJson(path.join(cliPackageDir, 'package.json'));
	const publishSettingsPath = path.join(projectDir, 'settings', 'Publish.json');
	const publishSettings = readJsonIfExists(publishSettingsPath, {});
	const fileExtension = toStringValue(publishSettings.fileExtension, 'fui') || 'fui';

	const io = new NodeIO();
	const doc = await io.readProject(projectPath);
	const inspectReport = inspect(doc);
	const root = doc.getRoot();
	const packages = callOptional(root, 'listPackages', []);

	safeCleanPublishOutput();
	mkdirSync(publishOutputDir, { recursive: true });

	const cliArgs = [
		'publish',
		projectDir,
		'--output',
		publishOutputDir,
		'--project-type',
		'layabox',
	];
	const execution = await runNodeCli(cliArgs);
	const outputFiles = listOutputFiles();
	const packageContracts = packages.map((pkg) => summarizePackage(pkg, outputFiles, fileExtension));
	const outputOk = execution.exitCode === 0 && packageContracts.every((contract) => contract.ok);
	const saveBoundary = readPhase3SaveBoundary();
	const contracts = {
		outputOk,
		packageCount: packageContracts.length,
		outputFileCount: outputFiles.length,
		outputFiles,
		packages: packageContracts,
	};
	const publish = {
		ok: execution.exitCode === 0,
		command: {
			executable: process.execPath,
			script: relativePath(cliEntry),
			args: cliArgs.map((arg) => path.isAbsolute(arg) ? relativePath(arg) : arg),
			exitCode: execution.exitCode,
			durationMs: execution.durationMs,
		},
		outputDir: relativePath(publishOutputDir),
		stdout: toAsciiLogLines(execution.stdout),
		stderr: toAsciiLogLines(execution.stderr),
	};
	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		source: {
			packageName: cliPackageJson.name,
			packageVersion: cliPackageJson.version,
			openfairyguiModuleRoot: relativePath(openfairyguiModuleRoot),
			cliEntry: relativePath(cliEntry),
		},
		project: {
			id: toStringValue(callOptional(root, 'getProjectId', '')),
			type: callOptional(root, 'getProjectType', ''),
			version: toStringValue(callOptional(root, 'getVersion', '')),
			sourcePath: relativePath(projectPath),
			publishSettingsPath: existsSync(publishSettingsPath) ? relativePath(publishSettingsPath) : '',
			publishPath: toStringValue(publishSettings.path, ''),
			fileExtension,
			compressDesc: toBooleanValue(publishSettings.compressDesc, false),
			binaryFormat: toBooleanValue(publishSettings.binaryFormat, false),
			inspectTotals: inspectReport.totals,
		},
		publish,
		contracts,
		save: {
			status: saveBoundary.status,
			browserSessionSaveWithoutFileSystem: saveBoundary,
			persistentProjectWrite: {
				status: 'not_implemented_in_browser_main_thread',
				requiredAdapter: 'filesystem_or_remote_storage_adapter',
				source: 'Phase 3 browser-safe BackendRuntime saveSession boundary',
			},
		},
		runtimeLoad: {
			status: 'manual_laya_preview_required',
			currentAppPackagePaths: [],
			publishedOutputPackagePaths: packageContracts.map((contract) => `${relativePath(publishOutputDir)}/${contract.publishName}`),
		},
		diagnostics: buildDiagnostics(
			publish,
			contracts,
			`${saveBoundary.code}${saveBoundary.stage ? `/${saveBoundary.stage}` : ''}`,
		),
	};

	mkdirSync(path.dirname(reportOutputPath), { recursive: true });
	writeFileSync(reportOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

	console.log(
		JSON.stringify(
			{
				ok: outputOk,
				output: relativePath(reportOutputPath),
				publishOutputDir: relativePath(publishOutputDir),
				packageVersion: cliPackageJson.version,
				projectPath: relativePath(projectPath),
				packageCount: packageContracts.length,
				outputFileCount: outputFiles.length,
				packages: packageContracts.map((contract) => ({
					name: contract.packageName,
					descriptor: contract.descriptorFile.name,
					descriptorBytes: contract.descriptorFile.bytes,
					atlasCount: contract.atlasFiles.length,
					ok: contract.ok,
				})),
				saveStatus: saveBoundary.status,
				saveCode: saveBoundary.code,
			},
			null,
			2,
		),
	);

	if (!outputOk) {
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
				projectPath,
				reportOutputPath,
				publishOutputDir,
			},
			null,
			2,
		),
	);
	process.exit(1);
});
