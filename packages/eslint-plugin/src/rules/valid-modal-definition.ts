import { FUNCTION_TYPES, findProperty, hasSpread, propertyValue, staticString } from "../utils/ast.ts";
import { createRule } from "../utils/rule.ts";
import { calleeName, resolveValue } from "../utils/scope.ts";

const MAX_TITLE_LENGTH = 45;

export default createRule({
  name: "valid-modal-definition",
  type: "problem",
  description: "Require defineModal to have a usable title, render and submit.",
  messages: {
    missingProperty: 'defineModal() requires "{{property}}".',
    titleKind: "A modal title must be a string literal or a function that returns the title.",
    titleLength: "A modal title must be 1-{{max}} characters, but this one has {{length}}.",
  },
  create(kit) {
    return {
      CallExpression(call) {
        if (calleeName(kit, call) !== "defineModal") return;

        const argument = call.arguments?.[1];
        const definition = argument ? resolveValue(kit, argument) : null;
        if (definition && definition.type !== "ObjectExpression") return;

        if (!definition || !hasSpread(definition)) {
          for (const property of ["title", "render", "submit"]) {
            if (!definition || !findProperty(definition, property)) {
              kit.report({ node: definition ?? call, messageId: "missingProperty", data: { property } });
            }
          }
        }

        const title = definition ? propertyValue(findProperty(definition, "title")) : null;
        if (!title) return;

        const resolved = resolveValue(kit, title);
        const text = staticString(resolved);
        if (text !== null) {
          if (text.length < 1 || text.length > MAX_TITLE_LENGTH) {
            kit.report({ node: title, messageId: "titleLength", data: { max: MAX_TITLE_LENGTH, length: text.length } });
          }
          return;
        }
        if (!FUNCTION_TYPES.has(resolved.type) && resolved.type !== "Identifier") {
          kit.report({ node: title, messageId: "titleKind" });
        }
      },
    };
  },
});
