import { ALL_PAGES, normalizePath } from "../data/nav.ts";

const ORDER = new Map(ALL_PAGES.map((page, index) => [page.path, index]));

function directionOf(source: number | undefined, target: number | undefined): "forward" | "back" {
  if (source !== undefined && target !== undefined) return target < source ? "back" : "forward";
  return source !== undefined ? "back" : "forward";
}

export function isSamePage(from: string, to: string): boolean {
  return normalizePath(from) === normalizePath(to);
}

export function prepareNavigation(from: string, to: string): void {
  const root = document.documentElement;
  delete root.dataset.vtTitle;

  if (isSamePage(from, to)) {
    root.dataset.vt = "none";
    root.dataset.smoothScroll = "";
    return;
  }

  const source = ORDER.get(normalizePath(from));
  const target = ORDER.get(normalizePath(to));
  root.dataset.vt = source !== undefined && target !== undefined ? "slide" : "wipe";
  root.dataset.vtDir = directionOf(source, target);

  const title = document.querySelector<HTMLElement>("[data-doc-title]");
  if (title !== null && title.getBoundingClientRect().bottom < 56) title.style.viewTransitionName = "none";
}

let currentPath = "/";

export function trackPath(pathname: string): void {
  currentPath = pathname;
}

export function installHistoryMotion(): void {
  currentPath = window.location.pathname;
  window.addEventListener("popstate", () => {
    prepareNavigation(currentPath, window.location.pathname);
    currentPath = window.location.pathname;
  });
}

export function finishSmoothScroll(): void {
  delete document.documentElement.dataset.smoothScroll;
}

export function focusSection(hash: string): void {
  if (hash === "") return;
  const section = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (section === null) return;
  if (!section.hasAttribute("tabindex")) section.setAttribute("tabindex", "-1");
  section.focus({ preventScroll: true });
}

export function morphTitleFrom(element: HTMLElement | null): void {
  if (element === null) return;
  const title = document.querySelector<HTMLElement>("[data-doc-title]");
  if (title !== null) {
    title.style.viewTransitionName = "none";
    const root = document.documentElement;
    const scale = Number.parseFloat(getComputedStyle(title).fontSize) / Number.parseFloat(getComputedStyle(element).fontSize);
    root.style.setProperty("--vt-title-scale", String(scale));
    root.dataset.vtTitle = "grow";
  }
  element.style.viewTransitionName = "doc-title";
}
