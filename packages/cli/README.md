# @teamneo/neocord-cli

The `neocord` command. It scans your file routes, generates code and types, bundles the bot, and runs it.

```bash
bun add -d @teamneo/neocord-cli
```

## Commands

| Command | What it does |
| --- | --- |
| `neocord dev [--shards n] [--no-deploy]` | Generates, bundles and runs the bot, restarts on change, and syncs commands to `dev.guildId` when they change. |
| `neocord build [--no-validate] [--typecheck]` | Writes the production bundle to `.neocord/build`: `shard.js`, `manager.js` and `deploy.js`. |
| `neocord start [--shards n] [--deploy]` | Launches `manager.js` from the production bundle. Warns if project files changed after the build, and starts anyway. |
| `neocord deploy [--guild id] [--force] [--dry-run] [--clear]` | Registers commands with Discord, skipping when the hash in `.neocord/deploy.json` is unchanged. `--clear` removes every command from the guild or global scope. Builds first if the bundle is missing or out of date, including bundled files outside the source folder. |
| `neocord test [files...] [--watch] [--coverage] [--no-validate] [--validate-only]` | Validates all routes and command payloads, then runs tests with vitest if it is a project dependency, otherwise `bun test`. Under vitest, fails first if a test file imports `node:test` or `bun:test`, because vitest would not collect it. |
| `neocord typegen` | Writes `.neocord/manifest.ts`, `.neocord/types.d.ts` and the entry files. |
| `neocord routes [--json]` | Prints the route table. |
| `neocord lint [--fix]` | Runs the project's ESLint. |
| `neocord info` | Prints versions and environment for bug reports. Prints only whether `DISCORD_TOKEN` is set, never its value. |

Every command accepts `--cwd <dir>`. The project root is that directory or the nearest parent containing `neocord.config.{ts,mts,js,mjs}`.

## Environment

Env files load in this order, with later files overriding earlier ones and the real environment always winning:

1. `.env`
2. `.env.<mode>`
3. `.env.local`, skipped in test mode so tests stay reproducible
4. `.env.<mode>.local`

The mode is `development` for `dev`, `production` for `build`, `start` and `deploy`, and `test` for `test`. `NODE_ENV` is set to match.

`typegen`, `routes`, `build`, `info`, `lint`, `test` and `deploy --dry-run` set `SKIP_ENV_VALIDATION=true` unless you already set it, so they work in a fresh clone with no secrets. `dev`, `start` and a real `deploy` never set it, and report invalid variables as a readable error.

## Runtime

The bot runs on the runtime named by `runtime` in `neocord.config`. With `auto`, that is bun if the CLI was invoked through bun, otherwise node.

## Programmatic API

```ts
import { generate, loadConfig, loadEnvFiles, scanProject } from "@teamneo/neocord-cli";

const { config, file } = await loadConfig({ root });
const scan = await scanProject({ root, sourceDir: config.sourceDir, featuresDir: config.featuresDir });
await generate(scan, { configFile: file });
```

## License

MIT
