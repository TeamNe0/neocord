import {
  buildCustomId,
  escapeMarkdown,
  List,
  ListItem,
  Message,
  TextDisplay,
  Timestamp,
  render,
  type RenderResult,
} from "@neocord/react";
import type {
  AnySelectMenuInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Interaction,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  PermissionsString,
  RepliableInteraction,
  UserContextMenuCommandInteraction,
} from "discord.js";
import type { ReactNode } from "react";
import type { Logger } from "../logger.ts";
import type { StandardSchemaV1 } from "../standard-schema.ts";
import type {
  AnyContext,
  AppContext,
  AutocompleteContext,
  BaseContext,
  CommandContext,
  CommandInfo,
  DefaultModalValues,
  ModalContext,
  ReplyOptions,
  SelectContext,
  ShardHelpers,
  ButtonContext,
  MessageCommandContext,
  UserCommandContext,
} from "../types.ts";
import { OptionResolutionError, resolveOptions } from "./commands.ts";
import { createCooldowns, type Cooldowns } from "./cooldown.ts";
import {
  createLiveStore,
  isLiveCustomId,
  type LiveErrorHandler,
  type LiveStore,
} from "./live-store.ts";
import { listCommands, type CompiledManifest, type CompiledRoute } from "./manifest.ts";
import { isRenderable, runMiddleware } from "./middleware.ts";
import { createResponder, type ReplyTarget, type Responder, type SendOptions } from "./reply.ts";
import { renderForInteraction, renderModalRoute, renderOneShot, stringifyParams } from "./render.tsx";

export interface DispatcherOptions {
  client: Client<true>;
  app: AppContext;
  logger: Logger;
  shards: ShardHelpers;
  compiled: CompiledManifest;
  autoDeferAfter: number | false;
  liveTtl: number;
  commands?: readonly CommandInfo[] | undefined;
  onError?: ((error: unknown) => void) | undefined;
}

export interface Dispatcher {
  readonly live: LiveStore;
  readonly cooldowns: Cooldowns;
  handle(interaction: Interaction): Promise<void>;
  shutdown(): Promise<void>;
}

interface GuildScope {
  guild: AnyContext["guild"];
  member: AnyContext["member"];
}

interface SharedContext extends BaseContext, GuildScope {
  interaction: RepliableInteraction;
  user: AnyContext["user"];
  state: Record<string, unknown>;
  reply(node: ReactNode, options?: ReplyOptions): Promise<void>;
  editReply(node: ReactNode, options?: ReplyOptions): Promise<void>;
  followUp(node: ReactNode, options?: ReplyOptions): Promise<void>;
  defer(options?: { ephemeral?: boolean }): Promise<void>;
  deleteReply(): Promise<void>;
  showModal(route: string, params?: Record<string, unknown>): Promise<void>;
}

interface RouteTools {
  responder: Responder;
  shared: SharedContext;
  update(node: ReactNode, options?: ReplyOptions): Promise<void>;
  sendLoading(): Promise<void>;
  bind(ctx: AnyContext): void;
}

const FALLBACK_ERROR_TEXT = "Something went wrong while handling this interaction.";
const UNKNOWN_ROUTE_TEXT = "This interaction is no longer available.";
const GUILD_ONLY_TEXT = "This can only be used in a server.";

function plainNotice(text: string): RenderResult {
  return render(
    <Message ephemeral>
      <TextDisplay>{text}</TextDisplay>
    </Message>,
  );
}

