import { contractLabel, expectedHelper } from "../utils/contracts.ts";
import { findDefaultExport } from "../utils/exports.ts";
import { createRule } from "../utils/rule.ts";
import { calleeName, resolveValue } from "../utils/scope.ts";

export default createRule({
  name: "require-define-helper",
  type: "problem",
  description: "Require the default export of each routed file to be a call to the matching define helper.",
  messages: {
    notHelperCall: "The default export of a {{label}} file must be a call to {{expected}}().",
    wrongHelper: "A {{label}} file must use {{expected}}(), not {{actual}}().",
  },
  create(kit) {
    return {
      Program(program) {
        const { classification } = kit.file;
        const expected = expectedHelper(classification);
        const label = contractLabel(classification);
        if (expected === null || label === null) return;

        const found = findDefaultExport(program);
        if (!found) return;

        const value = found.kind === "value" ? resolveValue(kit, found.value) : null;
        if (value?.type !== "CallExpression") {
          kit.report({ node: found.node, messageId: "notHelperCall", data: { label, expected } });
          return;
        }
        const actual = calleeName(kit, value);
        if (actual === expected) return;
        if (actual?.startsWith("define")) {
          kit.report({ node: value, messageId: "wrongHelper", data: { label, expected, actual } });
        } else {
          kit.report({ node: value, messageId: "notHelperCall", data: { label, expected } });
        }
      },
    };
  },
});
