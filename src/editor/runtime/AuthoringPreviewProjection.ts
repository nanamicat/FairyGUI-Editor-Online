import type { EditorCommandOperation } from "../model/EditorCommand";
import type { ProjectSnapshotComponent } from "../model/ProjectSnapshot";

export type AuthoringPreviewProjectionCapability =
    | "live-properties"
    | "live-structure"
    | "live-model"
    | "unaffected"
    | "publish-required";

export const AUTHORING_PREVIEW_PROJECTION_MATRIX: Record<
    EditorCommandOperation["kind"],
    AuthoringPreviewProjectionCapability
> = {
    setDisplayNodeProps: "live-properties",
    setComponentProps: "live-model",
    setImageResourceProps: "publish-required",
    attachDisplayNode: "live-structure",
    detachDisplayNode: "live-structure",
    replaceResourceBytes: "publish-required",
    removeResource: "publish-required",
    addController: "live-model",
    updateController: "live-model",
    removeController: "live-model",
    addTransition: "live-model",
    updateTransition: "live-model",
    removeTransition: "live-model",
    addLookGear: "live-model",
    updateLookGear: "live-model",
    removeLookGear: "live-model",
    addGear: "live-model",
    updateGear: "live-model",
    removeGear: "live-model",
    renameResource: "unaffected",
    moveResource: "unaffected",
    setResourceFavorite: "unaffected",
    setResourceFolderFavorite: "unaffected",
    setResourceExported: "unaffected",
    addResourceFolder: "unaffected",
    renameResourceFolder: "unaffected",
    moveResourceFolder: "unaffected",
    removeResourceFolder: "unaffected",
    addResource: "publish-required",
    addPackage: "unaffected",
    renamePackage: "unaffected",
    removePackage: "unaffected",
    addComponent: "unaffected",
    moveComponent: "unaffected",
    removeComponent: "unaffected",
    updateProjectSettings: "publish-required",
    updatePackageSettings: "publish-required",
    addBranch: "publish-required",
    renameBranch: "publish-required",
    removeBranch: "publish-required",
};

export interface AuthoringPreviewProjectionPlan {
    status: "applied" | "unaffected";
    mode: "properties" | "structure" | "model" | "none";
    runtimeStatus: "current" | "publish-required";
    reason: string;
}

export type ProjectionInvalidation =
    | "preserve-runtime-preview"
    | "refresh-runtime-preview";

export function planAuthoringPreviewProjection(
    operations: EditorCommandOperation[],
    packageId: string,
    component: ProjectSnapshotComponent,
): AuthoringPreviewProjectionPlan {
    let mode: AuthoringPreviewProjectionPlan["mode"] = "none";
    let runtimeStatus: AuthoringPreviewProjectionPlan["runtimeStatus"] = "current";

    for (const operation of operations) {
        const capability = AUTHORING_PREVIEW_PROJECTION_MATRIX[operation.kind];
        if (capability === "unaffected") continue;

        if (operation.kind === "addResource") {
            mode = "model";
            runtimeStatus = "publish-required";
            continue;
        }

        if (
            operation.kind === "updateProjectSettings"
            || operation.kind === "updatePackageSettings"
            || operation.kind === "addBranch"
            || operation.kind === "renameBranch"
            || operation.kind === "removeBranch"
        ) {
            runtimeStatus = "publish-required";
            continue;
        }

        if (
            operation.kind === "setImageResourceProps"
            || operation.kind === "replaceResourceBytes"
            || operation.kind === "removeResource"
        ) {
            runtimeStatus = "publish-required";
            const referenced = component.children.some((node) => node.src === operation.selector.resourceId);
            if (!referenced) continue;
            mode = "model";
            continue;
        }

        if (!targetsComponent(operation, packageId, component.id)) continue;

        if (
            operation.kind === "setDisplayNodeProps"
            && (
                operation.props.textProperties
                || operation.props.textInputProperties
                || operation.props.imageProperties
                || operation.props.movieClipProperties
                || operation.props.loaderProperties
                || operation.props.loader3DProperties
                || operation.props.listProperties
                || operation.props.componentInstanceProperties !== undefined
                || operation.props.componentCustomPropertyValues !== undefined
                || operation.props.componentControllerPageOverrides !== undefined
            )
        ) {
            runtimeStatus = "publish-required";
        }
        if (capability === "live-model") {
            mode = mode === "structure" ? mode : "model";
            runtimeStatus = "publish-required";
            continue;
        }
        if (capability === "live-structure") {
            mode = "structure";
            runtimeStatus = "publish-required";
            continue;
        }
        if (capability === "live-properties" && mode === "none") {
            mode = "properties";
        }
    }

    return mode === "none"
        ? {
            status: "unaffected",
            mode,
            runtimeStatus,
            reason: runtimeStatus === "publish-required"
                ? "The selected component is unchanged; Publish is required to refresh runtime behavior."
                : "This action does not affect the selected component.",
        }
        : {
            status: "applied",
            mode,
            runtimeStatus,
            reason: mode === "properties"
                ? "Canvas properties updated."
                : mode === "structure"
                    ? "Canvas objects updated."
                    : "Canvas updated; Publish is required to refresh runtime behavior.",
        };
}

function targetsComponent(
    operation: EditorCommandOperation,
    packageId: string,
    componentResourceId: string,
): boolean {
    if (
        operation.kind === "setDisplayNodeProps"
        || operation.kind === "setComponentProps"
        || operation.kind === "detachDisplayNode"
        || operation.kind === "addLookGear"
        || operation.kind === "updateLookGear"
        || operation.kind === "removeLookGear"
        || operation.kind === "addGear"
        || operation.kind === "updateGear"
        || operation.kind === "removeGear"
        || operation.kind === "attachDisplayNode"
        || operation.kind === "addController"
        || operation.kind === "updateController"
        || operation.kind === "removeController"
        || operation.kind === "addTransition"
        || operation.kind === "updateTransition"
        || operation.kind === "removeTransition"
    ) {
        return operation.selector.packageId === packageId
            && operation.selector.componentResourceId === componentResourceId;
    }
    return false;
}
