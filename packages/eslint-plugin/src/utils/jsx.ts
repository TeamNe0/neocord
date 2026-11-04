import { identifierName, isAstNode, staticString, type AstNode } from "./ast.ts";
import type { RuleKit } from "./rule.ts";
import { importBinding, isNamespaceLike } from "./scope.ts";

export const REACT_PACKAGE = "@neocord/react";

export const SELECT_COMPONENTS = new Set([
  "ChannelSelect",
  "MentionableSelect",
  "RoleSelect",
  "StringSelect",
  "UserSelect",
]);

export const TEXT_COMPONENTS = new Set([
  "Bold",
  "ChannelMention",
  "Code",
  "CodeBlock",
  "Emoji",
  "Heading",
  "Italic",
  "LineBreak",
  "Link",
  "List",
  "ListItem",
  "Quote",
  "RoleMention",
  "Spoiler",
  "Strikethrough",
  "Subtext",
  "TextDisplay",
  "Timestamp",
  "Underline",
  "UserMention",
]);

export const FORM_CONTROLS = new Set([
  ...SELECT_COMPONENTS,
  "Checkbox",
  "CheckboxGroup",
  "FileUpload",
  "RadioGroup",
  "TextInput",
]);

const KNOWN_COMPONENTS = new Set([
  ...TEXT_COMPONENTS,
  ...FORM_CONTROLS,
  "ActionRow",
  "Button",
  "Container",
  "File",
  "Label",
  "MediaGallery",
  "MediaItem",
  "Message",
  "Modal",
  "Option",
  "Section",
  "Separator",
  "Thumbnail",
]);

export type JsxChild =
  | { readonly kind: "component"; readonly name: string; readonly node: AstNode }
  | { readonly kind: "custom"; readonly node: AstNode }
  | { readonly kind: "text"; readonly node: AstNode }
  | { readonly kind: "expression"; readonly node: AstNode };

function elementName(element: AstNode): AstNode | null {
  const name = element.openingElement?.name;
  return isAstNode(name) ? name : null;
}

function resolveImported(kit: RuleKit, element: AstNode, source: string): string | null {
  const name = elementName(element);
  if (!name) return null;
  if (name.type === "JSXIdentifier") {
    const local = identifierName(name);
    if (local === null) return null;
    const binding = importBinding(kit, element, local);
    return binding?.source === source && !isNamespaceLike(binding) ? binding.imported : null;
  }
  if (name.type === "JSXMemberExpression" && name.object?.type === "JSXIdentifier") {
    const local = identifierName(name.object);
    if (local === null) return null;
    const binding = importBinding(kit, element, local);
    return binding?.source === source && isNamespaceLike(binding) ? identifierName(name.property) : null;
  }
  return null;
}

export function resolveComponent(kit: RuleKit, element: AstNode): string | null {
  const imported = resolveImported(kit, element, REACT_PACKAGE);
  return imported !== null && KNOWN_COMPONENTS.has(imported) ? imported : null;
}

export function isFragment(kit: RuleKit, element: AstNode): boolean {
  if (element.type === "JSXFragment") return true;
  return element.type === "JSXElement" && resolveImported(kit, element, "react") === "Fragment";
}

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

function classifyExpression(container: AstNode): JsxChild | null {
  const expression = container.expression;
  if (!expression || expression.type === "JSXEmptyExpression") return null;
  const text = expression.type === "Literal" && typeof expression.value === "number"
    ? String(expression.value)
    : staticString(expression);
  if (text === null) return { kind: "expression", node: container };
  return isBlank(text) ? null : { kind: "text", node: container };
}

export function flattenChildren(kit: RuleKit, element: AstNode): JsxChild[] {
  const result: JsxChild[] = [];
  for (const child of element.children ?? []) {
    if (child.type === "JSXText") {
      if (typeof child.value === "string" && !isBlank(child.value)) result.push({ kind: "text", node: child });
    } else if (child.type === "JSXExpressionContainer") {
      const classified = classifyExpression(child);
      if (classified) result.push(classified);
    } else if (child.type === "JSXSpreadChild") {
      result.push({ kind: "expression", node: child });
    } else if (isFragment(kit, child)) {
      result.push(...flattenChildren(kit, child));
    } else if (child.type === "JSXElement") {
      const name = resolveComponent(kit, child);
      result.push(name ? { kind: "component", name, node: child } : { kind: "custom", node: child });
    }
  }
  return result;
}

export function parentComponent(kit: RuleKit, element: AstNode): string | null {
  let current = element.parent;
  while (current) {
    if (!isFragment(kit, current)) {
      return current.type === "JSXElement" ? resolveComponent(kit, current) : null;
    }
    current = current.parent;
  }
  return null;
}

export function findAttribute(element: AstNode, name: string): AstNode | null {
  const attributes = element.openingElement?.attributes ?? [];
  return attributes.find((attribute) => {
    return attribute.type === "JSXAttribute" && isAstNode(attribute.name) && identifierName(attribute.name) === name;
  }) ?? null;
}

export function attributeValue(attribute: AstNode): AstNode | null {
  if (!isAstNode(attribute.value)) return null;
  return attribute.value.type === "JSXExpressionContainer" ? attribute.value.expression ?? null : attribute.value;
}
