import { COMMAND_SEGMENT_PATTERN, MAX_COMMAND_DEPTH } from "@neocord/routing";
import { createRule } from "../utils/rule.ts";

export default createRule({
  name: "valid-command-name",
  type: "problem",
  description: "Require folders under commands to be valid Discord command names within the depth limit.",
  messages: {
    invalidName: 'Command folder "{{segment}}" is not a valid Discord command name. Use 1-32 letters, numbers, "-", "_" or "\'".',
    notLowercase: 'Command folder "{{segment}}" must be lowercase. Rename it to "{{lowercase}}".',
    tooDeep: "Commands can be at most {{max}} levels deep, but this one is {{depth}}.",
    groupTooDeep: "A group at depth {{depth}} cannot hold subcommands, because commands can be at most {{max}} levels deep.",
  },
  create(kit) {
    return {
      Program(program) {
        const { classification } = kit.file;
        const isCommand = classification.type === "route" && classification.kind === "command";
        const isGroup = classification.type === "group";
        if (!isCommand && !isGroup) return;

        const { segments } = classification;

        for (const segment of segments) {
          if (!COMMAND_SEGMENT_PATTERN.test(segment)) {
            kit.report({ node: program, messageId: "invalidName", data: { segment } });
          } else if (segment !== segment.toLowerCase()) {
            kit.report({ node: program, messageId: "notLowercase", data: { segment, lowercase: segment.toLowerCase() } });
          }
        }

        const data = { depth: segments.length, max: MAX_COMMAND_DEPTH };
        if (isCommand && segments.length > MAX_COMMAND_DEPTH) {
          kit.report({ node: program, messageId: "tooDeep", data });
        } else if (isGroup && segments.length >= MAX_COMMAND_DEPTH) {
          kit.report({ node: program, messageId: "groupTooDeep", data });
        }
      },
    };
  },
});
