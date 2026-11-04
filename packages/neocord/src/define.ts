import type {
  ButtonDefinition,
  ButtonInput,
  CommandDefinition,
  CommandInput,
  ContextDefinition,
  ContextFactory,
  EventDefinition,
  EventInput,
  EventName,
  FeatureDefinition,
  FeatureInput,
  GroupDefinition,
  GroupInput,
  InteractionKind,
  MessageCommandDefinition,
  MessageCommandInput,
  MiddlewareDefinition,
  MiddlewareHandler,
  MiddlewareOptions,
  ModalDefinition,
  ModalInput,
  ModalSchema,
  OptionsRecord,
  SelectDefinition,
  SelectInput,
  SelectType,
  TaskDefinition,
  TaskInput,
  UserCommandDefinition,
  UserCommandInput,
} from "./types.ts";

export function defineCommand<O extends OptionsRecord = {}, const G extends boolean = false>(
  definition: CommandInput<O, G>,
): CommandDefinition<O, G> {
  return { __neocord: "command", ...definition };
}

export function defineUserCommand<const G extends boolean = false>(
  definition: UserCommandInput<G>,
): UserCommandDefinition<G> {
  return { __neocord: "user-command", ...definition };
}

export function defineMessageCommand<const G extends boolean = false>(
  definition: MessageCommandInput<G>,
): MessageCommandDefinition<G> {
  return { __neocord: "message-command", ...definition };
}

export function defineGroup(definition: GroupInput): GroupDefinition {
  return { __neocord: "group", ...definition };
}

export function defineButton<const R extends string, const G extends boolean = false>(
  route: R,
  definition: ButtonInput<R, G>,
): ButtonDefinition<R, G> {
  return { __neocord: "button", route, ...definition };
}

export function defineSelect<const R extends string, const T extends SelectType = "string", const G extends boolean = false>(
  route: R,
  definition: SelectInput<R, T, G>,
): SelectDefinition<R, T, G> {
  return { __neocord: "select", route, ...definition };
}

export function defineModal<
  const R extends string,
  S extends ModalSchema = undefined,
  const G extends boolean = false,
>(route: R, definition: ModalInput<R, S, G>): ModalDefinition<R, S, G> {
  return { __neocord: "modal", route, ...definition };
}

export function defineEvent<const E extends EventName>(event: E, definition: EventInput<E>): EventDefinition<E> {
  return { __neocord: "event", event, ...definition };
}

export function defineTask(definition: TaskInput): TaskDefinition {
  return { __neocord: "task", ...definition };
}

export function defineMiddleware<K extends InteractionKind = InteractionKind>(
  handler: MiddlewareHandler<K>,
  options: MiddlewareOptions<K> = {},
): MiddlewareDefinition<K> {
  return { __neocord: "middleware", handler, kinds: options.kinds };
}

export function defineFeature(definition: FeatureInput = {}): FeatureDefinition {
  return { __neocord: "feature", ...definition };
}

export function defineContext<T>(factory: ContextFactory<T>): ContextDefinition<T> {
  return { __neocord: "context", factory };
}
