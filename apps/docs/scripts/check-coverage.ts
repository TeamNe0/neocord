import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { slugify } from "../plugins/rehype-headings.ts";
import { buildSearchIndex } from "../plugins/search-index-source.ts";
import { ESLINT_RULE_INDEX } from "../src/data/eslint-rule-index.ts";
import { ESLINT_RULES } from "../src/data/eslint-rules.ts";
import { ALL_PAGES, HOME_META, NAV } from "../src/data/nav.ts";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(here, "..");
const repoRoot = resolve(docsRoot, "../..");
const contentRoot = join(docsRoot, "src/content");
const dist = join(docsRoot, "dist");

const failures: string[] = [];
let passes = 0;

function check(condition: boolean, message: string): void {
  if (condition) passes += 1;
  else failures.push(message);
}

function readRepo(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function contentFile(file: string): string {
  return join(contentRoot, `${file}.mdx`);
}

function readContent(file: string): string {
  return readFileSync(contentFile(file), "utf8");
}

function walk(directory: string, extension: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return walk(path, extension);
    return path.endsWith(extension) ? [path] : [];
  });
}

function flagNames(spec: string): string[] {
  return spec
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0] ?? "")
    .filter((part) => part.startsWith("-"));
}

function checkPages(): void {
  const seen = new Set<string>();
  for (const page of ALL_PAGES) {
    check(!seen.has(page.path), `Duplicate page path ${page.path}.`);
    seen.add(page.path);
    check(existsSync(contentFile(page.file)), `${page.path} has no file at src/content/${page.file}.mdx.`);
    check(page.description.length >= 30, `${page.path} needs a real description.`);
  }
  check(NAV.length > 0, "The navigation is empty.");
}

function checkEslintRules(): void {
  const directory = join(repoRoot, "packages/eslint-plugin/src/rules");
  const names = readdirSync(directory)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => file.slice(0, -3));
  const documented = new Map(ESLINT_RULES.map((rule) => [rule.name, rule]));
  const overview = readContent("tooling/eslint");

  for (const name of names) {
    const rule = documented.get(name);
    check(rule !== undefined, `ESLint rule ${name} has no entry in src/data/eslint-rules.ts.`);
    check(
      ALL_PAGES.some((page) => page.path === `/docs/eslint/${name}`),
      `ESLint rule ${name} has no page at /docs/eslint/${name}.`,
    );
    check(overview.includes(`/docs/eslint/${name}`), `The ESLint overview does not link to ${name}.`);
    if (rule === undefined) continue;
    check(rule.incorrect.length > 0, `ESLint rule ${name} has no incorrect examples.`);
    check(rule.correct.length > 0, `ESLint rule ${name} has no correct examples.`);
    check(rule.why.trim() !== "", `ESLint rule ${name} has no explanation.`);
    const source = readFileSync(join(directory, `${name}.ts`), "utf8");
    for (const id of Object.keys(rule.messages)) {
      check(source.includes(`${id}:`), `ESLint rule ${name} documents a message "${id}" that its source does not have.`);
    }
  }
  for (const rule of ESLINT_RULES) {
    check(names.includes(rule.name), `src/data/eslint-rules.ts documents ${rule.name}, which is not a rule.`);
    const summary = ESLINT_RULE_INDEX.find((entry) => entry.name === rule.name);
    check(summary?.description === rule.description, `src/data/eslint-rule-index.ts is out of step with eslint-rules.ts for ${rule.name}.`);
    const source = readFileSync(join(directory, `${rule.name}.ts`), "utf8");
    check(source.includes(rule.description), `The description of ${rule.name} does not match its source.`);
  }
  check(ESLINT_RULE_INDEX.length === ESLINT_RULES.length, "src/data/eslint-rule-index.ts and eslint-rules.ts list different rules.");
}

function checkCli(): void {
  const source = readRepo("packages/cli/src/cli.ts");
  const reference = readContent("tooling/cli");
  const commands = [...source.matchAll(/\.command\("([\w-]+)"\)/g)].flatMap((match) => (match[1] ? [match[1]] : []));
  check(commands.length > 0, "Found no commands in packages/cli/src/cli.ts.");

  for (const command of commands) {
    check(reference.includes(`neocord ${command}`), `CLI command "neocord ${command}" is not in the CLI reference.`);
  }

  const flags = [...source.matchAll(/\.(?:option|version|helpOption)\(\s*(?:version,\s*)?"([^"]+)"/g)].flatMap((match) =>
    match[1] ? flagNames(match[1]) : [],
  );
  check(flags.length > 0, "Found no flags in packages/cli/src/cli.ts.");
  for (const flag of new Set(flags)) {
    check(reference.includes(`\`${flag}`) || reference.includes(` ${flag}`), `CLI flag ${flag} is not in the CLI reference.`);
  }
}

