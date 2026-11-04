import type { ModalRoute, RouteParamsRecord } from "@neocord/react";
import type { HasParams, RouteKind, RouteParamInput, RouteParams } from "@neocord/routing";
import type {
  AutocompleteInteraction,
  ButtonInteraction,
  CacheType,
  ChannelSelectMenuInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  Guild,
  GuildBasedChannel,
  GuildMember,
  LocalizationMap,
  MentionableSelectMenuInteraction,
  Message,
  MessageContextMenuCommandInteraction,
  ModalSubmitFields,
  ModalSubmitInteraction,
  PermissionsString,
  RepliableInteraction,
  Role,
  RoleSelectMenuInteraction,
  Serialized,
  StringSelectMenuInteraction,
  User,
  UserContextMenuCommandInteraction,
  UserSelectMenuInteraction,
} from "discord.js";
import type { ReactNode } from "react";
import type { IntentName, PartialName } from "./config.ts";
import type { DurationInput } from "./duration.ts";
import type { Logger } from "./logger.ts";
import type { StandardSchemaV1 } from "./standard-schema.ts";

export interface RegisteredApp {}

export type AppContext = RegisteredApp extends { context: infer C } ? C : Record<string, never>;

export type Awaitable<T> = T | PromiseLike<T>;

export type HandlerResult = ReactNode | void;

export type CacheOf<G extends boolean> = [G] extends [true] ? "cached" : CacheType;

export type GuildValue<G extends boolean> = [G] extends [true] ? Guild : Guild | null;

export type MemberValue<G extends boolean> = [G] extends [true] ? GuildMember : GuildMember | null;

export interface ShardHelpers {
  readonly id: number;
  readonly ids: readonly number[];
  readonly count: number;
  fetchClientValues<T = unknown>(prop: string): Promise<T[]>;
  broadcastEval<R>(fn: (client: Client<true>) => Awaitable<R>): Promise<Serialized<R>[]>;
  broadcastEval<R, C>(
    fn: (client: Client<true>, context: Serialized<C>) => Awaitable<R>,
    options: { context: C },
  ): Promise<Serialized<R>[]>;
}

export interface ReplyOptions {
  ephemeral?: boolean;
  layout?: boolean;
}

export interface DeferOptions {
  ephemeral?: boolean;
}

export type ShowModalArgs<R extends string> = string extends R
  ? [params?: RouteParamsRecord]
  : HasParams<R> extends true
    ? [params: RouteParamInput<R>]
    : [params?: undefined];

export type ShowModalMethod<Route extends string = ModalRoute> = <R extends Route>(
  route: R,
  ...args: ShowModalArgs<R>
) => Promise<void>;

export interface BaseContext {
  client: Client<true>;
  app: AppContext;
  logger: Logger;
  feature: string;
  route: string;
  shards: ShardHelpers;
}

export type InteractionKind = Exclude<RouteKind, "event" | "task">;

export interface InteractionContext<
  I extends RepliableInteraction = RepliableInteraction,
  G extends boolean = boolean,
> extends BaseContext {
  kind: InteractionKind;
  interaction: I;
  guild: GuildValue<G>;
  member: MemberValue<G>;
  user: User;
  state: Record<string, unknown>;
  reply(node: ReactNode, options?: ReplyOptions): Promise<void>;
  editReply(node: ReactNode, options?: ReplyOptions): Promise<void>;
  followUp(node: ReactNode, options?: ReplyOptions): Promise<void>;
  defer(options?: DeferOptions): Promise<void>;
  deleteReply(): Promise<void>;
  showModal: ShowModalMethod;
}

export interface LayoutProps {
  children: ReactNode;
}

export interface ErrorProps {
  error: unknown;
  ctx: AnyContext;
}

export interface OptionChoice<V extends string | number = string | number> {
  readonly name: string;
  readonly value: V;
  readonly nameLocalizations?: LocalizationMap | undefined;
}

