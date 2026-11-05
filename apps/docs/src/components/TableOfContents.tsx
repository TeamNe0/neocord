import { ChevronRightIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { HeadingEntry } from "../types.ts";

function useActiveHeading(headings: readonly HeadingEntry[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const elements = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) {
      setActive(null);
      return;
    }

    const update = (): void => {
      const line = 110;
      let current = elements[0]?.id ?? null;
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= line) current = element.id;
        else break;
      }
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      setActive(atEnd ? (elements.at(-1)?.id ?? current) : current);
    };

    const observer = new IntersectionObserver(update, { rootMargin: "-100px 0px -60% 0px", threshold: [0, 1] });
    for (const element of elements) observer.observe(element);
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update);
    };
  }, [headings]);

  return active;
}

interface TableOfContentsProps {
  headings: readonly HeadingEntry[];
  variant: "aside" | "inline";
}

function Links({ headings, active }: { headings: readonly HeadingEntry[]; active: string | null }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {headings.map((heading) => (
        <li key={heading.id} data-level={heading.level} className="data-[level='3']:pl-3">
          <a
            href={`#${heading.id}`}
            aria-current={active === heading.id ? "location" : undefined}
            className="block py-0.5 leading-snug text-muted-foreground no-underline transition-colors duration-200 hover:text-foreground aria-[current=location]:font-bold aria-[current=location]:text-foreground"
          >
            {heading.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Aside({ headings }: { headings: readonly HeadingEntry[] }) {
  const active = useActiveHeading(headings);
  const rail = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = rail.current;
    if (element === null) return;
    const link = element.querySelector<HTMLElement>('[aria-current="location"]');
    if (link === null) return;
    const top = link.getBoundingClientRect().top - element.getBoundingClientRect().top;
    element.style.setProperty("--toc-y", `${top}px`);
    element.style.setProperty("--toc-h", `${link.offsetHeight}px`);
  }, [active]);

  return (
    <aside className="sticky top-[calc(var(--header-height)+2.5rem)] hidden max-h-[calc(100dvh-var(--header-height)-4rem)] self-start overflow-y-auto text-[0.86rem] xl:block">
      <nav aria-label="On this page">
        <p className="mb-2 font-bold">On this page</p>
        <div ref={rail} className="relative border-l pl-3 [--toc-h:0px] [--toc-y:0px]">
          <span
            aria-hidden="true"
            className="absolute -left-px top-0 h-(--toc-h) w-0.5 translate-y-(--toc-y) bg-slash transition-[translate,height] duration-300 ease-out"
          />
          <Links headings={headings} active={active} />
        </div>
      </nav>
    </aside>
  );
}

export function TableOfContents({ headings, variant }: TableOfContentsProps) {
  if (headings.length === 0) return null;
  if (variant === "aside") return <Aside headings={headings} />;

  return (
    <Collapsible className="mb-6 rounded-lg border bg-card text-[0.92rem] xl:hidden">
      <CollapsibleTrigger className="js-only group/toc flex w-full items-center gap-1.5 px-3 py-2 font-bold">
        <ChevronRightIcon className="size-4 transition-transform duration-200 group-data-open/toc:rotate-90" />
        On this page
      </CollapsibleTrigger>
      <CollapsibleContent
        forceMount
        className="grid grid-rows-[0fr] transition-[grid-template-rows,visibility] duration-300 ease-out data-closed:invisible data-open:grid-rows-[1fr]"
      >
        <nav aria-label="On this page, compact" className="min-h-0 overflow-hidden">
          <div className="px-3 pb-3">
            <Links headings={headings} active={null} />
          </div>
        </nav>
      </CollapsibleContent>
    </Collapsible>
  );
}
