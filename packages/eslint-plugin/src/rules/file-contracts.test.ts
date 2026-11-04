import { afterAll, describe, expect, it, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import tsParser from "@typescript-eslint/parser";
import { RuleTester } from "eslint";
import { CLIENT_EVENT_NAMES, closestClientEvent } from "../utils/discord-events.ts";
import noCommandWithSubcommands from "./no-command-with-subcommands.ts";
import noExtraExports from "./no-extra-exports.ts";
import noUnknownRouteFile from "./no-unknown-route-file.ts";
import requireDefaultExport from "./require-default-export.ts";
import requireDefineHelper from "./require-define-helper.ts";
import requireErrorBoundary from "./require-error-boundary.ts";
import requireGroupFile from "./require-group-file.ts";
import routeMatchesPath from "./route-matches-path.ts";
import validCommandDefinition from "./valid-command-definition.ts";
import validCommandName from "./valid-command-name.ts";
import validEventName from "./valid-event-name.ts";
import validModalDefinition from "./valid-modal-definition.ts";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

const FEATURE = "src/features/moderation";
const COMMAND = `${FEATURE}/commands/ban/command.tsx`;
const USER_COMMAND = `${FEATURE}/user-commands/report/command.tsx`;
const MESSAGE_COMMAND = `${FEATURE}/message-commands/quote/command.tsx`;
const BUTTON = `${FEATURE}/buttons/confirm-ban/[userId]/button.tsx`;
const SELECT = `${FEATURE}/selects/pick-role/select.tsx`;
const MODAL = `${FEATURE}/modals/ban-reason/[userId]/modal.tsx`;
const EVENT = `${FEATURE}/events/guildMemberAdd.ts`;
const TASK = `${FEATURE}/tasks/cleanup.ts`;
const GROUP = `${FEATURE}/commands/mod/group.ts`;
const FEATURE_FILE = `${FEATURE}/feature.ts`;
const LAYOUT = `${FEATURE}/layout.tsx`;
const ERROR = "src/error.tsx";
const LOADING = `${FEATURE}/loading.tsx`;
const MIDDLEWARE = "src/middleware.ts";
const CONTEXT = "src/context.ts";
const LIB = `${FEATURE}/_lib/helpers.ts`;

const fixtures: string[] = [];

function createFixture(files: readonly string[]): { root: string; settings: { neocord: { sourceDir: string } } } {
  const root = mkdtempSync(join(tmpdir(), "neocord-eslint-"));
  fixtures.push(root);
  for (const file of files) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "export default {};\n");
  }
  return { root, settings: { neocord: { sourceDir: join(root, "src") } } };
}

afterAll(() => {
  for (const fixture of fixtures) rmSync(fixture, { recursive: true, force: true });
});

