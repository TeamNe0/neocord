import { createContext, createElement, Suspense, type ReactNode } from "react";
import ReactReconciler from "react-reconciler";
import {
  ConcurrentRoot,
  DefaultEventPriority,
  NoEventPriority,
} from "react-reconciler/constants.js";
import {
  appendNode,
  createHostContainer,
  insertNodeBefore,
  needsSlot,
  removeNode,
  type HostContainer,
  type HostElement,
  type HostProps,
  type HostText,
} from "./host.ts";

type Fiber = ReactReconciler.Fiber;
type TimeoutHandle = ReturnType<typeof setTimeout>;

const NO_TIMEOUT = -1;
const HOST_CONTEXT = Object.freeze({});
const SUSPENSE_TAG = 13;
const OFFSCREEN_TAG = 22;

let currentUpdatePriority: number = NoEventPriority;

function noop(): void {}

function slotPath(fiber: Fiber, slotTypes: Map<unknown, number>): string {
  const parts: string[] = [];
  let current: Fiber | null = fiber;
  while (current !== null) {
    let typeId = slotTypes.get(current.type);
    if (typeId === undefined) {
      typeId = slotTypes.size;
      slotTypes.set(current.type, typeId);
    }
    parts.push(`${typeId}:${current.key ?? current.index}`);
    current = current.return;
  }
  return parts.join("/");
}

const hostConfig: ReactReconciler.HostConfig<
  string,
  HostProps,
  HostContainer,
  HostElement,
  HostText,
  never,
  never,
  never,
  never,
  HostElement | HostText,
  typeof HOST_CONTEXT,
  never,
  TimeoutHandle,
  typeof NO_TIMEOUT,
  null,
  null,
  null,
  never,
  never,
  never
> = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsMicrotasks: true,
  isPrimaryRenderer: false,
  warnsIfNotActing: false,
  noTimeout: NO_TIMEOUT,
  rendererVersion: "0.1.0",
  rendererPackageName: "@neocord/react",
  extraDevToolsConfig: null,
  NotPendingTransition: null,
  HostTransitionContext: createContext<null>(null),

  bindToConsole: () => noop,
  scheduleMicrotask: (callback) => {
    queueMicrotask(() => {
      callback();
    });
  },
  scheduleTimeout: (callback) => setTimeout(callback, 0),
  cancelTimeout: (handle) => {
    clearTimeout(handle);
  },

  createInstance: (type, props, container, _hostContext, handle: Fiber) => ({
    kind: "element",
    type,
    props,
    children: [],
    hidden: false,
    slot: container.slotTypes !== null && needsSlot(type) ? slotPath(handle, container.slotTypes) : null,
  }),
  createTextInstance: (text) => ({ kind: "text", text, hidden: false }),
  appendInitialChild: appendNode,
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getRootHostContext: () => HOST_CONTEXT,
  getChildHostContext: (parent) => parent,
  getPublicInstance: (instance) => instance,
  prepareForCommit: () => null,
  resetAfterCommit: (container) => {
    container.onCommit?.();
  },
  preparePortalMount: noop,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: noop,
  afterActiveInstanceBlur: noop,
  prepareScopeUpdate: noop,
  getInstanceFromScope: () => null,
  detachDeletedInstance: noop,

  appendChild: appendNode,
  appendChildToContainer: appendNode,
  insertBefore: insertNodeBefore,
  insertInContainerBefore: insertNodeBefore,
  removeChild: removeNode,
  removeChildFromContainer: removeNode,
  resetTextContent: noop,
  commitTextUpdate: (instance, _previous, next) => {
    instance.text = next;
  },
  commitMount: noop,
  commitUpdate: (instance, _type, _previous, next) => {
    instance.props = next;
  },
  hideInstance: (instance) => {
    instance.hidden = true;
  },
  hideTextInstance: (instance) => {
    instance.hidden = true;
  },
  unhideInstance: (instance) => {
    instance.hidden = false;
  },
  unhideTextInstance: (instance) => {
    instance.hidden = false;
  },
  clearContainer: (container) => {
    container.children = [];
  },

  setCurrentUpdatePriority: (priority) => {
    currentUpdatePriority = priority;
  },
  getCurrentUpdatePriority: () => currentUpdatePriority,
  resolveUpdatePriority: () =>
    currentUpdatePriority === NoEventPriority ? DefaultEventPriority : currentUpdatePriority,
  resetFormInstance: noop,
  requestPostPaintCallback: noop,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: noop,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,

  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => null,
  suspendInstance: noop,
  suspendOnActiveViewTransition: noop,
  waitForCommitToBeReady: () => null,
  getSuspendedCommitReason: () => null,
};

export const reconciler = ReactReconciler(hostConfig);

interface FiberRoot {
  readonly current: Fiber;
  readonly callbackNode: unknown;
}

export interface RendererRoot {
  readonly container: HostContainer;
  readonly fiberRoot: FiberRoot;
}

function recordUncaughtError(container: HostContainer, error: unknown): void {
  container.failure ??= { error };
  container.onUncaughtError?.(error);
}

export function createRendererRoot(container: HostContainer = createHostContainer()): RendererRoot {
  const fiberRoot: FiberRoot = reconciler.createContainer(
    container,
    ConcurrentRoot,
    null,
    false,
    null,
    "",
    (error) => {
      recordUncaughtError(container, error);
    },
    noop,
    noop,
    noop,
    null,
  );
  return { container, fiberRoot };
}

export function isRendering(): boolean {
  return reconciler.isAlreadyRendering();
}

export function flushNow(): void {
  reconciler.flushSyncWork();
  reconciler.flushPassiveEffects();
  reconciler.flushSyncWork();
}

export function commitSync(root: RendererRoot, node: ReactNode): void {
  reconciler.updateContainerSync(createElement(Suspense, { fallback: null }, node), root.fiberRoot, null, null);
  flushNow();
}

export function unmountRoot(root: RendererRoot): void {
  reconciler.updateContainerSync(null, root.fiberRoot, null, null);
  flushNow();
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function drain(root: RendererRoot): Promise<void> {
  do {
    flushNow();
    await nextTask();
    flushNow();
  } while (root.fiberRoot.callbackNode !== null);
}

function hasVisibleFallback(fiber: Fiber | null): boolean {
  let current = fiber;
  while (current !== null) {
    if (current.tag === SUSPENSE_TAG && current.memoizedState !== null) return true;
    const hiddenSubtree = current.tag === OFFSCREEN_TAG && current.memoizedState !== null;
    if (!hiddenSubtree && hasVisibleFallback(current.child)) return true;
    current = current.sibling;
  }
  return false;
}

export function isSuspended(root: RendererRoot): boolean {
  return hasVisibleFallback(root.fiberRoot.current);
}

export function waitForNextCommit(root: RendererRoot): Promise<void> {
  const { container } = root;
  return new Promise((resolve) => {
    const previousCommit = container.onCommit;
    const previousError = container.onUncaughtError;
    const settle = (): void => {
      container.onCommit = previousCommit;
      container.onUncaughtError = previousError;
      resolve();
    };
    container.onCommit = () => {
      previousCommit?.();
      settle();
    };
    container.onUncaughtError = (error) => {
      previousError?.(error);
      settle();
    };
  });
}
