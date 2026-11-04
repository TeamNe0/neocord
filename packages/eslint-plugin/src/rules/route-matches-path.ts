import { quoteLike, staticString } from "../utils/ast.ts";
import { expectedHelper } from "../utils/contracts.ts";
import { createRule } from "../utils/rule.ts";
import { calleeName } from "../utils/scope.ts";

const CHECKED_KINDS = new Set(["button", "select", "modal", "event"]);

export default createRule({
  name: "route-matches-path",
  type: "problem",
  description: "Require the first argument of route helpers to equal the id derived from the file path.",
  fixable: "code",
  hasSuggestions: true,
  messages: {
    mismatch: '{{helper}}() is called with "{{actual}}" but this file\'s route id is "{{expected}}".',
    nonLiteral: '{{helper}}() needs the string literal "{{expected}}" as its first argument, so params can be inferred.',
    missing: '{{helper}}() needs the string literal "{{expected}}" as its first argument.',
    useLiteral: 'Use the literal "{{expected}}".',
  },
  create(kit) {
    return {
      CallExpression(call) {
        const { classification } = kit.file;
        if (classification.type !== "route" || !CHECKED_KINDS.has(classification.kind)) return;
        const helper = expectedHelper(classification);
        if (helper === null || calleeName(kit, call) !== helper) return;

        const expected = classification.routeId;
        const first = call.arguments?.[0];
        if (!first) {
          kit.report({ node: call, messageId: "missing", data: { helper, expected } });
          return;
        }

        const literal = JSON.stringify(expected);
        if (first.type === "ObjectExpression") {
          kit.report({
            node: first,
            messageId: "missing",
            data: { helper, expected },
            suggest: [{
              messageId: "useLiteral",
              data: { expected },
              fix: (fixer) => fixer.insertTextBeforeRange(first.range, `${literal}, `),
            }],
          });
          return;
        }

        const actual = staticString(first);
        if (actual === null) {
          kit.report({
            node: first,
            messageId: "nonLiteral",
            data: { helper, expected },
            suggest: [{
              messageId: "useLiteral",
              data: { expected },
              fix: (fixer) => fixer.replaceTextRange(first.range, literal),
            }],
          });
          return;
        }

        if (actual !== expected) {
          kit.report({
            node: first,
            messageId: "mismatch",
            data: { helper, actual, expected },
            fix: (fixer) => fixer.replaceTextRange(first.range, quoteLike(expected, kit.text(first))),
          });
        }
      },
    };
  },
});
