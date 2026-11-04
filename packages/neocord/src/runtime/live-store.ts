import { createLiveRoot, render, Message, TextDisplay, type LiveRoot, type RenderResult } from "@neocord/react";
import {
  ComponentType,
  MessageFlags,
  type ButtonInteraction,
  type AnySelectMenuInteraction,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { createElement, type ReactNode } from "react";
import type { Logger } from "../logger.ts";
import { createResponder, toEditPayload, type Responder, type ReplyTarget } from "./reply.ts";

export type LiveComponentInteraction = ButtonInteraction | AnySelectMenuInteraction;

export type LiveErrorHandler = (
  error: unknown,
  interaction: LiveComponentInteraction,
  responder: Responder,
) => Promise<void>;

export interface LiveSession {
  readonly id: string;
  readonly root: LiveRoot;
  attach(target: ReplyTarget): void;
  destroy(): void;
}

export interface OpenedRoot {
  payload: RenderResult;
  session: LiveSession | null;
}

export interface LiveStoreOptions {
  ttl: number;
  logger: Logger;
  autoDeferAfter?: number | false;
}

export interface LiveStore {
  readonly size: number;
  open(node: ReactNode, onError?: LiveErrorHandler): Promise<OpenedRoot>;
  handle(interaction: LiveComponentInteraction): Promise<void>;
  has(sessionId: string): boolean;
  clear(): void;
  shutdown(): Promise<void>;
}

interface SessionRecord extends LiveSession {
  push(payload: RenderResult): void;
  touch(): void;
  expire(): Promise<void>;
  retarget(target: ReplyTarget, fallback: LiveMessage | null): void;
  onError: LiveErrorHandler | undefined;
  fallback: LiveMessage | null;
}

interface LiveMessage {
  edit(options: InteractionUpdateOptions): Promise<unknown>;
}

const EXPIRED_TEXT = "This message has expired.";
const SHUTDOWN_EDIT_TIMEOUT_MS = 2000;

export function isLiveCustomId(customId: string): boolean {
  return customId.startsWith("~");
}

export function sessionIdOf(customId: string): string {
  const separator = customId.indexOf(":");
  return customId.slice(1, separator === -1 ? undefined : separator);
}

function newSessionId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 16);
}

type JsonComponent = { type: number; components?: JsonComponent[]; accessory?: { type: number } };

function withoutInteractive(components: readonly JsonComponent[]): JsonComponent[] {
  return components.flatMap((component): JsonComponent[] => {
    if (component.type === ComponentType.ActionRow) return [];
    if (component.type === ComponentType.Section && component.accessory?.type === ComponentType.Button) {
      return component.components ?? [];
    }
    if (component.type === ComponentType.Container) {
      const children = withoutInteractive(component.components ?? []);
      return children.length === 0 ? [] : [{ ...component, components: children }];
    }
    return [component];
  });
}

function strippedMessageComponents(interaction: LiveComponentInteraction): JsonComponent[] {
  const components = interaction.message.components as unknown as readonly { toJSON(): JsonComponent }[];
  return withoutInteractive(components.map((component) => component.toJSON()));
}

function expiredNotice(): RenderResult {
  return render(createElement(Message, { ephemeral: true }, createElement(TextDisplay, null, EXPIRED_TEXT)));
}

async function replyExpired(interaction: LiveComponentInteraction, logger: Logger): Promise<void> {
  const notice = expiredNotice() as InteractionReplyOptions;
  const stripped = strippedMessageComponents(interaction);
  try {
    if (stripped.length === 0) {
      await interaction.reply(notice);
      return;
    }
    await interaction.update({
      components: stripped,
      flags: MessageFlags.IsComponentsV2,
    } as unknown as InteractionUpdateOptions);
    await interaction.followUp(notice);
  } catch (error) {
    logger.debug("Could not strip components from an expired live message.", error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(notice).catch((followUpError: unknown) => {
        logger.debug("Could not send the expired notice.", followUpError);
      });
    } else {
      await interaction.reply(notice).catch((replyError: unknown) => {
        logger.debug("Could not send the expired notice.", replyError);
      });
    }
  }
}

