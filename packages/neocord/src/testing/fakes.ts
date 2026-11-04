import type { ModalRenderResult, RenderResult } from "@neocord/react";
import {
  ChannelType,
  Client,
  Collection,
  ComponentType,
  InteractionType,
  MessageFlags,
  MessageFlagsBitField,
  ModalSubmitFields,
  PermissionsBitField,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type PermissionsString,
  type RepliableInteraction,
  type Role,
  type User,
} from "discord.js";
import type { ChannelOfType, DefaultModalValues, ModalValue } from "../types.ts";

export interface Recording {
  replies: RenderResult[];
  updates: RenderResult[];
  followUps: RenderResult[];
  edits: RenderResult[];
  modal: ModalRenderResult | null;
  deferred: boolean;
  deferredUpdate: boolean;
  ephemeral: boolean;
  deletes: number;
  choices: unknown[] | null;
  log: { method: string; payload: unknown }[];
}

export function createRecording(): Recording {
  return {
    replies: [],
    updates: [],
    followUps: [],
    edits: [],
    modal: null,
    deferred: false,
    deferredUpdate: false,
    ephemeral: false,
    deletes: 0,
    choices: null,
    log: [],
  };
}

export type ApiHook = (method: string, payload: unknown) => void | Promise<void>;

export type FakeKind =
  | "command"
  | "autocomplete"
  | "user-command"
  | "message-command"
  | "button"
  | "string-select"
  | "user-select"
  | "role-select"
  | "channel-select"
  | "mentionable-select"
  | "modal";

export interface FakeInteractionOptions {
  kind: FakeKind;
  recording?: Recording;
  hook?: ApiHook;
  client?: Client<true>;
  user?: User;
  guild?: Guild | null;
  member?: GuildMember | null;
  commandName?: string;
  group?: string | null;
  subcommand?: string | null;
  options?: Readonly<Record<string, unknown>>;
  focused?: { name: string; value: string };
  customId?: string;
  values?: readonly string[];
  selected?: {
    users?: readonly User[];
    members?: readonly GuildMember[];
    roles?: readonly Role[];
    channels?: readonly { id: string }[];
  };
  modalValues?: DefaultModalValues;
  message?: Message | null;
  target?: User | Message;
  targetMember?: GuildMember | null;
}

let sharedClient: Client<true> | null = null;
let idCounter = 0n;

function nextId(): string {
  idCounter += 1n;
  return (900_000_000_000_000_000n + idCounter).toString();
}

export function testClient(): Client<true> {
  if (sharedClient === null) {
    sharedClient = new Client({ intents: [] }) as Client<true>;
    const internal = sharedClient as unknown as { user: User };
    internal.user = mockUser({ username: "neocord-test-bot", bot: true });
  }
  return sharedClient;
}

interface Internals {
  users: { _add(data: unknown): User };
  guilds: { _add(data: unknown): Guild };
  channels: { _add(data: unknown, guild?: Guild): unknown };
}

function internals(): Internals {
  return testClient() as unknown as Internals;
}

export interface MockUserOptions {
  id?: string;
  username?: string;
  globalName?: string | null;
  bot?: boolean;
}

function rawUser(options: MockUserOptions & { id: string }): unknown {
  return {
    id: options.id,
    username: options.username ?? `user-${options.id.slice(-4)}`,
    discriminator: "0",
    global_name: options.globalName ?? null,
    avatar: null,
    bot: options.bot ?? false,
  };
}

export function mockUser(options: MockUserOptions = {}): User {
  testClient();
  return internals().users._add(rawUser({ ...options, id: options.id ?? nextId() }));
}

export interface MockGuildOptions {
  id?: string;
  name?: string;
  ownerId?: string;
}

export function mockGuild(options: MockGuildOptions = {}): Guild {
  const id = options.id ?? nextId();
  testClient();
  return internals().guilds._add({
    id,
    name: options.name ?? `guild-${id.slice(-4)}`,
    owner_id: options.ownerId ?? nextId(),
    roles: [
      {
        id,
        name: "@everyone",
        color: 0,
        hoist: false,
        position: 0,
        permissions: "0",
        managed: false,
        mentionable: false,
        flags: 0,
      },
    ],
    channels: [],
    members: [],
    emojis: [],
    stickers: [],
    features: [],
    preferred_locale: "en-US",
    premium_tier: 0,
    mfa_level: 0,
    nsfw_level: 0,
    verification_level: 0,
    explicit_content_filter: 0,
    default_message_notifications: 0,
    system_channel_flags: 0,
  });
}

export interface MockRoleOptions {
  id?: string;
  guild?: Guild;
  name?: string;
  permissions?: readonly PermissionsString[];
}

export function mockRole(options: MockRoleOptions = {}): Role {
  const guild = options.guild ?? mockGuild();
  const id = options.id ?? nextId();
  const manager = guild.roles as unknown as { _add(data: unknown): Role };
  return manager._add({
    id,
    name: options.name ?? `role-${id.slice(-4)}`,
    color: 0,
    hoist: false,
    position: 1,
    permissions: PermissionsBitField.resolve([...(options.permissions ?? [])]).toString(),
    managed: false,
    mentionable: false,
    flags: 0,
  });
}

