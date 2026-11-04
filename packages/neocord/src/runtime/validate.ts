import {
  COMMAND_SEGMENT_PATTERN,
  CUSTOM_ID_MAX_LENGTH,
  MAX_COMMAND_DEPTH,
  createRouter,
  parseSegment,
  type RouteKind,
  type Router,
} from "@neocord/routing";
import type { LocalizationMap } from "discord.js";
import type { IntentName, NeocordConfig } from "../config.ts";
import { parseDuration } from "../duration.ts";
import type {
  CommandDefinition,
  EventDefinition,
  GroupDefinition,
  Manifest,
  ManifestModule,
  ManifestRoute,
  ModuleNamespace,
  OptionDefinition,
  OptionKind,
  TaskDefinition,
} from "../types.ts";
import { brandOf, describeHelper, enabledManifest, groupDefinition, mergedIntents } from "./manifest.ts";

export interface ManifestIssue {
  severity: "error" | "warning";
  file: string;
  message: string;
}

const MAX_NAME_LENGTH = 32;
const MAX_DESCRIPTION_LENGTH = 100;
const MAX_OPTIONS = 25;
const MAX_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;
const MAX_CHAT_COMMANDS = 100;
const MAX_CONTEXT_COMMANDS = 15;
const MAX_CHOICE_VALUE_LENGTH = 100;
const MAX_COMMAND_CHARACTERS = 8000;
const MAX_STRING_OPTION_LENGTH = 6000;
const MAX_INTEGER_OPTION_VALUE = 2 ** 53 - 1;
const MAX_NUMBER_OPTION_VALUE = 2 ** 53;
const MAX_TIMER_MS = 2_147_483_647;
const CHOICE_KINDS: readonly OptionKind[] = ["string", "integer", "number"];
const CONFIG_FILE = "neocord.config.ts";

interface IntentRequirement {
  anyOf: readonly IntentName[];
  note?: { intent: IntentName; message: string };
}

function needs(...anyOf: readonly IntentName[]): IntentRequirement {
  return { anyOf };
}

const MESSAGE_CONTENT_NOTE = {
  intent: "MessageContent",
  message: "message.content, embeds and attachments stay empty without the privileged MessageContent intent",
} as const;

