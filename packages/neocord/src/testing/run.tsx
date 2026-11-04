import { buildCustomId, type ModalRenderResult, type RenderResult } from "@neocord/react";
import type { RouteKind, RouteParamInput } from "@neocord/routing";
import {
  ComponentType,
  type ClientEvents,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type PermissionsString,
  type Role,
  type User,
} from "discord.js";
import type { ComponentType as ReactComponentType } from "react";
import { createLogger, type Logger } from "../logger.ts";
import { createBaseContext, createDispatcher, createEventHandler, type Dispatcher } from "../runtime/dispatch.tsx";
import { compileManifest, type CompiledManifest } from "../runtime/manifest.ts";
import { renderModalRoute, stringifyParams } from "../runtime/render.tsx";
import { createShardHelpers } from "../runtime/shards.ts";
import { createTaskRunner } from "../runtime/tasks.ts";
import type {
  AnyContext,
  AppContext,
  ButtonDefinition,
  CommandDefinition,
  CommandInfo,
  DefaultModalValues,
  ErrorProps,
  EventDefinition,
  EventName,
  InferOptions,
  InteractionKind,
  LayoutProps,
  Manifest,
  ManifestRoute,
  MessageCommandDefinition,
  MiddlewareDefinition,
  ModalDefinition,
  ModalSchema,
  ModuleNamespace,
  OptionChoice,
  OptionsRecord,
  SelectDefinition,
  SelectType,
  TaskDefinition,
  UserCommandDefinition,
} from "../types.ts";
import {
  createFakeInteraction,
  createRecording,
  mockGuild,
  mockMember,
  mockUser,
  testClient,
  type ApiHook,
  type FakeInteractionOptions,
  type FakeKind,
  type Recording,
} from "./fakes.ts";

export interface TestResult {
  replies: RenderResult[];
  updates: RenderResult[];
  followUps: RenderResult[];
  edits: RenderResult[];
  modal: ModalRenderResult | null;
  deferred: boolean;
  deferredUpdate: boolean;
  ephemeral: boolean;
  error: unknown;
  text: string;
  live: LiveTestSession | null;
}

export interface LiveEventOptions {
  user?: User;
  member?: GuildMember | null;
}

export interface LiveSelectOptions extends LiveEventOptions {
  placeholder?: string;
}

export interface LiveTestSession {
  click(label: string, options?: LiveEventOptions): Promise<TestResult>;
  select(values: readonly string[], options?: LiveSelectOptions): Promise<TestResult>;
  close(): Promise<void>;
}

export interface TestMiddleware {
  readonly __neocord: MiddlewareDefinition["__neocord"];
  readonly handler: unknown;
  readonly kinds?: readonly InteractionKind[] | undefined;
}

export interface RunOptions {
  user?: User;
  guild?: Guild | null;
  member?: GuildMember | null;
  app?: AppContext | Record<string, unknown>;
  middleware?: readonly TestMiddleware[];
  layouts?: readonly ReactComponentType<LayoutProps>[];
  error?: ReactComponentType<ErrorProps>;
  loading?: ReactComponentType;
  modals?: readonly ModalDefinition<string, ModalSchema, boolean>[];
  commands?: readonly CommandInfo[];
  logger?: Logger;
  autoDeferAfter?: number | false;
  hook?: ApiHook;
  live?: boolean;
}

interface RouteSpec {
  kind: RouteKind;
  id: string;
  segments: readonly string[];
  module: ModuleNamespace;
}

function moduleEntry(file: string, value: unknown): { file: string; module: ModuleNamespace } {
  return { file, module: { default: value } };
}

function manifestFor(spec: RouteSpec, options: RunOptions): Manifest {
  const middleware = options.middleware ?? [];
  const layouts = options.layouts ?? [];
  const route: ManifestRoute = {
    kind: spec.kind,
    id: spec.id,
    feature: "test",
    file: `test/${spec.kind}.tsx`,
    segments: [...spec.segments],
    module: spec.module,
    middleware: middleware.map((entry, index) => moduleEntry(`test/middleware-${index}.ts`, entry)),
    layouts: layouts.map((entry, index) => moduleEntry(`test/layout-${index}.tsx`, entry)),
    error: options.error === undefined ? null : moduleEntry("test/error.tsx", options.error),
    loading: options.loading === undefined ? null : moduleEntry("test/loading.tsx", options.loading),
  };
  const modalRoutes: ManifestRoute[] = (options.modals ?? []).map((definition) => ({
    kind: "modal",
    id: definition.route,
    feature: "test",
    file: `test/modals/${definition.route}.tsx`,
    segments: definition.route.split("/"),
    module: { default: definition },
    middleware: [],
    layouts: [],
    error: null,
    loading: null,
  }));
  return {
    version: 1,
    context: null,
    features: [{ name: "test", module: null }],
    groups: [],
    routes: [route, ...modalRoutes.filter((candidate) => candidate.id !== route.id || route.kind !== "modal")],
  };
}

