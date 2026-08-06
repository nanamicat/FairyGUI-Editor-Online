import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAuthoringProjectPath } from '../project-boundary.mjs';
import { cloneJson, findDisplayNode, importFile, readJson } from '../verification-helpers.mjs';

const root = process.cwd();
const backendBundlePath = path.resolve(process.argv[2] ?? 'assets/resources/editor/runtime/openfairygui-backend-browser.js');
const baselinePath = path.resolve(process.argv[3] ?? 'assets/resources/editor/runtime/uam-baseline.json');
const reportPath = path.resolve(process.argv[4] ?? 'verification/reports/phase7b-display-props-report.json');

function hydrateBaselineBinaryData(project) {
	const hydrated = cloneJson(project);
	for (const pkg of hydrated.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			const encoded = resource.sourceBytes ?? resource.binaryData;
			if (encoded?.encoding !== 'base64' || typeof encoded.data !== 'string') continue;
			delete resource.binaryData;
			resource.sourceBytes = new Uint8Array(Buffer.from(encoded.data, 'base64'));
		}
	}
	return hydrated;
}

function relativePath(filePath) {
	return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function findGraphTarget(project) {
	for (const pkg of project.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			const node = resource.component?.displayList?.find((candidate) => candidate.kind === 'graph' && candidate.id);
			if (!node) continue;
			return {
				packageId: pkg.id,
				packageName: pkg.name ?? '',
				componentResourceId: resource.id,
				componentName: resource.name ?? '',
				displayNodeId: node.id,
				displayNodeName: node.name ?? node.id,
			};
		}
	}
	return null;
}

function findLoaderTarget(project) {
	for (const pkg of project.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			const node = resource.component?.displayList?.find((candidate) => candidate.kind === 'loader' && candidate.id);
			if (!node) continue;
			return {
				packageId: pkg.id,
				packageName: pkg.name ?? '',
				componentResourceId: resource.id,
				componentName: resource.name ?? '',
				displayNodeId: node.id,
				displayNodeName: node.name ?? node.id,
			};
		}
	}
	return null;
}

function findListTarget(project, kind) {
	for (const pkg of project.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			const node = resource.component?.displayList?.find((candidate) => candidate.kind === kind && candidate.id);
			if (!node) continue;
			return {
				packageId: pkg.id,
				packageName: pkg.name ?? '',
				componentResourceId: resource.id,
				componentName: resource.name ?? '',
				displayNodeId: node.id,
				displayNodeName: node.name ?? node.id,
			};
		}
	}
	return null;
}

function findComponentInstanceTarget(project, extensionType) {
	for (const pkg of project.packages ?? []) {
		for (const resource of pkg.resources ?? []) {
			const node = resource.component?.displayList?.find(
				(candidate) => candidate.kind === 'component'
					&& candidate.id
					&& candidate.instanceProperties?.extensionType === extensionType,
			);
			if (!node) continue;
			return {
				packageId: pkg.id,
				packageName: pkg.name ?? '',
				componentResourceId: resource.id,
				componentName: resource.name ?? '',
				displayNodeId: node.id,
				displayNodeName: node.name ?? node.id,
			};
		}
	}
	return null;
}

function findSoundUrl(project) {
	for (const pkg of project.packages ?? []) {
		const resource = pkg.resources?.find((candidate) => candidate.kind === 'sound' && candidate.id);
		if (resource) return `ui://${pkg.id}${resource.id}`;
	}
	return '';
}

function summarizeGraphProperties(node) {
	return {
		graphType: Number(node.graphType ?? 0),
		lineSize: Number(node.lineSize ?? 1),
		lineColor: String(node.lineColor ?? '#000000'),
		fillColor: String(node.fillColor ?? '#FFFFFF'),
		cornerRadius: cloneJson(node.cornerRadius ?? null),
		points: cloneJson(node.points ?? null),
		sides: Number(node.sides ?? 0),
		startAngle: Number(node.startAngle ?? 0),
		distances: cloneJson(node.distances ?? null),
	};
}