const EVENT_INTENTS: Readonly<Record<string, IntentRequirement>> = {
  guildCreate: needs("Guilds"),
  guildDelete: needs("Guilds"),
  guildUpdate: needs("Guilds"),
  guildAvailable: needs("Guilds"),
  guildUnavailable: needs("Guilds"),
  roleCreate: needs("Guilds"),
  roleDelete: needs("Guilds"),
  roleUpdate: needs("Guilds"),
  channelCreate: needs("Guilds"),
  channelDelete: needs("Guilds"),
  channelUpdate: needs("Guilds"),
  channelPinsUpdate: needs("Guilds", "DirectMessages"),
  threadCreate: needs("Guilds"),
  threadDelete: needs("Guilds"),
  threadUpdate: needs("Guilds"),
  threadListSync: needs("Guilds"),
  stageInstanceCreate: needs("Guilds"),
  stageInstanceDelete: needs("Guilds"),
  stageInstanceUpdate: needs("Guilds"),
  guildMemberAdd: needs("GuildMembers"),
  guildMemberRemove: needs("GuildMembers"),
  guildMemberUpdate: needs("GuildMembers"),
  guildMembersChunk: needs("GuildMembers"),
  threadMembersUpdate: needs("GuildMembers"),
  guildBanAdd: needs("GuildModeration"),
  guildBanRemove: needs("GuildModeration"),
  guildAuditLogEntryCreate: needs("GuildModeration"),
  emojiCreate: needs("GuildExpressions"),
  emojiDelete: needs("GuildExpressions"),
  emojiUpdate: needs("GuildExpressions"),
  stickerCreate: needs("GuildExpressions"),
  stickerDelete: needs("GuildExpressions"),
  stickerUpdate: needs("GuildExpressions"),
  guildIntegrationsUpdate: needs("GuildIntegrations"),
  webhooksUpdate: needs("GuildWebhooks"),
  inviteCreate: needs("GuildInvites"),
  inviteDelete: needs("GuildInvites"),
  voiceStateUpdate: needs("GuildVoiceStates"),
  presenceUpdate: needs("GuildPresences"),
  messageCreate: { anyOf: ["GuildMessages", "DirectMessages"], note: MESSAGE_CONTENT_NOTE },
  messageUpdate: { anyOf: ["GuildMessages", "DirectMessages"], note: MESSAGE_CONTENT_NOTE },
  messageDelete: needs("GuildMessages", "DirectMessages"),
  messageDeleteBulk: needs("GuildMessages"),
  messageReactionAdd: needs("GuildMessageReactions", "DirectMessageReactions"),
  messageReactionRemove: needs("GuildMessageReactions", "DirectMessageReactions"),
  messageReactionRemoveAll: needs("GuildMessageReactions", "DirectMessageReactions"),
  messageReactionRemoveEmoji: needs("GuildMessageReactions", "DirectMessageReactions"),
  typingStart: needs("GuildMessageTyping", "DirectMessageTyping"),
  guildScheduledEventCreate: needs("GuildScheduledEvents"),
  guildScheduledEventDelete: needs("GuildScheduledEvents"),
  guildScheduledEventUpdate: needs("GuildScheduledEvents"),
  guildScheduledEventUserAdd: needs("GuildScheduledEvents"),
  guildScheduledEventUserRemove: needs("GuildScheduledEvents"),
  autoModerationRuleCreate: needs("AutoModerationConfiguration"),
  autoModerationRuleDelete: needs("AutoModerationConfiguration"),
  autoModerationRuleUpdate: needs("AutoModerationConfiguration"),
  autoModerationActionExecution: needs("AutoModerationExecution"),
  messagePollVoteAdd: needs("GuildMessagePolls", "DirectMessagePolls"),
  messagePollVoteRemove: needs("GuildMessagePolls", "DirectMessagePolls"),
};

const INTERACTION_ROUTE_KINDS: readonly RouteKind[] = ["button", "select", "modal"];

function checkLength(value: unknown, max: number): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}

function isValidCommandName(name: string): boolean {
  return COMMAND_SEGMENT_PATTERN.test(name) && name === name.toLowerCase();
}

function checkDuration(value: unknown, file: string, label: string, issues: ManifestIssue[]): number | null {
  try {
    return parseDuration(value as Parameters<typeof parseDuration>[0]);
  } catch (error) {
    issues.push({ severity: "error", file, message: `${label}: ${(error as Error).message}` });
    return null;
  }
}

