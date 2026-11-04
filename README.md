# neocord

A file-routed framework for Discord bots, built on [discord.js](https://discord.js.org) and React. It works like Next.js: folders become commands and interactions, and messages are React components.

```tsx
// src/features/moderation/commands/ban/command.tsx  ->  /ban
import { ActionRow, Button, Container, Heading } from "@neocord/react";
import { defineCommand, option } from "neocord";

export default defineCommand({
  description: "Ban a member",
  permissions: ["BanMembers"],
  guildOnly: true,
  options: {
    user: option.user({ description: "Who to ban", required: true }),
  },
  execute({ options }) {
    return (
      <Container accentColor="red">
        <Heading>Ban {options.user.username}?</Heading>
        <ActionRow>
          <Button style="danger" route="moderation/confirm-ban/[userId]" params={{ userId: options.user.id }}>
            Confirm
          </Button>
        </ActionRow>
      </Container>
    );
  },
});
```

## Features

- **File-based routing** for slash commands, subcommands, context menus, buttons, selects, modals, events and scheduled tasks, including `[param]` and `[...catchAll]` routes.
- **Feature folders.** Create `moderation` and `fun`, and each one holds its own handlers.
- **React for all UI.** No embeds or builders. Hooks, context and Suspense all work, and `onClick` with `useState` updates the message.
- **Type safety throughout.** Option types, route params, modal values and the `route` prop on buttons are all inferred or generated.
- **ESLint rules** that define what each file must export, and give Discord best-practice advice.
- **Built-in sharding** through discord.js, with the same handler code in development and production.
- **Scaffolding** with optional Drizzle or Prisma, and validated environment variables through T3 Env and zod.
- **A `neocord` CLI** with `dev`, `build`, `start`, `deploy`, `test` and more.

## Get started

```bash
bun create neocord my-bot
```

To set up a project by hand, follow the manual setup guide in the [documentation](./apps/docs).

## Packages

| Package | Description |
| --- | --- |
| [`neocord`](./packages/neocord) | The framework: `define*` helpers, runtime, sharding, testing |
| [`@neocord/react`](./packages/react) | React renderer for Discord messages and modals |
| [`@neocord/cli`](./packages/cli) | The `neocord` command |
| [`@neocord/eslint-plugin`](./packages/eslint-plugin) | File contract and best-practice rules |
| [`create-neocord`](./packages/create-neocord) | Project scaffolder |
| [`@neocord/routing`](./packages/routing) | Shared routing conventions |

The [example bot](./example) uses every feature, and [`apps/docs`](./apps/docs) is the documentation site.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) and [ARCHITECTURE.md](./ARCHITECTURE.md).

## License

[MIT](./LICENSE)
