interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  data?: unknown;
}

interface HeadingEntry {
  id: string;
  title: string;
  level: number;
}

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function toEstree(value: unknown): unknown {
  if (Array.isArray(value)) {
    return { type: "ArrayExpression", elements: value.map(toEstree) };
  }
  if (typeof value === "object" && value !== null) {
    return {
      type: "ObjectExpression",
      properties: Object.entries(value).map(([key, entry]) => ({
        type: "Property",
        kind: "init",
        method: false,
        shorthand: false,
        computed: false,
        key: { type: "Identifier", name: key },
        value: toEstree(entry),
      })),
    };
  }
  return { type: "Literal", value, raw: JSON.stringify(value) };
}

function exportNode(headings: readonly HeadingEntry[]): HastNode {
  return {
    type: "mdxjsEsm",
    value: "",
    data: {
      estree: {
        type: "Program",
        sourceType: "module",
        body: [
          {
            type: "ExportNamedDeclaration",
            source: null,
            specifiers: [],
            attributes: [],
            declaration: {
              type: "VariableDeclaration",
              kind: "const",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "headings" },
                  init: toEstree(headings),
                },
              ],
            },
          },
        ],
      },
    },
  };
}

export function rehypeHeadings() {
  return (tree: HastNode): void => {
    const headings: HeadingEntry[] = [];
    const seen = new Map<string, number>();

    const visit = (node: HastNode): void => {
      if (node.type === "element" && (node.tagName === "h2" || node.tagName === "h3")) {
        const title = textOf(node).trim();
        const base = slugify(title) || "section";
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        node.properties = { ...node.properties, id };
        headings.push({ id, title, level: node.tagName === "h2" ? 2 : 3 });
        return;
      }
      if (node.tagName === "pre") return;
      for (const child of node.children ?? []) visit(child);
    };

    visit(tree);
    tree.children = [exportNode(headings), ...(tree.children ?? [])];
  };
}
