import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { ComponentType, MessageFlags } from "discord.js";
import { Suspense, use, useEffect, useState, useTransition, type ReactNode } from "react";
import {
  ActionRow,
  Button,
  Container,
  createLiveRoot,
  Message,
  render,
  renderAsync,
  Section,
  Separator,
  StringSelect,
  TextDisplay,
  UserSelect,
  useLiveInteraction,
  type LiveRoot,
  type RenderResult,
} from "./index.ts";

let errorSpy: Mock<typeof console.error>;
let warnSpy: Mock<typeof console.warn>;

beforeEach(() => {
  errorSpy = spyOn(console, "error");
  warnSpy = spyOn(console, "warn");
});

afterEach(() => {
  const errors = errorSpy.mock.calls.length;
  const warnings = warnSpy.mock.calls.length;
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  expect(errors).toBe(0);
  expect(warnings).toBe(0);
});

function textOf(payload: RenderResult): string[] {
  return payload.components.flatMap((component) =>
    component.type === ComponentType.TextDisplay ? [component.content] : [],
  );
}

function buttonsOf(payload: RenderResult): { custom_id: string; label: string; disabled?: boolean }[] {
  return payload.components.flatMap((component) =>
    component.type === ComponentType.ActionRow
      ? (component.components as unknown as { custom_id: string; label: string; disabled?: boolean }[])
      : [],
  );
}

function firstId(root: LiveRoot, index = 0): string {
  const button = buttonsOf(root.payload)[index];
  if (button === undefined) throw new Error("missing button");
  return button.custom_id;
}

function Counter(): ReactNode {
  const [count, setCount] = useState(0);
  return (
    <Message>
      <TextDisplay>count {count}</TextDisplay>
      <ActionRow>
        <Button style="primary" label="add" onClick={() => setCount(count + 1)} />
      </ActionRow>
    </Message>
  );
}

const roots: LiveRoot[] = [];

function createRoot(onUpdate?: (result: RenderResult) => void): LiveRoot {
  const root = createLiveRoot({ sessionId: "abc", onUpdate });
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
});

