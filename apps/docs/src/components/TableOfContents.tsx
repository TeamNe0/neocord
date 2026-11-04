import { useEffect, useState } from "react";
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
    <ul>
      {headings.map((heading) => (
        <li key={heading.id} data-level={heading.level}>
          <a href={`#${heading.id}`} aria-current={active === heading.id ? "location" : undefined}>
            {heading.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function TableOfContents({ headings, variant }: TableOfContentsProps) {
  const active = useActiveHeading(variant === "aside" ? headings : []);
  if (headings.length === 0) return null;

  if (variant === "inline") {
    return (
      <details className="toc-inline">
        <summary>On this page</summary>
        <nav aria-label="On this page, compact">
          <Links headings={headings} active={null} />
        </nav>
      </details>
    );
  }

  return (
    <aside className="toc-aside">
      <nav aria-label="On this page">
        <p className="toc-title">On this page</p>
        <Links headings={headings} active={active} />
      </nav>
    </aside>
  );
}
