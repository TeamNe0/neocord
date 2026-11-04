import { describe, it } from "bun:test";
import tsParser from "@typescript-eslint/parser";
import { RuleTester } from "eslint";
import noBlockingCalls from "./no-blocking-calls.ts";
import noClientInstantiation from "./no-client-instantiation.ts";
import noDirectInteractionReply from "./no-direct-interaction-reply.ts";
import noHardcodedToken from "./no-hardcoded-token.ts";
import noMassMentions from "./no-mass-mentions.ts";
import noProcessEnv from "./no-process-env.ts";
import noUnawaitedContextCalls from "./no-unawaited-context-calls.ts";
import preferGuildOnly from "./prefer-guild-only.ts";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

const SOURCE = "src/lib/thing.tsx";
const ROUTE = "src/features/moderation/commands/ban/command.tsx";

tester.run("no-direct-interaction-reply", noDirectInteractionReply, {
  valid: [
    "ctx.reply(<X />);",
    "await ctx.interaction.deferred;",
    "ctx.interaction.isButton();",
    "other.interaction.reply({});",
    "interaction.reply({});",
    "function f(interaction) { interaction.reply({}); }",
    'defineButton("a", { execute(c, interaction) { interaction.reply({}); } });',
    "const { interaction } = other; interaction.reply({});",
  ],
  invalid: [
    {
      code: "ctx.interaction.reply({ content: 'x' });",
      errors: [{ messageId: "direct", data: { method: "reply", replacement: "ctx.reply(<X />) or return <X /> from the handler" } }],
    },
    { code: "ctx.interaction.editReply({});", errors: [{ messageId: "direct", data: { method: "editReply", replacement: "ctx.editReply(<X />)" } }] },
    { code: "ctx.interaction.deferReply();", errors: [{ messageId: "direct", data: { method: "deferReply", replacement: "ctx.defer()" } }] },
    { code: "ctx.interaction.followUp({});", errors: [{ messageId: "direct" }] },
    { code: "ctx.interaction.update({});", errors: [{ messageId: "direct" }] },
    { code: "ctx.interaction.showModal(modal);", errors: [{ messageId: "direct" }] },
    { code: "ctx.interaction!.reply({});", errors: [{ messageId: "direct" }] },
    { code: "ctx.interaction?.reply({});", errors: [{ messageId: "direct" }] },
    { code: "const i = ctx.interaction; i.reply({});", errors: [{ messageId: "direct" }] },
    { code: "const { interaction } = ctx; interaction.reply({});", errors: [{ messageId: "direct" }] },
    { code: "const { interaction: i } = ctx; i.deferReply();", errors: [{ messageId: "direct" }] },
    { code: "defineCommand({ execute({ interaction }) { interaction.reply({}); } });", errors: [{ messageId: "direct" }] },
    { code: "defineCommand({ execute(context) { context.interaction.reply({}); } });", errors: [{ messageId: "direct" }] },
    { code: "defineModal('a', { submit: (c) => c.interaction.reply({}) });", errors: [{ messageId: "direct" }] },
    { code: "defineMiddleware(async (c, next) => { await c.interaction.reply({}); });", errors: [{ messageId: "direct" }] },
    { code: "const c = useContext(); c.interaction.reply({});", errors: [{ messageId: "direct" }] },
  ],
});

tester.run("no-client-instantiation", noClientInstantiation, {
  valid: [
    { filename: SOURCE, code: 'import { Client } from "pg"; new Client({ connectionString });' },
    { filename: SOURCE, code: 'import { Client } from "./db"; new Client();' },
    { filename: SOURCE, code: "class Client {} new Client();" },
    { filename: SOURCE, code: "auth.login(user, password);" },
    { filename: SOURCE, code: "session.login();" },
    { filename: SOURCE, code: "ctx.client.user;" },
    { filename: SOURCE, code: 'import { Client as Db } from "pg"; const db = new Db(); db.login();' },
    { filename: "scripts/run.ts", code: 'import { Client } from "discord.js"; new Client({ intents: [] });' },
    { filename: "neocord.config.ts", code: "client.login(token);" },
  ],
  invalid: [
    {
      filename: SOURCE,
      code: 'import { Client } from "discord.js"; new Client({ intents: [] });',
      errors: [{ messageId: "instantiation", data: { name: "Client" } }],
    },
    {
      filename: SOURCE,
      code: 'import { Client as C } from "discord.js"; new C({ intents: [] });',
      errors: [{ messageId: "instantiation", data: { name: "Client" } }],
    },
    {
      filename: SOURCE,
      code: 'import { ShardingManager } from "discord.js"; new ShardingManager("x");',
      errors: [{ messageId: "instantiation", data: { name: "ShardingManager" } }],
    },
    {
      filename: SOURCE,
      code: 'import * as Discord from "discord.js"; new Discord.Client({ intents: [] });',
      errors: [{ messageId: "instantiation", data: { name: "Client" } }],
    },
    {
      filename: SOURCE,
      code: 'import Discord from "discord.js"; new Discord.ShardingManager("x");',
      errors: [{ messageId: "instantiation", data: { name: "ShardingManager" } }],
    },
    { filename: SOURCE, code: "new Client({ intents: [] });", errors: [{ messageId: "instantiation" }] },
    { filename: SOURCE, code: "client.login(token);", errors: [{ messageId: "login" }] },
    { filename: SOURCE, code: "ctx.client.login(token);", errors: [{ messageId: "login" }] },
    { filename: SOURCE, code: "this.discordClient.login(token);", errors: [{ messageId: "login" }] },
    { filename: SOURCE, code: "bot.login(token);", errors: [{ messageId: "login" }] },
    {
      filename: SOURCE,
      code: 'import { Client } from "discord.js"; const app = new Client({ intents: [] }); app.login(token);',
      errors: [{ messageId: "instantiation" }, { messageId: "login" }],
    },
  ],
});

