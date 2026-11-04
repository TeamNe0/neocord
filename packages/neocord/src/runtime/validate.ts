import {
  COMMAND_SEGMENT_PATTERN,
  CUSTOM_ID_MAX_LENGTH,
  MAX_COMMAND_DEPTH,
  createRouter,
  parseSegment,
  type RouteKind,
  type Router,
} from "@neocord/routing";
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
  TaskDefinition,
} from "../types.ts";
import { brandOf, describeHelper, enabledManifest, mergedIntents } from "./manifest.ts";

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
const MAX_TIMER_MS = 2_147_483_647;

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
  if (option.choices !== undefined) {
    if (option.choices.length < 1 || option.choices.length > MAX_CHOICES) add(`needs 1-${MAX_CHOICES} choices.`);
    for (const choice of option.choices) {
      if (!checkLength(choice.name, MAX_CHOICE_NAME_LENGTH)) {
        add(`has a choice name outside 1-${MAX_CHOICE_NAME_LENGTH} characters: "${String(choice.name)}".`);
      }
    }
  }
}

function checkCommand(route: ManifestRoute, issues: ManifestIssue[]): void {
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

  if (segments.length > 1) {
    if (definition.permissions !== undefined && definition.permissions.length > 0) {
      issues.push({
        severity: "warning",
        file,
        message: `/${id} sets permissions on a subcommand. Discord only stores them on the top-level command, so they are enforced at runtime only. Use defineGroup({ permissions }) to hide it in the client.`,
      });
    }
    if (definition.guildOnly === true) {
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
  for (const route of commands) checkCommand(route, issues);
  checkCommandTree(enabled, commands, issues);
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
        file: "neocord.config.ts",
        message: `The Guilds intent is not enabled, so guilds, roles and channels are not cached. ctx.guild can be null without it.`,
      });
    }
  }

  return issues;
}
