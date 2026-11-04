# @neocord/routing

The file-system routing conventions behind [neocord](https://www.npmjs.com/package/neocord). The CLI, the runtime, the React renderer and the ESLint plugin all share this package, so a file means the same thing to each of them.

You rarely need to install it directly. Other tools can use it to understand a neocord project.

```bash
bun add @neocord/routing
```

## Classify a file

```ts
import { classifyFile } from "@neocord/routing";

classifyFile("src/features/moderation/buttons/confirm-ban/[userId]/button.tsx");
```

The result describes the file:

```ts
{
  type: "route",
  kind: "button",
  feature: "moderation",
  routeId: "moderation/confirm-ban/[userId]",
  segments: ["confirm-ban", "[userId]"],
  scopes: [
    "src/features/moderation",
    "src/features/moderation/buttons",
    "src/features/moderation/buttons/confirm-ban",
    "src/features/moderation/buttons/confirm-ban/[userId]"
  ]
}
```

## Build custom ids

```ts
import { buildCustomId } from "@neocord/routing";

buildCustomId("moderation/confirm-ban/[userId]", { userId: "123" });
```

This returns `moderation/confirm-ban/123`. Values are URI encoded, and an id longer than Discord's limit of 100 characters throws a `CustomIdError`.

## Match custom ids

```ts
import { createRouter } from "@neocord/routing";

const router = createRouter<string>();
router.add("moderation/confirm-ban/[userId]", "handler");

router.match("moderation/confirm-ban/123");
```

This returns `{ route: "handler", params: { userId: "123" } }`. Static segments win over `[param]` segments, which win over `[...catchAll]` segments.

## Infer params

```ts
import type { RouteParams } from "@neocord/routing";

type Params = RouteParams<"mod/[id]/[...rest]">;
```

`Params` is `{ id: string; rest: string[] }`.

## License

MIT
