# neocord example

A working Discord bot that doubles as the reference for how neocord is meant to be used. It has real persistence, three features, and a test for every kind of route.

## Running it

From the repository root, install and build the framework:

```sh
bun install
bun run build
```

Then, from `example/`:

```sh
cp .env.example .env
```

Fill in `DISCORD_TOKEN`, and set `DEV_GUILD_ID` to a server you can test in so commands sync instantly. The moderation feature asks for the `GuildMembers` privileged intent, so enable **Server Members Intent** for your bot in the [Developer Portal](https://discord.com/developers/applications).

| Script | What it does |
| --- | --- |
| `bun run dev` | Generates types, runs the bot, restarts on change and syncs commands to `DEV_GUILD_ID`. |
| `bun run build` | Writes the production bundle to `.neocord/build`. |
| `bun run start` | Runs the production bundle through the sharding manager. |
| `bun run deploy` | Registers commands globally. Add `--dry-run` to print the tree without a token. |
| `bun run test` | Validates every route, then runs the tests. Needs no token. |
| `bun run typecheck` | Generates route types, then type checks. |
| `bun run routes` | Prints the route table. |
| `bun run lint` | Runs ESLint with `neocord.configs.strict`. |
| `bun run db:generate` | Creates a migration in `drizzle/` after you change `src/db/schema.ts`. |

A fresh checkout works without a database step, because `src/context.ts` applies the migrations in `drizzle/` on startup. Run the bot from this folder, since the migrations are found relative to the working directory.

Set `ENABLE_FUN=false` to turn the whole fun feature off.

## Tour

### Project files

| File | Demonstrates |
| --- | --- |
| `neocord.config.ts` | `defineConfig` with intents, token, dev guild, sharding, live TTL and auto defer. |
| `src/env.ts` | `@t3-oss/env-core` with zod, including a parsed boolean and a default. |
| `src/context.ts` | `defineContext` with a dispose function. `ctx.app.db` is typed by generated types. |
| `src/db/` | A Drizzle schema, and a libSQL client on a local SQLite file. |
| `src/middleware.ts` | Logging middleware that applies to every interaction and wraps `next()`. |
| `src/layout.tsx` | A root layout that uses `useContext()` to add a footer. |
| `src/error.tsx` | The fallback error view. |

There is no `src/loading.tsx`, because a root loading view would apply to every command and `showModal` must be the first response. `/poll` and the `Warn user` menu both open modals, so loading lives next to `/joke` instead.

### `src/features/moderation`

| File | Demonstrates |
| --- | --- |
| `feature.ts` | Merging `GuildMembers` and `GuildModeration` into the configured intents. |
| `middleware.tsx` | Short-circuiting by returning JSX, narrowing with `kinds`, and writing `ctx.state` for the root middleware to read. It skips message commands so anyone can report. |
| `layout.tsx` | Composing with the root layout. Everything here renders in a red container. |
| `error.tsx` | A closer error view that wins over the root one and receives `{ error, ctx }`. |
| `commands/ban` | `guildOnly`, `permissions`, `cooldown`, options, and `<Message ephemeral={...}>` chosen at runtime. |
| `buttons/ban/confirm/[userId]` | A dynamic route param, and `ctx.showModal` with typed params. |
| `buttons/ban/cancel` | Returning a node to update the message. |
| `modals/ban-reason/[userId]` | A zod schema, `field()`, `RadioGroup`, `respond: "update"` to replace the confirmation, and rolling back a stored case if the ban fails. |
| `modals/warn-reason/[userId]` | The modal behind the `Warn user` context menu. |
| `commands/mod/group.ts` | Deploying `guildOnly` and `permissions` for every subcommand of `/mod`. |
| `commands/mod/warn` | A subcommand, `/mod warn`. Setting `guildOnly` here narrows `ctx.guild` to non-null. |
| `commands/mod/case/group.ts`, `case/view` | A subcommand group, `/mod case view`, with a string option whose choices infer a literal union. |
| `selects/case-filter` | A string select addressed with `route`. |
| `user-commands/warn-user` | A user context menu. |
| `message-commands/report-message` | A message context menu. |
| `events/guildBanAdd.ts`, `events/guildMemberAdd.ts` | Events with typed arguments and access to `ctx.app`. |
| `tasks/expire-warnings.ts` | A scheduled task with `runOnStart` that only runs on the first shard. |
| `_components/`, `_lib/` | Private folders for shared views and database queries. |

### `src/features/fun`

| File | Demonstrates |
| --- | --- |
| `feature.ts` | `enabled: env.ENABLE_FUN`. A disabled feature contributes nothing. |
| `commands/roll` | Integer choices that infer `4 \| 6 \| 20`, used to index a typed record. |
| `commands/joke` | Async work, with a colocated `loading.tsx` that is replaced by the result. |
| `commands/poll`, `modals/poll` | A modal that starts a live session, with zod transforming the input, `useContext()` to find the author, and a handler that replies on its own. |
| `commands/counter` | `useState` and inline `onClick` handlers, plus `useLiveInteraction()`. |
| `commands/quiz` | An `autocomplete` option, and a live `onSelect`. |
| `commands/8ball`, `buttons/8ball/[...question]` | A catch-all route param that round trips an array through the custom id, kept within Discord's 100 character limit. |
| `commands/role-picker`, `selects/role-picker` | A role select with `respond: "reply"`, which refuses roles that carry permissions. |

### `src/features/utility`

| File | Demonstrates |
| --- | --- |
| `commands/(info)/` | A route group that organises files without changing command names. |
| `commands/(info)/ping` | The smallest possible command. |
| `commands/(info)/about` | `<Suspense>` and `use()` with a database query. |
| `commands/(info)/stats` | `ctx.shards.fetchClientValues` and a typed `broadcastEval`. Both run locally when there is no manager. |
| `commands/(info)/help` | `ctx.commands`, filtered by what the member can use. |
| `commands/card` | Buffers passed to `Thumbnail`, `MediaItem` and `File`, which become attachments automatically. |
| `events/clientReady.ts` | A `once` event that logs shard information. |

## Tests

Tests sit beside the code in `src/root.test.tsx` and one `<feature>.test.tsx` per feature. They use `neocord/testing`, which runs the real dispatch pipeline on fake interactions with no gateway, so no token is needed. The database is a real in-memory libSQL database with the real migrations applied, passed in through the `app` option.

| Kind | Example |
| --- | --- |
| Command, button, select | `runCommand`, `runButton`, `runSelect` in `moderation.test.tsx` |
| Modal success and failure | `runModal` in the `ban reason modal` block |
| Event, task | `runEvent`, `runTask` |
| Middleware short-circuit | the `moderation middleware` block |
| Layout | the `moderation layout` block |
| Error boundary | a rejected ban with the `error` option |
| Autocomplete | `runAutocomplete` for `/quiz` |
| Live sessions | the `live: true` option, then `live.click()` and `live.select()`, for `/counter`, `/poll` and `/quiz` |

Calls that would reach Discord, such as `guild.bans.create`, are replaced with `spyOn` on the discord.js manager prototype.
