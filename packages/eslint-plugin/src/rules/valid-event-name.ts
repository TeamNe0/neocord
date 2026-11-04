import { quoteLike, staticString } from "../utils/ast.ts";
import { closestClientEvent, isClientEvent } from "../utils/discord-events.ts";
import { createRule } from "../utils/rule.ts";
import { calleeName } from "../utils/scope.ts";

export default createRule({
  name: "valid-event-name",
  type: "problem",
  description: "Require defineEvent to name a real discord.js client event.",
  hasSuggestions: true,
  messages: {
    unknown: '"{{name}}" is not a discord.js client event. Did you mean "{{closest}}"?',
    unknownPath: 'This file is routed to "{{name}}", which is not a discord.js client event. Did you mean "{{closest}}"?',
    useClosest: 'Use "{{closest}}".',
  },
  create(kit) {
    return {
      CallExpression(call) {
        if (calleeName(kit, call) !== "defineEvent") return;
        const first = call.arguments?.[0];
        const name = staticString(first);

        if (first && name !== null) {
          if (isClientEvent(name)) return;
          const closest = closestClientEvent(name);
          kit.report({
            node: first,
            messageId: "unknown",
            data: { name, closest },
            suggest: [{
              messageId: "useClosest",
              data: { closest },
              fix: (fixer) => fixer.replaceTextRange(first.range, quoteLike(closest, kit.text(first))),
            }],
          });
          return;
        }

        const { classification } = kit.file;
        if (classification.type === "route" && classification.kind === "event" && !isClientEvent(classification.routeId)) {
          kit.report({
            node: first ?? call,
            messageId: "unknownPath",
            data: { name: classification.routeId, closest: closestClientEvent(classification.routeId) },
          });
        }
      },
    };
  },
});
