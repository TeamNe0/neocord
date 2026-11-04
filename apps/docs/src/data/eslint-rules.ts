export type RuleSeverity = "off" | "warn" | "error";

export interface EslintExample {
  filename?: string;
  language?: string;
  note?: string;
  code: string;
}

export interface EslintRule {
  name: string;
  category: "file-contracts" | "ui" | "best-practices";
  recommended: RuleSeverity;
  fixable?: boolean;
  suggestions?: boolean;
  description: string;
  why: string;
  messages: Record<string, string>;
  incorrect: EslintExample[];
  correct: EslintExample[];
}

const FEATURE = "src/features/moderation";
const COMMAND = `${FEATURE}/commands/ban/command.tsx`;
const USER_COMMAND = `${FEATURE}/user-commands/report/command.tsx`;
const BUTTON = `${FEATURE}/buttons/confirm-ban/[userId]/button.tsx`;
const SELECT = `${FEATURE}/selects/pick-role/select.tsx`;
const MODAL = `${FEATURE}/modals/ban-reason/[userId]/modal.tsx`;
const EVENT = `${FEATURE}/events/guildMemberAdd.ts`;
const GROUP = `${FEATURE}/commands/mod/group.ts`;
const LAYOUT = `${FEATURE}/layout.tsx`;
const LOADING = `${FEATURE}/loading.tsx`;
const LIB = `${FEATURE}/_lib/helpers.ts`;
const SOURCE = "src/lib/thing.tsx";
const UI = "src/ui.tsx";

const COMMAND_BODY = `export default defineCommand({ description: "Ban a member", execute() {} });`;

