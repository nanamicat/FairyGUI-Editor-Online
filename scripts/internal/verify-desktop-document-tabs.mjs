import assert from "node:assert/strict";
import {
    closeDesktopDocumentTab,
    cycleDesktopDocumentTab,
    openDesktopDocumentTab,
    reconcileDesktopDocumentTabs,
    resolveDesktopReferencedComponentTab,
} from "../../src/editor/runtime/DesktopDocumentTabs.ts";

const a = { packageId: "pkg", componentId: "a" };
const b = { packageId: "pkg", componentId: "b" };
const c = { packageId: "other", componentId: "c" };

assert.deepEqual(openDesktopDocumentTab([a], b), [a, b]);
assert.deepEqual(openDesktopDocumentTab([a, b], b), [a, b], "Opening an existing document must not duplicate its tab.");
assert.deepEqual(closeDesktopDocumentTab([a, b, c], b, b), {
    tabs: [a, c],
    active: c,
});
assert.deepEqual(closeDesktopDocumentTab([a, b, c], c, c), {
    tabs: [a, b],
    active: b,
});
assert.deepEqual(cycleDesktopDocumentTab([a, b, c], c, 1), a);
assert.deepEqual(cycleDesktopDocumentTab([a, b, c], a, -1), c);
assert.deepEqual(reconcileDesktopDocumentTabs([a, b, b], [a, b, c], c), {
    tabs: [a, b, c],
    active: c,
});
assert.deepEqual(reconcileDesktopDocumentTabs([a, b], [b, c], a), {
    tabs: [b],
    active: b,
});
const project = {
    packages: [
        {
            id: "pkg",
            resources: [
                {
                    id: "a",
                    kind: "component",
                    component: {
                        displayList: [
                            {
                                id: "same",
                                kind: "component",
                                resource: { packageId: "", resourceId: "b" },
                            },
                            {
                                id: "cross",
                                kind: "component",
                                resource: { packageId: "other", resourceId: "c" },
                            },
                            { id: "image", kind: "image", resource: { resourceId: "asset" } },
                        ],
                    },
                },
                { id: "b", kind: "component", component: { displayList: [] } },
            ],
        },
        {
            id: "other",
            resources: [
                { id: "c", kind: "component", component: { displayList: [] } },
            ],
        },
    ],
};
assert.deepEqual(resolveDesktopReferencedComponentTab(project, a, "same"), b);
assert.deepEqual(resolveDesktopReferencedComponentTab(project, a, "cross"), c);
assert.equal(resolveDesktopReferencedComponentTab(project, a, "image"), null);
assert.equal(resolveDesktopReferencedComponentTab(project, a, "missing"), null);

console.log(JSON.stringify({
    ok: true,
    verified: [
        "open without duplicate tabs",
        "close selects the adjacent document",
        "forward and reverse tab cycling",
        "snapshot reconciliation and active-tab recovery",
        "same-package and cross-package component-reference navigation",
    ],
}, null, 2));
