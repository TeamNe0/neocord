import type { Scope } from "eslint";
import { identifierName, isAstNode, memberName, staticString, unwrap, type AstNode } from "./ast.ts";
import type { RuleKit } from "./rule.ts";

export interface ImportBinding {
  readonly source: string;
  readonly imported: string;
  readonly typeOnly: boolean;
}

export function findVariable(kit: RuleKit, node: AstNode, name: string): Scope.Variable | null {
  let scope: Scope.Scope | null = kit.scope(node);
  while (scope) {
    const variable = scope.set.get(name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

export function isGlobalReference(kit: RuleKit, node: AstNode, name: string): boolean {
  const variable = findVariable(kit, node, name);
  return !variable || variable.defs.length === 0;
}

export function importedName(specifier: AstNode): string {
  if (specifier.type === "ImportNamespaceSpecifier") return "*";
  if (specifier.type === "ImportDefaultSpecifier") return "default";
  return identifierName(specifier.imported) ?? staticString(specifier.imported) ?? "";
}

export function importBinding(kit: RuleKit, node: AstNode, name: string): ImportBinding | null {
  const definition = findVariable(kit, node, name)?.defs.find((candidate) => candidate.type === "ImportBinding");
  if (!definition) return null;
  const specifier = definition.node as unknown as AstNode;
  const declaration = definition.parent as unknown as AstNode;
  const source = staticString(declaration.source);
  if (source === null) return null;
  return {
    source,
    imported: importedName(specifier),
    typeOnly: declaration.importKind === "type" || specifier.importKind === "type",
  };
}

export function isNamespaceLike(binding: ImportBinding | null): binding is ImportBinding & { imported: "*" | "default" } {
  return binding !== null && (binding.imported === "*" || binding.imported === "default");
}

export function resolveValue(kit: RuleKit, node: AstNode): AstNode {
  let current = unwrap(node);
  for (let depth = 0; depth < 8; depth++) {
    const name = identifierName(current);
    if (name === null) return current;
    const variable = findVariable(kit, current, name);
    const definition = variable?.defs[0];
    if (!variable || !definition) return current;
    if (definition.type === "FunctionName" || definition.type === "ClassName") {
      return definition.node as unknown as AstNode;
    }
    if (definition.type !== "Variable") return current;
    const declarator = definition.node as unknown as AstNode;
    if (declarator.id?.type !== "Identifier" || !declarator.init) return current;
    if (variable.references.filter((reference) => reference.isWrite()).length > 1) return current;
    current = unwrap(declarator.init);
  }
  return current;
}

export function calleeName(kit: RuleKit, call: AstNode): string | null {
  if (!isAstNode(call.callee)) return null;
  const callee = unwrap(call.callee);
  const name = identifierName(callee);
  if (name !== null) {
    const binding = importBinding(kit, callee, name);
    return binding && !isNamespaceLike(binding) ? binding.imported : name;
  }
  if (callee.type === "MemberExpression" && callee.object) {
    const objectName = identifierName(unwrap(callee.object));
    if (objectName !== null && isNamespaceLike(importBinding(kit, callee, objectName))) return memberName(callee);
  }
  return null;
}
