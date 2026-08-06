import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { relativeWorkspacePath, resolveOpenFairyGuiModuleRoot } from '../project-boundary.mjs';
import { readJson } from '../verification-helpers.mjs';

const expectedVersion = '0.2.4';
const moduleRoot = resolveOpenFairyGuiModuleRoot(process.argv[2]);
const suiteStartedAt = Date.now();

for (const packageName of ['core', 'functions', 'backend', 'cli']) {
	const packageJson = readJson(path.join(moduleRoot, packageName, 'package.json'));
	assert.equal(packageJson.version, expectedVersion, `${packageName} must be ${expectedVersion}`);
}

const steps = [
	['typecheck', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json', '--pretty', 'false'], 0],
	['Project snapshot', process.execPath, ['scripts/generate-project-snapshot.mjs', moduleRoot], 0],
	['Phase 3 transaction', process.execPath, ['scripts/internal/verify-phase3-uam-transaction.mjs', moduleRoot], 0],
	['Phase 5 publish', process.execPath, ['scripts/internal/verify-phase5-save-publish.mjs', moduleRoot], 0],
	['Runtime preview', process.execPath, ['scripts/prepare-runtime-preview.mjs'], 0],
	['Phase 6C live contract', process.execPath, ['scripts/internal/verify-phase6c-live-command-session.mjs', moduleRoot], 0],
	['Browser runtime', process.execPath, ['scripts/prepare-browser-runtime.mjs', moduleRoot], 0],
	['Browser backend package', process.execPath, ['scripts/internal/verify-openfairygui-backend-browser.mjs', path.join(moduleRoot, 'backend')], 0],
	['Authoring project UAM', process.execPath, ['scripts/internal/verify-openfairygui-real-uiproject-uam.mjs', moduleRoot], 0],
	['Browser session lifecycle', process.execPath, ['scripts/internal/verify-browser-session-lifecycle-race.mjs'], 0],
	['Phase 7B display props', process.execPath, ['scripts/internal/verify-phase7b-display-props-command.mjs'], 0],
	['Phase 7C fidelity guard', process.execPath, ['scripts/internal/verify-phase7c-node-bridge-save.mjs', moduleRoot], 1],
	['Phase 8 browser save', process.execPath, ['scripts/internal/verify-phase8-browser-storage-save.mjs', moduleRoot], 0],
	['Phase 8 clean materialize', process.execPath, ['scripts/internal/verify-phase8-clean-materialize.mjs', moduleRoot], 0],
	['Project settings', process.execPath, ['scripts/internal/verify-project-settings.mjs', moduleRoot], 0],
	['Resource workspace', process.execPath, ['scripts/internal/verify-resource-workspace.mjs', moduleRoot], 0],
	['Image source update', process.execPath, ['scripts/internal/verify-image-source-update.mjs', moduleRoot], 0],
	['Resource batch', process.execPath, ['scripts/internal/verify-resource-batch.mjs', moduleRoot], 0],
	['Resource reference query', process.execPath, ['scripts/internal/verify-resource-reference-query.mjs'], 0],
	['Fairy package transfer', process.execPath, ['scripts/internal/verify-fairy-package-transfer.mjs', moduleRoot], 0],
	['Fairy package subset export', process.execPath, ['scripts/internal/verify-fairy-package-subset-export.mjs', moduleRoot], 0],
	['Fairy package resource import', process.execPath, ['scripts/internal/verify-fairy-package-resource-import.mjs', moduleRoot], 0],
	['Phase 8 write-back policy', process.execPath, ['scripts/internal/verify-phase8-directory-writeback-policy.mjs'], 0],
	['Phase 9 reference rewrite', process.execPath, ['scripts/internal/verify-phase9-component-reference-rewrite.mjs'], 0],
	['Phase 9 transaction matrix', process.execPath, ['scripts/internal/verify-phase9-high-risk-transaction.mjs', moduleRoot], 0],
	['Command history', process.execPath, ['scripts/internal/verify-command-history.mjs'], 0],
	['Preview projection', process.execPath, ['scripts/internal/verify-authoring-preview-projection.mjs'], 0],
	['Desktop console', process.execPath, ['scripts/internal/verify-desktop-console-log.mjs'], 0],
	['Project search', process.execPath, ['scripts/internal/verify-desktop-project-search.mjs'], 0],
	['Bitmap font import', process.execPath, ['scripts/internal/verify-bitmap-font-import.mjs'], 0],
	['MovieClip import', process.execPath, ['scripts/internal/verify-movieclip-import.mjs', moduleRoot], 0],
	['MovieClip replacement', process.execPath, ['scripts/internal/verify-movieclip-replace.mjs', moduleRoot], 0],
	['Browser project ZIP', process.execPath, ['scripts/internal/verify-browser-project-zip.mjs'], 0],
	['Canvas interaction', process.execPath, ['scripts/internal/verify-desktop-canvas-interaction.mjs'], 0],
	['Hierarchy interaction', process.execPath, ['scripts/internal/verify-desktop-hierarchy-interaction.mjs'], 0],
	['Group membership', process.execPath, ['scripts/internal/verify-group-membership.mjs'], 0],
	['Copy and paste', process.execPath, ['scripts/internal/verify-desktop-copy-paste.mjs'], 0],
	['Library placement', process.execPath, ['scripts/internal/verify-desktop-library-placement.mjs'], 0],
	['Object creation', process.execPath, ['scripts/internal/verify-desktop-object-creation.mjs'], 0],
	['Component templates', process.execPath, ['scripts/internal/verify-desktop-component-templates.mjs'], 0],
	['Controller pages', process.execPath, ['scripts/internal/verify-desktop-controller-pages.mjs'], 0],
	['Relations', process.execPath, ['scripts/internal/verify-desktop-relations.mjs'], 0],
	['Typed gears', process.execPath, ['scripts/internal/verify-desktop-typed-gears.mjs'], 0],
	['Transition list', process.execPath, ['scripts/internal/verify-desktop-transition-list.mjs'], 0],
	['Timeline interaction', process.execPath, ['scripts/internal/verify-desktop-timeline-interaction.mjs'], 0],
	['Timeline path data', process.execPath, ['scripts/internal/verify-timeline-path-data.mjs'], 0],
	['Timeline custom ease save', process.execPath, ['scripts/internal/verify-timeline-custom-ease-save.mjs', moduleRoot], 0],
	['Document tabs', process.execPath, ['scripts/internal/verify-desktop-document-tabs.mjs'], 0],
	['Phase 9 dialogs', process.execPath, ['scripts/internal/verify-phase9-dialogs.mjs'], 0],
	['Phase 10 UI interactions', process.execPath, ['scripts/internal/verify-phase10-ui-interactions.mjs'], 0],
	['Inspector host layouts', process.execPath, ['scripts/internal/verify-inspector-host-layouts.mjs'], 0],
	['build', process.execPath, ['node_modules/vite/bin/vite.js', 'build'], 0],
];

for (const [label, command, args, expectedStatus] of steps) {
	const startedAt = Date.now();
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	if (result.status !== expectedStatus) {
		process.stdout.write(result.stdout ?? '');
		process.stderr.write(result.stderr ?? '');
		throw new Error(`${label} exited ${result.status}; expected ${expectedStatus}${result.error ? ` (${result.error.message})` : ''}`);
	}
	console.log(`ok ${label} (${Date.now() - startedAt} ms)`);
}

const verificationReportDir = path.resolve('verification/reports');
const reports = [
	['Phase 3', path.join(verificationReportDir, 'phase3-transaction-report.json'), (report) => report.source.packageVersion],
	['Phase 5', path.join(verificationReportDir, 'phase5-publish-report.json'), (report) => report.source.packageVersion],
	['Phase 6C', path.join(verificationReportDir, 'phase6c-live-session-report.json'), (report) => report.source.packageVersion],
	['Phase 7', path.join(verificationReportDir, 'phase7-browser-live-session-report.json'), (report) => report.source.packageVersion],
	['Phase 7B', path.join(verificationReportDir, 'phase7b-display-props-report.json'), (report) => report.source.packageVersion],
	['Phase 7C', path.join(verificationReportDir, 'phase7c-save-bridge-report.json'), (report) => report.source.packageVersion],
	['Phase 8 save', path.join(verificationReportDir, 'phase8-browser-storage-save-report.json'), (report) => report.source.packageVersion],
	['Phase 8 materialize', path.join(verificationReportDir, 'phase8-clean-materialize-report.json'), (report) => report.source.packageVersion],
	['Phase 9', path.join(verificationReportDir, 'phase9-high-risk-transaction-report.json'), (report) => report.source.packageVersions.backend],
	['Resource workspace', path.join(verificationReportDir, 'resource-workspace-report.json'), (report) => report.source.packageVersion],
];

for (const [label, reportPath, getVersion] of reports) {
	const report = readJson(reportPath);
	assert.equal(getVersion(report), expectedVersion, `${label} report must use ${expectedVersion}`);
}

const phase7c = readJson(path.join(verificationReportDir, 'phase7c-save-bridge-report.json'));
assert.ok(Date.parse(phase7c.generatedAt) >= suiteStartedAt, 'Phase 7C report must be generated by this run');
assert.equal(phase7c.source.uamFidelity, 'unsupported');
assert.equal(phase7c.results.save.ok, false);
assert.equal(phase7c.results.save.error?.code, 'uam_fidelity_unsupported');
assert.equal(phase7c.project.sourceUnchanged, true);

const phase8Materialize = readJson(path.join(verificationReportDir, 'phase8-clean-materialize-report.json'));
assert.equal(phase8Materialize.results.propertyOverrideWhitespace?.ok, true);
assert.equal(phase8Materialize.results.propertyOverrideWhitespace?.reload, true);

const phase9 = readJson(path.join(verificationReportDir, 'phase9-high-risk-transaction-report.json'));
assert.equal(phase9.results.ok, true);
assert.equal(phase9.results.operations.length, 256);
assert.equal(phase9.results.matrix.movieClipImportLifecycle, true);
assert.equal(phase9.results.matrix.bitmapFontImportLifecycle, true);
assert.equal(phase9.source.sourceUnchanged, true);

console.log(
	JSON.stringify({
		ok: true,
		openfairyguiVersion: expectedVersion,
		moduleRoot: relativeWorkspacePath(moduleRoot),
		steps: steps.length,
		durationMs: Date.now() - suiteStartedAt,
		phase7c: 'expected_uam_fidelity_guard',
		phase9Operations: phase9.results.operations.length,
	}),
);
