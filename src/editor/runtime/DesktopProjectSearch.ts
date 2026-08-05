import type { EditorProjectSnapshot } from "../model/ProjectSnapshot";

export type DesktopProjectSearchResult =
    | {
        kind: "package";
        packageId: string;
        label: string;
    }
    | {
        kind: "component";
        packageId: string;
        componentId: string;
        label: string;
    }
    | {
        kind: "resource";
        packageId: string;
        resourceId: string;
        label: string;
    }
    | {
        kind: "displayNode";
        packageId: string;
        componentId: string;
        nodeId: string;
        label: string;
    };

const KIND_ORDER: Record<DesktopProjectSearchResult["kind"], number> = {
    package: 0,
    component: 1,
    resource: 2,
    displayNode: 3,
};

function matches(query: string, ...values: Array<string | undefined>): boolean {
    return values.some((value) => value?.toLowerCase().includes(query));
}

export function searchDesktopProject(
    snapshot: EditorProjectSnapshot,
    keyword: string,
): DesktopProjectSearchResult[] {
    const query = keyword.trim().toLowerCase();
    if (!query) return [];

    const results: DesktopProjectSearchResult[] = [];
    for (const pkg of snapshot.packages) {
        if (matches(query, pkg.id, pkg.name, pkg.publishName)) {
            results.push({
                kind: "package",
                packageId: pkg.id,
                label: `Package · ${pkg.name}`,
            });
        }

        const componentIds = new Set(pkg.components.map((component) => component.id));
        for (const component of pkg.components) {
            if (matches(query, component.id, component.name, component.path)) {
                results.push({
                    kind: "component",
                    packageId: pkg.id,
                    componentId: component.id,
                    label: `Component · ${pkg.name}/${component.name}`,
                });
            }
            for (const node of component.children) {
                if (!matches(query, node.id, node.name, node.type, node.text, node.src, node.font)) continue;
                const text = node.text.trim();
                results.push({
                    kind: "displayNode",
                    packageId: pkg.id,
                    componentId: component.id,
                    nodeId: node.id,
                    label: `${node.type} · ${pkg.name}/${component.name}/${node.name || node.id}`
                        + (text ? ` · ${text}` : ""),
                });
            }
        }

        for (const resource of pkg.resources) {
            if (componentIds.has(resource.id)) continue;
            if (!matches(
                query,
                resource.id,
                resource.name,
                resource.path,
                resource.type,
                resource.fileName,
                `ui://${pkg.id}${resource.id}`,
            )) continue;
            results.push({
                kind: "resource",
                packageId: pkg.id,
                resourceId: resource.id,
                label: `${resource.type} · ${pkg.name}/${resource.name}`,
            });
        }
    }

    return results.sort((left, right) => (
        left.packageId.localeCompare(right.packageId)
        || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
        || left.label.localeCompare(right.label)
    ));
}
