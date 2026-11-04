import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  Base,
  InteractionContextType,
  PermissionsBitField,
  type APIApplicationCommandBasicOption,
  type APIApplicationCommandOption,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type RESTPostAPIApplicationCommandsJSONBody,
  type RESTPutAPIApplicationCommandsJSONBody,
  type Role,
} from "discord.js";
import type {
  CommandDefinition,
  GroupDefinition,
  Manifest,
  ManifestRoute,
  OptionDefinition,
  OptionKind,
} from "../types.ts";
import { brandOf, enabledManifest, groupDefinition } from "./manifest.ts";

const OPTION_TYPES: Record<OptionKind, ApplicationCommandOptionType> = {
  string: ApplicationCommandOptionType.String,
  integer: ApplicationCommandOptionType.Integer,
  number: ApplicationCommandOptionType.Number,
  boolean: ApplicationCommandOptionType.Boolean,
  user: ApplicationCommandOptionType.User,
  member: ApplicationCommandOptionType.User,
  channel: ApplicationCommandOptionType.Channel,
  role: ApplicationCommandOptionType.Role,
  mentionable: ApplicationCommandOptionType.Mentionable,
  attachment: ApplicationCommandOptionType.Attachment,
};

function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function serializeOption(name: string, definition: OptionDefinition): APIApplicationCommandBasicOption {
  return defined({
    type: OPTION_TYPES[definition.kind],
    name,
    description: definition.description,
    required: definition.required === true ? true : undefined,
    name_localizations: definition.nameLocalizations,
    description_localizations: definition.descriptionLocalizations,
    choices: definition.choices?.map((choice) =>
      defined({ name: choice.name, value: choice.value, name_localizations: choice.nameLocalizations }),
    ),
    autocomplete: definition.autocomplete === undefined ? undefined : true,
    min_length: definition.minLength,
    max_length: definition.maxLength,
    min_value: definition.minValue,
    max_value: definition.maxValue,
    channel_types: definition.channelTypes,
  }) as unknown as APIApplicationCommandBasicOption;
}

function serializeOptions(definition: CommandDefinition): APIApplicationCommandBasicOption[] {
  const entries = Object.entries(definition.options ?? {});
  const required = entries.filter(([, option]) => option.required === true);
  const optional = entries.filter(([, option]) => option.required !== true);
  return [...required, ...optional].map(([name, option]) => serializeOption(name, option));
}

function permissionBits(permissions: GroupDefinition["permissions"]): string | undefined {
  if (permissions === undefined || permissions.length === 0) return undefined;
  return PermissionsBitField.resolve([...permissions]).toString();
}

function contextsFor(guildOnly: boolean | undefined): InteractionContextType[] | undefined {
  return guildOnly === true ? [InteractionContextType.Guild] : undefined;
}

function commandDefinition(route: ManifestRoute): CommandDefinition {
  return route.module.default as CommandDefinition;
}

interface TreeNode {
  name: string;
  route: ManifestRoute | null;
  children: Map<string, TreeNode>;
}

function buildTree(routes: readonly ManifestRoute[]): Map<string, TreeNode> {
  const roots = new Map<string, TreeNode>();
  for (const route of routes) {
    let level = roots;
    let node: TreeNode | undefined;
    for (const segment of route.segments) {
      node = level.get(segment);
      if (node === undefined) {
        node = { name: segment, route: null, children: new Map() };
        level.set(segment, node);
      }
      level = node.children;
    }
    if (node === undefined) throw new Error(`${route.file} has an empty command path.`);
    if (node.route !== null) {
      throw new Error(`Command "/${route.id}" is defined by both ${node.route.file} and ${route.file}.`);
    }
    node.route = route;
  }
  return roots;
}

function groupsByPath(manifest: Manifest): Map<string, { definition: GroupDefinition | null; file: string }> {
  const groups = new Map<string, { definition: GroupDefinition | null; file: string }>();
  for (const group of manifest.groups) {
    groups.set(group.segments.join(" "), { definition: groupDefinition(group.module), file: group.file });
  }
  return groups;
}