function collectText(components: readonly unknown[]): string[] {
  return components.flatMap((component) => {
    const entry = component as { type: number; content?: string; components?: unknown[] };
    if (entry.type === ComponentType.TextDisplay) return [entry.content ?? ""];
    return entry.components === undefined ? [] : collectText(entry.components);
  });
}

function payloadText(payload: RenderResult): string[] {
  const { content, components } = payload as { content?: string; components?: readonly unknown[] };
  return [...(content === undefined ? [] : [content]), ...collectText(components ?? [])];
}

function resultFrom(recording: Recording, error: unknown): TestResult {
  const all = [...recording.replies, ...recording.updates, ...recording.edits, ...recording.followUps];
  return {
    replies: recording.replies,
    updates: recording.updates,
    followUps: recording.followUps,
    edits: recording.edits,
    modal: recording.modal,
    deferred: recording.deferred,
    deferredUpdate: recording.deferredUpdate,
    ephemeral: recording.ephemeral,
    error,
    text: all.flatMap(payloadText).join("\n"),
    live: null,
  };
}

interface JsonComponent {
  type: number;
  label?: string;
  placeholder?: string;
  custom_id?: string;
  components?: readonly JsonComponent[];
  accessory?: JsonComponent;
}

const LIVE_SELECT_KINDS = new Map<number, FakeKind>([
  [ComponentType.StringSelect, "string-select"],
  [ComponentType.UserSelect, "user-select"],
  [ComponentType.RoleSelect, "role-select"],
  [ComponentType.MentionableSelect, "mentionable-select"],
  [ComponentType.ChannelSelect, "channel-select"],
]);

function flattenComponents(components: readonly unknown[]): JsonComponent[] {
  return (components as readonly JsonComponent[]).flatMap((component) => [
    component,
    ...flattenComponents(component.components ?? []),
    ...(component.accessory === undefined ? [] : [component.accessory]),
  ]);
}

function latestPayload(recording: Recording): RenderResult | null {
  return recording.updates.at(-1) ?? recording.edits.at(-1) ?? recording.replies.at(-1) ?? recording.followUps.at(-1) ?? null;
}

function createLiveTestSession(harness: Harness, first: RenderResult | null, origin: FakeInteractionOptions): LiveTestSession {
  let current = first;

  const fire = async (
    kind: FakeKind,
    customId: string,
    values: readonly string[],
    options: LiveEventOptions,
  ): Promise<TestResult> => {
    const recording = createRecording();
    const seen = harness.errors.length;
    const user = options.user ?? origin.user;
    await harness.dispatch(
      createFakeInteraction({
        kind,
        customId,
        values,
        recording,
        ...(user === undefined ? {} : { user }),
        guild: origin.guild ?? null,
        member: options.member !== undefined ? options.member : options.user === undefined ? (origin.member ?? null) : null,
      }),
    );
    current = recording.updates.at(-1) ?? recording.edits.at(-1) ?? current;
    return resultFrom(recording, harness.errors[seen] ?? null);
  };

  const components = (): JsonComponent[] => flattenComponents(current?.components ?? []);

  return {
    click(label, options = {}) {
      const buttons = components().filter((component) => component.type === ComponentType.Button);
      const button = buttons.find((component) => component.label === label);
      if (button?.custom_id === undefined) {
        const labels = buttons.map((component) => JSON.stringify(component.label)).join(", ");
        return Promise.reject(new Error(`No live button labelled "${label}". The message has: ${labels || "no buttons"}.`));
      }
      return fire("button", button.custom_id, [], options);
    },
    select(values, options = {}) {
      const selects = components().filter((component) => LIVE_SELECT_KINDS.has(component.type));
      const select = selects.find(
        (component) => options.placeholder === undefined || component.placeholder === options.placeholder,
      );
      const kind = select === undefined ? undefined : LIVE_SELECT_KINDS.get(select.type);
      if (select?.custom_id === undefined || kind === undefined) {
        return Promise.reject(new Error(`No live select${options.placeholder === undefined ? "" : ` with placeholder "${options.placeholder}"`} in the message.`));
      }
      return fire(kind, select.custom_id, values, options);
    },
    close: () => harness.close(),
  };
}