export interface MockMemberOptions {
  user?: User;
  guild?: Guild;
  nickname?: string | null;
  roles?: readonly Role[];
  permissions?: readonly PermissionsString[];
}

export function mockMember(options: MockMemberOptions = {}): GuildMember {
  const guild = options.guild ?? mockGuild();
  const user = options.user ?? mockUser();
  const roles = [...(options.roles ?? [])];
  if (options.permissions !== undefined) {
    roles.push(mockRole({ guild, permissions: options.permissions }));
  }
  const manager = guild.members as unknown as { _add(data: unknown): GuildMember };
  return manager._add({
    user: rawUser({ id: user.id, username: user.username, globalName: user.globalName, bot: user.bot }),
    nick: options.nickname ?? null,
    roles: roles.map((role) => role.id),
    joined_at: new Date(0).toISOString(),
    deaf: false,
    mute: false,
    flags: 0,
    avatar: null,
  });
}

export interface MockChannelOptions<T extends ChannelType = ChannelType.GuildText> {
  id?: string;
  guild?: Guild;
  name?: string;
  type?: T;
}

export function mockChannel<T extends ChannelType = ChannelType.GuildText>(
  options: MockChannelOptions<T> = {},
): ChannelOfType<T> {
  const id = options.id ?? nextId();
  const guild = options.guild ?? mockGuild();
  testClient();
  return internals().channels._add(
    {
      id,
      type: options.type ?? ChannelType.GuildText,
      guild_id: guild.id,
      name: options.name ?? `channel-${id.slice(-4)}`,
      position: 0,
      permission_overwrites: [],
      parent_id: null,
      nsfw: false,
      topic: null,
      last_message_id: null,
      rate_limit_per_user: 0,
      bitrate: 64_000,
      user_limit: 0,
      rtc_region: null,
    },
    guild,
  ) as ChannelOfType<T>;
}

export interface MockMessageOptions {
  id?: string;
  author?: User;
  content?: string;
  components?: readonly { toJSON(): unknown }[];
  flags?: number;
  hook?: ApiHook;
  recording?: Recording;
}

export function mockMessage(options: MockMessageOptions = {}): Message {
  const flags = options.flags ?? (options.content === undefined || options.content === "" ? MessageFlags.IsComponentsV2 : 0);
  const message = {
    id: options.id ?? nextId(),
    author: options.author ?? mockUser(),
    content: options.content ?? "",
    components: options.components ?? [],
    flags: new MessageFlagsBitField(flags),
    edit: async (payload: unknown) => {
      await options.hook?.("message.edit", payload);
      options.recording?.log.push({ method: "message.edit", payload });
      return message;
    },
  };
  return message as unknown as Message;
}

function discordError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function hasEphemeral(payload: unknown): boolean {
  const flags = (payload as { flags?: unknown } | undefined)?.flags;
  return typeof flags === "number" && (flags & MessageFlags.Ephemeral) !== 0;
}

function toFieldData(customId: string, value: ModalValue): unknown {
  if (typeof value === "boolean") return { type: ComponentType.Checkbox, id: 0, customId, value };
  if (Array.isArray(value)) return { type: ComponentType.StringSelect, id: 0, customId, values: value };
  return { type: ComponentType.TextInput, id: 0, customId, value };
}

function createModalFields(values: DefaultModalValues): ModalSubmitFields {
  const FieldsClass = ModalSubmitFields as unknown as new (components: unknown[]) => ModalSubmitFields;
  return new FieldsClass(
    Object.entries(values).map(([customId, value], index) => ({
      type: ComponentType.Label,
      id: index + 1,
      component: toFieldData(customId, value),
    })),
  );
}

function createOptionResolver(options: FakeInteractionOptions): unknown {
  const values = options.options ?? {};
  const read = (name: string): unknown => values[name] ?? null;
  return {
    getString: read,
    getInteger: read,
    getNumber: read,
    getBoolean: read,
    getUser: read,
    getMember: read,
    getChannel: read,
    getRole: read,
    getMentionable: read,
    getAttachment: read,
    getSubcommand: () => options.subcommand ?? null,
    getSubcommandGroup: () => options.group ?? null,
    getFocused: (full?: boolean) => {
      const focused = options.focused ?? { name: "", value: "" };
      return full === true ? { ...focused, type: 3, focused: true } : focused.value;
    },
  };
}

const SELECT_KINDS: readonly FakeKind[] = [
  "string-select",
  "user-select",
  "role-select",
  "channel-select",
  "mentionable-select",
];

function toCollection<V extends { id: string }>(items: readonly V[] | undefined): Collection<string, V> | undefined {
  return items === undefined ? undefined : new Collection(items.map((item) => [item.id, item]));
}