function requireGroup(
  groups: ReturnType<typeof groupsByPath>,
  path: readonly string[],
  node: TreeNode,
): GroupDefinition {
  const key = path.join(" ");
  const group = groups.get(key)?.definition;
  if (group === undefined || group === null || typeof group.description !== "string" || group.description === "") {
    const example = [...node.children.values()][0];
    throw new Error(
      `Command group "/${key}" needs a description. Add a group.ts with defineGroup({ description }) next to "${example?.name ?? "its subcommands"}".`,
    );
  }
  return group;
}

function requireDescription(route: ManifestRoute, definition: CommandDefinition): string {
  if (typeof definition.description !== "string" || definition.description === "") {
    throw new Error(`Command "/${route.id}" in ${route.file} needs a description.`);
  }
  return definition.description;
}

function leafFields(route: ManifestRoute): {
  description: string;
  description_localizations: CommandDefinition["descriptionLocalizations"];
  name_localizations: CommandDefinition["nameLocalizations"];
  options: APIApplicationCommandBasicOption[] | undefined;
} {
  const definition = commandDefinition(route);
  const options = serializeOptions(definition);
  return {
    description: requireDescription(route, definition),
    description_localizations: definition.descriptionLocalizations,
    name_localizations: definition.nameLocalizations,
    options: options.length === 0 ? undefined : options,
  };
}

function serializeSubcommand(node: TreeNode): APIApplicationCommandOption {
  if (node.route === null) throw new Error(`Subcommand "${node.name}" has no command file.`);
  return defined({
    type: ApplicationCommandOptionType.Subcommand,
    name: node.name,
    ...leafFields(node.route),
  }) as unknown as APIApplicationCommandOption;
}

function serializeChild(
  groups: ReturnType<typeof groupsByPath>,
  path: readonly string[],
  node: TreeNode,
): APIApplicationCommandOption {
  if (node.children.size === 0) return serializeSubcommand(node);
  const childPath = [...path, node.name];
  const group = requireGroup(groups, childPath, node);
  return defined({
    type: ApplicationCommandOptionType.SubcommandGroup,
    name: node.name,
    description: group.description,
    name_localizations: group.nameLocalizations,
    description_localizations: group.descriptionLocalizations,
    options: [...node.children.values()].map(serializeSubcommand),
  }) as unknown as APIApplicationCommandOption;
}

function serializeRoot(groups: ReturnType<typeof groupsByPath>, node: TreeNode): RESTPostAPIApplicationCommandsJSONBody {
  if (node.children.size === 0) {
    if (node.route === null) throw new Error(`Command "/${node.name}" has no command file.`);
    const definition = commandDefinition(node.route);
    return defined({
      type: ApplicationCommandType.ChatInput,
      name: node.name,
      ...leafFields(node.route),
      default_member_permissions: permissionBits(definition.permissions),
      contexts: contextsFor(definition.guildOnly),
      nsfw: definition.nsfw,
    }) as RESTPostAPIApplicationCommandsJSONBody;
  }

  if (node.route !== null) {
    throw new Error(`"/${node.name}" in ${node.route.file} cannot be both a command and a parent of subcommands.`);
  }

  const group = requireGroup(groups, [node.name], node);
  return defined({
    type: ApplicationCommandType.ChatInput,
    name: node.name,
    description: group.description,
    name_localizations: group.nameLocalizations,
    description_localizations: group.descriptionLocalizations,
    default_member_permissions: permissionBits(group.permissions),
    contexts: contextsFor(group.guildOnly),
    nsfw: group.nsfw,
    options: [...node.children.values()].map((child) => serializeChild(groups, [node.name], child)),
  }) as RESTPostAPIApplicationCommandsJSONBody;
}

