import { findProperty, identifierName, isAstNode, keyName, propertyValue, staticString, unwrap, type AstNode } from "../utils/ast.ts";
import { attributeValue, resolveComponent } from "../utils/jsx.ts";
import { createRule, type RuleKit } from "../utils/rule.ts";

const MASS_MENTION = /(?<![\w@])@(everyone|here)\b/;
const VERBATIM_COMPONENTS = new Set(["Code", "CodeBlock"]);

function isVerbatim(kit: RuleKit, node: AstNode): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === "JSXElement" && VERBATIM_COMPONENTS.has(resolveComponent(kit, current) ?? "")) return true;
    current = current.parent;
  }
  return false;
}

export default createRule({
  name: "no-mass-mentions",
  type: "suggestion",
  description: "Disallow enabling @everyone in allowedMentions and writing mass mentions in JSX text.",
  messages: {
    parseEveryone: 'Do not put "everyone" in allowedMentions.parse. It lets a message ping the whole server, including through user input.',
    text: "Avoid literal @{{mention}} in JSX text. Mention a role with <RoleMention> instead.",
  },
  create(kit) {
    function checkAllowedMentions(value: AstNode | null): void {
      if (value?.type !== "ObjectExpression") return;
      const parse = propertyValue(findProperty(value, "parse"));
      if (parse?.type !== "ArrayExpression") return;
      for (const element of parse.elements ?? []) {
        if (element && staticString(element) === "everyone") {
          kit.report({ node: element, messageId: "parseEveryone" });
        }
      }
    }

    function checkText(node: AstNode, text: unknown): void {
      if (typeof text !== "string") return;
      const mention = MASS_MENTION.exec(text)?.[1];
      if (mention && !isVerbatim(kit, node)) kit.report({ node, messageId: "text", data: { mention } });
    }

    return {
      Property(property) {
        if (keyName(property) === "allowedMentions") checkAllowedMentions(propertyValue(property));
      },
      JSXAttribute(attribute) {
        if (isAstNode(attribute.name) && identifierName(attribute.name) === "allowedMentions") {
          const value = attributeValue(attribute);
          checkAllowedMentions(value ? unwrap(value) : null);
        }
      },
      JSXText(node) {
        checkText(node, node.value);
      },
      JSXExpressionContainer(container) {
        if (container.parent?.type === "JSXAttribute") return;
        checkText(container, staticString(container.expression));
      },
    };
  },
});
