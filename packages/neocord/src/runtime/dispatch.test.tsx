import { describe, expect, test } from "bun:test";
import { Container, Message, TextDisplay } from "@neocord/react";
import { MessageFlags, type Interaction, type PermissionsString } from "discord.js";
import { Suspense, use, type ReactNode } from "react";
import { createLogger, type LogMethod } from "../logger.ts";
import { useContext } from "../context-hook.tsx";
import {
  defineButton,
  defineCommand,
  defineFeature,
  defineMessageCommand,
  defineMiddleware,
  defineModal,
  defineSelect,
  defineUserCommand,
  option,
} from "../index.ts";
import type { StandardSchemaV1 } from "../standard-schema.ts";
import {
  createFakeInteraction,
  mockMember,
  mockMessage,
  mockRole,
  mockUser,
  type ApiHook,
  type FakeInteractionOptions,
  type Recording,
} from "../testing/fakes.ts";
import { createHarness } from "../testing/run.tsx";
import type { ErrorProps, LayoutProps, Manifest, ManifestRoute } from "../types.ts";
import { collectModalValues } from "./dispatch.tsx";

function text(payload: { components: unknown[] } | undefined): string {
  const walk = (components: unknown[]): string[] =>
    components.flatMap((component) => {
      const entry = component as { content?: string; components?: unknown[] };
      if (entry.content !== undefined) return [entry.content];
      return entry.components === undefined ? [] : walk(entry.components);
    });
  return walk(payload?.components ?? []).join("|");
}

function ephemeral(payload: { flags: unknown } | undefined): boolean {
  return (Number(payload?.flags) & MessageFlags.Ephemeral) !== 0;
}

function route(kind: ManifestRoute["kind"], id: string, value: unknown, extra: Partial<ManifestRoute> = {}): ManifestRoute {
  return {
    kind,
    id,
    feature: "core",
    file: `f/${kind}/${id}.tsx`,
    segments: kind === "command" ? id.split(" ") : id.split("/").slice(1),
    module: { default: value },
    middleware: [],
    layouts: [],
    error: null,
    loading: null,
    ...extra,
  };
}

function manifestOf(routes: ManifestRoute[], extra: Partial<Manifest> = {}): Manifest {
  return { version: 1, context: null, features: [], groups: [], routes, ...extra };
}

function mod(file: string, value: unknown): { file: string; module: { default: unknown } } {
  return { file, module: { default: value } };
}

interface Run {
  recording: Recording;
  errors: unknown[];
  logs: { level: LogMethod; line: string }[];
  methods: string[];
}