function serializeContextMenu(
  route: ManifestRoute,
  type: ApplicationCommandType.User | ApplicationCommandType.Message,
): RESTPostAPIApplicationCommandsJSONBody {
  const definition = route.module.default as {
    name: string;
    permissions?: GroupDefinition["permissions"];
    guildOnly?: boolean;
    nsfw?: boolean;
    nameLocalizations?: GroupDefinition["nameLocalizations"];
  };
  return defined({
    type,
    name: definition.name,
    name_localizations: definition.nameLocalizations,
    default_member_permissions: permissionBits(definition.permissions),
    contexts: contextsFor(definition.guildOnly),
    nsfw: definition.nsfw,
  }) as RESTPostAPIApplicationCommandsJSONBody;
}

export function serializeCommands(manifest: Manifest): RESTPutAPIApplicationCommandsJSONBody {
  const enabled = enabledManifest(manifest);
  for (const route of enabled.routes) {
    if (["command", "user-command", "message-command"].includes(route.kind) && brandOf(route.module) !== route.kind) {
      throw new Error(`${route.file} must default export the "${route.kind}" definition from a neocord helper.`);
    }
  }

  const groups = groupsByPath(enabled);
  const tree = buildTree(enabled.routes.filter((route) => route.kind === "command"));
  const commands: RESTPutAPIApplicationCommandsJSONBody = [...tree.values()].map((node) => serializeRoot(groups, node));

  for (const route of enabled.routes) {
    if (route.kind === "user-command") commands.push(serializeContextMenu(route, ApplicationCommandType.User));
    if (route.kind === "message-command") commands.push(serializeContextMenu(route, ApplicationCommandType.Message));
  }
  return commands;
}

export class OptionResolutionError extends Error {
  override readonly name = "OptionResolutionError";
}

function isStructure(value: unknown): boolean {
  return value instanceof Base;
}

async function resolveMember(
  value: unknown,
  name: string,
  interaction: ChatInputCommandInteraction,
  guild: Guild | null,
): Promise<GuildMember | null> {
  if (value === null) return null;
  if (isStructure(value)) return value as GuildMember;
  const user = interaction.options.getUser(name);
  if (guild === null || user === null) return null;
  return guild.members.fetch(user.id).catch(() => null);
}

async function resolveRole(value: unknown, guild: Guild | null): Promise<Role | null> {
  if (value === null) return null;
  if (isStructure(value)) return value as Role;
  const id = (value as { id?: string }).id;
  if (guild === null || id === undefined) return null;
  return guild.roles.fetch(id).catch(() => null);
}

export async function resolveOptions(
  definition: CommandDefinition,
  interaction: ChatInputCommandInteraction,
  guild: Guild | null,
  client: Client<true>,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  const options = interaction.options;

  for (const [name, option] of Object.entries(definition.options ?? {})) {
    let value: unknown;
    switch (option.kind) {
      case "string":
        value = options.getString(name);
        break;
      case "integer":
        value = options.getInteger(name);
        break;
      case "number":
        value = options.getNumber(name);
        break;
      case "boolean":
        value = options.getBoolean(name);
        break;
      case "user":
        value = options.getUser(name);
        break;
      case "member":
        value = await resolveMember(options.getMember(name), name, interaction, guild);
        break;
      case "channel": {
        const raw = options.getChannel(name);
        value = raw === null || isStructure(raw) ? raw : await client.channels.fetch(raw.id).catch(() => null);
        break;
      }
      case "role":
        value = await resolveRole(options.getRole(name), guild);
        break;
      case "mentionable": {
        const raw = options.getMentionable(name);
        if (raw === null || isStructure(raw)) {
          value = raw;
        } else if ("id" in raw) {
          value = await resolveRole(raw, guild);
        } else {
          value = await resolveMember(raw, name, interaction, guild);
        }
        break;
      }
      case "attachment":
        value = options.getAttachment(name);
        break;
    }

    if (value === null || value === undefined) {
      if (option.required === true) {
        throw new OptionResolutionError(
          option.kind === "member"
            ? `The user given for "${name}" is not a member of this server.`
            : `The "${name}" option could not be resolved.`,
        );
      }
      resolved[name] = undefined;
    } else {
      resolved[name] = value;
    }
  }
  return resolved;
}
