import type { ModalRenderResult, RenderResult } from "@neocord/react";
import {
  MessageFlags,
  RESTJSONErrorCodes,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type RepliableInteraction,
} from "discord.js";
import type { Logger } from "../logger.ts";

export type ReplyState = "unacknowledged" | "deferred" | "replied" | "updated";

export interface ReplyTarget {
  edit(payload: RenderResult): Promise<void>;
}

export interface SendOptions {
  ephemeral?: boolean | undefined;
}

export interface ResponderOptions {
  interaction: RepliableInteraction;
  logger: Logger;
  ephemeral?: boolean | undefined;
  deferMode?: "reply" | "update";
  autoDeferAfter?: number | false;
}

export interface Responder {
  readonly state: ReplyState;
  readonly expired: boolean;
  readonly modalShown: boolean;
  readonly autoDeferred: boolean;
  readonly deferredUpdate: boolean;
  armAutoDefer(): void;
  cancelAutoDefer(): void;
  settled(): Promise<void>;
  send(payload: RenderResult, options?: SendOptions): Promise<ReplyTarget | null>;
  sendPlaceholder(payload: RenderResult, options?: SendOptions): Promise<ReplyTarget | null>;
  update(payload: RenderResult): Promise<ReplyTarget | null>;
  edit(payload: RenderResult, options?: SendOptions): Promise<ReplyTarget | null>;
  followUp(payload: RenderResult, options?: SendOptions): Promise<ReplyTarget | null>;
  defer(options?: SendOptions): Promise<void>;
  deferUpdate(): Promise<void>;
  deleteReply(): Promise<void>;
  showModal(modal: ModalRenderResult): Promise<void>;
  silentAcknowledge(): Promise<void>;
}

type EditPayload = Omit<RenderResult, "flags"> & { flags: MessageFlags.IsComponentsV2 };

export function toEditPayload(result: RenderResult): EditPayload {
  const { flags: _flags, ...rest } = result;
  return { ...rest, flags: MessageFlags.IsComponentsV2 };
}

function withEphemeral(result: RenderResult, ephemeral: boolean): RenderResult {
  const flags = (
    ephemeral ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2
  ) as RenderResult["flags"];
  return { ...result, flags };
}

