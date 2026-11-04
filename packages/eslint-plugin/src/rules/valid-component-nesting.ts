import { isAstNode, type AstNode } from "../utils/ast.ts";
import {
  attributeValue,
  findAttribute,
  flattenChildren,
  FORM_CONTROLS,
  parentComponent,
  resolveComponent,
  SELECT_COMPONENTS,
  TEXT_COMPONENTS,
} from "../utils/jsx.ts";
import { createRule, type RuleKit } from "../utils/rule.ts";

const MAX_BUTTONS_PER_ROW = 5;

const ALLOWED_PARENTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Button", new Set(["ActionRow"])],
  ...[...SELECT_COMPONENTS].map((name): [string, ReadonlySet<string>] => [name, new Set(["ActionRow", "Label"])]),
  ["Option", new Set(["CheckboxGroup", "RadioGroup", "StringSelect"])],
  ["MediaItem", new Set(["MediaGallery"])],
  ["TextInput", new Set(["Label"])],
]);

const SECTION_ACCESSORIES = new Set(["Button", "Thumbnail"]);

function hasPlacementRule(name: string): boolean {
  return ALLOWED_PARENTS.has(name) || name === "Message";
}

function placementHint(name: string): string {
  if (name === "Button") return "<ActionRow> or the accessory prop of <Section>";
  return [...(ALLOWED_PARENTS.get(name) ?? [])].map((parent) => `<${parent}>`).join(" or ");
}

export default createRule({
  name: "valid-component-nesting",
  type: "problem",
  description: "Check the static JSX structure of @neocord/react components.",
  messages: {
    misplaced: "<{{component}}> cannot be inside <{{parent}}>. It belongs in {{allowed}}.",
    messageNotRoot: "<Message> must be the root of the tree, not inside <{{parent}}>.",
    rowInvalidChild: "<{{component}}> cannot be inside <ActionRow>. A row holds buttons or a select.",
    rowMixed: "An <ActionRow> cannot mix buttons and selects. Put them in separate rows.",
    rowTooManyButtons: "An <ActionRow> can hold at most {{max}} buttons, but this one has {{count}}.",
    rowSelectNotAlone: "A select must be alone in its <ActionRow>.",
    sectionInvalidChild: "<{{component}}> cannot be a child of <Section>, which only takes text. Use the accessory prop for a button or thumbnail.",
    sectionInvalidAccessory: "<{{component}}> cannot be a Section accessory. Use <Button> or <Thumbnail>.",
    labelNoControl: "<Label> must contain exactly one form control, but this one has none.",
    labelManyControls: "<Label> must contain exactly one form control, but this one has {{count}}.",
  },
  create(kit) {
    function checkPlacement(element: AstNode, name: string): void {
      const parent = parentComponent(kit, element);
      if (parent === null) return;
      if (name === "Message") {
        kit.report({ node: element, messageId: "messageNotRoot", data: { parent } });
        return;
      }
      const allowed = ALLOWED_PARENTS.get(name);
      if (allowed && !allowed.has(parent)) {
        kit.report({
          node: element,
          messageId: "misplaced",
          data: { component: name, parent, allowed: placementHint(name) },
        });
      }
    }

    function checkActionRow(element: AstNode): void {
      const children = flattenChildren(kit, element);
      let buttons = 0;
      let selects = 0;
      for (const child of children) {
        if (child.kind !== "component") continue;
        if (child.name === "Button") buttons++;
        else if (SELECT_COMPONENTS.has(child.name)) selects++;
        else if (!hasPlacementRule(child.name)) {
          kit.report({ node: child.node, messageId: "rowInvalidChild", data: { component: child.name } });
        }
      }

      if (buttons > 0 && selects > 0) kit.report({ node: element, messageId: "rowMixed" });
      else if (selects > 1) kit.report({ node: element, messageId: "rowSelectNotAlone" });
      if (buttons > MAX_BUTTONS_PER_ROW) {
        kit.report({
          node: element,
          messageId: "rowTooManyButtons",
          data: { max: MAX_BUTTONS_PER_ROW, count: buttons },
        });
      }
    }

    function checkSection(element: AstNode): void {
      for (const child of flattenChildren(kit, element)) {
        if (child.kind !== "component" || TEXT_COMPONENTS.has(child.name) || hasPlacementRule(child.name)) continue;
        kit.report({ node: child.node, messageId: "sectionInvalidChild", data: { component: child.name } });
      }

      const accessory = findAttribute(element, "accessory");
      const value = accessory ? attributeValue(accessory) : null;
      if (!isAstNode(value) || value.type !== "JSXElement") return;
      const name = resolveComponent(kit, value);
      if (name !== null && !SECTION_ACCESSORIES.has(name)) {
        kit.report({ node: value, messageId: "sectionInvalidAccessory", data: { component: name } });
      }
    }

    function checkLabel(element: AstNode): void {
      const children = flattenChildren(kit, element);
      const count = children.filter((child) => child.kind === "component" && FORM_CONTROLS.has(child.name)).length;
      const isResolved = children.every((child) => child.kind === "component" || child.kind === "text");
      if (count > 1) kit.report({ node: element, messageId: "labelManyControls", data: { count } });
      else if (count === 0 && isResolved) kit.report({ node: element, messageId: "labelNoControl" });
    }

    return {
      JSXElement(element) {
        const name = resolveComponent(kit, element);
        if (name === null) return;
        checkPlacement(element, name);
        if (name === "ActionRow") checkActionRow(element);
        else if (name === "Section") checkSection(element);
        else if (name === "Label") checkLabel(element);
      },
    };
  },
});
