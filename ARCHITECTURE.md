# neocord architecture

neocord is a file-routed framework for Discord bots, built on discord.js and React. This document is the contract between its packages. If code and this document disagree, fix one of them in the same change.

## Packages

| Path | Name | Published | Purpose |
| --- | --- | --- | --- |
| `packages/routing` | `@teamneo/neocord-routing` | yes | File conventions, route ids, custom id building and matching. No dependencies. |
| `packages/react` | `@teamneo/neocord-react` | yes | React renderer that turns JSX into Discord message and modal payloads. |
| `packages/neocord` | `neocord` | yes | `define*` helpers, handler contexts, bot runtime, sharding manager, command deploy, testing helpers. |
| `packages/cli` | `@teamneo/neocord-cli` | yes | The `neocord` binary. Scans routes, generates code and types, bundles, launches. |
| `packages/eslint-plugin` | `@teamneo/neocord-eslint-plugin` | yes | Rules for what each file must export, plus best practices. |
| `packages/create-neocord` | `create-neocord` | yes | `bun create neocord` scaffolder. |
| `packages/tsconfig` | `@teamneo/neocord-tsconfig` | no | Shared compiler options. |
| `apps/docs` | `@teamneo/neocord-docs` | deployed | Vite + React documentation site. |
| `example` | `@teamneo/neocord-example` | no | Example bot exercising the whole framework. |

Dependency direction: `routing` ← `react` ← `neocord` ← `cli` (peer). `eslint-plugin` depends only on `routing`. Nothing depends on `create-neocord`.

## Toolchain

- Bun workspaces with a dependency catalog in the root `package.json`. Turbo runs tasks.
- `tsc` is native TypeScript 7 (`@typescript/native`). The `typescript` package name is aliased to `@typescript/typescript6` because typescript-eslint needs the TS 6 API. This is Microsoft's documented side-by-side setup, and generated projects use it too.
- Libraries build with `tsc -p tsconfig.build.json` to unbundled ESM in `dist`. Relative imports use `.ts`/`.tsx` extensions, rewritten at emit.
- Tests use `bun test`, in `src/**/*.test.ts(x)`. Published output must run on Node >= 22.12 and on Bun, so `src` (outside tests) must not use `Bun.*` or `bun:*`.
- Source code has no comments.

## User project layout

```
neocord.config.ts            defineConfig
src/
  env.ts                     t3-env schema
  context.ts                 defineContext, optional app-wide services such as the database
  middleware.ts              optional, applies to every interaction except autocomplete
  layout.tsx error.tsx loading.tsx
  features/
    moderation/
      feature.ts             optional defineFeature
      middleware.ts layout.tsx error.tsx loading.tsx
      commands/
        ban/command.tsx             /ban
        mod/group.ts                metadata for /mod
        mod/warn/command.tsx        /mod warn
        mod/case/view/command.tsx   /mod case view
      user-commands/report/command.tsx     user context menu
      message-commands/quote/command.tsx   message context menu
      buttons/confirm-ban/[userId]/button.tsx   custom id moderation/confirm-ban/<userId>
      selects/pick-role/select.tsx              custom id moderation/pick-role
      modals/ban-reason/[userId]/modal.tsx      custom id moderation/ban-reason/<userId>
      events/guildMemberAdd.ts       also events/guildMemberAdd/<anything>.ts
      tasks/cleanup.ts
      _lib/anything.ts               folders and files starting with _ are private
```

`classifyFile` in `@teamneo/neocord-routing` is the source of truth. The rules:

- Folders named `(group)` organise files without changing the route.
- `[param]` is one dynamic segment, `[...rest]` catches the remainder.
- Slash commands are global, so the feature is not part of the name. Depth is limited to three segments, and a folder cannot hold both a `command` file and nested commands.
- Interaction route ids are `<feature>/<path>`, and that string with params filled in is the Discord custom id. Dispatch uses a separate route table per interaction type, so a button and a modal can share an id.
- Custom ids starting with `~` are reserved for live sessions.
- `middleware`, `layout`, `error` and `loading` files apply to everything beneath them. Middleware and layouts compose from root to leaf. For `error` and `loading`, the closest one wins.

