import { useEffect, useRef, useState, type ComponentProps } from "react";

type PreProps = ComponentProps<"pre"> & { "data-title"?: string; "data-pm"?: string; "data-lang"?: string };

export function CodeBlock({ "data-title": title, "data-pm": _pm, "data-lang": language, children, ...props }: PreProps) {
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <figure className="code-block" data-lang={language}>
      {title ? <figcaption className="code-title">{title}</figcaption> : null}
      <button
        type="button"
        className="code-copy"
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
        {copied ? "Copied" : "Copy"}
      </button>
      <pre ref={pre} {...props}>
        {children}
      </pre>
    </figure>
  );
}
