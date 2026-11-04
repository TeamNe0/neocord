import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import tsParser from "@typescript-eslint/parser";
import { ESLint, Linter } from "eslint";
import plugin, { rules, type NeocordPlugin, type NeocordRuleName } from "./index.ts";
import { DOCS_BASE_URL } from "./utils/rule.ts";

const language = {
  files: ["**/*.{ts,tsx}"],
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
} satisfies Linter.Config;

const ruleNames = Object.keys(rules) as NeocordRuleName[];

const fixtures: string[] = [];

function createProject(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "neocord-eslint-e2e-"));
  fixtures.push(root);
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

afterAll(() => {
  for (const fixture of fixtures) rmSync(fixture, { recursive: true, force: true });
});

describe("plugin surface", () => {
  test("exposes meta from package.json", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8"));
    expect(plugin.meta.name).toBe(manifest.name);
    expect(plugin.meta.version).toBe(manifest.version);
  });

  test("registers all 24 rules with docs and schemas", () => {
    expect(ruleNames).toHaveLength(24);
    for (const name of ruleNames) {
      const meta = plugin.rules[name].meta;
      expect(meta?.docs?.url).toBe(`${DOCS_BASE_URL}/${name}`);
      expect(meta?.docs?.description).toBeTruthy();
      expect(meta?.schema).toEqual([]);
      expect(meta?.messages).toBeTruthy();
    }
  });

  test("configs reference the plugin and every rule", () => {
    const configs: NeocordPlugin["configs"] = plugin.configs;
    for (const config of [configs.recommended, configs.strict]) {
      expect(config.plugins?.["@neocord"]).toBe(plugin);
      expect(config.languageOptions).toBeUndefined();
      expect(Object.keys(config.rules ?? {}).toSorted()).toEqual(ruleNames.map((name) => `@neocord/${name}`).toSorted());
    }
  });

  test("recommended uses errors, warnings and one off rule", () => {
    const severities = plugin.configs.recommended.rules ?? {};
    expect(severities["@neocord/require-default-export"]).toBe("error");
    expect(severities["@neocord/route-matches-path"]).toBe("error");
    expect(severities["@neocord/prefer-route-prop"]).toBe("warn");
    expect(severities["@neocord/no-process-env"]).toBe("warn");
    expect(severities["@neocord/require-error-boundary"]).toBe("off");
  });

  test("strict makes every rule an error", () => {
    expect(new Set(Object.values(plugin.configs.strict.rules ?? {}))).toEqual(new Set(["error"]));
  });
});

describe("Linter with configs.recommended", () => {
  const linter = new Linter({ cwd: join(tmpdir(), "neocord-virtual") });
  const config = [language, plugin.configs.recommended];
  const filename = join(tmpdir(), "neocord-virtual", "src/features/moderation/buttons/confirm/[userId]/button.tsx");

  test("autofixes a route id", () => {
    const result = linter.verifyAndFix('export default defineButton("wrong", { execute() {} });', config, { filename });
    expect(result.output).toBe('export default defineButton("moderation/confirm/[userId]", { execute() {} });');
    expect(result.messages).toEqual([]);
  });

  test("reports multiple rules with the configured severity", () => {
    const messages = linter.verify(
      [
        'import { EmbedBuilder } from "discord.js";',
        "export const extra = 1;",
        'export default defineSelect("moderation/confirm/[userId]", {});',
      ].join("\n"),
      config,
      { filename },
    );
    const severities = Object.fromEntries(messages.map((message) => [message.ruleId, message.severity]));
    expect(severities).toEqual({
      "@neocord/no-embed-builders": 1,
      "@neocord/no-extra-exports": 2,
      "@neocord/require-define-helper": 2,
      "@neocord/valid-command-definition": 2,
    });
  });
});