## `@teamneo/neocord-react`

A real React renderer built on `react-reconciler`, so function components, context, hooks and `<Suspense>` work. Components return host elements. The committed host tree is serialised to Discord payloads and validated with Discord's limits.

```ts
render(node, options?: { live?: never }): RenderResult
renderAsync(node): Promise<RenderResult>
renderModal(node, { customId, title }): ModalRenderResult
createLiveRoot({ sessionId, onUpdate }): LiveRoot
buildCustomId, type RouteParams             re-exported from @teamneo/neocord-routing
escapeMarkdown(text)
useLiveInteraction()
```

`RenderResult` can be handed straight to discord.js:

```ts
interface RenderResult {
  flags: MessageFlags.IsComponentsV2 | (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  components: APIMessageTopLevelComponent[];
  files?: AttachmentPayload[];
  allowedMentions?: MessageMentionOptions;
}
interface ModalRenderResult {
  custom_id: string;
  title: string;
  components: (APILabelComponent | APITextDisplayComponent)[];
}
```

`render` is synchronous and throws if the tree suspends. `renderAsync` waits for suspended content.

### Components

Layout: `Message`, `Container`, `Section`, `TextDisplay`, `Separator`, `ActionRow`, `MediaGallery`, `MediaItem`, `Thumbnail`, `File`.

Interactive: `Button`, `StringSelect`, `Option`, `UserSelect`, `RoleSelect`, `MentionableSelect`, `ChannelSelect`.

Modal: `Modal`, `Label`, `TextInput`, `FileUpload`, `RadioGroup`, `CheckboxGroup`, `Checkbox`. `Option` is also used by radio and checkbox groups.

Inline text: `Bold`, `Italic`, `Underline`, `Strikethrough`, `Spoiler`, `Code`, `CodeBlock`, `Quote`, `Heading`, `Subtext`, `Link`, `List`, `ListItem`, `UserMention`, `RoleMention`, `ChannelMention`, `Timestamp`, `Emoji`, `LineBreak`.

Behaviour that goes beyond the reference package in `reference/react`:

- Any function component works, including hooks and context.
- Text may sit directly in `Message`, `Container` or `Section`. Adjacent text and inline elements collapse into one `TextDisplay`.
- Props are discriminated unions with friendly values: `style="primary"`, `spacing="large"`, `accentColor="#5865f2"` or a number or a named colour, emoji as a string or `{ id, name, animated }`.
- `<Button route="moderation/confirm-ban/[userId]" params={{ userId }}>` is the preferred way to address a handler. `route` is typed from the generated route map, and `params` is required exactly when the route has params. `customId` remains available as a raw escape hatch, and `onClick`/`onSelect` make a live session. These three are mutually exclusive at the type level.
- `<File src={buffer} name="report.txt" />`, `<Thumbnail src=... />` and `<MediaItem src=... />` accept URLs, `attachment://` references or Buffers. Buffers are collected into `files` automatically.
- `<Message ephemeral allowedMentions={...}>` as the root sets flags and mention rules.
- Every Discord limit from the reference `validate.ts` is enforced, with messages naming the component.

Route typing uses an interface the CLI augments:

```ts
export interface RegisteredRoutes {}
type ButtonRoute = RegisteredRoutes extends { buttons: infer R extends string } ? R : string;
```

The generated declaration file contains `declare module "@teamneo/neocord-react" { interface RegisteredRoutes { buttons: "a" | "b"; selects: ...; modals: ... } }`.

### Live sessions

`onClick` on a `Button` and `onSelect` on a select require a live root. The renderer assigns custom ids of the form `~<sessionId>:<index>`, stable across re-renders by position and component key.

