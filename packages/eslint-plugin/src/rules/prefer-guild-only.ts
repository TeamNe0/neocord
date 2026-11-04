import { findProperty, hasSpread, isAstNode, propertyValue, type AstNode } from "../utils/ast.ts";
import { DEFINITION_ARGUMENT_INDEX, isContextProperty } from "../utils/handlers.ts";
import { createRule, type RuleKit, type RuleSuggestion } from "../utils/rule.ts";
import { calleeName, resolveValue } from "../utils/scope.ts";

const GUILD_PROPERTIES = ["guild", "member"];
const GUILD_ONLY_HELPERS = new Set([
  "defineButton",
  "defineCommand",
  "defineMessageCommand",
  "defineModal",
  "defineSelect",
  "defineUserCommand",
]);

function enclosingDefinition(kit: RuleKit, node: AstNode): AstNode | null {
  let current = node.parent;
  while (current) {
    if (current.type === "CallExpression") {
      const helper = calleeName(kit, current);
      if (helper !== null && GUILD_ONLY_HELPERS.has(helper)) {
        const argument = current.arguments?.[DEFINITION_ARGUMENT_INDEX[helper] ?? 0];
        const definition = argument ? resolveValue(kit, argument) : null;
        return definition?.type === "ObjectExpression" ? definition : null;
      }
    }
    current = current.parent;
  }
  return null;
}

export default createRule({
  name: "prefer-guild-only",
  type: "suggestion",
  description: "Prefer guildOnly: true over asserting ctx.guild or ctx.member are non-null.",
  hasSuggestions: true,
  messages: {
    preferGuildOnly: "Add guildOnly: true instead of asserting ctx.{{property}}!, so Discord hides this outside servers and the type is non-null.",
    addGuildOnly: "Set guildOnly: true.",
  },
  create(kit) {
    return {
      TSNonNullExpression(node) {
        if (!isAstNode(node.expression)) return;
        const expression = node.expression;
        const property = GUILD_PROPERTIES.find((name) => isContextProperty(kit, expression, name));
        if (!property) return;

        const definition = enclosingDefinition(kit, node);
        if (!definition || hasSpread(definition)) return;

        const existing = findProperty(definition, "guildOnly");
        const value = propertyValue(existing);
        if (existing && (value?.type !== "Literal" || value.value !== false)) return;

        const first = definition.properties?.[0];
        const suggest: RuleSuggestion[] = [];
        if (existing && value) {
          suggest.push({
            messageId: "addGuildOnly",
            fix: (fixer) => fixer.replaceTextRange(value.range, "true"),
          });
        } else if (first) {
          suggest.push({
            messageId: "addGuildOnly",
            fix: (fixer) => fixer.insertTextBeforeRange(first.range, "guildOnly: true, "),
          });
        }
        kit.report({ node, messageId: "preferGuildOnly", data: { property }, suggest });
      },
    };
  },
});