function summarizeTextProperties(node) {
	return {
		text: String(node.text ?? ''),
		font: String(node.font ?? ''),
		fontSize: Number(node.fontSize ?? 12),
		color: String(node.color ?? '#000000'),
		align: Number(node.align ?? 0),
		vAlign: Number(node.vAlign ?? 0),
		leading: Number(node.leading ?? 3),
		letterSpacing: Number(node.letterSpacing ?? 0),
		autoSize: Number(node.autoSize ?? 1),
		singleLine: node.singleLine === true,
		autoClearText: node.autoClearText === true,
		demoText: String(node.demoText ?? ''),
		templateVarsEnabled: node.templateVarsEnabled === true,
		faceDilate: Number(node.faceDilate ?? 0),
		outlineSoftness: Number(node.outlineSoftness ?? 0),
		underlaySoftness: Number(node.underlaySoftness ?? 0),
		ubbEnabled: node.ubbEnabled === true,
		underline: node.underline === true,
		italic: node.italic === true,
		bold: node.bold === true,
		strikethrough: node.strikethrough === true,
		strokeColor: node.strokeColor ?? null,
		strokeSize: Number(node.strokeSize ?? 1),
		shadowColor: node.shadowColor ?? null,
		shadowOffset: cloneJson(node.shadowOffset ?? { x: 0, y: 0 }),
	};
}

function summarizeLoaderProperties(node) {
	return {
		url: String(node.url ?? ''),
		fill: Number(node.fill ?? 0),
		shrinkOnly: node.shrinkOnly === true,
		autoSize: node.autoSize === true,
		useResize: node.useResize === true,
		align: Number(node.align ?? 0),
		vAlign: Number(node.vAlign ?? 0),
		frame: Number(node.frame ?? 0),
		playing: node.playing !== false,
		color: String(node.color ?? '#FFFFFF'),
		fillMethod: Number(node.fillMethod ?? 0),
		fillOrigin: Number(node.fillOrigin ?? 0),
		fillClockwise: node.fillClockwise !== false,
		fillAmount: Number(node.fillAmount ?? 100),
		clearOnPublish: node.clearOnPublish === true,
	};
}

function summarizeListProperties(node) {
	const properties = {
		layout: Number(node.layout ?? 0),
		align: Number(node.align ?? 0),
		vAlign: Number(node.vAlign ?? 0),
		lineGap: Number(node.lineGap ?? 0),
		columnGap: Number(node.columnGap ?? 0),
		lineCount: Number(node.lineCount ?? 0),
		columnCount: Number(node.columnCount ?? 0),
		selectionMode: Number(node.selectionMode ?? 0),
		defaultItem: String(node.defaultItem ?? ''),
		autoResizeItem: node.autoResizeItem !== false,
		childrenRenderOrder: Number(node.childrenRenderOrder ?? 0),
		apexIndex: Number(node.apexIndex ?? 0),
		src: String(node.src ?? ''),
		overflow: Number(node.overflow ?? 0),
		scrollType: Number(node.scrollType ?? 1),
		scrollBarDisplay: Number(node.scrollBarDisplay ?? 0),
		scrollBarFlags: Number(node.scrollBarFlags ?? 0),
		scrollBarMargin: cloneJson(node.scrollBarMargin ?? { top: 0, bottom: 0, left: 0, right: 0 }),
		vtScrollBarRes: String(node.vtScrollBarRes ?? ''),
		hzScrollBarRes: String(node.hzScrollBarRes ?? ''),
		headerRes: String(node.headerRes ?? ''),
		footerRes: String(node.footerRes ?? ''),
		margin: cloneJson(node.margin ?? { top: 0, bottom: 0, left: 0, right: 0 }),
		clipSoftness: cloneJson(node.clipSoftness ?? { x: 0, y: 0 }),
		scrollItemToViewOnClick: node.scrollItemToViewOnClick !== false,
		foldInvisibleItems: node.foldInvisibleItems === true,
		autoClearItems: node.autoClearItems === true,
		listItems: cloneJson((node.listItems ?? []).map((item) => ({ ...item, controllers: item.controllers ?? null }))),
		pageController: String(node.pageController ?? ''),
		controllerOverrides: String(node.controllerOverrides ?? ''),
		selectionController: String(node.selectionController ?? ''),
	};
	return node.kind === 'tree'
		? {
			...properties,
			treeView: node.treeView !== false,
			indent: Number(node.indent ?? 0),
			clickToExpand: Number(node.clickToExpand ?? 0),
		}
		: properties;
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
		locked: node.locked === true,
		aspect: node.aspect === true,
		minSize: cloneJson(node.minSize ?? { width: 0, height: 0 }),
		maxSize: cloneJson(node.maxSize ?? { width: 0, height: 0 }),
		scale: cloneJson(node.scale ?? { x: 1, y: 1 }),
		skew: cloneJson(node.skew ?? { x: 0, y: 0 }),
		text: String(node.text ?? ''),
		visible: node.visible !== false,
		tooltips: String(node.tooltips ?? ''),
		blendMode: String(node.blendMode ?? 'normal'),
		filter: String(node.filter ?? ''),
		filterData: String(node.filterData ?? ''),
		pivotX: Number(node.pivot?.x ?? 0),
		pivotY: Number(node.pivot?.y ?? 0),
		pivotAsAnchor: node.pivotAsAnchor === true,
		customData: String(node.customData ?? ''),
		font: String(node.font ?? ''),
		fontSize: Number(node.fontSize ?? 0),
		color: String(node.color ?? ''),
	};
}