tester.run("require-default-export", requireDefaultExport, {
  valid: [
    { filename: COMMAND, code: "export default defineCommand({});" },
    { filename: GROUP, code: "const g = defineGroup({}); export { g as default };" },
    { filename: FEATURE_FILE, code: 'export { default } from "./shared";' },
    { filename: CONTEXT, code: "export default defineContext(async () => ({ value: {} }));" },
    { filename: MIDDLEWARE, code: "export default defineMiddleware(async () => {});" },
    { filename: LAYOUT, code: "export default function Layout() { return null; }" },
    { filename: "src/layout.tsx", code: "export default () => null;" },
    { filename: ERROR, code: "const ErrorView = () => null; export default ErrorView;" },
    { filename: ERROR, code: "function View() { return null; } export { View as default };" },
    { filename: LOADING, code: 'import { memo } from "react"; export default memo(function Spin() { return null; });' },
    { filename: LOADING, code: 'import Spin from "./spin"; export default Spin;' },
    { filename: LIB, code: "export const helper = 1;" },
    { filename: "src/lib/util.ts", code: "export const helper = 1;" },
    { filename: "src/env.ts", code: "export const env = {};" },
    { filename: `${FEATURE}/commands/ban/command.test.tsx`, code: "export const x = 1;" },
  ],
  invalid: [
    {
      filename: COMMAND,
      code: "export const command = defineCommand({});",
      errors: [{ messageId: "missing", data: { label: "command" } }],
    },
    { filename: GROUP, code: "const g = 1;", errors: [{ messageId: "missing" }] },
    { filename: FEATURE_FILE, code: "", errors: [{ messageId: "missing" }] },
    { filename: CONTEXT, code: 'export * from "./x";', errors: [{ messageId: "missing" }] },
    { filename: MIDDLEWARE, code: "export interface Foo {}", errors: [{ messageId: "missing" }] },
    {
      filename: MIDDLEWARE.replace("middleware", "features/a/middleware"),
      code: "export default interface Foo {}",
      errors: [{ messageId: "missing" }],
    },
    { filename: LAYOUT, code: "export const x = 1;", errors: [{ messageId: "missingComponent", data: { label: "layout" } }] },
    { filename: ERROR, code: 'export default "nope";', errors: [{ messageId: "notComponent", data: { label: "error" } }] },
    { filename: LOADING, code: "export default class Loading {}", errors: [{ messageId: "notComponent" }] },
    { filename: LOADING, code: "const value = 1; export default value;", errors: [{ messageId: "notComponent" }] },
    { filename: LOADING, code: "export default defineCommand({});", errors: [{ messageId: "notComponent" }] },
    { filename: LAYOUT, code: "type P = {}; export type { P as default };", errors: [{ messageId: "missingComponent" }] },
  ],
});

tester.run("require-define-helper", requireDefineHelper, {
  valid: [
    { filename: COMMAND, code: "export default defineCommand({});" },
    { filename: USER_COMMAND, code: "export default defineUserCommand({});" },
    { filename: MESSAGE_COMMAND, code: "export default defineMessageCommand({});" },
    { filename: BUTTON, code: "const c = defineButton('a', {}); export default c;" },
    { filename: SELECT, code: "const c = defineSelect('a', {}); export { c as default };" },
    { filename: MODAL, code: "export default defineModal('a', {}) satisfies unknown;" },
    { filename: EVENT, code: "export default defineEvent('a', {});" },
    { filename: TASK, code: "export default defineTask({});" },
    { filename: GROUP, code: "export default defineGroup({});" },
    { filename: FEATURE_FILE, code: "export default defineFeature({});" },
    { filename: CONTEXT, code: "export default defineContext(() => ({}));" },
    { filename: MIDDLEWARE, code: "export default defineMiddleware(() => {});" },
    { filename: COMMAND, code: 'import { defineCommand as dc } from "neocord"; export default dc({});' },
    { filename: COMMAND, code: 'import * as n from "neocord"; export default n.defineCommand({});' },
    { filename: LAYOUT, code: "export default function Layout() { return null; }" },
    { filename: COMMAND, code: "const x = 1;" },
    { filename: LIB, code: "export default 1;" },
  ],
  invalid: [
    {
      filename: COMMAND,
      code: "export default defineButton('a', {});",
      errors: [{ messageId: "wrongHelper", data: { label: "command", expected: "defineCommand", actual: "defineButton" } }],
    },
    {
      filename: USER_COMMAND,
      code: "export default defineCommand({});",
      errors: [{ messageId: "wrongHelper", data: { label: "user-command", expected: "defineUserCommand", actual: "defineCommand" } }],
    },
    { filename: MESSAGE_COMMAND, code: "const c = defineUserCommand({}); export default c;", errors: [{ messageId: "wrongHelper" }] },
    { filename: BUTTON, code: "export default {};", errors: [{ messageId: "notHelperCall" }] },
    { filename: SELECT, code: "export default wrap(defineSelect('a', {}));", errors: [{ messageId: "notHelperCall" }] },
    { filename: MODAL, code: 'import c from "./c"; export default c;', errors: [{ messageId: "notHelperCall" }] },
    { filename: EVENT, code: 'export { default } from "./impl";', errors: [{ messageId: "notHelperCall" }] },
    { filename: TASK, code: 'import { defineEvent as defineTask } from "neocord"; export default defineTask({});', errors: [{ messageId: "wrongHelper" }] },
    { filename: MIDDLEWARE, code: "export default async function middleware() {}", errors: [{ messageId: "notHelperCall" }] },
  ],
});

