import type { ReactElement, ReactNode } from "react";
import type { HostNode } from "./host.ts";
import {
  commitSync,
  createRendererRoot,
  drain,
  isRendering,
  isSuspended,
  unmountRoot,
  waitForNextCommit,
  type RendererRoot,
} from "./reconciler.ts";
import { serializeMessage, serializeModal } from "./serialize.ts";
import type { ModalOptions, ModalRenderResult, RenderOptions, RenderResult } from "./types.ts";

function throwOnFailure(root: RendererRoot): void {
  if (root.container.failure !== null) throw root.container.failure.error;
}

function assertNotRendering(name: string): void {
  if (isRendering()) {
    throw new Error(
      `${name}() cannot be called while React is rendering or committing. Call it from an event handler or outside the component tree.`,
    );
  }
}

function renderSync<T>(
  name: string,
  node: ReactNode,
  serialize: (nodes: readonly HostNode[]) => T,
): T {
  assertNotRendering(name);
  const root = createRendererRoot();
  try {
    commitSync(root, node);
    throwOnFailure(root);
    if (isSuspended(root)) {
      throw new Error(
        `${name}() does not support suspended components because it is synchronous. Use renderAsync() or remove the suspending component.`,
      );
    }
    return serialize(root.container.children);
  } finally {
    unmountRoot(root);
  }
}

export function render(node: ReactNode, options?: RenderOptions): RenderResult {
  if (options?.live !== undefined) {
    throw new Error("render() does not support the live option. Use createLiveRoot() for live sessions.");
  }
  return renderSync("render", node, (nodes) => serializeMessage(nodes));
}

export async function renderAsync(node: ReactNode): Promise<RenderResult> {
  assertNotRendering("renderAsync");
  const root = createRendererRoot();
  try {
    commitSync(root, node);
    for (;;) {
      await drain(root);
      throwOnFailure(root);
      if (!isSuspended(root)) break;
      await waitForNextCommit(root);
    }
    return serializeMessage(root.container.children);
  } finally {
    unmountRoot(root);
  }
}

export function renderModal(node: ReactElement, options?: Partial<ModalOptions>): ModalRenderResult;
export function renderModal(node: ReactNode, options: ModalOptions): ModalRenderResult;
export function renderModal(node: ReactNode, options?: Partial<ModalOptions>): ModalRenderResult {
  return renderSync("renderModal", node, (nodes) => serializeModal(nodes, options));
}