export interface AutocompleteContext extends BaseContext {
  kind: "autocomplete";
  interaction: AutocompleteInteraction;
  guild: Guild | null;
  member: GuildMember | null;
  user: User;
  focused: string;
  optionName: string;
}

export type AutocompleteHandler<V extends string | number = string | number> = (
  ctx: AutocompleteContext,
) => Awaitable<readonly OptionChoice<V>[]>;

export type OptionKind =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "user"
  | "member"
  | "channel"
  | "role"
  | "mentionable"
  | "attachment";

export interface OptionDefinition<T = unknown, R extends boolean = boolean, K extends OptionKind = OptionKind> {
  readonly __neocord: "option";
  readonly kind: K;
  readonly description: string;
  readonly required?: R;
  readonly nameLocalizations?: LocalizationMap | undefined;
  readonly descriptionLocalizations?: LocalizationMap | undefined;
  readonly choices?: readonly OptionChoice[] | undefined;
  readonly autocomplete?: AutocompleteHandler | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly minValue?: number | undefined;
  readonly maxValue?: number | undefined;
  readonly channelTypes?: readonly ChannelType[] | undefined;
  readonly __value?: T;
}

export type OptionsRecord = Readonly<Record<string, OptionDefinition>>;

export type InferOption<D> =
  D extends OptionDefinition<infer T, infer R> ? ([R] extends [true] ? T : T | undefined) : never;

export type InferOptions<O extends OptionsRecord> = { readonly [K in keyof O]: InferOption<O[K]> };

export type ChannelOfType<T extends ChannelType> = Extract<
  GuildBasedChannel,
  {
    type: T extends ChannelType.PublicThread | ChannelType.AnnouncementThread
      ? ChannelType.PublicThread | ChannelType.AnnouncementThread
      : T;
  }
>;

export type MentionableValue = User | GuildMember | Role;

export interface RouteOptions<G extends boolean = boolean> {
  permissions?: readonly PermissionsString[];
  guildOnly?: G;
  ephemeral?: boolean;
  cooldown?: DurationInput;
  layout?: boolean;
}

export interface CommandMetadata<G extends boolean = boolean> extends RouteOptions<G> {
  nsfw?: boolean;
  nameLocalizations?: LocalizationMap | undefined;
}

export interface CommandContext<O extends OptionsRecord = OptionsRecord, G extends boolean = boolean>
  extends InteractionContext<ChatInputCommandInteraction<CacheOf<G>>, G> {
  kind: "command";
  options: InferOptions<O>;
}

export interface CommandInput<O extends OptionsRecord, G extends boolean> extends CommandMetadata<G> {
  description: string;
  descriptionLocalizations?: LocalizationMap | undefined;
  options?: O;
  execute(ctx: CommandContext<O, G>): Awaitable<HandlerResult>;
}

export type CommandDefinition<O extends OptionsRecord = OptionsRecord, G extends boolean = boolean> = CommandInput<O, G> & {
  readonly __neocord: "command";
};

export interface UserCommandContext<G extends boolean = boolean>
  extends InteractionContext<UserContextMenuCommandInteraction<CacheOf<G>>, G> {
  kind: "user-command";
  target: User;
  targetMember: MemberValue<G>;
}

export interface UserCommandInput<G extends boolean> extends CommandMetadata<G> {
  name: string;
  execute(ctx: UserCommandContext<G>): Awaitable<HandlerResult>;
}

export type UserCommandDefinition<G extends boolean = boolean> = UserCommandInput<G> & {
  readonly __neocord: "user-command";
};

export interface MessageCommandContext<G extends boolean = boolean>
  extends InteractionContext<MessageContextMenuCommandInteraction<CacheOf<G>>, G> {
  kind: "message-command";
  target: Message;
}

export interface MessageCommandInput<G extends boolean> extends CommandMetadata<G> {
  name: string;
  execute(ctx: MessageCommandContext<G>): Awaitable<HandlerResult>;
}

export type MessageCommandDefinition<G extends boolean = boolean> = MessageCommandInput<G> & {
  readonly __neocord: "message-command";
};