tester.run("no-process-env", noProcessEnv, {
  valid: [
    { filename: "src/env.ts", code: "export const env = process.env;" },
    { filename: "neocord.config.ts", code: "const t = process.env.TOKEN;" },
    { filename: "neocord.config.mjs", code: "const t = process.env.TOKEN;" },
    { filename: "app/env.ts", settings: { neocord: { sourceDir: "app" } }, code: "process.env.TOKEN;" },
    { filename: SOURCE, code: "const process = { env: {} }; process.env.TOKEN;" },
    { filename: SOURCE, code: "function f(process) { return process.env; }" },
    { filename: SOURCE, code: 'import { env } from "./env"; env.TOKEN;' },
    { filename: SOURCE, code: "process.cwd();" },
    { filename: SOURCE, code: "other.env.TOKEN;" },
    { filename: "src/env.ts", code: 'import { env } from "node:process";' },
  ],
  invalid: [
    { filename: SOURCE, code: "const t = process.env.TOKEN;", errors: [{ messageId: "processEnv" }] },
    { filename: SOURCE, code: 'const t = process["env"].TOKEN;', errors: [{ messageId: "processEnv" }] },
    { filename: SOURCE, code: "const t = globalThis.process.env.TOKEN;", errors: [{ messageId: "processEnv" }] },
    { filename: SOURCE, code: "const { env } = process;", errors: [{ messageId: "processEnv" }] },
    { filename: SOURCE, code: 'import { env } from "node:process";', errors: [{ messageId: "processEnv" }] },
    { filename: SOURCE, code: 'import p from "node:process"; p.env.TOKEN;', errors: [{ messageId: "processEnv" }] },
    { filename: "src/lib/env.ts", code: "process.env.TOKEN;", errors: [{ messageId: "processEnv" }] },
    { filename: "src/env.ts", settings: { neocord: { sourceDir: "app" } }, code: "process.env.TOKEN;", errors: [{ messageId: "processEnv" }] },
  ],
});

const fakeToken = [btoa("123456789012345678"), "AbCdEf", "x".repeat(27)].join(".");
const fakeLongToken = [btoa("1234567890123456789").replaceAll("=", ""), "AbCdEf", "y".repeat(38)].join(".");
const jwt = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "z".repeat(43)].join(".");
const nonSnowflake = [btoa("not-a-discord-user-id!"), "AbCdEf", "x".repeat(27)].join(".");

tester.run("no-hardcoded-token", noHardcodedToken, {
  valid: [
    'const name = "hello.world.example";',
    `const token = "${jwt}";`,
    `const token = "${nonSnowflake}";`,
    "const token = process.env.DISCORD_TOKEN;",
    "const count = 5;",
  ],
  invalid: [
    { code: `const token = "${fakeToken}";`, output: null, errors: [{ messageId: "token" }] },
    { code: `const token = '${fakeLongToken}';`, errors: [{ messageId: "token" }] },
    { code: `const header = "Bot ${fakeToken}";`, errors: [{ messageId: "token" }] },
    { code: `const token = \`${fakeToken}\`;`, errors: [{ messageId: "token" }] },
    { code: `const header = \`Bot ${fakeToken} \${suffix}\`;`, errors: [{ messageId: "token" }] },
    { code: `const node = <X token="${fakeToken}" />;`, errors: [{ messageId: "token" }] },
    { code: `const node = <X>${fakeToken}</X>;`, errors: [{ messageId: "token" }] },
  ],
});