describe("custom ids", () => {
  test("uses ~session:n ids in tree order", () => {
    const root = createRoot();
    root.render(
      <ActionRow>
        <Button label="a" onClick={() => {}} />
        <Button label="b" onClick={() => {}} />
      </ActionRow>,
    );
    expect(buttonsOf(root.payload).map((button) => button.custom_id)).toEqual(["~abc:0", "~abc:1"]);
    expect(root.hasHandlers).toBe(true);
  });

  test("ids stay stable across re-renders and dispatch to the new closure", async () => {
    const root = createRoot();
    root.render(<Counter />);
    const id = firstId(root);

    expect(await root.dispatch(id, {})).toBe(true);
    expect(textOf(root.payload)).toEqual(["count 1"]);
    expect(firstId(root)).toBe(id);

    expect(await root.dispatch(id, {})).toBe(true);
    expect(textOf(root.payload)).toEqual(["count 2"]);
    expect(firstId(root)).toBe(id);
  });

  test("ids follow component keys through reorders", async () => {
    const hits: string[] = [];
    function List(): ReactNode {
      const [items, setItems] = useState(["x", "y"]);
      return (
        <ActionRow>
          {items.map((item) => (
            <Button
              key={item}
              label={item}
              onClick={() => {
                hits.push(item);
                setItems([...items].reverse());
              }}
            />
          ))}
        </ActionRow>
      );
    }
    const root = createRoot();
    root.render(<List />);
    const [xBefore, yBefore] = buttonsOf(root.payload);

    await root.dispatch(xBefore?.custom_id ?? "", {});
    const [first, second] = buttonsOf(root.payload);
    expect(first?.label).toBe("y");
    expect(first?.custom_id).toBe(yBefore?.custom_id ?? "");
    expect(second?.custom_id).toBe(xBefore?.custom_id ?? "");

    await root.dispatch(yBefore?.custom_id ?? "", {});
    expect(hits).toEqual(["x", "y"]);
  });

  test("ids hold when a sibling appears before them", async () => {
    function View(): ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <ActionRow>
          {open ? <Button label="new" onClick={() => {}} /> : null}
          <Button label="toggle" onClick={() => setOpen(!open)} />
        </ActionRow>
      );
    }
    const root = createRoot();
    root.render(<View />);
    const toggle = firstId(root);

    await root.dispatch(toggle, {});
    const opened = buttonsOf(root.payload);
    expect(opened.map((button) => button.label)).toEqual(["new", "toggle"]);
    expect(opened[1]?.custom_id).toBe(toggle);
    expect(opened[0]?.custom_id).not.toBe(toggle);
    expect(new Set(opened.map((button) => button.custom_id)).size).toBe(2);
  });

  test("a remounted slot keeps its id", async () => {
    function View(): ReactNode {
      const [shown, setShown] = useState(true);
      return (
        <ActionRow>
          {shown ? <Button key="target" label="target" onClick={() => {}} /> : null}
          <Button key="toggle" label="toggle" onClick={() => setShown(!shown)} />
        </ActionRow>
      );
    }
    const root = createRoot();
    root.render(<View />);
    const [target, toggle] = buttonsOf(root.payload);
    const targetId = target?.custom_id ?? "";
    const toggleId = toggle?.custom_id ?? "";

    await root.dispatch(toggleId, {});
    expect(buttonsOf(root.payload).map((button) => button.custom_id)).toEqual([toggleId]);
    expect(await root.dispatch(targetId, {})).toBe(false);

    await root.dispatch(toggleId, {});
    expect(buttonsOf(root.payload).map((button) => button.custom_id)).toEqual([targetId, toggleId]);
  });

  test("selects, section accessories and nesting get live ids", async () => {
    const seen: unknown[] = [];
    const root = createRoot();
    root.render(
      <Container>
        <Section accessory={<Button label="a" onClick={() => {}} />}>text</Section>
        <ActionRow>
          <UserSelect onSelect={(event) => seen.push(event)} />
        </ActionRow>
        <ActionRow>
          <StringSelect onSelect={(event) => seen.push(event)} options={[{ label: "x", value: "x" }]} />
        </ActionRow>
      </Container>,
    );
    const json = JSON.stringify(root.payload.components);
    expect(json).toContain('"~abc:0"');
    expect(json).toContain('"~abc:1"');
    expect(json).toContain('"~abc:2"');
    expect(await root.dispatch("~abc:1", "user")).toBe(true);
    expect(await root.dispatch("~abc:2", "string")).toBe(true);
    expect(seen).toEqual(["user", "string"]);
  });

  test("routes and custom ids are unaffected in a live root", () => {
    const root = createRoot();
    root.render(
      <ActionRow>
        <Button route="f/a" label="route" />
        <Button customId="raw" label="raw" />
      </ActionRow>,
    );
    expect(buttonsOf(root.payload).map((button) => button.custom_id)).toEqual(["f/a", "raw"]);
    expect(root.hasHandlers).toBe(false);
  });

  test("createLiveRoot requires a session id", () => {
    expect(() => createLiveRoot({ sessionId: "" })).toThrow("non-empty sessionId");
  });
});

