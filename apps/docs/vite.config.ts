import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { mdxOptions } from "./plugins/mdx-options.ts";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    { enforce: "pre", ...mdx(mdxOptions) },
    react({ include: /\.(jsx|js|mdx|md|tsx|ts)$/ }),
    tailwindcss(),
  ],
  build: {
    manifest: !isSsrBuild,
    chunkSizeWarningLimit: 900,
  },
}));