export interface GroupInput {
  description: string;
  permissions?: readonly PermissionsString[];
  guildOnly?: boolean;
  nsfw?: boolean;
  nameLocalizations?: LocalizationMap | undefined;
  descriptionLocalizations?: LocalizationMap | undefined;
}

export type GroupDefinition = GroupInput & { readonly __neocord: "group" };

export interface ComponentContext<I extends RepliableInteraction, G extends boolean>
  extends InteractionContext<I, G> {
  message: Message;
  update(node: ReactNode, options?: ReplyOptions): Promise<void>;
  deferUpdate(): Promise<void>;
}

export interface ButtonContext<R extends string = string, G extends boolean = boolean>
  extends ComponentContext<ButtonInteraction<CacheOf<G>>, G> {
  kind: "button";
  params: RouteParams<R>;
}

export interface ButtonInput<R extends string, G extends boolean> extends RouteOptions<G> {
  respond?: "update" | "reply";
  execute(ctx: ButtonContext<R, G>): Awaitable<HandlerResult>;
}

export type ButtonDefinition<R extends string = string, G extends boolean = boolean> = ButtonInput<R, G> & {
  readonly __neocord: "button";
  readonly route: R;
};

export type SelectType = "string" | "user" | "role" | "channel" | "mentionable";

export type SelectInteractionFor<T extends SelectType, C extends CacheType = CacheType> = {
  string: StringSelectMenuInteraction<C>;
  user: UserSelectMenuInteraction<C>;
  role: RoleSelectMenuInteraction<C>;
  channel: ChannelSelectMenuInteraction<C>;
  mentionable: MentionableSelectMenuInteraction<C>;
}[T];

export type SelectExtras<T extends SelectType, C extends CacheType = CacheType> = {
  string: {};
  user: Pick<UserSelectMenuInteraction<C>, "users" | "members">;
  role: Pick<RoleSelectMenuInteraction<C>, "roles">;
  channel: Pick<ChannelSelectMenuInteraction<C>, "channels">;
  mentionable: Pick<MentionableSelectMenuInteraction<C>, "users" | "members" | "roles">;
}[T];

export interface BaseSelectContext<R extends string, T extends SelectType, G extends boolean>
  extends ComponentContext<SelectInteractionFor<T, CacheOf<G>>, G> {
  kind: "select";
  params: RouteParams<R>;
  values: string[];
}

export type SelectContext<
  R extends string = string,
  T extends SelectType = SelectType,
  G extends boolean = boolean,
> = BaseSelectContext<R, T, G> & SelectExtras<T, CacheOf<G>>;

export interface SelectInput<R extends string, T extends SelectType, G extends boolean> extends RouteOptions<G> {
  type?: T;
  respond?: "update" | "reply";
  execute(ctx: SelectContext<R, T, G>): Awaitable<HandlerResult>;
}

export type SelectDefinition<
  R extends string = string,
  T extends SelectType = SelectType,
  G extends boolean = boolean,
> = SelectInput<R, T, G> & {
  readonly __neocord: "select";
  readonly route: R;
};

export type ModalValue = string | string[] | boolean;

export type DefaultModalValues = Record<string, ModalValue>;

export type ModalSchema = StandardSchemaV1 | undefined;

export type ModalValues<S extends ModalSchema> = [S] extends [StandardSchemaV1]
  ? StandardSchemaV1.InferOutput<S>
  : DefaultModalValues;

export type ModalFieldName<S extends ModalSchema> = [S] extends [StandardSchemaV1]
  ? Extract<keyof StandardSchemaV1.InferInput<S>, string>
  : string;

export interface ModalRenderContext<R extends string = string, S extends ModalSchema = ModalSchema> {
  params: RouteParams<R>;
  field(name: ModalFieldName<S>): string;
}

export interface ModalContext<
  R extends string = string,
  S extends ModalSchema = ModalSchema,
  G extends boolean = boolean,
> extends Omit<InteractionContext<ModalSubmitInteraction<CacheOf<G>>, G>, "showModal"> {
  kind: "modal";
  params: RouteParams<R>;
  values: ModalValues<S>;
  fields: ModalSubmitFields<CacheOf<G>>;
}