describe("dispatch", () => {
  test("returns false for unknown ids", async () => {
    const root = createRoot();
    root.render(<Counter />);
    expect(await root.dispatch("~abc:99", {})).toBe(false);
    expect(await root.dispatch("~other:0", {})).toBe(false);
    expect(textOf(root.payload)).toEqual(["count 0"]);
  });

  test("batches several updates into one commit", async () => {
    let renders = 0;
    function View(): ReactNode {
      renders += 1;
      const [a, setA] = useState(0);
      const [b, setB] = useState(0);
      return (
        <>
          <TextDisplay>{`${a}-${b}`}</TextDisplay>
          <ActionRow>
            <Button
              label="x"
              onClick={() => {
                setA(1);
                setB(2);
              }}
            />
          </ActionRow>
        </>
      );
    }
    const root = createRoot();
    root.render(<View />);
    const before = renders;
    await root.dispatch(firstId(root), {});
    expect(renders).toBe(before + 1);
    expect(textOf(root.payload)).toEqual(["1-2"]);
  });

  test("awaits async handlers and includes later updates", async () => {
    const updates: RenderResult[] = [];
    function View(): ReactNode {
      const [status, setStatus] = useState("idle");
      return (
        <>
          <TextDisplay>{status}</TextDisplay>
          <ActionRow>
            <Button
              label="go"
              onClick={async () => {
                setStatus("working");
                await new Promise((resolve) => setTimeout(resolve, 2));
                setStatus("done");
              }}
            />
          </ActionRow>
        </>
      );
    }
    const root = createRoot((result) => updates.push(result));
    root.render(<View />);
    await root.dispatch(firstId(root), {});
    expect(textOf(root.payload)).toEqual(["done"]);
    expect(updates).toHaveLength(0);
  });

  test("propagates handler errors and still commits earlier updates", async () => {
    const failure = new Error("handler failed");
    function View(): ReactNode {
      const [count, setCount] = useState(0);
      return (
        <>
          <TextDisplay>{count}</TextDisplay>
          <ActionRow>
            <Button
              label="x"
              onClick={() => {
                setCount(1);
                throw failure;
              }}
            />
          </ActionRow>
        </>
      );
    }
    const root = createRoot();
    root.render(<View />);
    await expect(root.dispatch(firstId(root), {})).rejects.toBe(failure);
    expect(textOf(root.payload)).toEqual(["1"]);
  });

  test("propagates render errors caused by a dispatch", async () => {
    const failure = new Error("render failed");
    function View(): ReactNode {
      const [broken, setBroken] = useState(false);
      if (broken) throw failure;
      return (
        <ActionRow>
          <Button label="x" onClick={() => setBroken(true)} />
        </ActionRow>
      );
    }
    const root = createRoot();
    root.render(<View />);
    const id = firstId(root);
    await expect(root.dispatch(id, {})).rejects.toBe(failure);
    expect(buttonsOf(root.payload)).toHaveLength(1);
    expect(root.hasHandlers).toBe(false);
    expect(await root.dispatch(id, {})).toBe(false);
  });

  test("propagates validation errors caused by a dispatch", async () => {
    function View(): ReactNode {
      const [broken, setBroken] = useState(false);
      return (
        <ActionRow>
          <Button label={broken ? "x".repeat(81) : "x"} onClick={() => setBroken(true)} />
        </ActionRow>
      );
    }
    const root = createRoot();
    root.render(<View />);
    await expect(root.dispatch(firstId(root), {})).rejects.toThrow("Button label");
  });
});

describe("recovery and transitions", () => {
  test("render recovers a root after an uncaught error", async () => {
    const failure = new Error("render failed");
    function View(): ReactNode {
      const [broken, setBroken] = useState(false);
      if (broken) throw failure;
      return (
        <ActionRow>
          <Button label="x" onClick={() => setBroken(true)} />
        </ActionRow>
      );
    }
    const root = createRoot();
    root.render(<View />);
    await expect(root.dispatch(firstId(root), {})).rejects.toBe(failure);
    root.render(<View />);
    expect(root.hasHandlers).toBe(true);
    expect(await root.dispatch(firstId(root), {}).catch((error: unknown) => error)).toBe(failure);
  });

  test("render throws component errors synchronously", () => {
    const failure = new Error("first render failed");
    function Thrower(): ReactNode {
      throw failure;
    }
    const root = createRoot();
    expect(() => root.render(<Thrower />)).toThrow(failure);
    expect(root.hasHandlers).toBe(false);
  });

  test("render throws validation errors synchronously", () => {
    const root = createRoot();
    expect(() => root.render(<Button label="x" onClick={() => {}} />)).toThrow(
      "Button is not allowed inside Message",
    );
  });

  test("transitions complete within a dispatch", async () => {
    function View(): ReactNode {
      const [value, setValue] = useState("old");
      const [, startTransition] = useTransition();
      return (
        <>
          <TextDisplay>{value}</TextDisplay>
          <ActionRow>
            <Button label="x" onClick={() => startTransition(() => setValue("new"))} />
          </ActionRow>
        </>
      );
    }
    const updates: RenderResult[] = [];
    const root = createRoot((result) => updates.push(result));
    root.render(<View />);
    await root.dispatch(firstId(root), {});
    expect(textOf(root.payload)).toEqual(["new"]);
    expect(updates).toHaveLength(0);
  });
});