tester.run("no-blocking-calls", noBlockingCalls, {
  valid: [
    { filename: SOURCE, code: 'import { readFileSync } from "node:fs"; readFileSync("x");' },
    { filename: "src/lib/thing.ts", code: "Atomics.wait(buffer, 0, 0);" },
    { filename: ROUTE, code: 'import { readFile } from "node:fs/promises"; await readFile("x");' },
    { filename: ROUTE, code: 'import { readFileSync } from "./mine"; readFileSync("x");' },
    { filename: ROUTE, code: 'import { exec } from "node:child_process"; exec("x");' },
    { filename: ROUTE, code: 'import fs from "node:fs"; fs.readFile("x", cb);' },
    { filename: ROUTE, code: "other.readFileSync('x');" },
    { filename: ROUTE, code: "const Atomics = { wait() {} }; Atomics.wait();" },
    { filename: ROUTE, code: 'import { readFileSync } from "node:fs"; function f(readFileSync) { readFileSync("x"); }' },
  ],
  invalid: [
    {
      filename: ROUTE,
      code: 'import { readFileSync } from "node:fs"; readFileSync("x");',
      errors: [{ messageId: "blocking", data: { name: "readFileSync" } }],
    },
    {
      filename: ROUTE,
      code: 'import { existsSync as has } from "fs"; has("x");',
      errors: [{ messageId: "blocking", data: { name: "existsSync" } }],
    },
    {
      filename: ROUTE,
      code: 'import fs from "node:fs"; fs.writeFileSync("x", "y");',
      errors: [{ messageId: "blocking", data: { name: "fs.writeFileSync" } }],
    },
    {
      filename: ROUTE,
      code: 'import * as fs from "fs"; fs.statSync("x");',
      errors: [{ messageId: "blocking", data: { name: "fs.statSync" } }],
    },
    {
      filename: ROUTE,
      code: 'import { execSync } from "node:child_process"; execSync("x");',
      errors: [{ messageId: "blocking", data: { name: "execSync" } }],
    },
    {
      filename: ROUTE,
      code: 'import { spawnSync } from "child_process"; spawnSync("x");',
      errors: [{ messageId: "blocking", data: { name: "spawnSync" } }],
    },
    { filename: ROUTE, code: "Atomics.wait(buffer, 0, 0);", errors: [{ messageId: "atomics" }] },
    {
      filename: "src/features/moderation/events/ready.ts",
      code: "Atomics.wait(buffer, 0, 0);",
      errors: [{ messageId: "atomics" }],
    },
  ],
});

tester.run("prefer-guild-only", preferGuildOnly, {
  valid: [
    "defineCommand({ guildOnly: true, execute(ctx) { return ctx.guild!.id; } });",
    "defineCommand({ guildOnly: isGuild, execute(ctx) { return ctx.guild!.id; } });",
    "defineCommand({ ...shared, execute(ctx) { return ctx.guild!.id; } });",
    "defineCommand({ execute(ctx) { return ctx.guild?.id; } });",
    "defineCommand({ execute(ctx) { return ctx.user!.id; } });",
    "defineCommand({ execute(ctx) { return other.guild!.id; } });",
    "defineTask({ execute(ctx) { return ctx.guild!.id; } });",
    "defineEvent('ready', { execute(ctx) { return ctx.guild!.id; } });",
    "defineCommand(shared, ctx.guild!.id);",
    "function view(ctx) { return ctx.guild!.id; }",
    'defineButton("a", { guildOnly: true, execute(ctx) { return ctx.member!.id; } });',
  ],
  invalid: [
    {
      code: "defineCommand({ execute(ctx) { return ctx.guild!.id; } });",
      errors: [{
        messageId: "preferGuildOnly",
        data: { property: "guild" },
        suggestions: [{
          messageId: "addGuildOnly",
          output: "defineCommand({ guildOnly: true, execute(ctx) { return ctx.guild!.id; } });",
        }],
      }],
    },
    {
      code: "defineUserCommand({ name: 'x', execute(ctx) { return ctx.member!.id; } });",
      errors: [{
        messageId: "preferGuildOnly",
        data: { property: "member" },
        suggestions: [{
          messageId: "addGuildOnly",
          output: "defineUserCommand({ guildOnly: true, name: 'x', execute(ctx) { return ctx.member!.id; } });",
        }],
      }],
    },
    {
      code: 'defineButton("a", { guildOnly: false, execute(ctx) { return ctx.guild!.id; } });',
      errors: [{
        messageId: "preferGuildOnly",
        suggestions: [{
          messageId: "addGuildOnly",
          output: 'defineButton("a", { guildOnly: true, execute(ctx) { return ctx.guild!.id; } });',
        }],
      }],
    },
    {
      code: "defineMessageCommand({ execute({ guild }) { return guild!.id; } });",
      errors: [{
        messageId: "preferGuildOnly",
        suggestions: [{
          messageId: "addGuildOnly",
          output: "defineMessageCommand({ guildOnly: true, execute({ guild }) { return guild!.id; } });",
        }],
      }],
    },
    {
      code: "defineSelect('a', { execute(c) { const g = c.guild; return g!.id; } });",
      errors: [{
        messageId: "preferGuildOnly",
        suggestions: [{
          messageId: "addGuildOnly",
          output: "defineSelect('a', { guildOnly: true, execute(c) { const g = c.guild; return g!.id; } });",
        }],
      }],
    },
  ],
});