export interface ModalInput<R extends string, S extends ModalSchema, G extends boolean> extends RouteOptions<G> {
  title: string | ((ctx: ModalRenderContext<R, S>) => string);
  schema?: S;
  render(ctx: ModalRenderContext<R, S>): ReactNode;
  submit(ctx: ModalContext<R, S, G>): Awaitable<HandlerResult>;
}

export type ModalDefinition<
  R extends string = string,
  S extends ModalSchema = ModalSchema,
  G extends boolean = boolean,
> = ModalInput<R, S, G> & {
  readonly __neocord: "modal";
  readonly route: R;
};

export type EventName = keyof ClientEvents;

export type EventContext = BaseContext;

export interface EventInput<E extends EventName> {
  once?: boolean;
  execute(ctx: EventContext, ...args: ClientEvents[E]): unknown;
}

export type EventDefinition<E extends EventName = EventName> = EventInput<E> & {
  readonly __neocord: "event";
  readonly event: E;
};

export type TaskContext = BaseContext;

export interface TaskInput {
  every: DurationInput;
  runOnStart?: boolean;
  shard?: "first" | "all";
  execute(ctx: TaskContext): unknown;
}

export type TaskDefinition = TaskInput & { readonly __neocord: "task" };

export interface ContextForKind {
  command: CommandContext;
  "user-command": UserCommandContext;
  "message-command": MessageCommandContext;
  button: ButtonContext;
  select: SelectContext;
  modal: ModalContext;
}

export type AnyContext = ContextForKind[InteractionKind];

export type MiddlewareNext = () => Promise<void>;

export type MiddlewareHandler<K extends InteractionKind = InteractionKind> = (
  ctx: ContextForKind[K],
  next: MiddlewareNext,
) => Awaitable<HandlerResult>;

export interface MiddlewareOptions<K extends InteractionKind = InteractionKind> {
  kinds?: readonly K[];
}

export interface MiddlewareDefinition<K extends InteractionKind = InteractionKind> {
  readonly __neocord: "middleware";
  readonly handler: MiddlewareHandler<K>;
  readonly kinds?: readonly K[] | undefined;
}

export interface FeatureInput {
  enabled?: boolean;
  intents?: readonly IntentName[];
  partials?: readonly PartialName[];
}

export type FeatureDefinition = FeatureInput & { readonly __neocord: "feature" };

export interface ContextFactoryArgs {
  client: Client<true>;
  logger: Logger;
}

export interface ContextResult<T> {
  value: T;
  dispose?: () => unknown;
}

export type ContextFactory<T> = (args: ContextFactoryArgs) => Awaitable<ContextResult<T>>;

export interface ContextDefinition<T = unknown> {
  readonly __neocord: "context";
  readonly factory: ContextFactory<T>;
}

export type InferAppContext<T> = T extends ContextDefinition<infer V>
  ? V
  : T extends ContextFactory<infer V>
    ? V
    : never;

export type ModuleNamespace = object & { readonly default?: unknown };

export interface ManifestModule {
  file: string;
  module: ModuleNamespace;
}

export interface ManifestFeature {
  name: string;
  module: ModuleNamespace | null;
}

export interface ManifestGroup {
  feature: string;
  segments: string[];
  file: string;
  module: ModuleNamespace;
}

export interface ManifestRoute {
  kind: RouteKind;
  id: string;
  feature: string;
  file: string;
  segments: string[];
  module: ModuleNamespace;
  middleware: ManifestModule[];
  layouts: ManifestModule[];
  error: ManifestModule | null;
  loading: ManifestModule | null;
}

export interface Manifest {
  version: 1;
  context: ModuleNamespace | null;
  features: ManifestFeature[];
  groups: ManifestGroup[];
  routes: ManifestRoute[];
}

export interface Bot {
  client: Client<true>;
  app: AppContext;
  manifest: Manifest;
  logger: Logger;
  stop(): Promise<void>;
}
