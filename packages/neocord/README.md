# neocord

A file-routed framework for Discord bots, built on discord.js and React. You write commands, buttons, selects, modals, events and tasks as files, return JSX from handlers, and neocord handles dispatch, replies, deploys and sharding.

```sh
bun create neocord
```

Requires discord.js 14.28 or later, React 19.3 or later, and Node 22.12 or later or Bun.

## Commands

```tsx
import { TextDisplay } from "@neocord/react";
import { defineCommand, option } from "neocord";

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
    return <TextDisplay>Banned {ctx.options.user.username}</TextDisplay>;
  },
});
```

Option helpers are `string`, `integer`, `number`, `boolean`, `user`, `member`, `channel`, `role`, `mentionable` and `attachment`. Strings and numbers take `choices`, which infer a literal union without `as const`, or `autocomplete(ctx)`. `channelTypes` narrows the channel type.

A required `member` option replies with a notice if the user has left the server, since Discord can only guarantee the user.

## Interaction routes

The first argument is the route id. Params come from that literal, with no code generation.

```tsx
export default defineButton("moderation/confirm-ban/[userId]", {
  respond: "update",
  execute: (ctx) => <Done id={ctx.params.userId} />,
});

export default defineSelect("moderation/pick-role", {
  type: "role",
  execute: (ctx) => <Picked count={ctx.roles.size} />,
});

export default defineModal("moderation/ban-reason/[userId]", {
  title: "Ban reason",
  schema: z.object({ reason: z.string().min(3) }),
  render: ({ field }) => (
    <Label label="Reason">
      <TextInput customId={field("reason")} style="paragraph" />
    </Label>
  ),
  submit: (ctx) => <Done reason={ctx.values.reason} />,
});
```