describe("useLiveInteraction", () => {
  test("returns the event during dispatch and null otherwise", async () => {
    const seen: unknown[] = [];
    function View(): ReactNode {
      const event = useLiveInteraction<{ user: string }>();
      seen.push(event);
      const [count, setCount] = useState(0);
      return (
        <>
          <TextDisplay>{event?.user ?? "nobody"}</TextDisplay>
          <ActionRow>
            <Button label={String(count)} onClick={() => setCount(count + 1)} />
          </ActionRow>
        </>
      );
    }
    const root = createRoot();
    root.render(<View />);
    expect(seen).toEqual([null]);
    const event = { user: "ada" };
    await root.dispatch(firstId(root), event);
    expect(seen).toEqual([null, event]);
    expect(textOf(root.payload)).toEqual(["ada"]);
  });

  test("handlers receive the event", async () => {
    const seen: unknown[] = [];
    const root = createRoot();
    root.render(
      <ActionRow>
        <Button label="x" onClick={(event) => seen.push(event)} />
      </ActionRow>,
    );
    const event = { id: 1 };
    await root.dispatch(firstId(root), event);
    expect(seen).toEqual([event]);
  });

  test("returns null outside a live root", () => {
    function View(): ReactNode {
      return <TextDisplay>{String(useLiveInteraction())}</TextDisplay>;
    }
    expect(render(<View />).components).toEqual([{ type: ComponentType.TextDisplay, content: "null" }]);
  });
});

