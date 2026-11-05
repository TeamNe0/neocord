import { ChevronRightIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { NAV, normalizePath, type NavEntry, type PageDef } from "../data/nav.ts";
import { SlashMark } from "./Logo.tsx";

function PageLink({ page, compact = false }: { page: PageDef; compact?: boolean }) {
  return (
    <NavLink
      to={page.path}
      end
      viewTransition
      className={({ isActive }) =>
        cn(
          "group/channel flex items-baseline gap-2 rounded-md px-2 py-1 leading-snug no-underline transition-colors [overflow-wrap:anywhere]",
          compact ? "font-mono text-[0.78rem]" : "text-[0.93rem]",
          isActive ? "bg-accent font-bold text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <SlashMark className="vt-marker h-[0.8em] w-[0.6em] flex-none self-center text-slash" />
          ) : (
            <span
              aria-hidden="true"
              className="w-[0.6em] flex-none text-center font-mono font-bold opacity-45 transition-[opacity,transform] duration-200 group-hover/channel:translate-x-0.5 group-hover/channel:text-slash group-hover/channel:opacity-100"
            >
              /
            </span>
          )}
          <span>{page.title}</span>
        </>
      )}
    </NavLink>
  );
}

function RuleList({ page, path }: { page: NavEntry; path: string }) {
  const inside = path === page.path || path.startsWith(`${page.path}/`);
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? inside;
  const rules = page.children ?? [];

  return (
    <Collapsible open={open} onOpenChange={setChoice}>
      <CollapsibleTrigger className="js-only group/rules flex w-full items-center gap-1 rounded-md py-0.5 pr-2 pl-6 text-[0.82rem] text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRightIcon className="size-3.5 transition-transform duration-200 group-data-open/rules:rotate-90" />
        {rules.length} rules
      </CollapsibleTrigger>
      <CollapsibleContent
        forceMount
        className="grid grid-rows-[0fr] transition-[grid-template-rows,visibility] duration-300 ease-out data-closed:invisible data-open:grid-rows-[1fr]"
      >
        <ul className="ml-3.5 min-h-0 overflow-hidden border-l pl-1.5">
          {rules.map((child) => (
            <li key={child.path}>
              <PageLink page={child} compact />
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function Sidebar() {
  const path = normalizePath(useLocation().pathname);
  const nav = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = nav.current;
    const active = element?.querySelector<HTMLElement>('[aria-current="page"]');
    const scroller = element?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!active || !scroller) return;
    const link = active.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (link.top < view.top + 16) scroller.scrollTop += link.top - view.top - 16;
    else if (link.bottom > view.bottom - 16) scroller.scrollTop += link.bottom - view.bottom + 16;
  }, [path]);

  return (
    <nav ref={nav} aria-label="Documentation">
      {NAV.map((group) => (
        <section key={group.title} className="mb-5">
          <h2 className="mb-1 px-2 text-[0.82rem] font-bold text-foreground/70">{group.title}</h2>
          <ul>
            {group.pages.map((page) => (
              <li key={page.path}>
                <PageLink page={page} />
                {page.children ? <RuleList page={page} path={path} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
