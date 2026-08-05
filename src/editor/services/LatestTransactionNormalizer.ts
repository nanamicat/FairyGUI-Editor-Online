import {
    cloneJson,
    findDisplayNode,
    type UamDisplayNodeLike,
} from "../commands/AuthoringTransactionSupport";
import { readTextProperties } from "../commands/DisplayListReaders";
import type {
    DisplayNodeEditableProps,
    EditorCommandOperation,
} from "../model/EditorCommand";

export function normalizeLatestTransactionOperations(
    project: unknown,
    operations: EditorCommandOperation[],
): EditorCommandOperation[] {
    const normalized = cloneJson(operations);
    const attachedNodes = new Map<string, UamDisplayNodeLike>();
    const key = (selector: { packageId: string; componentResourceId: string; displayNodeId: string }): string =>
        `${selector.packageId}\0${selector.componentResourceId}\0${selector.displayNodeId}`;

    for (const operation of normalized) {
        if (operation.kind === "addResource" || operation.kind === "addComponent") {
            const resource = (operation.kind === "addResource" ? operation.resource : operation.component) as {
                favorite?: boolean;
                image?: { quality?: number };
            };
            resource.favorite ??= false;
            if (resource.image) resource.image.quality ??= 80;
        }
        if (operation.kind === "attachDisplayNode") {
            const node = operation.node as UamDisplayNodeLike;
            if (node.id) attachedNodes.set(key({ ...operation.selector, displayNodeId: node.id }), node);
            continue;
        }
        if (operation.kind !== "setDisplayNodeProps" || !operation.props.textProperties) continue;
        const node = attachedNodes.get(key(operation.selector)) ?? findDisplayNode(project, operation.selector);
        if (!node || (node.kind !== "text" && node.kind !== "richText" && node.kind !== "textInput")) continue;

        const edited = operation.props.textProperties as unknown as TextStyleUpdate;
        const props = operation.props as DisplayNodeEditableProps;
        const textProperties: Record<string, unknown> = {
            ...readTextProperties(node),
            ...edited,
            text: String(edited.text ?? props.text ?? node.text ?? ""),
            font: String(edited.font ?? props.font ?? node.font ?? ""),
            fontSize: Number(edited.fontSize ?? props.fontSize ?? node.fontSize ?? 12),
            color: String(edited.color ?? props.color ?? node.color ?? "#000000"),
        };
        if (node.kind === "richText") {
            delete textProperties.demoText;
            delete textProperties.templateVarsEnabled;
            delete textProperties.faceDilate;
        }
        (props as unknown as { textProperties: Record<string, unknown> }).textProperties = textProperties;
    }
    return normalized;
}

type TextStyleUpdate = Record<string, unknown> & {
    text?: string;
    font?: string;
    fontSize?: number;
    color?: string;
};
