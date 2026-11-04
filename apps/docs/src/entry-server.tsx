import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { ALL_PAGES, HOME_META, NOT_FOUND_META, groupOf, type PageDef } from "./data/nav.ts";
import { createRoutes, resolveLazyMatches } from "./routes.tsx";
import { pageMeta, SITE_NAME, SITE_URL } from "./site.ts";

export { ALL_PAGES, groupOf, HOME_META, NOT_FOUND_META, pageMeta, SITE_NAME, SITE_URL };
export type { PageDef };

export async function renderPath(pathname: string): Promise<string> {
  const routes = createRoutes();
  await resolveLazyMatches(routes, pathname);
  const { query, dataRoutes } = createStaticHandler(routes);
  const context = await query(new Request(`${SITE_URL}${pathname}`));
  if (context instanceof Response) {
    throw new Error(`Rendering ${pathname} returned a ${context.status} response.`);
  }
  const router = createStaticRouter(dataRoutes, context);
  return renderToString(<StaticRouterProvider router={router} context={context} hydrate={false} />);
}
