import { flattenChildren, resolveComponent, SELECT_COMPONENTS } from "../utils/jsx.ts";
import { createRule } from "../utils/rule.ts";

const TEXTLESS_COMPONENTS = new Set([...SELECT_COMPONENTS, "ActionRow", "MediaGallery"]);

export default createRule({
  name: "no-text-in-action-row",
  type: "problem",
  description: "Disallow text directly inside ActionRow, MediaGallery and select components.",
  messages: {
    text: "<{{component}}> cannot contain text. Move it into a <TextDisplay> outside the component.",
  },
  create(kit) {
    return {
      JSXElement(element) {
        const component = resolveComponent(kit, element);
        if (component === null || !TEXTLESS_COMPONENTS.has(component)) return;
        for (const child of flattenChildren(kit, element)) {
          if (child.kind === "text") kit.report({ node: child.node, messageId: "text", data: { component } });
        }
      },
    };
  },
});