export interface HarnessOptions {
  manifest: Manifest;
  app?: unknown;
  logger?: Logger;
  autoDeferAfter?: number | false;
  liveTtl?: number;
  commands?: readonly CommandInfo[];
}

export interface Harness {
  dispatcher: Dispatcher;
  compiled: CompiledManifest;
  errors: unknown[];
  logger: Logger;
  app: AppContext;
  dispatch(interaction: Interaction): Promise<void>;
  close(): Promise<void>;
}

export function createHarness(options: HarnessOptions): Harness {
  const logger = options.logger ?? createLogger({ level: "silent" });
  const client = testClient();
  const compiled = compileManifest(options.manifest);
  const app = (options.app ?? {}) as AppContext;
  const errors: unknown[] = [];
  const dispatcher = createDispatcher({
    client,
    app,
    logger,
    shards: createShardHelpers(client),
    compiled,
    autoDeferAfter: options.autoDeferAfter ?? false,
    liveTtl: options.liveTtl ?? 60_000,
    commands: options.commands,
    onError: (error) => errors.push(error),
  });
  return {
    dispatcher,
    compiled,
    errors,
    logger,
    app,
    dispatch: (interaction) => dispatcher.handle(interaction),
    close: async () => {
      dispatcher.live.clear();
      await dispatcher.shutdown();
    },
  };
}

async function runInteraction(spec: RouteSpec, options: RunOptions, fake: FakeInteractionOptions): Promise<TestResult> {
  const recording = createRecording();
  const harness = createHarness({
    manifest: manifestFor(spec, options),
    ...(options.app === undefined ? {} : { app: options.app }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.commands === undefined ? {} : { commands: options.commands }),
    autoDeferAfter: options.autoDeferAfter ?? false,
  });
  const interaction = createFakeInteraction({
    ...fake,
    recording,
    ...(options.hook === undefined ? {} : { hook: options.hook }),
  });
  let keepOpen = false;
  try {
    await harness.dispatch(interaction);
    keepOpen = options.live === true && harness.dispatcher.live.size > 0;
  } finally {
    if (!keepOpen) await harness.close();
  }
  const result = resultFrom(recording, harness.errors[0] ?? null);
  return keepOpen ? { ...result, live: createLiveTestSession(harness, latestPayload(recording), fake) } : result;
}

function resolveScope(
  options: RunOptions,
  needsGuild: boolean | undefined,
  permissions: readonly PermissionsString[] | undefined,
): { user: User; guild: Guild | null; member: GuildMember | null } {
  const user = options.user ?? options.member?.user ?? mockUser();
  if (options.member !== undefined && options.member !== null) {
    return { user, guild: options.guild ?? options.member.guild, member: options.member };
  }
  if (options.guild === null || options.member === null) {
    return { user, guild: options.guild ?? null, member: null };
  }
  if (options.guild === undefined && needsGuild !== true && (permissions === undefined || permissions.length === 0)) {
    return { user, guild: null, member: null };
  }
  const guild = options.guild ?? mockGuild();
  const member = mockMember({ user, guild, ...(permissions === undefined ? {} : { permissions }) });
  return { user, guild, member };
}

export interface RunCommandOptions<O extends OptionsRecord = OptionsRecord> extends RunOptions {
  options?: Partial<InferOptions<O>>;
}

export async function runCommand<O extends OptionsRecord, G extends boolean>(
  definition: CommandDefinition<O, G>,
  options: RunCommandOptions<O> = {},
): Promise<TestResult> {
  const scope = resolveScope(options, definition.guildOnly, definition.permissions);
  return runInteraction(
    { kind: "command", id: "test", segments: ["test"], module: { default: definition } },
    options,
    { kind: "command", commandName: "test", ...scope, options: (options.options ?? {}) as Record<string, unknown> },
  );
}

export interface RunAutocompleteOptions<O extends OptionsRecord = OptionsRecord> extends RunOptions {
  option: Extract<keyof O, string>;
  value?: string;
}