```ts
interface LiveRoot {
  render(node: ReactNode): void;
  readonly payload: RenderResult;
  readonly hasHandlers: boolean;
  dispatch(customId: string, event: unknown): Promise<boolean>;
  flush(): Promise<void>;
  settle(): Promise<void>;
  disableInteractive(): RenderResult;
  unmount(): void;
}
```

`onUpdate(result)` fires for commits that happen outside a dispatch, such as a timer calling `setState`. One-shot `render` throws a clear error if it meets a handler prop, directing users to `ctx.reply` or `createLiveRoot`.

The `neocord` live store tracks sessions by target message. Any delivery through `ctx`, a route `update` or a modal `update` destroys the session on the message it writes to, so an old tree cannot overwrite newer content at its TTL. Clicks on one session run one at a time, with the auto-defer timer already armed while they wait. Each click records its message as the fallback for edits after the token dies. During a click the event's response methods go through the responder, so `event.reply` still works after an auto-defer. A click on a dead session removes only components whose `custom_id` starts with `~`.

## `neocord`

`neocord` exports:

```ts
defineConfig, defineCommand, defineUserCommand, defineMessageCommand, defineGroup,
defineButton, defineSelect, defineModal, defineEvent, defineTask, defineMiddleware,
defineFeature, defineContext, option, useContext, parseDuration, neocord types
```

Every helper returns the input with a brand: `{ __neocord: "command", ...definition }`. The runtime rejects modules whose default export lacks the expected brand, naming the file.

`neocord/runtime` exports `startBot`, `startManager`, `serializeCommands`, `deployCommands`, `validateManifest`, plus the `Manifest` types. `neocord/testing` exports the test harness.

### Config

```ts
export default defineConfig({
  intents: ["Guilds"],                     // keyof typeof GatewayIntentBits
  partials: [],                            // keyof typeof Partials
  client: {},                              // other discord.js ClientOptions
  token: env.DISCORD_TOKEN,                // default process.env.DISCORD_TOKEN
  sourceDir: "src",
  featuresDir: "src/features",
  runtime: "auto",                         // "auto" | "bun" | "node"
  sharding: {
    totalShards: "auto",                   // number | "auto"
    shardList: "auto",
    mode: "process",                       // "process" | "worker"
    respawn: true,
    spawnDelay: 5500,
    spawnTimeout: 30000,
  },
  deploy: { mode: "manual" },              // "manual" | "auto", production only
  dev: { guildId: env.DEV_GUILD_ID, shards: 1 },
  live: { ttl: "14m" },
  autoDefer: { after: 2000 },              // false to disable
  logLevel: "info",
});
```

`allowedMentions` defaults to `{ parse: [] }` through the client options so user input can never ping anyone. A user can change this in `client`.

### Commands

```tsx
export default defineCommand({
  description: "Ban a member",
  permissions: ["BanMembers"],
  guildOnly: true,
  ephemeral: true,
  cooldown: "5s",
  options: {
    user: option.user({ description: "Who to ban", required: true }),
    reason: option.string({ description: "Why", maxLength: 200 }),
    days: option.integer({ description: "Delete history", choices: [{ name: "One", value: 1 }] }),
  },
  async execute(ctx) {
    ctx.options.user;    // User
    ctx.options.reason;  // string | undefined
    ctx.options.days;    // 1 | undefined
    ctx.guild;           // Guild, because guildOnly is true
    return <BanConfirm user={ctx.options.user} />;
  },
});
```

The name comes from the path. Option names come from the object keys. Option helpers: `string`, `integer`, `number`, `boolean`, `user`, `member`, `channel`, `role`, `mentionable`, `attachment`. All take `description`, `required`, `nameLocalizations`, `descriptionLocalizations`. Strings and numbers take `choices` (literal union inference) or `autocomplete(ctx)`, which returns choices. Required options are sorted first when serialised. `defineGroup({ description, permissions, guildOnly, nsfw, ...localizations })` sets metadata on the parent of subcommands.

