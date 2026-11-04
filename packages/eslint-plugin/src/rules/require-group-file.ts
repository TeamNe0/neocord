import { scanProject } from "../utils/project.ts";
import { createRule } from "../utils/rule.ts";

export default createRule({
  name: "require-group-file",
  type: "suggestion",
  description: "Require a group file with a description in the root folder of nested commands.",
  messages: {
    missing: 'Nested command "/{{name}}" has no group file for "/{{root}}". Add "{{root}}/group.ts" with defineGroup({ description }).',
  },
  create(kit) {
    return {
      Program(program) {
        const { classification, path, project } = kit.file;
        if (classification.type !== "route" || classification.kind !== "command") return;

        const { segments } = classification;
        const root = segments[0];
        if (root === undefined || segments.length < 2) return;

        const files = scanProject(project);
        if (!files.some((file) => file.path === path)) return;

        const hasGroup = files.some(({ classification: other }) => {
          return other.type === "group" && other.segments.length === 1 && other.segments[0] === root;
        });
        if (!hasGroup) {
          kit.report({ node: program, messageId: "missing", data: { name: segments.join(" "), root } });
        }
      },
    };
  },
});
