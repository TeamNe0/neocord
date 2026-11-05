import type { MDXComponents } from "mdx/types";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock.tsx";
import {
  DiscordButton,
  DiscordContainer,
  DiscordField,
  DiscordFile,
  DiscordHeading,
  DiscordLiveCounter,
  DiscordMedia,
  DiscordModal,
  DiscordPreview,
  DiscordQuote,
  DiscordRow,
  DiscordSection,
  DiscordSelect,
  DiscordSeparator,
  DiscordSubtext,
  DiscordText,
  DiscordThinking,
  DiscordThumbnail,
} from "./discord/DiscordPreview.tsx";
import { PmTabs } from "./PmTabs.tsx";

function Anchor({ href, children, ...props }: ComponentProps<"a">) {
  if (href?.startsWith("/")) {
    return (
      <Link to={href} viewTransition {...props}>
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

function MdxTable(props: ComponentProps<"table">) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table {...props} className="text-[0.92rem] leading-normal" />
    </div>
  );
}

function MdxHead({ className, ...props }: ComponentProps<"th">) {
  return <TableHead {...props} className={cn("h-auto bg-muted/70 px-3 py-2 font-bold", className)} />;
}

function MdxCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <TableCell
      {...props}
      className={cn(
        "px-3 py-2 align-top whitespace-normal [&_code]:whitespace-nowrap last:[&_code]:whitespace-normal last:[&_code]:[overflow-wrap:anywhere]",
        className,
      )}
    />
  );
}

const CALLOUTS = {
  note: { label: "Note", tone: "text-note", surface: "border-note/35 bg-note/8" },
  warn: { label: "Warning", tone: "text-warn", surface: "border-warn/40 bg-warn/8" },
  danger: { label: "Danger", tone: "text-destructive", surface: "border-destructive/40 bg-destructive/8" },
} as const;

export function Callout({ kind = "note", children }: { kind?: keyof typeof CALLOUTS; children?: ReactNode }) {
  const callout = CALLOUTS[kind];
  return (
    <aside
      data-kind={kind}
      className={cn(
        "rounded-xl border px-4 py-3 text-[0.97rem] [&>*+*]:mt-[0.55em] [&>.callout-label+*]:mt-0",
        callout.surface,
      )}
    >
      <p className={cn("callout-label mb-0.5 flex items-center gap-1.5 text-[0.88rem] font-bold", callout.tone)}>
        <span aria-hidden="true" className="font-mono">
          /
        </span>
        {callout.label}
      </p>
      {children}
    </aside>
  );
}

export const mdxComponents: MDXComponents = {
  a: Anchor,
  h2: H2,
  h3: H3,
  pre: CodeBlock,
  table: MdxTable,
  thead: TableHeader,
  tbody: TableBody,
  tr: TableRow,
  th: MdxHead,
  td: MdxCell,
  Callout,
  DiscordButton,
  DiscordContainer,
  DiscordField,
  DiscordFile,
  DiscordHeading,
  DiscordLiveCounter,
  DiscordMedia,
  DiscordModal,
  DiscordPreview,
  DiscordQuote,
  DiscordRow,
  DiscordSection,
  DiscordSelect,
  DiscordSeparator,
  DiscordSubtext,
  DiscordText,
  DiscordThinking,
  DiscordThumbnail,
  PmTabs,
};