describe("documented project layout", () => {
  const files: Readonly<Record<string, string>> = {
    "neocord.config.ts": `
      import { defineConfig } from "neocord";
      export default defineConfig({ intents: ["Guilds"], token: process.env.DISCORD_TOKEN });
    `,
    "src/env.ts": "export const env = { token: process.env.DISCORD_TOKEN };",
    "src/context.ts": `
      import { defineContext } from "neocord";
      export default defineContext(async ({ client, logger }) => ({ value: { db }, dispose: () => db.close() }));
    `,
    "src/middleware.ts": `
      import { defineMiddleware } from "neocord";
      export default defineMiddleware(async (ctx, next) => {
        if (!allowed(ctx.user)) return null;
        await next();
      });
    `,
    "src/layout.tsx": `
      import { Container } from "@neocord/react";
      import type { LayoutProps } from "neocord";
      export default function Layout({ children }: LayoutProps) { return <Container>{children}</Container>; }
    `,
    "src/error.tsx": `
      import { Message } from "@neocord/react";
      export default function ErrorView({ error }: ErrorProps) { return <Message ephemeral>{error.message}</Message>; }
    `,
    "src/features/moderation/feature.ts": `
      import { defineFeature } from "neocord";
      export default defineFeature({ enabled: env.ENABLE_FUN, intents: ["GuildMessages"], partials: [] });
    `,
    "src/features/moderation/error.tsx": "export default function ErrorView() { return null; }",
    "src/features/moderation/commands/ban/command.tsx": `
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
          ctx.guild!.id;
          return <BanConfirm user={ctx.options.user} />;
        },
      });
    `,
    "src/features/moderation/commands/mod/group.ts": `
      import { defineGroup } from "neocord";
      export default defineGroup({ description: "Moderation" });
    `,
    "src/features/moderation/commands/mod/warn/command.tsx": `
      import { defineCommand } from "neocord";
      export default defineCommand({ description: "Warn", async execute(ctx) { await ctx.reply(<Done />); } });
    `,
    "src/features/moderation/user-commands/report/command.tsx": `
      import { defineUserCommand } from "neocord";
      export default defineUserCommand({ name: "Report", execute() { return null; } });
    `,
    "src/features/moderation/message-commands/quote/command.tsx": `
      import { defineMessageCommand } from "neocord";
      export default defineMessageCommand({ name: "Quote", execute() { return null; } });
    `,
    "src/features/moderation/buttons/confirm-ban/[userId]/button.tsx": `
      import { defineButton } from "neocord";
      export default defineButton("moderation/confirm-ban/[userId]", {
        respond: "update",
        execute(ctx) { return <Done id={ctx.params.userId} />; },
      });
    `,
    "src/features/moderation/selects/pick-role/select.tsx": `
      import { defineSelect } from "neocord";
      export default defineSelect("moderation/pick-role", { type: "role", execute(ctx) { ctx.values; } });
    `,
    "src/features/moderation/modals/ban-reason/[userId]/modal.tsx": `
      import { Label, TextInput } from "@neocord/react";
      import { defineModal } from "neocord";
      export default defineModal("moderation/ban-reason/[userId]", {
        title: "Ban reason",
        schema,
        render({ params, field }) {
          return (
            <Label label="Reason">
              <TextInput customId={field("reason")} style="paragraph" />
            </Label>
          );
        },
        submit(ctx) { return <Done />; },
      });
    `,
    "src/features/moderation/events/guildMemberAdd.ts": `
      import { defineEvent } from "neocord";
      export default defineEvent("guildMemberAdd", { once: false, execute(ctx, member) {} });
    `,
    "src/features/moderation/events/error/log.ts": `
      import { defineEvent } from "neocord";
      export default defineEvent("error", { execute(ctx, error) {} });
    `,
    "src/features/moderation/tasks/cleanup.ts": `
      import { defineTask } from "neocord";
      export default defineTask({ every: "5m", runOnStart: false, shard: "first", execute(ctx) {} });
    `,
    "src/features/moderation/_lib/anything.ts": "export const helper = 1;",
    "src/features/moderation/components/ui.tsx": "",
  };

  test("lints clean under configs.strict except for the deliberate problems", async () => {
    const root = createProject(files);
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [language, plugin.configs.strict],
    });
    const results = await eslint.lintFiles(["**/*.{ts,tsx}"]);
    const problems = results.flatMap((result) => {
      return result.messages.map((message) => {
        return `${result.filePath.slice(root.length + 1).replaceAll("\\", "/")}: ${message.ruleId}`;
      });
    });
    expect(problems).toEqual(["src/features/moderation/components/ui.tsx: @neocord/no-unknown-route-file"]);
  });
});