`defineUserCommand({ name, permissions, guildOnly, execute })` gives `ctx.target: User`, `ctx.targetMember`. `defineMessageCommand({ name, ... })` gives `ctx.target: Message`.

### Interaction routes

The first argument is a string literal equal to the route id. It drives param inference with no code generation. The ESLint rule `route-matches-path` keeps it correct and has an autofix, and the runtime rejects a mismatch.

```tsx
export default defineButton("moderation/confirm-ban/[userId]", {
  respond: "update",                       // "update" (default) | "reply"
  execute(ctx) {
    ctx.params.userId;                     // string
    return <Done />;
  },
});

export default defineSelect("moderation/pick-role", {
  type: "role",                            // string | user | role | channel | mentionable
  execute(ctx) {
    ctx.values;                            // string[]
    ctx.roles;                             // Collection for role and mentionable selects
  },
});

export default defineModal("moderation/ban-reason/[userId]", {
  title: "Ban reason",                     // string | (ctx) => string
  schema: z.object({ reason: z.string().min(3) }),
  render({ params, field }) {
    return (
      <Label label="Reason">
        <TextInput customId={field("reason")} style="paragraph" />
      </Label>
    );
  },
  submit(ctx) {
    ctx.params.userId;
    ctx.values.reason;                     // string, parsed by schema
    return <Done />;
  },
});
```

`schema` is any Standard Schema (zod, valibot, arktype), so `neocord` has no zod dependency. Without a schema, `ctx.values` is `Record<string, string | string[] | boolean>`. Parsing runs after middleware and before the cooldown, so `ctx.values` only exists in `submit`. A failed parse replies ephemerally with the issues and does not call `submit`.

### Context

All interaction contexts share:

```ts
interface InteractionContext<I> {
  interaction: I;
  client: Client<true>;
  app: AppContext;                 // from src/context.ts through RegisteredApp
  logger: Logger;
  feature: string;
  route: string;
  guild: Guild | null;             // non-null when guildOnly
  member: GuildMember | null;      // non-null when guildOnly
  user: User;
  shards: ShardHelpers;
  state: Record<string, unknown>;  // shared along the middleware chain
  reply(node: ReactNode, options?: ReplyOptions): Promise<void>;
  editReply(node: ReactNode, options?: ReplyOptions): Promise<void>;
  followUp(node: ReactNode, options?: ReplyOptions): Promise<void>;
  defer(options?: { ephemeral?: boolean }): Promise<void>;
  deleteReply(): Promise<void>;
  showModal<R extends ModalRoute>(route: R, params: ...): Promise<void>;
}
```

Component contexts add `update(node)`, `deferUpdate()` and `message`. Modal contexts add `update(node)` and `deferUpdate()`, which act on the message a modal was opened from. `ReplyOptions` is `{ ephemeral?: boolean; layout?: boolean }`.

`reply` is state-aware: first call replies, after a defer it edits the deferred reply, after a reply it follows up. Handlers may return a node instead of calling `reply`, which is the idiomatic form. Returning a node from a button or select uses `update` unless `respond: "reply"`. Returning a node from a modal replies unless `respond: "update"`. If a component handler returns nothing and has not acknowledged, the runtime calls `deferUpdate`. If a command returns nothing and has not acknowledged, the runtime logs a warning.

`autoDefer` defers once `after` ms pass without an acknowledgement so slow handlers never hit Discord's three second limit. If that shows a "thinking" placeholder and the route then finishes without answering, the runtime logs a warning and deletes the placeholder.

If `loading.tsx` applies to a command, its UI is sent immediately as the reply and the handler's result replaces it.

`useContext()` returns the current interaction context from any component rendered by the framework.

### Middleware, layouts, errors

```tsx
export default defineMiddleware(async (ctx, next) => {
  if (!allowed(ctx.user)) return <Denied />;
  await next();
});
```

