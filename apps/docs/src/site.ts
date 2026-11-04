const configured: string | undefined = import.meta.env.VITE_SITE_URL;

export const SITE_URL = (configured && configured.trim() !== "" ? configured.trim() : "https://neocord.dev").replace(/\/+$/, "");
export const SITE_NAME = "neocord";
export const SITE_DESCRIPTION =
  "A file-routed framework for Discord bots, built on discord.js and React. Write commands as files and return JSX from handlers.";
export const OG_IMAGE = "/og.png";

export interface PageMeta {
  title: string;
  description: string;
  path: string;
}

export function pageMeta(meta: PageMeta) {
  const isHome = meta.path === "/";
  return {
    title: isHome ? meta.title : `${meta.title} | ${SITE_NAME}`,
    description: meta.description,
    canonical: `${SITE_URL}${meta.path}`,
    image: `${SITE_URL}${OG_IMAGE}`,
  };
}
