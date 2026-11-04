import type { MDXContent } from "mdx/types";
import type { ComponentType } from "react";
import { matchRoutes, type RouteObject } from "react-router";
import { DocPage } from "./components/DocPage.tsx";
import { DocsLayout } from "./components/DocsLayout.tsx";
import { NotFound } from "./components/NotFound.tsx";
import { RootLayout } from "./components/RootLayout.tsx";
import { ALL_PAGES, type PageDef } from "./data/nav.ts";
import type { HeadingEntry } from "./types.ts";

interface MdxModule {
  default: MDXContent;
  headings: HeadingEntry[];
}

const CONTENT = import.meta.glob<MdxModule>(["./content/**/*.mdx", "!./content/landing/**"]);

function docRoute(page: PageDef): RouteObject {
  const load = CONTENT[`./content/${page.file}.mdx`];
  if (load === undefined) throw new Error(`No MDX file for ${page.path}: src/content/${page.file}.mdx`);
  return {
    path: page.path,
    lazy: async () => {
      const module = await load();
      const Component: ComponentType = () => <DocPage page={page} Content={module.default} headings={module.headings} />;
      return { Component };
    },
  };
}

export function createRoutes(): RouteObject[] {
  return [
    {
      path: "/",
      Component: RootLayout,
      children: [
        {
          index: true,
          lazy: async () => {
            const { Landing } = await import("./components/landing/Landing.tsx");
            return { Component: Landing };
          },
        },
        {
          Component: DocsLayout,
          children: ALL_PAGES.filter((page) => CONTENT[`./content/${page.file}.mdx`]).map(docRoute),
        },
        { path: "*", Component: NotFound },
      ],
    },
  ];
}

export async function resolveLazyMatches(routes: RouteObject[], pathname: string): Promise<void> {
  const matches = matchRoutes(routes, { pathname }) ?? [];
  await Promise.all(
    matches.map(async ({ route }) => {
      if (typeof route.lazy !== "function") return;
      const resolved = await route.lazy();
      Object.assign(route, resolved, { lazy: undefined });
    }),
  );
}
