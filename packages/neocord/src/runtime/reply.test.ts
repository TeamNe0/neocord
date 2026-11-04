import { describe, expect, test } from "bun:test";
import { ComponentType, MessageFlags, RESTJSONErrorCodes, type RepliableInteraction } from "discord.js";
import type { RenderResult } from "@neocord/react";
import { createLogger, type LogMethod } from "../logger.ts";
import { createFakeInteraction, type ApiHook, type FakeKind, type Recording } from "../testing/fakes.ts";
import { createResponder, toEditPayload, type ResponderOptions } from "./reply.ts";

function payload(text: string, ephemeral = false): RenderResult {
  return {
    flags: (ephemeral
      ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
      : MessageFlags.IsComponentsV2) as RenderResult["flags"],
    components: [{ type: ComponentType.TextDisplay, content: text }],
  };
}

function textOf(result: RenderResult | undefined): string | undefined {
  const first = result?.components[0] as { content?: string } | undefined;
  return first?.content;
}

function isEphemeral(result: RenderResult | undefined): boolean {
  return (Number(result?.flags) & MessageFlags.Ephemeral) !== 0;
}

function setup(
  options: { kind?: FakeKind; hook?: ApiHook } & Partial<Omit<ResponderOptions, "interaction" | "logger">> = {},
) {
  const { kind = "command", hook, ...responderOptions } = options;
  const logs: { level: LogMethod; line: string }[] = [];
  const logger = createLogger({ level: "debug", sink: (level, line) => logs.push({ level, line }) });
  const interaction = createFakeInteraction({
    kind,
    ...(hook === undefined ? {} : { hook }),
  }) as unknown as RepliableInteraction & { recording: Recording };
  const responder = createResponder({ interaction, logger, ...responderOptions });
  return { interaction, recording: interaction.recording, responder, logs };
}

function methods(recording: Recording): string[] {
  return recording.log.map((entry) => entry.method);
}

