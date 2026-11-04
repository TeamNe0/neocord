import { scanProject } from "../utils/project.ts";
import { createRule } from "../utils/rule.ts";

function startsWith(segments: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((segment, index) => segments[index] === segment);
}

export default createRule({
  name: "no-command-with-subcommands",
  type: "problem",
  description: "Disallow a command file in a folder that also holds nested commands.",
  messages: {
    hasSubcommands: 'Command "/{{name}}" cannot have a command file because "/{{nested}}" is nested under it. Discord does not allow a command with subcommands to be run directly.',
    underCommand: 'Command "/{{name}}" cannot sit under "/{{parent}}", which already has a command file.',
  },
  create(kit) {
    return {
      Program(program) {
        const { classification, path, project } = kit.file;
        if (classification.type !== "route" || classification.kind !== "command") return;

        const { segments } = classification;
        const files = scanProject(project);
        if (!files.some((file) => file.path === path)) return;

        for (const { classification: other } of files) {
          if (other.type !== "route" || other.kind !== "command") continue;
          if (other.segments.length > segments.length && startsWith(other.segments, segments)) {
            kit.report({
              node: program,
              messageId: "hasSubcommands",
              data: { name: segments.join(" "), nested: other.segments.join(" ") },
            });
            return;
          }
        }

        for (const { classification: other } of files) {
          if (other.type !== "route" || other.kind !== "command") continue;
          if (other.segments.length < segments.length && startsWith(segments, other.segments)) {
            kit.report({
              node: program,
              messageId: "underCommand",
              data: { name: segments.join(" "), parent: other.segments.join(" ") },
            });
            return;
          }
        }
      },
    };
  },
});