function applyPropsToState(state, props) {
	return {
		...state,
		x: props.position ? props.position.x : state.x,
		y: props.position ? props.position.y : state.y,
		width: props.size ? props.size.width : state.width,
		height: props.size ? props.size.height : state.height,
		locked: props.locked !== undefined ? props.locked : state.locked,
		aspect: props.aspect !== undefined ? props.aspect : state.aspect,
		minSize: props.minSize ?? state.minSize,
		maxSize: props.maxSize ?? state.maxSize,
		scale: props.scale ?? state.scale,
		skew: props.skew ?? state.skew,
		text: props.text !== undefined ? props.text : state.text,
		visible: props.visible !== undefined ? props.visible : state.visible,
		tooltips: props.tooltips !== undefined ? props.tooltips : state.tooltips,
		blendMode: props.blendMode !== undefined ? props.blendMode : state.blendMode,
		filter: props.filter !== undefined ? props.filter : state.filter,
		filterData: props.filterData !== undefined ? props.filterData : state.filterData,
		pivotX: props.pivot ? props.pivot.x : state.pivotX,
		pivotY: props.pivot ? props.pivot.y : state.pivotY,
		pivotAsAnchor: props.pivotAsAnchor !== undefined ? props.pivotAsAnchor : state.pivotAsAnchor,
		customData: props.customData !== undefined ? props.customData : state.customData,
		font: props.font !== undefined ? props.font : state.font,
		fontSize: props.fontSize !== undefined ? props.fontSize : state.fontSize,
		color: props.color !== undefined ? props.color : state.color,
	};
}

