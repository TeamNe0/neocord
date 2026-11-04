import { ComponentType, MessageFlags } from "discord.js";
import { createContext, createElement, useContext, type ReactNode } from "react";
import { createHostContainer } from "./host.ts";
import {
  commitSync,
  createRendererRoot,
  drain,
  isRendering,
  reconciler,
  unmountRoot,
} from "./reconciler.ts";
import { serializeMessage, type LiveBinding, type LiveHandler } from "./serialize.ts";
import type { LiveInteraction, LiveRoot, LiveRootOptions, RenderResult } from "./types.ts";

interface LiveState {
  events: unknown[];
}

const LiveContext = createContext<LiveState | null>(null);

export function useLiveInteraction<E = LiveInteraction>(): E | null {
  const state = useContext(LiveContext);
  if (state === null || state.events.length === 0) return null;
  return state.events.at(-1) as E;
}

type TopLevelComponent = RenderResult["components"][number];

function disableComponent<T extends TopLevelComponent>(component: T): T;
function disableComponent(component: TopLevelComponent): TopLevelComponent {
  switch (component.type) {
    case ComponentType.ActionRow:
      return { ...component, components: component.components.map((child) => ({ ...child, disabled: true })) };
    case ComponentType.Section:
      return component.accessory.type === ComponentType.Button
        ? { ...component, accessory: { ...component.accessory, disabled: true } }
        : component;
    case ComponentType.Container:
      return { ...component, components: component.components.map((child) => disableComponent(child)) };
    default:
      return component;
  }
}

export function createLiveRoot(options: LiveRootOptions): LiveRoot {
  const { sessionId, onUpdate, onError } = options;
  if (typeof sessionId !== "string" || sessionId === "") {
    throw new Error("createLiveRoot requires a non-empty sessionId.");
  }

  const container = createHostContainer();
  container.slotTypes = new Map();
  const root = createRendererRoot(container);
  const state: LiveState = { events: [] };
  const slots = new Map<string, number>();

  let handlers = new Map<string, LiveHandler>();
  let payload: RenderResult = { flags: MessageFlags.IsComponentsV2, components: [] };
  let dirty = false;
  let dispatching = 0;
  let silent = 0;
  let notifyQueued = false;
  let unmounted = false;
  let pendingError: { readonly error: unknown } | null = null;

  const report = (error: unknown): void => {
    if (onError !== undefined && dispatching === 0 && silent === 0) {
      onError(error);
    } else {
      pendingError ??= { error };
    }
  };

  const throwPending = (): void => {
    if (pendingError === null) return;
    const { error } = pendingError;
    pendingError = null;
    throw error;
  };

  const refresh = (): void => {
    if (!dirty) return;
    dirty = false;
    if (container.failure !== null) {
      handlers = new Map();
      return;
    }
    const nextHandlers = new Map<string, LiveHandler>();
    const binding: LiveBinding = {
      assign(node, handler) {
        const slot = node.slot ?? "";
        let index = slots.get(slot);
        if (index === undefined) {
          index = slots.size;
          slots.set(slot, index);
        }
        const customId = `~${sessionId}:${index}`;
        nextHandlers.set(customId, handler);
        return customId;
      },
    };
    payload = serializeMessage(container.children, { live: binding, allowEmpty: true });
    handlers = nextHandlers;
  };

  const notify = (): void => {
    notifyQueued = false;
    if (!dirty || unmounted || dispatching > 0 || silent > 0 || container.failure !== null) return;
    try {
      refresh();
      void Promise.resolve(onUpdate?.(payload)).catch(report);
    } catch (error) {
      report(error);
    }
  };

  container.onCommit = () => {
    dirty = true;
    if (dispatching > 0 || silent > 0 || notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(notify);
  };

  container.onUncaughtError = (error) => {
    dirty = true;
    report(error);
  };

  const wrap = (node: ReactNode): ReactNode => createElement(LiveContext.Provider, { value: state }, node);

  const assertMounted = (): void => {
    if (unmounted) throw new Error(`Live root "${sessionId}" has been unmounted.`);
  };

  return {
    render(node) {
      assertMounted();
      if (isRendering()) {
        throw new Error("LiveRoot.render() cannot be called while React is rendering or committing.");
      }
      container.failure = null;
      silent += 1;
      try {
        commitSync(root, wrap(node));
      } finally {
        silent -= 1;
      }
      if (container.failure !== null) {
        refresh();
        const { error } = container.failure;
        pendingError = null;
        throw error;
      }
      refresh();
    },

    get payload() {
      refresh();
      return payload;
    },

    get hasHandlers() {
      if (unmounted) return false;
      refresh();
      return handlers.size > 0;
    },

    async dispatch(customId, event) {
      if (unmounted) return false;
      throwPending();
      refresh();
      const handler = handlers.get(customId);
      if (handler === undefined) return false;

      dispatching += 1;
      state.events.push(event);
      let failure: { readonly error: unknown } | null = null;
      try {
        await reconciler.flushSyncFromReconciler(() => handler(event));
      } catch (error) {
        failure = { error };
      }

      try {
        await drain(root);
        refresh();
      } catch (error) {
        failure ??= { error };
      } finally {
        state.events.splice(state.events.lastIndexOf(event), 1);
        dispatching -= 1;
      }

      if (failure !== null) {
        pendingError = null;
        throw failure.error;
      }
      throwPending();
      return true;
    },

    async flush() {
      if (unmounted) return;
      await drain(root);
      if (dispatching === 0) notify();
      throwPending();
      refresh();
    },

    disableInteractive() {
      refresh();
      return { ...payload, components: payload.components.map((component) => disableComponent(component)) };
    },

    unmount() {
      if (unmounted) return;
      refresh();
      unmounted = true;
      handlers = new Map();
      unmountRoot(root);
      dirty = false;
    },
  };
}
