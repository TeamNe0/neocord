import { describe, expect, test } from "bun:test";
import { ActionRow, Button, Container, Section, StringSelect, TextDisplay } from "@teamneo/neocord-react";
import { ComponentType, MessageFlags, type ButtonInteraction, type Interaction } from "discord.js";
import { useEffect, useState, type ReactNode } from "react";
import { defineButton, defineCommand, defineModal } from "../index.ts";
import { createFakeInteraction, mockMember, mockMessage, type ApiHook, type Recording } from "../testing/fakes.ts";
import { createHarness, type Harness } from "../testing/run.tsx";
import type { CommandContext, ErrorProps, Manifest, ManifestRoute } from "../types.ts";
import { sessionIdOf } from "./live-store.ts";

type Fake = Interaction & { recording: Recording };

function text(payload: { components: unknown[] } | undefined): string {
  const walk = (components: unknown[]): string[] =>
    components.flatMap((component) => {
      const entry = component as { content?: string; components?: unknown[] };
      if (entry.content !== undefined) return [entry.content];
      return entry.components === undefined ? [] : walk(entry.components);
    });
  return walk(payload?.components ?? []).join("|");
}

function customIds(payload: { components: unknown[] } | undefined): string[] {
  const walk = (components: unknown[]): string[] =>
    components.flatMap((component) => {
      const entry = component as { custom_id?: string; components?: unknown[]; accessory?: { custom_id?: string } };
      const own = entry.custom_id === undefined ? [] : [entry.custom_id];
      const accessory = entry.accessory?.custom_id === undefined ? [] : [entry.accessory.custom_id];
      return [...own, ...accessory, ...walk(entry.components ?? [])];
    });
  return walk(payload?.components ?? []);
}

