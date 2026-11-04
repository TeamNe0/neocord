import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function subscribe(listener: () => void): () => void {
  window.addEventListener("neocord-theme", listener);
  return () => window.removeEventListener("neocord-theme", listener);
}

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme>(subscribe, readTheme, () => "light");
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        window.dispatchEvent(new Event("neocord-theme"));
        localStorage.setItem("neocord-theme", next);
      }}
    >
      <svg className="theme-icon-moon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <path d="M16.5 12.2A7 7 0 017.8 3.5a7 7 0 108.7 8.7z" fill="currentColor" />
      </svg>
      <svg className="theme-icon-sun" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <circle cx="10" cy="10" r="3.6" fill="currentColor" />
        <path
          d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M15.8 4.2l-1.7 1.7M5.9 14.1l-1.7 1.7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