function checkCreateNeocord(): void {
  const source = readRepo("packages/create-neocord/src/cli.ts");
  const pages = [readContent("api/create-neocord"), readContent("getting-started/quick-start")];
  const flags = [
    ...source.matchAll(/\.(?:option|version|helpOption)\(\s*(?:readPackageVersion\(\),\s*)?"([^"]+)"/g),
    ...source.matchAll(/new Option\("([^"]+)"/g),
  ].flatMap((match) => (match[1] ? flagNames(match[1]) : []));
  check(flags.length > 0, "Found no flags in packages/create-neocord/src/cli.ts.");

  for (const flag of new Set(flags)) {
    for (const [index, page] of pages.entries()) {
      const name = index === 0 ? "the create-neocord API page" : "the quick start";
      check(page.includes(`\`${flag}`) || page.includes(` ${flag}`), `create-neocord flag ${flag} is missing from ${name}.`);
    }
  }
}

function checkReactComponents(): void {
  const files = { inline: "ui/inline", interactive: "ui/interactive", layout: "ui/layout", modal: "ui/modal" } as const;
  const api = readContent("api/react");
  for (const [source, page] of Object.entries(files)) {
    const code = readRepo(`packages/react/src/components/${source}.tsx`);
    const content = readContent(page);
    const names = [...code.matchAll(/export function (\w+)/g)].flatMap((match) => (match[1] ? [match[1]] : []));
    check(names.length > 0, `Found no components in packages/react/src/components/${source}.tsx.`);
    for (const name of names) {
      check(content.includes(`\`${name}\``), `@teamneo/neocord-react component ${name} is not documented on ${page}.`);
      check(content.includes(`### \`${name}\``), `@teamneo/neocord-react component ${name} has no heading on ${page}.`);
      check(api.includes(name), `@teamneo/neocord-react component ${name} is not in the API reference.`);
    }
  }
}

function checkTestingExports(): void {
  const source = readRepo("packages/neocord/src/testing/index.ts");
  const api = readContent("api/testing");
  const names = [...source.matchAll(/^\s+(\w+),$/gm)].flatMap((match) => (match[1] ? [match[1]] : []));
  check(names.length > 0, "Found no exports in packages/neocord/src/testing/index.ts.");
  for (const name of names) {
    check(api.includes(name), `neocord/testing export ${name} is not in the API reference.`);
  }
}

function headingsOf(markdown: string): Set<string> {
  const ids = new Set<string>();
  const counts = new Map<string, number>();
  const withoutFences = markdown.replace(/^(`{3,})[\s\S]*?^\1\s*$/gm, "");
  for (const match of withoutFences.matchAll(/^#{2,3}\s+(.+)$/gm)) {
    const title = (match[1] ?? "")
      .replace(/`/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*/g, "");
    const base = slugify(title) || "section";
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    ids.add(count === 0 ? base : `${base}-${count}`);
  }
  return ids;
}

