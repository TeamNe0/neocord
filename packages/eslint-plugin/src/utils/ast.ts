export interface AstPosition {
  readonly line: number;
  readonly column: number;
}

export interface AstLocation {
  readonly start: AstPosition;
  readonly end: AstPosition;
}

export interface AstNode {
  readonly type: string;
  readonly parent: AstNode | null;
  readonly range: [number, number];
  readonly loc: AstLocation;
  readonly name?: string | AstNode;
  readonly value?: unknown;
  readonly key?: AstNode;
  readonly computed?: boolean;
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly callee?: AstNode;
  readonly arguments?: readonly AstNode[];
  readonly expression?: AstNode;
  readonly id?: AstNode | null;
  readonly init?: AstNode | null;
  readonly params?: readonly AstNode[];
  readonly body?: AstNode | readonly AstNode[];
  readonly properties?: readonly AstNode[];
  readonly elements?: readonly (AstNode | null)[];
  readonly declaration?: AstNode | null;
  readonly declarations?: readonly AstNode[];
  readonly specifiers?: readonly AstNode[];
  readonly exported?: AstNode;
  readonly local?: AstNode;
  readonly imported?: AstNode;
  readonly source?: AstNode | null;
  readonly exportKind?: string;
  readonly importKind?: string;
  readonly left?: AstNode;
  readonly right?: AstNode;
  readonly consequent?: AstNode;
  readonly alternate?: AstNode | null;
  readonly expressions?: readonly AstNode[];
  readonly quasis?: readonly AstNode[];
  readonly children?: readonly AstNode[];
  readonly openingElement?: AstNode;
  readonly attributes?: readonly AstNode[];
  readonly declare?: boolean;
  readonly async?: boolean;
}

const TRANSPARENT_WRAPPERS = new Set([
  "ChainExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

export const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionDeclaration", "FunctionExpression"]);

export function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

export function unwrap(node: AstNode): AstNode {
  let current = node;
  while (TRANSPARENT_WRAPPERS.has(current.type) && current.expression) current = current.expression;
  return current;
}

export function identifierName(node: AstNode | null | undefined): string | null {
  if (!node || (node.type !== "Identifier" && node.type !== "JSXIdentifier")) return null;
  return typeof node.name === "string" ? node.name : null;
}

export function staticString(node: AstNode | null | undefined): string | null {
  if (!node) return null;
  const target = unwrap(node);
  if (target.type === "Literal" && typeof target.value === "string") return target.value;
  if (target.type === "TemplateLiteral" && target.expressions?.length === 0) {
    const cooked = (target.quasis?.[0]?.value as { cooked?: unknown } | undefined)?.cooked;
    return typeof cooked === "string" ? cooked : null;
  }
  return null;
}

export function memberName(node: AstNode): string | null {
  if (node.type !== "MemberExpression" || !node.property) return null;
  return node.computed ? staticString(node.property) : identifierName(node.property);
}

export function keyName(property: AstNode): string | null {
  if (property.type !== "Property" || !property.key) return null;
  if (property.computed) return staticString(property.key);
  if (property.key.type === "Literal") return String(property.key.value);
  return identifierName(property.key);
}

export function findProperty(object: AstNode, name: string): AstNode | null {
  return object.properties?.find((property) => keyName(property) === name) ?? null;
}

export function hasSpread(object: AstNode): boolean {
  return object.properties?.some((property) => property.type !== "Property") ?? false;
}

export function propertyValue(property: AstNode | null): AstNode | null {
  if (!property || !isAstNode(property.value)) return null;
  return unwrap(property.value);
}

export function programBody(program: AstNode): readonly AstNode[] {
  return Array.isArray(program.body) ? (program.body as readonly AstNode[]) : [];
}

export function quoteLike(value: string, originalText: string): string {
  const quote = originalText[0];
  if (quote === "'" || quote === "`") {
    return `${quote}${value.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`)}${quote}`;
  }
  return JSON.stringify(value);
}
