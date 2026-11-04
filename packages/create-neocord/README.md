# create-neocord

Scaffold a type-safe [neocord](https://www.npmjs.com/package/neocord) Discord bot.

```sh
bun create neocord my-bot
```

```sh
bunx create-neocord my-bot
npm create neocord@latest my-bot
```

Run it without arguments to answer a few prompts, or pass everything as flags.

## Options

| Flag | Values | Default with `--yes` |
| --- | --- | --- |
| `[dir]` | A path, or `.` for the current directory. `@scope/name` creates `name` and keeps the scope in `package.json`. | `my-neocord-bot` |
| `--db <orm>` | `none`, `drizzle`, `prisma` | `none` |
| `--dialect <dialect>` | `sqlite`, `postgres`, `mysql` | `sqlite` when a database is chosen |
| `--eslint`, `--no-eslint` | Add ESLint with the neocord rules. | on |
| `--git`, `--no-git` | Initialize a repository and make the first commit. | on |
| `--install`, `--no-install` | Install dependencies. | on |
| `--pm <manager>` | `bun`, `npm`, `pnpm`, `yarn` | Detected from how the command was launched, otherwise `bun` |
| `-y`, `--yes` | Accept defaults and never prompt. | |
| `--force` | Allow a non-empty directory. Files with the same name are overwritten and other files are kept. | off |
| `-h`, `--help` | Show help. | |
| `-v`, `--version` | Print the version. | |

With npm, separate flags from the command with `--`:

```sh
npm create neocord@latest my-bot -- --db prisma --dialect postgres
```

## Non-interactive use

Without a TTY, or with `--yes`, `create-neocord` never prompts. It exits with a non-zero code and a clear message when a value is invalid, when the directory is not empty and `--force` is missing, or when installing dependencies fails.

```sh
bunx create-neocord my-bot --yes --db drizzle --dialect sqlite --no-git
```

## What you get

- A neocord project with a starter feature: `/ping`, `/about` with a button, a `clientReady` event, an error view and a test.
- Environment validation with [T3 Env](https://env.t3.gg) in `src/env.ts`.
- A strict `tsconfig.json`, and native TypeScript 7 running side by side with TypeScript 6 when ESLint needs it.
- A `Dockerfile` for a production image based on Bun.
- With `--db`, a database client in `src/db`, a `src/context.ts` that exposes it as `ctx.app.db`, `db:push`, `db:generate`, `db:migrate` and `db:studio` scripts, and a `/remember` command that stores a note per user.

| Database | SQLite | PostgreSQL | MySQL |
| --- | --- | --- | --- |
| Drizzle | `@libsql/client` | `postgres` | `mysql2` |
| Prisma | `@prisma/adapter-libsql` | `@prisma/adapter-pg` | `@prisma/adapter-mariadb` |

SQLite uses libsql in both cases, so no native builds are needed and the project runs on Bun and Node.

## Skipping environment validation

Set `SKIP_ENV_VALIDATION=true` for steps that load `src/env.ts` without real secrets, such as a Docker image build or CI. The generated `Dockerfile` already does this for its build step.

## License

MIT