export interface AutocompleteResult {
  choices: OptionChoice[];
  error: unknown;
}

export async function runAutocomplete<O extends OptionsRecord, G extends boolean>(
  definition: CommandDefinition<O, G>,
  options: RunAutocompleteOptions<O>,
): Promise<AutocompleteResult> {
  const recording = createRecording();
  const harness = createHarness({
    manifest: manifestFor({ kind: "command", id: "test", segments: ["test"], module: { default: definition } }, options),
    ...(options.app === undefined ? {} : { app: options.app }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.commands === undefined ? {} : { commands: options.commands }),
  });
  try {
    await harness.dispatch(
      createFakeInteraction({
        kind: "autocomplete",
        commandName: "test",
        recording,
        ...resolveScope(options, definition.guildOnly, undefined),
        focused: { name: options.option, value: options.value ?? "" },
      }),
    );
  } finally {
    await harness.close();
  }
  return { choices: (recording.choices ?? []) as OptionChoice[], error: harness.errors[0] ?? null };
}

export interface RunUserCommandOptions extends RunOptions {
  target?: User;
  targetMember?: GuildMember | null;
}

export async function runUserCommand<G extends boolean>(
  definition: UserCommandDefinition<G>,
  options: RunUserCommandOptions = {},
): Promise<TestResult> {
  const scope = resolveScope(options, definition.guildOnly, definition.permissions);
  return runInteraction(
    { kind: "user-command", id: "test/user", segments: ["user"], module: { default: definition } },
    options,
    {
      kind: "user-command",
      commandName: definition.name,
      ...scope,
      target: options.target ?? mockUser(),
      targetMember: options.targetMember ?? null,
    },
  );
}

export interface RunMessageCommandOptions extends RunOptions {
  target: Message;
}

export async function runMessageCommand<G extends boolean>(
  definition: MessageCommandDefinition<G>,
  options: RunMessageCommandOptions,
): Promise<TestResult> {
  const scope = resolveScope(options, definition.guildOnly, definition.permissions);
  return runInteraction(
    { kind: "message-command", id: "test/message", segments: ["message"], module: { default: definition } },
    options,
    { kind: "message-command", commandName: definition.name, ...scope, target: options.target },
  );
}

export interface RunButtonOptions<R extends string> extends RunOptions {
  customId?: string;
  params?: RouteParamInput<R>;
  message?: Message;
}

function customIdFor(route: string, customId: string | undefined, params: unknown): string {
  return customId ?? buildCustomId(route, (params ?? {}) as Record<string, unknown>);
}

export async function runButton<R extends string, G extends boolean>(
  definition: ButtonDefinition<R, G>,
  options: RunButtonOptions<R> = {},
): Promise<TestResult> {
  const scope = resolveScope(options, definition.guildOnly, definition.permissions);
  return runInteraction(
    { kind: "button", id: definition.route, segments: definition.route.split("/"), module: { default: definition } },
    options,
    {
      kind: "button",
      ...scope,
      customId: customIdFor(definition.route, options.customId, options.params),
      ...(options.message === undefined ? {} : { message: options.message }),
    },
  );
}

export interface RunSelectOptions<R extends string> extends RunButtonOptions<R> {
  values: readonly string[];
  users?: readonly User[];
  members?: readonly GuildMember[];
  roles?: readonly Role[];
  channels?: readonly { id: string }[];
}

const SELECT_FAKE_KINDS = {
  string: "string-select",
  user: "user-select",
  role: "role-select",
  channel: "channel-select",
  mentionable: "mentionable-select",
} as const;

export async function runSelect<R extends string, T extends SelectType, G extends boolean>(
  definition: SelectDefinition<R, T, G>,
  options: RunSelectOptions<R>,
): Promise<TestResult> {
  const scope = resolveScope(options, definition.guildOnly, definition.permissions);
  const type: SelectType = definition.type ?? "string";
  return runInteraction(
    { kind: "select", id: definition.route, segments: definition.route.split("/"), module: { default: definition } },
    options,
    {
      kind: SELECT_FAKE_KINDS[type],
      ...scope,
      customId: customIdFor(definition.route, options.customId, options.params),
      values: options.values,
      selected: {
        ...(options.users === undefined ? {} : { users: options.users }),
        ...(options.members === undefined ? {} : { members: options.members }),
        ...(options.roles === undefined ? {} : { roles: options.roles }),
        ...(options.channels === undefined ? {} : { channels: options.channels }),
      },
      ...(options.message === undefined ? {} : { message: options.message }),
    },
  );
}