tester.run("route-matches-path", routeMatchesPath, {
  valid: [
    { filename: BUTTON, code: 'export default defineButton("moderation/confirm-ban/[userId]", {});' },
    { filename: SELECT, code: "export default defineSelect('moderation/pick-role', {});" },
    { filename: MODAL, code: "export default defineModal(`moderation/ban-reason/[userId]`, {});" },
    { filename: EVENT, code: 'export default defineEvent("guildMemberAdd", {});' },
    { filename: `${FEATURE}/events/guildMemberAdd/log.ts`, code: 'export default defineEvent("guildMemberAdd", {});' },
    { filename: `${FEATURE}/buttons/(flow)/next/button.tsx`, code: 'export default defineButton("moderation/next", {});' },
    { filename: `${FEATURE}/buttons/page/[...rest]/button.tsx`, code: 'export default defineButton("moderation/page/[...rest]", {});' },
    { filename: COMMAND, code: 'export default defineButton("anything", {});' },
    { filename: LIB, code: 'export default defineButton("anything", {});' },
    { filename: BUTTON, code: 'const other = defineSelect("anything", {});' },
    { filename: TASK, code: "export default defineTask({});" },
  ],
  invalid: [
    {
      filename: BUTTON,
      code: 'export default defineButton("moderation/confirm", {});',
      output: 'export default defineButton("moderation/confirm-ban/[userId]", {});',
      errors: [{ messageId: "mismatch" }],
    },
    {
      filename: SELECT,
      code: "export default defineSelect('wrong', {});",
      output: "export default defineSelect('moderation/pick-role', {});",
      errors: [{ messageId: "mismatch" }],
    },
    {
      filename: MODAL,
      code: "const c = defineModal(`wrong`, {}); export default c;",
      output: "const c = defineModal(`moderation/ban-reason/[userId]`, {}); export default c;",
      errors: [{ messageId: "mismatch" }],
    },
    {
      filename: EVENT,
      code: 'export default defineEvent("messageCreate", {});',
      output: 'export default defineEvent("guildMemberAdd", {});',
      errors: [{ messageId: "mismatch", data: { helper: "defineEvent", actual: "messageCreate", expected: "guildMemberAdd" } }],
    },
    {
      filename: BUTTON,
      code: "export default defineButton(ROUTE, {});",
      errors: [{
        messageId: "nonLiteral",
        suggestions: [{
          messageId: "useLiteral",
          data: { expected: "moderation/confirm-ban/[userId]" },
          output: 'export default defineButton("moderation/confirm-ban/[userId]", {});',
        }],
      }],
    },
    {
      filename: EVENT,
      code: "export default defineEvent(Events.GuildMemberAdd, {});",
      errors: [{
        messageId: "nonLiteral",
        suggestions: [{
          messageId: "useLiteral",
          data: { expected: "guildMemberAdd" },
          output: 'export default defineEvent("guildMemberAdd", {});',
        }],
      }],
    },
    {
      filename: SELECT,
      code: "export default defineSelect({ execute() {} });",
      errors: [{
        messageId: "missing",
        suggestions: [{
          messageId: "useLiteral",
          data: { expected: "moderation/pick-role" },
          output: 'export default defineSelect("moderation/pick-role", { execute() {} });',
        }],
      }],
    },
    { filename: MODAL, code: "export default defineModal();", errors: [{ messageId: "missing" }] },
  ],
});

