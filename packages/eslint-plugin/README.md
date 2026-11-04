# @neocord/eslint-plugin

ESLint rules for [neocord](https://neocord.dev) projects. They check what each routed file has to export, catch Discord limits before you deploy, and give best practice advice.

All rules read the AST only, so they need no type information and work with any parser. The plugin supports flat config only, on ESLint 9 and 10.

## Setup

```sh
bun add -d eslint @neocord/eslint-plugin @typescript-eslint/parser
```

Then create `eslint.config.js`:

```js
import neocord from "@neocord/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  { ignores: [".neocord/**", "dist/**"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  },
  neocord.configs.recommended,
];
```

The configs do not set a parser, so add `@typescript-eslint/parser` yourself as shown.

## Configs

| Config | Behaviour |
| --- | --- |
| `neocord.configs.recommended` | File contracts and correctness rules are errors, advice rules are warnings, and `require-error-boundary` is off. |
| `neocord.configs.strict` | Every rule is an error, including `require-error-boundary`. |

To change one rule, add it after the config:

```js
export default [
  neocord.configs.recommended,
  { rules: { "@neocord/no-process-env": "off" } },
];
```

## Settings

Paths are computed from the directory ESLint runs in (`context.cwd`). If your source lives elsewhere, set the same values you use in `defineConfig`:

```js
export default [
  neocord.configs.recommended,
  { settings: { neocord: { sourceDir: "src", featuresDir: "src/features" } } },
];
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `sourceDir` | `"src"` | Source folder, relative to the ESLint working directory. |
| `featuresDir` | `"<sourceDir>/features"` | Features folder, relative to the ESLint working directory. |

In a monorepo where ESLint runs from the repository root, include the project folder, such as `sourceDir: "apps/bot/src"`. Otherwise files are treated as outside the project and the path-based rules do nothing.

## Rules

Severity columns show `recommended` / `strict`. Rules marked with a wrench have an autofix, and rules marked with a bulb offer editor suggestions.

### File contracts

| Rule | Severity | | Description |
| --- | --- | --- | --- |
| [`require-default-export`](https://neocord.dev/docs/eslint/require-default-export) | error / error | | Route, group, feature, context and middleware files need a default export. Layout, error and loading files must default-export a function component. |
| [`require-define-helper`](https://neocord.dev/docs/eslint/require-define-helper) | error / error | | The default export must be a call to the matching helper, such as `defineCommand` in `commands` and `defineUserCommand` in `user-commands`. |
| [`route-matches-path`](https://neocord.dev/docs/eslint/route-matches-path) | error / error | wrench, bulb | The first argument of `defineButton`, `defineSelect`, `defineModal` and `defineEvent` must be a literal equal to the id from the path. |
| [`no-extra-exports`](https://neocord.dev/docs/eslint/no-extra-exports) | error / error | | Routed files export only the default. Type exports are fine. |
| [`no-unknown-route-file`](https://neocord.dev/docs/eslint/no-unknown-route-file) | error / error | | Reports files in the features folder that neocord cannot classify, and why. |
| [`valid-command-name`](https://neocord.dev/docs/eslint/valid-command-name) | error / error | | Folders under `commands` must be valid lowercase Discord names, at most three levels deep. |
| [`no-command-with-subcommands`](https://neocord.dev/docs/eslint/no-command-with-subcommands) | error / error | | A folder with a `command` file cannot also hold nested commands. |
| [`require-group-file`](https://neocord.dev/docs/eslint/require-group-file) | warn / error | | Nested commands need a `group.ts` in their root command folder, for the description. |
| [`valid-event-name`](https://neocord.dev/docs/eslint/valid-event-name) | error / error | bulb | `defineEvent` must name a real discord.js client event, and the closest name is suggested. |
| [`valid-command-definition`](https://neocord.dev/docs/eslint/valid-command-definition) | error / error | | Checks required properties, description lengths, option names, option descriptions and the option count. |
| [`valid-modal-definition`](https://neocord.dev/docs/eslint/valid-modal-definition) | error / error | | `defineModal` needs a literal or function `title` of at most 45 characters, plus `render` and `submit`. |

### UI

| Rule | Severity | | Description |
| --- | --- | --- | --- |
| [`no-embed-builders`](https://neocord.dev/docs/eslint/no-embed-builders) | warn / error | | Forbids discord.js builders and raw `embeds` or `components` in send calls. Use `@neocord/react`. |
| [`valid-component-nesting`](https://neocord.dev/docs/eslint/valid-component-nesting) | error / error | | Checks the static JSX structure of `@neocord/react` components, including aliased imports. Custom components and expressions are skipped. |
| [`prefer-route-prop`](https://neocord.dev/docs/eslint/prefer-route-prop) | warn / error | | Recommends `route` over a literal `customId` on buttons and selects. Modal fields are exempt. |
| [`no-text-in-action-row`](https://neocord.dev/docs/eslint/no-text-in-action-row) | error / error | | Forbids text directly inside `ActionRow`, `MediaGallery` and selects. |

### Best practices

| Rule | Severity | | Description |
| --- | --- | --- | --- |
| [`no-direct-interaction-reply`](https://neocord.dev/docs/eslint/no-direct-interaction-reply) | warn / error | | Forbids `ctx.interaction.reply` and friends. Use `ctx.reply` or return JSX. |
| [`no-client-instantiation`](https://neocord.dev/docs/eslint/no-client-instantiation) | error / error | | Forbids creating a discord.js `Client` or `ShardingManager`, or calling `.login()` on a client, in project source. |
| [`no-process-env`](https://neocord.dev/docs/eslint/no-process-env) | warn / error | | Forbids `process.env` outside `src/env.ts` and `neocord.config.*`. |
| [`no-hardcoded-token`](https://neocord.dev/docs/eslint/no-hardcoded-token) | error / error | | Forbids strings shaped like Discord tokens. |
| [`no-blocking-calls`](https://neocord.dev/docs/eslint/no-blocking-calls) | warn / error | | Forbids `*Sync` calls from `fs` and `child_process`, and `Atomics.wait`, in route files. |
| [`prefer-guild-only`](https://neocord.dev/docs/eslint/prefer-guild-only) | warn / error | bulb | Recommends `guildOnly: true` over `ctx.guild!` and `ctx.member!`. |
| [`no-unawaited-context-calls`](https://neocord.dev/docs/eslint/no-unawaited-context-calls) | warn / error | bulb | Requires `ctx.reply` and similar calls to be awaited, returned or voided. |
| [`require-error-boundary`](https://neocord.dev/docs/eslint/require-error-boundary) | off / error | | Each feature should have its own `error.tsx`. It is reported once per feature, on `feature.ts` or the feature's first file. |
| [`no-mass-mentions`](https://neocord.dev/docs/eslint/no-mass-mentions) | warn / error | | Forbids `everyone` in a literal `allowedMentions.parse`, and literal `@everyone` or `@here` in JSX text. |

## Types

The package exports `NeocordPlugin`, `NeocordRuleName`, `NeocordSeverity`, `NeocordConfigName` and `NeocordSettings`.

## License

MIT