Returning a node short-circuits and replies. `defineMiddleware(handler, { kinds: ["command", "button"] })` narrows it. Middleware does not run for autocomplete, which only checks `guildOnly` and `permissions` and answers a denied user with an empty list. On a live click it runs with the `params` and `options` of the route that opened the session.

Layouts are plain components: `export default function Layout({ children }: LayoutProps) {}`. They wrap nodes that handlers return or send, unless `layout: false`. They do not apply to modals.

Errors are plain components: `export default function ErrorView({ error, ctx }: ErrorProps) {}`, shown ephemerally. A built-in fallback covers everything else, and every error is logged.

`src/context.ts`:

```ts
export default defineContext(async ({ client, logger }) => ({
  value: { db },
  dispose: () => db.close(),
}));
```

Generated types register the return type so `ctx.app.db` is typed.

### Events and tasks

```ts
export default defineEvent("guildMemberAdd", {
  once: false,
  execute(ctx, member) {},
});

export default defineTask({
  every: "5m",            // duration string or milliseconds
  runOnStart: false,
  shard: "first",         // "first" runs on shard 0 only, "all" on every shard
  execute(ctx) {},
});
```

Event contexts have `client`, `app`, `logger`, `feature`, `route`, `shards`, `commands`. Errors in events and tasks are logged and never crash the process.

Every context has `commands`, a sorted list of the enabled slash and context menu commands as `{ kind, name, description, feature, guildOnly, permissions }`. `guildOnly` and `permissions` include what parent groups contribute, so a `/help` command needs no manifest access.

### Features

```ts
export default defineFeature({
  enabled: env.ENABLE_FUN,          // boolean, default true
  intents: ["GuildMessages"],       // merged into config.intents
  partials: [],
});
```

Disabled features contribute no commands, routes, events or tasks.

### Runtime manifest

The CLI generates `.neocord/manifest.ts`, with static imports so the bundler sees every route.

```ts
interface Manifest {
  version: 1;
  context: ModuleNamespace | null;
  features: { name: string; module: ModuleNamespace | null }[];
  groups: { feature: string; segments: string[]; file: string; module: ModuleNamespace }[];
  routes: ManifestRoute[];
}
interface ManifestRoute {
  kind: RouteKind;
  id: string;
  feature: string;
  file: string;
  segments: string[];
  module: ModuleNamespace;
  middleware: { file: string; module: ModuleNamespace }[];
  layouts: { file: string; module: ModuleNamespace }[];
  error: { file: string; module: ModuleNamespace } | null;
  loading: { file: string; module: ModuleNamespace } | null;
}
```

### Sharding

`startManager({ config, shardFile })` wraps discord.js `ShardingManager`, always with discord.js's `respawn: false`. It applies `sharding` config, logs lifecycle events and forwards SIGINT, SIGTERM, SIGHUP and the IPC message `{ neocord: "shutdown" }`. One supervisor owns respawning: a delay that doubles from one second to one minute, reset after a minute of being ready, honouring `sharding.respawn`. During the first spawn, any shard failure aborts startup. After it, a shard reporting a token, intent or config error, or a fatal gateway close code, is not respawned, other failures are retried, and the manager exits 1 when no shards are left. It is the production entry. It never deploys commands, because it has no manifest and must not load route modules: under `deploy.mode: "auto"`, `neocord start` runs the deploy step before launching the manager. `ctx.shards` exposes `id`, `ids`, `count`, `fetchClientValues`, `broadcastEval`, each typed. With no manager, they run against the local client, so handler code is the same in single-process development.

`startBot({ config, manifest })` is the entry for one process: merges intents, builds the client, creates the app context, wires events, interactions and tasks, logs in, and shuts down cleanly on signals and `{ neocord: "shutdown" }`. Shutdown removes the interaction and event listeners, waits for in-flight handlers and tasks, expires live sessions, disposes the context and destroys the client. Signal handlers stay installed until that finishes. A managed shard in process mode also stops when its channel to the manager closes. Both budgets live in `runtime/shutdown-budget.ts`, and the manager's wait exceeds the shard's total.

