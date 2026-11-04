import type { MDXContent } from "mdx/types";
import { Link } from "react-router";
import { groupOf, neighbours, type PageDef } from "../data/nav.ts";
import type { HeadingEntry } from "../types.ts";
import { mdxComponents } from "./mdx-components.tsx";
import { TableOfContents } from "./TableOfContents.tsx";

interface DocPageProps {
  page: PageDef;
  Content: MDXContent;
  headings: readonly HeadingEntry[];
}

export function DocPage({ page, Content, headings }: DocPageProps) {
  const { previous, next } = neighbours(page.path);
  const group = groupOf(page.path);

  return (
    <div className="doc-grid">
      <main id="main" tabIndex={-1} className="doc-main">
        <article>
          <header className="doc-header">
            {group ? <p className="doc-group">{group}</p> : null}
            <h1>{page.title}</h1>
            <p className="doc-lede">{page.description}</p>
          </header>
          <TableOfContents headings={headings} variant="inline" />
          <div className="prose">
            <Content components={mdxComponents} />
          </div>
        </article>
        <nav aria-label="Previous and next pages" className="pager">
          {previous ? (
            <Link to={previous.path} rel="prev" className="pager-link">
              <span className="pager-label">Previous</span>
              <span className="pager-title">{previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link to={next.path} rel="next" className="pager-link pager-next">
              <span className="pager-label">Next</span>
              <span className="pager-title">{next.title}</span>
            </Link>
          ) : null}
        </nav>
      </main>
      <TableOfContents headings={headings} variant="aside" />
    </div>
  );
}
