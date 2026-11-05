import { FileTextIcon } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DiscordPreviewProps {
  command?: string;
  user?: string;
  ephemeral?: boolean;
  label?: string;
  className?: string;
  children?: ReactNode;
}

const ACCENTS = {
  blurple: "#5865f2",
  green: "#57f287",
  yellow: "#fee75c",
  fuchsia: "#eb459e",
  red: "#ed4245",
} as const;

export function DiscordPreview({ command, user = "you", ephemeral = false, label = "Discord preview", className, children }: DiscordPreviewProps) {
  return (
    <figure
      className={cn("message-pop max-w-[34rem] rounded-xl bg-dc px-3.5 pt-3 pb-3.5 text-[0.94rem] leading-[1.375] text-dc-text", className)}
      aria-label={label}
    >
      {command ? (
        <p className="relative mb-1 flex flex-wrap items-baseline gap-1 pl-[3.05rem] text-[0.82rem] text-dc-muted">
          <span aria-hidden="true" className="absolute top-2 left-5 h-2.5 w-6 rounded-tl-md border-t-2 border-l-2 border-[#4e5058]" />
          <strong className="font-semibold text-dc-text">{user}</strong> used <span className="text-dc-link">{command}</span>
        </p>
      ) : null}
      <div className="flex gap-3">
        <span aria-hidden="true" className="flex size-[2.4rem] flex-none items-center justify-center rounded-full bg-[#1a1c2e] font-mono text-xl font-extrabold text-[#eb459e]">
          /
        </span>
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 flex flex-wrap items-center gap-1.5">
            <strong className="font-semibold text-dc-bright">my-bot</strong>
            <span className="rounded-[3px] bg-dc-blurple px-1 text-[0.64rem] leading-[1.35] font-bold text-white">APP</span>
            <time className="text-[0.74rem] text-dc-muted">Today at 12:00</time>
          </p>
          <div className="flex flex-col gap-2">{children}</div>
          {ephemeral ? <p className="mt-1.5 text-[0.74rem] text-dc-muted">Only you can see this message</p> : null}
        </div>
      </div>
    </figure>
  );
}

export function DiscordContainer({ accent, children }: { accent?: keyof typeof ACCENTS; children?: ReactNode }) {
  return (
    <div
      className="flex max-w-md flex-col gap-2 rounded-lg border border-l-4 border-dc-line bg-dc-container px-3.5 py-3"
      style={accent ? { borderLeftColor: ACCENTS[accent] } : undefined}
    >
      {children}
    </div>
  );
}

export function DiscordText({ children }: { children?: ReactNode }) {
  return <p className="[overflow-wrap:anywhere] [&_code]:rounded-[3px] [&_code]:bg-dc-input [&_code]:px-1 [&_code]:text-[0.85em] [&_strong]:font-bold">{children}</p>;
}

export function DiscordHeading({ level = 1, children }: { level?: 1 | 2 | 3; children?: ReactNode }) {
  return (
    <p
      data-level={level}
      className="text-[1.32rem] leading-tight font-bold text-dc-bright data-[level='2']:text-[1.15rem] data-[level='3']:text-base"
    >
      {children}
    </p>
  );
}

export function DiscordSubtext({ children }: { children?: ReactNode }) {
  return <p className="text-[0.8rem] text-dc-muted">{children}</p>;
}

export function DiscordSeparator() {
  return <hr className="border-0 border-t border-dc-line" />;
}

export function DiscordSection({ accessory, children }: { accessory?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
      {accessory}
    </div>
  );
}

export function DiscordThumbnail({ label = "?" }: { label?: string }) {
  return (
    <span aria-hidden="true" className="flex size-[3.6rem] flex-none items-center justify-center rounded-md bg-[#5a5f8e] text-[1.4rem] font-bold text-white">
      {label}
    </span>
  );
}

export function DiscordRow({ children }: { children?: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

export function DiscordThinking() {
  return (
    <p className="flex items-center gap-1.5 text-dc-muted">
      my-bot is thinking
      <span aria-hidden="true" className="inline-flex gap-0.5">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="thinking-dot size-1 rounded-full bg-current" style={{ "--dot": dot } as CSSProperties} />
        ))}
      </span>
    </p>
  );
}

