import type { MDXComponents } from "mdx/types";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";
import { CodeBlock } from "./CodeBlock.tsx";
import {
  DiscordButton,
  DiscordContainer,
  DiscordField,
  DiscordHeading,
  DiscordModal,
  DiscordPreview,
  DiscordRow,
  DiscordSection,
  DiscordSelect,
  DiscordSeparator,
  DiscordSubtext,
  DiscordText,
  DiscordThumbnail,
} from "./discord/DiscordPreview.tsx";
import { PmTabs } from "./PmTabs.tsx";

function Anchor({ href, children, ...props }: ComponentProps<"a">) {
  if (href?.startsWith("/")) {
    return (
      <Link to={href} {...props}>
        {children}
      </Link>
    );
  }
  const external = href?.startsWith("http") === true;
  return (
    <a href={href} {...props} {...(external ? { rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}

function H2({ id, children }: ComponentProps<"h2">) {
  return (
    <h2 id={id}>
      <a href={`#${id}`} className="heading-link">
        {children}
      </a>
    </h2>
  );
}

function H3({ id, children }: ComponentProps<"h3">) {
  return (
    <h3 id={id}>
      <a href={`#${id}`} className="heading-link">
        {children}
      </a>
    </h3>
  );
}

function Table(props: ComponentProps<"table">) {
  return (
    <div className="table-wrap" role="region" aria-label="Table" tabIndex={0}>
      <table {...props} />
    </div>
  );
}

const CALLOUT_LABELS = { note: "Note", warn: "Warning", danger: "Danger" } as const;

export function Callout({ kind = "note", children }: { kind?: keyof typeof CALLOUT_LABELS; children?: ReactNode }) {
  return (
    <aside className="callout" data-kind={kind}>
      <p className="callout-label">{CALLOUT_LABELS[kind]}</p>
      {children}
    </aside>
  );
}

export const mdxComponents: MDXComponents = {
  a: Anchor,
  h2: H2,
  h3: H3,
  pre: CodeBlock,
  table: Table,
  Callout,
  DiscordButton,
  DiscordContainer,
  DiscordField,
  DiscordHeading,
  DiscordModal,
  DiscordPreview,
  DiscordRow,
  DiscordSection,
  DiscordSelect,
  DiscordSeparator,
  DiscordSubtext,
  DiscordText,
  DiscordThumbnail,
  PmTabs,
};
