# @neocord/cli

The `neocord` command. It scans your file routes, generates code and types, bundles the bot, and runs it.

```bash
bun add -d @neocord/cli
```

## Commands

| Command | What it does |
| --- | --- |
| `neocord dev [--shards n] [--no-deploy]` | Generates, bundles and runs the bot, restarts on change, and syncs commands to `dev.guildId` when they change. |
| `neocord build [--no-validate] [--typecheck]` | Writes the production bundle to `.neocord/build`: `shard.js`, `manager.js` and `deploy.js`. |
| `neocord start [--shards n] [--deploy]` | Launches `manager.js` from the production bundle. |
| `neocord deploy [--guild id] [--force] [--dry-run]` | Registers commands with Discord, skipping when the hash in `.neocord/deploy.json` is unchanged. Builds first if the bundle is missing or older than the source. |
| `neocord test [files...] [--watch] [--coverage] [--no-validate] [--validate-only]` | Validates all routes and command payloads, then runs tests with vitest if it is a project dependency, otherwise `bun test`. |
| `neocord typegen` | Writes `.neocord/manifest.ts`, `.neocord/types.d.ts` and the entry files. |
| `neocord routes [--json]` | Prints the route table. |
| `neocord lint [--fix]` | Runs the project's ESLint. |
| `neocord info` | Prints versions and environment for bug reports. Prints only whether `DISCORD_TOKEN` is set, never its value. |

Every command accepts `--cwd <dir>`. The project root is that directory or the nearest parent containing `neocord.config.{ts,mts,js,mjs}`.

## Environment

Env files load in this order, with later files overriding earlier ones and the real environment always winning:

1. `.env`
2. `.env.local`
3. `.env.<mode>`
4. `.env.<mode>.local`

The mode is `development` for `dev`, `production` for `build`, `start` and `deploy`, and `test` for `test`. `NODE_ENV` is set to match.

`typegen`, `routes`, `build`, `info`, `lint`, `test` and `deploy --dry-run` set `SKIP_ENV_VALIDATION=true` unless you already set it, so they work in a fresh clone with no secrets. `dev`, `start` and a real `deploy` never set it, and report invalid variables as a readable error.

## Runtime

The bot runs on the runtime named by `runtime` in `neocord.config`. With `auto`, that is bun if the CLI was invoked through bun, otherwise node.

## Programmatic API

```ts
import { generate, loadConfig, loadEnvFiles, scanProject } from "@neocord/cli";

const { config, file } = await loadConfig({ root });
const scan = await scanProject({ root, sourceDir: config.sourceDir, featuresDir: config.featuresDir });
await generate(scan, { configFile: file });
```

## License

MIT
