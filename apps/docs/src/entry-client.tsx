import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { installHistoryMotion } from "./lib/navigation.ts";
import { createRoutes, resolveLazyMatches } from "./routes.tsx";
import "./styles/index.css";

async function start(): Promise<void> {
  const routes = createRoutes();
  await resolveLazyMatches(routes, window.location.pathname);
  installHistoryMotion();
  const router = createBrowserRouter(routes);
  const app = (
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
  const container = document.getElementById("root");
  if (container === null) throw new Error("The #root element is missing.");
  if (container.firstElementChild === null) {
    createRoot(container).render(app);
  } else {
    hydrateRoot(container, app);
  }
}

void start();
