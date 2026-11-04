export const PACKAGE_MANAGERS = ["bun", "npm", "pnpm", "yarn"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

interface MdNode {
  type: string;
  lang?: string | null;
  meta?: string | null;
  value?: string;
  name?: string;
  attributes?: unknown[];
  children?: MdNode[];
}

function convertLine(line: string, manager: PackageManager): string {
  const [verb = "", ...rest] = line.trim().split(/\s+/);
  const args = rest.join(" ");
  switch (verb) {
    case "install":
      return `${manager} install`;
    case "create": {
      const [name = "", ...others] = rest;
      const extra = others.join(" ");
      if (manager === "npm") {
        const firstFlag = others.findIndex((part) => part.startsWith("-"));
        const location = firstFlag === -1 ? others : others.slice(0, firstFlag);
        const flags = firstFlag === -1 ? [] : others.slice(firstFlag);
        const positional = location.length > 0 ? ` ${location.join(" ")}` : "";
        return `npm create ${name}@latest${positional}${flags.length > 0 ? ` -- ${flags.join(" ")}` : ""}`;
      }
      return `${manager} create ${name}${extra === "" ? "" : ` ${extra}`}`;
    }
    case "add":
      if (rest[0] === "-d") {
        const packages = rest.slice(1).join(" ");
        if (manager === "bun") return `bun add -d ${packages}`;
        if (manager === "npm") return `npm install -D ${packages}`;
        return `${manager} add -D ${packages}`;
      }
      return manager === "npm" ? `npm install ${args}` : `${manager} add ${args}`;
    case "run":
      return manager === "bun" || manager === "npm" ? `${manager} run ${args}` : `${manager} ${args}`;
    case "x":
      if (manager === "bun") return `bunx ${args}`;
      if (manager === "npm") return `npx ${args}`;
      if (manager === "pnpm") return `pnpm exec ${args}`;
      return `yarn ${args}`;
    default:
      throw new Error(`Unknown package manager verb "${verb}" in a pm code fence. Use install, create, add, run or x.`);
  }
}

function expand(node: MdNode): MdNode {
  const lines = (node.value ?? "").split("\n").filter((line) => line.trim() !== "");
  return {
    type: "mdxJsxFlowElement",
    name: "PmTabs",
    attributes: [],
    children: PACKAGE_MANAGERS.map((manager) => ({
      type: "code",
      lang: "bash",
      meta: `pm=${manager}`,
      value: lines.map((line) => convertLine(line, manager)).join("\n"),
    })),
  };
}

function walk(node: MdNode): void {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (child.type === "code" && child.lang === "pm") return expand(child);
    walk(child);
    return child;
  });
}

export function remarkPackageManagers() {
  return (tree: MdNode): void => {
    walk(tree);
  };
}