export function DiscordQuote({ children }: { children?: ReactNode }) {
  return <blockquote className="border-l-4 border-[#4e5058] pl-3">{children}</blockquote>;
}

const CHART_BARS = [38, 62, 45, 80, 56, 92, 70, 100, 64, 84];

export function DiscordMedia({ description, className }: { description: string; className?: string }) {
  return (
    <div role="img" aria-label={description} className={cn("flex h-32 items-end gap-1.5 rounded-lg bg-dc-input px-4 pt-4", className)}>
      {CHART_BARS.map((height, index) => (
        <span key={index} className="flex-1 rounded-t-sm bg-[#5865f2] even:bg-[#eb459e]" style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

export function DiscordFile({ name, size }: { name: string; size: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-dc-line bg-dc px-3 py-2.5">
      <FileTextIcon aria-hidden="true" className="size-7 flex-none text-dc-link" />
      <div className="min-w-0">
        <p className="truncate text-[0.9rem] text-dc-link">{name}</p>
        <p className="text-[0.74rem] text-dc-muted">{size}</p>
      </div>
    </div>
  );
}

const BUTTON_STYLES =
  "inline-flex min-h-8 items-center justify-center rounded-md bg-[#4e5058] px-3.5 py-0.5 text-[0.88rem] leading-tight font-semibold text-white data-[disabled=true]:opacity-55 data-[variant=danger]:bg-[#c9383c] data-[variant=link]:bg-transparent data-[variant=link]:text-dc-text data-[variant=primary]:bg-dc-blurple data-[variant=success]:bg-[#1f7a43]";

export function DiscordLiveCounter({ className }: { className?: string }) {
  const [count, setCount] = useState(0);
  const interactive = "transition-[filter,scale] hover:brightness-110 active:scale-95";

  return (
    <DiscordPreview command="/counter" label="A working counter, like the one in Discord" {...(className ? { className } : {})}>
      <p aria-live="polite">Count: {count}</p>
      <DiscordRow>
        <button type="button" data-variant="primary" className={cn(BUTTON_STYLES, interactive)} onClick={() => setCount(count + 1)}>
          Add
        </button>
        <button type="button" className={cn(BUTTON_STYLES, interactive)} onClick={() => setCount(0)}>
          Reset
        </button>
      </DiscordRow>
    </DiscordPreview>
  );
}

export function DiscordButton({
  variant = "secondary",
  disabled = false,
  children,
}: {
  variant?: "primary" | "secondary" | "success" | "danger" | "link";
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <span data-variant={variant} data-disabled={disabled ? "true" : undefined} className={BUTTON_STYLES}>
      {children}
    </span>
  );
}

export function DiscordSelect({ placeholder }: { placeholder: string }) {
  return (
    <span className="flex w-full max-w-[22rem] items-center justify-between gap-2 rounded-md border border-dc-input bg-dc-input px-2.5 py-1.5 text-[0.88rem] text-dc-muted">
      <span>{placeholder}</span>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function DiscordModal({ title, submit = "Submit", children }: { title: string; submit?: string; children?: ReactNode }) {
  return (
    <figure
      className="flex max-w-[26rem] flex-col gap-3 rounded-xl bg-dc p-4 text-[0.94rem] leading-[1.375] text-dc-text"
      aria-label={`Discord modal preview: ${title}`}
    >
      <p className="text-[1.15rem] font-bold text-dc-bright">{title}</p>
      <div className="flex flex-col gap-3">{children}</div>
      <div className="flex justify-end gap-1.5">
        <DiscordButton variant="link">Cancel</DiscordButton>
        <DiscordButton variant="primary">{submit}</DiscordButton>
      </div>
    </figure>
  );
}

export function DiscordField({ label, description, value }: { label: string; description?: string; value?: string }) {
  return (
    <div>
      <p className="text-[0.85rem] font-semibold text-dc-bright">{label}</p>
      {description ? <p className="text-[0.78rem] text-dc-muted">{description}</p> : null}
      <p className="mt-1 min-h-[2.1rem] rounded-[5px] bg-dc-input px-2.5 py-1.5 text-[0.88rem] text-dc-text">{value ?? " "}</p>
    </div>
  );
}
