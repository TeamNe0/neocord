import type { Options } from "@mdx-js/rollup";
import rehypeShiki from "@shikijs/rehype";
import remarkGfm from "remark-gfm";
import { rehypeHeadings } from "./rehype-headings.ts";
import { remarkPackageManagers } from "./remark-package-managers.ts";

const LANGUAGES = [
  "bash",
  "css",
  "diff",
  "docker",
  "html",
  "ini",
  "javascript",
  "json",
  "jsx",
  "nginx",
  "prisma",
  "shellscript",
  "toml",
  "tsx",
  "typescript",
  "yaml",
];

function parseMeta(meta: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of meta.matchAll(/([\w-]+)=(?:"([^"]*)"|(\S+))/g)) {
    const key = match[1];
    if (key !== undefined) fields[key] = match[2] ?? match[3] ?? "";
  }
  return fields;
}

const shikiOptions = {
  themes: { light: "github-light", dark: "tokyo-night" },
  defaultColor: false,
  langs: LANGUAGES,
  langAlias: { sh: "bash", shell: "bash", ts: "typescript", js: "javascript", dockerfile: "docker", env: "ini" },
  defaultLanguage: "text",
  fallbackLanguage: "text",
  parseMetaString: parseMeta,
  transformers: [
    {
      name: "neocord:code-meta",
      pre(node: { properties: Record<string, unknown> }) {
        const meta = (this as unknown as { options: { meta?: Record<string, unknown>; lang?: string } }).options;
        if (typeof meta.meta?.title === "string") node.properties["data-title"] = meta.meta.title;
        if (typeof meta.meta?.pm === "string") node.properties["data-pm"] = meta.meta.pm;
        node.properties["data-lang"] = meta.lang ?? "text";
      },
    },
  ],
};

export const mdxOptions: Options = {
  remarkPlugins: [remarkGfm, remarkPackageManagers],
  rehypePlugins: [[rehypeShiki, shikiOptions], rehypeHeadings] as NonNullable<Options["rehypePlugins"]>,
};
