import { Children, isValidElement, useId, useRef, useSyncExternalStore, type ReactNode } from "react";

const MANAGERS = ["bun", "npm", "pnpm", "yarn"] as const;
type Manager = (typeof MANAGERS)[number];

function subscribe(listener: () => void): () => void {
  window.addEventListener("neocord-pm", listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener("neocord-pm", listener);
    window.removeEventListener("storage", listener);
  };
}

function readManager(): Manager {
  const value = document.documentElement.dataset.pm;
  return MANAGERS.find((manager) => manager === value) ?? "bun";
}

function chooseManager(manager: Manager): void {
  document.documentElement.dataset.pm = manager;
  window.dispatchEvent(new Event("neocord-pm"));
  localStorage.setItem("neocord-pm", manager);
}

function managerOf(child: ReactNode): Manager | null {
  if (!isValidElement<{ "data-pm"?: string }>(child)) return null;
  const value = child.props["data-pm"];
  return MANAGERS.find((manager) => manager === value) ?? null;
}

export function PmTabs({ children }: { children?: ReactNode }) {
  const id = useId();
  const current = useSyncExternalStore<Manager>(subscribe, readManager, () => "bun");
  const list = useRef<HTMLDivElement>(null);
  const panels = Children.toArray(children).filter((child) => managerOf(child) !== null);

  const move = (delta: number): void => {
    const index = MANAGERS.indexOf(current);
    const next = MANAGERS[(index + delta + MANAGERS.length) % MANAGERS.length] ?? "bun";
    chooseManager(next);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  };

  return (
    <div className="pm-tabs">
      <div ref={list} role="tablist" aria-label="Package manager" className="pm-tablist">
        {MANAGERS.map((manager) => (
          <button
            key={manager}
            type="button"
            role="tab"
            id={`${id}-tab-${manager}`}
            data-tab={manager}
            aria-selected={current === manager}
            aria-controls={`${id}-panel-${manager}`}
            tabIndex={current === manager ? 0 : -1}
            onClick={() => chooseManager(manager)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            {manager}
          </button>
        ))}
      </div>
      {panels.map((panel) => {
        const manager = managerOf(panel);
        return (
          <div
            key={manager}
            role="tabpanel"
            id={`${id}-panel-${manager}`}
            aria-labelledby={`${id}-tab-${manager}`}
            data-pm-panel={manager}
          >
            {panel}
          </div>
        );
      })}
    </div>
  );
}