describe("onUpdate", () => {
  test("fires for timer updates outside dispatch", async () => {
    const updates: RenderResult[] = [];
    let trigger: (value: number) => void = () => {};
    function View(): ReactNode {
      const [value, setValue] = useState(0);
      trigger = setValue;
      return <TextDisplay>{value}</TextDisplay>;
    }
    const root = createRoot((result) => updates.push(result));
    root.render(<View />);
    expect(updates).toHaveLength(0);

    setTimeout(() => trigger(1), 1);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(updates).toHaveLength(1);
    expect(textOf(updates[0] as RenderResult)).toEqual(["1"]);
    expect(textOf(root.payload)).toEqual(["1"]);
  });

  test("does not fire for dispatch or explicit render", async () => {
    const updates: RenderResult[] = [];
    const root = createRoot((result) => updates.push(result));
    root.render(<Counter />);
    await root.dispatch(firstId(root), {});
    root.render(<TextDisplay>replaced</TextDisplay>);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(updates).toHaveLength(0);
    expect(textOf(root.payload)).toEqual(["replaced"]);
  });

  test("fires for effects scheduled by the first render", async () => {
    const updates: RenderResult[] = [];
    function View(): ReactNode {
      const [ready, setReady] = useState(false);
      useEffect(() => {
        setReady(true);
      }, []);
      return <TextDisplay>{ready ? "ready" : "booting"}</TextDisplay>;
    }
    const root = createRoot((result) => updates.push(result));
    root.render(<View />);
    await root.flush();
    expect(textOf(root.payload)).toEqual(["ready"]);
    expect(updates.map(textOf)).toEqual([["ready"]]);
  });

  test("flush applies pending updates", async () => {
    let trigger: (value: number) => void = () => {};
    function View(): ReactNode {
      const [value, setValue] = useState(0);
      trigger = setValue;
      return <TextDisplay>{value}</TextDisplay>;
    }
    const updates: RenderResult[] = [];
    const root = createRoot((result) => updates.push(result));
    root.render(<View />);
    trigger(5);
    await root.flush();
    expect(textOf(root.payload)).toEqual(["5"]);
    expect(updates).toHaveLength(1);
  });

  test("errors from background commits go to onError", async () => {
    const failure = new Error("late failure");
    const errors: unknown[] = [];
    let breakIt: (value: boolean) => void = () => {};
    function View(): ReactNode {
      const [broken, setBroken] = useState(false);
      breakIt = setBroken;
      if (broken) throw failure;
      return <TextDisplay>ok</TextDisplay>;
    }
    const root = createLiveRoot({ sessionId: "err", onError: (error) => errors.push(error) });
    roots.push(root);
    root.render(<View />);
    breakIt(true);
    await root.flush();
    expect(errors).toEqual([failure]);
    expect(textOf(root.payload)).toEqual(["ok"]);
  });

  test("background errors without onError surface on flush", async () => {
    const failure = new Error("late failure");
    let breakIt: (value: boolean) => void = () => {};
    function View(): ReactNode {
      const [broken, setBroken] = useState(false);
      breakIt = setBroken;
      if (broken) throw failure;
      return <TextDisplay>ok</TextDisplay>;
    }
    const root = createRoot();
    root.render(<View />);
    breakIt(true);
    await expect(root.flush()).rejects.toBe(failure);
    await root.flush();
  });

  test("errors thrown by onUpdate go to onError", async () => {
    const failure = new Error("edit failed");
    const errors: unknown[] = [];
    let trigger: (value: number) => void = () => {};
    function View(): ReactNode {
      const [value, setValue] = useState(0);
      trigger = setValue;
      return <TextDisplay>{value}</TextDisplay>;
    }
    const root = createLiveRoot({
      sessionId: "err",
      onUpdate: () => Promise.reject(failure),
      onError: (error) => errors.push(error),
    });
    roots.push(root);
    root.render(<View />);
    trigger(1);
    await root.flush();
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(errors).toEqual([failure]);
  });
});

describe("suspense in live roots", () => {
  test("shows the fallback and reports the reveal through onUpdate", async () => {
    let resolve: (value: string) => void = () => {};
    const promise = new Promise<string>((done) => {
      resolve = done;
    });
    function Reader(): ReactNode {
      return <TextDisplay>{use(promise)}</TextDisplay>;
    }
    const updates: RenderResult[] = [];
    const root = createRoot((result) => updates.push(result));
    root.render(
      <Suspense fallback={<TextDisplay>loading</TextDisplay>}>
        <Reader />
      </Suspense>,
    );
    expect(textOf(root.payload)).toEqual(["loading"]);

    resolve("loaded");
    await new Promise((done) => setTimeout(done, 20));
    expect(textOf(root.payload)).toEqual(["loaded"]);
    expect(updates.map(textOf)).toEqual([["loaded"]]);
  });

  test("hides revealed content when it suspends again", async () => {
    const pending = new Promise<string>(() => {});
    function Maybe({ wait }: { wait: boolean }): ReactNode {
      return wait ? <TextDisplay>{use(pending)}</TextDisplay> : <TextDisplay>shown</TextDisplay>;
    }
    function View(): ReactNode {
      const [wait, setWait] = useState(false);
      return (
        <>
          <Suspense fallback={<TextDisplay>loading</TextDisplay>}>
            <Maybe wait={wait} />
            <TextDisplay>sibling</TextDisplay>
          </Suspense>
          <ActionRow>
            <Button label="x" onClick={() => setWait(true)} />
          </ActionRow>
        </>
      );
    }
    const root = createRoot();
    root.render(<View />);
    expect(textOf(root.payload)).toEqual(["shown", "sibling"]);
    await root.dispatch(firstId(root), {});
    expect(textOf(root.payload)).toEqual(["loading"]);
  });
});

