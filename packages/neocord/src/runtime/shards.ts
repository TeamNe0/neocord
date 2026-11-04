import type { Client, Serialized } from "discord.js";
import type { Awaitable, ShardHelpers } from "../types.ts";

function serialize<T>(value: T): Serialized<T> {
  return (value === undefined ? undefined : JSON.parse(JSON.stringify(value))) as Serialized<T>;
}

function readPath(root: unknown, path: string): unknown {
  let value = root;
  for (const key of path.split(".")) {
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function createShardHelpers(client: Client<true>): ShardHelpers {
  const broadcastEval = async <R, C>(
    fn: (client: Client<true>, context: Serialized<C>) => Awaitable<R>,
    options?: { context: C },
  ): Promise<Serialized<R>[]> => {
    if (client.shard !== null) {
      const results = await client.shard.broadcastEval(fn, { context: options?.context as C });
      return results as Serialized<R>[];
    }
    return [serialize(await fn(client, serialize(options?.context as C)))];
  };

  return {
    get id() {
      return client.shard?.ids[0] ?? 0;
    },
    get ids() {
      return client.shard?.ids ?? [0];
    },
    get count() {
      return client.shard?.count ?? 1;
    },
    async fetchClientValues<T = unknown>(prop: string): Promise<T[]> {
      if (client.shard !== null) return (await client.shard.fetchClientValues(prop)) as T[];
      return [serialize(readPath(client, prop)) as T];
    },
    broadcastEval: broadcastEval as ShardHelpers["broadcastEval"],
  };
}