tester.run("no-extra-exports", noExtraExports, {
  valid: [
    { filename: COMMAND, code: "export default defineCommand({});" },
    { filename: COMMAND, code: "export type Foo = string; export interface Bar {} export default defineCommand({});" },
    { filename: COMMAND, code: 'export type { Foo } from "./foo"; export type * from "./types"; export { type Baz } from "./foo";' },
    { filename: LAYOUT, code: "const L = () => null; export { L as default };" },
    { filename: GROUP, code: "export declare const x: number;" },
    { filename: LIB, code: "export const helper = 1;" },
    { filename: "src/env.ts", code: "export const env = {};" },
    { filename: "src/lib/thing.ts", code: 'export * from "./a";' },
  ],
  invalid: [
    {
      filename: COMMAND,
      code: "export const helper = 1; export default defineCommand({});",
      errors: [{ messageId: "extra", data: { label: "command", name: "helper" } }],
    },
    {
      filename: COMMAND,
      code: "export function helper() {}",
      errors: [{ messageId: "extra", data: { label: "command", name: "helper" } }],
    },
    {
      filename: LAYOUT,
      code: "const a = 1, b = 2; export { a, b as c };",
      errors: [
        { messageId: "extra", data: { label: "layout", name: "a" } },
        { messageId: "extra", data: { label: "layout", name: "c" } },
      ],
    },
    { filename: GROUP, code: 'export * from "./shared";', errors: [{ messageId: "exportAll" }] },
    { filename: FEATURE_FILE, code: 'export * as things from "./shared";', errors: [{ messageId: "exportAll" }] },
    { filename: CONTEXT, code: "export enum Mode { A }", errors: [{ messageId: "extra" }] },
    { filename: MIDDLEWARE, code: "export class Thing {}", errors: [{ messageId: "extra" }] },
    { filename: COMMAND, code: 'export { helper } from "./helper";', errors: [{ messageId: "extra" }] },
  ],
});

tester.run("no-unknown-route-file", noUnknownRouteFile, {
  valid: [
    { filename: COMMAND, code: "" },
    { filename: LIB, code: "" },
    { filename: "src/lib/util.ts", code: "" },
    { filename: "neocord.config.ts", code: "" },
    {
      filename: `${FEATURE}/stuff.ts`,
      settings: { neocord: { sourceDir: "lib" } },
      code: "",
    },
  ],
  invalid: [
    {
      filename: `${FEATURE}/commands/ban/helper.ts`,
      code: "export const x = 1;",
      errors: [{ message: 'Files in "commands" must be named "command.ts" or "command.tsx". Move helpers into a "_private" folder.' }],
    },
    {
      filename: `${FEATURE}/stuff.ts`,
      code: "",
      errors: [{ message: 'Unexpected file in feature "moderation". Move helpers into a "_private" folder.' }],
    },
    { filename: `${FEATURE}/unknown/thing.ts`, code: "", errors: [{ messageId: "invalid" }] },
    { filename: "src/features/stray.ts", code: "", errors: [{ messageId: "invalid" }] },
    {
      filename: "app/modules/fun/stuff.ts",
      settings: { neocord: { sourceDir: "app", featuresDir: "app/modules" } },
      code: "",
      errors: [{ messageId: "invalid" }],
    },
    {
      filename: "app/features/fun/stuff.ts",
      settings: { neocord: { sourceDir: "./app/" } },
      code: "",
      errors: [{ messageId: "invalid" }],
    },
  ],
});

tester.run("valid-command-name", validCommandName, {
  valid: [
    { filename: COMMAND, code: "" },
    { filename: `${FEATURE}/commands/mod/case/view/command.tsx`, code: "" },
    { filename: `${FEATURE}/commands/(staff)/mod/warn/command.tsx`, code: "" },
    { filename: `${FEATURE}/commands/a-b_c/command.ts`, code: "" },
    { filename: GROUP, code: "" },
    { filename: `${FEATURE}/commands/mod/case/group.ts`, code: "" },
    { filename: USER_COMMAND.replace("report", "Report User"), code: "" },
    { filename: LIB, code: "" },
  ],
  invalid: [
    {
      filename: `${FEATURE}/commands/Ban/command.tsx`,
      code: "",
      errors: [{ messageId: "notLowercase", data: { segment: "Ban", lowercase: "ban" } }],
    },
    {
      filename: `${FEATURE}/commands/not valid/command.tsx`,
      code: "",
      errors: [{ messageId: "invalidName", data: { segment: "not valid" } }],
    },
    {
      filename: `${FEATURE}/commands/[id]/command.tsx`,
      code: "",
      errors: [{ messageId: "invalidName", data: { segment: "[id]" } }],
    },
    {
      filename: `${FEATURE}/commands/${"x".repeat(33)}/command.tsx`,
      code: "",
      errors: [{ messageId: "invalidName" }],
    },
    {
      filename: `${FEATURE}/commands/a/b/c/d/command.tsx`,
      code: "",
      errors: [{ messageId: "tooDeep", data: { depth: 4, max: 3 } }],
    },
    { filename: `${FEATURE}/commands/Mod/group.ts`, code: "", errors: [{ messageId: "notLowercase" }] },
    { filename: `${FEATURE}/commands/a/b/c/group.ts`, code: "", errors: [{ messageId: "groupTooDeep" }] },
    { filename: `${FEATURE}/commands/group.ts`, code: "", errors: [{ messageId: "groupWithoutFolder" }] },
  ],
});