export function createLiveStore(options: LiveStoreOptions): LiveStore {
  const { ttl, logger } = options;
  const sessions = new Map<string, SessionRecord>();

  const createSession = (id: string, root: LiveRoot, pending: RenderResult | null): SessionRecord => {
    let target: ReplyTarget | null = null;
    let buffered = pending;
    let inFlight: Promise<void> | null = null;
    let queued: RenderResult | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    const deliver = async (payload: RenderResult): Promise<void> => {
      if (target === null) return;
      try {
        await target.edit(payload);
      } catch (error) {
        logger.debug("Editing through the interaction token failed.", error);
        if (record.fallback === null) {
          logger.warn("Could not update a live message.", error);
          return;
        }
        try {
          await record.fallback.edit(toEditPayload(payload) as InteractionUpdateOptions);
        } catch (fallbackError) {
          logger.warn("Could not update a live message.", fallbackError);
        }
      }
    };

    const drain = (): void => {
      if (inFlight !== null || queued === null || target === null) return;
      const payload = queued;
      queued = null;
      inFlight = deliver(payload).finally(() => {
        inFlight = null;
        drain();
      });
    };

    const clearTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const record: SessionRecord = {
      id,
      root,
      fallback: null,
      onError: undefined,
      attach(next) {
        target = next;
        if (buffered !== null) {
          queued = buffered;
          buffered = null;
          drain();
        }
      },
      retarget(next, fallback) {
        target = next;
        record.fallback = fallback;
      },
      push(payload) {
        if (destroyed) return;
        if (target === null) {
          buffered = payload;
          return;
        }
        queued = payload;
        drain();
      },
      touch() {
        clearTimer();
        timer = setTimeout(() => {
          void record.expire();
        }, ttl);
        timer.unref();
      },
      async expire() {
        if (destroyed) return;
        const finalPayload = root.disableInteractive();
        queued = finalPayload;
        drain();
        while (inFlight !== null) await inFlight;
        record.destroy();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        clearTimer();
        sessions.delete(id);
        root.unmount();
      },
    };
    return record;
  };

  return {
    get size() {
      return sessions.size;
    },

    has: (sessionId) => sessions.has(sessionId),

    async open(node, onError) {
      const id = newSessionId();
      let session: SessionRecord | null = null;
      let earlyUpdate: RenderResult | null = null;
      const root = createLiveRoot({
        sessionId: id,
        onUpdate: (payload) => {
          if (session === null) {
            earlyUpdate = payload;
          } else {
            session.push(payload);
          }
        },
        onError: (error) => {
          logger.error("A live session failed while updating.", error);
        },
      });

      try {
        root.render(node);
        await root.settle();
      } catch (error) {
        root.unmount();
        throw error;
      }

      if (!root.hasHandlers) {
        const payload = root.payload;
        root.unmount();
        return { payload, session: null };
      }

      session = createSession(id, root, earlyUpdate);
      session.onError = onError;
      sessions.set(id, session);
      session.touch();
      return { payload: root.payload, session };
    },

    async handle(interaction) {
      const session = sessions.get(sessionIdOf(interaction.customId));
      if (session === undefined) {
        logger.debug(`Live session for "${interaction.customId}" is gone.`);
        await replyExpired(interaction, logger);
        return;
      }

      session.touch();
      const responder = createResponder({
        interaction,
        logger,
        deferMode: "update",
        autoDeferAfter: options.autoDeferAfter ?? false,
      });
      responder.armAutoDefer();

      try {
        await session.root.dispatch(interaction.customId, interaction);
      } catch (error) {
        logger.error(`A live handler failed for "${interaction.customId}".`, error);
        if (session.onError !== undefined) {
          await session.onError(error, interaction, responder).catch((handlerError: unknown) => {
            logger.error("Could not report a live handler error.", handlerError);
          });
        }
      } finally {
        responder.cancelAutoDefer();
      }

      if (!sessions.has(session.id)) return;

      const payload = session.root.payload;
      const fallback = interaction.message as unknown as LiveMessage;
      const state = responder.state;
      if (state === "unacknowledged" || state === "updated") {
        const target = await responder.update(payload);
        if (target !== null) session.retarget(target, fallback);
      } else {
        session.push(payload);
      }
    },

    clear() {
      for (const session of [...sessions.values()]) session.destroy();
    },

    async shutdown() {
      const expiring = Promise.allSettled([...sessions.values()].map((session) => session.expire()));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_EDIT_TIMEOUT_MS);
        timer.unref();
      });
      await Promise.race([expiring, timeout]);
      if (timer !== undefined) clearTimeout(timer);
      for (const session of [...sessions.values()]) session.destroy();
    },
  };
}