export const ESLINT_RULES: EslintRule[] = [
  {
    name: "require-default-export",
    category: "file-contracts",
    recommended: "error",
    description: "Require the default export neocord loads from route, group, feature, context and segment files.",
    why: "The generated manifest imports each routed file as a module and the runtime reads its `default` export. A missing default is otherwise only reported when the manifest is validated. Layout, error and loading files are rendered as components, so their default must be a function component.",
    messages: {
      missing: "This {{label}} file must have a default export. neocord loads the default export of each file it routes.",
      missingComponent: "This {{label}} file must default-export a function component.",
      notComponent: "The default export of a {{label}} file must be a function component.",
    },
    incorrect: [
      { filename: COMMAND, code: `export const command = defineCommand({});` },
      { filename: "src/middleware.ts", code: `export interface Foo {}` },
      { filename: LAYOUT, code: `export const x = 1;` },
      { filename: "src/error.tsx", code: `export default "nope";` },
      { filename: LOADING, code: `export default class Loading {}` },
      { filename: LOADING, code: `export default defineCommand({});` },
    ],
    correct: [
      { filename: COMMAND, code: `export default defineCommand({});` },
      { filename: GROUP, code: `const g = defineGroup({});\nexport { g as default };` },
      { filename: "src/context.ts", code: `export default defineContext(async () => ({ value: {} }));` },
      { filename: LAYOUT, code: `export default function Layout() {\n  return null;\n}` },
      { filename: "src/error.tsx", code: `const ErrorView = () => null;\nexport default ErrorView;` },
      { filename: LOADING, code: `import { memo } from "react";\n\nexport default memo(function Spin() {\n  return null;\n});` },
      { filename: LIB, note: "Files in a private folder are not routed, so named exports are fine.", code: `export const helper = 1;` },
    ],
  },
  {
    name: "require-define-helper",
    category: "file-contracts",
    recommended: "error",
    description: "Require the default export of each routed file to be a call to the matching define helper.",
    why: "The runtime checks a brand that each `define*` helper adds, and rejects a module whose default export lacks the brand for its folder. This rule reports the same mistake in your editor, including the wrong helper for the folder, such as `defineCommand` in `user-commands`.",
    messages: {
      notHelperCall: "The default export of a {{label}} file must be a call to {{expected}}().",
      wrongHelper: "A {{label}} file must use {{expected}}(), not {{actual}}().",
    },
    incorrect: [
      { filename: COMMAND, code: `export default defineButton("a", {});` },
      { filename: USER_COMMAND, code: `export default defineCommand({});` },
      { filename: BUTTON, code: `export default {};` },
      { filename: SELECT, code: `export default wrap(defineSelect("a", {}));` },
      { filename: MODAL, code: `import c from "./c";\n\nexport default c;` },
      { filename: EVENT, code: `export { default } from "./impl";` },
      { filename: "src/middleware.ts", code: `export default async function middleware() {}` },
    ],
    correct: [
      { filename: COMMAND, code: `export default defineCommand({});` },
      { filename: USER_COMMAND, code: `export default defineUserCommand({});` },
      { filename: BUTTON, code: `const c = defineButton("a", {});\nexport default c;` },
      { filename: SELECT, code: `const c = defineSelect("a", {});\nexport { c as default };` },
      { filename: MODAL, code: `export default defineModal("a", {}) satisfies unknown;` },
      { filename: COMMAND, code: `import { defineCommand as dc } from "neocord";\n\nexport default dc({});` },
      { filename: COMMAND, code: `import * as n from "neocord";\n\nexport default n.defineCommand({});` },
      { filename: LAYOUT, note: "Layouts are plain components, so no helper is expected.", code: `export default function Layout() {\n  return null;\n}` },
    ],
  },
  {
    name: "route-matches-path",
    category: "file-contracts",
    recommended: "error",
    fixable: true,
    suggestions: true,
    description: "Require the first argument of route helpers to equal the id derived from the file path.",
    why: "The first argument of `defineButton`, `defineSelect` and `defineModal` is a string literal that drives param inference with no code generation, so it has to be a literal and has to match the path. `defineEvent` is checked the same way against the event name in the path. The runtime rejects a mismatch, and this rule can fix it for you.",
    messages: {
      mismatch: `{{helper}}() is called with "{{actual}}" but this file's route id is "{{expected}}".`,
      nonLiteral: `{{helper}}() needs the string literal "{{expected}}" as its first argument, so params can be inferred.`,
      missing: `{{helper}}() needs the string literal "{{expected}}" as its first argument.`,
      useLiteral: `Use the literal "{{expected}}".`,
    },
    incorrect: [
      { filename: BUTTON, note: "`eslint --fix` replaces the string with the id from the path.", code: `export default defineButton("moderation/confirm", {});` },
      { filename: EVENT, code: `export default defineEvent("messageCreate", {});` },
      { filename: BUTTON, note: "A non-literal gets an editor suggestion rather than an autofix.", code: `export default defineButton(ROUTE, {});` },
      { filename: EVENT, code: `export default defineEvent(Events.GuildMemberAdd, {});` },
      { filename: SELECT, code: `export default defineSelect({ execute() {} });` },
      { filename: MODAL, code: `export default defineModal();` },
    ],
    correct: [
      { filename: BUTTON, code: `export default defineButton("moderation/confirm-ban/[userId]", {});` },
      { filename: SELECT, code: `export default defineSelect("moderation/pick-role", {});` },
      { filename: EVENT, code: `export default defineEvent("guildMemberAdd", {});` },
      { filename: `${FEATURE}/events/guildMemberAdd/log.ts`, code: `export default defineEvent("guildMemberAdd", {});` },
      { filename: `${FEATURE}/buttons/(flow)/next/button.tsx`, note: "Folders in parentheses do not change the route.", code: `export default defineButton("moderation/next", {});` },
      { filename: `${FEATURE}/buttons/page/[...rest]/button.tsx`, code: `export default defineButton("moderation/page/[...rest]", {});` },
    ],
  },
  {
    name: "no-extra-exports",
    category: "file-contracts",
    recommended: "error",
    description: "Allow only the default export, plus type exports, in files neocord routes.",
    why: "neocord only reads the default export of a routed file, so anything else exported from it has no effect on the route. Shared code belongs in a folder that starts with `_`, which is never routed.",
    messages: {
      extra: `A {{label}} file may only export its default. Move "{{name}}" into a "_private" folder.`,
      exportAll: `A {{label}} file may only export its default. Remove this "export *".`,
    },
    incorrect: [
      { filename: COMMAND, code: `export const helper = 1;\nexport default defineCommand({});` },
      { filename: COMMAND, code: `export function helper() {}` },
      { filename: LAYOUT, code: `const a = 1, b = 2;\nexport { a, b as c };` },
      { filename: GROUP, code: `export * from "./shared";` },
      { filename: `${FEATURE}/feature.ts`, code: `export * as things from "./shared";` },
      { filename: "src/context.ts", code: `export enum Mode { A }` },
      { filename: COMMAND, code: `export { helper } from "./helper";` },
    ],
    correct: [
      { filename: COMMAND, code: `export default defineCommand({});` },
      { filename: COMMAND, code: `export type Foo = string;\nexport interface Bar {}\nexport default defineCommand({});` },
      { filename: COMMAND, code: `export type { Foo } from "./foo";\nexport type * from "./types";\nexport { type Baz } from "./foo";` },
      { filename: LAYOUT, code: `const L = () => null;\nexport { L as default };` },
      { filename: LIB, code: `export const helper = 1;` },
      { filename: "src/env.ts", code: `export const env = {};` },
    ],
  },
  {
    name: "no-unknown-route-file",
    category: "file-contracts",
    recommended: "error",
    description: "Report files in the features folder that neocord cannot classify.",
    why: "The CLI stops with the same error when it scans the project, because a file in the features folder that fits no convention is almost always a typo or a misplaced helper. The message comes straight from `classifyFile`, so it says what the file should have been.",
    messages: {
      invalid: "{{reason}}",
    },
    incorrect: [
      {
        filename: `${FEATURE}/commands/ban/helper.ts`,
        note: `Reported as: Files in "commands" must be named "command.ts" or "command.tsx". Move helpers into a "_private" folder.`,
        code: `export const x = 1;`,
      },
      {
        filename: `${FEATURE}/stuff.ts`,
        note: `Reported as: Unexpected file in feature "moderation". Move helpers into a "_private" folder.`,
        code: `export const x = 1;`,
      },
      { filename: `${FEATURE}/unknown/thing.ts`, code: `export const x = 1;` },
      { filename: "src/features/stray.ts", code: `export const x = 1;` },
      {
        filename: "app/modules/fun/stuff.ts",
        note: "This one uses `settings: { neocord: { sourceDir: \"app\", featuresDir: \"app/modules\" } }`.",
        code: `export const x = 1;`,
      },
    ],
    correct: [
      { filename: COMMAND, code: COMMAND_BODY },
      { filename: LIB, note: "Private folders are skipped.", code: `export const x = 1;` },
      { filename: "src/lib/util.ts", note: "Files outside the features folder are not routed.", code: `export const x = 1;` },
      { filename: "neocord.config.ts", code: `export default defineConfig({});` },
    ],
  },
  {
    name: "valid-command-name",
    category: "file-contracts",
    recommended: "error",
    description: "Require folders under commands to be valid Discord command names within the depth limit.",
    why: "The name of a slash command comes from its folders, so an invalid folder name is an invalid command name, and Discord would reject the deploy. Commands are limited to three segments, and a group can sit at most two levels deep because it has to hold subcommands.",
    messages: {
      invalidName: `Command folder "{{segment}}" is not a valid Discord command name. Use 1-32 letters, numbers, "-", "_" or "'".`,
      notLowercase: `Command folder "{{segment}}" must be lowercase. Rename it to "{{lowercase}}".`,
      tooDeep: "Commands can be at most {{max}} levels deep, but this one is {{depth}}.",
      groupTooDeep: "A group at depth {{depth}} cannot hold subcommands, because commands can be at most {{max}} levels deep.",
    },
    incorrect: [
      { filename: `${FEATURE}/commands/Ban/command.tsx`, note: "The path is what this rule checks, so the file's content does not matter.", code: COMMAND_BODY },
      { filename: `${FEATURE}/commands/not valid/command.tsx`, code: COMMAND_BODY },
      { filename: `${FEATURE}/commands/[id]/command.tsx`, note: "Slash commands cannot have dynamic segments.", code: COMMAND_BODY },
      { filename: `${FEATURE}/commands/a/b/c/d/command.tsx`, code: COMMAND_BODY },
      { filename: `${FEATURE}/commands/Mod/group.ts`, code: `export default defineGroup({ description: "Moderation" });` },
      { filename: `${FEATURE}/commands/a/b/c/group.ts`, code: `export default defineGroup({ description: "Too deep" });` },
    ],
    correct: [
      { filename: COMMAND, code: COMMAND_BODY },
      { filename: `${FEATURE}/commands/mod/case/view/command.tsx`, code: COMMAND_BODY },
      { filename: `${FEATURE}/commands/(staff)/mod/warn/command.tsx`, note: "Folders in parentheses are not part of the name.", code: COMMAND_BODY },
      { filename: `${FEATURE}/commands/a-b_c/command.ts`, code: COMMAND_BODY },
      { filename: `${FEATURE}/commands/mod/case/group.ts`, code: `export default defineGroup({ description: "Cases" });` },
    ],
  },
  {
    name: "no-command-with-subcommands",
    category: "file-contracts",
    recommended: "error",
    description: "Disallow a command file in a folder that also holds nested commands.",
    why: "Discord does not let a command with subcommands be run directly, so `/mod` cannot be both a command and the parent of `/mod warn`. Slash commands are global, so the rule compares against commands in every feature and ignores folders in parentheses.",
    messages: {
      hasSubcommands: `Command "/{{name}}" cannot have a command file because "/{{nested}}" is nested under it. Discord does not allow a command with subcommands to be run directly.`,
      underCommand: `Command "/{{name}}" cannot sit under "/{{parent}}", which already has a command file.`,
    },
    incorrect: [
      {
        filename: `${FEATURE}/commands/mod/command.tsx`,
        note: `Reported because \`${FEATURE}/commands/mod/warn/command.tsx\` also exists.`,
        code: COMMAND_BODY,
      },
      {
        filename: `${FEATURE}/commands/mod/warn/command.tsx`,
        note: `Reported because \`${FEATURE}/commands/mod/command.tsx\` also exists.`,
        code: COMMAND_BODY,
      },
      {
        filename: "src/features/other/commands/mod/kick/command.tsx",
        note: "Features do not separate command names, so a `mod` command in another feature still conflicts.",
        code: COMMAND_BODY,
      },
      {
        filename: `${FEATURE}/commands/(a)/split/command.tsx`,
        note: `Reported because \`${FEATURE}/commands/(b)/split/sub/command.tsx\` also exists. Route groups do not change the name.`,
        code: COMMAND_BODY,
      },
    ],
    correct: [
      { filename: `${FEATURE}/commands/clean/command.tsx`, note: "No other command is nested under `/clean`.", code: COMMAND_BODY },
      {
        filename: `${FEATURE}/commands/mod/warn/command.tsx`,
        note: "Fine when `mod` holds only a `group.ts` and subcommands.",
        code: COMMAND_BODY,
      },
    ],
  },
  {
    name: "require-group-file",
    category: "file-contracts",
    recommended: "warn",
    description: "Require a group file with a description in the root folder of nested commands.",
    why: "Discord requires a description on the parent of subcommands, and that description comes from `defineGroup` in `group.ts`. Without it, validation and `serializeCommands` fail, so this rule reports it while you are still writing the command.",
    messages: {
      missing: `Nested command "/{{name}}" has no group file for "/{{root}}". Add "{{root}}/group.ts" with defineGroup({ description }).`,
    },
    incorrect: [
      {
        filename: `${FEATURE}/commands/fun/roll/command.tsx`,
        note: `Reported because there is no \`${FEATURE}/commands/fun/group.ts\`.`,
        code: COMMAND_BODY,
      },
      {
        filename: `${FEATURE}/commands/fun/dice/d6/command.tsx`,
        note: `Reported for the same reason. \`${FEATURE}/commands/fun/dice/group.ts\` exists, but the rule looks for the root \`fun/group.ts\`.`,
        code: COMMAND_BODY,
      },
    ],
    correct: [
      {
        filename: `${FEATURE}/commands/mod/warn/command.tsx`,
        note: `Fine because \`${FEATURE}/commands/mod/group.ts\` exists.`,
        code: COMMAND_BODY,
      },
      {
        filename: `${FEATURE}/commands/(y)/admin/kick/command.tsx`,
        note: `Fine because \`${FEATURE}/commands/(x)/admin/group.ts\` exists. Route groups do not change the name.`,
        code: COMMAND_BODY,
      },
      { filename: `${FEATURE}/commands/ping/command.tsx`, note: "A top-level command needs no group.", code: COMMAND_BODY },
    ],
  },
  {
    name: "valid-event-name",
    category: "file-contracts",
    recommended: "error",
    suggestions: true,
    description: "Require defineEvent to name a real discord.js client event.",
    why: "A misspelled event name is a listener that never fires, and nothing at runtime tells you. The rule checks against the client events in discord.js and suggests the closest name. If the first argument is not a literal, it checks the event name from the file path instead.",
    messages: {
      unknown: `"{{name}}" is not a discord.js client event. Did you mean "{{closest}}"?`,
      unknownPath: `This file is routed to "{{name}}", which is not a discord.js client event. Did you mean "{{closest}}"?`,
      useClosest: `Use "{{closest}}".`,
    },
    incorrect: [
      { note: "The suggestion replaces it with `guildMemberAdd`.", code: `defineEvent("guildMemberJoin", {});` },
      { note: "Names are case-sensitive. The suggestion replaces it with `messageCreate`.", code: `defineEvent("MessageCreate", {});` },
      { code: `defineEvent("toString", {});` },
      { filename: `${FEATURE}/events/messageCreated.ts`, code: `defineEvent(name, {});` },
    ],
    correct: [
      { code: `defineEvent("guildMemberAdd", {});` },
      { code: `defineEvent("clientReady", {});` },
      { code: `defineEvent(Events.ClientReady, {});` },
      { filename: `${FEATURE}/events/messageCreate/log.ts`, code: `defineEvent(name, {});` },
    ],
  },
  {
    name: "valid-command-definition",
    category: "file-contracts",
    recommended: "error",
    description: "Check definitions passed to define helpers against Discord and neocord requirements.",
    why: "Discord rejects a whole command deploy for one bad description or option name, so this rule catches those mistakes before you deploy. It reads literals only, and skips anything it cannot resolve, such as a spread or a call. It also requires `execute` on the helpers that run, `name` on context menu commands, `submit` on modals and `every` on tasks.",
    messages: {
      missingProperty: `{{helper}}() requires "{{property}}".`,
      descriptionLength: "A description must be 1-{{max}} characters, but this one has {{length}}.",
      invalidOptionName: `Option name "{{name}}" must be a lowercase Discord name of 1-32 letters, numbers, "-", "_" or "'".`,
      missingOptionDescription: `Option "{{name}}" requires a description.`,
      tooManyOptions: "A command can have at most {{max}} options, but this one has {{count}}.",
    },
    incorrect: [
      { code: `defineCommand({ execute() {} });` },
      { code: `defineCommand({ description: "Ban" });` },
      { code: `defineCommand({ description: "", execute() {} });` },
      { note: "A description of 101 characters or more is reported, and exactly 100 is fine.", code: `defineCommand({ description: "${"x".repeat(101)}", execute() {} });` },
      { code: `defineGroup({});` },
      {
        code: `defineCommand({\n  description: "Ban",\n  options: {\n    UserName: option.user({ description: "Who" }),\n    "not valid": option.user({ description: "Who" }),\n  },\n  execute() {},\n});`,
      },
      {
        code: `defineCommand({\n  description: "Ban",\n  options: {\n    user: option.user({ required: true }),\n    role: option.role(),\n  },\n  execute() {},\n});`,
      },
      { code: `defineUserCommand({ execute() {} });` },
      { code: `defineMessageCommand({ name: "Quote" });` },
      { code: `defineButton("a", {});` },
      { code: `defineModal("a", { execute() {} });` },
      { code: `defineEvent("ready", {});` },
      { code: `defineTask({ execute() {} });` },
    ],
    correct: [
      { code: `defineCommand({ description: "Ban", execute() {} });` },
      { code: `const def = { description: "Ban", execute() {} };\ndefineCommand(def);` },
      { note: "A non-literal description cannot be checked, so it is allowed.", code: `defineCommand({ description: text, execute() {} });` },
      { note: "A spread could hold the required properties, so it is allowed.", code: `defineCommand({ ...shared });` },
      {
        code: `defineCommand({\n  description: "Ban",\n  options: {\n    user: option.user({ description: "Who", required: true }),\n    reason: shared,\n  },\n  execute() {},\n});`,
      },
      { code: `defineGroup({ description: "Mod" });` },
      { code: `defineUserCommand({ name: "Report", execute() {} });` },
      { code: `defineButton("a", { execute() {} });` },
      { code: `defineTask({ every: "5m", execute() {} });` },
    ],
  },
  {
    name: "valid-modal-definition",
    category: "file-contracts",
    recommended: "error",
    description: "Require defineModal to have a usable title, render and submit.",
    why: "`defineModal` needs all three to show a modal and handle its submission, and Discord limits a modal title to 45 characters. A template literal or a call result could be any length, so the title must be a literal or a function that returns it.",
    messages: {
      missingProperty: `defineModal() requires "{{property}}".`,
      titleKind: "A modal title must be a string literal or a function that returns the title.",
      titleLength: "A modal title must be 1-{{max}} characters, but this one has {{length}}.",
    },
    incorrect: [
      { code: `defineModal("a", {\n  render() {\n    return null;\n  },\n  submit() {},\n});` },
      { code: `defineModal("a", { title: "x", submit() {} });` },
      { code: `defineModal("a", { title: "x", render() {} });` },
      { code: `defineModal("a");` },
      { note: "A title of 46 characters or more is reported, and exactly 45 is fine.", code: `defineModal("a", { title: "${"x".repeat(46)}", render() {}, submit() {} });` },
      { code: `defineModal("a", { title: "", render() {}, submit() {} });` },
      { code: `defineModal("a", { title: getTitle(), render() {}, submit() {} });` },
      { code: "defineModal(\"a\", { title: `Ban ${name}`, render() {}, submit() {} });" },
    ],
    correct: [
      { code: `defineModal("a", { title: "Ban", render() {}, submit() {} });` },
      { code: `defineModal("a", { title: (ctx) => ctx.name, render() {}, submit() {} });` },
      { code: `defineModal("a", {\n  title() {\n    return "x";\n  },\n  render() {},\n  submit() {},\n});` },
      { code: `defineModal("a", { title: makeTitle, render() {}, submit() {} });` },
      { code: `const title = "Ban";\ndefineModal("a", { title, render() {}, submit() {} });` },
      { code: `defineModal("a", { ...shared });` },
    ],
  },
  {
    name: "no-embed-builders",
    category: "ui",
    recommended: "warn",
    description: "Disallow discord.js component builders and raw payloads in favour of @teamneo/neocord-react.",
    why: "`@teamneo/neocord-react` validates against Discord's limits and goes through neocord's layouts and reply state, and builders and raw payloads skip all of that. The rule reports builder imports from `discord.js` and `@discordjs/builders`, and literal `embeds` or `components` in send calls. `AttachmentBuilder` and `SlashCommandBuilder` are not on the list, and neither are type-only imports.",
    messages: {
      builder: "Do not use {{name}}. Render JSX with @teamneo/neocord-react instead.",
      rawPayload: `Do not pass raw "{{property}}". Return JSX from the handler or pass it to ctx.reply, using @teamneo/neocord-react.`,
    },
    incorrect: [
      { filename: UI, code: `import { EmbedBuilder, ActionRowBuilder as Row } from "discord.js";` },
      { filename: UI, code: `import { ButtonBuilder } from "@discordjs/builders";` },
      { filename: UI, code: `import * as Discord from "discord.js";\n\nnew Discord.EmbedBuilder();` },
      { filename: UI, code: `import Discord from "discord.js";\n\nconst b = Discord.ButtonBuilder;` },
      { filename: UI, code: `interaction.reply({ embeds: [embed] });` },
      { filename: UI, code: `channel.send({ components: [row] });` },
      { filename: UI, code: `message.edit({ embeds: list });` },
      { filename: UI, code: `interaction.followUp({ embeds: [a], components: [b] });` },
    ],
    correct: [
      { filename: UI, code: `import { Message } from "@teamneo/neocord-react";` },
      { filename: UI, code: `import { Client, AttachmentBuilder, SlashCommandBuilder } from "discord.js";` },
      { filename: UI, code: `import type { EmbedBuilder } from "discord.js";` },
      { filename: UI, code: `import { EmbedBuilder } from "./my-embed";\n\nnew EmbedBuilder();` },
      { filename: UI, code: `channel.send({ content: "x" });` },
      { filename: UI, note: "Passing the output of `render` is the supported way to send outside a handler.", code: `const { components, flags } = render(node);\nchannel.send({ components, flags });` },
      { filename: UI, note: "Clearing components with empty arrays is allowed.", code: `interaction.editReply({ components: [], embeds: [] });` },
    ],
  },
  {
    name: "valid-component-nesting",
    category: "ui",
    recommended: "error",
    description: "Check the static JSX structure of @teamneo/neocord-react components.",
    why: "The renderer throws when a component is in the wrong place, but only when that code path runs. This rule reports the same structure errors in your editor. It follows aliased imports from `@teamneo/neocord-react`, and skips custom components and expressions because it cannot see what they render.",
    messages: {
      misplaced: "<{{component}}> cannot be inside <{{parent}}>. It belongs in {{allowed}}.",
      messageNotRoot: "<Message> must be the root of the tree, not inside <{{parent}}>.",
      rowInvalidChild: "<{{component}}> cannot be inside <ActionRow>. A row holds buttons or a select.",
      rowMixed: "An <ActionRow> cannot mix buttons and selects. Put them in separate rows.",
      rowTooManyButtons: "An <ActionRow> can hold at most {{max}} buttons, but this one has {{count}}.",
      rowSelectNotAlone: "A select must be alone in its <ActionRow>.",
      sectionInvalidChild: "<{{component}}> cannot be a child of <Section>, which only takes text. Use the accessory prop for a button or thumbnail.",
      sectionInvalidAccessory: "<{{component}}> cannot be a Section accessory. Use <Button> or <Thumbnail>.",
      labelNoControl: "<Label> must contain exactly one form control, but this one has none.",
      labelManyControls: "<Label> must contain exactly one form control, but this one has {{count}}.",
    },
    incorrect: [
      { filename: UI, note: "These examples assume the components are imported from `@teamneo/neocord-react`.", code: `const node = <Message><Button /></Message>;` },
      { filename: UI, code: `const node = <Container><StringSelect /></Container>;` },
      { filename: UI, code: `const node = <Section accessory={<Button />}><Thumbnail /></Section>;` },
      { filename: UI, code: `const node = <Section accessory={<TextDisplay />}>Hi</Section>;` },
      { filename: UI, code: `const node = <ActionRow><Button /><StringSelect /></ActionRow>;` },
      { filename: UI, code: `const node = (\n  <ActionRow>\n    <Button /><Button /><Button /><Button /><Button /><Button />\n  </ActionRow>\n);` },
      { filename: UI, code: `const node = <ActionRow><UserSelect /><RoleSelect /></ActionRow>;` },
      { filename: UI, code: `const node = <ActionRow><TextDisplay /></ActionRow>;` },
      { filename: UI, code: `const node = <Label label="x">Text</Label>;` },
      { filename: UI, code: `const node = <Label label="x"><TextInput /><TextInput /></Label>;` },
      { filename: UI, code: `const node = <Modal><TextInput /></Modal>;` },
      { filename: UI, code: `const node = <Container><Message /></Container>;` },
    ],
    correct: [
      { filename: UI, code: `const node = <Message><ActionRow><Button /><Button /></ActionRow></Message>;` },
      { filename: UI, code: `const node = <ActionRow><StringSelect><Option /></StringSelect></ActionRow>;` },
      { filename: UI, code: `const node = <Section accessory={<Button />}>Hello <Bold>world</Bold></Section>;` },
      { filename: UI, code: `const node = <Section accessory={<Thumbnail />}><TextDisplay>Hi</TextDisplay></Section>;` },
      { filename: UI, code: `const node = <Modal><Label label="x"><TextInput /></Label></Modal>;` },
      { filename: UI, code: `const node = <Label label="x"><RadioGroup><Option /><Option /></RadioGroup></Label>;` },
      { filename: UI, code: `const node = <MediaGallery><MediaItem /><MediaItem /></MediaGallery>;` },
      { filename: UI, note: "A custom component could render anything, so it is skipped.", code: `const node = <Custom><Button /></Custom>;` },
      { filename: UI, note: "Expressions are skipped too.", code: `const node = <Message>{cond && <Button />}</Message>;` },
      { filename: UI, code: `import { Button as B, ActionRow as Row } from "@teamneo/neocord-react";\n\nconst node = <Row><B /></Row>;` },
    ],
  },
  {
    name: "prefer-route-prop",
    category: "ui",
    recommended: "warn",
    description: "Prefer the typed route prop over a hardcoded customId on buttons and selects.",
    why: "`route` is checked against your generated route types, so a typo fails to compile. A literal `customId` is checked by nothing and goes stale when a file moves. Selects inside a modal are exempt because their `customId` is a field name, and non-literal ids are left alone.",
    messages: {
      preferRoute: `Use route="..." on <{{component}}> instead of a literal customId, so the id is checked against your routes.`,
    },
    incorrect: [
      { filename: UI, code: `const node = <Button customId="moderation/ban" />;` },
      { filename: UI, code: `const node = <Button customId={"moderation/ban"} />;` },
      { filename: UI, code: `const node = <StringSelect customId="pick" />;` },
      { filename: UI, code: `const node = <ActionRow><RoleSelect customId="pick" /></ActionRow>;` },
      { filename: UI, code: `import { Button as B } from "@teamneo/neocord-react";\n\nconst node = <B customId="x" />;` },
    ],
    correct: [
      { filename: UI, code: `const node = <Button route="a/b" />;` },
      { filename: UI, code: `const node = <Button route="a/[id]" params={{ id }} />;` },
      { filename: UI, code: `const node = <Button customId={buildId()} />;` },
      { filename: UI, code: `const node = <Button onClick={handler} />;` },
      { filename: UI, code: `const node = <TextInput customId="field" />;` },
      { filename: UI, code: `const node = <Label label="x"><StringSelect customId="field" /></Label>;` },
      { filename: UI, code: `defineModal("a", {\n  render() {\n    return <UserSelect customId="x" />;\n  },\n});` },
    ],
  },
  {
    name: "no-text-in-action-row",
    category: "ui",
    recommended: "error",
    description: "Disallow text directly inside ActionRow, MediaGallery and select components.",
    why: "These components hold other components and have nowhere to put text, so the renderer throws. Text can sit directly in `Message`, `Container` and `Section`, and that makes this an easy mistake to make.",
    messages: {
      text: "<{{component}}> cannot contain text. Move it into a <TextDisplay> outside the component.",
    },
    incorrect: [
      { filename: UI, code: `const node = <ActionRow>Click</ActionRow>;` },
      { filename: UI, code: `const node = <ActionRow>{"Click"}</ActionRow>;` },
      { filename: UI, code: `const node = <ActionRow>{5}</ActionRow>;` },
      { filename: UI, code: `const node = <ActionRow><>Click</></ActionRow>;` },
      { filename: UI, code: `const node = <MediaGallery>Photo</MediaGallery>;` },
      { filename: UI, code: `const node = <StringSelect>Pick</StringSelect>;` },
      { filename: UI, code: `const node = <UserSelect>Pick</UserSelect>;` },
    ],
    correct: [
      { filename: UI, code: `const node = <ActionRow><Button>Label</Button></ActionRow>;` },
      { filename: UI, code: `const node = (\n  <ActionRow>\n    <Button />\n  </ActionRow>\n);` },
      { filename: UI, code: `const node = <ActionRow>{label}</ActionRow>;` },
      { filename: UI, code: `const node = <MediaGallery><MediaItem /></MediaGallery>;` },
      { filename: UI, code: `const node = <Message>Text</Message>;` },
    ],
  },
  {
    name: "no-direct-interaction-reply",
    category: "best-practices",
    recommended: "warn",
    description: "Disallow responding through ctx.interaction, which bypasses neocord's reply state and rendering.",
    why: "All replies go through one state machine, so the `autoDefer` timer cannot race a reply in flight. A direct call on `ctx.interaction` is invisible to it, and skips layouts and rendering as well. The rule follows aliases and destructuring of `ctx`, including `useContext()`.",
    messages: {
      direct: "Do not call interaction.{{method}}() directly, because it bypasses neocord's reply state and layouts. Use {{replacement}}.",
    },
    incorrect: [
      { code: `ctx.interaction.reply({ content: "x" });` },
      { code: `ctx.interaction.editReply({});` },
      { code: `ctx.interaction.deferReply();` },
      { code: `ctx.interaction.showModal(modal);` },
      { code: `const { interaction } = ctx;\ninteraction.reply({});` },
      { code: `defineCommand({\n  execute({ interaction }) {\n    interaction.reply({});\n  },\n});` },
      { code: `defineModal("a", { submit: (c) => c.interaction.reply({}) });` },
      { code: `defineMiddleware(async (c, next) => {\n  await c.interaction.reply({});\n});` },
      { code: `const c = useContext();\nc.interaction.reply({});` },
    ],
    correct: [
      { code: `ctx.reply(<X />);` },
      { note: "Reading properties and using type guards is fine.", code: `await ctx.interaction.deferred;` },
      { code: `ctx.interaction.isButton();` },
      { note: "An interaction that does not come from a handler context is not checked.", code: `function f(interaction) {\n  interaction.reply({});\n}` },
    ],
  },
  {
    name: "no-client-instantiation",
    category: "best-practices",
    recommended: "error",
    description: "Disallow creating discord.js clients or logging in from project source, because the framework owns both.",
    why: "`startBot` builds the client and logs in, and `startManager` wraps `ShardingManager`. A second client inside the source folder opens its own gateway connection, outside neocord's logging, shutdown and sharding. The rule only looks at files in the source folder, so a standalone script elsewhere is fine.",
    messages: {
      instantiation: "Do not create a {{name}} yourself. neocord owns it. Configure it through defineConfig and read ctx.client.",
      login: "Do not call .login() yourself. neocord logs in using the token from defineConfig.",
    },
    incorrect: [
      { filename: SOURCE, code: `import { Client } from "discord.js";\n\nnew Client({ intents: [] });` },
      { filename: SOURCE, code: `import { Client as C } from "discord.js";\n\nnew C({ intents: [] });` },
      { filename: SOURCE, code: `import { ShardingManager } from "discord.js";\n\nnew ShardingManager("x");` },
      { filename: SOURCE, code: `import * as Discord from "discord.js";\n\nnew Discord.Client({ intents: [] });` },
      { filename: SOURCE, code: `client.login(token);` },
      { filename: SOURCE, code: `ctx.client.login(token);` },
      { filename: SOURCE, code: `bot.login(token);` },
    ],
    correct: [
      { filename: SOURCE, note: "A `Client` from another package is unrelated.", code: `import { Client } from "pg";\n\nnew Client({ connectionString });` },
      { filename: SOURCE, code: `class Client {}\n\nnew Client();` },
      { filename: SOURCE, code: `auth.login(user, password);` },
      { filename: SOURCE, code: `ctx.client.user;` },
      { filename: "scripts/run.ts", note: "This file is outside the source folder.", code: `import { Client } from "discord.js";\n\nnew Client({ intents: [] });` },
    ],
  },
  {
    name: "no-process-env",
    category: "best-practices",
    recommended: "warn",
    description: "Disallow process.env outside src/env.ts and root config files, so variables stay validated in one place.",
    why: "`src/env.ts` validates variables once, at startup, so a missing value fails with a readable error instead of an `undefined` deep in a handler. The rule allows `process.env` in `src/env.ts` and in any `*.config.*` file at the project root, such as `drizzle.config.ts`. A config file in a nested folder is not exempt.",
    messages: {
      processEnv: "Do not read process.env here. Declare the variable in src/env.ts and import env from there.",
    },
    incorrect: [
      { filename: SOURCE, code: `const t = process.env.TOKEN;` },
      { filename: SOURCE, code: `const t = process["env"].TOKEN;` },
      { filename: SOURCE, code: `const t = globalThis.process.env.TOKEN;` },
      { filename: SOURCE, code: `const { env } = process;` },
      { filename: SOURCE, code: `import { env } from "node:process";` },
      { filename: SOURCE, code: `import p from "node:process";\n\np.env.TOKEN;` },
      { filename: "src/lib/env.ts", code: `process.env.TOKEN;` },
      { filename: "src/lib/drizzle.config.ts", code: `const url = process.env.DATABASE_URL;` },
    ],
    correct: [
      { filename: "src/env.ts", code: `export const env = process.env;` },
      { filename: "neocord.config.ts", code: `const t = process.env.TOKEN;` },
      { filename: "drizzle.config.ts", code: `const url = process.env.DATABASE_URL;` },
      { filename: "prisma.config.ts", code: `const url = process.env.DATABASE_URL;` },
      { filename: SOURCE, code: `import { env } from "./env";\n\nenv.TOKEN;` },
      { filename: SOURCE, code: `process.cwd();` },
      { filename: SOURCE, code: `function f(process) {\n  return process.env;\n}` },
    ],
  },
  {
    name: "no-hardcoded-token",
    category: "best-practices",
    recommended: "error",
    description: "Disallow string literals shaped like Discord bot tokens.",
    why: "A committed token gives full control of the bot, and has to be reset once it leaks. The rule looks for three dot-separated parts where the first decodes to a Discord snowflake, which keeps JWTs and ordinary dotted strings from matching. It checks string literals, template literals and JSX text.",
    messages: {
      token: "This looks like a Discord token. Move it to an environment variable and reset the token if it was committed.",
    },
    incorrect: [
      {
        note: "The strings below are shortened placeholders. The rule matches the full shape: 23-28 characters that decode to a user id, then 6-7 characters, then 27 or more characters.",
        code: `const token = "<base64 user id>.<timestamp>.<hmac>";`,
      },
      { code: `const header = "Bot <base64 user id>.<timestamp>.<hmac>";` },
      { code: "const header = `Bot <base64 user id>.<timestamp>.<hmac> ${suffix}`;" },
      { code: `const node = <X token="<base64 user id>.<timestamp>.<hmac>" />;` },
    ],
    correct: [
      { code: `const name = "hello.world.example";` },
      { code: `const token = process.env.DISCORD_TOKEN;` },
      { code: `const count = 5;` },
      { filename: "src/lib/token.ts", note: "A JWT or another string whose first part does not decode to a snowflake is not reported.", code: `const token = "<base64 json header>.<payload>.<signature>";` },
    ],
  },
  {
    name: "no-blocking-calls",
    category: "best-practices",
    recommended: "warn",
    description: "Disallow synchronous fs and child_process calls and Atomics.wait in route files.",
    why: "A bot runs on one event loop per shard. A synchronous call there stalls the gateway and every other interaction, and handlers only have three seconds to respond. The rule checks route files only, so a synchronous read at startup in a helper is not reported.",
    messages: {
      blocking: "{{name}}() blocks the event loop, which stalls the gateway and every other interaction. Use the asynchronous version.",
      atomics: "Atomics.wait() blocks the event loop, which stalls the gateway and every other interaction.",
    },
    incorrect: [
      { filename: COMMAND, code: `import { readFileSync } from "node:fs";\n\nreadFileSync("x");` },
      { filename: COMMAND, code: `import { existsSync as has } from "fs";\n\nhas("x");` },
      { filename: COMMAND, code: `import fs from "node:fs";\n\nfs.writeFileSync("x", "y");` },
      { filename: COMMAND, code: `import * as fs from "fs";\n\nfs.statSync("x");` },
      { filename: COMMAND, code: `import { execSync } from "node:child_process";\n\nexecSync("x");` },
      { filename: COMMAND, code: `Atomics.wait(buffer, 0, 0);` },
    ],
    correct: [
      { filename: COMMAND, code: `import { readFile } from "node:fs/promises";\n\nawait readFile("x");` },
      { filename: COMMAND, code: `import { exec } from "node:child_process";\n\nexec("x");` },
      { filename: COMMAND, code: `import { readFileSync } from "./mine";\n\nreadFileSync("x");` },
      { filename: SOURCE, note: "This file is not a route.", code: `import { readFileSync } from "node:fs";\n\nreadFileSync("x");` },
    ],
  },
  {
    name: "prefer-guild-only",
    category: "best-practices",
    recommended: "warn",
    suggestions: true,
    description: "Prefer guildOnly: true over asserting ctx.guild or ctx.member are non-null.",
    why: "With `guildOnly: true`, `ctx.guild` and `ctx.member` are non-null in the types, the command is hidden outside servers when it is deployed, and the runtime replies with a notice if it runs anywhere else. A non-null assertion does none of that and crashes the handler in a DM.",
    messages: {
      preferGuildOnly: "Add guildOnly: true instead of asserting ctx.{{property}}!, so Discord hides this outside servers and the type is non-null.",
      addGuildOnly: "Set guildOnly: true.",
    },
    incorrect: [
      { note: "The suggestion adds `guildOnly: true` to the definition.", code: `defineCommand({\n  execute(ctx) {\n    return ctx.guild!.id;\n  },\n});` },
      { code: `defineUserCommand({\n  name: "x",\n  execute(ctx) {\n    return ctx.member!.id;\n  },\n});` },
      { note: "The suggestion changes `false` to `true`.", code: `defineButton("a", {\n  guildOnly: false,\n  execute(ctx) {\n    return ctx.guild!.id;\n  },\n});` },
      { code: `defineMessageCommand({\n  execute({ guild }) {\n    return guild!.id;\n  },\n});` },
      { code: `defineSelect("a", {\n  execute(c) {\n    const g = c.guild;\n    return g!.id;\n  },\n});` },
    ],
    correct: [
      { code: `defineCommand({\n  guildOnly: true,\n  execute(ctx) {\n    return ctx.guild!.id;\n  },\n});` },
      { code: `defineCommand({\n  execute(ctx) {\n    return ctx.guild?.id;\n  },\n});` },
      { note: "A non-literal or spread could set `guildOnly`, so it is allowed.", code: `defineCommand({\n  guildOnly: isGuild,\n  execute(ctx) {\n    return ctx.guild!.id;\n  },\n});` },
      { note: "Tasks and events have no `guildOnly` option.", code: `defineTask({\n  execute(ctx) {\n    return ctx.guild!.id;\n  },\n});` },
    ],
  },
  {
    name: "no-unawaited-context-calls",
    category: "best-practices",
    recommended: "warn",
    suggestions: true,
    description: "Require promises from ctx response methods to be awaited, returned or explicitly voided.",
    why: "A failed reply that nobody awaits is an unhandled rejection rather than an error your error view can show. It also lets the handler finish before the reply is sent. The rule suggests `await` in an async function and `void` elsewhere, and any other use of the promise, such as `.catch` or `Promise.all`, is fine.",
    messages: {
      unawaited: "ctx.{{method}}() returns a promise. Await it, return it or mark it with void so failures are not lost.",
      addAwait: "Add await.",
      addVoid: "Mark it with void.",
    },
    incorrect: [
      { code: `async function f() {\n  ctx.reply(x);\n}` },
      { code: `function f() {\n  ctx.editReply(x);\n}` },
      { code: `async function f() {\n  ctx.deferUpdate();\n}` },
      { code: `defineCommand({\n  async execute(c) {\n    c.reply(x);\n  },\n});` },
      { code: `async function f() {\n  cond && ctx.reply(x);\n}` },
      { code: `async function f() {\n  cond ? ctx.reply(x) : other();\n}` },
      { code: `const c = useContext();\nfunction f() {\n  c.reply(x);\n}` },
    ],
    correct: [
      { code: `async function f() {\n  await ctx.reply(x);\n}` },
      { code: `function f() {\n  return ctx.reply(x);\n}` },
      { code: `void ctx.reply(x);` },
      { code: `const run = () => ctx.reply(x);` },
      { code: `ctx.reply(x).catch(handle);` },
      { code: `Promise.all([ctx.reply(x), ctx.followUp(y)]);` },
      { note: "Other methods on `ctx` are not checked.", code: `ctx.logger.info(x);` },
    ],
  },
  {
    name: "require-error-boundary",
    category: "best-practices",
    recommended: "off",
    description: "Require each feature to have its own error.tsx.",
    why: "Without its own `error.tsx`, a feature falls back to the nearest one above it, or to a built-in message. Turn this on if each feature should explain its own failures. It is reported once per feature, on `feature.ts` or the feature's first file, and only an `error.tsx` at the feature root counts.",
    messages: {
      missing: `Feature "{{feature}}" has no error.tsx. Add one so its failures show a useful message to users.`,
    },
    incorrect: [
      {
        filename: "src/features/anchored/feature.ts",
        note: "The feature has `feature.ts` and `commands/b/command.tsx` but no `error.tsx`, so `feature.ts` gets the report.",
        code: `export default defineFeature({});`,
      },
      {
        filename: "src/features/bare/commands/c/command.tsx",
        note: "The feature has no `feature.ts`, so its first file gets the report. `commands/d/command.tsx` does not.",
        code: COMMAND_BODY,
      },
      {
        filename: "src/features/nested/commands/e/command.tsx",
        note: "`commands/e/error.tsx` exists, but it is not at the feature root.",
        code: COMMAND_BODY,
      },
    ],
    correct: [
      {
        filename: "src/features/covered/commands/a/command.tsx",
        note: "`src/features/covered/error.tsx` exists.",
        code: COMMAND_BODY,
      },
      { filename: "src/env.ts", note: "Files outside a feature are not checked.", code: `export const env = {};` },
    ],
  },
  {
    name: "no-mass-mentions",
    category: "best-practices",
    recommended: "warn",
    description: "Disallow enabling @everyone in allowedMentions and writing mass mentions in JSX text.",
    why: "neocord sets `allowedMentions` to `{ parse: [] }` on the client so user input can never ping anyone. Adding `everyone` undoes that for the whole server. Literal `@everyone` in JSX text is either dead text or a mass ping, so the rule points to `RoleMention` instead, and ignores `Code` and `CodeBlock` from `@teamneo/neocord-react`.",
    messages: {
      parseEveryone: `Do not put "everyone" in allowedMentions.parse. It lets a message ping the whole server, including through user input.`,
      text: "Avoid literal @{{mention}} in JSX text. Mention a role with <RoleMention> instead.",
    },
    incorrect: [
      { code: `const options = { allowedMentions: { parse: ["everyone"] } };` },
      { code: `send({ allowedMentions: { parse: ["users", "everyone"] } });` },
      { code: `const node = <Message allowedMentions={{ parse: ["everyone"] }}>Hi</Message>;` },
      { code: `const node = <Message>Hey @everyone!</Message>;` },
      { code: `const node = <Message>Hey @here</Message>;` },
      { code: `const node = <Message>{"@everyone"}</Message>;` },
    ],
    correct: [
      { code: `const options = { allowedMentions: { parse: [] } };` },
      { code: `const options = { allowedMentions: { parse: ["users", "roles"] } };` },
      { code: `const node = <Message allowedMentions={shared}>Hi</Message>;` },
      { code: `const node = <Message>Mail me@everyone.com</Message>;` },
      { code: `const node = <Message>Hello everyone</Message>;` },
      { code: `import { Code } from "@teamneo/neocord-react";\n\nconst node = <Code>@everyone</Code>;` },
    ],
  },
];
