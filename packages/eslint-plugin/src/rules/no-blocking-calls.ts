import { identifierName, memberName, unwrap } from "../utils/ast.ts";
import { createRule } from "../utils/rule.ts";
import { importBinding, isGlobalReference, isNamespaceLike } from "../utils/scope.ts";

const BLOCKING_MODULES = new Set(["child_process", "fs", "node:child_process", "node:fs"]);

export default createRule({
  name: "no-blocking-calls",
  type: "suggestion",
  description: "Disallow synchronous fs and child_process calls and Atomics.wait in route files.",
  messages: {
    blocking: "{{name}}() blocks the event loop, which stalls the gateway and every other interaction. Use the asynchronous version.",
    atomics: "Atomics.wait() blocks the event loop, which stalls the gateway and every other interaction.",
  },
  create(kit) {
    return {
      CallExpression(call) {
        if (kit.file.classification.type !== "route" || !call.callee) return;
        const callee = unwrap(call.callee);

        const name = identifierName(callee);
        if (name !== null) {
          const binding = importBinding(kit, callee, name);
          if (binding && !isNamespaceLike(binding) && BLOCKING_MODULES.has(binding.source) && binding.imported.endsWith("Sync")) {
            kit.report({ node: call, messageId: "blocking", data: { name: binding.imported } });
          }
          return;
        }

        const method = memberName(callee);
        const objectName = callee.object ? identifierName(unwrap(callee.object)) : null;
        if (method === null || objectName === null) return;

        if (objectName === "Atomics" && method === "wait" && isGlobalReference(kit, callee, objectName)) {
          kit.report({ node: call, messageId: "atomics" });
          return;
        }

        const binding = importBinding(kit, callee, objectName);
        if (isNamespaceLike(binding) && BLOCKING_MODULES.has(binding.source) && method.endsWith("Sync")) {
          kit.report({ node: call, messageId: "blocking", data: { name: `${objectName}.${method}` } });
        }
      },
    };
  },
});
