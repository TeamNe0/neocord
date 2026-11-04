import { identifierName, programBody, staticString, type AstNode } from "./ast.ts";

export type DefaultExport =
  | { readonly kind: "value"; readonly node: AstNode; readonly value: AstNode }
  | { readonly kind: "reexport"; readonly node: AstNode };

const TYPE_ONLY_DECLARATIONS = new Set(["TSDeclareFunction", "TSInterfaceDeclaration", "TSTypeAliasDeclaration"]);

export function exportedName(specifier: AstNode): string {
  return identifierName(specifier.exported) ?? staticString(specifier.exported) ?? "";
}

export function findDefaultExport(program: AstNode): DefaultExport | null {
  for (const statement of programBody(program)) {
    if (statement.type === "ExportDefaultDeclaration" && statement.declaration) {
      if (TYPE_ONLY_DECLARATIONS.has(statement.declaration.type)) continue;
      return { kind: "value", node: statement, value: statement.declaration };
    }
    if (statement.type === "ExportNamedDeclaration" && statement.exportKind !== "type") {
      for (const specifier of statement.specifiers ?? []) {
        if (specifier.exportKind === "type" || exportedName(specifier) !== "default") continue;
        if (statement.source) return { kind: "reexport", node: specifier };
        if (specifier.local) return { kind: "value", node: specifier, value: specifier.local };
      }
    }
  }
  return null;
}