function checkOption(name: string, option: OptionDefinition, command: string, file: string, issues: ManifestIssue[]): void {
  const add = (message: string): void => {
    issues.push({ severity: "error", file, message: `/${command} option "${name}" ${message}` });
  };

  if (!isValidCommandName(name)) add("has an invalid name. Option names are lowercase, 1-32 characters.");
  if (option.__neocord !== "option") {
    add("must be created with an option.* helper.");
    return;
  }
  if (!checkLength(option.description, MAX_DESCRIPTION_LENGTH)) {
    add(`needs a description of 1-${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  if (option.choices !== undefined && option.autocomplete !== undefined) {
    add("cannot use both choices and autocomplete.");
  }
  if (option.autocomplete !== undefined && !CHOICE_KINDS.includes(option.kind)) {
    add(`cannot use autocomplete, which only applies to string, integer and number options.`);
  }
  if (option.choices !== undefined) {
    if (!CHOICE_KINDS.includes(option.kind)) add("cannot have choices, which only apply to string, integer and number options.");
    if (option.choices.length < 1 || option.choices.length > MAX_CHOICES) add(`needs 1-${MAX_CHOICES} choices.`);
    for (const choice of option.choices) {
      if (!checkLength(choice.name, MAX_CHOICE_NAME_LENGTH)) {
        add(`has a choice name outside 1-${MAX_CHOICE_NAME_LENGTH} characters: "${String(choice.name)}".`);
      }
      checkLocalizations(choice.nameLocalizations, MAX_CHOICE_NAME_LENGTH, "choice name", add);
      checkChoiceValue(option.kind, choice.value, add);
    }
  }
  checkLocalizations(option.descriptionLocalizations, MAX_DESCRIPTION_LENGTH, "description", add);
  checkNameLocalizations(option.nameLocalizations, add);
  checkOptionBounds(option, add);
}

function checkChoiceValue(kind: OptionKind, value: unknown, add: (message: string) => void): void {
  if (kind === "string") {
    if (typeof value !== "string") {
      add(`has a choice value that must be a string: ${String(value)}.`);
    } else if (!checkLength(value, MAX_CHOICE_VALUE_LENGTH)) {
      add(`has a choice value outside 1-${MAX_CHOICE_VALUE_LENGTH} characters: "${value}".`);
    }
    return;
  }
  if (!CHOICE_KINDS.includes(kind)) return;
  if (typeof value !== "number") {
    add(`has a choice value that must be a${kind === "integer" ? "n integer" : " number"}: ${String(value)}.`);
  } else if (kind === "integer" && !Number.isInteger(value)) {
    add(`has a choice value that must be an integer: ${value}.`);
  } else if (!inNumberRange(kind, value)) {
    add(`has a choice value that must be ${describeNumberRange(kind)}: ${value}.`);
  }
}

function inNumberRange(kind: OptionKind, value: number): boolean {
  const limit = kind === "integer" ? MAX_INTEGER_OPTION_VALUE : MAX_NUMBER_OPTION_VALUE;
  return Number.isFinite(value) && Math.abs(value) <= limit;
}

function describeNumberRange(kind: OptionKind): string {
  return kind === "integer"
    ? `an integer between -${MAX_INTEGER_OPTION_VALUE} and ${MAX_INTEGER_OPTION_VALUE}`
    : `a number between -${MAX_NUMBER_OPTION_VALUE} and ${MAX_NUMBER_OPTION_VALUE}`;
}

function checkOptionBounds(option: OptionDefinition, add: (message: string) => void): void {
  const { kind, minLength, maxLength, minValue, maxValue, channelTypes } = option;

  if (minLength !== undefined || maxLength !== undefined) {
    if (kind !== "string") {
      add("sets minLength or maxLength, but minLength and maxLength only apply to string options.");
    } else {
      if (minLength !== undefined && !(Number.isInteger(minLength) && minLength >= 0 && minLength <= MAX_STRING_OPTION_LENGTH)) {
        add(`minLength must be an integer between 0 and ${MAX_STRING_OPTION_LENGTH}.`);
      }
      if (maxLength !== undefined && !(Number.isInteger(maxLength) && maxLength >= 1 && maxLength <= MAX_STRING_OPTION_LENGTH)) {
        add(`maxLength must be an integer between 1 and ${MAX_STRING_OPTION_LENGTH}.`);
      }
      if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) add("minLength cannot exceed maxLength.");
    }
  }

  if (minValue !== undefined || maxValue !== undefined) {
    if (kind !== "integer" && kind !== "number") {
      add("sets minValue or maxValue, but minValue and maxValue only apply to integer and number options.");
    } else {
      const valid = (value: number): boolean => inNumberRange(kind, value) && (kind === "number" || Number.isInteger(value));
      if (minValue !== undefined && !valid(minValue)) add(`minValue must be ${describeNumberRange(kind)}.`);
      if (maxValue !== undefined && !valid(maxValue)) add(`maxValue must be ${describeNumberRange(kind)}.`);
      if (minValue !== undefined && maxValue !== undefined && minValue > maxValue) add("minValue cannot exceed maxValue.");
    }
  }

  if (channelTypes !== undefined && kind !== "channel") add("sets channelTypes, but channelTypes only apply to channel options.");
}

function checkNameLocalizations(localizations: LocalizationMap | null | undefined, add: (message: string) => void): void {
  for (const [locale, name] of Object.entries(localizations ?? {})) {
    if (typeof name === "string" && !isValidCommandName(name)) {
      add(`has an invalid localized name for "${locale}". Names are lowercase, 1-${MAX_NAME_LENGTH} characters.`);
    }
  }
}

function checkLocalizations(
  localizations: LocalizationMap | null | undefined,
  max: number,
  label: string,
  add: (message: string) => void,
): void {
  for (const [locale, text] of Object.entries(localizations ?? {})) {
    if (typeof text === "string" && !checkLength(text, max)) {
      add(`has an invalid localized ${label} for "${locale}". It must be 1-${max} characters.`);
    }
  }
}

function checkLocalizedOptionNames(
  options: readonly (readonly [string, OptionDefinition])[],
  command: string,
  file: string,
  issues: ManifestIssue[],
): void {
  const defaults = new Set(options.map(([name]) => name));
  const seen = new Map<string, string>();
  for (const [name, option] of options) {
    for (const [locale, localized] of Object.entries(option.nameLocalizations ?? {})) {
      if (typeof localized !== "string") continue;
      const key = `${locale}\u0000${localized}`;
      const earlier = seen.get(key);
      if ((defaults.has(localized) && localized !== name) || (earlier !== undefined && earlier !== name)) {
        issues.push({
          severity: "error",
          file,
          message: `/${command} option "${name}" has a localized name "${localized}" for "${locale}" that collides with another option. Localized option names must differ from every default option name and from other names in the same locale.`,
        });
      }
      seen.set(key, name);
    }
  }
}

function longestField(value: unknown, localizations: LocalizationMap | null | undefined): number {
  const base = value === undefined || value === null ? 0 : String(value).length;
  return Object.values(localizations ?? {}).reduce<number>(
    (longest, text) => (typeof text === "string" ? Math.max(longest, text.length) : longest),
    base,
  );
}

function optionCharacters(name: string, option: OptionDefinition): number {
  if (option.__neocord !== "option") return 0;
  const own = longestField(name, option.nameLocalizations) + longestField(option.description, option.descriptionLocalizations);
  return (option.choices ?? []).reduce(
    (total, choice) => total + longestField(choice.name, choice.nameLocalizations) + longestField(choice.value, undefined),
    own,
  );
}

function leafCharacters(segment: string, definition: CommandDefinition): number {
  const own = longestField(segment, definition.nameLocalizations) + longestField(definition.description, definition.descriptionLocalizations);
  return Object.entries(definition.options ?? {}).reduce((total, [name, option]) => total + optionCharacters(name, option), own);
}

function checkCommandSizes(manifest: Manifest, routes: readonly ManifestRoute[], issues: ManifestIssue[]): void {
  const roots = new Map<string, { characters: number; file: string; parents: Set<string> }>();
  const groups = new Map(manifest.groups.map((group) => [group.segments.join(" "), group]));
  for (const route of routes) {
    const root = route.segments[0];
    if (root === undefined) continue;
    const entry = roots.get(root) ?? { characters: 0, file: route.file, parents: new Set<string>() };
    roots.set(root, entry);
    const leaf = route.segments.at(-1) ?? root;
    entry.characters += leafCharacters(leaf, route.module.default as CommandDefinition);
    for (let depth = 1; depth < route.segments.length; depth++) {
      const path = route.segments.slice(0, depth).join(" ");
      if (entry.parents.has(path)) continue;
      entry.parents.add(path);
      const group = groups.get(path);
      const definition = group === undefined ? null : groupDefinition(group.module);
      entry.characters +=
        longestField(route.segments[depth - 1], definition?.nameLocalizations) +
        longestField(definition?.description, definition?.descriptionLocalizations);
    }
  }
  for (const [root, { characters, file }] of roots) {
    if (characters > MAX_COMMAND_CHARACTERS) {
      issues.push({
        severity: "error",
        file,
        message: `/${root} uses ${characters} characters across its names, descriptions and choices, counting subcommands and the longest localization of each field. Discord allows ${MAX_COMMAND_CHARACTERS}.`,
      });
    }
  }
}

function rootGroupIsGuildOnly(manifest: Manifest, route: ManifestRoute): boolean {
  return manifest.groups.some(
    (group) =>
      group.segments.length === 1 &&
      group.segments[0] === route.segments[0] &&
      groupDefinition(group.module)?.guildOnly === true,
  );
}

function checkCommand(manifest: Manifest, route: ManifestRoute, issues: ManifestIssue[]): void {
  const { file, id, segments } = route;
  const definition = route.module.default as CommandDefinition;

  if (segments.length < 1 || segments.length > MAX_COMMAND_DEPTH) {
    issues.push({
      severity: "error",
      file,
      message: `/${id} is ${segments.length} levels deep. Commands allow at most ${MAX_COMMAND_DEPTH} segments.`,
    });
  }
  for (const segment of segments) {
    if (!isValidCommandName(segment)) {
      issues.push({ severity: "error", file, message: `"${segment}" is not a valid command name. Names are lowercase, 1-32 characters.` });
    }
  }
  if (id !== segments.join(" ")) {
    issues.push({ severity: "error", file, message: `Route id "${id}" does not match its segments "${segments.join(" ")}".` });
  }
  if (!checkLength(definition.description, MAX_DESCRIPTION_LENGTH)) {
    issues.push({ severity: "error", file, message: `/${id} needs a description of 1-${MAX_DESCRIPTION_LENGTH} characters.` });
  }

  const options = Object.entries(definition.options ?? {});
  if (options.length > MAX_OPTIONS) {
    issues.push({ severity: "error", file, message: `/${id} has ${options.length} options. Discord allows ${MAX_OPTIONS}.` });
  }
  for (const [name, option] of options) checkOption(name, option, id, file, issues);
  checkLocalizedOptionNames(options, id, file, issues);

  const addCommandIssue = (message: string): void => {
    issues.push({ severity: "error", file, message: `/${id} ${message}` });
  };
  checkNameLocalizations(definition.nameLocalizations, addCommandIssue);
  checkLocalizations(definition.descriptionLocalizations, MAX_DESCRIPTION_LENGTH, "description", addCommandIssue);

  if (segments.length > 1) {
    if (definition.nsfw !== undefined) {
      issues.push({
        severity: "warning",
        file,
        message: `/${id} sets nsfw on a subcommand. Discord only reads nsfw on the top-level command, so it is ignored here. Use defineGroup({ nsfw: true }) on the top-level group.`,
      });
    }
    if (definition.permissions !== undefined && definition.permissions.length > 0) {
      issues.push({
        severity: "warning",
        file,
        message: `/${id} sets permissions on a subcommand. Discord only stores them on the top-level command, so they are enforced at runtime only. Use defineGroup({ permissions }) to hide it in the client.`,
      });
    }
    if (definition.guildOnly === true && !rootGroupIsGuildOnly(manifest, route)) {
      issues.push({
        severity: "warning",
        file,
        message: `/${id} sets guildOnly on a subcommand. It is enforced at runtime only. Use defineGroup({ guildOnly: true }) to deploy it.`,
      });
    }
  }
}

function checkCommandTree(manifest: Manifest, routes: readonly ManifestRoute[], issues: ManifestIssue[]): void {
  const leaves = new Map<string, ManifestRoute>();
  for (const route of routes) {
    const existing = leaves.get(route.id);
    if (existing !== undefined) {
      issues.push({
        severity: "error",
        file: route.file,
        message: `/${route.id} is also defined by ${existing.file} (feature "${existing.feature}"). Slash commands are global, so names must be unique across features.`,
      });
    } else {
      leaves.set(route.id, route);
    }
  }

  const parents = new Map<string, ManifestRoute>();
  const childCounts = new Map<string, Set<string>>();
  const roots = new Set<string>();
  for (const route of routes) {
    roots.add(route.segments[0] ?? "");
    for (let depth = 1; depth < route.segments.length; depth++) {
      const path = route.segments.slice(0, depth).join(" ");
      if (!parents.has(path)) parents.set(path, route);
      const children = childCounts.get(path) ?? new Set<string>();
      children.add(route.segments[depth] ?? "");
      childCounts.set(path, children);
    }
  }

  if (roots.size > MAX_CHAT_COMMANDS) {
    issues.push({
      severity: "error",
      file: routes[0]?.file ?? "manifest",
      message: `There are ${roots.size} top-level slash commands. Discord allows ${MAX_CHAT_COMMANDS}.`,
    });
  }

  for (const [path, children] of childCounts) {
    if (children.size > MAX_OPTIONS) {
      issues.push({
        severity: "error",
        file: parents.get(path)?.file ?? "manifest",
        message: `/${path} has ${children.size} children. Discord allows ${MAX_OPTIONS}.`,
      });
    }
  }

  const groups = new Map<string, Manifest["groups"][number]>();
  for (const group of manifest.groups) {
    const key = group.segments.join(" ");
    const existing = groups.get(key);
    if (existing !== undefined) {
      issues.push({ severity: "error", file: group.file, message: `Group "/${key}" is also defined by ${existing.file}.` });
    }
    groups.set(key, group);

    if (brandOf(group.module) !== "group") {
      issues.push({ severity: "error", file: group.file, message: `${group.file} must default export ${describeHelper("group")}.` });
      continue;
    }
    const definition = group.module.default as GroupDefinition;
    if (!checkLength(definition.description, MAX_DESCRIPTION_LENGTH)) {
      issues.push({ severity: "error", file: group.file, message: `Group "/${key}" needs a description of 1-${MAX_DESCRIPTION_LENGTH} characters.` });
    }
    if (group.segments.length >= MAX_COMMAND_DEPTH) {
      issues.push({ severity: "error", file: group.file, message: `Group "/${key}" is too deep. Groups allow at most ${MAX_COMMAND_DEPTH - 1} segments.` });
    }
    if (leaves.has(key)) {
      issues.push({ severity: "error", file: group.file, message: `"/${key}" cannot be both a group and a command (${leaves.get(key)?.file}).` });
    } else if (!parents.has(key)) {
      issues.push({ severity: "warning", file: group.file, message: `Group "/${key}" has no subcommands.` });
    }
    if (group.segments.length > 1 && (definition.permissions !== undefined || definition.guildOnly !== undefined)) {
      issues.push({
        severity: "warning",
        file: group.file,
        message: `Group "/${key}" is nested, so its permissions and guildOnly are enforced at runtime only. Set them on the top-level group to deploy them.`,
      });
    }
    if (group.segments.length > 1 && definition.nsfw !== undefined) {
      issues.push({
        severity: "warning",
        file: group.file,
        message: `Group "/${key}" is nested, so its nsfw is ignored. Discord only reads nsfw on the top-level command.`,
      });
    }
    const addGroupIssue = (message: string): void => {
      issues.push({ severity: "error", file: group.file, message: `Group "/${key}" ${message}` });
    };
    checkNameLocalizations(definition.nameLocalizations, addGroupIssue);
    checkLocalizations(definition.descriptionLocalizations, MAX_DESCRIPTION_LENGTH, "description", addGroupIssue);
  }

  for (const [path, route] of parents) {
    if (leaves.has(path)) {
      issues.push({
        severity: "error",
        file: leaves.get(path)?.file ?? route.file,
        message: `"/${path}" cannot be both a command and a parent of subcommands (${route.file}).`,
      });
    }
    if (!groups.has(path)) {
      issues.push({
        severity: "error",
        file: route.file,
        message: `"/${path}" has subcommands but no group.ts. Add defineGroup({ description }) for "/${path}", because Discord requires a description.`,
      });
    }
  }
}

function checkContextMenus(routes: readonly ManifestRoute[], kind: RouteKind, issues: ManifestIssue[]): void {
  const names = new Map<string, ManifestRoute>();
  for (const route of routes.filter((candidate) => candidate.kind === kind)) {
    const name = (route.module.default as { name?: unknown }).name;
    if (!checkLength(name, MAX_NAME_LENGTH)) {
      issues.push({ severity: "error", file: route.file, message: `${kind} needs a name of 1-${MAX_NAME_LENGTH} characters.` });
      continue;
    }
    const localizations = (route.module.default as { nameLocalizations?: LocalizationMap }).nameLocalizations;
    checkLocalizations(localizations, MAX_NAME_LENGTH, "name", (message) => {
      issues.push({ severity: "error", file: route.file, message: `${kind} "${String(name)}" ${message}` });
    });
    const existing = names.get(name as string);
    if (existing !== undefined) {
      issues.push({ severity: "error", file: route.file, message: `${kind} "${String(name)}" is also defined by ${existing.file}.` });
    }
    names.set(name as string, route);
  }
  if (names.size > MAX_CONTEXT_COMMANDS) {
    issues.push({
      severity: "error",
      file: routes[0]?.file ?? "manifest",
      message: `There are ${names.size} ${kind}s. Discord allows ${MAX_CONTEXT_COMMANDS}.`,
    });
  }
}

function staticLength(routeId: string): number {
  return routeId
    .split("/")
    .map((segment) => {
      const parsed = parseSegment(segment);
      return parsed.type === "static" ? parsed.value.length : 1;
    })
    .reduce((total, length) => total + length + 1, -1);
}

function checkInteractionRoutes(routes: readonly ManifestRoute[], issues: ManifestIssue[]): void {
  const routers = new Map<RouteKind, Router<ManifestRoute>>();
  for (const route of routes) {
    if (!INTERACTION_ROUTE_KINDS.includes(route.kind)) continue;

    const literal = (route.module.default as { route?: unknown }).route;
    if (literal !== route.id) {
      issues.push({
        severity: "error",
        file: route.file,
        message: `${describeHelper(route.kind).replace("(...)", "")}() was given "${String(literal)}" but this file's route is "${route.id}".`,
      });
    }
    if (route.id.startsWith("~")) {
      issues.push({ severity: "error", file: route.file, message: `Route "${route.id}" starts with "~", which is reserved for live sessions.` });
    }
    if (staticLength(route.id) > CUSTOM_ID_MAX_LENGTH) {
      issues.push({
        severity: "error",
        file: route.file,
        message: `Route "${route.id}" exceeds Discord's ${CUSTOM_ID_MAX_LENGTH} character custom id limit.`,
      });
    }

    const router = routers.get(route.kind) ?? createRouter<ManifestRoute>();
    routers.set(route.kind, router);
    try {
      router.add(route.id, route);
    } catch (error) {
      issues.push({ severity: "error", file: route.file, message: (error as Error).message });
    }
  }
}

