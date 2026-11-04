import { COMMAND_SEGMENT_PATTERN } from "@neocord/routing";
import {
  findProperty,
  hasSpread,
  identifierName,
  keyName,
  memberName,
  propertyValue,
  staticString,
  unwrap,
  type AstNode,
} from "../utils/ast.ts";
import { DEFINITION_ARGUMENT_INDEX } from "../utils/handlers.ts";
import { createRule, type RuleKit } from "../utils/rule.ts";
import { calleeName, importBinding, resolveValue } from "../utils/scope.ts";

const MAX_DESCRIPTION_LENGTH = 100;
const MAX_OPTIONS = 25;

const REQUIRED_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  defineCommand: ["description", "execute"],
  defineGroup: ["description"],
  defineUserCommand: ["name", "execute"],
  defineMessageCommand: ["name", "execute"],
  defineButton: ["execute"],
  defineSelect: ["execute"],
  defineModal: ["submit"],
  defineEvent: ["execute"],
  defineTask: ["every", "execute"],
};

const DESCRIBED_HELPERS = new Set(["defineCommand", "defineGroup"]);

function isOptionCall(kit: RuleKit, node: AstNode): boolean {
  if (node.type !== "CallExpression" || !node.callee) return false;
  const callee = unwrap(node.callee);
  if (callee.type !== "MemberExpression" || !callee.object || memberName(callee) === null) return false;
  const objectName = identifierName(unwrap(callee.object));
  if (objectName === null) return false;
  const binding = importBinding(kit, callee, objectName);
  return (binding ? binding.imported : objectName) === "option";
}

export default createRule({
  name: "valid-command-definition",
  type: "problem",
  description: "Check definitions passed to define helpers against Discord and neocord requirements.",
  messages: {
    missingProperty: "{{helper}}() requires \"{{property}}\".",
    descriptionLength: "A description must be 1-{{max}} characters, but this one has {{length}}.",
    invalidOptionName: 'Option name "{{name}}" must be a lowercase Discord name of 1-32 letters, numbers, "-", "_" or "\'".',
    missingOptionDescription: 'Option "{{name}}" requires a description.',
    tooManyOptions: "A command can have at most {{max}} options, but this one has {{count}}.",
  },
  create(kit) {
    function checkDescription(property: AstNode | null): void {
      const value = propertyValue(property);
      const text = staticString(value);
      if (!value || text === null) return;
      if (text.length < 1 || text.length > MAX_DESCRIPTION_LENGTH) {
        kit.report({
          node: value,
          messageId: "descriptionLength",
          data: { max: MAX_DESCRIPTION_LENGTH, length: text.length },
        });
      }
    }

    function checkOption(property: AstNode): void {
      const name = keyName(property);
      if (name === null) return;
      if (!COMMAND_SEGMENT_PATTERN.test(name) || name !== name.toLowerCase()) {
        kit.report({ node: property.key ?? property, messageId: "invalidOptionName", data: { name } });
      }

      const value = propertyValue(property);
      if (!value || !isOptionCall(kit, value)) return;

      const argument = value.arguments?.[0];
      const definition = argument ? resolveValue(kit, argument) : null;
      if (definition && definition.type !== "ObjectExpression") return;
      if (definition && hasSpread(definition) && !findProperty(definition, "description")) return;

      const description = definition ? findProperty(definition, "description") : null;
      if (!description) {
        kit.report({ node: value, messageId: "missingOptionDescription", data: { name } });
        return;
      }
      checkDescription(description);
    }

    function checkOptions(definition: AstNode): void {
      const value = propertyValue(findProperty(definition, "options"));
      if (!value) return;
      const options = resolveValue(kit, value);
      if (options.type !== "ObjectExpression") return;

      const properties = (options.properties ?? []).filter((property) => property.type === "Property");
      if (properties.length > MAX_OPTIONS) {
        kit.report({
          node: value,
          messageId: "tooManyOptions",
          data: { max: MAX_OPTIONS, count: properties.length },
        });
      }
      for (const property of properties) checkOption(property);
    }

    return {
      CallExpression(call) {
        const helper = calleeName(kit, call);
        if (helper === null || !Object.hasOwn(DEFINITION_ARGUMENT_INDEX, helper)) return;

        const argument = call.arguments?.[DEFINITION_ARGUMENT_INDEX[helper] ?? 0];
        const definition = argument ? resolveValue(kit, argument) : null;
        if (definition && definition.type !== "ObjectExpression") return;

        const canBeMissing = !definition || !hasSpread(definition);
        for (const property of REQUIRED_PROPERTIES[helper] ?? []) {
          if (canBeMissing && !(definition && findProperty(definition, property))) {
            kit.report({ node: definition ?? call, messageId: "missingProperty", data: { helper, property } });
          }
        }

        if (!definition) return;
        if (DESCRIBED_HELPERS.has(helper)) checkDescription(findProperty(definition, "description"));
        if (helper === "defineCommand") checkOptions(definition);
      },
    };
  },
});
