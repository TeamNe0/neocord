import { Message, renderAsync, renderModal, type ModalRenderResult, type RenderResult } from "@neocord/react";
import { isValidElement, type ComponentType, type ReactElement, type ReactNode } from "react";
import { NeocordContext } from "../context-hook.tsx";
import type { AnyContext, LayoutProps, ModalDefinition, ModalRenderContext } from "../types.ts";
import type { LiveErrorHandler, LiveStore, OpenedRoot } from "./live-store.ts";

export interface RenderRequest {
  node: ReactNode;
  ctx: AnyContext | null;
  layouts: readonly ComponentType<LayoutProps>[];
}

function applyLayouts(node: ReactNode, layouts: readonly ComponentType<LayoutProps>[]): ReactNode {
  return layouts.reduceRight<ReactNode>((children, Layout) => <Layout>{children}</Layout>, node);
}

export function composeTree({ node, ctx, layouts }: RenderRequest): ReactNode {
  let content: ReactNode;
  if (isValidElement(node) && node.type === Message) {
    const { children, ...props } = (node as ReactElement<{ children?: ReactNode }>).props;
    content = <Message {...props}>{applyLayouts(children, layouts)}</Message>;
  } else {
    content = applyLayouts(node, layouts);
  }
  return <NeocordContext.Provider value={ctx}>{content}</NeocordContext.Provider>;
}

function assertNotEmpty(payload: RenderResult): void {
  if (payload.components.length === 0) {
    throw new Error("The returned node rendered no components, so there is nothing to send to Discord.");
  }
}

export async function renderForInteraction(
  request: RenderRequest,
  store: LiveStore,
  onError?: LiveErrorHandler,
): Promise<OpenedRoot> {
  const opened = await store.open(composeTree(request), onError);
  try {
    assertNotEmpty(opened.payload);
  } catch (error) {
    opened.session?.destroy();
    throw error;
  }
  return opened;
}

export function renderOneShot(request: RenderRequest): Promise<RenderResult> {
  return renderAsync(composeTree(request));
}

export function stringifyParams(params: Record<string, unknown>): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      result[key] = value.map(String);
    } else if (value !== undefined) {
      result[key] = String(value);
    }
  }
  return result;
}

export function renderModalRoute(
  definition: ModalDefinition,
  customId: string,
  params: Record<string, string | string[]>,
  ctx: AnyContext | null,
): ModalRenderResult {
  const renderContext = {
    params,
    field: (name: string) => name,
  } as unknown as ModalRenderContext;
  const title = typeof definition.title === "function" ? definition.title(renderContext) : definition.title;
  const node = definition.render(renderContext);
  return renderModal(<NeocordContext.Provider value={ctx}>{node}</NeocordContext.Provider>, { customId, title });
}
