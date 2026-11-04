import { identifierName, type AstNode } from "../utils/ast.ts";
import { contractLabel } from "../utils/contracts.ts";
import { exportedName } from "../utils/exports.ts";
import { createRule, type RuleKit } from "../utils/rule.ts";

function declaredNames(kit: RuleKit, declaration: AstNode): string {
  if (declaration.declarations) {
    return declaration.declarations.map((declarator) => (declarator.id ? kit.text(declarator.id) : "")).join(", ");
  }
  return identifierName(declaration.id) ?? kit.text(declaration);
}

export default createRule({
  name: "no-extra-exports",
  type: "problem",
  description: "Allow only the default export, plus type exports, in files neocord routes.",
  messages: {
    extra: "A {{label}} file may only export its default. Move \"{{name}}\" into a \"_private\" folder.",
    exportAll: "A {{label}} file may only export its default. Remove this \"export *\".",
  },
  create(kit) {
    function label(): string | null {
      return contractLabel(kit.file.classification);
    }

    return {
      ExportNamedDeclaration(node) {
        const fileLabel = label();
        if (fileLabel === null || node.exportKind === "type") return;

        if (node.declaration && !node.declaration.declare) {
          kit.report({
            node: node.declaration,
            messageId: "extra",
            data: { label: fileLabel, name: declaredNames(kit, node.declaration) },
          });
        }

        for (const specifier of node.specifiers ?? []) {
          const name = exportedName(specifier);
          if (specifier.exportKind === "type" || name === "default") continue;
          kit.report({ node: specifier, messageId: "extra", data: { label: fileLabel, name } });
        }
      },
      ExportAllDeclaration(node) {
        const fileLabel = label();
        if (fileLabel === null || node.exportKind === "type") return;
        kit.report({ node, messageId: "exportAll", data: { label: fileLabel } });
      },
    };
  },
});