describe("disableInteractive", () => {
  test("disables every button and select without touching the tree", async () => {
    const root = createRoot();
    root.render(
      <Container>
        <Section accessory={<Button label="a" onClick={() => {}} />}>text</Section>
        <ActionRow>
          <Button style="link" url="https://x" label="link" />
          <Button customId="raw" label="raw" />
        </ActionRow>
        <ActionRow>
          <UserSelect onSelect={() => {}} />
        </ActionRow>
        <Separator />
      </Container>,
    );
    const disabled = root.disableInteractive();
    const container = disabled.components[0] as unknown as {
      components: {
        accessory?: { disabled?: boolean };
        components?: { disabled?: boolean }[];
      }[];
    };
    expect(container.components[0]?.accessory?.disabled).toBe(true);
    expect(container.components[1]?.components?.map((item) => item.disabled)).toEqual([true, true]);
    expect(container.components[2]?.components?.[0]?.disabled).toBe(true);
    expect(JSON.stringify(root.payload)).not.toContain('"disabled"');
    expect(await root.dispatch("~abc:0", {})).toBe(true);
  });

  test("keeps flags and returns top-level rows", () => {
    const root = createRoot();
    root.render(
      <Message ephemeral>
        <ActionRow>
          <Button label="x" onClick={() => {}} />
        </ActionRow>
      </Message>,
    );
    const disabled = root.disableInteractive();
    expect(disabled.flags as number).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
    expect(buttonsOf(disabled)[0]?.disabled).toBe(true);
  });
});

describe("unmount", () => {
  test("runs effect cleanups and stops dispatch and updates", async () => {
    const events: string[] = [];
    let trigger: (value: number) => void = () => {};
    const updates: RenderResult[] = [];
    function View(): ReactNode {
      const [value, setValue] = useState(0);
      trigger = setValue;
      useEffect(() => {
        events.push("mount");
        return () => {
          events.push("cleanup");
        };
      }, []);
      return (
        <>
          <TextDisplay>{value}</TextDisplay>
          <ActionRow>
            <Button label="x" onClick={() => {}} />
          </ActionRow>
        </>
      );
    }
    const root = createLiveRoot({ sessionId: "bye", onUpdate: (result) => updates.push(result) });
    root.render(<View />);
    const id = firstId(root);
    root.unmount();
    expect(events).toEqual(["mount", "cleanup"]);
    expect(await root.dispatch(id, {})).toBe(false);
    expect(root.hasHandlers).toBe(false);
    expect(textOf(root.payload)).toEqual(["0"]);
    expect(buttonsOf(root.disableInteractive())[0]?.disabled).toBe(true);
    trigger(1);
    await root.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(updates).toHaveLength(0);
    expect(() => root.render(<TextDisplay>again</TextDisplay>)).toThrow("has been unmounted");
    root.unmount();
  });
});

describe("one-shot rendering next to live roots", () => {
  test("render inside a handler stays independent", async () => {
    let rendered: RenderResult | undefined;
    function View(): ReactNode {
      const [count, setCount] = useState(0);
      return (
        <>
          <TextDisplay>{count}</TextDisplay>
          <ActionRow>
            <Button
              label="x"
              onClick={() => {
                setCount(count + 1);
                rendered = render(<TextDisplay>reply</TextDisplay>);
              }}
            />
          </ActionRow>
        </>
      );
    }
    const root = createRoot();
    root.render(<View />);
    await root.dispatch(firstId(root), {});
    expect(textOf(rendered as RenderResult)).toEqual(["reply"]);
    expect(textOf(root.payload)).toEqual(["1"]);
  });

  test("renderAsync and live roots share the reconciler", async () => {
    const promise = new Promise<string>((resolve) => setTimeout(() => resolve("async"), 2));
    function Reader(): ReactNode {
      return <TextDisplay>{use(promise)}</TextDisplay>;
    }
    const root = createRoot();
    root.render(<Counter />);
    const [result] = await Promise.all([renderAsync(<Reader />), root.dispatch(firstId(root), {})]);
    expect(textOf(result)).toEqual(["async"]);
    expect(textOf(root.payload)).toEqual(["count 1"]);
  });
});