describe("ESLint on a project", () => {
  const root = createProject({
    "neocord.config.ts": "export default { token: process.env.TOKEN };\n",
    "src/env.ts": "export const env = process.env;\n",
    "src/features/fun/commands/roll/command.tsx":
      'import { defineCommand } from "neocord";\nexport default defineCommand({ description: "Roll", execute() { return null; } });\n',
    "src/features/fun/commands/roll/sub/command.tsx":
      'import { defineCommand } from "neocord";\nexport default defineCommand({ description: "Sub", execute() { return null; } });\n',
    "src/features/fun/helpers.ts": "export const helper = process.env.TOKEN;\n",
    "src/features/fun/_lib/ok.ts": "export const ok = 1;\n",
  });

  function createEslint(config: Linter.Config): ESLint {
    return new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [language, config],
    });
  }

  async function lintedRules(config: Linter.Config): Promise<Record<string, string[]>> {
    const results = await createEslint(config).lintFiles(["**/*.{ts,tsx}"]);
    return Object.fromEntries(
      results.map((result) => [
        result.filePath.slice(root.length + 1).replaceAll("\\", "/"),
        result.messages.map((message) => `${message.ruleId}:${message.severity}`).toSorted(),
      ]),
    );
  }

  test("uses the cwd as project root with configs.recommended", async () => {
    expect(await lintedRules(plugin.configs.recommended)).toEqual({
      "neocord.config.ts": [],
      "src/env.ts": [],
      "src/features/fun/_lib/ok.ts": [],
      "src/features/fun/commands/roll/command.tsx": ["@neocord/no-command-with-subcommands:2"],
      "src/features/fun/commands/roll/sub/command.tsx": [
        "@neocord/no-command-with-subcommands:2",
        "@neocord/require-group-file:1",
      ],
      "src/features/fun/helpers.ts": ["@neocord/no-process-env:1", "@neocord/no-unknown-route-file:2"],
    });
  });

  test("strict enables require-error-boundary and raises warnings", async () => {
    const linted = await lintedRules(plugin.configs.strict);
    expect(linted["src/features/fun/commands/roll/command.tsx"]).toEqual([
      "@neocord/no-command-with-subcommands:2",
      "@neocord/require-error-boundary:2",
    ]);
    expect(linted["src/features/fun/helpers.ts"]).toEqual([
      "@neocord/no-process-env:2",
      "@neocord/no-unknown-route-file:2",
    ]);
  });

  test("honours sourceDir and featuresDir settings", async () => {
    const custom = createProject({
      "app/modules/fun/stray.ts": "export const stray = 1;\n",
      "src/features/fun/stray.ts": "export const stray = 1;\n",
    });
    const eslint = new ESLint({
      cwd: custom,
      overrideConfigFile: true,
      overrideConfig: [
        language,
        plugin.configs.recommended,
        { settings: { neocord: { sourceDir: "app", featuresDir: "app/modules" } } },
      ],
    });
    const results = await eslint.lintFiles(["**/*.ts"]);
    const flagged = results
      .filter((result) => result.messages.length > 0)
      .map((result) => result.filePath.slice(custom.length + 1).replaceAll("\\", "/"));
    expect(flagged).toEqual(["app/modules/fun/stray.ts"]);
  });
});
