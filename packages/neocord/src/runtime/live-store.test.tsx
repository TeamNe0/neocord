import { describe, expect, test } from "bun:test";
import { ActionRow, Button, Container, Section, StringSelect, TextDisplay } from "@neocord/react";
import { ComponentType, MessageFlags, type Interaction } from "discord.js";
import { useEffect, useState, type ReactNode } from "react";
import { defineCommand } from "../index.ts";
import { createFakeInteraction, mockMessage, type ApiHook, type Recording } from "../testing/fakes.ts";
import { createHarness, type Harness } from "../testing/run.tsx";
import type { ErrorProps, Manifest } from "../types.ts";

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
        { toJSON: () => ({ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button }] }) },
        {
          toJSON: () => ({
            type: ComponentType.Section,
            components: [{ type: ComponentType.TextDisplay, content: "side" }],
            accessory: { type: ComponentType.Button },
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
