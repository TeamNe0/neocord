import { Outlet } from "react-router";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sidebar } from "./Sidebar.tsx";

export function DocsLayout() {
  return (
    <div className="mx-auto max-w-[92rem] lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]">
      <aside className="docs-sidebar vt-sidebar sticky top-(--header-height) hidden h-[calc(100dvh-var(--header-height))] border-r lg:block">
        <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
          <div className="px-3 pt-5 pb-12">
            <Sidebar />
          </div>
        </ScrollArea>
      </aside>
      <Outlet />
    </div>
  );
}
