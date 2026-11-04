import { FUNCTION_TYPES, type AstNode } from "../utils/ast.ts";
import { contractLabel, isComponentSegment } from "../utils/contracts.ts";
import { findDefaultExport } from "../utils/exports.ts";
import { createRule, type RuleKit } from "../utils/rule.ts";
import { calleeName, resolveValue } from "../utils/scope.ts";

const COMPONENT_WRAPPERS = new Set(["forwardRef", "lazy", "memo"]);

function isFunctionComponent(kit: RuleKit, node: AstNode): boolean {
  const value = resolveValue(kit, node);
  if (FUNCTION_TYPES.has(value.type) || value.type === "Identifier") return true;
  return value.type === "CallExpression" && COMPONENT_WRAPPERS.has(calleeName(kit, value) ?? "");
}

export default createRule({
  name: "require-default-export",
  type: "problem",
  description: "Require the default export neocord loads from route, group, feature, context and segment files.",
  messages: {
    missing: "This {{label}} file must have a default export. neocord loads the default export of each file it routes.",
    missingComponent: "This {{label}} file must default-export a function component.",
    notComponent: "The default export of a {{label}} file must be a function component.",
  },
  create(kit) {
    return {
      Program(program) {
        const { classification } = kit.file;
        const label = contractLabel(classification);
        if (label === null) return;

        const found = findDefaultExport(program);
        const isComponent = isComponentSegment(classification);
        if (!found) {
          kit.report({ node: program, messageId: isComponent ? "missingComponent" : "missing", data: { label } });
          return;
        }
        if (isComponent && found.kind === "value" && !isFunctionComponent(kit, found.value)) {
          kit.report({ node: found.node, messageId: "notComponent", data: { label } });
        }
      },
    };
  },
});
