import type { FileClassification } from "@neocord/routing";
import { scanProject } from "../utils/project.ts";
import { createRule } from "../utils/rule.ts";

function featureOf(classification: FileClassification): string | null {
  switch (classification.type) {
    case "route":
    case "group":
    case "feature":
    case "segment":
      return classification.feature;
    default:
      return null;
  }
}

export default createRule({
  name: "require-error-boundary",
  type: "suggestion",
  description: "Require each feature to have its own error.tsx.",
  messages: {
    missing: 'Feature "{{feature}}" has no error.tsx. Add one so its failures show a useful message to users.',
  },
  create(kit) {
    return {
      Program(program) {
        const { classification, path, project } = kit.file;
        const feature = featureOf(classification);
        if (feature === null) return;

        const files = scanProject(project).filter((file) => featureOf(file.classification) === feature);
        if (!files.some((file) => file.path === path)) return;

        const scope = `${project.featuresDir}/${feature}`;
        const hasBoundary = files.some(({ classification: other }) => {
          return other.type === "segment" && other.kind === "error" && other.scope === scope;
        });
        if (hasBoundary) return;

        const anchor = files.find((file) => file.classification.type === "feature") ?? files[0];
        if (anchor?.path === path) kit.report({ node: program, messageId: "missing", data: { feature } });
      },
    };
  },
});