function checkEventsAndTasks(routes: readonly ManifestRoute[], issues: ManifestIssue[]): void {
  for (const route of routes) {
    if (route.kind === "event") {
      const definition = route.module.default as EventDefinition;
      if (definition.event !== route.id) {
        issues.push({
          severity: "error",
          file: route.file,
          message: `defineEvent() was given "${String(definition.event)}" but this file's event is "${route.id}".`,
        });
      }
    } else if (route.kind === "task") {
      const definition = route.module.default as TaskDefinition;
      const every = checkDuration(definition.every, route.file, "every", issues);
      if (every !== null && (every <= 0 || every > MAX_TIMER_MS)) {
        issues.push({
          severity: "error",
          file: route.file,
          message: `every must be between 1ms and ${MAX_TIMER_MS}ms (about 24.8 days).`,
        });
      }
    }
    const cooldown = (route.module.default as { cooldown?: unknown }).cooldown;
    if (cooldown !== undefined) checkDuration(cooldown, route.file, "cooldown", issues);
  }
}

function checkBrands(manifest: Manifest, issues: ManifestIssue[]): void {
  const seen = new Set<string>();

  const expectBrand = (file: string, module: ModuleNamespace, brand: string): boolean => {
    if (brandOf(module) === brand) return true;
    issues.push({
      severity: "error",
      file,
      message: `${file} must default export ${describeHelper(brand)}. Its default export has no "${brand}" brand.`,
    });
    return false;
  };

  const expectComponent = ({ file, module }: ManifestModule, label: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    if (typeof module.default !== "function") {
      issues.push({ severity: "error", file, message: `${file} must default export a React component to be used as ${label}.` });
    }
  };

  for (const route of manifest.routes) {
    expectBrand(route.file, route.module, route.kind);
    for (const entry of route.middleware) {
      if (!seen.has(entry.file)) {
        seen.add(entry.file);
        expectBrand(entry.file, entry.module, "middleware");
      }
    }
    for (const entry of route.layouts) expectComponent(entry, "a layout");
    if (route.error !== null) expectComponent(route.error, "an error view");
    if (route.loading !== null) expectComponent(route.loading, "a loading view");
  }
}

