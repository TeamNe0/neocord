import { useEffect, useLayoutEffect, useRef } from "react";
import { Outlet, ScrollRestoration, useLocation, useNavigate } from "react-router";
import { finishSmoothScroll, focusSection, isSamePage, prepareNavigation, trackPath } from "@/lib/navigation.ts";
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

function useNavigationMotion(pathname: string): void {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    trackPath(pathname);
  }, [pathname]);

  useLayoutEffect(() => {
    finishSmoothScroll();
  }, [location]);

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (anchor === null || anchor.target !== "" || anchor.origin !== window.location.origin) return;
      prepareNavigation(window.location.pathname, anchor.pathname);
      if (!isSamePage(window.location.pathname, anchor.pathname) || anchor.search !== window.location.search) return;
      event.preventDefault();
      void navigate(`${anchor.pathname}${anchor.search}${anchor.hash}`, { replace: anchor.href === window.location.href });
      focusSection(anchor.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [navigate]);
}

export function RootLayout() {
  const { pathname } = useLocation();
  useDocumentMeta(pathname);
  useRouteFocus(pathname);
  useNavigationMotion(pathname);
  return (
    <>
      <a
        href="#main"
        className="absolute -top-16 left-3 z-60 rounded-md bg-primary px-3.5 py-2 font-bold text-primary-foreground no-underline focus:top-2"
      >
        Skip to content
      </a>
      <Header />
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
