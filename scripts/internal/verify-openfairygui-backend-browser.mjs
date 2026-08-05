import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findDisplayNode, readJson } from '../verification-helpers.mjs';

const defaultBackendPackageDir = path.resolve(
	'node_modules',
	'@openfairygui',
	'backend',
);
const backendPackageDir = path.resolve(process.argv[2] ?? defaultBackendPackageDir);
const distDir = path.join(backendPackageDir, 'dist');
const browserEntry = path.join(distDir, 'index.mjs');
const nodeEntry = path.join(distDir, 'node.mjs');

function reportFailure(error) {
	console.error(
		JSON.stringify(
			{
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				backendPackageDir,
				browserEntry,
			},
			null,
			2,
		),
	);
	process.exit(1);
}

process.on('uncaughtException', reportFailure);
process.on('unhandledRejection', reportFailure);

function findEsmImports(source) {
	const imports = [];
	const staticPattern = /\b(?:from|export\s+[^;]*?\s+from)\s*['"](\.[^'"]+)['"]/g;
	const dynamicPattern = /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
	const packageStaticPattern = /\b(?:from|export\s+[^;]*?\s+from)\s*['"](@openfairygui\/[^'"]+)['"]/g;
	const packageDynamicPattern = /\bimport\s*\(\s*['"](@openfairygui\/[^'"]+)['"]\s*\)/g;

	for (const pattern of [
		staticPattern,
		dynamicPattern,
		packageStaticPattern,
		packageDynamicPattern,
	]) {
		let match = pattern.exec(source);
		while (match) {
			imports.push(match[1]);
			match = pattern.exec(source);
		}
	}

	return imports;
}

function assertBrowserSafeImportGraph(entryFile, visited = new Set()) {
	const resolvedEntry = path.resolve(entryFile);
	if (visited.has(resolvedEntry)) return;
	visited.add(resolvedEntry);

	const source = readFileSync(resolvedEntry, 'utf8');
	const forbiddenNodeImports = [
		'node:fs',
		'node:fs/promises',
		'node:path',
		'fs',
		'fs/promises',
		'path',
	];

	for (const specifier of forbiddenNodeImports) {
		const quoted = String.raw`['"]${specifier.replace('/', String.raw`\/`)}['"]`;
		const importPattern = new RegExp(
			String.raw`(?:\bfrom\s+|\bimport\s*\(\s*)${quoted}`,
		);
		assert(
			!importPattern.test(source),
			`Browser entry graph imports Node-only module "${specifier}" in ${resolvedEntry}`,
		);
	}

	for (const specifier of findEsmImports(source)) {
		if (specifier.startsWith('.')) {
			const child = path.resolve(path.dirname(resolvedEntry), specifier);
			if (existsSync(child)) {
				assertBrowserSafeImportGraph(child, visited);
			}
			continue;
		}

		if (specifier.startsWith('@openfairygui/')) {
			const child = resolveOpenFairyGuiBrowserEntry(specifier, resolvedEntry);
			assertBrowserSafeImportGraph(child, visited);
		}
	}

	return visited;
}

function resolveOpenFairyGuiBrowserEntry(specifier, fromFile) {
	const requireFromEntry = createRequire(pathToFileURL(fromFile));
	const nodeResolvedEntry = requireFromEntry.resolve(specifier);
	const maybePackageDir =
		path.basename(path.dirname(nodeResolvedEntry)) === 'dist'
			? path.dirname(path.dirname(nodeResolvedEntry))
			: path.dirname(nodeResolvedEntry);
	const packageJsonPath = path.join(maybePackageDir, 'package.json');

	if (!existsSync(packageJsonPath)) return nodeResolvedEntry;

	const packageJson = readJson(packageJsonPath);
	const browserEntrySpecifier =
		packageJson.exports?.['.']?.default?.default ??
		packageJson.exports?.default?.default ??
		packageJson.module ??
		packageJson.main;

	return path.resolve(maybePackageDir, browserEntrySpecifier);
}

