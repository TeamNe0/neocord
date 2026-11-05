import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import type { MDXContent } from "mdx/types";
import type { MouseEvent } from "react";
import { Link } from "react-router";
import { morphTitleFrom } from "@/lib/navigation.ts";
import { cn } from "@/lib/utils";
import { groupOf, neighbours, type PageDef } from "../data/nav.ts";
import type { HeadingEntry } from "../types.ts";
import { mdxComponents } from "./mdx-components.tsx";
import { TableOfContents } from "./TableOfContents.tsx";

interface DocPageProps {
  page: PageDef;
  Content: MDXContent;
  headings: readonly HeadingEntry[];
}

function morphOnPlainClick(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  morphTitleFrom(event.currentTarget.querySelector<HTMLElement>("[data-pager-title]"));
}

function PagerLink({ page, direction }: { page: PageDef; direction: "prev" | "next" }) {
  const next = direction === "next";
  return (
    <Link
      to={page.path}
      rel={direction}
      viewTransition
      onClick={morphOnPlainClick}
      className={cn(
        "sweep group/pager flex flex-col rounded-xl border bg-card px-4 py-3 text-card-foreground no-underline transition-colors [--sweep:var(--slash)] hover:border-slash/60",
        next && "col-start-2 items-end text-right",
      )}
    >
      <span className="flex items-center gap-1.5 text-[0.82rem] text-muted-foreground">
        {next ? null : <ArrowLeftIcon className="size-3.5 transition-transform duration-300 group-hover/pager:-translate-x-1" />}
        {next ? "Next" : "Previous"}
        {next ? <ArrowRightIcon className="size-3.5 transition-transform duration-300 group-hover/pager:translate-x-1" /> : null}
      </span>
      <span data-pager-title="" className="block w-fit font-bold [overflow-wrap:anywhere]">
        {page.title}
      </span>
    </Link>
  );
}

export function DocPage({ page, Content, headings }: DocPageProps) {
  const { previous, next } = neighbours(page.path);
  const group = groupOf(page.path);

  return (
    <div className="px-4.5 pt-7 pb-16 lg:px-9 lg:pt-10 lg:pb-20 xl:grid xl:grid-cols-[minmax(0,47rem)_14.5rem] xl:justify-center xl:gap-12">
      <main id="main" tabIndex={-1} className="mx-auto max-w-[47rem] min-w-0 xl:mx-0">
        <article>
          <header className="relative mb-8">
            {group ? (
              <p className="mb-2 flex items-center gap-1.5 text-[0.88rem] font-semibold text-muted-foreground">
                {group}
                <span aria-hidden="true" className="font-mono font-bold text-slash">
                  /
                </span>
              </p>
            ) : null}
            <h1
              data-doc-title=""
              className="vt-title type-display w-fit max-w-full text-[clamp(1.9rem,4.6vw,2.75rem)] [overflow-wrap:anywhere]"
            >
              {page.title}
            </h1>
            <p className="mt-3 max-w-[42rem] text-[1.1rem] leading-normal text-muted-foreground">{page.description}</p>
          </header>
          <TableOfContents headings={headings} variant="inline" />
          <div className="prose">
            <Content components={mdxComponents} />
          </div>
        </article>
        <nav aria-label="Previous and next pages" className="mt-14 grid grid-cols-2 gap-3 border-t pt-6">
          {previous ? <PagerLink page={previous} direction="prev" /> : <span />}
          {next ? <PagerLink page={next} direction="next" /> : null}
        </nav>
      </main>
      <TableOfContents headings={headings} variant="aside" />
    </div>
  );
}
