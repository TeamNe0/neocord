import type { ReactNode } from "react";

interface DiscordPreviewProps {
  command?: string;
  user?: string;
  ephemeral?: boolean;
  label?: string;
  children?: ReactNode;
}

const ACCENTS = {
  blurple: "#5865f2",
  green: "#57f287",
  yellow: "#fee75c",
  fuchsia: "#eb459e",
  red: "#ed4245",
} as const;

export function DiscordPreview({ command, user = "you", ephemeral = false, label = "Discord preview", children }: DiscordPreviewProps) {
  return (
    <figure className="dc" aria-label={label}>
      {command ? (
        <p className="dc-reply">
          <span className="dc-reply-line" aria-hidden="true" />
          <strong>{user}</strong> used <span className="dc-command">{command}</span>
        </p>
      ) : null}
      <div className="dc-message">
        <span className="dc-avatar" aria-hidden="true">
          /
        </span>
        <div className="dc-body">
          <p className="dc-author">
            <strong>my-bot</strong>
            <span className="dc-badge">APP</span>
            <time className="dc-time">Today at 12:00</time>
          </p>
          <div className="dc-content">{children}</div>
          {ephemeral ? <p className="dc-ephemeral">Only you can see this message</p> : null}
        </div>
      </div>
    </figure>
  );
}

export function DiscordContainer({ accent, children }: { accent?: keyof typeof ACCENTS; children?: ReactNode }) {
  return (
    <div className="dc-container" style={accent ? { borderLeftColor: ACCENTS[accent] } : undefined}>
      {children}
    </div>
  );
}

export function DiscordText({ children }: { children?: ReactNode }) {
  return <p className="dc-text">{children}</p>;
}

export function DiscordHeading({ level = 1, children }: { level?: 1 | 2 | 3; children?: ReactNode }) {
  return (
    <p className="dc-heading" data-level={level}>
      {children}
    </p>
  );
}

export function DiscordSubtext({ children }: { children?: ReactNode }) {
  return <p className="dc-subtext">{children}</p>;
}

export function DiscordSeparator() {
  return <hr className="dc-separator" />;
}

export function DiscordSection({ accessory, children }: { accessory?: ReactNode; children?: ReactNode }) {
  return (
    <div className="dc-section">
      <div className="dc-section-body">{children}</div>
      {accessory}
    </div>
  );
}

export function DiscordThumbnail({ label = "?" }: { label?: string }) {
  return (
    <span className="dc-thumbnail" aria-hidden="true">
      {label}
    </span>
  );
}

export function DiscordRow({ children }: { children?: ReactNode }) {
  return <div className="dc-row">{children}</div>;
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
    <span className="dc-button" data-variant={variant} data-disabled={disabled ? "true" : undefined}>
      {children}
    </span>
  );
}

export function DiscordSelect({ placeholder }: { placeholder: string }) {
  return (
    <span className="dc-select">
      <span>{placeholder}</span>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function DiscordModal({ title, submit = "Submit", children }: { title: string; submit?: string; children?: ReactNode }) {
  return (
    <figure className="dc dc-modal" aria-label={`Discord modal preview: ${title}`}>
      <p className="dc-modal-title">{title}</p>
      <div className="dc-modal-body">{children}</div>
      <div className="dc-modal-actions">
        <span className="dc-button" data-variant="link">
          Cancel
        </span>
        <span className="dc-button" data-variant="primary">
          {submit}
        </span>
      </div>
    </figure>
  );
}

export function DiscordField({ label, description, value }: { label: string; description?: string; value?: string }) {
  return (
    <div className="dc-field">
      <p className="dc-field-label">{label}</p>
      {description ? <p className="dc-field-description">{description}</p> : null}
      <p className="dc-field-input">{value ?? " "}</p>
    </div>
  );
}