const packageJson = readJson(path.join(backendPackageDir, 'package.json'));
const baseline = readJson(path.resolve('assets/resources/editor/runtime/uam-baseline.json'));
assert(baseline?.uamProject && baseline?.target, 'Generated browser baseline is incomplete.');
const targetNode = findDisplayNode(baseline.uamProject, baseline.target);
assert(targetNode, 'Generated browser baseline target was not found.');

assert(existsSync(browserEntry), `Missing browser backend entry: ${browserEntry}`);
assert(existsSync(nodeEntry), `Missing Node backend entry: ${nodeEntry}`);

let scannedFiles = new Set();
let browserImportGraphError = null;
try {
	scannedFiles = assertBrowserSafeImportGraph(browserEntry);
} catch (error) {
	browserImportGraphError = error instanceof Error ? error : new Error(String(error));
}

const browserModule = await import(pathToFileURL(browserEntry).href);
const nodeModule = await import(pathToFileURL(nodeEntry).href);

assert(
	typeof browserModule.BackendRuntime === 'function',
	'Browser backend entry does not export BackendRuntime.',
);
assert(
	typeof nodeModule.createNodeBackendRuntime === 'function',
	'Node backend entry does not export createNodeBackendRuntime.',
);

const runtime = new browserModule.BackendRuntime();
const opened = runtime.openProjectSession({
	project: structuredClone(baseline.uamProject),
	canonicalProjectPath: 'memory://verify-openfairygui-backend-browser',
});

assert(opened.ok, `openProjectSession failed: ${JSON.stringify(opened)}`);
assert(
	opened.data.capabilities.manifest.browserSafe === true,
	'BackendRuntime did not declare browserSafe capability.',
);

const applied = await runtime.applyTransaction({
	sessionId: opened.data.sessionId,
	expectedRevision: 0,
	operations: [
		{
			kind: 'setDisplayNodeProps',
			selector: baseline.target,
			props: {
				position: {
					x: Number(targetNode.position?.x || 0) + 1,
					y: Number(targetNode.position?.y || 0),
				},
			},
		},
	],
});

assert(applied.ok, `applyTransaction failed: ${JSON.stringify(applied)}`);
assert(applied.data.revision === 1, 'Transaction did not advance session revision.');
assert(applied.data.dirty === true, 'Transaction did not mark session dirty.');

const saved = await runtime.saveSession({ sessionId: opened.data.sessionId });
assert(!saved.ok, 'saveSession unexpectedly succeeded without a filesystem adapter.');
assert(
	saved.error.code === 'capability_unavailable' && saved.error.capability === 'fileSystem',
	`saveSession returned an unexpected error: ${JSON.stringify(saved)}`,
);

const fileBackedOpen = await runtime.openSession({ projectPath: './Project' });
assert(!fileBackedOpen.ok, 'openSession unexpectedly succeeded without a filesystem adapter.');
assert(
	fileBackedOpen.error.requiredAdapter === 'BackendFileSystem',
	`openSession returned an unexpected error: ${JSON.stringify(fileBackedOpen)}`,
);

const summary = {
	ok: browserImportGraphError === null,
	packageName: packageJson.name,
	packageVersion: packageJson.version,
	backendPackageDir,
	browserEntry,
	nodeEntry,
	browserImportGraphOk: browserImportGraphError === null,
	browserImportGraphError: browserImportGraphError?.message,
	scannedBrowserGraphFiles: [...scannedFiles].map((filePath) =>
		path.relative(backendPackageDir, filePath),
	),
	transactionRevision: applied.data.revision,
	saveWithoutFileSystem: saved.error.code,
	fileBackedOpenWithoutAdapter: fileBackedOpen.error.requiredAdapter,
};

const serializedSummary = JSON.stringify(summary, null, 2);
if (browserImportGraphError) {
	console.error(serializedSummary);
	process.exit(1);
}

console.log(serializedSummary);