const conflict = createFixture([
  `${FEATURE}/commands/mod/command.tsx`,
  `${FEATURE}/commands/mod/warn/command.tsx`,
  `${FEATURE}/commands/clean/command.tsx`,
  `${FEATURE}/commands/(a)/split/command.tsx`,
  `${FEATURE}/commands/(b)/split/sub/command.tsx`,
  `src/features/other/commands/mod/kick/command.tsx`,
  `${FEATURE}/commands/_private/nested/command.tsx`,
]);

tester.run("no-command-with-subcommands", noCommandWithSubcommands, {
  valid: [
    { filename: COMMAND, code: "" },
    { filename: `${FEATURE}/commands/mod/warn/command.tsx`, code: "" },
    { filename: join(conflict.root, `${FEATURE}/commands/clean/command.tsx`), settings: conflict.settings, code: "" },
    { filename: join(conflict.root, `${FEATURE}/commands/missing/command.tsx`), settings: conflict.settings, code: "" },
    { filename: join(conflict.root, `${FEATURE}/buttons/mod/button.tsx`), settings: conflict.settings, code: "" },
  ],
  invalid: [
    {
      filename: join(conflict.root, `${FEATURE}/commands/mod/command.tsx`),
      settings: conflict.settings,
      code: "",
      errors: [{ messageId: "hasSubcommands" }],
    },
    {
      filename: join(conflict.root, `${FEATURE}/commands/mod/warn/command.tsx`),
      settings: conflict.settings,
      code: "",
      errors: [{ messageId: "underCommand", data: { name: "mod warn", parent: "mod" } }],
    },
    {
      filename: join(conflict.root, "src/features/other/commands/mod/kick/command.tsx"),
      settings: conflict.settings,
      code: "",
      errors: [{ messageId: "underCommand", data: { name: "mod kick", parent: "mod" } }],
    },
    {
      filename: join(conflict.root, `${FEATURE}/commands/(a)/split/command.tsx`),
      settings: conflict.settings,
      code: "",
      errors: [{ messageId: "hasSubcommands", data: { name: "split", nested: "split sub" } }],
    },
    {
      filename: join(conflict.root, `${FEATURE}/commands/(b)/split/sub/command.tsx`),
      settings: conflict.settings,
      code: "",
      errors: [{ messageId: "underCommand" }],
    },
  ],
});

const groups = createFixture([
  `${FEATURE}/commands/mod/group.ts`,
  `${FEATURE}/commands/mod/warn/command.tsx`,
  `${FEATURE}/commands/mod/case/view/command.tsx`,
  `${FEATURE}/commands/(x)/admin/group.ts`,
  `${FEATURE}/commands/(y)/admin/kick/command.tsx`,
  `${FEATURE}/commands/fun/roll/command.tsx`,
  `${FEATURE}/commands/fun/dice/group.ts`,
  `${FEATURE}/commands/fun/dice/d6/command.tsx`,
  `${FEATURE}/commands/ping/command.tsx`,
]);

