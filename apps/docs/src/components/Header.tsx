import { MenuIcon, SearchIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
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

const NAV_LINK =
  "rounded-md px-2.5 py-1 text-[0.95rem] font-semibold no-underline transition-colors text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:text-foreground in-data-[surface=hero]:text-white/80 in-data-[surface=hero]:hover:bg-white/15 in-data-[surface=hero]:hover:text-white in-data-[surface=hero]:aria-[current=page]:text-white";

const ON_HERO = "in-data-[surface=hero]:text-white in-data-[surface=hero]:hover:bg-white/15 in-data-[surface=hero]:hover:text-white dark:in-data-[surface=hero]:hover:bg-white/15";

export function Header() {
  const { pathname } = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoaded, setSearchLoaded] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const isApple = useIsApple();
  const inDocs = pathname.startsWith("/docs");
  const inApi = pathname.startsWith("/docs/api");
  const onHero = pathname === "/";
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const openSearch = useCallback(() => {
    setSearchLoaded(true);
    setSearchOpen(true);
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const isSlash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target);
      if (isShortcut || isSlash) {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  return (
    <header
      data-surface={onHero ? "hero" : "page"}
      className={cn(
        "vt-header sticky top-0 z-40 border-b",
        onHero ? "border-transparent bg-hero text-hero-foreground [--ring:#ffffff]" : "bg-background/85 backdrop-blur-xl",
      )}
    >
      <div className="mx-auto flex h-(--header-height) max-w-[92rem] items-center gap-2 px-4">
        {inDocs ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="js-only -ml-1.5 lg:hidden"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <MenuIcon className="size-5" />
          </Button>
        ) : null}
        <Link to="/" viewTransition className="group/logo rounded-sm text-inherit no-underline" aria-label="neocord home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="ml-3 hidden gap-0.5 sm:flex">
          <Link to="/docs" viewTransition className={NAV_LINK} aria-current={inDocs && !inApi ? "page" : undefined}>
            Docs
          </Link>
          <Link to="/docs/api/neocord" viewTransition className={NAV_LINK} aria-current={inApi ? "page" : undefined}>
            API
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            className={cn(
              "js-only h-9 gap-2 px-2.5 font-normal text-muted-foreground",
              "in-data-[surface=hero]:border-white/30 in-data-[surface=hero]:bg-white/10 in-data-[surface=hero]:text-white in-data-[surface=hero]:hover:bg-white/20 in-data-[surface=hero]:hover:text-white dark:in-data-[surface=hero]:border-white/30 dark:in-data-[surface=hero]:bg-white/10 dark:in-data-[surface=hero]:hover:bg-white/20",
            )}
            onClick={openSearch}
            aria-haspopup="dialog"
          >
            <SearchIcon className="size-4" />
            <span className="hidden sm:inline">Search</span>
            <Kbd className="in-data-[surface=hero]:bg-white/20 in-data-[surface=hero]:text-white">{isApple ? "⌘K" : "Ctrl K"}</Kbd>
          </Button>
          <ThemeToggle className={ON_HERO} />
        </div>
      </div>
      {inDocs ? (
        <span
          aria-hidden="true"
          className="reading-progress pointer-events-none absolute inset-x-0 -bottom-px h-0.5 bg-slash"
        />
      ) : null}
      {inDocs ? (
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="w-[min(21rem,88vw)] gap-0 overflow-y-auto bg-background p-3 pt-12 data-[side=left]:sm:max-w-none">
            <SheetTitle className="sr-only">Documentation navigation</SheetTitle>
            <Sidebar />
          </SheetContent>
        </Sheet>
      ) : null}
      {searchLoaded ? (
        <Suspense fallback={null}>
          <SearchDialog open={searchOpen} onClose={closeSearch} />
        </Suspense>
      ) : null}
    </header>
  );
}
