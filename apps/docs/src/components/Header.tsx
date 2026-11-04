import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Logo } from "./Logo.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

const SearchDialog = lazy(() => import("./SearchDialog.tsx"));

function subscribeNever(): () => void {
  return () => undefined;
}

function useIsApple(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => /mac|iphone|ipad/i.test(navigator.platform),
    () => false,
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="nav-drawer"
      aria-label="Documentation navigation"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      {open ? (
        <div className="nav-drawer-body">
          <button type="button" className="icon-button nav-drawer-close" onClick={onClose} aria-label="Close navigation">
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <Sidebar />
        </div>
      ) : null}
    </dialog>
  );
}

export function Header() {
  const { pathname } = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const isApple = useIsApple();
  const inDocs = pathname.startsWith("/docs");
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const closeNav = useCallback(() => setNavOpen(false), []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const isSlash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target);
      if (isShortcut || isSlash) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        {inDocs ? (
          <button
            type="button"
            className="icon-button nav-toggle"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
        <Link to="/" className="site-logo" aria-label="neocord home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="site-nav">
          <NavLink to="/docs" className="site-nav-link">
            Docs
          </NavLink>
          <NavLink to="/docs/api/neocord" className="site-nav-link">
            API
          </NavLink>
        </nav>
        <div className="site-header-actions">
          <button type="button" className="search-button" onClick={() => setSearchOpen(true)} aria-haspopup="dialog">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M13.2 13.2L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="search-button-label">Search</span>
            <kbd>{isApple ? "⌘K" : "Ctrl K"}</kbd>
          </button>
          <ThemeToggle />
        </div>
      </div>
      {inDocs ? <MobileNav open={navOpen} onClose={closeNav} /> : null}
      {searchOpen ? (
        <Suspense fallback={null}>
          <SearchDialog onClose={closeSearch} />
        </Suspense>
      ) : null}
    </header>
  );
}
