import { memberName, unwrap } from "../utils/ast.ts";
import { isContextProperty } from "../utils/handlers.ts";
import { createRule } from "../utils/rule.ts";

const REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  ["reply", "ctx.reply(<X />) or return <X /> from the handler"],
  ["editReply", "ctx.editReply(<X />)"],
  ["deferReply", "ctx.defer()"],
  ["followUp", "ctx.followUp(<X />)"],
  ["update", "ctx.update(<X />) or return <X /> from the handler"],
  ["showModal", "ctx.showModal(route, params)"],
]);

export default createRule({
  name: "no-direct-interaction-reply",
  type: "suggestion",
  description: "Disallow responding through ctx.interaction, which bypasses neocord's reply state and rendering.",
  messages: {
    direct: "Do not call interaction.{{method}}() directly, because it bypasses neocord's reply state and layouts. Use {{replacement}}.",
  },
  create(kit) {
    return {
      CallExpression(call) {
        if (!call.callee) return;
        const callee = unwrap(call.callee);
        const method = memberName(callee);
        if (method === null || !callee.object) return;
        const replacement = REPLACEMENTS.get(method);
        if (replacement && isContextProperty(kit, callee.object, "interaction")) {
          kit.report({ node: call, messageId: "direct", data: { method, replacement } });
        }
      },
    };
  },
});
