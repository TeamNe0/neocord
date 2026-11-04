import { FUNCTION_TYPES, memberName, unwrap, type AstNode } from "../utils/ast.ts";
import { isContextExpression } from "../utils/handlers.ts";
import { createRule, type RuleKit } from "../utils/rule.ts";

const CONTEXT_METHODS = new Set([
  "defer",
  "deferUpdate",
  "deleteReply",
  "editReply",
  "followUp",
  "reply",
  "showModal",
  "update",
]);

function collectContextCalls(kit: RuleKit, expression: AstNode, calls: AstNode[]): void {
  const target = unwrap(expression);
  if (target.type === "LogicalExpression" && target.right) {
    collectContextCalls(kit, target.right, calls);
  } else if (target.type === "ConditionalExpression") {
    if (target.consequent) collectContextCalls(kit, target.consequent, calls);
    if (target.alternate) collectContextCalls(kit, target.alternate, calls);
  } else if (target.type === "SequenceExpression") {
    for (const item of target.expressions ?? []) collectContextCalls(kit, item, calls);
  } else if (target.type === "CallExpression" && target.callee) {
    const callee = unwrap(target.callee);
    if (callee.object && CONTEXT_METHODS.has(memberName(callee) ?? "") && isContextExpression(kit, callee.object)) {
      calls.push(target);
    }
  }
}

function canAwait(node: AstNode): boolean {
  let current = node.parent;
  while (current) {
    if (FUNCTION_TYPES.has(current.type)) return current.async === true;
    current = current.parent;
  }
  return true;
}

export default createRule({
  name: "no-unawaited-context-calls",
  type: "suggestion",
  description: "Require promises from ctx response methods to be awaited, returned or explicitly voided.",
  hasSuggestions: true,
  messages: {
    unawaited: "ctx.{{method}}() returns a promise. Await it, return it or mark it with void so failures are not lost.",
    addAwait: "Add await.",
    addVoid: "Mark it with void.",
  },
  create(kit) {
    return {
      ExpressionStatement(statement) {
        if (!statement.expression) return;
        const calls: AstNode[] = [];
        collectContextCalls(kit, statement.expression, calls);
        for (const call of calls) {
          const method = memberName(unwrap(call.callee ?? call)) ?? "";
          const prefix = canAwait(call) ? "await " : "void ";
          kit.report({
            node: call,
            messageId: "unawaited",
            data: { method },
            suggest: [{
              messageId: prefix === "await " ? "addAwait" : "addVoid",
              fix: (fixer) => fixer.insertTextBeforeRange(call.range, prefix),
            }],
          });
        }
      },
    };
  },
});
