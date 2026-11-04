import { identifierName, keyName, memberName, staticString, unwrap, type AstNode } from "../utils/ast.ts";
import { createRule, type RuleKit } from "../utils/rule.ts";
import { importBinding, importedName, isGlobalReference, isNamespaceLike } from "../utils/scope.ts";

const CONFIG_FILE = /^neocord\.config\.[^.]+$/;
const PROCESS_MODULES = new Set(["node:process", "process"]);

function isProcess(kit: RuleKit, node: AstNode): boolean {
  const target = unwrap(node);
  const name = identifierName(target);
  if (name !== null) {
    const binding = importBinding(kit, target, name);
    if (binding) return PROCESS_MODULES.has(binding.source) && isNamespaceLike(binding);
    return name === "process" && isGlobalReference(kit, target, name);
  }
  if (target.type !== "MemberExpression" || memberName(target) !== "process" || !target.object) return false;
  return identifierName(target.object) === "globalThis" && isGlobalReference(kit, target, "globalThis");
}

export default createRule({
  name: "no-process-env",
  type: "suggestion",
  description: "Disallow process.env outside src/env.ts and neocord.config.*, so variables stay validated in one place.",
  messages: {
    processEnv: "Do not read process.env here. Declare the variable in src/env.ts and import env from there.",
  },
  create(kit) {
    function isAllowed(): boolean {
      const { classification, name } = kit.file;
      return classification.type === "env" || CONFIG_FILE.test(name);
    }

    return {
      MemberExpression(member) {
        if (memberName(member) === "env" && member.object && isProcess(kit, member.object) && !isAllowed()) {
          kit.report({ node: member, messageId: "processEnv" });
        }
      },
      VariableDeclarator(declarator) {
        if (declarator.id?.type !== "ObjectPattern" || !declarator.init || !isProcess(kit, declarator.init)) return;
        const property = declarator.id.properties?.find((candidate) => keyName(candidate) === "env");
        if (property && !isAllowed()) kit.report({ node: property, messageId: "processEnv" });
      },
      ImportDeclaration(declaration) {
        if (!PROCESS_MODULES.has(staticString(declaration.source) ?? "")) return;
        for (const specifier of declaration.specifiers ?? []) {
          if (importedName(specifier) === "env" && !isAllowed()) {
            kit.report({ node: specifier, messageId: "processEnv" });
          }
        }
      },
    };
  },
});