function apiError(code: number): Error {
  return Object.assign(new Error(`api error ${code}`), { code });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("toEditPayload", () => {
  test("strips the ephemeral flag and keeps everything else", () => {
    const result = toEditPayload({ ...payload("x", true), allowedMentions: { parse: [] } });
    expect(result.flags).toBe(MessageFlags.IsComponentsV2);
    expect(result.allowedMentions).toEqual({ parse: [] });
    expect(result.components).toHaveLength(1);
  });
});

describe("state machine", () => {
  test("first send replies, later sends follow up", async () => {
    const { responder, recording } = setup();
    expect(responder.state).toBe("unacknowledged");
    await responder.send(payload("one"));
    expect(responder.state).toBe("replied");
    await responder.send(payload("two"));
    expect(methods(recording)).toEqual(["reply", "followUp"]);
    expect(textOf(recording.replies[0])).toBe("one");
    expect(textOf(recording.followUps[0])).toBe("two");
  });

  test("send after defer edits the deferred reply", async () => {
    const { responder, recording } = setup();
    await responder.defer();
    expect(responder.state).toBe("deferred");
    await responder.send(payload("done"));
    expect(responder.state).toBe("replied");
    expect(methods(recording)).toEqual(["deferReply", "editReply"]);
    await responder.send(payload("again"));
    expect(methods(recording)).toEqual(["deferReply", "editReply", "followUp"]);
  });

  test("update uses the component update and strips ephemeral", async () => {
    const { responder, recording } = setup({ kind: "button" });
    await responder.update(payload("x", true));
    expect(responder.state).toBe("updated");
    expect(recording.updates[0]?.flags).toBe(MessageFlags.IsComponentsV2);
    await responder.update(payload("y", true));
    expect(methods(recording)).toEqual(["update", "editReply"]);
    expect(recording.edits[0]?.flags).toBe(MessageFlags.IsComponentsV2);
  });

  test("deferUpdate then update edits the message", async () => {
    const { responder, recording } = setup({ kind: "button" });
    await responder.deferUpdate();
    expect(responder.state).toBe("updated");
    expect(responder.deferredUpdate).toBe(true);
    await responder.update(payload("x"));
    expect(methods(recording)).toEqual(["deferUpdate", "editReply"]);
  });

  test("a reply after an update follows up", async () => {
    const { responder, recording } = setup({ kind: "button" });
    await responder.update(payload("x"));
    await responder.send(payload("note", true));
    expect(methods(recording)).toEqual(["update", "followUp"]);
    expect(isEphemeral(recording.followUps[0])).toBe(true);
  });

  test("edit falls back to the first response when unacknowledged", async () => {
    const command = setup();
    await command.responder.edit(payload("x"));
    expect(methods(command.recording)).toEqual(["reply"]);

    const button = setup({ kind: "button" });
    await button.responder.edit(payload("x"));
    expect(methods(button.recording)).toEqual(["update"]);
  });

  test("followUp falls back to reply when unacknowledged", async () => {
    const { responder, recording } = setup();
    await responder.followUp(payload("x"));
    expect(methods(recording)).toEqual(["reply"]);
  });

  test("defer is idempotent and a noop after a reply", async () => {
    const { responder, recording } = setup();
    await responder.defer();
    await responder.defer();
    await responder.send(payload("x"));
    await responder.defer();
    expect(methods(recording)).toEqual(["deferReply", "editReply"]);
  });

  test("deleteReply before any acknowledgement logs instead of throwing", async () => {
    const { responder, recording, logs } = setup();
    await responder.deleteReply();
    expect(recording.deletes).toBe(0);
    expect(logs.some((entry) => entry.level === "warn")).toBe(true);
    await responder.send(payload("x"));
    await responder.deleteReply();
    expect(recording.deletes).toBe(1);
  });

  test("showModal must be the first response", async () => {
    const { responder, recording } = setup();
    await responder.showModal({ custom_id: "m", title: "t", components: [] });
    expect(recording.modal?.custom_id).toBe("m");
    expect(responder.modalShown).toBe(true);

    const late = setup();
    await late.responder.send(payload("x"));
    await expect(late.responder.showModal({ custom_id: "m", title: "t", components: [] })).rejects.toThrow(
      "showModal() must be the first response",
    );
  });

  test("placeholder is replaced once, then replies follow up", async () => {
    const { responder, recording } = setup();
    await responder.sendPlaceholder(payload("loading"));
    await responder.send(payload("result"));
    await responder.send(payload("extra"));
    expect(methods(recording)).toEqual(["reply", "editReply", "followUp"]);
    expect(textOf(recording.edits[0])).toBe("result");
  });

  test("detects acknowledgements made directly on the interaction", async () => {
    const replied = setup();
    await replied.interaction.reply({ content: "raw" });
    expect(replied.responder.state).toBe("replied");
    await replied.responder.send(payload("x"));
    expect(methods(replied.recording)).toEqual(["reply", "followUp"]);

    const deferred = setup();
    await deferred.interaction.deferReply({ flags: MessageFlags.Ephemeral });
    expect(deferred.responder.state).toBe("deferred");
    await deferred.responder.send(payload("x", true));
    expect(methods(deferred.recording)).toEqual(["deferReply", "editReply"]);

    const deferUpdated = setup({ kind: "button" });
    if (deferUpdated.interaction.isMessageComponent()) await deferUpdated.interaction.deferUpdate();
    expect(deferUpdated.responder.state).toBe("updated");
    await deferUpdated.responder.send(payload("x", true));
    expect(methods(deferUpdated.recording)).toEqual(["deferUpdate", "followUp"]);
  });
});

describe("ephemeral handling", () => {
  test("default ephemeral applies to replies and defers", async () => {
    const replied = setup({ ephemeral: true });
    await replied.responder.send(payload("x"));
    expect(isEphemeral(replied.recording.replies[0])).toBe(true);

    const deferred = setup({ ephemeral: true });
    await deferred.responder.defer();
    expect(deferred.recording.ephemeral).toBe(true);
  });

  test("an explicit option overrides the payload and the default", async () => {
    const overrideOn = setup();
    await overrideOn.responder.send(payload("x"), { ephemeral: true });
    expect(isEphemeral(overrideOn.recording.replies[0])).toBe(true);

    const overrideOff = setup({ ephemeral: true });
    await overrideOff.responder.send(payload("x", true), { ephemeral: false });
    expect(isEphemeral(overrideOff.recording.replies[0])).toBe(false);
  });

  test("the payload flag counts when nothing else says otherwise", async () => {
    const { responder, recording } = setup();
    await responder.send(payload("x", true));
    expect(isEphemeral(recording.replies[0])).toBe(true);
  });

  test("an ephemeral send after a public defer deletes the deferral and follows up", async () => {
    const { responder, recording } = setup();
    await responder.defer();
    await responder.send(payload("secret"), { ephemeral: true });
    expect(methods(recording)).toEqual(["deferReply", "deleteReply", "followUp"]);
    expect(isEphemeral(recording.followUps[0])).toBe(true);
  });

  test("an ephemeral send after a public placeholder deletes and follows up", async () => {
    const { responder, recording } = setup();
    await responder.sendPlaceholder(payload("loading"));
    await responder.send(payload("secret"), { ephemeral: true });
    expect(methods(recording)).toEqual(["reply", "deleteReply", "followUp"]);
  });

  test("an ephemeral defer stays ephemeral and edits", async () => {
    const { responder, recording } = setup();
    await responder.defer({ ephemeral: true });
    await responder.send(payload("a"), { ephemeral: true });
    expect(methods(recording)).toEqual(["deferReply", "editReply"]);
  });

  test("edit payloads never carry the ephemeral flag", async () => {
    const { responder, recording } = setup({ ephemeral: true });
    await responder.defer();
    await responder.edit(payload("x", true));
    expect(recording.edits[0]?.flags).toBe(MessageFlags.IsComponentsV2);
  });
});

describe("autoDefer", () => {
  test("defers after the delay when nothing happened", async () => {
    const { responder, recording } = setup({ autoDeferAfter: 5 });
    responder.armAutoDefer();
    await sleep(25);
    await responder.settled();
    expect(methods(recording)).toEqual(["deferReply"]);
    expect(responder.autoDeferred).toBe(true);
    await responder.send(payload("late"));
    expect(methods(recording)).toEqual(["deferReply", "editReply"]);
  });

  test("uses deferUpdate in update mode", async () => {
    const { responder, recording } = setup({ kind: "button", deferMode: "update", autoDeferAfter: 5 });
    responder.armAutoDefer();
    await sleep(25);
    await responder.settled();
    expect(methods(recording)).toEqual(["deferUpdate"]);
    await responder.update(payload("x"));
    expect(methods(recording)).toEqual(["deferUpdate", "editReply"]);
  });

  test("a reply in flight while the timer fires does not double acknowledge", async () => {
    const hook: ApiHook = async (method) => {
      if (method === "reply") await sleep(30);
    };
    const { responder, recording, logs } = setup({ autoDeferAfter: 5, hook });
    responder.armAutoDefer();
    const sending = responder.send(payload("x"));
    await sleep(15);
    await sending;
    await sleep(15);
    expect(methods(recording)).toEqual(["reply"]);
    expect(logs.filter((entry) => entry.level === "warn")).toEqual([]);
    expect(responder.autoDeferred).toBe(false);
  });

  test("a timer firing just before a slow render still leads to an edit", async () => {
    const hook: ApiHook = async (method) => {
      if (method === "deferReply") await sleep(20);
    };
    const { responder, recording } = setup({ autoDeferAfter: 2, hook });
    responder.armAutoDefer();
    await sleep(8);
    await responder.send(payload("x"));
    expect(methods(recording)).toEqual(["deferReply", "editReply"]);
    expect(recording.replies).toEqual([]);
  });

  test("the timer is cancelled after an acknowledgement", async () => {
    const { responder, recording } = setup({ autoDeferAfter: 5 });
    responder.armAutoDefer();
    await responder.send(payload("x"));
    await sleep(20);
    expect(methods(recording)).toEqual(["reply"]);
  });

  test("cancelAutoDefer stops it", async () => {
    const { responder, recording } = setup({ autoDeferAfter: 5 });
    responder.armAutoDefer();
    responder.cancelAutoDefer();
    await sleep(15);
    expect(recording.log).toEqual([]);
  });

  test("false disables it", async () => {
    const { responder, recording } = setup({ autoDeferAfter: false });
    responder.armAutoDefer();
    await sleep(10);
    expect(recording.log).toEqual([]);
  });

  test("an acknowledgement made directly on the interaction stops the timer from double acknowledging", async () => {
    const { responder, interaction, recording, logs } = setup({ autoDeferAfter: 5 });
    responder.armAutoDefer();
    await interaction.reply({ content: "raw" });
    await sleep(20);
    expect(methods(recording)).toEqual(["reply"]);
    expect(logs.filter((entry) => entry.level === "warn")).toEqual([]);
  });

  test("a failed automatic defer is logged, not thrown", async () => {
    const hook: ApiHook = (method) => {
      if (method === "deferReply") throw new Error("network down");
    };
    const { responder, logs } = setup({ autoDeferAfter: 2, hook });
    responder.armAutoDefer();
    await sleep(15);
    await responder.settled();
    expect(logs.some((entry) => entry.line.includes("Automatic defer failed"))).toBe(true);
  });
});

describe("error codes", () => {
  test("40060 on reply is logged and recovered through an edit", async () => {
    let failed = false;
    const hook: ApiHook = (method) => {
      if (method === "reply" && !failed) {
        failed = true;
        throw apiError(RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged);
      }
    };
    const { responder, recording, logs } = setup({ hook });
    const target = await responder.send(payload("x"));
    expect(target).not.toBeNull();
    expect(responder.state).toBe("replied");
    expect(methods(recording)).toEqual(["reply", "editReply"]);
    expect(logs.some((entry) => entry.level === "warn" && entry.line.includes("40060"))).toBe(true);
  });

  test("40060 when the recovery also fails does not throw", async () => {
    const hook: ApiHook = (method) => {
      if (method === "reply" || method === "editReply") {
        throw apiError(RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged);
      }
    };
    const { responder } = setup({ hook });
    expect(await responder.send(payload("x"))).toBeNull();
    expect(responder.state).toBe("replied");
  });

  test("40060 on defer does not throw and later sends edit", async () => {
    const hook: ApiHook = (method) => {
      if (method === "deferReply") throw apiError(RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged);
    };
    const { responder, recording } = setup({ hook });
    await responder.defer();
    expect(responder.state).toBe("deferred");
    await responder.send(payload("x"));
    expect(methods(recording)).toEqual(["deferReply", "editReply"]);
  });

  test("10062 is logged, nothing throws and later calls are skipped", async () => {
    const hook: ApiHook = (method) => {
      if (method === "reply") throw apiError(RESTJSONErrorCodes.UnknownInteraction);
    };
    const { responder, recording, logs } = setup({ hook });
    expect(await responder.send(payload("x"))).toBeNull();
    expect(responder.expired).toBe(true);
    expect(logs.some((entry) => entry.level === "warn" && entry.line.includes("10062"))).toBe(true);
    await responder.send(payload("y"));
    await responder.defer();
    await responder.deleteReply();
    expect(methods(recording)).toEqual(["reply"]);
  });

  test("10062 on update and modal are handled too", async () => {
    const hook: ApiHook = () => {
      throw apiError(RESTJSONErrorCodes.UnknownInteraction);
    };
    const button = setup({ kind: "button", hook });
    expect(await button.responder.update(payload("x"))).toBeNull();
    const modal = setup({ hook });
    await modal.responder.showModal({ custom_id: "m", title: "t", components: [] });
    expect(modal.responder.modalShown).toBe(false);
  });

  test("other errors propagate and leave the state alone", async () => {
    const hook: ApiHook = (method) => {
      if (method === "reply") throw apiError(50035);
    };
    const { responder } = setup({ hook });
    await expect(responder.send(payload("x"))).rejects.toThrow("api error 50035");
    expect(responder.state).toBe("unacknowledged");
  });
});

describe("queueing", () => {
  test("concurrent sends keep their order", async () => {
    const hook: ApiHook = async (method) => {
      if (method === "reply") await sleep(10);
    };
    const { responder, recording } = setup({ hook });
    await Promise.all([responder.send(payload("a")), responder.send(payload("b")), responder.send(payload("c"))]);
    expect(methods(recording)).toEqual(["reply", "followUp", "followUp"]);
    expect(textOf(recording.followUps[1])).toBe("c");
  });

  test("a follow up target edits its own message", async () => {
    const { responder, recording } = setup();
    await responder.send(payload("a"));
    const target = await responder.followUp(payload("b"));
    await target?.edit(payload("b2"));
    const last = recording.log.at(-1)?.payload as { message?: string };
    expect(typeof last.message).toBe("string");
  });

  test("a failing operation does not block the next one", async () => {
    let first = true;
    const hook: ApiHook = (method) => {
      if (method === "reply" && first) {
        first = false;
        throw new Error("transient");
      }
    };
    const { responder, recording } = setup({ hook });
    await expect(responder.send(payload("a"))).rejects.toThrow("transient");
    await responder.send(payload("b"));
    expect(recording.replies).toHaveLength(1);
  });

  test("silentAcknowledge defers and deletes", async () => {
    const { responder, recording } = setup();
    await responder.silentAcknowledge();
    expect(methods(recording)).toEqual(["deferReply", "deleteReply"]);
  });
});
