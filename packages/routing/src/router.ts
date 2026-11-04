import { parseSegment } from "./params.ts";

export interface RouteMatch<T> {
  route: T;
  params: Record<string, string | string[]>;
}

interface Node<T> {
  children: Map<string, Node<T>>;
  param?: { name: string; node: Node<T> };
  catchAll?: { name: string; value: T };
  value?: T;
}

function createNode<T>(): Node<T> {
  return { children: new Map() };
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export class RouteConflictError extends Error {
  override readonly name = "RouteConflictError";
}

export interface Router<T> {
  add(routeId: string, value: T): void;
  match(path: string): RouteMatch<T> | null;
}

export function createRouter<T>(): Router<T> {
  const root = createNode<T>();

  function add(routeId: string, value: T): void {
    let node = root;
    const segments = routeId.split("/");

    for (const [index, segment] of segments.entries()) {
      const parsed = parseSegment(segment);

      if (parsed.type === "static") {
        let child = node.children.get(parsed.value);
        if (!child) {
          child = createNode<T>();
          node.children.set(parsed.value, child);
        }
        node = child;
      } else if (parsed.type === "param") {
        if (node.param && node.param.name !== parsed.name) {
          throw new RouteConflictError(
            `Route "${routeId}" uses param "${parsed.name}" where "${node.param.name}" is already registered.`,
          );
        }
        node.param ??= { name: parsed.name, node: createNode<T>() };
        node = node.param.node;
      } else {
        if (index !== segments.length - 1) {
          throw new RouteConflictError(`Route "${routeId}" must end with its catch-all segment.`);
        }
        if (node.catchAll) {
          throw new RouteConflictError(`Route "${routeId}" conflicts with another catch-all route.`);
        }
        node.catchAll = { name: parsed.name, value };
        return;
      }
    }

    if (node.value !== undefined) {
      throw new RouteConflictError(`Route "${routeId}" is registered more than once.`);
    }
    node.value = value;
  }

  function walk(
    node: Node<T>,
    parts: readonly string[],
    index: number,
    params: Record<string, string | string[]>,
  ): RouteMatch<T> | null {
    if (index === parts.length) {
      return node.value === undefined ? null : { route: node.value, params };
    }

    const part = parts[index]!;
    const exact = node.children.get(part);
    if (exact) {
      const match = walk(exact, parts, index + 1, params);
      if (match) return match;
    }

    if (node.param) {
      const value = decode(part);
      if (value !== null) {
        const match = walk(node.param.node, parts, index + 1, { ...params, [node.param.name]: value });
        if (match) return match;
      }
    }

    if (node.catchAll) {
      const values = parts.slice(index).map(decode);
      if (values.every((value): value is string => value !== null)) {
        return { route: node.catchAll.value, params: { ...params, [node.catchAll.name]: values } };
      }
    }

    return null;
  }

  return {
    add,
    match(path) {
      return walk(root, path.split("/"), 0, {});
    },
  };
}
