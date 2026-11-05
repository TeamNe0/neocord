const configured: string | undefined = import.meta.env.VITE_SITE_URL;
const trailingSlash: string | undefined = import.meta.env.VITE_TRAILING_SLASH;

export const SITE_URL = (configured && configured.trim() !== "" ? configured.trim() : "https://neocord.dev").replace(/\/+$/, "");
export const TRAILING_SLASH = trailingSlash === "true" || trailingSlash === "1";
export const SITE_NAME = "neocord";
export const SITE_DESCRIPTION =
  "A file-routed framework for Discord bots, built on discord.js and React. Write commands as files and return JSX from handlers.";
export const SITE_LOCALE = "en_US";
export const SITE_LANGUAGE = "en";
export const OG_IMAGE = "/og.png";
export const OG_IMAGE_ALT = "neocord: file routes and JSX for Discord bots";
export const THEME_COLORS = { light: "#f7f6ff", dark: "#16152d" };

export interface PageMeta {
  title: string;
  description: string;
  path: string;
}

export function urlFor(path: string): string {
  if (path === "/") return `${SITE_URL}/`;
  return `${SITE_URL}${path}${TRAILING_SLASH ? "/" : ""}`;
}

export function pageMeta(meta: PageMeta) {
  const isHome = meta.path === "/";
  return {
    title: isHome ? meta.title : `${meta.title} | ${SITE_NAME}`,
    description: meta.description,
    canonical: urlFor(meta.path),
    image: `${SITE_URL}${OG_IMAGE}`,
  };
}
