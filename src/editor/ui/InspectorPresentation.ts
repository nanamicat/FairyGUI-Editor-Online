import type {
    BrowserSaveResult,
    BrowserSaveTarget,
    BrowserWorkspaceLifecycleResult,
} from "../model/BrowserWorkspace";
import type {
    EditorProjectSnapshot,
    ProjectSnapshotComponent,
    ProjectSnapshotDisplayNode,
    ProjectSnapshotPackage,
} from "../model/ProjectSnapshot";
import type { AuthoringPreviewProjectionPlan } from "../runtime/AuthoringPreviewProjection";

export type SnapshotInspectorPresentation = {
    leadingLines: string[];
};

export function buildSnapshotInspectorPresentation(options: {
    snapshot: EditorProjectSnapshot;
    selectedPackage: ProjectSnapshotPackage | null;
    selectedComponent: ProjectSnapshotComponent | null;
    selectedNode: ProjectSnapshotDisplayNode | null;
    selectedNodeCount: number;
}): SnapshotInspectorPresentation {
    const projectLines = buildProjectLines(options.snapshot, options.selectedPackage, options.selectedComponent);
    const nodeLines = buildNodeLines(options.selectedNode, options.selectedNodeCount);
    return options.selectedNode
        ? { leadingLines: nodeLines }
        : { leadingLines: projectLines };
}

export function describeSaveTarget(target: BrowserSaveTarget): string {
    if (target.kind === "transaction" || target.kind === "transactionBatch") return target.description;
    return target.expected.name || target.expected.id;
}

export function getBrowserSaveFailure(result: BrowserSaveResult): string {
    return result.writeback?.errorCode
        || result.writeback?.message
        || result.results.save.errorCode
        || result.results.save.message
        || result.results.reload.message
        || "unknown";
}

export function getWorkspaceLifecycleFailure(result: BrowserWorkspaceLifecycleResult): string {
    return result.results.materialize?.errorCode
        || result.results.materialize?.message
        || result.results.apply?.errorCode
        || result.results.apply?.message
        || result.results.save?.errorCode
        || result.results.save?.message
        || result.results.reload?.message
        || result.diagnostics[0]?.message
        || "unknown";
}

export function describeAuthoringPreviewProjection(
    projection: AuthoringPreviewProjectionPlan | null,
): string {
    if (!projection) return "Authoring canvas refreshed for the active component.";
    if (projection.status === "unaffected") {
        return projection.runtimeStatus === "publish-required"
            ? "Publish to update the runtime preview."
            : "Canvas is current.";
    }
    return projection.runtimeStatus === "publish-required"
        ? "Canvas updated. Publish to update the runtime preview."
        : "Canvas updated.";
}

function buildProjectLines(
    snapshot: EditorProjectSnapshot,
    selectedPackage: ProjectSnapshotPackage | null,
    selectedComponent: ProjectSnapshotComponent | null,
): string[] {
    if (selectedComponent) {
        return [
            `组件：${selectedComponent.name}`,
            `${selectedComponent.width} × ${selectedComponent.height} · ${selectedComponent.childCount} 个对象`,
        ];
    }
    if (selectedPackage) {
        return [
            `资源包：${selectedPackage.name}`,
            `${selectedPackage.resources.length} 个资源 · ${selectedPackage.components.length} 个组件`,
        ];
    }
    return [
        "项目",
        `${snapshot.totals.packages} 个资源包 · ${snapshot.totals.components} 个组件`,
    ];
}

function buildNodeLines(
    node: ProjectSnapshotDisplayNode | null,
    selectedNodeCount: number,
): string[] {
    if (!node) return [];
    if (selectedNodeCount > 1) {
        return [`已选择 ${selectedNodeCount} 个对象`, `主对象：${node.name || node.id}`];
    }
    return [node.name || node.id, node.type];
}
