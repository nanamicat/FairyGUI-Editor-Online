import type { EditorProjectSnapshot } from "../model/ProjectSnapshot";
import { readTextProperties } from "../commands/DisplayListReaders";

export const PROJECT_SNAPSHOT_URL = "resources/editor/project-snapshot.json";
const PROJECT_SNAPSHOT_FALLBACK_URL = "assets/resources/editor/project-snapshot.json";

export async function loadProjectSnapshot(
    url: string = PROJECT_SNAPSHOT_URL,
): Promise<EditorProjectSnapshot> {
    const response = await fetchFirstAvailable(
        url === PROJECT_SNAPSHOT_URL
            ? [url, PROJECT_SNAPSHOT_FALLBACK_URL]
            : [url],
        "project snapshot",
    );

    const snapshot = (await response.json()) as EditorProjectSnapshot;
    assertProjectSnapshot(snapshot);
    return normalizeProjectSnapshot(snapshot);
}

export function normalizeProjectSnapshot(snapshot: EditorProjectSnapshot): EditorProjectSnapshot {
    for (const pkg of snapshot.packages) {
        for (const component of pkg.components) {
            component.customProperties ??= [];
            for (const node of component.children) {
                node.pivotX ??= 0;
                node.pivotY ??= 0;
                node.pivotAsAnchor ??= false;
                node.locked ??= false;
                node.aspect ??= false;
                node.minSize ??= { width: 0, height: 0 };
                node.maxSize ??= { width: 0, height: 0 };
                node.scale ??= { x: 1, y: 1 };
                node.skew ??= { x: 0, y: 0 };
                node.tooltips ??= "";
                node.blendMode ??= "normal";
                node.filter ??= "";
                node.filterData ??= "";
                node.textProperties ??= readTextProperties({
                    kind: node.type === "GRichTextField"
                        ? "richText"
                        : node.type === "GTextInput" ? "textInput" : "text",
                });
            }
        }
    }
    return snapshot;
}

async function fetchFirstAvailable(urls: string[], label: string): Promise<Response> {
    const failures: string[] = [];

    for (const url of urls) {
        const response = await fetch(url, { cache: "no-cache" });
        if (response.ok) return response;
        failures.push(`${url}: ${response.status} ${response.statusText}`);
    }

    throw new Error(`Failed to load ${label}. Tried ${failures.join("; ")}.`);
}

function assertProjectSnapshot(snapshot: EditorProjectSnapshot): void {
    if (!snapshot || snapshot.schemaVersion !== 1) {
        throw new Error("Unsupported project snapshot schema.");
    }

    if (!snapshot.project || !snapshot.packages) {
        throw new Error("Project snapshot is missing required project data.");
    }
}
