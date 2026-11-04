import { Outlet } from "react-router";
import { Sidebar } from "./Sidebar.tsx";

export function DocsLayout() {
  return (
    <div className="docs-shell">
      <aside className="docs-sidebar">
        <Sidebar />
      </aside>
      <Outlet />
    </div>
  );
}