function summarizeBackendResult(result) {
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
		dirty: result.session?.dirty ?? result.snapshot?.dirty,
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

async function main() {
	assert(existsSync(backendBundlePath), `Missing Phase 7 backend browser bundle: ${backendBundlePath}`);
	assert(existsSync(baselinePath), `Missing Phase 7 UAM baseline: ${baselinePath}`);

	const baseline = readJson(baselinePath);
	assert(baseline.schemaVersion === 1 || baseline.schemaVersion === 2, 'Unsupported Phase 7 UAM baseline schema.');
	assert(baseline.uamProject && baseline.target, 'Phase 7 UAM baseline is missing uamProject or target.');
	const uamProject = hydrateBaselineBinaryData(baseline.uamProject);

	const backendBundle = await importFile(backendBundlePath);
	assert(typeof backendBundle.BackendRuntime === 'function', 'Backend bundle does not export BackendRuntime.');

	const beforeNode = findDisplayNode(uamProject, baseline.target);
	assert(beforeNode, 'Phase 7B target node not found in UAM baseline.');
	const before = summarizeNode(beforeNode);
	const graphTarget = findGraphTarget(uamProject);
	assert(graphTarget, 'Phase 7B graph target node not found in UAM baseline.');
	const graphBeforeNode = findDisplayNode(uamProject, graphTarget);
	assert(graphBeforeNode?.kind === 'graph', 'Phase 7B graph target is not a graph node.');
	const graphBefore = summarizeGraphProperties(graphBeforeNode);
	const graphAfter = {
		...graphBefore,
		graphType: 4,
		lineSize: 2,
		lineColor: '#123456',
		fillColor: '#abcdef',
		cornerRadius: [1, 2, 3, 4],
		points: [0, 0, 100, 0, 50, 100],
		sides: 5,
		startAngle: 18,
		distances: [1, 0.8, 1, 0.8, 1],
	};
	const groupTarget = findListTarget(uamProject, 'group');
	assert(groupTarget, 'Phase 7B group target node not found in UAM baseline.');
	const groupBeforeNode = findDisplayNode(uamProject, groupTarget);
	assert(groupBeforeNode?.kind === 'group', 'Phase 7B group target is not a group node.');
	const groupBefore = {
		layout: Number(groupBeforeNode.layout ?? 0),
		lineGap: Number(groupBeforeNode.lineGap ?? 0),
		columnGap: Number(groupBeforeNode.columnGap ?? 0),
		advanced: groupBeforeNode.advanced === true,
		excludeInvisibles: groupBeforeNode.excludeInvisibles === true,
		autoSizeDisabled: groupBeforeNode.autoSizeDisabled === true,
		mainGridIndex: Number(groupBeforeNode.mainGridIndex ?? -1),
	};
	const groupAfter = {
		layout: 1,
		lineGap: 4,
		columnGap: 6,
		advanced: true,
		excludeInvisibles: true,
		autoSizeDisabled: true,
		mainGridIndex: 0,
	};
	const loaderTarget = findLoaderTarget(uamProject);
	assert(loaderTarget, 'Phase 7B loader target node not found in UAM baseline.');
	const loaderBeforeNode = findDisplayNode(uamProject, loaderTarget);
	assert(loaderBeforeNode?.kind === 'loader', 'Phase 7B loader target is not a loader node.');
	const loaderBefore = summarizeLoaderProperties(loaderBeforeNode);
	const loaderAfter = {
		...loaderBefore,
		fill: loaderBefore.fill === 4 ? 1 : 4,
		shrinkOnly: !loaderBefore.shrinkOnly,
		useResize: !loaderBefore.useResize,
		align: (loaderBefore.align + 1) % 3,
		vAlign: (loaderBefore.vAlign + 2) % 3,
		frame: loaderBefore.frame + 2,
		playing: !loaderBefore.playing,
		color: loaderBefore.color.toLowerCase() === '#a1b2c3' ? '#FFFFFF' : '#A1B2C3',
		fillMethod: 3,
		fillOrigin: 2,
		fillClockwise: !loaderBefore.fillClockwise,
		fillAmount: loaderBefore.fillAmount === 42.5 ? 65 : 42.5,
		clearOnPublish: !loaderBefore.clearOnPublish,
	};
	const openFairyGui023Targets = [
		{
			kind: 'image',
			propertyName: 'imageProperties',
			read: (node) => ({
				color: String(node.color ?? '#FFFFFF'),
				flip: Number(node.flip ?? 0),
				fillMethod: Number(node.fillMethod ?? 0),
				fillOrigin: Number(node.fillOrigin ?? 0),
				fillClockwise: node.fillClockwise !== false,
				fillAmount: Number(node.fillAmount ?? 100),
			}),
			change: (before) => ({ ...before, color: '#A1B2C3', flip: 3, fillMethod: 3, fillOrigin: 1, fillClockwise: false, fillAmount: 0.42 }),
		},
		{
			kind: 'movieClip',
			propertyName: 'movieClipProperties',
			read: (node) => ({ playing: node.playing !== false, frame: Number(node.frame ?? 0), color: String(node.color ?? '#FFFFFF') }),
			change: (before) => ({ ...before, playing: !before.playing, frame: before.frame + 1, color: '#C3B2A1' }),
		},
		{
			kind: 'text',
			propertyName: 'textProperties',
			read: summarizeTextProperties,
			change: (before) => ({ ...before, outlineSoftness: before.outlineSoftness === 0.25 ? 0.5 : 0.25 }),
		},
	].map((definition) => {
		const target = findListTarget(uamProject, definition.kind);
		assert(target, `Phase 7B ${definition.kind} target node not found in UAM baseline.`);
		const node = findDisplayNode(uamProject, target);
		const before = definition.read(node);
		return { ...definition, target, before, after: definition.change(before) };
	});
	const listTargets = ['list', 'tree'].map((kind) => {
		const target = findListTarget(uamProject, kind);
		assert(target, `Phase 7B ${kind} target node not found in UAM baseline.`);
		const node = findDisplayNode(uamProject, target);
		assert(node?.kind === kind, `Phase 7B ${kind} target has the wrong kind.`);
		const before = summarizeListProperties(node);
		const after = {
			...before,
			layout: 4,
			lineGap: before.lineGap + 2,
			columnGap: before.columnGap + 3,
			lineCount: Math.max(1, before.lineCount + 1),
			columnCount: Math.max(1, before.columnCount + 1),
			childrenRenderOrder: 2,
			apexIndex: 1,
			scrollBarFlags: before.scrollBarFlags ^ 2048,
			scrollBarDisplay: (before.scrollBarDisplay + 1) % 4,
			margin: { top: 1, bottom: 2, left: 3, right: 4 },
			clipSoftness: { x: 2, y: 3 },
			scrollItemToViewOnClick: !before.scrollItemToViewOnClick,
			foldInvisibleItems: !before.foldInvisibleItems,
			autoClearItems: !before.autoClearItems,
			listItems: [
				...before.listItems,
				{
					title: `Phase 7B ${kind}`,
					icon: null,
					url: before.defaultItem || null,
					name: `phase7b-${kind}`,
					selectedTitle: null,
					selectedIcon: null,
					level: 0,
					isFolder: kind === 'tree' ? false : null,
					controllers: null,
					propertyOverrides: [
						{ target: 'n0', propertyId: 0, value: '  Phase 7B override  ' },
						{ target: 'n0', propertyId: 1, value: ' ' },
					],
				},
			],
			...(kind === 'tree'
				? {
					treeView: true,
					indent: before.indent + 2,
					clickToExpand: before.clickToExpand === 2 ? 1 : 2,
				}
				: {}),
		};
		return { kind, target, before, after };
	});
	const soundUrl = findSoundUrl(uamProject);
	assert(soundUrl, 'Phase 7B sound resource target not found in UAM baseline.');
	const componentInstanceTargets = ['Button', 'Label', 'ComboBox', 'ProgressBar'].map((extensionType) => {
		const target = findComponentInstanceTarget(uamProject, extensionType);
		assert(target, `Phase 7B ${extensionType} component instance target not found in UAM baseline.`);
		const node = findDisplayNode(uamProject, target);
		assert(node?.instanceProperties?.extensionType === extensionType, `Phase 7B component instance target is not ${extensionType}.`);
		const before = cloneJson(node.instanceProperties);
		const after = extensionType === 'Button'
			? { ...before, title: `${before.title || 'Button'} Phase 7B`, checked: !before.checked, soundVolumeScale: 0.75 }
			: extensionType === 'Label'
				? { ...before, sound: soundUrl, soundVolumeScale: 0.65 }
				: extensionType === 'ComboBox'
					? { ...before, titleColor: '#123456', popupDirection: 2, sound: soundUrl, soundVolumeScale: 0.55 }
					: { ...before, sound: soundUrl, soundVolumeScale: 0.45 };
		return { extensionType, target, before, after };
	});
	const selector = {
		packageId: baseline.target.packageId,
		componentResourceId: baseline.target.componentResourceId,
		displayNodeId: baseline.target.displayNodeId,
	};
	const props = {
		position: {
			x: before.x + 18,
			y: before.y + 6,
		},
		size: {
			width: Math.max(1, before.width + 12),
			height: Math.max(1, before.height + 4),
		},
		locked: !before.locked,
		aspect: !before.aspect,
		minSize: { width: before.minSize.width + 1, height: before.minSize.height + 2 },
		maxSize: { width: 900, height: 700 },
		scale: { x: 1.25, y: 0.75 },
		skew: { x: 5, y: 7 },
		visible: false,
		tooltips: 'Phase 7B tooltip',
		blendMode: 'add',
		filter: 'color',
		filterData: '1,0,0,0',
		pivot: {
			x: before.pivotX + 0.125,
			y: before.pivotY + 0.25,
		},
		pivotAsAnchor: !before.pivotAsAnchor,
		customData: before.customData === 'Phase 7B custom data' ? '' : 'Phase 7B custom data',
		text: before.text ? `${before.text}#` : 'Phase 7B',
		font: before.font === '微软雅黑' ? '' : '微软雅黑',
		fontSize: Math.max(1, before.fontSize + 2),
		color: before.color.toLowerCase() === '#0099ff' ? '#ff0099' : '#0099ff',
	};
	const inverseProps = {
		position: {
			x: before.x,
			y: before.y,
		},
		size: {
			width: before.width,
			height: before.height,
		},
		locked: before.locked,
		aspect: before.aspect,
		minSize: before.minSize,
		maxSize: before.maxSize,
		scale: before.scale,
		skew: before.skew,
		visible: before.visible,
		tooltips: before.tooltips,
		blendMode: before.blendMode,
		filter: before.filter,
		filterData: before.filterData,
		pivot: {
			x: before.pivotX,
			y: before.pivotY,
		},
		pivotAsAnchor: before.pivotAsAnchor,
		customData: before.customData,
		text: before.text,
		font: before.font,
		fontSize: before.fontSize,
		color: before.color,
	};
	const operation = {
		opId: 'phase7b-display-props-command',
		kind: 'setDisplayNodeProps',
		selector,
		props,
	};
	const inverseOperation = {
		opId: 'phase7b-display-props-command-undo',
		kind: 'setDisplayNodeProps',
		selector,
		props: inverseProps,
	};

	const runtime = new backendBundle.BackendRuntime();
	const opened = runtime.openProjectSession({
		project: cloneJson(uamProject),
		canonicalProjectPath: 'memory://phase7b-display-props-command',
	});
	assert(opened.ok, `Phase 7B openProjectSession failed: ${JSON.stringify(opened)}`);

	const applied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: opened.data.revision,
		operations: [operation],
	});
	assert(applied.ok, `Phase 7B applyTransaction failed: ${JSON.stringify(applied)}`);

	const undone = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: applied.data.revision,
		operations: [inverseOperation],
	});
	assert(undone.ok, `Phase 7B inverse transaction failed: ${JSON.stringify(undone)}`);

	const graphOperation = {
		opId: 'phase7b-graph-properties-command',
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: graphTarget.packageId,
			componentResourceId: graphTarget.componentResourceId,
			displayNodeId: graphTarget.displayNodeId,
		},
		props: { graphProperties: graphAfter },
	};
	const graphApplied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: undone.data.revision,
		operations: [graphOperation],
	});
	assert(graphApplied.ok, `Phase 7B graph transaction failed: ${JSON.stringify(graphApplied)}`);
	const graphInverseOperation = {
		...graphOperation,
		opId: 'phase7b-graph-properties-command-undo',
		props: { graphProperties: graphBefore },
	};
	const graphUndone = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: graphApplied.data.revision,
		operations: [graphInverseOperation],
	});
	assert(graphUndone.ok, `Phase 7B graph inverse transaction failed: ${JSON.stringify(graphUndone)}`);

	const groupOperation = {
		opId: 'phase7b-group-properties-command',
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: groupTarget.packageId,
			componentResourceId: groupTarget.componentResourceId,
			displayNodeId: groupTarget.displayNodeId,
		},
		props: { groupProperties: groupAfter },
	};
	const groupApplied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: graphUndone.data.revision,
		operations: [groupOperation],
	});
	assert(groupApplied.ok, `Phase 7B group transaction failed: ${JSON.stringify(groupApplied)}`);
	const groupInverseOperation = {
		...groupOperation,
		opId: 'phase7b-group-properties-command-undo',
		props: { groupProperties: groupBefore },
	};
	const groupUndone = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: groupApplied.data.revision,
		operations: [groupInverseOperation],
	});
	assert(groupUndone.ok, `Phase 7B group inverse transaction failed: ${JSON.stringify(groupUndone)}`);

	const loaderOperation = {
		opId: 'phase7b-loader-properties-command',
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: loaderTarget.packageId,
			componentResourceId: loaderTarget.componentResourceId,
			displayNodeId: loaderTarget.displayNodeId,
		},
		props: { loaderProperties: loaderAfter },
	};
	const loaderApplied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: groupUndone.data.revision,
		operations: [loaderOperation],
	});
	assert(loaderApplied.ok, `Phase 7B loader transaction failed: ${JSON.stringify(loaderApplied)}`);
	const loaderInverseOperation = {
		...loaderOperation,
		opId: 'phase7b-loader-properties-command-undo',
		props: { loaderProperties: loaderBefore },
	};
	const loaderUndone = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: loaderApplied.data.revision,
		operations: [loaderInverseOperation],
	});
	assert(loaderUndone.ok, `Phase 7B loader inverse transaction failed: ${JSON.stringify(loaderUndone)}`);

	const openFairyGui023Operations = openFairyGui023Targets.map(({ kind, propertyName, target, after }) => ({
		opId: `phase7b-023-${kind}-properties-command`,
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: target.packageId,
			componentResourceId: target.componentResourceId,
			displayNodeId: target.displayNodeId,
		},
		props: { [propertyName]: after },
	}));
	const openFairyGui023Applied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: loaderUndone.data.revision,
		operations: openFairyGui023Operations,
	});
	assert(openFairyGui023Applied.ok, `Phase 7B OpenFairyGUI 0.2.4 transaction failed: ${JSON.stringify(openFairyGui023Applied)}`);
	const openFairyGui023InverseOperations = openFairyGui023Targets.map(({ kind, propertyName, target, before }) => ({
		opId: `phase7b-023-${kind}-properties-command-undo`,
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: target.packageId,
			componentResourceId: target.componentResourceId,
			displayNodeId: target.displayNodeId,
		},
		props: { [propertyName]: before },
	}));
	const openFairyGui023Undone = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: openFairyGui023Applied.data.revision,
		operations: openFairyGui023InverseOperations,
	});
	assert(openFairyGui023Undone.ok, `Phase 7B OpenFairyGUI 0.2.4 inverse transaction failed: ${JSON.stringify(openFairyGui023Undone)}`);

	const listOperations = listTargets.map(({ kind, target, after }) => ({
		opId: `phase7b-${kind}-properties-command`,
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: target.packageId,
			componentResourceId: target.componentResourceId,
			displayNodeId: target.displayNodeId,
		},
		props: { listProperties: after },
	}));
	const listApplied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: openFairyGui023Undone.data.revision,
		operations: listOperations,
	});
	assert(listApplied.ok, `Phase 7B list/tree transaction failed: ${JSON.stringify(listApplied)}`);
	const listInverseOperations = listTargets.map(({ kind, target, before }) => ({
		opId: `phase7b-${kind}-properties-command-undo`,
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: target.packageId,
			componentResourceId: target.componentResourceId,
			displayNodeId: target.displayNodeId,
		},
		props: { listProperties: before },
	}));
	const listUndone = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: listApplied.data.revision,
		operations: listInverseOperations,
	});
	assert(listUndone.ok, `Phase 7B list/tree inverse transaction failed: ${JSON.stringify(listUndone)}`);

	const componentInstanceOperations = componentInstanceTargets.map(({ extensionType, target, after }) => ({
		opId: `phase7b-${extensionType.toLowerCase()}-instance-properties-command`,
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: target.packageId,
			componentResourceId: target.componentResourceId,
			displayNodeId: target.displayNodeId,
		},
		props: { componentInstanceProperties: after },
	}));
	const componentInstanceApplied = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: listUndone.data.revision,
		operations: componentInstanceOperations,
	});
	assert(
		componentInstanceApplied.ok,
		`Phase 7B component instance transaction failed: ${JSON.stringify(componentInstanceApplied)}`,
	);
	const componentInstanceInverseOperations = componentInstanceTargets.map(({ extensionType, target, before }) => ({
		opId: `phase7b-${extensionType.toLowerCase()}-instance-properties-command-undo`,
		kind: 'setDisplayNodeProps',
		selector: {
			packageId: target.packageId,
			componentResourceId: target.componentResourceId,
			displayNodeId: target.displayNodeId,
		},
		props: { componentInstanceProperties: before },
	}));
	const componentInstanceUndone = await runtime.applyTransaction({
		sessionId: opened.data.sessionId,
		expectedRevision: componentInstanceApplied.data.revision,
		operations: componentInstanceInverseOperations,
	});
	assert(
		componentInstanceUndone.ok,
		`Phase 7B component instance inverse transaction failed: ${JSON.stringify(componentInstanceUndone)}`,
	);

	const saved = await runtime.saveSession({ sessionId: opened.data.sessionId });
	assert(!saved.ok, 'Phase 7B saveSession unexpectedly succeeded without a filesystem adapter.');

	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		source: {
			packageName: baseline.source.packageName,
			packageVersion: baseline.source.packageVersion,
			packageVersions: baseline.source.packageVersions,
			projectPath: relativePath(resolveAuthoringProjectPath()),
			bundlePath: relativePath(backendBundlePath),
			baselinePath: relativePath(baselinePath),
			bundleBytes: statSync(backendBundlePath).size,
			baselineBytes: statSync(baselinePath).size,
			backendContractVersion: backendBundle.BACKEND_CONTRACT_VERSION,
			capabilitySchemaVersion: backendBundle.BACKEND_CAPABILITY_SCHEMA_VERSION,
			mode: 'phase7b_browser_memory_session_display_props',
		},
		target: baseline.target,
		command: {
			kind: 'setDisplayNodeProps',
			props: Object.keys(props),
		},
		operation,
		inverseOperation,
		graph: {
			target: graphTarget,
			before: graphBefore,
			after: graphAfter,
			operation: graphOperation,
			inverseOperation: graphInverseOperation,
		},
		group: {
			target: groupTarget,
			before: groupBefore,
			after: groupAfter,
			operation: groupOperation,
			inverseOperation: groupInverseOperation,
		},
		loader: {
			target: loaderTarget,
			before: loaderBefore,
			after: loaderAfter,
			operation: loaderOperation,
			inverseOperation: loaderInverseOperation,
		},
		openFairyGui023: {
			targets: openFairyGui023Targets.map(({ kind, propertyName, target, before, after }) => ({ kind, propertyName, target, before, after })),
			operations: openFairyGui023Operations,
			inverseOperations: openFairyGui023InverseOperations,
		},
		listAndTree: {
			targets: listTargets,
			operations: listOperations,
			inverseOperations: listInverseOperations,
		},
		componentInstances: {
			targets: componentInstanceTargets,
			operations: componentInstanceOperations,
			inverseOperations: componentInstanceInverseOperations,
		},
		results: {
			openSession: summarizeBackendResult(opened),
			apply: summarizeBackendResult(applied),
			undo: summarizeBackendResult(undone),
			graphApply: summarizeBackendResult(graphApplied),
			graphUndo: summarizeBackendResult(graphUndone),
			groupApply: summarizeBackendResult(groupApplied),
			groupUndo: summarizeBackendResult(groupUndone),
			loaderApply: summarizeBackendResult(loaderApplied),
			loaderUndo: summarizeBackendResult(loaderUndone),
			openFairyGui023Apply: summarizeBackendResult(openFairyGui023Applied),
			openFairyGui023Undo: summarizeBackendResult(openFairyGui023Undone),
			listApply: summarizeBackendResult(listApplied),
			listUndo: summarizeBackendResult(listUndone),
			componentInstanceApply: summarizeBackendResult(componentInstanceApplied),
			componentInstanceUndo: summarizeBackendResult(componentInstanceUndone),
			save: summarizeBackendResult(saved),
		},
		preview: {
			before,
			after: applyPropsToState(before, props),
			undone: applyPropsToState(applyPropsToState(before, props), inverseProps),
		},
		diagnostics: [
			{
				severity: 'info',
				code: 'PHASE7B_DISPLAY_PROPS_COMMAND_VERIFIED',
				message:
					'OpenFairyGUI browser backend memory session accepted common display-object, group, geometry, pivot/anchor, customData, visibility, text, graph, loader, list/tree scrolling, and 0.2.4 component instance properties through setDisplayNodeProps transactions.',
			},
			{
				severity: 'info',
				code: 'PHASE7B_SAVE_BOUNDARY_UNCHANGED',
				message:
					'The session remains browser memory only; persistent authoring project save still requires a browser storage adapter.',
			},
		],
	};
	mkdirSync(path.dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

	console.log(
		JSON.stringify(
			{
				ok: true,
				report: relativePath(reportPath),
				packageVersion: report.source.packageVersion,
				packageVersions: report.source.packageVersions,
				target: report.target,
				props: report.command.props,
				applyRevision: report.results.apply.revision,
				undoRevision: report.results.undo.revision,
				graphApplyRevision: report.results.graphApply.revision,
				graphUndoRevision: report.results.graphUndo.revision,
				groupApplyRevision: report.results.groupApply.revision,
				groupUndoRevision: report.results.groupUndo.revision,
				loaderApplyRevision: report.results.loaderApply.revision,
				loaderUndoRevision: report.results.loaderUndo.revision,
				listApplyRevision: report.results.listApply.revision,
				listUndoRevision: report.results.listUndo.revision,
				componentInstanceApplyRevision: report.results.componentInstanceApply.revision,
				componentInstanceUndoRevision: report.results.componentInstanceUndo.revision,
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
				backendBundlePath,
				baselinePath,
				reportPath,
			},
			null,
			2,
		),
	);
	process.exit(1);
});