A `NeocordStartupError` is logged once. It still rejects, so callers can catch it, but an uncaught one exits 1 without a stack trace, including from generated entries that use top-level `await`. Under a manager the shard sends the message to the manager instead of logging it. A fatal gateway close code after login takes the same path, then stops and exits 1.

## `@teamneo/neocord-cli`

| Command | Behaviour |
| --- | --- |
| `neocord dev [--shards n] [--no-deploy]` | Development mode. Generates, bundles, runs, restarts on change, syncs commands to `dev.guildId` when they change. |
| `neocord build` | Production bundle in `.neocord/build`: `shard.js`, `manager.js`, `deploy.js`. |
| `neocord start [--shards n] [--deploy]` | Launches `manager.js` from the production bundle. |
| `neocord deploy [--guild id] [--force] [--dry-run]` | Registers commands with Discord. Skips when the hash in `.neocord/deploy.json` is unchanged. |
| `neocord test [files...] [--watch] [--coverage] [--no-validate] [--validate-only]` | Validates all routes and command payloads, then runs tests with the project's runner. Under vitest, it first fails if a selected test file imports `node:test` or `bun:test`, because vitest would pass those tests without collecting them. |
| `neocord typegen` | Writes `.neocord/manifest.ts` and `.neocord/types.d.ts`. |
| `neocord routes` | Prints the route table. |
| `neocord lint [--fix]` | Runs ESLint. |
| `neocord info` | Prints versions and environment for bug reports. |

Env files load in Next.js order into the child process: `.env`, `.env.<mode>`, `.env.local`, `.env.<mode>.local`, later files overriding earlier ones and the real environment always winning. `.env.local` is skipped in test mode. `neocord start` performs the deploy for `deploy.mode: "auto"` before launching the manager. Bundling uses esbuild with `packages: "external"`, `platform: "node"`, `format: "esm"`. The config is bundled the same way and imported. The runtime is `bun` if `runtime` says so, or if `auto` and the CLI was invoked through bun, otherwise `node`.

`neocord dev` runs the bot with an IPC channel (`stdio: ["inherit", "inherit", "inherit", "ipc"]`). To stop or restart it, the CLI sends `{ neocord: "shutdown" }`, and falls back to `SIGTERM` if the channel is unavailable, unless the signal was SIGINT, which the terminal or console has already delivered to the bot. `GRACEFUL_STOP_TIMEOUT_MS` (20 seconds) in `project/spawn.ts` bounds the wait before a force kill, and must stay longer than the bot's own shutdown budget. A second Ctrl+C force kills at once. `neocord start` has no IPC channel: console Ctrl+C reaches the manager directly on Windows, and `forwardSignals` waits the same timeout before terminating it.

`neocord build` records its start time and esbuild's metafile inputs in `.neocord/build/inputs.json`, leaving out `node_modules`. A build is stale when a recorded input changed or is gone, or when the source folder, the features folder, the config or `tsconfig.json` changed since then. If the file is missing or invalid, those four are compared against the artifact's time instead. `neocord deploy` rebuilds a stale build. `neocord start` only warns and still starts, because file times often differ after a checkout or deploy.

## `@teamneo/neocord-eslint-plugin`

Flat config only, with `configs.recommended` and `configs.strict`. Rules read the AST only, so they do not need type information and work with any parser. See the docs site for the full rule list.

## `create-neocord`

Modelled on create-t3-app: a `template/base` plus `template/extras/*` copied by per-option installers, with versions from one dependency map. Options are project name, database (`none`, `drizzle`, `prisma`), dialect (`sqlite`, `postgres`, `mysql`), ESLint, package manager, git init and dependency install. All can be given as flags, and `--yes` accepts defaults. Environment parsing with `@t3-oss/env-core` and zod is always included.

## Quality bar

- `bun run build`, `typecheck`, `test`, `lint` and `check:packages` pass from the root.
- No `any` in public types.
- Packed tarballs work in a freshly scaffolded project.
