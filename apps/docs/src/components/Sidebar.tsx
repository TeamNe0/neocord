import { NavLink, useLocation } from "react-router";
import { NAV, normalizePath, type PageDef } from "../data/nav.ts";

function PageLink({ page }: { page: PageDef }) {
  return (
    <NavLink to={page.path} end className="channel">
      <span className="channel-slash" aria-hidden="true">
        /
      </span>
      <span>{page.title}</span>
    </NavLink>
  );
}

export function Sidebar() {
  const path = normalizePath(useLocation().pathname);
  return (
    <nav aria-label="Documentation" className="sidebar-nav">
      {NAV.map((group) => (
        <section key={group.title} className="channel-group">
          <h2 className="channel-group-title">{group.title}</h2>
          <ul>
            {group.pages.map((page) => (
              <li key={page.path}>
                <PageLink page={page} />
                {page.children ? (
                  <details className="channel-children" open={path.startsWith(`${page.path}/`) || path === page.path}>
                    <summary>{page.children.length} rules</summary>
                    <ul>
                      {page.children.map((child) => (
                        <li key={child.path}>
                          <PageLink page={child} />
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
