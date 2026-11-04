import { createContext, use } from "react";
import type { AnyContext } from "./types.ts";

export const NeocordContext = createContext<AnyContext | null>(null);

export function useContext<C extends AnyContext = AnyContext>(): C {
  const context = use(NeocordContext);
  if (context === null) {
    throw new Error("useContext() must be used inside a component rendered by neocord.");
  }
  return context as C;
}