export interface RunModalOptions<R extends string> extends RunButtonOptions<R> {
  values: DefaultModalValues;
}

export async function runModal<R extends string, S extends ModalSchema, G extends boolean>(
  definition: ModalDefinition<R, S, G>,
  options: RunModalOptions<R>,
): Promise<TestResult> {
  const scope = resolveScope(options, definition.guildOnly, definition.permissions);
  return runInteraction(
    { kind: "modal", id: definition.route, segments: definition.route.split("/"), module: { default: definition } },
    options,
    {
      kind: "modal",
      ...scope,
      customId: customIdFor(definition.route, options.customId, options.params),
      modalValues: options.values,
      ...(options.message === undefined ? {} : { message: options.message }),
    },
  );
}

export interface RunBackgroundOptions {
  app?: AppContext | Record<string, unknown>;
  logger?: Logger;
  commands?: readonly CommandInfo[];
}

export interface BackgroundResult {
  error: unknown;
}

function backgroundDeps(options: RunBackgroundOptions, onError: (error: unknown) => void) {
  const client = testClient();
  return {
    client,
    app: (options.app ?? {}) as AppContext,
    logger: options.logger ?? createLogger({ level: "silent" }),
    shards: createShardHelpers(client),
    commands: options.commands,
    onError,
  };
}

export async function runEvent<E extends EventName>(
  definition: EventDefinition<E>,
  args: ClientEvents[E],
  options: RunBackgroundOptions = {},
): Promise<BackgroundResult> {
  let captured: unknown = null;
  const deps = backgroundDeps(options, (error) => {
    captured = error;
  });
  const compiled = compileManifest(
    manifestFor(
      { kind: "event", id: definition.event, segments: [definition.event], module: { default: definition } },
      {},
    ),
  );
  const route = compiled.events[0];
  if (route === undefined) throw new Error("runEvent() needs a defineEvent(...) definition.");
  await createEventHandler(route, deps)(...args);
  return { error: captured };
}

export async function runTask(definition: TaskDefinition, options: RunBackgroundOptions = {}): Promise<BackgroundResult> {
  let captured: unknown = null;
  const deps = backgroundDeps(options, (error) => {
    captured = error;
  });
  const compiled = compileManifest(
    manifestFor({ kind: "task", id: "test/task", segments: ["task"], module: { default: { ...definition, every: "1h", runOnStart: true, shard: "all" } } }, {}),
  );
  const runner = createTaskRunner({
    tasks: compiled.tasks,
    client: deps.client,
    logger: deps.logger,
    createContext: (route) => createBaseContext(deps, route),
    onError: deps.onError,
  });
  runner.start();
  await runner.stop();
  return { error: captured };
}

export interface RenderModalOptions<R extends string> extends RunBackgroundOptions {
  params?: RouteParamInput<R>;
  user?: User;
  guild?: Guild | null;
  member?: GuildMember | null;
}

function renderOnlyContext(route: string, options: RenderModalOptions<string>): AnyContext {
  const unavailable = (): Promise<never> =>
    Promise.reject(new Error("Replying is not available while renderModalOf() renders a modal."));
  return {
    ...createBaseContext(backgroundDeps(options, () => undefined), { id: route, feature: "test" }),
    kind: "button",
    interaction: null,
    guild: options.guild ?? options.member?.guild ?? null,
    member: options.member ?? null,
    user: options.user ?? options.member?.user ?? mockUser(),
    state: {},
    reply: unavailable,
    editReply: unavailable,
    followUp: unavailable,
    defer: unavailable,
    deleteReply: unavailable,
    showModal: unavailable,
  } as unknown as AnyContext;
}

export function renderModalOf<R extends string, S extends ModalSchema, G extends boolean>(
  definition: ModalDefinition<R, S, G>,
  options: RenderModalOptions<R> = {},
): ModalRenderResult {
  const params = (options.params ?? {}) as Record<string, unknown>;
  return renderModalRoute(
    definition as unknown as ModalDefinition,
    buildCustomId(definition.route, params),
    stringifyParams(params),
    renderOnlyContext(definition.route, options as RenderModalOptions<string>),
  );
}