function disabledFlags(payload: { components: unknown[] } | undefined): boolean[] {
  const walk = (components: unknown[]): boolean[] =>
    components.flatMap((component) => {
      const entry = component as { type: number; disabled?: boolean; components?: unknown[] };
      if (entry.type === ComponentType.Button) return [entry.disabled === true];
      return walk(entry.components ?? []);
    });
  return walk(payload?.components ?? []);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Counter(): ReactNode {
  const [count, setCount] = useState(0);
  return (
    <>
      <TextDisplay>count {count}</TextDisplay>
      <ActionRow>
        <Button style="primary" label="add" onClick={() => setCount(count + 1)} />
      </ActionRow>
    </>
  );
}

function manifestFor(view: () => ReactNode, extra: { error?: unknown } = {}): Manifest {
  return {
    version: 1,
    context: null,
    features: [],
    groups: [],
    routes: [
      {
        kind: "command",
        id: "live",
        feature: "core",
        file: "live.tsx",
        segments: ["live"],
        module: { default: defineCommand({ description: "d", execute: () => view() }) },
        middleware: [],
        layouts: [],
        error: extra.error === undefined ? null : { file: "error.tsx", module: { default: extra.error } },
        loading: null,
      },
    ],
  };
}

async function start(
  view: () => ReactNode,
  options: { liveTtl?: number; error?: unknown; hook?: ApiHook; autoDeferAfter?: number | false } = {},
): Promise<{ harness: Harness; origin: Fake; id: string }> {
  const harness = createHarness({
    manifest: manifestFor(view, options.error === undefined ? {} : { error: options.error }),
    liveTtl: options.liveTtl ?? 60_000,
    autoDeferAfter: options.autoDeferAfter ?? false,
  });
  const origin = createFakeInteraction({
    kind: "command",
    commandName: "live",
    ...(options.hook === undefined ? {} : { hook: options.hook }),
  }) as Fake;
  await harness.dispatch(origin);
  const id = customIds(origin.recording.replies[0] ?? origin.recording.edits[0])[0] ?? "";
  return { harness, origin, id };
}

function click(customId: string, hook?: ApiHook, message = mockMessage()): Fake {
  return createFakeInteraction({
    kind: "button",
    customId,
    message,
    ...(hook === undefined ? {} : { hook }),
  }) as Fake;
}

describe("live sessions", () => {
  test("a handler tree creates a session with short custom ids", async () => {
    const { harness, origin, id } = await start(() => <Counter />);
    expect(text(origin.recording.replies[0])).toBe("count 0");
    expect(id).toMatch(/^~[0-9a-f]{16}:0$/);
    expect(id.length).toBeLessThanOrEqual(100);
    expect(harness.dispatcher.live.size).toBe(1);
    await harness.close();
  });

  test("trees without handlers do not keep a session", async () => {
    let cleanups = 0;
    function Effectful(): ReactNode {
      useEffect(() => () => {
        cleanups += 1;
      });
      return <TextDisplay>static</TextDisplay>;
    }
    const { harness, origin } = await start(() => <Effectful />);
    expect(text(origin.recording.replies[0])).toBe("static");
    expect(harness.dispatcher.live.size).toBe(0);
    expect(cleanups).toBe(1);
    await harness.close();
  });

  test("a click dispatches and updates the message", async () => {
    const { harness, id } = await start(() => <Counter />);
    const first = click(id);
    await harness.dispatch(first);
    expect(first.recording.log.map((entry) => entry.method)).toEqual(["update"]);
    expect(text(first.recording.updates[0])).toBe("count 1");
    expect(first.recording.updates[0]?.flags).toBe(MessageFlags.IsComponentsV2);

    const second = click(id);
    await harness.dispatch(second);
    expect(text(second.recording.updates[0])).toBe("count 2");
    await harness.close();
  });

  test("onClick receives the discord.js interaction", async () => {
    let seen: unknown;
    function View(): ReactNode {
      return (
        <ActionRow>
          <Button
            label="x"
            onClick={(interaction) => {
              seen = interaction;
            }}
          />
        </ActionRow>
      );
    }
    const { harness, id } = await start(() => <View />);
    const interaction = click(id);
    await harness.dispatch(interaction);
    expect(seen).toBe(interaction);
    await harness.close();
  });

  test("onSelect works the same way", async () => {
    function View(): ReactNode {
      const [value, setValue] = useState("none");
      return (
        <>
          <TextDisplay>{value}</TextDisplay>
          <ActionRow>
            <StringSelect
              options={[{ label: "A", value: "a" }]}
              onSelect={(interaction) => setValue(interaction.values[0] ?? "")}
            />
          </ActionRow>
        </>
      );
    }
    const { harness, id } = await start(() => <View />);
    const interaction = createFakeInteraction({ kind: "string-select", customId: id, values: ["a"] }) as Fake;
    await harness.dispatch(interaction);
    expect(text(interaction.recording.updates[0])).toBe("a");
    await harness.close();
  });

  test("a handler that acknowledges itself is not updated again, and the message is edited through the origin", async () => {
    function View(): ReactNode {
      const [count, setCount] = useState(0);
      return (
        <>
          <TextDisplay>count {count}</TextDisplay>
          <ActionRow>
            <Button
              label="x"
              onClick={async (interaction) => {
                setCount(count + 1);
                await interaction.reply({ content: "manual" });
              }}
            />
          </ActionRow>
        </>
      );
    }
    const { harness, origin, id } = await start(() => <View />);
    const interaction = click(id);
    await harness.dispatch(interaction);
    expect(interaction.recording.log.map((entry) => entry.method)).toEqual(["reply"]);
    await sleep(5);
    expect(text(origin.recording.edits.at(-1))).toBe("count 1");
    await harness.close();
  });

  test("a handler that defers the update has its result edited in", async () => {
    function View(): ReactNode {
      const [count, setCount] = useState(0);
      return (
        <>
          <TextDisplay>count {count}</TextDisplay>
          <ActionRow>
            <Button
              label="x"
              onClick={async (interaction) => {
                await interaction.deferUpdate();
                setCount(count + 1);
              }}
            />
          </ActionRow>
        </>
      );
    }
    const { harness, id } = await start(() => <View />);
    const interaction = click(id);
    await harness.dispatch(interaction);
    expect(interaction.recording.log.map((entry) => entry.method)).toEqual(["deferUpdate", "editReply"]);
    expect(text(interaction.recording.edits[0])).toBe("count 1");
    await harness.close();
  });

  test("slow handlers are auto deferred", async () => {
    function View(): ReactNode {
      const [done, setDone] = useState(false);
      return (
        <>
          <TextDisplay>{done ? "done" : "idle"}</TextDisplay>
          <ActionRow>
            <Button
              label="x"
              onClick={async () => {
                await sleep(30);
                setDone(true);
              }}
            />
          </ActionRow>
        </>
      );
    }
    const { harness, id } = await start(() => <View />, { autoDeferAfter: 5 });
    const interaction = click(id);
    await harness.dispatch(interaction);
    expect(interaction.recording.log.map((entry) => entry.method)).toEqual(["deferUpdate", "editReply"]);
    expect(text(interaction.recording.edits[0])).toBe("done");
    await harness.close();
  });

  test("commits outside a dispatch edit through the original interaction", async () => {
    let bump: () => void = () => undefined;
    function View(): ReactNode {
      const [count, setCount] = useState(0);
      bump = () => setCount((value) => value + 1);
      return (
        <>
          <TextDisplay>tick {count}</TextDisplay>
          <ActionRow>
            <Button label="x" onClick={() => undefined} />
          </ActionRow>
        </>
      );
    }
    const { harness, origin } = await start(() => <View />);
    bump();
    await sleep(15);
    expect(text(origin.recording.edits.at(-1))).toBe("tick 1");
    expect(origin.recording.edits.at(-1)?.flags).toBe(MessageFlags.IsComponentsV2);
    await harness.close();
  });

  test("later background edits use the token of the latest click", async () => {
    let bump: () => void = () => undefined;
    function View(): ReactNode {
      const [count, setCount] = useState(0);
      bump = () => setCount((value) => value + 1);
      return (
        <>
          <TextDisplay>tick {count}</TextDisplay>
          <ActionRow>
            <Button label="x" onClick={() => undefined} />
          </ActionRow>
        </>
      );
    }
    const { harness, origin, id } = await start(() => <View />);
    const interaction = click(id);
    await harness.dispatch(interaction);
    const before = origin.recording.edits.length;
    bump();
    await sleep(15);
    expect(origin.recording.edits.length).toBe(before);
    expect(text(interaction.recording.edits.at(-1))).toBe("tick 1");
    await harness.close();
  });

  test("falls back to message.edit when the token no longer works", async () => {
    let bump: () => void = () => undefined;
    function View(): ReactNode {
      const [count, setCount] = useState(0);
      bump = () => setCount((value) => value + 1);
      return (
        <>
          <TextDisplay>tick {count}</TextDisplay>
          <ActionRow>
            <Button label="x" onClick={() => undefined} />
          </ActionRow>
        </>
      );
    }
    const { harness, id } = await start(() => <View />);
    const edits: unknown[] = [];
    const message = mockMessage({
      hook: (_method, payload) => {
        edits.push(payload);
      },
    });
    const hook: ApiHook = (method) => {
      if (method === "editReply") throw Object.assign(new Error("Invalid Webhook Token"), { code: 50027 });
    };
    await harness.dispatch(click(id, hook, message));
    bump();
    await sleep(15);
    expect(text(edits.at(-1) as { components: unknown[] })).toBe("tick 1");
    await harness.close();
  });

  test("an unknown session gets an ephemeral notice", async () => {
    const harness = createHarness({ manifest: manifestFor(() => null) });
    const interaction = click("~deadbeefdeadbeef:0");
    await harness.dispatch(interaction);
    expect(text(interaction.recording.replies[0])).toContain("expired");
    expect(Number(interaction.recording.replies[0]?.flags) & MessageFlags.Ephemeral).toBeTruthy();
    await harness.close();
  });

  test("an unknown session removes interactive components from the message", async () => {
    const harness = createHarness({ manifest: manifestFor(() => null) });
    const message = mockMessage({
      components: [
        { toJSON: () => ({ type: ComponentType.TextDisplay, content: "hello" }) },
        { toJSON: () => ({ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, custom_id: "~deadbeefdeadbeef:0" }] }) },
        {
          toJSON: () => ({
            type: ComponentType.Section,
            components: [{ type: ComponentType.TextDisplay, content: "side" }],
            accessory: { type: ComponentType.Button, custom_id: "~deadbeefdeadbeef:1" },
          }),
        },
        {
          toJSON: () => ({
            type: ComponentType.Container,
            components: [{ type: ComponentType.ActionRow, components: [] }],
          }),
        },
      ],
    });
    const interaction = click("~deadbeefdeadbeef:0", undefined, message);
    await harness.dispatch(interaction);
    expect(interaction.recording.log.map((entry) => entry.method)).toEqual(["update", "followUp"]);
    expect(interaction.recording.updates[0]?.components).toEqual([
      { type: ComponentType.TextDisplay, content: "hello" },
      { type: ComponentType.TextDisplay, content: "side" },
    ] as never);
    expect(text(interaction.recording.followUps[0])).toContain("expired");
    await harness.close();
  });

  describe("a click on a dead live button", () => {
    const stale = (custom_id: string) => ({ type: ComponentType.Button, style: 1, label: "x", custom_id });
    const dead = "~deadbeefdeadbeef:0";

    async function strip(components: unknown[]): Promise<{ updated: unknown; methods: string[]; notice: string }> {
      const harness = createHarness({ manifest: manifestFor(() => null) });
      const message = mockMessage({ components: components.map((component) => ({ toJSON: () => component })) });
      const interaction = click(dead, undefined, message);
      await harness.dispatch(interaction);
      await harness.close();
      const { recording } = interaction;
      return {
        updated: recording.updates[0]?.components,
        methods: recording.log.map((entry) => entry.method),
        notice: text(recording.followUps[0] ?? recording.replies[0]),
      };
    }

    test("keeps route and link buttons in the same row", async () => {
      const route = { type: ComponentType.Button, style: 1, label: "Close ticket", custom_id: "tickets/close/1" };
      const link = { type: ComponentType.Button, style: 5, label: "Docs", url: "https://example.com" };
      const { updated, notice } = await strip([{ type: ComponentType.ActionRow, components: [stale(dead), route, link] }]);
      expect(updated).toEqual([{ type: ComponentType.ActionRow, components: [route, link] }]);
      expect(notice).toContain("expired");
    });

    test("prunes rows that become empty and leaves other rows alone", async () => {
      const route = { type: ComponentType.Button, style: 1, label: "Close", custom_id: "tickets/close/1" };
      const keptRow = { type: ComponentType.ActionRow, components: [route] };
      const { updated } = await strip([{ type: ComponentType.ActionRow, components: [stale(dead)] }, keptRow]);
      expect(updated).toEqual([keptRow]);
    });

    test("removes a dead select and keeps a route select", async () => {
      const route = { type: ComponentType.StringSelect, custom_id: "core/pick", options: [] };
      const live = { type: ComponentType.StringSelect, custom_id: "~deadbeefdeadbeef:1", options: [] };
      const { updated } = await strip([
        { type: ComponentType.ActionRow, components: [live] },
        { type: ComponentType.ActionRow, components: [route] },
      ]);
      expect(updated).toEqual([{ type: ComponentType.ActionRow, components: [route] }]);
    });

    test("a section keeps a route or link accessory and loses only a dead one", async () => {
      const body = { type: ComponentType.TextDisplay, content: "side" };
      const keep = {
        type: ComponentType.Section,
        components: [body],
        accessory: { type: ComponentType.Button, style: 1, label: "Route", custom_id: "tickets/close/1" },
      };
      const thumbnail = { type: ComponentType.Section, components: [body], accessory: { type: ComponentType.Thumbnail, media: { url: "https://x/a.png" } } };
      const gone = { type: ComponentType.Section, components: [body], accessory: stale(dead) };
      const { updated } = await strip([keep, thumbnail, gone]);
      expect(updated).toEqual([keep, thumbnail, body]);
    });

    test("recurses into containers and prunes the ones left empty", async () => {
      const route = { type: ComponentType.Button, style: 1, label: "Close", custom_id: "tickets/close/1" };
      const { updated } = await strip([
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: "kept" },
            { type: ComponentType.ActionRow, components: [stale(dead), route] },
          ],
        },
        { type: ComponentType.Container, components: [{ type: ComponentType.ActionRow, components: [stale(dead)] }] },
      ]);
      expect(updated).toEqual([
        {
          type: ComponentType.Container,
          components: [
            { type: ComponentType.TextDisplay, content: "kept" },
            { type: ComponentType.ActionRow, components: [route] },
          ],
        },
      ]);
    });

    test("only sends the notice when nothing would be left", async () => {
      const { methods, notice } = await strip([{ type: ComponentType.ActionRow, components: [stale(dead)] }]);
      expect(methods).toEqual(["reply"]);
      expect(notice).toContain("expired");
    });
  });

  test("the expired notice still arrives when removing components fails", async () => {
    const harness = createHarness({ manifest: manifestFor(() => null) });
    const message = mockMessage({ components: [{ toJSON: () => ({ type: ComponentType.TextDisplay, content: "x" }) }] });
    const hook: ApiHook = (method) => {
      if (method === "update") throw new Error("cannot edit");
    };
    const interaction = click("~deadbeefdeadbeef:0", hook, message);
    await harness.dispatch(interaction);
    expect(text(interaction.recording.replies[0])).toContain("expired");
    await harness.close();
  });

  test("TTL disables components, edits, unmounts and forgets the session", async () => {
    let cleanups = 0;
    function View(): ReactNode {
      useEffect(
        () => () => {
          cleanups += 1;
        },
        [],
      );
      return (
        <>
          <TextDisplay>live</TextDisplay>
          <ActionRow>
            <Button label="x" onClick={() => undefined} />
          </ActionRow>
        </>
      );
    }
    const { harness, origin, id } = await start(() => <View />, { liveTtl: 15 });
    expect(disabledFlags(origin.recording.replies[0])).toEqual([false]);
    await sleep(40);
    expect(disabledFlags(origin.recording.edits.at(-1))).toEqual([true]);
    expect(harness.dispatcher.live.size).toBe(0);
    expect(cleanups).toBe(1);

    const late = click(id);
    await harness.dispatch(late);
    expect(text(late.recording.replies[0])).toContain("expired");
    await harness.close();
  });

  test("activity extends the TTL", async () => {
    const { harness, id } = await start(() => <Counter />, { liveTtl: 40 });
    await sleep(25);
    await harness.dispatch(click(id));
    await sleep(25);
    expect(harness.dispatcher.live.size).toBe(1);
    await sleep(40);
    expect(harness.dispatcher.live.size).toBe(0);
    await harness.close();
  });

  test("handler errors reach the error view ephemerally and the session survives", async () => {
    function View(): ReactNode {
      return (
        <ActionRow>
          <Button
            label="x"
            onClick={() => {
              throw new Error("click failed");
            }}
          />
        </ActionRow>
      );
    }
    function ErrorView({ error }: ErrorProps): ReactNode {
      return <TextDisplay>{`view: ${(error as Error).message}`}</TextDisplay>;
    }
    const { harness, id } = await start(() => <View />, { error: ErrorView });
    const interaction = click(id);
    await harness.dispatch(interaction);
    expect(text(interaction.recording.replies[0])).toBe("view: click failed");
    expect(Number(interaction.recording.replies[0]?.flags) & MessageFlags.Ephemeral).toBeTruthy();
    expect(harness.errors).toHaveLength(1);
    expect(harness.dispatcher.live.size).toBe(1);
    await harness.close();
  });

  test("code 10062 during a click is handled", async () => {
    const { harness, id } = await start(() => <Counter />);
    const hook: ApiHook = () => {
      throw Object.assign(new Error("Unknown interaction"), { code: 10062 });
    };
    const interaction = click(id, hook);
    await harness.dispatch(interaction);
    expect(interaction.recording.updates).toEqual([]);
    await harness.close();
  });

  test("a failed reply destroys the session", async () => {
    const hook: ApiHook = (method) => {
      if (method === "reply") throw new Error("nope");
    };
    const { harness } = await start(() => <Counter />, { hook });
    expect(harness.dispatcher.live.size).toBe(0);
    await harness.close();
  });

  test("an expired origin interaction destroys the session", async () => {
    const hook: ApiHook = (method) => {
      if (method === "reply") throw Object.assign(new Error("Unknown interaction"), { code: 10062 });
    };
    const { harness } = await start(() => <Counter />, { hook });
    expect(harness.dispatcher.live.size).toBe(0);
    await harness.close();
  });

  describe("replacing the message of a session", () => {
    function liveConfirm(): ReactNode {
      return (
        <>
          <TextDisplay>Confirm ban?</TextDisplay>
          <ActionRow>
            <Button label="x" onClick={() => undefined} />
          </ActionRow>
        </>
      );
    }

    function commandManifest(execute: (ctx: CommandContext) => unknown, extra: ManifestRoute[] = []): Manifest {
      return {
        version: 1,
        context: null,
        features: [],
        groups: [],
        routes: [
          {
            kind: "command",
            id: "live",
            feature: "core",
            file: "live.tsx",
            segments: ["live"],
            module: { default: defineCommand({ description: "d", execute: execute as never }) },
            middleware: [],
            layouts: [],
            error: null,
            loading: null,
          },
          ...extra,
        ],
      };
    }

    function routeOf(kind: ManifestRoute["kind"], id: string, definition: unknown): ManifestRoute {
      return {
        kind,
        id,
        feature: "core",
        file: `${id}.tsx`,
        segments: id.split("/").slice(1),
        module: { default: definition },
        middleware: [],
        layouts: [],
        error: null,
        loading: null,
      };
    }

    function messageWith(id: string, sessionCustomId: string, recording: Recording): ReturnType<typeof mockMessage> {
      return mockMessage({
        recording,
        components: [
          { toJSON: () => ({ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: 1, custom_id: sessionCustomId }] }) },
        ],
        id,
      });
    }

    function messageEdits(recording: Recording): unknown[] {
      return recording.log.filter((entry) => entry.method === "message.edit" || entry.method === "editReply").map((entry) => entry.payload);
    }

    test("editing a reply destroys the session that was on it, so TTL does not bring it back", async () => {
      const harness = createHarness({
        manifest: commandManifest(async (ctx) => {
          await ctx.reply(liveConfirm());
          await ctx.editReply(<TextDisplay>BANNED</TextDisplay>);
        }),
        liveTtl: 15,
      });
      const origin = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
      await harness.dispatch(origin);
      expect(harness.dispatcher.live.size).toBe(0);
      await sleep(40);
      expect(text(origin.recording.edits.at(-1))).toBe("BANNED");
      expect(origin.recording.edits).toHaveLength(1);
      await harness.close();
    });

    test("a timer in the replaced tree no longer edits the message", async () => {
      let bump: () => void = () => undefined;
      function Ticking(): ReactNode {
        const [count, setCount] = useState(0);
        bump = () => setCount((value) => value + 1);
        return (
          <>
            <TextDisplay>tick {count}</TextDisplay>
            <ActionRow>
              <Button label="x" onClick={() => undefined} />
            </ActionRow>
          </>
        );
      }
      const harness = createHarness({
        manifest: commandManifest(async (ctx) => {
          await ctx.reply(<Ticking />);
          await ctx.editReply(<TextDisplay>BANNED</TextDisplay>);
        }),
      });
      const origin = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
      await harness.dispatch(origin);
      bump();
      await sleep(15);
      expect(origin.recording.edits.map((edit) => text(edit))).toEqual(["BANNED"]);
      await harness.close();
    });

    test("a new live tree replaces the old session on the same message", async () => {
      let cleanups = 0;
      function First(): ReactNode {
        useEffect(
          () => () => {
            cleanups += 1;
          },
          [],
        );
        return liveConfirm();
      }
      const harness = createHarness({
        manifest: commandManifest(async (ctx) => {
          await ctx.reply(<First />);
          await ctx.editReply(<Counter />);
        }),
      });
      const origin = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
      await harness.dispatch(origin);
      expect(harness.dispatcher.live.size).toBe(1);
      expect(cleanups).toBe(1);
      await harness.close();
    });

    test("a loading view with a session is replaced by the result", async () => {
      const definition = defineCommand({ description: "d", execute: () => <TextDisplay>done</TextDisplay> });
      const harness = createHarness({
        manifest: {
          version: 1,
          context: null,
          features: [],
          groups: [],
          routes: [
            {
              kind: "command",
              id: "live",
              feature: "core",
              file: "live.tsx",
              segments: ["live"],
              module: { default: definition },
              middleware: [],
              layouts: [],
              error: null,
              loading: { file: "loading.tsx", module: { default: liveConfirm } },
            },
          ],
        },
      });
      await harness.dispatch(createFakeInteraction({ kind: "command", commandName: "live" }));
      expect(harness.dispatcher.live.size).toBe(0);
      await harness.close();
    });

    test("a follow up leaves the session on the first message alone", async () => {
      const harness = createHarness({
        manifest: commandManifest(async (ctx) => {
          await ctx.reply(liveConfirm());
          await ctx.followUp(<TextDisplay>note</TextDisplay>);
        }),
      });
      await harness.dispatch(createFakeInteraction({ kind: "command", commandName: "live" }));
      expect(harness.dispatcher.live.size).toBe(1);
      await harness.close();
    });

    test("deleting the reply destroys its session", async () => {
      const harness = createHarness({
        manifest: commandManifest(async (ctx) => {
          await ctx.reply(liveConfirm());
          await ctx.deleteReply();
        }),
      });
      await harness.dispatch(createFakeInteraction({ kind: "command", commandName: "live" }));
      expect(harness.dispatcher.live.size).toBe(0);
      await harness.close();
    });

    test("a route button updating the message destroys the session found on the message", async () => {
      const button = defineButton("core/close", { execute: () => <TextDisplay>Closed</TextDisplay> });
      const harness = createHarness({
        manifest: commandManifest(() => liveConfirm(), [routeOf("button", "core/close", button)]),
        liveTtl: 15,
      });
      const origin = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
      await harness.dispatch(origin);
      const sessionId = customIds(origin.recording.replies[0])[0] ?? "";
      const routeClick = createFakeInteraction({
        kind: "button",
        customId: "core/close",
        message: messageWith("700000000000000001", sessionId, origin.recording),
      }) as Fake;
      await harness.dispatch(routeClick);
      expect(harness.dispatcher.live.size).toBe(0);
      await sleep(40);
      expect(origin.recording.edits).toEqual([]);
      await harness.close();
    });

    test("a route button finds a session by the message id a live click recorded", async () => {
      const button = defineButton("core/close", { execute: () => <TextDisplay>Closed</TextDisplay> });
      const harness = createHarness({
        manifest: commandManifest(() => <Counter />, [routeOf("button", "core/close", button)]),
      });
      const origin = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
      await harness.dispatch(origin);
      const liveId = customIds(origin.recording.replies[0])[0] ?? "";
      const message = mockMessage({ id: "700000000000000002" });
      await harness.dispatch(click(liveId, undefined, message));
      expect(harness.dispatcher.live.size).toBe(1);
      await harness.dispatch(createFakeInteraction({ kind: "button", customId: "core/close", message }));
      expect(harness.dispatcher.live.size).toBe(0);
      await harness.close();
    });

    test("a route button finds a session by the message id an edit returned", async () => {
      let bump: () => void = () => undefined;
      function Later(): ReactNode {
        const [done, setDone] = useState(false);
        bump = () => setDone(true);
        return done ? (
          <TextDisplay>no handlers now</TextDisplay>
        ) : (
          <ActionRow>
            <Button label="x" onClick={() => undefined} />
          </ActionRow>
        );
      }
      const button = defineButton("core/close", { execute: () => <TextDisplay>Closed</TextDisplay> });
      const harness = createHarness({ manifest: commandManifest(() => <Later />, [routeOf("button", "core/close", button)]) });
      const message = mockMessage({ id: "700000000000000003" });
      const origin = createFakeInteraction({ kind: "command", commandName: "live", message }) as Fake;
      await harness.dispatch(origin);
      bump();
      await sleep(15);
      expect(harness.dispatcher.live.size).toBe(1);
      await harness.dispatch(createFakeInteraction({ kind: "button", customId: "core/close", message: mockMessage({ id: message.id }) }));
      expect(harness.dispatcher.live.size).toBe(0);
      await harness.close();
    });

    test("a route button answering with a new message keeps the session", async () => {
      const button = defineButton("core/note", { respond: "reply", execute: () => <TextDisplay>Note</TextDisplay> });
      const harness = createHarness({ manifest: commandManifest(() => liveConfirm(), [routeOf("button", "core/note", button)]) });
      const origin = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
      await harness.dispatch(origin);
      const sessionId = customIds(origin.recording.replies[0])[0] ?? "";
      await harness.dispatch(
        createFakeInteraction({
          kind: "button",
          customId: "core/note",
          message: messageWith("700000000000000004", sessionId, origin.recording),
        }),
      );
      expect(harness.dispatcher.live.size).toBe(1);
      await harness.close();
    });

    test("a route button that leaves the message alone keeps the session", async () => {
      const button = defineButton("core/quiet", { execute: () => undefined });
      const harness = createHarness({ manifest: commandManifest(() => liveConfirm(), [routeOf("button", "core/quiet", button)]) });
      const origin = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
      await harness.dispatch(origin);
      const sessionId = customIds(origin.recording.replies[0])[0] ?? "";
      await harness.dispatch(
        createFakeInteraction({
          kind: "button",
          customId: "core/quiet",
          message: messageWith("700000000000000005", sessionId, origin.recording),
        }),
      );
      expect(harness.dispatcher.live.size).toBe(1);
      await harness.close();
    });

    test("a modal updating the message destroys the session on it", async () => {
      const modal = defineModal("core/form", { title: "t", respond: "update", render: () => null, submit: () => <TextDisplay>Sent</TextDisplay> });
      const harness = createHarness({ manifest: commandManifest(() => liveConfirm(), [routeOf("modal", "core/form", modal)]) });
      const origin = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
      await harness.dispatch(origin);
      const sessionId = customIds(origin.recording.replies[0])[0] ?? "";
      await harness.dispatch(
        createFakeInteraction({
          kind: "modal",
          customId: "core/form",
          message: messageWith("700000000000000006", sessionId, origin.recording),
        }),
      );
      expect(harness.dispatcher.live.size).toBe(0);
      await harness.close();
    });

    test("sessions on other messages are not touched", async () => {
      const button = defineButton("core/close", { execute: () => <TextDisplay>Closed</TextDisplay> });
      const harness = createHarness({ manifest: commandManifest(() => liveConfirm(), [routeOf("button", "core/close", button)]) });
      const first = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
      const second = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
      await harness.dispatch(first);
      await harness.dispatch(second);
      const firstId = customIds(first.recording.replies[0])[0] ?? "";
      await harness.dispatch(
        createFakeInteraction({ kind: "button", customId: "core/close", message: messageWith("700000000000000007", firstId, first.recording) }),
      );
      expect(harness.dispatcher.live.size).toBe(1);
      expect(harness.dispatcher.live.has(sessionIdOf(customIds(second.recording.replies[0])[0] ?? ""))).toBe(true);
      expect(messageEdits(second.recording)).toEqual([]);
      await harness.close();
    });

    test("an update that is in flight while the old tree commits still wins", async () => {
      let bump: () => void = () => undefined;
      function Ticking(): ReactNode {
        const [count, setCount] = useState(0);
        bump = () => setCount((value) => value + 1);
        return (
          <>
            <TextDisplay>tick {count}</TextDisplay>
            <ActionRow>
              <Button label="x" onClick={() => undefined} />
            </ActionRow>
          </>
        );
      }
      const button = defineButton("core/close", { execute: () => <TextDisplay>Closed</TextDisplay> });
      const harness = createHarness({ manifest: commandManifest(() => <Ticking />, [routeOf("button", "core/close", button)]) });
      const origin = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
      await harness.dispatch(origin);
      const sessionId = customIds(origin.recording.replies[0])[0] ?? "";
      const slowUpdate: ApiHook = async (method) => {
        if (method === "update") {
          bump();
          await sleep(20);
        }
      };
      await harness.dispatch(
        createFakeInteraction({
          kind: "button",
          customId: "core/close",
          hook: slowUpdate,
          message: messageWith("700000000000000008", sessionId, origin.recording),
        }),
      );
      await sleep(15);
      expect(origin.recording.edits).toEqual([]);
      await harness.close();
    });
  });

  describe("expiry after a click the handler answered", () => {
    test("falls back to the clicked message when the origin token is dead", async () => {
      function View(): ReactNode {
        return (
          <ActionRow>
            <Button
              label="x"
              onClick={async (event) => {
                await event.reply({ content: "not yours", flags: MessageFlags.Ephemeral });
              }}
            />
          </ActionRow>
        );
      }
      const originHook: ApiHook = (method) => {
        if (method === "editReply") throw Object.assign(new Error("Invalid Webhook Token"), { code: 50027 });
      };
      const { harness, id } = await start(() => <View />, { liveTtl: 25, hook: originHook });
      const edits: { components: unknown[] }[] = [];
      const message = mockMessage({
        hook: (method, payload) => {
          if (method === "message.edit") edits.push(payload as { components: unknown[] });
        },
      });
      const interaction = click(id, undefined, message);
      await harness.dispatch(interaction);
      expect(interaction.recording.log.map((entry) => entry.method)).toEqual(["reply"]);
      await sleep(60);
      expect(harness.dispatcher.live.size).toBe(0);
      expect(disabledFlags(edits.at(-1))).toEqual([true]);
      await harness.close();
    });

    test("a denied click also records the fallback", async () => {
      function View(): ReactNode {
        return (
          <ActionRow>
            <Button label="x" onClick={() => undefined} />
          </ActionRow>
        );
      }
      const originHook: ApiHook = (method) => {
        if (method === "editReply") throw Object.assign(new Error("Invalid Webhook Token"), { code: 50027 });
      };
      const definition = defineCommand({ description: "d", permissions: ["BanMembers"], execute: () => <View /> });
      const allowed = mockMember({ permissions: ["BanMembers"] });
      const harness = createHarness({
        manifest: {
          version: 1,
          context: null,
          features: [],
          groups: [],
          routes: [
            {
              kind: "command",
              id: "live",
              feature: "core",
              file: "live.tsx",
              segments: ["live"],
              module: { default: definition },
              middleware: [],
              layouts: [],
              error: null,
              loading: null,
            },
          ],
        },
        liveTtl: 25,
      });
      const origin = createFakeInteraction({
        kind: "command",
        commandName: "live",
        member: allowed,
        guild: allowed.guild,
        hook: originHook,
      }) as Fake;
      await harness.dispatch(origin);
      const edits: { components: unknown[] }[] = [];
      const message = mockMessage({
        hook: (method, payload) => {
          if (method === "message.edit") edits.push(payload as { components: unknown[] });
        },
      });
      const denied = mockMember({ permissions: [] });
      await harness.dispatch(
        createFakeInteraction({
          kind: "button",
          customId: customIds(origin.recording.replies[0])[0] ?? "",
          member: denied,
          guild: denied.guild,
          message,
        }),
      );
      await sleep(60);
      expect(disabledFlags(edits.at(-1))).toEqual([true]);
      await harness.close();
    });
  });

  describe("concurrent clicks", () => {
    function SlowCounter({ log, pause = () => sleep(20) }: { log: string[]; pause?: () => Promise<void> }): ReactNode {
      const [count, setCount] = useState(0);
      return (
        <>
          <TextDisplay>count {count}</TextDisplay>
          <ActionRow>
            <Button
              label="add"
              onClick={async () => {
                log.push(`start ${count}`);
                await pause();
                setCount(count + 1);
                log.push(`end ${count}`);
              }}
            />
          </ActionRow>
        </>
      );
    }

    test("run one at a time and keep both state updates", async () => {
      const log: string[] = [];
      const { harness, id } = await start(() => <SlowCounter log={log} />);
      const first = click(id);
      const second = click(id);
      await Promise.all([harness.dispatch(first), harness.dispatch(second)]);
      expect(log).toEqual(["start 0", "end 0", "start 1", "end 1"]);
      expect(text(first.recording.updates[0])).toBe("count 1");
      expect(text(second.recording.updates[0])).toBe("count 2");
      await harness.close();
    });

    test("a queued click is still acknowledged in time", async () => {
      const log: string[] = [];
      const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
      let opened = 0;
      const pause = (): Promise<void> => {
        const gate = gates[opened] ?? gates[0];
        opened += 1;
        return gate?.promise ?? Promise.resolve();
      };
      const { harness, id } = await start(() => <SlowCounter log={log} pause={pause} />, { autoDeferAfter: 5 });
      const first = click(id);
      const second = click(id);
      const both = Promise.all([harness.dispatch(first), harness.dispatch(second)]);
      for (let waited = 0; second.recording.log.length === 0 && waited < 2000; waited += 5) await sleep(5);
      expect(log).toEqual(["start 0"]);
      expect(second.recording.log.map((entry) => entry.method)).toEqual(["deferUpdate"]);
      gates[0]?.resolve();
      gates[1]?.resolve();
      await both;
      expect(text(second.recording.edits.at(-1))).toBe("count 2");
      await harness.close();
    });

    test("a click queued behind a handler that fails still runs", async () => {
      let calls = 0;
      function View(): ReactNode {
        const [count, setCount] = useState(0);
        return (
          <>
            <TextDisplay>count {count}</TextDisplay>
            <ActionRow>
              <Button
                label="x"
                onClick={async () => {
                  calls += 1;
                  await sleep(5);
                  if (calls === 1) throw new Error("first click failed");
                  setCount(count + 1);
                }}
              />
            </ActionRow>
          </>
        );
      }
      const { harness, id } = await start(() => <View />);
      const first = click(id);
      const second = click(id);
      await Promise.all([harness.dispatch(first), harness.dispatch(second)]);
      expect(calls).toBe(2);
      expect(text(second.recording.updates[0])).toBe("count 1");
      await harness.close();
    });

    test("a click queued behind a session that ends gets the expired notice", async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      function View(): ReactNode {
        return (
          <ActionRow>
            <Button
              label="x"
              onClick={async () => {
                await gate;
              }}
            />
          </ActionRow>
        );
      }
      const { harness, id } = await start(() => <View />, { liveTtl: 15 });
      const first = click(id);
      const second = click(id);
      const both = Promise.all([harness.dispatch(first), harness.dispatch(second)]);
      await sleep(40);
      expect(text(second.recording.replies[0])).toContain("expired");
      release();
      await both;
      await harness.close();
    });
  });

  describe("responding through the event after an auto defer", () => {
    function viewWith(onClick: (event: ButtonInteraction) => Promise<void>): () => ReactNode {
      return function View(): ReactNode {
        const [done, setDone] = useState(false);
        return (
          <>
            <TextDisplay>{done ? "done" : "idle"}</TextDisplay>
            <ActionRow>
              <Button
                label="x"
                onClick={async (event) => {
                  await onClick(event as ButtonInteraction);
                  setDone(true);
                }}
              />
            </ActionRow>
          </>
        );
      };
    }

    test("event.reply becomes a follow up and the user sees no error", async () => {
      const View = viewWith(async (event) => {
        await sleep(25);
        await event.reply({ content: "work finished", flags: MessageFlags.Ephemeral });
      });
      const { harness, id } = await start(() => <View />, { autoDeferAfter: 5 });
      const interaction = click(id);
      await harness.dispatch(interaction);
      expect(interaction.recording.log.map((entry) => entry.method)).toEqual(["deferUpdate", "followUp", "editReply"]);
      expect(interaction.recording.followUps[0]).toMatchObject({ content: "work finished", flags: MessageFlags.Ephemeral });
      expect(text(interaction.recording.edits[0])).toBe("done");
      expect(harness.errors).toEqual([]);
      await harness.close();
    });

    test("event.update becomes an edit of the message", async () => {
      const View = viewWith(async (event) => {
        await sleep(25);
        await event.update({ content: "raw update" });
      });
      const { harness, id } = await start(() => <View />, { autoDeferAfter: 5 });
      const interaction = click(id);
      await harness.dispatch(interaction);
      expect(interaction.recording.log.map((entry) => entry.method)).toEqual(["deferUpdate", "editReply", "editReply"]);
      expect(harness.errors).toEqual([]);
      await harness.close();
    });

    test("event.deferUpdate is a no-op", async () => {
      const View = viewWith(async (event) => {
        await sleep(25);
        await event.deferUpdate();
      });
      const { harness, id } = await start(() => <View />, { autoDeferAfter: 5 });
      const interaction = click(id);
      await harness.dispatch(interaction);
      expect(interaction.recording.log.map((entry) => entry.method)).toEqual(["deferUpdate", "editReply"]);
      expect(harness.errors).toEqual([]);
      await harness.close();
    });

    test("event.deferReply then event.editReply sends a new message and leaves the live message alone", async () => {
      const View = viewWith(async (event) => {
        await sleep(25);
        await event.deferReply({ flags: MessageFlags.Ephemeral });
        await event.editReply({ content: "first" });
        await event.editReply({ content: "second" });
      });
      const { harness, id } = await start(() => <View />, { autoDeferAfter: 5 });
      const interaction = click(id);
      await harness.dispatch(interaction);
      expect(interaction.recording.log.map((entry) => entry.method)).toEqual(["deferUpdate", "followUp", "editReply", "editReply"]);
      expect(interaction.recording.followUps[0]).toMatchObject({ content: "first", flags: MessageFlags.Ephemeral });
      expect(interaction.recording.edits[0]).toMatchObject({ content: "second" });
      expect(typeof (interaction.recording.edits[0] as unknown as { message?: unknown }).message).toBe("string");
      expect(text(interaction.recording.edits[1])).toBe("done");
      expect(harness.errors).toEqual([]);
      await harness.close();
    });

    test("event.showModal fails with a clear error", async () => {
      const View = viewWith(async (event) => {
        await sleep(25);
        await event.showModal({ custom_id: "m", title: "t", components: [] } as never);
      });
      const { harness, id } = await start(() => <View />, { autoDeferAfter: 5 });
      const interaction = click(id);
      await harness.dispatch(interaction);
      expect(String(harness.errors[0])).toContain("event.showModal() cannot open a modal");
      expect(String(harness.errors[0])).toContain("autoDefer");
      expect(interaction.recording.modal).toBeNull();
      await harness.close();
    });

    test("a reply racing the timer goes out once, without a double acknowledgement", async () => {
      const slowReply: ApiHook = async (method) => {
        if (method === "reply") await sleep(25);
      };
      const View = viewWith(async (event) => {
        await event.reply({ content: "quick" });
      });
      const { harness, id } = await start(() => <View />, { autoDeferAfter: 5 });
      const interaction = click(id, slowReply);
      await harness.dispatch(interaction);
      expect(interaction.recording.log.map((entry) => entry.method)).toEqual(["reply"]);
      expect(harness.errors).toEqual([]);
      await harness.close();
    });

    test("before any auto defer the event methods behave as usual", async () => {
      const View = viewWith(async (event) => {
        await event.showModal({ custom_id: "m", title: "t", components: [] } as never);
      });
      const { harness, id } = await start(() => <View />, { autoDeferAfter: 50 });
      const interaction = click(id);
      await harness.dispatch(interaction);
      expect(interaction.recording.modal?.custom_id).toBe("m");
      expect(harness.errors).toEqual([]);
      await harness.close();
    });

    test("replying twice still throws like discord.js does", async () => {
      const View = viewWith(async (event) => {
        await event.reply({ content: "one" });
        await event.reply({ content: "two" });
      });
      const { harness, id } = await start(() => <View />);
      await harness.dispatch(click(id));
      expect(String(harness.errors[0])).toContain("already been sent or deferred");
      await harness.close();
    });
  });

  test("shutdown disables, edits and cleans every session", async () => {
    let cleanups = 0;
    function View(): ReactNode {
      useEffect(
        () => () => {
          cleanups += 1;
        },
        [],
      );
      return (
        <Container>
          <Section accessory={<Button label="x" onClick={() => undefined} />}>text</Section>
        </Container>
      );
    }
    const harness = createHarness({ manifest: manifestFor(() => <View />) });
    const first = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
    const second = createFakeInteraction({ kind: "command", commandName: "live" }) as Fake;
    await harness.dispatch(first);
    await harness.dispatch(second);
    expect(harness.dispatcher.live.size).toBe(2);
    await harness.dispatcher.shutdown();
    expect(harness.dispatcher.live.size).toBe(0);
    expect(cleanups).toBe(2);
    expect(JSON.stringify(first.recording.edits.at(-1))).toContain('"disabled":true');
    expect(JSON.stringify(second.recording.edits.at(-1))).toContain('"disabled":true');
  });

  test("shutdown does not hang on a stuck edit", async () => {
    const hook: ApiHook = async (method) => {
      if (method === "editReply") await new Promise(() => undefined);
    };
    const { harness } = await start(() => <Counter />, { hook });
    const started = Date.now();
    await harness.dispatcher.shutdown();
    expect(Date.now() - started).toBeLessThan(3000);
    expect(harness.dispatcher.live.size).toBe(0);
  });
});
