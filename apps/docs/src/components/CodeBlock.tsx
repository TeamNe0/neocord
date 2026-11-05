import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PreProps = ComponentProps<"pre"> & { "data-title"?: string; "data-pm"?: string; "data-lang"?: string };

export function CodeBlock({ "data-title": title, "data-pm": _pm, "data-lang": language, className, children, ...props }: PreProps) {
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <figure
      className="code-block group/code relative overflow-hidden rounded-xl border bg-code in-data-[slot=code-pane]:rounded-none in-data-[slot=code-pane]:border-0 in-data-[slot=code-pane]:bg-transparent in-[.pm-tabs]:rounded-none in-[.pm-tabs]:border-0 in-[.pm-tabs]:bg-transparent"
      data-lang={language}
    >
      {title ? (
        <figcaption className="border-b bg-muted/50 py-1.5 pr-20 pl-3.5 font-mono text-[0.8rem] text-muted-foreground [overflow-wrap:anywhere]">
          {title}
        </figcaption>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="js-only absolute top-1.5 right-1.5 z-1 opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100 data-[copied=true]:opacity-100 [@media(hover:none)]:opacity-100"
        data-copied={copied}
        aria-label={copied ? "Copied to clipboard" : "Copy code"}
        onClick={async () => {
          const text = pre.current?.textContent ?? "";
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <CheckIcon className="copied-pop text-slash" /> : <CopyIcon />}
        {copied ? "Copied" : "Copy"}
      </Button>
      <pre
        ref={pre}
        {...props}
        className={cn("m-0 overflow-x-auto px-4 py-3.5 text-[0.86rem] leading-relaxed [&>code]:block [&>code]:w-fit [&>code]:min-w-full", className)}
      >
        {children}
      </pre>
    </figure>
  );
}
