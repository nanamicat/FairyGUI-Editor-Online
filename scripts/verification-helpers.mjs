import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, "utf8"));
}

export function importFile(filePath) {
    return import(pathToFileURL(filePath).href);
}

export function cloneJson(value) {
    return structuredClone(value);
}

export function findDisplayNode(project, target) {
    const pkg = project.packages?.find((candidate) => candidate.id === target.packageId);
    const resource = pkg?.resources?.find((candidate) => candidate.id === target.componentResourceId);
    return resource?.component?.displayList?.find((node) => node.id === target.displayNodeId) ?? null;
}
