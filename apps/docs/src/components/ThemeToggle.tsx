import { MoonIcon, SunIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

function subscribe(listener: () => void): () => void {
  window.addEventListener("neocord-theme", listener);
  return () => window.removeEventListener("neocord-theme", listener);
}

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(next: Theme): void {
  const root = document.documentElement;
  const commit = (): void => {
    root.dataset.theme = next;
    flushSync(() => window.dispatchEvent(new Event("neocord-theme")));
  };
  localStorage.setItem("neocord-theme", next);

  if (!("startViewTransition" in document)) {
    commit();
    return;
  }
  root.dataset.vt = "theme";
  root.dataset.vtDir = next === "dark" ? "forward" : "back";
  const transition = document.startViewTransition(commit);
  void transition.finished.finally(() => {
    delete root.dataset.vt;
  });
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore<Theme>(subscribe, readTheme, () => "light");
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      className={cn("js-only", className)}
      aria-label={`Switch to ${next} theme`}
      onClick={() => applyTheme(next)}
    >
      <MoonIcon className="size-[1.1rem] dark:hidden" />
      <SunIcon className="hidden size-[1.1rem] dark:block" />
    </Button>
  );
}