function humanizePermission(permission: PermissionsString): string {
  return permission.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function isGuildMember(value: unknown): value is NonNullable<AnyContext["member"]> {
  return typeof value === "object" && value !== null && "guild" in value;
}

export function collectModalValues(interaction: ModalSubmitInteraction): DefaultModalValues {
  const values: DefaultModalValues = {};
  for (const [customId, field] of interaction.fields.fields) {
    if ("values" in field) {
      values[customId] = [...field.values];
    } else if (typeof field.value === "boolean") {
      values[customId] = field.value;
    } else if (typeof field.value === "string" && field.value !== "") {
      values[customId] = field.value;
    }
  }
  return values;
}

function formatIssues(issues: readonly StandardSchemaV1.Issue[]): ReactNode {
  return (
    <List>
      {issues.map((issue, index) => {
        const path = issue.path
          ?.map((segment) => String(typeof segment === "object" && segment !== null ? segment.key : segment))
          .join(".");
        const text = path === undefined || path === "" ? issue.message : `${path}: ${issue.message}`;
        return <ListItem key={index}>{escapeMarkdown(text)}</ListItem>;
      })}
    </List>
  );
}

export function createBaseContext(
  options: Pick<DispatcherOptions, "client" | "app" | "logger" | "shards" | "commands">,
  route: Pick<CompiledRoute, "id" | "feature">,
): BaseContext {
  return {
    client: options.client,
    app: options.app,
    logger: options.logger.child(route.id),
    feature: route.feature,
    route: route.id,
    shards: options.shards,
    commands: options.commands ?? [],
  };
}

export function createEventHandler(
  route: CompiledRoute<"event">,
  options: Pick<DispatcherOptions, "client" | "app" | "logger" | "shards" | "commands" | "onError">,
): (...args: unknown[]) => Promise<void> {
  const ctx = createBaseContext(options, route);
  const execute = route.definition.execute as (ctx: BaseContext, ...args: unknown[]) => unknown;
  return async (...args) => {
    try {
      await execute(ctx, ...args);
    } catch (error) {
      options.logger.error(`Event ${route.id} (${route.file}) failed.`, error);
      options.onError?.(error);
    }
  };
}

export function createDispatcher(options: DispatcherOptions): Dispatcher {
  const { client, compiled, logger } = options;
  const contextOptions = { ...options, commands: options.commands ?? listCommands(compiled) };
  const cooldowns = createCooldowns();
  const live = createLiveStore({ ttl: options.liveTtl, logger, autoDeferAfter: options.autoDeferAfter });

  const reportError = async (
    error: unknown,
    route: CompiledRoute,
    ctx: AnyContext | null,
    responder: Responder,
  ): Promise<void> => {
    logger.error(`Handler failed for ${route.kind} ${route.id} (${route.file}).`, error);
    options.onError?.(error);
    if (responder.modalShown) return;

    let payload: RenderResult | null = null;
    if (route.error !== null && ctx !== null) {
      const ErrorView = route.error;
      try {
        payload = await renderOneShot({ node: <ErrorView error={error} ctx={ctx} />, ctx, layouts: [] });
      } catch (viewError) {
        logger.error(`Error view ${route.file} failed to render.`, viewError);
      }
    }
    try {
      await responder.send(payload ?? plainNotice(FALLBACK_ERROR_TEXT), { ephemeral: true });
    } catch (sendError) {
      logger.error("Could not send the error message.", sendError);
    }
  };

  const createTools = (
    route: CompiledRoute,
    interaction: RepliableInteraction,
    deferMode: "reply" | "update",
    scope: GuildScope,
  ): RouteTools => {
    const metadata = route.definition as { ephemeral?: boolean; layout?: boolean };
    const responder = createResponder({
      interaction,
      logger,
      ephemeral: metadata.ephemeral,
      deferMode,
      autoDeferAfter: options.autoDeferAfter,
    });

    let ctx: AnyContext | null = null;

    const onLiveError: LiveErrorHandler = (error, _interaction, liveResponder) =>
      reportError(error, route, ctx, liveResponder);

    const deliver = async (
      node: ReactNode,
      replyOptions: ReplyOptions | undefined,
      send: (payload: RenderResult, sendOptions: SendOptions) => Promise<ReplyTarget | null>,
    ): Promise<void> => {
      const useLayouts = replyOptions?.layout ?? metadata.layout ?? true;
      const { payload, session } = await renderForInteraction(
        { node, ctx, layouts: useLayouts ? route.layouts : [] },
        live,
        onLiveError,
      );
      let target: ReplyTarget | null;
      try {
        target = await send(payload, { ephemeral: replyOptions?.ephemeral });
      } catch (error) {
        session?.destroy();
        throw error;
      }
      if (session !== null) {
        if (target === null) {
          session.destroy();
        } else {
          session.attach(target);
        }
      }
    };

    const shared: SharedContext = {
      ...createBaseContext(contextOptions, route),
      ...scope,
      interaction,
      user: interaction.user,
      state: {},
      reply: (node, replyOptions) => deliver(node, replyOptions, (payload, send) => responder.send(payload, send)),
      editReply: (node, replyOptions) => deliver(node, replyOptions, (payload, send) => responder.edit(payload, send)),
      followUp: (node, replyOptions) => deliver(node, replyOptions, (payload, send) => responder.followUp(payload, send)),
      defer: (deferOptions) => responder.defer(deferOptions),
      deleteReply: () => responder.deleteReply(),
      showModal: async (modalRoute, params) => {
        const entry = compiled.modalsById.get(modalRoute);
        if (entry === undefined) {
          throw new Error(`showModal() was given "${modalRoute}", which is not a modal route of this bot.`);
        }
        const customId = buildCustomId(modalRoute, params ?? {});
        await responder.showModal(renderModalRoute(entry.definition, customId, stringifyParams(params ?? {}), ctx));
      },
    };

    return {
      responder,
      shared,
      update: (node, replyOptions) => deliver(node, replyOptions, (payload) => responder.update(payload)),
      sendLoading: async () => {
        if (route.loading === null) return;
        const Loading = route.loading;
        await deliver(<Loading />, undefined, (payload, send) => responder.sendPlaceholder(payload, send));
      },
      bind: (next) => {
        ctx = next;
      },
    };
  };

  const resolveScope = async (route: CompiledRoute, interaction: RepliableInteraction): Promise<GuildScope> => {
    let guild = interaction.guild;
    if (guild === null && route.guildOnly && interaction.guildId !== null) {
      guild = await client.guilds.fetch(interaction.guildId).catch((error: unknown) => {
        logger.debug(`Could not fetch guild ${interaction.guildId}.`, error);
        return null;
      });
    }
    let member = isGuildMember(interaction.member) ? interaction.member : null;
    if (member === null && route.guildOnly && guild !== null) {
      member = await guild.members.fetch(interaction.user.id).catch((error: unknown) => {
        logger.debug(`Could not fetch member ${interaction.user.id}.`, error);
        return null;
      });
    }
    return { guild, member };
  };

  const applyCooldown = async (route: CompiledRoute, user: AnyContext["user"], tools: RouteTools): Promise<boolean> => {
    if (route.cooldownMs === null || route.cooldownMs <= 0) return true;
    const retryAt = cooldowns.hit(`${route.kind}:${route.id}:${user.id}`, route.cooldownMs);
    if (retryAt === null) return true;
    await tools.responder.send(
      await renderOneShot({
        node: (
          <Message ephemeral>
            <TextDisplay>
              You are on cooldown. Try again <Timestamp date={retryAt} style="R" />.
            </TextDisplay>
          </Message>
        ),
        ctx: null,
        layouts: [],
      }),
      { ephemeral: true },
    );
    return false;
  };

  const run = async <C extends AnyContext>(
    route: CompiledRoute,
    interaction: RepliableInteraction,
    deferMode: "reply" | "update",
    build: (tools: RouteTools, scope: GuildScope) => Promise<C | null>,
    terminal: (ctx: C, tools: RouteTools) => Promise<void>,
  ): Promise<void> => {
    let tools: RouteTools | null = null;
    let ctx: C | null = null;
    const bootstrap = createResponder({ interaction, logger, autoDeferAfter: false });
    try {
      const scope = await resolveScope(route, interaction);
      if (route.guildOnly && (scope.guild === null || scope.member === null)) {
        await bootstrap.send(plainNotice(GUILD_ONLY_TEXT), { ephemeral: true });
        return;
      }
      if (route.permissions.length > 0) {
        const granted = interaction.memberPermissions;
        if (granted === null) {
          await bootstrap.send(plainNotice(GUILD_ONLY_TEXT), { ephemeral: true });
          return;
        }
        const missing = route.permissions.filter((permission) => !granted.has(permission));
        if (missing.length > 0) {
          await bootstrap.send(
            plainNotice(`You need these permissions to do that: ${missing.map(humanizePermission).join(", ")}.`),
            { ephemeral: true },
          );
          return;
        }
      }

      tools = createTools(route, interaction, deferMode, scope);
      tools.responder.armAutoDefer();
      ctx = await build(tools, scope);
      if (ctx === null) return;
      tools.bind(ctx);

      const activeTools = tools;
      const activeCtx = ctx;
      await runMiddleware(
        route.middleware,
        activeCtx,
        () => terminal(activeCtx, activeTools),
        (node) => activeCtx.reply(node),
      );
    } catch (error) {
      const responder = tools?.responder ?? bootstrap;
      if (error instanceof OptionResolutionError) {
        logger.debug(error.message);
        await responder.send(plainNotice(error.message), { ephemeral: true }).catch((sendError: unknown) => {
          logger.error("Could not send the option error.", sendError);
        });
      } else {
        await reportError(error, route, ctx, responder);
      }
    } finally {
      tools?.responder.cancelAutoDefer();
      await tools?.responder.settled();
    }
  };

  const finishCommand = async (route: CompiledRoute, ctx: AnyContext, tools: RouteTools, result: unknown): Promise<void> => {
    if (isRenderable(result)) {
      await ctx.reply(result);
      return;
    }
    const { responder } = tools;
    await responder.settled();
    if (responder.state === "unacknowledged") {
      logger.warn(`${route.kind} ${route.id} (${route.file}) returned nothing and did not acknowledge the interaction.`);
    } else if (responder.autoDeferred && responder.state === "deferred") {
      logger.warn(`${route.kind} ${route.id} (${route.file}) was deferred automatically but returned nothing, removing the placeholder.`);
      await responder.deleteReply();
    }
  };

  const finishComponent = async (
    respond: "update" | "reply" | undefined,
    ctx: AnyContext,
    tools: RouteTools,
    result: unknown,
  ): Promise<void> => {
    if (isRenderable(result)) {
      if (respond === "reply") {
        await ctx.reply(result);
      } else {
        await tools.update(result);
      }
      return;
    }
    await tools.responder.settled();
    if (tools.responder.state === "unacknowledged") await tools.responder.deferUpdate();
  };

  const terminalCommand = async (
    route: CompiledRoute,
    ctx: AnyContext,
    tools: RouteTools,
    execute: () => unknown,
  ): Promise<void> => {
    if (!(await applyCooldown(route, ctx.user, tools))) return;
    await tools.sendLoading();
    await finishCommand(route, ctx, tools, await execute());
  };

  const commandKey = (interaction: ChatInputCommandInteraction | AutocompleteInteraction): string =>
    [
      interaction.commandName,
      interaction.options.getSubcommandGroup(false),
      interaction.options.getSubcommand(false),
    ]
      .filter((part): part is string => part !== null && part !== undefined)
      .join(" ");

  const unknownRoute = async (interaction: RepliableInteraction, description: string): Promise<void> => {
    logger.warn(`No route matches ${description}.`);
    const responder = createResponder({ interaction, logger });
    await responder.send(plainNotice(UNKNOWN_ROUTE_TEXT), { ephemeral: true });
  };

  const handleCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const key = commandKey(interaction);
    const route = compiled.commands.get(key);
    if (route === undefined) return unknownRoute(interaction, `command "/${key}"`);
    await run<CommandContext>(
      route,
      interaction,
      "reply",
      async ({ shared }, scope) => ({
        ...(shared as unknown as CommandContext),
        kind: "command",
        options: await resolveOptions(route.definition, interaction, scope.guild, client),
      }),
      (ctx, tools) => terminalCommand(route, ctx, tools, () => route.definition.execute(ctx)),
    );
  };

  const handleUserCommand = async (interaction: UserContextMenuCommandInteraction): Promise<void> => {
    const route = compiled.userCommands.get(interaction.commandName);
    if (route === undefined) return unknownRoute(interaction, `user command "${interaction.commandName}"`);
    await run<UserCommandContext>(
      route,
      interaction,
      "reply",
      async ({ shared }) => ({
        ...(shared as unknown as UserCommandContext),
        kind: "user-command",
        target: interaction.targetUser,
        targetMember: isGuildMember(interaction.targetMember) ? interaction.targetMember : null,
      }),
      (ctx, tools) => terminalCommand(route, ctx, tools, () => route.definition.execute(ctx)),
    );
  };

  const handleMessageCommand = async (interaction: MessageContextMenuCommandInteraction): Promise<void> => {
    const route = compiled.messageCommands.get(interaction.commandName);
    if (route === undefined) return unknownRoute(interaction, `message command "${interaction.commandName}"`);
    await run<MessageCommandContext>(
      route,
      interaction,
      "reply",
      async ({ shared }) => ({
        ...(shared as unknown as MessageCommandContext),
        kind: "message-command",
        target: interaction.targetMessage,
      }),
      (ctx, tools) => terminalCommand(route, ctx, tools, () => route.definition.execute(ctx)),
    );
  };

  const handleAutocomplete = async (interaction: AutocompleteInteraction): Promise<void> => {
    const key = commandKey(interaction);
    const route = compiled.commands.get(key);
    const focused = interaction.options.getFocused(true);
    const handler = route?.definition.options?.[focused.name]?.autocomplete;
    try {
      if (route === undefined || handler === undefined) {
        logger.warn(`No autocomplete handler for "/${key}" option "${focused.name}".`);
        await interaction.respond([]);
        return;
      }
      const ctx: AutocompleteContext = {
        ...createBaseContext(contextOptions, route),
        kind: "autocomplete",
        interaction,
        guild: interaction.guild,
        member: isGuildMember(interaction.member) ? interaction.member : null,
        user: interaction.user,
        focused: String(focused.value),
        optionName: focused.name,
      };
      const choices = await handler(ctx);
      await interaction.respond(
        choices.slice(0, 25).map((choice) => ({
          name: choice.name,
          value: choice.value,
          ...(choice.nameLocalizations === undefined ? {} : { nameLocalizations: choice.nameLocalizations }),
        })),
      );
    } catch (error) {
      logger.error(`Autocomplete failed for "/${key}" option "${focused.name}".`, error);
      options.onError?.(error);
      await interaction.respond([]).catch((respondError: unknown) => {
        logger.debug("Could not send empty autocomplete choices.", respondError);
      });
    }
  };

  const handleButton = async (interaction: ButtonInteraction): Promise<void> => {
    if (isLiveCustomId(interaction.customId)) {
      await live.handle(interaction);
      return;
    }
    const match = compiled.buttons.match(interaction.customId);
    if (match === null) return unknownRoute(interaction, `button "${interaction.customId}"`);
    const { route, params } = match;
    await run<ButtonContext>(
      route,
      interaction,
      route.definition.respond === "reply" ? "reply" : "update",
      async (tools) => ({
        ...(tools.shared as unknown as ButtonContext),
        kind: "button",
        params,
        message: interaction.message,
        update: tools.update,
        deferUpdate: () => tools.responder.deferUpdate(),
      }),
      async (ctx, tools) => {
        if (!(await applyCooldown(route, ctx.user, tools))) return;
        await finishComponent(route.definition.respond, ctx, tools, await route.definition.execute(ctx));
      },
    );
  };

  const selectMatchesType = (interaction: AnySelectMenuInteraction, type: string): boolean => {
    switch (type) {
      case "string":
        return interaction.isStringSelectMenu();
      case "user":
        return interaction.isUserSelectMenu();
      case "role":
        return interaction.isRoleSelectMenu();
      case "channel":
        return interaction.isChannelSelectMenu();
      case "mentionable":
        return interaction.isMentionableSelectMenu();
      default:
        return false;
    }
  };

  const handleSelect = async (interaction: AnySelectMenuInteraction): Promise<void> => {
    if (isLiveCustomId(interaction.customId)) {
      await live.handle(interaction);
      return;
    }
    const match = compiled.selects.match(interaction.customId);
    if (match === null) return unknownRoute(interaction, `select "${interaction.customId}"`);
    const { route, params } = match;
    const type = route.definition.type ?? "string";
    if (!selectMatchesType(interaction, type)) {
      return unknownRoute(interaction, `a ${type} select for "${interaction.customId}" (${route.file} expects another type)`);
    }
    const extras = interaction as unknown as Record<"users" | "members" | "roles" | "channels", unknown>;
    await run<SelectContext>(
      route,
      interaction,
      route.definition.respond === "reply" ? "reply" : "update",
      async (tools) =>
        ({
          ...(tools.shared as unknown as SelectContext),
          kind: "select",
          params,
          values: [...interaction.values],
          message: interaction.message,
          update: tools.update,
          deferUpdate: () => tools.responder.deferUpdate(),
          ...(extras.users === undefined ? {} : { users: extras.users }),
          ...(extras.members === undefined ? {} : { members: extras.members }),
          ...(extras.roles === undefined ? {} : { roles: extras.roles }),
          ...(extras.channels === undefined ? {} : { channels: extras.channels }),
        }) as SelectContext,
      async (ctx, tools) => {
        if (!(await applyCooldown(route, ctx.user, tools))) return;
        await finishComponent(route.definition.respond, ctx, tools, await route.definition.execute(ctx));
      },
    );
  };

  const handleModal = async (interaction: ModalSubmitInteraction): Promise<void> => {
    const match = compiled.modals.match(interaction.customId);
    if (match === null) return unknownRoute(interaction, `modal "${interaction.customId}"`);
    const { route, params } = match;
    await run<ModalContext>(
      route,
      interaction,
      route.definition.respond === "update" ? "update" : "reply",
      async (tools) => {
        const raw = collectModalValues(interaction);
        let values: unknown = raw;
        const schema = route.definition.schema;
        if (schema !== undefined) {
          const parsed = await schema["~standard"].validate(raw);
          if (parsed.issues !== undefined) {
            await tools.responder.send(
              await renderOneShot({
                node: (
                  <Message ephemeral>
                    <TextDisplay>
                      Please check your answers:
                      {formatIssues(parsed.issues)}
                    </TextDisplay>
                  </Message>
                ),
                ctx: null,
                layouts: [],
              }),
              { ephemeral: true },
            );
            return null;
          }
          values = parsed.value;
        }
        const { showModal: _showModal, ...shared } = tools.shared;
        return {
          ...(shared as unknown as ModalContext),
          kind: "modal",
          params,
          values,
          fields: interaction.fields,
          update: tools.update,
          deferUpdate: () => tools.responder.deferUpdate(),
        } as ModalContext;
      },
      async (ctx, tools) => {
        if (!(await applyCooldown(route, ctx.user, tools))) return;
        const result = await route.definition.submit(ctx);
        if (isRenderable(result)) {
          if (route.definition.respond === "update") {
            await tools.update(result);
          } else {
            await ctx.reply(result);
          }
          return;
        }
        await tools.responder.settled();
        if (tools.responder.state === "unacknowledged") {
          if (interaction.isFromMessage()) {
            await tools.responder.deferUpdate();
          } else {
            logger.debug(`Modal ${route.id} returned nothing, acknowledging silently.`);
            await tools.responder.silentAcknowledge();
          }
        }
      },
    );
  };

  return {
    live,
    cooldowns,
    async handle(interaction) {
      try {
        if (interaction.isChatInputCommand()) return await handleCommand(interaction);
        if (interaction.isAutocomplete()) return await handleAutocomplete(interaction);
        if (interaction.isUserContextMenuCommand()) return await handleUserCommand(interaction);
        if (interaction.isMessageContextMenuCommand()) return await handleMessageCommand(interaction);
        if (interaction.isButton()) return await handleButton(interaction);
        if (interaction.isAnySelectMenu()) return await handleSelect(interaction);
        if (interaction.isModalSubmit()) return await handleModal(interaction);
      } catch (error) {
        logger.error("Interaction dispatch failed.", error);
        options.onError?.(error);
      }
    },
    async shutdown() {
      cooldowns.stop();
      await live.shutdown();
    },
  };
}