tester.run("no-unawaited-context-calls", noUnawaitedContextCalls, {
  valid: [
    "async function f() { await ctx.reply(x); }",
    "function f() { return ctx.reply(x); }",
    "void ctx.reply(x);",
    "const run = () => ctx.reply(x);",
    "const p = ctx.reply(x);",
    "ctx.reply(x).catch(handle);",
    "Promise.all([ctx.reply(x), ctx.followUp(y)]);",
    "other.reply(x);",
    "ctx.logger.info(x);",
    "ctx.state.update(x);",
    "defineCommand({ execute(c, other) { other.reply(x); } });",
  ],
  invalid: [
    {
      code: "async function f() { ctx.reply(x); }",
      errors: [{
        messageId: "unawaited",
        data: { method: "reply" },
        suggestions: [{ messageId: "addAwait", output: "async function f() { await ctx.reply(x); }" }],
      }],
    },
    {
      code: "function f() { ctx.editReply(x); }",
      errors: [{
        messageId: "unawaited",
        data: { method: "editReply" },
        suggestions: [{ messageId: "addVoid", output: "function f() { void ctx.editReply(x); }" }],
      }],
    },
    ...["followUp", "defer", "deleteReply", "showModal", "update", "deferUpdate"].map((method) => ({
      code: `async function f() { ctx.${method}(); }`,
      errors: [{
        messageId: "unawaited",
        data: { method },
        suggestions: [{ messageId: "addAwait", output: `async function f() { await ctx.${method}(); }` }],
      }],
    })),
    {
      code: "defineCommand({ async execute(c) { c.reply(x); } });",
      errors: [{
        messageId: "unawaited",
        suggestions: [{ messageId: "addAwait", output: "defineCommand({ async execute(c) { await c.reply(x); } });" }],
      }],
    },
    {
      code: "async function f() { cond && ctx.reply(x); }",
      errors: [{
        messageId: "unawaited",
        suggestions: [{ messageId: "addAwait", output: "async function f() { cond && await ctx.reply(x); }" }],
      }],
    },
    {
      code: "async function f() { cond ? ctx.reply(x) : other(); }",
      errors: [{
        messageId: "unawaited",
        suggestions: [{ messageId: "addAwait", output: "async function f() { cond ? await ctx.reply(x) : other(); }" }],
      }],
    },
    {
      code: "const c = useContext(); function f() { c.reply(x); }",
      errors: [{
        messageId: "unawaited",
        suggestions: [{ messageId: "addVoid", output: "const c = useContext(); function f() { void c.reply(x); }" }],
      }],
    },
  ],
});

tester.run("no-mass-mentions", noMassMentions, {
  valid: [
    "const options = { allowedMentions: { parse: [] } };",
    'const options = { allowedMentions: { parse: ["users", "roles"] } };',
    "const options = { allowedMentions: shared };",
    'const options = { parse: ["everyone"] };',
    "const node = <Message allowedMentions={{ parse: [] }}>Hi</Message>;",
    "const node = <Message allowedMentions={shared}>Hi</Message>;",
    "const node = <Message>Mail me@everyone.com</Message>;",
    "const node = <Message>Hello everyone</Message>;",
    'const text = "@everyone";',
    'const node = <X label="@everyone" />;',
    'import { Code } from "@neocord/react"; const node = <Code>@everyone</Code>;',
    "const node = <Message>{name}</Message>;",
  ],
  invalid: [
    { code: 'const options = { allowedMentions: { parse: ["everyone"] } };', errors: [{ messageId: "parseEveryone" }] },
    { code: 'send({ allowedMentions: { parse: ["users", "everyone"] } });', errors: [{ messageId: "parseEveryone" }] },
    { code: 'const node = <Message allowedMentions={{ parse: ["everyone"] }}>Hi</Message>;', errors: [{ messageId: "parseEveryone" }] },
    { code: "const node = <Message>Hey @everyone!</Message>;", errors: [{ messageId: "text", data: { mention: "everyone" } }] },
    { code: "const node = <Message>Hey @here</Message>;", errors: [{ messageId: "text", data: { mention: "here" } }] },
    { code: 'const node = <Message>{"@everyone"}</Message>;', errors: [{ messageId: "text", data: { mention: "everyone" } }] },
    { code: 'import { Code } from "./mine"; const node = <Code>@here</Code>;', errors: [{ messageId: "text" }] },
  ],
});
