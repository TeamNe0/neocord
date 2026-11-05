import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.NODE_ENV = "production";

interface ManifestEntry {
  file: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  assets?: string[];
}

type ViteManifest = Record<string, ManifestEntry>;

interface PageDef {
  path: string;
  title: string;
  description: string;
  file: string;
}

interface SearchEntry {
  url: string;
  page: string;
  group: string;
  heading: string;
  text: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");

const server = (await import(pathToFileURL(join(root, ".ssr/entry-server.js")).href)) as {
  ALL_PAGES: PageDef[];
  HOME_META: { path: string; title: string; description: string };
  NOT_FOUND_META: { path: string; title: string; description: string };
  OG_IMAGE_ALT: string;
  SITE_DESCRIPTION: string;
  SITE_LANGUAGE: string;
  SITE_LOCALE: string;
  SITE_NAME: string;
  SITE_URL: string;
  THEME_COLORS: { light: string; dark: string };
  urlFor(path: string): string;
  groupOf(path: string): string | undefined;
  pageMeta(meta: { path: string; title: string; description: string }): {
    title: string;
    description: string;
    canonical: string;
    image: string;
  };
  renderPath(pathname: string): Promise<string>;
};

const template = readFileSync(join(dist, "index.html"), "utf8");
const manifestPath = join(dist, ".vite/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ViteManifest;

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function collectImports(key: string, seen: Set<string>): void {
  const entry = manifest[key];
  if (entry === undefined || seen.has(key)) return;
  seen.add(key);
  for (const dependency of entry.imports ?? []) collectImports(dependency, seen);
}

function preloadsFor(source: string | null): string[] {
  const seen = new Set<string>();
  const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry === true);
  if (entryKey !== undefined) collectImports(entryKey, seen);
  if (source !== null) collectImports(source, seen);
  return [...seen]
    .filter((key) => key !== entryKey)
    .map((key) => manifest[key]?.file)
    .filter((file): file is string => file !== undefined)
    .map((file) => `<link rel="modulepreload" href="/${file}" />`);
}

const fontPreloads = Object.values(manifest)
  .flatMap((entry) => entry.assets ?? [])
  .filter((asset, index, all) => all.indexOf(asset) === index)
  .filter((asset) => /atkinson-hyperlegible-next-latin-wght-normal|anybody-latin-standard-normal/.test(asset))
  .map((asset) => `<link rel="preload" href="/${asset}" as="font" type="font/woff2" crossorigin />`);

const buildTime = new Date().toISOString();

function lastModified(paths: string[]): string {
  try {
    const output = execFileSync("git", ["log", "-1", "--format=%cI", "--", ...paths], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output === "" ? buildTime : output;
  } catch {
    return buildTime;
  }
}

function sourcesFor(page: PageDef): string[] {
  const sources = [`src/content/${page.file}.mdx`];
  if (page.file.startsWith("eslint/rules/")) sources.push("src/data/eslint-rules.ts", "scripts/generate-eslint-pages.ts");
  return sources;
}

function jsonLd(data: unknown): string {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
  return `<script type="application/ld+json">${json}</script>`;
}

const websiteNode = {
  "@type": "WebSite",
  "@id": `${server.urlFor("/")}#website`,
  url: server.urlFor("/"),
  name: server.SITE_NAME,
  description: server.SITE_DESCRIPTION,
  inLanguage: server.SITE_LANGUAGE,
};

function structuredData(meta: { path: string; title: string; description: string }, modified: string | null): string {
  const data = server.pageMeta(meta);
  if (meta.path === "/") {
    return jsonLd({ "@context": "https://schema.org", "@graph": [websiteNode] });
  }
  const crumbs = [
    { name: server.SITE_NAME, path: "/" },
    ...(meta.path !== "/docs" ? [{ name: "Docs", path: "/docs" }] : []),
    { name: meta.title, path: meta.path },
  ];
  return jsonLd({
    "@context": "https://schema.org",
    "@graph": [
      websiteNode,
      {
        "@type": "TechArticle",
        "@id": `${data.canonical}#article`,
        url: data.canonical,
        headline: meta.title,
        description: meta.description,
        image: data.image,
        inLanguage: server.SITE_LANGUAGE,
        isPartOf: { "@id": websiteNode["@id"] },
        ...(modified !== null ? { dateModified: modified } : {}),
        ...(server.groupOf(meta.path) !== undefined ? { articleSection: server.groupOf(meta.path) } : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((crumb, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: crumb.name,
          item: server.urlFor(crumb.path),
        })),
      },
    ],
  });
}

function headFor(
  meta: { path: string; title: string; description: string },
  source: string | null,
  noindex: boolean,
  modified: string | null,
): string {
  const data = server.pageMeta(meta);
  const isArticle = meta.path !== "/" && !noindex;
  const imageAlt = escapeHtml(server.OG_IMAGE_ALT);
  const tags = [
    `<title>${escapeHtml(data.title)}</title>`,
    `<meta name="description" content="${escapeHtml(data.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(data.canonical)}" />`,
    `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${server.THEME_COLORS.light}" />`,
    `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${server.THEME_COLORS.dark}" />`,
    `<link rel="manifest" href="/site.webmanifest" />`,
    `<meta property="og:type" content="${isArticle ? "article" : "website"}" />`,
    `<meta property="og:site_name" content="${server.SITE_NAME}" />`,
    `<meta property="og:locale" content="${server.SITE_LOCALE}" />`,
    `<meta property="og:title" content="${escapeHtml(data.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(data.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(data.canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(data.image)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${imageAlt}" />`,
    ...(isArticle && modified !== null ? [`<meta property="article:modified_time" content="${modified}" />`] : []),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(data.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(data.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(data.image)}" />`,
    `<meta name="twitter:image:alt" content="${imageAlt}" />`,
    ...(noindex ? [`<meta name="robots" content="noindex" />`] : [structuredData(meta, modified)]),
    ...fontPreloads,
    ...preloadsFor(source),
  ];
  return tags.join("\n    ");
}

function documentFor(html: string, head: string): string {
  return template.replace("<!--app-head-->", () => head).replace("<!--app-html-->", () => html);
}

function writeRoute(path: string, content: string): void {
  const directory = path === "/" ? dist : join(dist, path);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "index.html"), content);
}

function decodeEntities(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function plainText(html: string): string {
  const withoutCode = html
    .replace(/<figure class="code-block[^"]*"[\s\S]*?<\/figure>/g, " ")
    .replace(/<div class="pm-tabs[^"]*"[\s\S]*?<\/div><\/div><\/div>/g, " ");
  return decodeEntities(withoutCode.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function searchEntries(page: PageDef, html: string): SearchEntry[] {
  const start = html.indexOf('<div class="prose">');
  const end = html.indexOf('<nav aria-label="Previous and next pages"');
  const body = start === -1 ? "" : html.slice(start, end === -1 ? undefined : end);
  const group = server.groupOf(page.path) ?? "";
  const parts = body.split(/(?=<h[23] id=")/);
  const entries: SearchEntry[] = [];
  for (const part of parts) {
    const match = /^<h[23] id="([^"]+)">([\s\S]*?)<\/h[23]>/.exec(part);
    const heading = match?.[2] ? plainText(match[2]) : "";
    const rest = match ? part.slice(match[0].length) : part;
    entries.push({
      url: match ? `${page.path}#${match[1]}` : page.path,
      page: page.title,
      group,
      heading,
      text: plainText(rest).slice(0, 700) || (match ? "" : page.description),
    });
  }
  return entries;
}

const urls: { path: string; modified: string }[] = [];
const searchIndex: SearchEntry[] = [];

const homeModified = lastModified(["src/components/landing", "src/data/nav.ts"]);
const landingKey = Object.keys(manifest).find((key) => key.endsWith("components/landing/Landing.tsx")) ?? null;
writeRoute("/", documentFor(await server.renderPath("/"), headFor(server.HOME_META, landingKey, false, homeModified)));
urls.push({ path: server.HOME_META.path, modified: homeModified });

for (const page of server.ALL_PAGES) {
  const html = await server.renderPath(page.path);
  const sourceKey = `src/content/${page.file}.mdx`;
  const modified = lastModified(sourcesFor(page));
  writeRoute(page.path, documentFor(html, headFor(page, manifest[sourceKey] ? sourceKey : null, false, modified)));
  urls.push({ path: page.path, modified });
  searchIndex.push(...searchEntries(page, html));
}

const notFoundHtml = await server.renderPath("/404");
const notFoundDocument = documentFor(notFoundHtml, headFor(server.NOT_FOUND_META, null, true, null));
writeFileSync(join(dist, "404.html"), notFoundDocument);

writeFileSync(join(dist, "search-index.json"), JSON.stringify(searchIndex));

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(
    ({ path, modified }) =>
      `  <url><loc>${escapeHtml(server.urlFor(path))}</loc><lastmod>${modified}</lastmod></url>`,
  ),
  "</urlset>",
  "",
].join("\n");
writeFileSync(join(dist, "sitemap.xml"), sitemap);
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${server.SITE_URL}/sitemap.xml\n`);

const manifestFile = {
  name: server.SITE_NAME,
  short_name: server.SITE_NAME,
  description: server.SITE_DESCRIPTION,
  lang: server.SITE_LANGUAGE,
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: server.THEME_COLORS.dark,
  theme_color: server.THEME_COLORS.dark,
  icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
};
writeFileSync(join(dist, "site.webmanifest"), `${JSON.stringify(manifestFile, null, 2)}\n`);

rmSync(join(dist, ".vite"), { recursive: true, force: true });

process.stdout.write(`Prerendered ${urls.length + 1} documents and ${searchIndex.length} search entries.\n`);