tester.run("require-group-file", requireGroupFile, {
  valid: [
    { filename: `${FEATURE}/commands/mod/warn/command.tsx`, code: "" },
    { filename: join(groups.root, `${FEATURE}/commands/mod/warn/command.tsx`), settings: groups.settings, code: "" },
    { filename: join(groups.root, `${FEATURE}/commands/mod/case/view/command.tsx`), settings: groups.settings, code: "" },
    { filename: join(groups.root, `${FEATURE}/commands/(y)/admin/kick/command.tsx`), settings: groups.settings, code: "" },
    { filename: join(groups.root, `${FEATURE}/commands/ping/command.tsx`), settings: groups.settings, code: "" },
  ],
  invalid: [
    {
      filename: join(groups.root, `${FEATURE}/commands/fun/roll/command.tsx`),
      settings: groups.settings,
      code: "",
      errors: [{ messageId: "missing", data: { name: "fun roll", root: "fun" } }],
    },
    {
      filename: join(groups.root, `${FEATURE}/commands/fun/dice/d6/command.tsx`),
      settings: groups.settings,
      code: "",
      errors: [{ messageId: "missing", data: { name: "fun dice d6", root: "fun" } }],
    },
  ],
});

const boundaries = createFixture([
  "src/features/covered/error.tsx",
  "src/features/covered/commands/a/command.tsx",
  "src/features/anchored/feature.ts",
  "src/features/anchored/commands/b/command.tsx",
  "src/features/bare/commands/c/command.tsx",
  "src/features/bare/commands/d/command.tsx",
  "src/features/nested/commands/e/error.tsx",
  "src/features/nested/commands/e/command.tsx",
]);

tester.run("require-error-boundary", requireErrorBoundary, {
  valid: [
    { filename: COMMAND, code: "" },
    { filename: join(boundaries.root, "src/features/covered/commands/a/command.tsx"), settings: boundaries.settings, code: "" },
    { filename: join(boundaries.root, "src/features/anchored/commands/b/command.tsx"), settings: boundaries.settings, code: "" },
    { filename: join(boundaries.root, "src/features/bare/commands/d/command.tsx"), settings: boundaries.settings, code: "" },
    { filename: join(boundaries.root, "src/env.ts"), settings: boundaries.settings, code: "" },
  ],
  invalid: [
    {
      filename: join(boundaries.root, "src/features/anchored/feature.ts"),
      settings: boundaries.settings,
      code: "",
      errors: [{ messageId: "missing", data: { feature: "anchored" } }],
    },
    {
      filename: join(boundaries.root, "src/features/bare/commands/c/command.tsx"),
      settings: boundaries.settings,
      code: "",
      errors: [{ messageId: "missing", data: { feature: "bare" } }],
    },
    {
      filename: join(boundaries.root, "src/features/nested/commands/e/command.tsx"),
      settings: boundaries.settings,
      code: "",
      errors: [{ messageId: "missing", data: { feature: "nested" } }],
    },
  ],
});

tester.run("valid-event-name", validEventName, {
  valid: [
    'defineEvent("guildMemberAdd", {});',
    "defineEvent('clientReady', {});",
    'defineEvent("error", {});',
    "defineEvent(`messageCreate`, {});",
    "defineEvent(Events.ClientReady, {});",
    { filename: `${FEATURE}/events/messageCreate/log.ts`, code: "defineEvent(name, {});" },
    'other("notAnEvent");',
  ],
  invalid: [
    {
      code: 'defineEvent("guildMemberJoin", {});',
      errors: [{
        messageId: "unknown",
        data: { name: "guildMemberJoin", closest: "guildMemberAdd" },
        suggestions: [{
          messageId: "useClosest",
          data: { closest: "guildMemberAdd" },
          output: 'defineEvent("guildMemberAdd", {});',
        }],
      }],
    },
    {
      code: "defineEvent('MessageCreate', {});",
      errors: [{
        messageId: "unknown",
        data: { name: "MessageCreate", closest: "messageCreate" },
        suggestions: [{
          messageId: "useClosest",
          data: { closest: "messageCreate" },
          output: "defineEvent('messageCreate', {});",
        }],
      }],
    },
    {
      code: 'defineEvent("toString", {});',
      errors: [{
        messageId: "unknown",
        suggestions: 1,
      }],
    },
    {
      filename: `${FEATURE}/events/messageCreated.ts`,
      code: "defineEvent(name, {});",
      errors: [{ messageId: "unknownPath", data: { name: "messageCreated", closest: "messageCreate" } }],
    },
  ],
});

