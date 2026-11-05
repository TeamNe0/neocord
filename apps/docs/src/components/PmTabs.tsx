import { Children, Fragment, isValidElement, useSyncExternalStore, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

function chooseManager(value: string): void {
  const manager = MANAGERS.find((candidate) => candidate === value);
  if (manager === undefined) return;
  document.documentElement.dataset.pm = manager;
  window.dispatchEvent(new Event("neocord-pm"));
  localStorage.setItem("neocord-pm", manager);
}

function managerOf(child: ReactNode): Manager | null {
  if (!isValidElement<{ "data-pm"?: string; children?: ReactNode }>(child)) return null;
  if (child.type === Fragment) return managerOf(child.props.children);
  const value = child.props["data-pm"];
  return MANAGERS.find((manager) => manager === value) ?? null;
}

export function PmTabs({ children }: { children?: ReactNode }) {
  const current = useSyncExternalStore<Manager>(subscribe, readManager, () => "bun");
  const panels = Children.toArray(children).filter((child) => managerOf(child) !== null);

  return (
    <div className="pm-tabs overflow-hidden rounded-xl border bg-code">
      <Tabs value={current} onValueChange={chooseManager} className="gap-0">
        <TabsList
          variant="line"
          aria-label="Package manager"
          data-pm-list=""
          className="h-auto! w-full justify-start gap-0.5 rounded-none border-b bg-muted/50 px-1.5 pt-1 pb-0"
        >
          {MANAGERS.map((manager) => (
            <TabsTrigger
              key={manager}
              value={manager}
              data-tab={manager}
              className="h-auto flex-none rounded-none rounded-t-md px-2.5 py-1 font-mono text-[0.8rem] font-normal transition-colors after:hidden hover:bg-accent/60 focus-visible:ring-0 focus-visible:outline-2"
            >
              {manager}
            </TabsTrigger>
          ))}
        </TabsList>
        {panels.map((panel) => {
          const manager = managerOf(panel);
          if (manager === null) return null;
          return (
            <TabsContent key={manager} value={manager} forceMount data-pm-panel={manager} className="tab-fade text-base">
              {panel}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
