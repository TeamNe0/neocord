import { createRule } from "../utils/rule.ts";

export default createRule({
  name: "no-unknown-route-file",
  type: "problem",
  description: "Report files in the features folder that neocord cannot classify.",
  messages: {
    invalid: "{{reason}}",
  },
  create(kit) {
    return {
      Program(program) {
        const { classification } = kit.file;
        if (classification.type === "invalid") {
          kit.report({ node: program, messageId: "invalid", data: { reason: classification.reason } });
        }
      },
    };
  },
});