function checkIntents(routes: readonly ManifestRoute[], enabled: ReadonlySet<IntentName>, issues: ManifestIssue[]): void {
  for (const route of routes) {
    if (route.kind !== "event") continue;
    const requirement = EVENT_INTENTS[route.id];
    if (requirement === undefined) continue;
    if (!requirement.anyOf.some((intent) => enabled.has(intent))) {
      issues.push({
        severity: "warning",
        file: route.file,
        message: `Event "${route.id}" needs the ${requirement.anyOf.join(" or ")} intent, which is not enabled. Add it to config.intents or the feature's intents.`,
      });
    }
    if (requirement.note !== undefined && !enabled.has(requirement.note.intent)) {
      issues.push({ severity: "warning", file: route.file, message: `Event "${route.id}": ${requirement.note.message}.` });
    }
  }
}

export function validateManifest(manifest: Manifest, config?: NeocordConfig): ManifestIssue[] {
  const issues: ManifestIssue[] = [];

  if (manifest.context !== null && brandOf(manifest.context) !== "context") {
    issues.push({ severity: "error", file: "src/context.ts", message: `src/context.ts must default export ${describeHelper("context")}.` });
  }
  for (const { name, module } of manifest.features) {
    if (module !== null && brandOf(module) !== "feature") {
      issues.push({
        severity: "error",
        file: `features/${name}/feature.ts`,
        message: `Feature "${name}" must default export ${describeHelper("feature")}.`,
      });
    }
  }

  const enabled = enabledManifest(manifest);
  checkBrands(enabled, issues);
  const invalid = new Set(issues.map((issue) => issue.file));
  const routes = enabled.routes.filter((route) => !invalid.has(route.file));
  const commands = routes.filter((route) => route.kind === "command");
  for (const route of commands) checkCommand(enabled, route, issues);
  checkCommandTree(enabled, commands, issues);
  checkCommandSizes(enabled, commands, issues);
  checkContextMenus(routes, "user-command", issues);
  checkContextMenus(routes, "message-command", issues);
  checkInteractionRoutes(routes, issues);
  checkEventsAndTasks(routes, issues);

  if (config !== undefined) {
    const intents = new Set(mergedIntents(manifest, config.intents));
    checkIntents(routes, intents, issues);
    if (!intents.has("Guilds")) {
      issues.push({
        severity: "warning",
        file: CONFIG_FILE,
        message: `The Guilds intent is not enabled, so guilds, roles and channels are not cached. ctx.guild can be null without it.`,
      });
    }
    if (config.live?.ttl !== undefined) {
      const ttl = checkDuration(config.live.ttl, CONFIG_FILE, "live.ttl", issues);
      if (ttl !== null && (ttl <= 0 || ttl > MAX_TIMER_MS)) {
        issues.push({
          severity: "error",
          file: CONFIG_FILE,
          message: `live.ttl must be between 1ms and ${MAX_TIMER_MS}ms (about 24.8 days), received ${String(config.live.ttl)}.`,
        });
      }
    }
  }

  return issues;
}
