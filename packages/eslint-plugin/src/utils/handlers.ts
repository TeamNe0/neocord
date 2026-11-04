import { identifierName, keyName, memberName, unwrap, type AstNode } from "./ast.ts";
import type { RuleKit } from "./rule.ts";
import { calleeName, findVariable } from "./scope.ts";

export const DEFINITION_ARGUMENT_INDEX: Readonly<Record<string, number>> = {
  defineCommand: 0,
  defineGroup: 0,
  defineUserCommand: 0,
  defineMessageCommand: 0,
  defineButton: 1,
  defineSelect: 1,
  defineModal: 1,
  defineEvent: 1,
  defineTask: 0,
};

const HANDLER_KEYS = new Set(["execute", "submit"]);
const MAX_RESOLVE_DEPTH = 6;

function isHandlerFunction(kit: RuleKit, fn: AstNode): boolean {
  const parent = fn.parent;
  if (!parent) return false;
  if (parent.type === "CallExpression") {
    return calleeName(kit, parent) === "defineMiddleware" && parent.arguments?.[0] === fn;
  }
  if (parent.type !== "Property" || !HANDLER_KEYS.has(keyName(parent) ?? "")) return false;
  const call = parent.parent?.parent;
  if (call?.type !== "CallExpression") return false;
  return Object.hasOwn(DEFINITION_ARGUMENT_INDEX, calleeName(kit, call) ?? "");
}

export function isContextExpression(kit: RuleKit, node: AstNode, depth = 0): boolean {
  if (depth > MAX_RESOLVE_DEPTH) return false;
  const target = unwrap(node);
  if (target.type === "CallExpression") {
    return calleeName(kit, target) === "useContext" && target.arguments?.length === 0;
  }
  const name = identifierName(target);
  if (name === null) return false;
  if (name === "ctx") return true;
  const definition = findVariable(kit, target, name)?.defs[0];
  if (!definition) return false;
  if (definition.type === "Parameter") {
    const fn = definition.node as unknown as AstNode;
    return fn.params?.[0] === (definition.name as unknown as AstNode) && isHandlerFunction(kit, fn);
  }
  if (definition.type === "Variable") {
    const declarator = definition.node as unknown as AstNode;
    if (declarator.id?.type === "Identifier" && declarator.init) {
      return isContextExpression(kit, declarator.init, depth + 1);
    }
  }
  return false;
}

function patternBinds(pattern: AstNode | null | undefined, property: string, local: string): boolean {
  if (pattern?.type !== "ObjectPattern") return false;
  return (pattern.properties ?? []).some((candidate) => {
    if (keyName(candidate) !== property) return false;
    const value = candidate.value as AstNode | undefined;
    const target = value?.type === "AssignmentPattern" ? value.left : value;
    return identifierName(target) === local;
  });
}

export function isContextProperty(kit: RuleKit, node: AstNode, property: string, depth = 0): boolean {
  if (depth > MAX_RESOLVE_DEPTH) return false;
  const target = unwrap(node);
  if (target.type === "MemberExpression" && target.object) {
    return memberName(target) === property && isContextExpression(kit, target.object);
  }
  const name = identifierName(target);
  if (name === null) return false;
  const definition = findVariable(kit, target, name)?.defs[0];
  if (!definition) return false;
  if (definition.type === "Parameter") {
    const fn = definition.node as unknown as AstNode;
    return patternBinds(fn.params?.[0], property, name) && isHandlerFunction(kit, fn);
  }
  if (definition.type === "Variable") {
    const declarator = definition.node as unknown as AstNode;
    if (!declarator.init) return false;
    if (declarator.id?.type === "Identifier") return isContextProperty(kit, declarator.init, property, depth + 1);
    return patternBinds(declarator.id, property, name) && isContextExpression(kit, declarator.init);
  }
  return false;
}
