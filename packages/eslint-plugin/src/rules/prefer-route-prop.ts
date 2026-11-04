import { keyName, staticString, type AstNode } from "../utils/ast.ts";
import { attributeValue, findAttribute, resolveComponent, SELECT_COMPONENTS } from "../utils/jsx.ts";
import { createRule, type RuleKit } from "../utils/rule.ts";
import { calleeName } from "../utils/scope.ts";

const MODAL_FIELD_ANCESTORS = new Set(["Label", "Modal"]);

function isModalField(kit: RuleKit, element: AstNode): boolean {
  let current = element.parent;
  while (current) {
    if (current.type === "JSXElement" && MODAL_FIELD_ANCESTORS.has(resolveComponent(kit, current) ?? "")) return true;
    if (current.type === "Property" && keyName(current) === "render") {
      const call = current.parent?.parent;
      if (call?.type === "CallExpression" && calleeName(kit, call) === "defineModal") return true;
    }
    current = current.parent;
  }
  return false;
}

export default createRule({
  name: "prefer-route-prop",
  type: "suggestion",
  description: "Prefer the typed route prop over a hardcoded customId on buttons and selects.",
  messages: {
    preferRoute: 'Use route="..." on <{{component}}> instead of a literal customId, so the id is checked against your routes.',
  },
  create(kit) {
    return {
      JSXElement(element) {
        const name = resolveComponent(kit, element);
        if (name === null || (name !== "Button" && !SELECT_COMPONENTS.has(name))) return;

        const attribute = findAttribute(element, "customId");
        if (!attribute || staticString(attributeValue(attribute)) === null) return;
        if (!isModalField(kit, element)) {
          kit.report({ node: attribute, messageId: "preferRoute", data: { component: name } });
        }
      },
    };
  },
});