const execute = "execute() {}";
const manyOptions = Array.from({ length: 26 }, (_, index) => `o${index}: option.user({ description: "d" })`).join(", ");

tester.run("valid-command-definition", validCommandDefinition, {
  valid: [
    `defineCommand({ description: "Ban", ${execute} });`,
    `const def = { description: "Ban", ${execute} }; defineCommand(def);`,
    `defineCommand({ description: text, ${execute} });`,
    `defineCommand({ ...shared });`,
    `defineCommand(load());`,
    `defineCommand({ description: "${"x".repeat(100)}", ${execute} });`,
    `defineCommand({ description: "Ban", options: { user: option.user({ description: "Who", required: true }), reason: shared }, ${execute} });`,
    `defineCommand({ description: "Ban", options: { [key]: option.user({ description: "Who" }), ...rest }, ${execute} });`,
    `defineCommand({ description: "Ban", options: { user: option.user({ ...common }) }, ${execute} });`,
    `import { option as o } from "neocord"; defineCommand({ description: "Ban", options: { user: o.user({ description: "x" }) }, ${execute} });`,
    `defineGroup({ description: "Mod" });`,
    `defineUserCommand({ name: "Report", ${execute} });`,
    `defineMessageCommand({ name: "Quote", ${execute} });`,
    `defineButton("a", { ${execute} });`,
    `defineSelect("a", { execute: handler });`,
    `defineModal("a", { submit() {} });`,
    `defineEvent("ready", { ${execute} });`,
    `defineTask({ every: "5m", ${execute} });`,
    `defineButton("a", shared);`,
    `unrelated({});`,
  ],
  invalid: [
    { code: `defineCommand({ ${execute} });`, errors: [{ messageId: "missingProperty", data: { helper: "defineCommand", property: "description" } }] },
    { code: `defineCommand({ description: "Ban" });`, errors: [{ messageId: "missingProperty", data: { helper: "defineCommand", property: "execute" } }] },
    { code: `defineCommand();`, errors: [{ messageId: "missingProperty" }, { messageId: "missingProperty" }] },
    { code: `defineCommand({ description: "", ${execute} });`, errors: [{ messageId: "descriptionLength", data: { max: 100, length: 0 } }] },
    { code: `defineCommand({ description: "${"x".repeat(101)}", ${execute} });`, errors: [{ messageId: "descriptionLength", data: { max: 100, length: 101 } }] },
    { code: `defineGroup({});`, errors: [{ messageId: "missingProperty", data: { helper: "defineGroup", property: "description" } }] },
    { code: `defineGroup({ description: \`${"y".repeat(101)}\` });`, errors: [{ messageId: "descriptionLength" }] },
    {
      code: `defineCommand({ description: "Ban", options: { UserName: option.user({ description: "Who" }), "not valid": option.user({ description: "Who" }) }, ${execute} });`,
      errors: [
        { messageId: "invalidOptionName", data: { name: "UserName" } },
        { messageId: "invalidOptionName", data: { name: "not valid" } },
      ],
    },
    {
      code: `defineCommand({ description: "Ban", options: { user: option.user({ required: true }), role: option.role() }, ${execute} });`,
      errors: [
        { messageId: "missingOptionDescription", data: { name: "user" } },
        { messageId: "missingOptionDescription", data: { name: "role" } },
      ],
    },
    {
      code: `defineCommand({ description: "Ban", options: { user: option.user({ description: "" }) }, ${execute} });`,
      errors: [{ messageId: "descriptionLength" }],
    },
    {
      code: `defineCommand({ description: "Ban", options: { ${manyOptions} }, ${execute} });`,
      errors: [{ messageId: "tooManyOptions", data: { max: 25, count: 26 } }],
    },
    { code: `defineUserCommand({ ${execute} });`, errors: [{ messageId: "missingProperty", data: { helper: "defineUserCommand", property: "name" } }] },
    { code: `defineMessageCommand({ name: "Quote" });`, errors: [{ messageId: "missingProperty", data: { helper: "defineMessageCommand", property: "execute" } }] },
    { code: `defineButton("a", {});`, errors: [{ messageId: "missingProperty", data: { helper: "defineButton", property: "execute" } }] },
    { code: `defineSelect("a");`, errors: [{ messageId: "missingProperty", data: { helper: "defineSelect", property: "execute" } }] },
    { code: `defineModal("a", { ${execute} });`, errors: [{ messageId: "missingProperty", data: { helper: "defineModal", property: "submit" } }] },
    { code: `defineEvent("ready", {});`, errors: [{ messageId: "missingProperty", data: { helper: "defineEvent", property: "execute" } }] },
    { code: `defineTask({ ${execute} });`, errors: [{ messageId: "missingProperty", data: { helper: "defineTask", property: "every" } }] },
  ],
});

