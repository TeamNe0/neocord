import { identifierName, keyName, memberName, propertyValue, staticString, unwrap, type AstNode } from "../utils/ast.ts";
import { createRule } from "../utils/rule.ts";
import { importBinding, importedName, isNamespaceLike } from "../utils/scope.ts";

const BUILDER_MODULES = new Set(["@discordjs/builders", "discord.js"]);

const FORBIDDEN_BUILDERS = new Set([
  "ActionRowBuilder",
  "ButtonBuilder",
  "ChannelSelectMenuBuilder",
  "CheckboxBuilder",
  "CheckboxGroupBuilder",
  "CheckboxGroupOptionBuilder",
  "ContainerBuilder",
  "EmbedBuilder",
  "FileBuilder",
  "FileUploadBuilder",
  "LabelBuilder",
  "MediaGalleryBuilder",
  "MediaGalleryItemBuilder",
  "MentionableSelectMenuBuilder",
  "ModalBuilder",
  "RadioGroupBuilder",
  "RadioGroupOptionBuilder",
  "RoleSelectMenuBuilder",
  "SectionBuilder",
  "SelectMenuBuilder",
  "SelectMenuOptionBuilder",
  "SeparatorBuilder",
  "StringSelectMenuBuilder",
  "StringSelectMenuOptionBuilder",
  "TextDisplayBuilder",
  "TextInputBuilder",
  "ThumbnailBuilder",
  "UserSelectMenuBuilder",
]);

const SEND_METHODS = new Set(["followUp", "reply", "send"]);

function isSendCall(call: AstNode): boolean {
  if (!call.callee) return false;
  const name = memberName(unwrap(call.callee));
  return name !== null && (SEND_METHODS.has(name) || name.startsWith("edit"));
}

function isRawUi(property: string, value: AstNode): boolean {
  if (value.type === "ArrayExpression") return (value.elements?.length ?? 0) > 0;
  return property === "embeds";
}

export default createRule({
  name: "no-embed-builders",
  type: "suggestion",
  description: "Disallow discord.js component builders and raw payloads in favour of @neocord/react.",
  messages: {
    builder: "Do not use {{name}}. Render JSX with @neocord/react instead.",
    rawPayload: 'Do not pass raw "{{property}}". Return JSX from the handler or pass it to ctx.reply, using @neocord/react.',
  },
  create(kit) {
    return {
      ImportDeclaration(declaration) {
        if (declaration.importKind === "type" || !BUILDER_MODULES.has(staticString(declaration.source) ?? "")) return;
        for (const specifier of declaration.specifiers ?? []) {
          const name = importedName(specifier);
          if (specifier.importKind !== "type" && FORBIDDEN_BUILDERS.has(name)) {
            kit.report({ node: specifier, messageId: "builder", data: { name } });
          }
        }
      },
      MemberExpression(member) {
        const name = memberName(member);
        if (name === null || !FORBIDDEN_BUILDERS.has(name) || !member.object) return;
        const objectName = identifierName(unwrap(member.object));
        if (objectName === null) return;
        const binding = importBinding(kit, member, objectName);
        if (isNamespaceLike(binding) && !binding.typeOnly && BUILDER_MODULES.has(binding.source)) {
          kit.report({ node: member, messageId: "builder", data: { name } });
        }
      },
      CallExpression(call) {
        if (!isSendCall(call)) return;
        for (const argument of call.arguments ?? []) {
          if (argument.type !== "ObjectExpression") continue;
          for (const property of argument.properties ?? []) {
            const name = keyName(property);
            if (name !== "embeds" && name !== "components") continue;
            const value = propertyValue(property);
            if (value && isRawUi(name, value)) {
              kit.report({ node: property, messageId: "rawPayload", data: { property: name } });
            }
          }
        }
      },
    };
  },
});
