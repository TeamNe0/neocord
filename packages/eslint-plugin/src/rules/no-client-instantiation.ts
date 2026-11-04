import { identifierName, memberName, unwrap, type AstNode } from "../utils/ast.ts";
import { createRule, type RuleKit } from "../utils/rule.ts";
import { importBinding, isGlobalReference, isNamespaceLike, resolveValue } from "../utils/scope.ts";

const DISCORD_MODULE = "discord.js";
const FRAMEWORK_CLASSES = new Set(["Client", "ShardingManager"]);
const CLIENT_RECEIVER = /client$|^bot$|^discord/i;

function frameworkClass(kit: RuleKit, callee: AstNode): string | null {
  const target = unwrap(callee);
  const name = identifierName(target);
  if (name !== null) {
    const binding = importBinding(kit, target, name);
    if (binding) {
      return binding.source === DISCORD_MODULE && FRAMEWORK_CLASSES.has(binding.imported) ? binding.imported : null;
    }
    return FRAMEWORK_CLASSES.has(name) && isGlobalReference(kit, target, name) ? name : null;
  }
  if (target.type !== "MemberExpression" || !target.object) return null;
  const property = memberName(target);
  const objectName = identifierName(unwrap(target.object));
  if (property === null || objectName === null || !FRAMEWORK_CLASSES.has(property)) return null;
  const binding = importBinding(kit, target, objectName);
  return isNamespaceLike(binding) && binding.source === DISCORD_MODULE ? property : null;
}

function isClientReceiver(kit: RuleKit, receiver: AstNode): boolean {
  const target = unwrap(receiver);
  const name = identifierName(target) ?? memberName(target);
  if (name !== null && CLIENT_RECEIVER.test(name)) return true;
  const value = resolveValue(kit, target);
  return value.type === "NewExpression" && value.callee !== undefined && frameworkClass(kit, value.callee) === "Client";
}

export default createRule({
  name: "no-client-instantiation",
  type: "problem",
  description: "Disallow creating discord.js clients or logging in from project source, because the framework owns both.",
  messages: {
    instantiation: "Do not create a {{name}} yourself. neocord owns it. Configure it through defineConfig and read ctx.client.",
    login: "Do not call .login() yourself. neocord logs in using the token from defineConfig.",
  },
  create(kit) {
    return {
      NewExpression(node) {
        if (!kit.file.insideSource || !node.callee) return;
        const name = frameworkClass(kit, node.callee);
        if (name !== null) kit.report({ node, messageId: "instantiation", data: { name } });
      },
      CallExpression(call) {
        if (!kit.file.insideSource || !call.callee) return;
        const callee = unwrap(call.callee);
        if (memberName(callee) === "login" && callee.object && isClientReceiver(kit, callee.object)) {
          kit.report({ node: call, messageId: "login" });
        }
      },
    };
  },
});