`schema` is any [Standard Schema](https://standardschema.dev). `field` only accepts its keys. A failed parse replies ephemerally with the issues and skips `submit`.

Without a schema, `ctx.values` is `Record<string, string | string[] | boolean>`:

| Component | Value |
| --- | --- |
| `TextInput` | `string`, omitted when left blank |
| Selects, `CheckboxGroup` | `string[]` |
| `FileUpload` | `string[]` of attachment ids. Read the files with `ctx.fields.getUploadedFiles(name)`. |
| `RadioGroup` | `string`, omitted when nothing is chosen |
| `Checkbox` | `boolean` |

## Replying

Return a node, which is the idiomatic form, or call the context.

| Call | Behaviour |
| --- | --- |
| `ctx.reply(node, options)` | Replies first, edits after a defer, follows up after that. |
| `ctx.editReply(node)` | Edits the reply. |
| `ctx.followUp(node)` | Sends another message. |
| `ctx.update(node)` | Components, and modals opened from a component. Updates the message. |
| `ctx.defer()` / `ctx.deferUpdate()` | Acknowledges now, and is a no-op if already acknowledged. |
| `ctx.deleteReply()` | Deletes the reply. |
| `ctx.showModal(route, params)` | Must be the first response. `params` is required exactly when the route has params. |

A node returned from a button or select updates the message unless `respond: "reply"` is set. A modal opened from a component can do the same with `respond: "update"`. `ctx.commands` lists the commands the bot registers, which is useful for a `/help` command. If a component handler returns nothing and has not acknowledged, neocord defers the update. If a modal does, it acknowledges silently. If a command does, neocord logs a warning.

`ReplyOptions` is `{ ephemeral?, layout? }`. An explicit `ephemeral` wins, then the route's `ephemeral` or `<Message ephemeral>`. After a public defer, an ephemeral reply deletes the deferral and follows up, because Discord fixes visibility at the first acknowledgement.

All replies go through one state machine, so the `autoDefer` timer cannot race a reply in flight. Codes 40060 and 10062 are logged and never crash a handler, and the ephemeral flag is removed from edits and updates.

`useContext()` returns the current context from any component rendered by neocord.

## Middleware, layouts, errors, loading

```tsx
export default defineMiddleware(
  async (ctx, next) => {
    if (!allowed(ctx.user)) return <Denied />;
    ctx.state.checked = true;
    await next();
  },
  { kinds: ["command", "button"] },
);
```

- Middleware runs root to leaf, and `ctx` narrows to `kinds`. A returned node short-circuits and replies. `next()` throws if called twice. Autocomplete does not run middleware, but it does check `guildOnly` and `permissions`, and answers a denied user with an empty list. A modal's `schema` runs after middleware, so `ctx.values` only exists in `submit`.
- Layouts are plain components that wrap every node handlers return or send, unless `layout: false`. They do not apply to modals or error views. A returned `<Message>` stays at the root with layouts inside it.
- `error.tsx` receives `{ error, ctx }` and is shown ephemerally. The closest one wins, and a built-in message covers the rest. Every error is logged.
- `loading.tsx` applies to commands. Its UI is sent immediately and the handler's result replaces it. `showModal` cannot follow it, because a modal must be the first response.

`guildOnly` and `permissions` deploy to Discord and are also enforced at runtime. Discord only stores them on top-level commands, so on a subcommand they are runtime only, and `validateManifest` warns about it. Set them with `defineGroup` to deploy them. `cooldown` is per user and route, in memory, and middleware denials do not consume it.

## Live components

Every click re-checks the `guildOnly` and `permissions` of the route that opened the session, and runs its middleware with `ctx.kind` set to `"button"` or `"select"`. `cooldown` does not apply to clicks. Past those checks, anyone who can see the message can click, so compare `event.user.id` when only the original user should be able to.

`onClick` and `onSelect` keep a component mounted, with `useState` and effects working as normal.

```tsx
function Counter() {
  const [count, setCount] = useState(0);
  return (
    <>
      <TextDisplay>Count: {count}</TextDisplay>
      <ActionRow>
        <Button label="Add" onClick={() => setCount(count + 1)} />
      </ActionRow>
    </>
  );
}
```

- The handler receives the discord.js interaction. If it does not acknowledge, neocord updates the message. State changes outside a click edit the message.
- `live.ttl`, default `14m`, is an idle timeout, and each click extends it. When it passes, components are disabled and the tree unmounts.
- Sessions live in memory per process. After a restart, clicking an old button shows an ephemeral "This message has expired" notice and removes its components.
- Anyone who can see the message can click. Check `interaction.user.id` if that matters.

## Events, tasks, features, context

```ts
export default defineEvent("guildMemberAdd", {
  execute(ctx, member) {},
});

export default defineTask({
  every: "5m",
  runOnStart: false,
  shard: "first",
  execute(ctx) {},
});

export default defineFeature({ enabled: env.ENABLE_FUN, intents: ["GuildMessages"] });

export default defineContext(async ({ client, logger }) => ({
  value: { db },
  dispose: () => db.close(),
}));
```

Event and task errors are logged and never crash the process. Tasks skip overlapping runs and start on `clientReady`, and `shard` defaults to `"first"`. Disabled features contribute no commands, routes, events, tasks or intents. Generated types make `ctx.app.db` typed.

`parseDuration` accepts `"500ms"`, `"5m"`, `"1h30m"` or a number of milliseconds.

## Runtime

`neocord/runtime` is what the CLI generates code against.

```ts
startBot({ config, manifest }): Promise<Bot>
startManager({ config, shardFile, shards }): Promise<ShardingManager>
serializeCommands(manifest)
validateManifest(manifest, config): ManifestIssue[]
deployCommands({ config, manifest, guildId, force, dryRun, stateFile }): Promise<DeployResult>
```

`startManager` never deploys commands, because it has no manifest and must not load route modules. Under `deploy.mode: "auto"`, `neocord start` runs the deploy step before launching the manager.

The shard count comes from the `shards` argument, then `NEOCORD_SHARD_COUNT`, then `sharding.totalShards`. Startup failures are `NeocordStartupError`s with an actionable message. If a shard hits a fatal login error, the manager stops respawning, so a bad token cannot loop against Discord's login endpoint.

`process` and `worker` sharding modes both run on Bun and on Node.

`ctx.shards` exposes `id`, `ids`, `count`, `fetchClientValues` and `broadcastEval`. With no manager they run against the local client, and results are JSON-serialised the same way, so handler code does not change.

Logs go through a small built-in logger. `NEOCORD_LOG_LEVEL` overrides `config.logLevel`, shard ids are prefixed, and tokens are redacted.

## Testing

`neocord/testing` runs the real dispatch pipeline on fake interactions, with no gateway.

```tsx
import { mockMember, runButton, runCommand } from "neocord/testing";

const { replies, text, ephemeral, error } = await runCommand(command, {
  options: { message: "hello" },
  member: mockMember({ permissions: ["BanMembers"] }),
  layouts: [Layout],
  middleware: [auth],
});

await runButton(button, { params: { userId: "1" } });
```

| Helper | Purpose |
| --- | --- |
| `runCommand`, `runUserCommand`, `runMessageCommand` | Run a command. |
| `runButton`, `runSelect`, `runModal` | Run a component or modal, by `params` or `customId`. |
| `runAutocomplete` | Run an option's `autocomplete` and read its choices. |
| `live: true` option | Keeps a live session open on the result, so a test can call `live.click()` and `live.select()`. |
| `commands` option | Sets what `ctx.commands` returns. |
| `runEvent(definition, args)`, `runTask(definition)` | Run one, resolving to `{ error }`. |
| `renderModalOf(definition, { params })` | Render a modal to its payload. |
| `mockUser`, `mockMember`, `mockGuild`, `mockChannel`, `mockRole`, `mockMessage` | `mockMessage` is a stub. The others are real discord.js structures, so `member.permissions` and similar work. |

`TestResult` has `replies`, `updates`, `followUps`, `edits`, `modal`, `deferred`, `deferredUpdate`, `ephemeral`, `error` and `text`, which flattens all text. `guildOnly` and `permissions` get a passing guild and member by default, so pass `guild: null` or an explicit `member` to test rejection.

## License

MIT
