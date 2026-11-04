import { useEffect, useRef } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router";
import { findPage, HOME_META, normalizePath, NOT_FOUND_META } from "../data/nav.ts";
import { pageMeta } from "../site.ts";
import { Header } from "./Header.tsx";

function setMeta(selector: string, attribute: string, value: string): void {
  document.head.querySelector(selector)?.setAttribute(attribute, value);
}

function useDocumentMeta(pathname: string): void {
  useEffect(() => {
    const path = normalizePath(pathname);
    const source = path === "/" ? HOME_META : (findPage(path) ?? NOT_FOUND_META);
    const meta = pageMeta(source);
    document.title = meta.title;
    setMeta('meta[name="description"]', "content", meta.description);
    setMeta('link[rel="canonical"]', "href", meta.canonical);
    setMeta('meta[property="og:title"]', "content", meta.title);
    setMeta('meta[property="og:description"]', "content", meta.description);
    setMeta('meta[property="og:url"]', "content", meta.canonical);
    setMeta('meta[name="twitter:title"]', "content", meta.title);
    setMeta('meta[name="twitter:description"]', "content", meta.description);
  }, [pathname]);
}

function useRouteFocus(pathname: string): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pathname]);
}

export function RootLayout() {
  const { pathname } = useLocation();
  useDocumentMeta(pathname);
  useRouteFocus(pathname);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