const modalBody = "render() { return null; }, submit() {}";

tester.run("valid-modal-definition", validModalDefinition, {
  valid: [
    `defineModal("a", { title: "Ban", ${modalBody} });`,
    `defineModal("a", { title: "${"x".repeat(45)}", ${modalBody} });`,
    `defineModal("a", { title: (ctx) => ctx.name, ${modalBody} });`,
    `defineModal("a", { title() { return "x"; }, ${modalBody} });`,
    `defineModal("a", { title: makeTitle, ${modalBody} });`,
    `const title = "Ban"; defineModal("a", { title, ${modalBody} });`,
    `defineModal("a", { ...shared });`,
    `defineModal("a", shared);`,
    `defineButton("a", {});`,
  ],
  invalid: [
    { code: `defineModal("a", { ${modalBody} });`, errors: [{ messageId: "missingProperty", data: { property: "title" } }] },
    { code: `defineModal("a", { title: "x", submit() {} });`, errors: [{ messageId: "missingProperty", data: { property: "render" } }] },
    { code: `defineModal("a", { title: "x", render() {} });`, errors: [{ messageId: "missingProperty", data: { property: "submit" } }] },
    { code: `defineModal("a");`, errors: [{ messageId: "missingProperty" }, { messageId: "missingProperty" }, { messageId: "missingProperty" }] },
    { code: `defineModal("a", { title: "${"x".repeat(46)}", ${modalBody} });`, errors: [{ messageId: "titleLength", data: { max: 45, length: 46 } }] },
    { code: `defineModal("a", { title: "", ${modalBody} });`, errors: [{ messageId: "titleLength" }] },
    { code: `const long = "${"x".repeat(46)}"; defineModal("a", { title: long, ${modalBody} });`, errors: [{ messageId: "titleLength" }] },
    { code: `defineModal("a", { title: getTitle(), ${modalBody} });`, errors: [{ messageId: "titleKind" }] },
    { code: "defineModal(\"a\", { title: `Ban ${name}`, render() {}, submit() {} });", errors: [{ messageId: "titleKind" }] },
  ],
});

describe("client event names", () => {
  const typingsPath = join(import.meta.dir, "../../../react/node_modules/discord.js/typings/index.d.ts");

  test("match ClientEvents in the installed discord.js", async () => {
    const file = Bun.file(typingsPath);
    if (!(await file.exists())) return;
    const typings = await file.text();
    const start = typings.indexOf("export interface ClientEvents {");
    expect(start).toBeGreaterThan(-1);
    const block = typings.slice(start, typings.indexOf("\n}", start));
    const declared = [...block.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]);
    expect(declared.toSorted()).toEqual([...CLIENT_EVENT_NAMES].toSorted());
  });

  test("closest name ignores case", () => {
    expect(closestClientEvent("GUILDCREATE")).toBe("guildCreate");
  });
});
