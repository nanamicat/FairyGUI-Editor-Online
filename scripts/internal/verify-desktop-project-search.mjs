import assert from "node:assert/strict";
import { searchDesktopProject } from "../../src/editor/runtime/DesktopProjectSearch.ts";

const snapshot = {
    packages: [{
        id: "pkg",
        name: "Bag",
        publishName: "Bag",
        resources: [
            { id: "panel", name: "Panel", path: "/", type: "Component", fileName: "" },
            { id: "hero", name: "Hero", path: "/images/", type: "Image", fileName: "hero.png" },
        ],
        components: [{
            id: "panel",
            name: "Panel",
            path: "/windows/",
            children: [{
                id: "title",
                name: "titleLabel",
                type: "GTextField",
                text: "Hello World",
                src: "",
                font: "Arial",
            }],
        }],
    }],
};

assert.deepEqual(searchDesktopProject(snapshot, "  "), []);
assert.deepEqual(
    searchDesktopProject(snapshot, "PANEL").map((result) => result.kind),
    ["component"],
    "component resources must not produce duplicate component/resource results",
);
assert.equal(searchDesktopProject(snapshot, "hello world")[0]?.kind, "displayNode");
assert.equal(searchDesktopProject(snapshot, "ui://pkghero")[0]?.kind, "resource");
assert.deepEqual(
    searchDesktopProject(snapshot, "bag").map((result) => result.kind),
    ["package"],
);

console.log("Desktop project search verification passed.");
