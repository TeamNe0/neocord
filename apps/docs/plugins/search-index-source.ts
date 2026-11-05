import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { ALL_PAGES, groupOf, type PageDef } from "../src/data/nav.ts";
import { slugify } from "./rehype-headings.ts";

export interface SearchEntry {
  url: string;
  page: string;
  group: string;
  heading: string;
  text: string;
}

const HEADING = /^(#{2,3})\s+(.+)$/;

function stripInline(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`/g, "")
    .replace(/\*+/g, "");
}

function plainText(lines: readonly string[]): string {
  return stripInline(
    lines
      .join("\n")
      .replace(/^(?:import|export)\s.*$/gm, " ")
      .replace(/^\s*<\/?[A-Z][^\n]*$/gm, " ")
      .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, " ")
      .replace(/\|/g, " ")
      .replace(/^\s*>\s?/gm, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function entriesFor(page: PageDef, source: string): SearchEntry[] {
  const group = groupOf(page.path) ?? "";
  const body = source.replace(/^(`{3,})[\s\S]*?^\1\s*$/gm, " ");
  const seen = new Map<string, number>();
  const entries: SearchEntry[] = [];
  let url = page.path;
  let heading = "";
  let lines: string[] = [];

  const flush = (): void => {
    const text = plainText(lines).slice(0, 700);
    entries.push({ url, page: page.title, group, heading, text: text || (heading === "" ? page.description : "") });
  };

  for (const line of body.split(/\r?\n/)) {
    const match = HEADING.exec(line);
    if (match === null) {
      lines.push(line);
      continue;
    }
    flush();
    heading = stripInline(match[2] ?? "").trim();
    const base = slugify(heading) || "section";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    url = `${page.path}#${count === 0 ? base : `${base}-${count}`}`;
    lines = [];
  }
  flush();
  return entries;
}

export function buildSearchIndex(contentRoot: string): SearchEntry[] {
  return ALL_PAGES.flatMap((page) => entriesFor(page, readFileSync(join(contentRoot, `${page.file}.mdx`), "utf8")));
}

export function searchIndexDev(): Plugin {
  return {
    name: "neocord:search-index-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/search-index.json", (_request, response) => {
        try {
          const index = buildSearchIndex(join(server.config.root, "src/content"));
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(index));
        } catch (error) {
          response.statusCode = 500;
          response.end(error instanceof Error ? error.message : String(error));
        }
      });
    },
  };
}