function isEphemeralPayload(result: RenderResult): boolean {
  return (Number(result.flags) & MessageFlags.Ephemeral) !== 0;
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function isAlreadyAcknowledged(error: unknown): boolean {
  const code = errorCode(error);
  return code === RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged || code === "InteractionAlreadyReplied";
}

function isUnknownInteraction(error: unknown): boolean {
  return errorCode(error) === RESTJSONErrorCodes.UnknownInteraction;
}

interface UpdatableInteraction {
  update(options: InteractionUpdateOptions): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
}

function updatable(interaction: RepliableInteraction): UpdatableInteraction | null {
  if (interaction.isMessageComponent()) return interaction;
  if (interaction.isModalSubmit() && interaction.isFromMessage()) return interaction;
  return null;
}

export function createResponder(options: ResponderOptions): Responder {
  const { interaction, logger } = options;
  const deferMode = options.deferMode ?? "reply";
  const defaultEphemeral = options.ephemeral;

  let state: ReplyState = "unacknowledged";
  let acknowledgedEphemeral = false;
  let placeholder = false;
  let expired = false;
  let modalShown = false;
  let autoDeferred = false;
  let deferredUpdate = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = 0;
  let tail: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    pending += 1;
    const run = tail.then(operation);
    tail = run.then(
      () => {
        pending -= 1;
      },
      () => {
        pending -= 1;
      },
    );
    return run;
  };

  const sync = (): void => {
    if (state !== "unacknowledged") return;
    if (interaction.replied) {
      state = "replied";
    } else if (interaction.deferred) {
      state = interaction.ephemeral === null && updatable(interaction) !== null ? "updated" : "deferred";
    } else {
      return;
    }
    acknowledgedEphemeral = interaction.ephemeral === true;
    cancelAutoDefer();
  };

  const cancelAutoDefer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const markAcknowledged = (): void => {
    cancelAutoDefer();
    if (!interaction.deferred && !interaction.replied) interaction.deferred = true;
  };

  const guarded = async (name: string, call: () => Promise<unknown>, recover?: () => Promise<unknown>): Promise<boolean> => {
    if (expired) {
      logger.debug(`Skipped ${name}: the interaction has expired.`);
      return false;
    }
    try {
      await call();
      return true;
    } catch (error) {
      if (isUnknownInteraction(error)) {
        expired = true;
        cancelAutoDefer();
        logger.warn(`Could not ${name}: the interaction expired before neocord responded (code 10062).`);
        return false;
      }
      if (isAlreadyAcknowledged(error)) {
        markAcknowledged();
        if (state === "unacknowledged") state = "replied";
        logger.warn(`Could not ${name}: the interaction was already acknowledged (code 40060).`);
        if (recover === undefined) return false;
        try {
          await recover();
          return true;
        } catch (recoverError) {
          logger.warn(`Could not recover after an already acknowledged interaction.`, recoverError);
          return false;
        }
      }
      throw error;
    }
  };

  const originalTarget: ReplyTarget = {
    edit: async (payload) => {
      await interaction.editReply(toEditPayload(payload) as InteractionEditReplyOptions);
    },
  };

  const messageTarget = (messageId: string): ReplyTarget => ({
    edit: async (payload) => {
      await interaction.editReply({
        ...(toEditPayload(payload) as InteractionEditReplyOptions),
        message: messageId,
      });
    },
  });

  const resolveEphemeral = (payload: RenderResult, sendOptions?: SendOptions): boolean => {
    if (sendOptions?.ephemeral !== undefined) return sendOptions.ephemeral;
    return defaultEphemeral === true || isEphemeralPayload(payload);
  };

  const editOriginal = (name: string, payload: RenderResult): Promise<boolean> =>
    guarded(name, () => interaction.editReply(toEditPayload(payload) as InteractionEditReplyOptions));

  const sendFollowUp = async (payload: RenderResult, ephemeral: boolean): Promise<ReplyTarget | null> => {
    let target: ReplyTarget | null = null;
    await guarded("follow up", async () => {
      const message = await interaction.followUp(withEphemeral(payload, ephemeral) as InteractionReplyOptions);
      target = messageTarget(message.id);
    });
    return target;
  };

  const replaceAcknowledgement = async (payload: RenderResult, ephemeral: boolean): Promise<ReplyTarget | null> => {
    if (ephemeral && !acknowledgedEphemeral) {
      await guarded("delete the public reply", () => interaction.deleteReply());
      acknowledgedEphemeral = true;
      state = "replied";
      placeholder = false;
      return sendFollowUp(payload, true);
    }
    if (!ephemeral && acknowledgedEphemeral) {
      logger.debug("The reply stays ephemeral because the first acknowledgement was ephemeral.");
    }
    const delivered = await editOriginal("edit the reply", payload);
    state = "replied";
    placeholder = false;
    return delivered ? originalTarget : null;
  };

  const firstReply = async (payload: RenderResult, ephemeral: boolean): Promise<ReplyTarget | null> => {
    cancelAutoDefer();
    const delivered = await guarded(
      "reply",
      () => interaction.reply(withEphemeral(payload, ephemeral) as InteractionReplyOptions),
      () => interaction.editReply(toEditPayload(payload) as InteractionEditReplyOptions),
    );
    if (!expired) {
      state = "replied";
      acknowledgedEphemeral = ephemeral;
    }
    return delivered ? originalTarget : null;
  };

  const sendNow = async (payload: RenderResult, sendOptions?: SendOptions): Promise<ReplyTarget | null> => {
    sync();
    const ephemeral = resolveEphemeral(payload, sendOptions);
    switch (state) {
      case "unacknowledged":
        return firstReply(payload, ephemeral);
      case "deferred":
        return replaceAcknowledgement(payload, ephemeral);
      case "replied":
      case "updated":
        if (placeholder) return replaceAcknowledgement(payload, ephemeral);
        return sendFollowUp(payload, ephemeral);
    }
  };

  const updateNow = async (payload: RenderResult): Promise<ReplyTarget | null> => {
    sync();
    if (state === "unacknowledged") {
      const target = updatable(interaction);
      if (target === null) return firstReply(payload, resolveEphemeral(payload));
      cancelAutoDefer();
      const delivered = await guarded(
        "update",
        () => target.update(toEditPayload(payload) as InteractionUpdateOptions),
        () => interaction.editReply(toEditPayload(payload) as InteractionEditReplyOptions),
      );
      if (!expired) state = "updated";
      return delivered ? originalTarget : null;
    }
    const delivered = await editOriginal("edit the message", payload);
    if (state === "deferred") state = "replied";
    placeholder = false;
    return delivered ? originalTarget : null;
  };

  const deferNow = async (mode: "reply" | "update", sendOptions?: SendOptions): Promise<boolean> => {
    sync();
    if (state !== "unacknowledged") return false;
    cancelAutoDefer();
    const target = mode === "update" ? updatable(interaction) : null;
    if (target !== null) {
      const delivered = await guarded("defer the update", () => target.deferUpdate());
      if (!expired) state = "updated";
      if (delivered) deferredUpdate = true;
      return delivered;
    }
    const ephemeral = sendOptions?.ephemeral ?? defaultEphemeral === true;
    const delivered = await guarded("defer the reply", () =>
      interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
    );
    if (!expired) {
      state = "deferred";
      acknowledgedEphemeral = ephemeral;
    }
    return delivered;
  };

  return {
    get state() {
      sync();
      return state;
    },
    get expired() {
      return expired;
    },
    get modalShown() {
      return modalShown;
    },
    get autoDeferred() {
      return autoDeferred;
    },
    get deferredUpdate() {
      return deferredUpdate;
    },

    armAutoDefer() {
      const after = options.autoDeferAfter;
      if (after === false || after === undefined || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        sync();
        if (pending > 0 || state !== "unacknowledged" || expired) return;
        void enqueue(async () => {
          autoDeferred = await deferNow(deferMode);
        }).catch((error: unknown) => {
          logger.warn("Automatic defer failed.", error);
        });
      }, after);
      timer.unref();
    },

    cancelAutoDefer,

    settled: () => tail.then(() => undefined),

    send: (payload, sendOptions) => enqueue(() => sendNow(payload, sendOptions)),

    sendPlaceholder: (payload, sendOptions) =>
      enqueue(async () => {
        const target = await sendNow(payload, sendOptions);
        placeholder = state === "replied";
        return target;
      }),

    update: (payload) => enqueue(() => updateNow(payload)),

    edit: (payload, sendOptions) =>
      enqueue(async () => {
        sync();
        if (state === "unacknowledged") {
          return updatable(interaction) !== null
            ? updateNow(payload)
            : firstReply(payload, resolveEphemeral(payload, sendOptions));
        }
        const delivered = await editOriginal("edit the reply", payload);
        if (state === "deferred") state = "replied";
        placeholder = false;
        return delivered ? originalTarget : null;
      }),

    followUp: (payload, sendOptions) =>
      enqueue(async () => {
        sync();
        const ephemeral = resolveEphemeral(payload, sendOptions);
        if (state === "unacknowledged") return firstReply(payload, ephemeral);
        if (state === "deferred") return replaceAcknowledgement(payload, ephemeral);
        return sendFollowUp(payload, ephemeral);
      }),

    defer: (sendOptions) =>
      enqueue(async () => {
        await deferNow("reply", sendOptions);
      }),

    deferUpdate: () =>
      enqueue(async () => {
        await deferNow("update");
      }),

    deleteReply: () =>
      enqueue(async () => {
        sync();
        if (state === "unacknowledged") {
          logger.warn("deleteReply() was called before the interaction was acknowledged.");
          return;
        }
        await guarded("delete the reply", () => interaction.deleteReply());
        placeholder = false;
      }),

    showModal: (modal) =>
      enqueue(async () => {
        sync();
        if (state !== "unacknowledged") {
          throw new Error(
            `showModal() must be the first response to an interaction, but it has already been ${state}. Remove loading.tsx from this route or show the modal before any reply or slow work.`,
          );
        }
        if (interaction.isModalSubmit()) {
          throw new Error("showModal() cannot respond to a modal submit.");
        }
        cancelAutoDefer();
        const delivered = await guarded("show the modal", () => interaction.showModal(modal));
        if (!expired) {
          state = "replied";
          modalShown = delivered;
        }
      }),

    silentAcknowledge: () =>
      enqueue(async () => {
        sync();
        if (state !== "unacknowledged") return;
        const delivered = await deferNow("reply", { ephemeral: true });
        if (delivered) await guarded("delete the reply", () => interaction.deleteReply());
      }),
  };
}
