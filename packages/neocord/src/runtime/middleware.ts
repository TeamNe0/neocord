import type { ReactNode } from "react";
import type { AnyContext, MiddlewareDefinition } from "../types.ts";

export interface CompiledMiddleware {
  file: string;
  definition: MiddlewareDefinition;
}

export function isRenderable(value: unknown): value is ReactNode {
  return value !== undefined && value !== null && typeof value !== "boolean";
}

export async function runMiddleware(
  chain: readonly CompiledMiddleware[],
  ctx: AnyContext,
  terminal: () => Promise<void>,
  onReturn: (node: ReactNode) => Promise<void>,
): Promise<void> {
  const applicable = chain.filter(({ definition }) => {
    const kinds: readonly string[] | undefined = definition.kinds;
    return kinds === undefined || kinds.includes(ctx.kind);
  });

  const step = async (index: number): Promise<void> => {
    const entry = applicable[index];
    if (entry === undefined) {
      await terminal();
      return;
    }
    let called = false;
    const next = async (): Promise<void> => {
      if (called) throw new Error(`next() was called more than once in middleware "${entry.file}".`);
      called = true;
      await step(index + 1);
    };
    const result = await (entry.definition.handler as (ctx: AnyContext, next: () => Promise<void>) => unknown)(ctx, next);
    if (isRenderable(result)) await onReturn(result);
  };

  await step(0);
}
