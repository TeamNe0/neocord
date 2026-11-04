type Simplify<T> = { [K in keyof T]: T[K] } & {};

type SegmentParam<S extends string> = S extends `[...${infer Name}]`
  ? { [K in Name]: string[] }
  : S extends `[${infer Name}]`
    ? { [K in Name]: string }
    : {};

type CollectParams<R extends string> = R extends `${infer Head}/${infer Tail}`
  ? SegmentParam<Head> & CollectParams<Tail>
  : SegmentParam<R>;

export type RouteParams<R extends string> = Simplify<CollectParams<R>>;

export type HasParams<R extends string> = keyof RouteParams<R> extends never ? false : true;

export const CUSTOM_ID_MAX_LENGTH = 100;

export type ParamValue = string | number | bigint;

export type RouteParamInput<R extends string> = {
  [K in keyof RouteParams<R>]: RouteParams<R>[K] extends string[] ? readonly ParamValue[] : ParamValue;
};

export class CustomIdError extends Error {
  override readonly name = "CustomIdError";
}

export function parseSegment(segment: string):
  | { type: "static"; value: string }
  | { type: "param"; name: string }
  | { type: "catch-all"; name: string } {
  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return { type: "catch-all", name: segment.slice(4, -1) };
  }
  if (segment.startsWith("[") && segment.endsWith("]")) {
    return { type: "param", name: segment.slice(1, -1) };
  }
  return { type: "static", value: segment };
}

export function getParamNames(route: string): string[] {
  const names: string[] = [];
  for (const segment of route.split("/")) {
    const parsed = parseSegment(segment);
    if (parsed.type !== "static") names.push(parsed.name);
  }
  return names;
}

function encodeParam(route: string, name: string, value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new CustomIdError(`Route "${route}" is missing a value for param "${name}".`);
  }
  const encoded = encodeURIComponent(String(value));
  if (encoded.length === 0) {
    throw new CustomIdError(`Route "${route}" received an empty value for param "${name}".`);
  }
  return encoded;
}

export function buildCustomId(route: string, params: Record<string, unknown> = {}): string {
  const parts: string[] = [];

  for (const segment of route.split("/")) {
    const parsed = parseSegment(segment);

    if (parsed.type === "static") {
      parts.push(parsed.value);
    } else if (parsed.type === "param") {
      parts.push(encodeParam(route, parsed.name, params[parsed.name]));
    } else {
      const values = params[parsed.name];
      if (!Array.isArray(values) || values.length === 0) {
        throw new CustomIdError(`Route "${route}" requires a non-empty array for param "${parsed.name}".`);
      }
      for (const value of values) parts.push(encodeParam(route, parsed.name, value));
    }
  }

  const customId = parts.join("/");
  if (customId.length > CUSTOM_ID_MAX_LENGTH) {
    throw new CustomIdError(
      `Route "${route}" produced a custom id of ${customId.length} characters; Discord allows ${CUSTOM_ID_MAX_LENGTH}.`,
    );
  }
  return customId;
}