function checkLinks(): void {
  const routes = new Set([...ALL_PAGES.map((page) => page.path), HOME_META.path]);
  const anchors = new Map(ALL_PAGES.map((page) => [page.path, headingsOf(readContent(page.file))]));
  const files = [
    ...walk(contentRoot, ".mdx"),
    ...walk(join(docsRoot, "src/components"), ".tsx"),
    join(docsRoot, "src/data/eslint-rules.ts"),
  ];
  const patterns = [/\]\((\/[^)\s]*|#[^)\s]+)\)/g, /(?:href|to)="(\/[^"]*)"/g, /\bto: "(\/[^"]*)"/g];

  for (const file of files) {
    const text = readFileSync(file, "utf8").replace(/^(`{3,})[\s\S]*?^\1\s*$/gm, "");
    const label = relative(docsRoot, file).replaceAll("\\", "/");
    const self = ALL_PAGES.find((page) => contentFile(page.file) === file)?.path;

    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const target = match[1] ?? "";
        const [rawPath = "", hash] = target.split("#");
        const path = rawPath === "" ? self : rawPath.replace(/\/+$/, "") || "/";
        if (path === undefined) continue;
        if (/\.\w+$/.test(path)) continue;
        check(routes.has(path), `${label} links to ${target}, which is not a page.`);
        if (hash !== undefined && routes.has(path)) {
          const known = anchors.get(path);
          if (known !== undefined) check(known.has(hash), `${label} links to ${target}, which is not a heading on that page.`);
        }
      }
    }
  }
}

function checkNoComments(): void {
  const directories = ["src", "scripts", "plugins"].map((directory) => join(docsRoot, directory));
  const files = directories.flatMap((directory) => [...walk(directory, ".ts"), ...walk(directory, ".tsx"), ...walk(directory, ".css")]);
  for (const file of files) {
    const label = relative(docsRoot, file).replaceAll("\\", "/");
    const text = readFileSync(file, "utf8");
    check(!/^\s*\/\//m.test(text), `${label} has a line comment.`);
    check(!/^\s*\/\*/m.test(text), `${label} has a block comment.`);
  }
}

function plainBody(html: string): string {
  const start = html.indexOf('<div id="root">');
  return html
    .slice(start)
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function checkOutput(): void {
  check(existsSync(dist), "dist does not exist. Run bun run build first.");
  if (!existsSync(dist)) return;

  const pages = [{ path: HOME_META.path, title: HOME_META.title, minimum: 500 }, ...ALL_PAGES.map((page) => ({ path: page.path, title: page.title, minimum: 200 }))];
  for (const page of pages) {
    const file = join(dist, page.path, "index.html");
    check(existsSync(file), `${page.path} has no prerendered file.`);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, "utf8");
    const titleText = page.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    check(new RegExp(`<title>[^<]*`).test(html) && html.includes(titleText), `${page.path} does not contain its title.`);
    check(html.includes('<link rel="canonical"'), `${page.path} has no canonical link.`);
    check(html.includes('<meta property="og:title"'), `${page.path} has no Open Graph tags.`);
    check(html.includes('<meta name="twitter:card"'), `${page.path} has no Twitter tags.`);
    check(!html.includes("<!--app-"), `${page.path} still has a template placeholder.`);
    check(!html.includes("This page does not exist"), `${page.path} rendered the not found page.`);
    check(plainBody(html).length >= page.minimum, `${page.path} has too little body content.`);
  }

  const notFound = join(dist, "404.html");
  check(existsSync(notFound) && readFileSync(notFound, "utf8").includes("This page does not exist"), "404.html is missing or has the wrong content.");

  const sitemapFile = join(dist, "sitemap.xml");
  check(existsSync(sitemapFile), "sitemap.xml is missing.");
  if (existsSync(sitemapFile)) {
    const sitemap = readFileSync(sitemapFile, "utf8");
    for (const page of ALL_PAGES) check(sitemap.includes(`${page.path}</loc>`), `sitemap.xml does not list ${page.path}.`);
  }

  for (const file of ["robots.txt", "favicon.svg", "og.png", "search-index.json", "_headers", "theme.js"]) {
    check(existsSync(join(dist, file)), `dist/${file} is missing.`);
  }

  const sample = readFileSync(join(dist, "docs/quick-start/index.html"), "utf8");
  check(sample.includes("--shiki-light"), "Code in the prerendered HTML is not highlighted.");
  check(/<pre [^>]*class="[^"]*\bshiki\b/.test(sample), "Code blocks lost the shiki class, so their tokens have no color.");

  const searchFile = join(dist, "search-index.json");
  if (existsSync(searchFile)) {
    const built = new Set((JSON.parse(readFileSync(searchFile, "utf8")) as { url: string }[]).map((entry) => entry.url));
    const source = new Set(buildSearchIndex(contentRoot).map((entry) => entry.url));
    for (const url of source) check(built.has(url), `The dev search index has ${url}, which the built index does not.`);
    for (const url of built) check(source.has(url), `The built search index has ${url}, which the dev index does not.`);
  }
  for (const manager of ["bun", "npm", "pnpm", "yarn"]) {
    check(sample.includes(`data-pm-panel="${manager}"`), `Package manager tabs have no ${manager} panel in the prerendered HTML.`);
  }

  const external = /(?:src|href)="https?:\/\/(?!discord|www\.|bun\.|github|docs\.|orm\.|env\.|standardschema|neocord\.dev)[^"]*\.(?:js|css|woff2?)"/;
  for (const page of pages) {
    const file = join(dist, page.path, "index.html");
    if (existsSync(file)) check(!external.test(readFileSync(file, "utf8")), `${page.path} loads a script, style or font from another origin.`);
  }
}

checkPages();
checkEslintRules();
checkCli();
checkCreateNeocord();
checkReactComponents();
checkTestingExports();
checkLinks();
checkNoComments();
checkOutput();

if (failures.length > 0) {
  process.stderr.write(`${failures.length} coverage check${failures.length === 1 ? "" : "s"} failed:\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.exit(1);
}
process.stdout.write(`All ${passes} coverage checks passed.\n`);
