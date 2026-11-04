import type { ModalRenderResult, RenderResult } from "@teamneo/neocord-react";
import {
  MessageFlags,
  MessageFlagsBitField,
  MessagePayload,
  RESTJSONErrorCodes,
  type ButtonInteraction,
  type InteractionDeferReplyOptions,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type Message,
  type RepliableInteraction,
} from "discord.js";
import type { Logger } from "../logger.ts";

export type ReplyState = "unacknowledged" | "deferred" | "replied" | "updated";

export type WriteMode = "send" | "update" | "edit" | "followUp" | "delete";

export interface ReplyTarget {
  readonly key: string;
  edit(payload: RenderResult): Promise<string | null>;
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
  readonly showingPlaceholder: boolean;
  armAutoDefer(): void;
  cancelAutoDefer(): void;
  interceptEventResponses(): void;
  writeKey(mode: WriteMode): string | null;
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

type RawResponses = Pick<ButtonInteraction, "reply" | "deferReply" | "editReply" | "deleteReply" | "update" | "deferUpdate" | "showModal">;

export function sourceMessageOf(interaction: RepliableInteraction): Message | null {
  if (interaction.isMessageComponent()) return interaction.message;
  if (interaction.isModalSubmit() && interaction.isFromMessage()) return interaction.message;
  return null;
}

function messageIdOf(result: unknown): string | null {
  const id = typeof result === "object" && result !== null && "id" in result ? result.id : null;
  return typeof id === "string" ? id : null;
}

function withExtraFlags<T>(options: T, flags: number): T {
  if (flags === 0 || options instanceof MessagePayload) return options;
  const plain = (typeof options === "string" ? { content: options } : options) as { flags?: ConstructorParameters<typeof MessageFlagsBitField>[0] };
  return { ...plain, flags: new MessageFlagsBitField(plain.flags).add(flags).bitfield } as T;
}

export function createResponder(options: ResponderOptions): Responder {
  const { interaction, logger } = options;
  const deferMode = options.deferMode ?? "reply";
  const defaultEphemeral = options.ephemeral;
  const source = sourceMessageOf(interaction);
  let sourceHasFlag = source === null || source.flags.has(MessageFlags.IsComponentsV2);
  let raw = interaction as unknown as RawResponses;

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
      state = interaction.ephemeral === null && source !== null ? "updated" : "deferred";
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

  const originalIsSource = (): boolean => source !== null && interaction.ephemeral === null;

  const sourcePayload = (payload: RenderResult): EditPayload & { content?: null; embeds?: [] } =>
    sourceHasFlag ? toEditPayload(payload) : { ...toEditPayload(payload), content: null, embeds: [] };

  const originalPayload = (payload: RenderResult): EditPayload =>
    originalIsSource() ? sourcePayload(payload) : toEditPayload(payload);

  const editOriginalMessage = async (payload: RenderResult): Promise<string | null> => {
    const result = await raw.editReply(originalPayload(payload) as InteractionEditReplyOptions);
    if (originalIsSource()) sourceHasFlag = true;
    return messageIdOf(result);
  };

  const originalKey = (): string => (source !== null && originalIsSource() ? source.id : `original:${interaction.id}`);

  const originalTarget: ReplyTarget = {
    get key() {
      return originalKey();
    },
    edit: editOriginalMessage,
  };

  const messageTarget = (messageId: string): ReplyTarget => ({
    key: messageId,
    edit: async (payload) => {
      await raw.editReply({
        ...(toEditPayload(payload) as InteractionEditReplyOptions),
        message: messageId,
      });
      return messageId;
    },
  });

  const resolveEphemeral = (payload: RenderResult, sendOptions?: SendOptions): boolean => {
    if (sendOptions?.ephemeral !== undefined) return sendOptions.ephemeral;
    return defaultEphemeral === true || isEphemeralPayload(payload);
  };

  const editOriginal = (name: string, payload: RenderResult): Promise<boolean> =>
    guarded(name, () => editOriginalMessage(payload));

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
      await guarded("delete the public reply", () => raw.deleteReply());
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
      () => raw.reply(withEphemeral(payload, ephemeral) as InteractionReplyOptions),
      () => raw.editReply(toEditPayload(payload) as InteractionEditReplyOptions),
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
      if (source === null) return firstReply(payload, resolveEphemeral(payload));
      cancelAutoDefer();
      const delivered = await guarded(
        "update",
        async () => {
          await raw.update(sourcePayload(payload) as InteractionUpdateOptions);
          sourceHasFlag = true;
        },
        () => editOriginalMessage(payload),
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
    if (mode === "update" && source !== null) {
      const delivered = await guarded("defer the update", () => raw.deferUpdate());
      if (!expired) state = "updated";
      if (delivered) deferredUpdate = true;
      return delivered;
    }
    const ephemeral = sendOptions?.ephemeral ?? defaultEphemeral === true;
    const delivered = await guarded("defer the reply", () =>
      raw.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
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
    get showingPlaceholder() {
      return placeholder;
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

    interceptEventResponses() {
      const event = interaction as unknown as RawResponses;
      const original: RawResponses = {
        reply: event.reply.bind(event),
        deferReply: event.deferReply.bind(event),
        editReply: event.editReply.bind(event),
        deleteReply: event.deleteReply.bind(event),
        update: event.update.bind(event),
        deferUpdate: event.deferUpdate.bind(event),
        showModal: event.showModal.bind(event),
      };
      raw = original;

      let convertedFlags: number | null = null;
      let convertedMessage: string | null = null;

      Object.assign(event, {
        reply: (replyOptions: Parameters<RawResponses["reply"]>[0]) =>
          enqueue(async () => {
            sync();
            if (!autoDeferred) return original.reply(replyOptions);
            return interaction.followUp(replyOptions);
          }),
        deferReply: (deferOptions: InteractionDeferReplyOptions = {}) =>
          enqueue(async () => {
            sync();
            if (!autoDeferred) return original.deferReply(deferOptions);
            convertedFlags = new MessageFlagsBitField(deferOptions.flags as MessageFlags | undefined).has(MessageFlags.Ephemeral)
              ? MessageFlags.Ephemeral
              : 0;
            return undefined;
          }),
        update: (updateOptions: Parameters<RawResponses["update"]>[0]) =>
          enqueue(async () => {
            sync();
            if (!autoDeferred) return original.update(updateOptions);
            return original.editReply((updateOptions ?? {}) as Parameters<RawResponses["editReply"]>[0]);
          }),
        deferUpdate: (deferOptions?: Parameters<RawResponses["deferUpdate"]>[0]) =>
          enqueue(async () => {
            sync();
            if (!autoDeferred) return original.deferUpdate(deferOptions);
            return undefined;
          }),
        editReply: (editOptions: Parameters<RawResponses["editReply"]>[0]) =>
          enqueue(async () => {
            if (convertedFlags === null) return original.editReply(editOptions);
            if (convertedMessage === null) {
              const message = await interaction.followUp(withExtraFlags(editOptions, convertedFlags) as InteractionReplyOptions);
              convertedMessage = message.id;
              return message;
            }
            if (editOptions instanceof MessagePayload) return original.editReply(editOptions);
            const plain = typeof editOptions === "string" ? { content: editOptions } : editOptions;
            return original.editReply({ ...plain, message: plain.message ?? convertedMessage });
          }),
        deleteReply: (message?: Parameters<RawResponses["deleteReply"]>[0]) =>
          enqueue(async () => {
            if (convertedFlags === null) return original.deleteReply(message);
            if (message === undefined && convertedMessage === null) return undefined;
            return original.deleteReply(message ?? convertedMessage ?? undefined);
          }),
        showModal: (...modalArgs: Parameters<RawResponses["showModal"]>) =>
          enqueue(async () => {
            sync();
            if (autoDeferred) {
              throw new Error(
                `event.showModal() cannot open a modal here, because autoDefer already acknowledged this click after ${String(options.autoDeferAfter)}ms and a modal must be the first response. Call event.showModal() before any slow work, or raise autoDefer.after.`,
              );
            }
            return original.showModal(...modalArgs);
          }),
      });
    },

    writeKey(mode) {
      sync();
      switch (mode) {
        case "update":
        case "edit":
          if (state === "unacknowledged") return source?.id ?? null;
          return originalKey();
        case "send":
          return state === "deferred" || (state !== "unacknowledged" && placeholder) ? originalKey() : null;
        case "followUp":
          return state === "deferred" ? originalKey() : null;
        case "delete":
          return state === "unacknowledged" ? null : originalKey();
      }
    },

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
          return source !== null
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
        await guarded("delete the reply", () => raw.deleteReply());
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
        const delivered = await guarded("show the modal", () => raw.showModal(modal));
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
        if (delivered) await guarded("delete the reply", () => raw.deleteReply());
      }),
  };
}
