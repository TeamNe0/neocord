import type { JSX as ReactJSX } from "react/jsx-runtime";

declare module "mdx/types.js" {
  export import JSX = ReactJSX;
}

declare global {
  interface ImportMetaEnv {
    readonly VITE_SITE_URL?: string;
    readonly VITE_TRAILING_SLASH?: string;
  }
}