async function run(
  routes: ManifestRoute[],
  fake: FakeInteractionOptions,
  options: { autoDeferAfter?: number | false; extra?: Partial<Manifest>; hook?: ApiHook; app?: unknown } = {},
): Promise<Run> {
  const logs: Run["logs"] = [];
  const harness = createHarness({
    manifest: manifestOf(routes, options.extra),
    logger: createLogger({ level: "debug", sink: (level, line) => logs.push({ level, line }) }),
    autoDeferAfter: options.autoDeferAfter ?? false,
    ...(options.app === undefined ? {} : { app: options.app }),
  });
  const interaction = createFakeInteraction({
    ...fake,
    ...(options.hook === undefined ? {} : { hook: options.hook }),
  }) as Interaction & { recording: Recording };
  await harness.dispatch(interaction);
  await harness.close();
  return {
    recording: interaction.recording,
    errors: harness.errors,
    logs,
    methods: interaction.recording.log.map((entry) => entry.method),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const command = (execute: Parameters<typeof defineCommand>[0]["execute"]) => defineCommand({ description: "d", execute });

describe("chat input dispatch", () => {
  test("routes by command, group and subcommand and resolves options", async () => {
    let seen: unknown;
    const user = mockUser();
    const definition = defineCommand({
      description: "d",
      options: {
        target: option.user({ description: "d", required: true }),
        reason: option.string({ description: "d" }),
      },
      execute(ctx) {
        seen = ctx.options;
        return `route ${ctx.route} feature ${ctx.feature} kind ${ctx.kind}`;
      },
    });
    const result = await run(
      [
        route("command", "mod warn add", definition),
        route("command", "mod warn", command(() => "wrong")),
        route("command", "mod", command(() => "wrong")),
      ],
      { kind: "command", commandName: "mod", group: "warn", subcommand: "add", options: { target: user } },
    );
    expect(seen).toEqual({ target: user, reason: undefined });
    expect(text(result.recording.replies[0])).toBe("route mod warn add feature core kind command");
  });

  test("subcommand without a group", async () => {
    const result = await run([route("command", "mod warn", command(() => "yes"))], {
      kind: "command",
      commandName: "mod",
      subcommand: "warn",
    });
    expect(text(result.recording.replies[0])).toBe("yes");
  });

  test("unknown command warns and tells the user ephemerally", async () => {
    const result = await run([], { kind: "command", commandName: "ghost" });
    expect(result.logs.some((entry) => entry.level === "warn" && entry.line.includes('"/ghost"'))).toBe(true);
    expect(text(result.recording.replies[0])).toContain("no longer available");
    expect(ephemeral(result.recording.replies[0])).toBe(true);
  });

  test("a required option that cannot be resolved tells the user", async () => {
    const definition = defineCommand({
      description: "d",
      options: { who: option.member({ description: "d", required: true }) },
      execute: () => "ran",
    });
    const result = await run([route("command", "x", definition)], { kind: "command", commandName: "x" });
    expect(text(result.recording.replies[0])).toContain("not a member of this server");
    expect(ephemeral(result.recording.replies[0])).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("returning nothing without acknowledging logs a warning", async () => {
    const result = await run([route("command", "x", command(() => undefined))], { kind: "command", commandName: "x" });
    expect(result.methods).toEqual([]);
    expect(result.logs.some((entry) => entry.level === "warn" && entry.line.includes("returned nothing"))).toBe(true);
  });

  test("an auto deferred command returning nothing removes the placeholder", async () => {
    const result = await run(
      [
        route(
          "command",
          "x",
          command(async () => {
            await sleep(30);
          }),
        ),
      ],
      { kind: "command", commandName: "x" },
      { autoDeferAfter: 5 },
    );
    expect(result.methods).toEqual(["deferReply", "deleteReply"]);
  });

  test("ctx.reply is state aware and a returned node follows", async () => {
    const result = await run(
      [
        route(
          "command",
          "x",
          command(async (ctx) => {
            await ctx.reply("one");
            await ctx.reply("two");
            return "three";
          }),
        ),
      ],
      { kind: "command", commandName: "x" },
    );
    expect(result.methods).toEqual(["reply", "followUp", "followUp"]);
  });

  test("defer then return edits, and the ephemeral setting is honoured", async () => {
    const definition = defineCommand({
      description: "d",
      ephemeral: true,
      async execute(ctx) {
        await ctx.defer();
        return "done";
      },
    });
    const result = await run([route("command", "x", definition)], { kind: "command", commandName: "x" });
    expect(result.methods).toEqual(["deferReply", "editReply"]);
    expect(result.recording.ephemeral).toBe(true);
    expect(result.recording.edits[0]?.flags).toBe(MessageFlags.IsComponentsV2);
  });

  test("autoDefer covers slow handlers", async () => {
    const result = await run(
      [
        route(
          "command",
          "x",
          command(async () => {
            await sleep(30);
            return "slow";
          }),
        ),
      ],
      { kind: "command", commandName: "x" },
      { autoDeferAfter: 5 },
    );
    expect(result.methods).toEqual(["deferReply", "editReply"]);
    expect(text(result.recording.edits[0])).toBe("slow");
  });

  test("editReply, followUp and deleteReply work through the context", async () => {
    const result = await run(
      [
        route(
          "command",
          "x",
          command(async (ctx) => {
            await ctx.reply("a");
            await ctx.editReply("b");
            await ctx.followUp("c");
            await ctx.deleteReply();
          }),
        ),
      ],
      { kind: "command", commandName: "x" },
    );
    expect(result.methods).toEqual(["reply", "editReply", "followUp", "deleteReply"]);
  });

  test("a node that renders nothing is reported instead of sent", async () => {
    const result = await run([route("command", "x", command(() => <></>))], { kind: "command", commandName: "x" });
    expect(String(result.errors[0])).toContain("rendered no components");
    expect(text(result.recording.replies[0])).toContain("Something went wrong");
  });
});

describe("autocomplete dispatch", () => {
  const definition = defineCommand({
    description: "d",
    options: {
      topic: option.string({
        description: "d",
        autocomplete(ctx) {
          if (ctx.focused === "boom") throw new Error("autocomplete failed");
          return Array.from({ length: 30 }, (_, index) => ({ name: `${ctx.optionName}${ctx.focused}${index}`, value: `${index}` }));
        },
      }),
      plain: option.string({ description: "d" }),
    },
    execute: () => "x",
  });

  test("responds with up to 25 choices", async () => {
    const result = await run([route("command", "search", definition)], {
      kind: "autocomplete",
      commandName: "search",
      focused: { name: "topic", value: "q" },
    });
    expect(result.recording.choices).toHaveLength(25);
    expect((result.recording.choices as { name: string }[])[0]?.name).toBe("topicq0");
  });

  test("errors respond with an empty list and are logged", async () => {
    const result = await run([route("command", "search", definition)], {
      kind: "autocomplete",
      commandName: "search",
      focused: { name: "topic", value: "boom" },
    });
    expect(result.recording.choices).toEqual([]);
    expect(result.logs.some((entry) => entry.level === "error" && entry.line.includes("autocomplete failed"))).toBe(true);
  });

  test("missing handlers and commands respond with an empty list", async () => {
    const missing = await run([route("command", "search", definition)], {
      kind: "autocomplete",
      commandName: "search",
      focused: { name: "plain", value: "" },
    });
    expect(missing.recording.choices).toEqual([]);
    const unknown = await run([], { kind: "autocomplete", commandName: "nope", focused: { name: "x", value: "" } });
    expect(unknown.recording.choices).toEqual([]);
  });
});

describe("context menu dispatch", () => {
  test("user command gets the target", async () => {
    const target = mockUser({ username: "targeted" });
    const definition = defineUserCommand({
      name: "Report",
      execute: (ctx) => `kind ${ctx.kind} ${ctx.target.username} ${String(ctx.targetMember)}`,
    });
    const result = await run([route("user-command", "core/report", definition)], {
      kind: "user-command",
      commandName: "Report",
      target,
    });
    expect(text(result.recording.replies[0])).toBe("kind user-command targeted null");
  });

  test("message command gets the target", async () => {
    const target = mockMessage({ id: "42" });
    const definition = defineMessageCommand({ name: "Quote", execute: (ctx) => `msg ${ctx.target.id}` });
    const result = await run([route("message-command", "core/quote", definition)], {
      kind: "message-command",
      commandName: "Quote",
      target,
    });
    expect(text(result.recording.replies[0])).toBe("msg 42");
  });

  test("user and message commands with the same name stay separate", async () => {
    const routes = [
      route("user-command", "core/x", defineUserCommand({ name: "Same", execute: () => "user" })),
      route("message-command", "core/x", defineMessageCommand({ name: "Same", execute: () => "message" })),
    ];
    const asUser = await run(routes, { kind: "user-command", commandName: "Same", target: mockUser() });
    expect(text(asUser.recording.replies[0])).toBe("user");
    const asMessage = await run(routes, { kind: "message-command", commandName: "Same", target: mockMessage() });
    expect(text(asMessage.recording.replies[0])).toBe("message");
  });

  test("unknown context menus are reported", async () => {
    const result = await run([], { kind: "user-command", commandName: "Ghost", target: mockUser() });
    expect(text(result.recording.replies[0])).toContain("no longer available");
  });
});

describe("button dispatch", () => {
  test("params are decoded and a returned node updates", async () => {
    const definition = defineButton("core/confirm/[userId]", { execute: (ctx) => `user ${ctx.params.userId}` });
    const result = await run([route("button", "core/confirm/[userId]", definition)], {
      kind: "button",
      customId: "core/confirm/a%2Fb",
    });
    expect(text(result.recording.updates[0])).toBe("user a/b");
    expect(result.methods).toEqual(["update"]);
  });

  test('respond: "reply" replies', async () => {
    const definition = defineButton("core/x", { respond: "reply", execute: () => "hi" });
    const result = await run([route("button", "core/x", definition)], { kind: "button", customId: "core/x" });
    expect(result.methods).toEqual(["reply"]);
  });

  test("returning nothing defers the update", async () => {
    const definition = defineButton("core/x", { execute: () => undefined });
    const result = await run([route("button", "core/x", definition)], { kind: "button", customId: "core/x" });
    expect(result.methods).toEqual(["deferUpdate"]);
  });

  test("returning nothing after acknowledging adds nothing", async () => {
    const definition = defineButton("core/x", {
      async execute(ctx) {
        await ctx.update("changed");
      },
    });
    const result = await run([route("button", "core/x", definition)], { kind: "button", customId: "core/x" });
    expect(result.methods).toEqual(["update"]);
  });

  test("deferUpdate and message are available", async () => {
    const message = mockMessage({ id: "77" });
    let seen = "";
    const definition = defineButton("core/x", {
      async execute(ctx) {
        seen = ctx.message.id;
        await ctx.deferUpdate();
        return "after";
      },
    });
    const result = await run([route("button", "core/x", definition)], { kind: "button", customId: "core/x", message });
    expect(seen).toBe("77");
    expect(result.methods).toEqual(["deferUpdate", "editReply"]);
  });

  test("a button and a select can share an id", async () => {
    const routes = [
      route("button", "core/same", defineButton("core/same", { execute: () => "button" })),
      route("select", "core/same", defineSelect("core/same", { execute: () => "select" })),
    ];
    expect(text((await run(routes, { kind: "button", customId: "core/same" })).recording.updates[0])).toBe("button");
    expect(
      text((await run(routes, { kind: "string-select", customId: "core/same", values: ["a"] })).recording.updates[0]),
    ).toBe("select");
  });

  test("unknown routes warn and tell the user", async () => {
    const result = await run([], { kind: "button", customId: "core/ghost" });
    expect(result.logs.some((entry) => entry.level === "warn" && entry.line.includes("core/ghost"))).toBe(true);
    expect(ephemeral(result.recording.replies[0])).toBe(true);
  });
});

describe("select dispatch", () => {
  test("string select gets values", async () => {
    const definition = defineSelect("core/pick/[id]", { execute: (ctx) => `${ctx.params.id}:${ctx.values.join(",")}` });
    const result = await run([route("select", "core/pick/[id]", definition)], {
      kind: "string-select",
      customId: "core/pick/9",
      values: ["a", "b"],
    });
    expect(text(result.recording.updates[0])).toBe("9:a,b");
  });

  test("role select exposes the collection", async () => {
    const role = mockRole({ name: "mods" });
    const definition = defineSelect("core/roles", { type: "role", execute: (ctx) => ctx.roles.map((entry) => (entry as { name: string }).name).join() });
    const result = await run([route("select", "core/roles", definition)], {
      kind: "role-select",
      customId: "core/roles",
      values: [role.id],
      selected: { roles: [role] },
    });
    expect(text(result.recording.updates[0])).toBe("mods");
  });

  test("a mismatched select type is refused", async () => {
    let called = false;
    const definition = defineSelect("core/roles", {
      type: "role",
      execute: () => {
        called = true;
      },
    });
    const result = await run([route("select", "core/roles", definition)], {
      kind: "string-select",
      customId: "core/roles",
      values: [],
    });
    expect(called).toBe(false);
    expect(ephemeral(result.recording.replies[0])).toBe(true);
  });
});

function fakeSchema(
  validate: (value: unknown) => StandardSchemaV1.Result<{ reason: string }> | Promise<StandardSchemaV1.Result<{ reason: string }>>,
): StandardSchemaV1<{ reason: string }, { reason: string }> {
  return { "~standard": { version: 1, vendor: "test", validate } };
}

describe("modal dispatch", () => {
  test("schema success passes parsed values", async () => {
    const schema = fakeSchema((value) => ({ value: { reason: `${(value as { reason: string }).reason}!` } }));
    const definition = defineModal("core/ban/[userId]", {
      title: "t",
      schema,
      render: () => null,
      submit: (ctx) => `${ctx.params.userId} ${ctx.values.reason}`,
    });
    const result = await run([route("modal", "core/ban/[userId]", definition)], {
      kind: "modal",
      customId: "core/ban/5",
      modalValues: { reason: "spam" },
    });
    expect(text(result.recording.replies[0])).toBe("5 spam!");
  });

  test("schema failure replies ephemerally with issues and skips submit", async () => {
    let submitted = false;
    const schema = fakeSchema(async () => ({
      issues: [
        { message: "Too short", path: ["reason"] },
        { message: "Bad *nested*", path: [{ key: "a" }, "b"] },
        { message: "General" },
      ],
    }));
    const definition = defineModal("core/ban", {
      title: "t",
      schema,
      render: () => null,
      submit: () => {
        submitted = true;
      },
    });
    const result = await run([route("modal", "core/ban", definition)], {
      kind: "modal",
      customId: "core/ban",
      modalValues: { reason: "x" },
    });
    expect(submitted).toBe(false);
    const output = text(result.recording.replies[0]);
    expect(output).toContain("reason: Too short");
    expect(output).toContain("a.b: Bad \\*nested\\*");
    expect(output).toContain("General");
    expect(ephemeral(result.recording.replies[0])).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("no schema passes raw values", async () => {
    let seen: unknown;
    const definition = defineModal("core/raw", {
      title: "t",
      render: () => null,
      submit(ctx) {
        seen = ctx.values;
        return "ok";
      },
    });
    await run([route("modal", "core/raw", definition)], {
      kind: "modal",
      customId: "core/raw",
      modalValues: { text: "hello", blank: "", many: ["a", "b"], tick: true, untick: false },
    });
    expect(seen).toEqual({ text: "hello", many: ["a", "b"], tick: true, untick: false });
  });

  test("returning nothing acknowledges silently, or defers an update from a message", async () => {
    const definition = defineModal("core/quiet", { title: "t", render: () => null, submit: () => undefined });
    const fromCommand = await run([route("modal", "core/quiet", definition)], {
      kind: "modal",
      customId: "core/quiet",
    });
    expect(fromCommand.methods).toEqual(["deferReply", "deleteReply"]);

    const fromMessage = await run([route("modal", "core/quiet", definition)], {
      kind: "modal",
      customId: "core/quiet",
      message: mockMessage(),
    });
    expect(fromMessage.methods).toEqual(["deferUpdate"]);
  });

  test("unknown modal routes are reported", async () => {
    const result = await run([], { kind: "modal", customId: "core/ghost" });
    expect(text(result.recording.replies[0])).toContain("no longer available");
  });

  test("collectModalValues handles every field shape", () => {
    const interaction = {
      fields: {
        fields: new Map<string, unknown>([
          ["text", { value: "a" }],
          ["empty", { value: "" }],
          ["radioNone", { value: null }],
          ["radio", { value: "r" }],
          ["select", { values: ["1", "2"] }],
          ["files", { values: ["id"], attachments: new Map() }],
          ["check", { value: false }],
        ]),
      },
    };
    expect(collectModalValues(interaction as never)).toEqual({
      text: "a",
      radio: "r",
      select: ["1", "2"],
      files: ["id"],
      check: false,
    });
  });
});

describe("showModal", () => {
  const modal = defineModal("core/ban/[userId]", {
    title: ({ params }) => `Ban ${params.userId}`,
    render({ field, params }) {
      return <TextDisplay>{`${field("reason")} for ${params.userId}`}</TextDisplay>;
    },
    submit: () => "x",
  });
  const modalRoute = route("modal", "core/ban/[userId]", modal);

  test("renders the route with params and a typed custom id", async () => {
    const definition = defineButton("core/open", {
      async execute(ctx) {
        await ctx.showModal("core/ban/[userId]", { userId: 7 });
      },
    });
    const result = await run([route("button", "core/open", definition), modalRoute], {
      kind: "button",
      customId: "core/open",
    });
    expect(result.recording.modal?.custom_id).toBe("core/ban/7");
    expect(result.recording.modal?.title).toBe("Ban 7");
    expect(JSON.stringify(result.recording.modal?.components)).toContain("reason for 7");
    expect(result.methods).toEqual(["showModal"]);
  });

  test("an unknown modal goes to the error boundary", async () => {
    const definition = defineButton("core/open", {
      async execute(ctx) {
        await ctx.showModal("core/none");
      },
    });
    const result = await run([route("button", "core/open", definition)], { kind: "button", customId: "core/open" });
    expect(String(result.errors[0])).toContain("not a modal route");
  });

  test("showModal after loading is a clear error", async () => {
    const definition = defineCommand({
      description: "d",
      async execute(ctx) {
        await ctx.showModal("core/ban/[userId]", { userId: 7 });
      },
    });
    const result = await run(
      [route("command", "x", definition, { loading: mod("loading.tsx", () => <TextDisplay>wait</TextDisplay>) }), modalRoute],
      { kind: "command", commandName: "x" },
    );
    expect(String(result.errors[0])).toContain("showModal() must be the first response");
  });
});

describe("middleware", () => {
  const order: string[] = [];
  const tracer = (name: string) =>
    defineMiddleware(async (_ctx, next) => {
      order.push(`${name}:in`);
      await next();
      order.push(`${name}:out`);
    });

  test("runs root to leaf around the handler and shares state", async () => {
    order.length = 0;
    const result = await run(
      [
        route(
          "command",
          "x",
          command((ctx) => {
            order.push("handler");
            return `${String(ctx.state.value)}`;
          }),
          {
            middleware: [
              mod("a.ts", tracer("a")),
              mod(
                "s.ts",
                defineMiddleware(async (ctx, next) => {
                  ctx.state.value = "shared";
                  await next();
                }),
              ),
              mod("b.ts", tracer("b")),
            ],
          },
        ),
      ],
      { kind: "command", commandName: "x" },
    );
    expect(order).toEqual(["a:in", "b:in", "handler", "b:out", "a:out"]);
    expect(text(result.recording.replies[0])).toBe("shared");
  });

  test("a returned node short-circuits and replies", async () => {
    let ran = false;
    const result = await run(
      [
        route(
          "command",
          "x",
          command(() => {
            ran = true;
          }),
          { middleware: [mod("deny.ts", defineMiddleware(() => <TextDisplay>Denied</TextDisplay>))] },
        ),
      ],
      { kind: "command", commandName: "x" },
    );
    expect(ran).toBe(false);
    expect(text(result.recording.replies[0])).toBe("Denied");
    expect(result.logs.some((entry) => entry.level === "error")).toBe(false);
  });

  test("a short-circuit on a button replies rather than updating", async () => {
    const definition = defineButton("core/x", { execute: () => "no" });
    const result = await run(
      [route("button", "core/x", definition, { middleware: [mod("deny.ts", defineMiddleware(() => "Denied"))] })],
      { kind: "button", customId: "core/x" },
    );
    expect(result.methods).toEqual(["reply"]);
  });

  test("next() can only be called once", async () => {
    const twice = defineMiddleware(async (_ctx, next) => {
      await next();
      await next();
    });
    let count = 0;
    const result = await run(
      [
        route(
          "command",
          "x",
          command(() => {
            count += 1;
            return "ok";
          }),
          { middleware: [mod("twice.ts", twice)] },
        ),
      ],
      { kind: "command", commandName: "x" },
    );
    expect(count).toBe(1);
    expect(String(result.errors[0])).toContain('next() was called more than once in middleware "twice.ts"');
  });

  test("kinds filter middleware", async () => {
    let calls = 0;
    const onlyButton = defineMiddleware(
      async (_ctx, next) => {
        calls += 1;
        await next();
      },
      { kinds: ["button"] },
    );
    const middleware = [mod("only.ts", onlyButton)];
    await run([route("command", "x", command(() => "ok"), { middleware })], { kind: "command", commandName: "x" });
    expect(calls).toBe(0);
    await run([route("button", "core/x", defineButton("core/x", { execute: () => "ok" }), { middleware })], {
      kind: "button",
      customId: "core/x",
    });
    expect(calls).toBe(1);
  });

  test("errors in middleware reach the error boundary", async () => {
    const result = await run(
      [
        route("command", "x", command(() => "ok"), {
          middleware: [
            mod(
              "throw.ts",
              defineMiddleware(() => {
                throw new Error("mw broke");
              }),
            ),
          ],
        }),
      ],
      { kind: "command", commandName: "x" },
    );
    expect(String(result.errors[0])).toContain("mw broke");
    expect(ephemeral(result.recording.replies[0])).toBe(true);
  });
});

describe("layouts", () => {
  function Root({ children }: LayoutProps): ReactNode {
    return (
      <Container>
        <TextDisplay>root</TextDisplay>
        {children}
      </Container>
    );
  }
  function Leaf({ children }: LayoutProps): ReactNode {
    return (
      <>
        <TextDisplay>leaf</TextDisplay>
        {children}
      </>
    );
  }
  const layouts = [mod("root.tsx", Root), mod("leaf.tsx", Leaf)];

  test("wrap root to leaf", async () => {
    const result = await run(
      [route("command", "x", command(() => <TextDisplay>body</TextDisplay>), { layouts })],
      { kind: "command", commandName: "x" },
    );
    expect(text(result.recording.replies[0])).toBe("root|leaf|body");
    expect(result.recording.replies[0]?.components).toHaveLength(1);
  });

  test("apply to ctx.reply and ctx.followUp as well", async () => {
    const result = await run(
      [
        route(
          "command",
          "x",
          command(async (ctx) => {
            await ctx.reply(<TextDisplay>a</TextDisplay>);
            await ctx.followUp(<TextDisplay>b</TextDisplay>);
          }),
          { layouts: [layouts[0]!] },
        ),
      ],
      { kind: "command", commandName: "x" },
    );
    expect(text(result.recording.replies[0])).toBe("root|a");
    expect(text(result.recording.followUps[0])).toBe("root|b");
  });

  test("layout: false on the definition and on a call", async () => {
    const off = defineCommand({ description: "d", layout: false, execute: () => <TextDisplay>body</TextDisplay> });
    const result = await run([route("command", "x", off, { layouts })], { kind: "command", commandName: "x" });
    expect(text(result.recording.replies[0])).toBe("body");

    const perCall = await run(
      [
        route(
          "command",
          "x",
          command(async (ctx) => {
            await ctx.reply(<TextDisplay>body</TextDisplay>, { layout: false });
          }),
          { layouts },
        ),
      ],
      { kind: "command", commandName: "x" },
    );
    expect(text(perCall.recording.replies[0])).toBe("body");
  });

  test("a returned Message root stays at the root with layouts inside", async () => {
    const result = await run(
      [
        route(
          "command",
          "x",
          command(() => (
            <Message ephemeral>
              <TextDisplay>body</TextDisplay>
            </Message>
          )),
          { layouts: [layouts[0]!] },
        ),
      ],
      { kind: "command", commandName: "x" },
    );
    expect(text(result.recording.replies[0])).toBe("root|body");
    expect(ephemeral(result.recording.replies[0])).toBe(true);
  });

  test("useContext works inside layouts and handlers' trees", async () => {
    function Who(): ReactNode {
      const ctx = useContext();
      return <TextDisplay>{ctx.route}</TextDisplay>;
    }
    function WithContext({ children }: LayoutProps): ReactNode {
      return (
        <>
          <Who />
          {children}
        </>
      );
    }
    const result = await run(
      [route("command", "x", command(() => <Who />), { layouts: [mod("c.tsx", WithContext)] })],
      { kind: "command", commandName: "x" },
    );
    expect(text(result.recording.replies[0])).toBe("x|x");
  });

  test("useContext outside neocord throws", () => {
    expect(() => {
      useContext();
    }).toThrow();
  });
});

describe("errors", () => {
  function ErrorView({ error, ctx }: ErrorProps): ReactNode {
    return <TextDisplay>{`handled ${(error as Error).message} on ${ctx.route}`}</TextDisplay>;
  }
  const failing = command(() => {
    throw new Error("nope");
  });

  test("the closest error view is shown ephemerally and the error is logged", async () => {
    const result = await run([route("command", "x", failing, { error: mod("error.tsx", ErrorView) })], {
      kind: "command",
      commandName: "x",
    });
    expect(text(result.recording.replies[0])).toBe("handled nope on x");
    expect(ephemeral(result.recording.replies[0])).toBe(true);
    expect(result.logs.some((entry) => entry.level === "error" && entry.line.includes("nope"))).toBe(true);
  });

  test("the built-in fallback covers routes without one and hides details", async () => {
    const result = await run([route("command", "x", failing)], { kind: "command", commandName: "x" });
    const output = text(result.recording.replies[0]);
    expect(output).toContain("Something went wrong");
    expect(output).not.toContain("nope");
  });

  test("a failing error view falls back too", async () => {
    const Broken = (): ReactNode => {
      throw new Error("view broke");
    };
    const result = await run([route("command", "x", failing, { error: mod("error.tsx", Broken) })], {
      kind: "command",
      commandName: "x",
    });
    expect(text(result.recording.replies[0])).toContain("Something went wrong");
    expect(result.logs.some((entry) => entry.line.includes("view broke"))).toBe(true);
  });

  test("rendering errors in the returned tree reach the boundary", async () => {
    const Bad = (): ReactNode => {
      throw new Error("render broke");
    };
    const result = await run(
      [route("command", "x", command(() => <Bad />), { error: mod("error.tsx", ErrorView) })],
      { kind: "command", commandName: "x" },
    );
    expect(text(result.recording.replies[0])).toBe("handled render broke on x");
  });

  test("after a public defer the error is still private", async () => {
    const definition = command(async (ctx) => {
      await ctx.defer();
      throw new Error("late");
    });
    const result = await run([route("command", "x", definition)], { kind: "command", commandName: "x" });
    expect(result.methods).toEqual(["deferReply", "deleteReply", "followUp"]);
    expect(ephemeral(result.recording.followUps[0])).toBe(true);
  });

  test("after a reply the error follows up", async () => {
    const definition = command(async (ctx) => {
      await ctx.reply("ok");
      throw new Error("late");
    });
    const result = await run([route("command", "x", definition)], { kind: "command", commandName: "x" });
    expect(result.methods).toEqual(["reply", "followUp"]);
    expect(ephemeral(result.recording.followUps[0])).toBe(true);
  });

  test("a failing network send is logged and does not crash", async () => {
    const hook: ApiHook = () => {
      throw new Error("network down");
    };
    const result = await run([route("command", "x", command(() => "x"))], { kind: "command", commandName: "x" }, { hook });
    expect(result.logs.some((entry) => entry.line.includes("Could not send the error message"))).toBe(true);
  });

  test("errors after showing a modal are only logged", async () => {
    const modal = defineModal("core/m", { title: "t", render: () => <TextDisplay>x</TextDisplay>, submit: () => "x" });
    const definition = command(async (ctx) => {
      await ctx.showModal("core/m");
      throw new Error("after modal");
    });
    const result = await run([route("command", "x", definition), route("modal", "core/m", modal)], {
      kind: "command",
      commandName: "x",
    });
    expect(result.methods).toEqual(["showModal"]);
    expect(String(result.errors[0])).toContain("after modal");
  });
});

describe("loading flow", () => {
  const Loading = (): ReactNode => <TextDisplay>Loading...</TextDisplay>;

  test("the loading UI is sent immediately and the result replaces it", async () => {
    const order: string[] = [];
    const definition = command(() => {
      order.push("handler");
      return "Done";
    });
    const result = await run(
      [route("command", "x", definition, { loading: mod("loading.tsx", Loading) })],
      { kind: "command", commandName: "x" },
      {
        hook: (method) => {
          order.push(method);
        },
      },
    );
    expect(order).toEqual(["reply", "handler", "editReply"]);
    expect(text(result.recording.replies[0])).toBe("Loading...");
    expect(text(result.recording.edits[0])).toBe("Done");
  });

  test("ctx.reply replaces it the same way, then follows up", async () => {
    const definition = command(async (ctx) => {
      await ctx.reply("first");
      await ctx.reply("second");
    });
    const result = await run([route("command", "x", definition, { loading: mod("loading.tsx", Loading) })], {
      kind: "command",
      commandName: "x",
    });
    expect(result.methods).toEqual(["reply", "editReply", "followUp"]);
  });

  test("an ephemeral command keeps its loading state ephemeral", async () => {
    const definition = defineCommand({ description: "d", ephemeral: true, execute: () => "Done" });
    const result = await run([route("command", "x", definition, { loading: mod("loading.tsx", Loading) })], {
      kind: "command",
      commandName: "x",
    });
    expect(ephemeral(result.recording.replies[0])).toBe(true);
    expect(result.methods).toEqual(["reply", "editReply"]);
  });

  test("buttons ignore loading", async () => {
    const definition = defineButton("core/x", { execute: () => "Done" });
    const result = await run([route("button", "core/x", definition, { loading: mod("loading.tsx", Loading) })], {
      kind: "button",
      customId: "core/x",
    });
    expect(result.methods).toEqual(["update"]);
  });

  test("suspended trees are awaited before replying", async () => {
    const promise = new Promise<string>((resolve) => setTimeout(() => resolve("resolved"), 10));
    function Reader(): ReactNode {
      return <TextDisplay>{use(promise)}</TextDisplay>;
    }
    const result = await run(
      [
        route(
          "command",
          "x",
          command(() => (
            <Suspense fallback={<TextDisplay>fallback</TextDisplay>}>
              <Reader />
            </Suspense>
          )),
        ),
      ],
      { kind: "command", commandName: "x" },
    );
    expect(text(result.recording.replies[0])).toBe("resolved");
  });
});

describe("guildOnly and permissions", () => {
  const guarded = defineCommand({
    description: "d",
    guildOnly: true,
    execute: (ctx) => `in ${ctx.guild.name}`,
  });

  test("guildOnly rejects DMs ephemerally without running", async () => {
    const result = await run([route("command", "x", guarded)], { kind: "command", commandName: "x", guild: null });
    expect(text(result.recording.replies[0])).toContain("only be used in a server");
    expect(ephemeral(result.recording.replies[0])).toBe(true);
  });

  test("guildOnly passes in a guild and exposes guild and member", async () => {
    const member = mockMember();
    const result = await run([route("command", "x", guarded)], {
      kind: "command",
      commandName: "x",
      guild: member.guild,
      member,
      user: member.user,
    });
    expect(text(result.recording.replies[0])).toBe(`in ${member.guild.name}`);
  });

  const moderator = (permissions: readonly PermissionsString[]) => mockMember({ permissions });
  const banCommand = defineCommand({ description: "d", permissions: ["BanMembers"], execute: () => "banned" });

  test("missing permissions are refused", async () => {
    const member = moderator(["SendMessages"]);
    const result = await run([route("command", "x", banCommand)], {
      kind: "command",
      commandName: "x",
      guild: member.guild,
      member,
    });
    expect(text(result.recording.replies[0])).toContain("Ban Members");
    expect(ephemeral(result.recording.replies[0])).toBe(true);
  });

  test("granted permissions pass", async () => {
    const member = moderator(["BanMembers"]);
    const result = await run([route("command", "x", banCommand)], {
      kind: "command",
      commandName: "x",
      guild: member.guild,
      member,
    });
    expect(text(result.recording.replies[0])).toBe("banned");
  });

  test("permissions without a guild are refused", async () => {
    const result = await run([route("command", "x", banCommand)], { kind: "command", commandName: "x" });
    expect(text(result.recording.replies[0])).toContain("only be used in a server");
  });

  test("group metadata applies at runtime", async () => {
    const definition = command(() => "ran");
    const groups = [{ feature: "core", segments: ["mod"], file: "g.ts", module: { default: { __neocord: "group", description: "g", guildOnly: true, permissions: ["ManageGuild"] } } }];
    const dm = await run([route("command", "mod warn", definition)], { kind: "command", commandName: "mod", subcommand: "warn" }, { extra: { groups } });
    expect(text(dm.recording.replies[0])).toContain("only be used in a server");
    const member = moderator(["SendMessages"]);
    const denied = await run(
      [route("command", "mod warn", definition)],
      { kind: "command", commandName: "mod", subcommand: "warn", guild: member.guild, member },
      { extra: { groups } },
    );
    expect(text(denied.recording.replies[0])).toContain("Manage Guild");
  });
});

describe("cooldown", () => {
  test("rejects a second use with a relative timestamp, per user and route", async () => {
    const definition = defineCommand({ description: "d", cooldown: "1h", ephemeral: false, execute: () => "ok" });
    const other = defineCommand({ description: "d", cooldown: "1h", execute: () => "other" });
    const harness = createHarness({
      manifest: manifestOf([route("command", "x", definition), route("command", "y", other)]),
    });
    const user = mockUser();
    const fire = async (commandName: string, by = user) => {
      const interaction = createFakeInteraction({ kind: "command", commandName, user: by }) as Interaction & {
        recording: Recording;
      };
      await harness.dispatch(interaction);
      return interaction.recording;
    };

    expect(text((await fire("x")).replies[0])).toBe("ok");
    const second = await fire("x");
    expect(text(second.replies[0])).toMatch(/cooldown.*<t:\d+:R>/);
    expect(ephemeral(second.replies[0])).toBe(true);
    expect(text((await fire("x", mockUser())).replies[0])).toBe("ok");
    expect(text((await fire("y")).replies[0])).toBe("other");
    await harness.close();
  });

  test("a middleware denial does not consume the cooldown", async () => {
    let allow = false;
    const gate = defineMiddleware(async (_ctx, next) => {
      if (!allow) return "denied";
      await next();
    });
    const definition = defineCommand({ description: "d", cooldown: "1h", execute: () => "ok" });
    const harness = createHarness({
      manifest: manifestOf([route("command", "x", definition, { middleware: [mod("g.ts", gate)] })]),
    });
    const user = mockUser();
    const fire = async () => {
      const interaction = createFakeInteraction({ kind: "command", commandName: "x", user }) as Interaction & {
        recording: Recording;
      };
      await harness.dispatch(interaction);
      return text(interaction.recording.replies[0]);
    };
    expect(await fire()).toBe("denied");
    allow = true;
    expect(await fire()).toBe("ok");
    expect(await fire()).toContain("cooldown");
    await harness.close();
  });

  test("works for buttons", async () => {
    const definition = defineButton("core/x", { cooldown: "1h", execute: () => "ok" });
    const harness = createHarness({ manifest: manifestOf([route("button", "core/x", definition)]) });
    const user = mockUser();
    const fire = async () => {
      const interaction = createFakeInteraction({ kind: "button", customId: "core/x", user }) as Interaction & {
        recording: Recording;
      };
      await harness.dispatch(interaction);
      return interaction.recording;
    };
    expect(text((await fire()).updates[0])).toBe("ok");
    expect(text((await fire()).replies[0])).toContain("cooldown");
    await harness.close();
  });
});

describe("features", () => {
  test("disabled features contribute no routes", async () => {
    const result = await run(
      [route("command", "x", command(() => "ran"), { feature: "off" })],
      { kind: "command", commandName: "x" },
      { extra: { features: [{ name: "off", module: { default: defineFeature({ enabled: false }) } }] } },
    );
    expect(text(result.recording.replies[0])).toContain("no longer available");
  });

  test("the app context reaches handlers", async () => {
    const definition = command((ctx) => String((ctx.app as Record<string, unknown>).db));
    const result = await run([route("command", "x", definition)], { kind: "command", commandName: "x" }, { app: { db: "pg" } });
    expect(text(result.recording.replies[0])).toBe("pg");
  });

  test("ctx.shards falls back to the local client", async () => {
    const definition = command(async (ctx) => {
      const ids = await ctx.shards.broadcastEval((_client, context) => context.n + 1, { context: { n: 1 } });
      const names = await ctx.shards.fetchClientValues<string>("user.username");
      return `${ctx.shards.id} ${ctx.shards.count} ${ctx.shards.ids.join()} ${ids.join()} ${names.join()}`;
    });
    const result = await run([route("command", "x", definition)], { kind: "command", commandName: "x" });
    expect(text(result.recording.replies[0])).toBe("0 1 0 2 neocord-test-bot");
  });
});