export function createFakeInteraction(options: FakeInteractionOptions): Interaction & {
  recording: Recording;
} {
  const recording = options.recording ?? createRecording();
  const hook = options.hook;
  const { kind } = options;
  const guild = options.guild ?? null;
  const member = options.member ?? null;
  const isComponent = kind === "button" || SELECT_KINDS.includes(kind);
  const client = options.client ?? testClient();
  const message = options.message ?? (isComponent ? mockMessage({ recording }) : null);

  const call = async (method: string, payload: unknown): Promise<void> => {
    recording.log.push({ method, payload });
    await hook?.(method, payload);
  };

  const assertFresh = (): void => {
    if (interaction.deferred || interaction.replied) {
      throw discordError("InteractionAlreadyReplied", "The reply to this interaction has already been sent or deferred.");
    }
  };

  const assertAcknowledged = (): void => {
    if (!interaction.deferred && !interaction.replied) {
      throw discordError("InteractionNotReplied", "The reply to this interaction has not been sent or deferred.");
    }
  };

  const assertNoEphemeral = (method: string, payload: unknown): void => {
    if (hasEphemeral(payload)) {
      throw new Error(`${method} received MessageFlags.Ephemeral, which Discord rejects when editing.`);
    }
  };

  const followUpMessage = (): Message => mockMessage({ recording, ...(hook === undefined ? {} : { hook }) });

  const interaction = {
    recording,
    id: nextId(),
    token: "fake-interaction-token",
    client,
    type: kind === "autocomplete" ? InteractionType.ApplicationCommandAutocomplete : InteractionType.ApplicationCommand,
    user: options.user ?? mockUser(),
    guild,
    guildId: guild?.id ?? null,
    member,
    memberPermissions: member === null ? null : member.permissions,
    channel: null,
    channelId: null,
    deferred: false,
    replied: false,
    ephemeral: null as boolean | null,
    commandName: options.commandName ?? "test",
    options: createOptionResolver(options),
    customId: options.customId ?? "",
    values: [...(options.values ?? [])],
    message,
    fields: createModalFields(options.modalValues ?? {}),
    targetUser: options.target,
    targetMember: options.targetMember ?? null,
    targetMessage: options.target,
    users: toCollection(options.selected?.users),
    members: toCollection(options.selected?.members),
    roles: toCollection(options.selected?.roles),
    channels: toCollection(options.selected?.channels),
    inGuild: () => guild !== null,
    inCachedGuild: () => guild !== null,
    inRawGuild: () => false,
    isRepliable: () => kind !== "autocomplete",
    isChatInputCommand: () => kind === "command",
    isAutocomplete: () => kind === "autocomplete",
    isUserContextMenuCommand: () => kind === "user-command",
    isMessageContextMenuCommand: () => kind === "message-command",
    isContextMenuCommand: () => kind === "user-command" || kind === "message-command",
    isMessageComponent: () => isComponent,
    isButton: () => kind === "button",
    isAnySelectMenu: () => SELECT_KINDS.includes(kind),
    isStringSelectMenu: () => kind === "string-select",
    isUserSelectMenu: () => kind === "user-select",
    isRoleSelectMenu: () => kind === "role-select",
    isChannelSelectMenu: () => kind === "channel-select",
    isMentionableSelectMenu: () => kind === "mentionable-select",
    isModalSubmit: () => kind === "modal",
    isFromMessage: () => kind === "modal" && message !== null,

    async reply(payload: RenderResult) {
      assertFresh();
      await call("reply", payload);
      interaction.replied = true;
      interaction.ephemeral = hasEphemeral(payload);
      recording.ephemeral = hasEphemeral(payload);
      recording.replies.push(payload);
      return { id: nextId() };
    },
    async deferReply(payload: { flags?: number } = {}) {
      assertFresh();
      await call("deferReply", payload);
      interaction.deferred = true;
      interaction.ephemeral = hasEphemeral(payload);
      recording.ephemeral = hasEphemeral(payload);
      recording.deferred = true;
      return { id: nextId() };
    },
    async editReply(payload: RenderResult) {
      assertAcknowledged();
      assertNoEphemeral("editReply", payload);
      await call("editReply", payload);
      interaction.replied = true;
      recording.edits.push(payload);
      return followUpMessage();
    },
    async followUp(payload: RenderResult) {
      assertAcknowledged();
      await call("followUp", payload);
      interaction.replied = true;
      recording.followUps.push(payload);
      return followUpMessage();
    },
    async deleteReply() {
      assertAcknowledged();
      await call("deleteReply", undefined);
      recording.deletes += 1;
    },
    async update(payload: RenderResult) {
      assertFresh();
      assertNoEphemeral("update", payload);
      await call("update", payload);
      interaction.replied = true;
      recording.updates.push(payload);
      return { id: nextId() };
    },
    async deferUpdate() {
      assertFresh();
      await call("deferUpdate", undefined);
      interaction.deferred = true;
      recording.deferredUpdate = true;
      return { id: nextId() };
    },
    async showModal(modal: ModalRenderResult) {
      assertFresh();
      await call("showModal", modal);
      interaction.replied = true;
      recording.modal = modal;
    },
    async respond(choices: unknown[]) {
      await call("respond", choices);
      recording.choices = choices;
    },
  };

  return interaction as unknown as Interaction & { recording: Recording };
}

export type FakeRepliable = RepliableInteraction & { recording: Recording };
export type FakeModalInteraction = ModalSubmitInteraction & { recording: Recording };
