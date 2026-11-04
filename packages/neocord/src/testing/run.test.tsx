import { describe, expect, expectTypeOf, test } from "bun:test";
import { ActionRow, Button, Label, TextDisplay, TextInput } from "@neocord/react";
import { ChannelType, MessageFlags, type Guild, type GuildMember, type Role, type TextChannel, type User } from "discord.js";
import type { ReactNode } from "react";
import {
  defineButton,
  defineCommand,
  defineEvent,
  defineMessageCommand,
  defineMiddleware,
  defineModal,
  defineSelect,
  defineTask,
  defineUserCommand,
  option,
  useContext,
} from "../index.ts";
import type { ErrorProps, LayoutProps } from "../types.ts";
import {
  mockChannel,
  mockGuild,
  mockMember,
  mockMessage,
  mockRole,
  mockUser,
  renderModalOf,
  runButton,
  runCommand,
  runEvent,
  runMessageCommand,
  runModal,
  runSelect,
  runTask,
  runUserCommand,
  type TestResult,
} from "./index.ts";

describe("mocks are real discord.js structures", () => {
  test("mockUser", () => {
    const user = mockUser({ username: "ada", globalName: "Ada" });
    expectTypeOf(user).toEqualTypeOf<User>();
    expect(user.username).toBe("ada");
    expect(user.displayName).toBe("Ada");
    expect(user.toString()).toBe(`<@${user.id}>`);
    expect(mockUser({ id: "1", username: "same" }).id).toBe("1");
  });

  test("mockGuild has an everyone role", () => {
    const guild = mockGuild({ name: "Lab" });
    expectTypeOf(guild).toEqualTypeOf<Guild>();
    expect(guild.name).toBe("Lab");
    expect(guild.roles.everyone.name).toBe("@everyone");
  });

  test("mockRole computes permissions", () => {
    const role = mockRole({ name: "mods", permissions: ["BanMembers"] });
    expectTypeOf(role).toEqualTypeOf<Role>();
    expect(role.permissions.has("BanMembers")).toBe(true);
    expect(role.permissions.has("KickMembers")).toBe(false);
  });

  test("mockMember computes permissions from roles", () => {
    const guild = mockGuild();
    const member = mockMember({ guild, nickname: "nick", permissions: ["KickMembers"] });
    expectTypeOf(member).toEqualTypeOf<GuildMember>();
    expect(member.guild).toBe(guild);
    expect(member.displayName).toBe("nick");
    expect(member.permissions.has("KickMembers")).toBe(true);
    expect(member.permissions.has("BanMembers")).toBe(false);
  });

  test("mockChannel narrows by type", () => {
    const channel = mockChannel({ name: "general" });
    expectTypeOf(channel).toEqualTypeOf<TextChannel>();
    expect(channel.name).toBe("general");
    expect(channel.isTextBased()).toBe(true);
    const voice = mockChannel({ type: ChannelType.GuildVoice });
    expect(voice.isVoiceBased()).toBe(true);
  });
});

describe("runCommand", () => {
  const ping = defineCommand({
    description: "Ping",
    options: { message: option.string({ description: "Text", required: true }) },
    execute: (ctx) => <TextDisplay>{ctx.options.message}</TextDisplay>,
  });

  test("resolves replies and flattened text", async () => {
    const result = await runCommand(ping, { options: { message: "hello" } });
    expectTypeOf(result).toEqualTypeOf<TestResult>();
    expect(result.replies).toHaveLength(1);
    expect(JSON.stringify(result.replies[0])).toContain("hello");
    expect(result.text).toBe("hello");
    expect(result.ephemeral).toBe(false);
    expect(result.deferred).toBe(false);
    expect(result.error).toBeNull();
  });

  test("a missing required option is reported like production", async () => {
    const result = await runCommand(ping);
    expect(result.text).toContain('"message" option could not be resolved');
    expect(result.ephemeral).toBe(true);
  });

  test("reports errors and uses the error view", async () => {
    const broken = defineCommand({
      description: "d",
      execute: () => {
        throw new Error("boom");
      },
    });
    const fallback = await runCommand(broken);
    expect((fallback.error as Error).message).toBe("boom");
    expect(fallback.text).toContain("Something went wrong");

    function ErrorView({ error }: ErrorProps): ReactNode {
      return <TextDisplay>{`custom ${(error as Error).message}`}</TextDisplay>;
    }
    const custom = await runCommand(broken, { error: ErrorView });
    expect(custom.text).toBe("custom boom");
    expect(custom.ephemeral).toBe(true);
  });

  test("runs middleware and layouts", async () => {
    const order: string[] = [];
    const definition = defineCommand({
      description: "d",
      execute: () => {
        order.push("handler");
        return <TextDisplay>body</TextDisplay>;
      },
    });
    function Layout({ children }: LayoutProps): ReactNode {
      return (
        <>
          <TextDisplay>layout</TextDisplay>
          {children}
        </>
      );
    }
    const trace = defineMiddleware(async (_ctx, next) => {
      order.push("before");
      await next();
      order.push("after");
    });
    const result = await runCommand(definition, { middleware: [trace], layouts: [Layout] });
    expect(order).toEqual(["before", "handler", "after"]);
    expect(result.text).toBe("layout\nbody");

    const denied = await runCommand(definition, { middleware: [defineMiddleware(() => "no")] });
    expect(denied.text).toBe("no");

    const narrowed = defineMiddleware(() => "buttons only", { kinds: ["button"] });
    expect((await runCommand(definition, { middleware: [narrowed] })).text).toBe("body");
  });

  test("guildOnly auto-creates a guild, an explicit null proves rejection", async () => {
    const guarded = defineCommand({
      description: "d",
      guildOnly: true,
      execute: (ctx) => `guild ${ctx.guild.id === ctx.member.guild.id}`,
    });
    expect((await runCommand(guarded)).text).toBe("guild true");
    const rejected = await runCommand(guarded, { guild: null });
    expect(rejected.text).toContain("only be used in a server");
    expect(rejected.ephemeral).toBe(true);
  });

  test("permissions default to granted, explicit members prove denial", async () => {
    const guarded = defineCommand({ description: "d", permissions: ["BanMembers"], execute: () => "ok" });
    expect((await runCommand(guarded)).text).toBe("ok");
    const denied = await runCommand(guarded, { member: mockMember({ permissions: ["SendMessages"] }) });
    expect(denied.text).toContain("Ban Members");
  });

  test("passes app, user and member through", async () => {
    const user = mockUser({ username: "ada" });
    const definition = defineCommand({
      description: "d",
      execute: (ctx) => `${ctx.user.username} ${(ctx.app as Record<string, unknown>).db}`,
    });
    expect((await runCommand(definition, { user, app: { db: "pg" } })).text).toBe("ada pg");
  });

  test("records defers, edits and follow ups", async () => {
    const definition = defineCommand({
      description: "d",
      async execute(ctx) {
        await ctx.defer({ ephemeral: true });
        await ctx.editReply("edited");
        await ctx.followUp("after");
      },
    });
    const result = await runCommand(definition);
    expect(result.deferred).toBe(true);
    expect(result.ephemeral).toBe(true);
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]?.flags).toBe(MessageFlags.IsComponentsV2);
    expect(result.followUps).toHaveLength(1);
    expect(result.text).toBe("edited\nafter");
  });

  test("records a modal shown by showModal", async () => {
    const modal = defineModal("core/ask/[id]", {
      title: "Ask",
      render: ({ field }) => (
        <Label label="Why">
          <TextInput customId={field("why")} />
        </Label>
      ),
      submit: () => "x",
    });
    const definition = defineCommand({
      description: "d",
      async execute(ctx) {
        await ctx.showModal("core/ask/[id]", { id: 5 });
      },
    });
    const result = await runCommand(definition, { modals: [modal] });
    expect(result.modal?.custom_id).toBe("core/ask/5");
  });

  test("autoDefer can be exercised", async () => {
    const slow = defineCommand({
      description: "d",
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return "slow";
      },
    });
    const result = await runCommand(slow, { autoDeferAfter: 3 });
    expect(result.deferred).toBe(true);
    expect(result.edits).toHaveLength(1);
    expect(result.replies).toEqual([]);
  });

  test("live trees render and clean up", async () => {
    const definition = defineCommand({
      description: "d",
      execute: () => (
        <ActionRow>
          <Button label="x" onClick={() => undefined} />
        </ActionRow>
      ),
    });
    const result = await runCommand(definition);
    expect(JSON.stringify(result.replies[0])).toMatch(/"custom_id":"~[0-9a-f]{16}:0"/);
  });
});

describe("runUserCommand and runMessageCommand", () => {
  test("provide targets", async () => {
    const user = await runUserCommand(
      defineUserCommand({ name: "Report", execute: (ctx) => ctx.target.username }),
      { target: mockUser({ username: "bad" }) },
    );
    expect(user.text).toBe("bad");

    const message = await runMessageCommand(
      defineMessageCommand({ name: "Quote", execute: (ctx) => ctx.target.id }),
      { target: mockMessage({ id: "9" }) },
    );
    expect(message.text).toBe("9");
  });
});

describe("runButton and runSelect", () => {
  const button = defineButton("core/confirm/[userId]", { execute: (ctx) => `user ${ctx.params.userId}` });

  test("params build the custom id", async () => {
    const result = await runButton(button, { params: { userId: 12 } });
    expect(result.updates).toHaveLength(1);
    expect(result.text).toBe("user 12");
  });

  test("a raw customId works too", async () => {
    expect((await runButton(button, { customId: "core/confirm/abc" })).text).toBe("user abc");
  });

  test("missing params are a clear error", async () => {
    await expect(runButton(button)).rejects.toThrow('missing a value for param "userId"');
  });

  test("returning nothing is a deferred update", async () => {
    const quiet = defineButton("core/quiet", { execute: () => undefined });
    expect((await runButton(quiet)).deferredUpdate).toBe(true);
  });

  test("string selects", async () => {
    const select = defineSelect("core/pick", { execute: (ctx) => ctx.values.join() });
    expect((await runSelect(select, { values: ["a", "b"] })).text).toBe("a,b");
  });

  test("role selects get collections", async () => {
    const role = mockRole({ name: "mods" });
    const select = defineSelect("core/roles", { type: "role", execute: (ctx) => String(ctx.roles.has(role.id)) });
    expect((await runSelect(select, { values: [role.id], roles: [role] })).text).toBe("true");
  });

  test("user and channel selects", async () => {
    const user = mockUser();
    const users = defineSelect("core/users", { type: "user", execute: (ctx) => String(ctx.users.size) });
    expect((await runSelect(users, { values: [user.id], users: [user] })).text).toBe("1");
    const channel = mockChannel();
    const channels = defineSelect("core/channels", { type: "channel", execute: (ctx) => String(ctx.channels.size) });
    expect((await runSelect(channels, { values: [channel.id], channels: [channel] })).text).toBe("1");
  });
});

describe("runModal and renderModalOf", () => {
  const modal = defineModal("core/ban/[userId]", {
    title: ({ params }) => `Ban ${params.userId}`,
    render: ({ field }) => (
      <Label label="Reason">
        <TextInput customId={field("reason")} />
      </Label>
    ),
    submit: (ctx) => `${ctx.params.userId} ${String(ctx.values.reason)}`,
  });

  test("submits values", async () => {
    const result = await runModal(modal, { params: { userId: 1 }, values: { reason: "spam" } });
    expect(result.text).toBe("1 spam");
  });

  test("renderModalOf renders through the same code", () => {
    const rendered = renderModalOf(modal, { params: { userId: 1 } });
    expect(rendered.custom_id).toBe("core/ban/1");
    expect(rendered.title).toBe("Ban 1");
    expect(rendered.components).toHaveLength(1);
    expect(JSON.stringify(rendered)).toContain('"custom_id":"reason"');
  });

  test("useContext works during renderModalOf, matching production", () => {
    function View(): ReactNode {
      const ctx = useContext();
      return <TextDisplay>{`${ctx.route} ${ctx.user.username}`}</TextDisplay>;
    }
    const withContext = defineModal("core/ctx", { title: "t", render: () => <View />, submit: () => "x" });
    const rendered = renderModalOf(withContext, { user: mockUser({ username: "ada" }) });
    expect(JSON.stringify(rendered)).toContain("core/ctx ada");
  });
});

describe("runEvent and runTask", () => {
  test("events get typed args and errors are captured", async () => {
    const member = mockMember();
    let seen: GuildMember | null = null;
    const event = defineEvent("guildMemberAdd", {
      execute(_ctx, added) {
        seen = added;
      },
    });
    expect((await runEvent(event, [member])).error).toBeNull();
    expect(seen).toBe(member as never);

    const broken = defineEvent("guildMemberAdd", {
      execute() {
        throw new Error("event broke");
      },
    });
    expect(((await runEvent(broken, [member])).error as Error).message).toBe("event broke");
  });

  test("tasks run once with the app and errors are captured", async () => {
    let db: unknown;
    const task = defineTask({
      every: "1d",
      execute(ctx) {
        db = (ctx.app as Record<string, unknown>).db;
      },
    });
    expect((await runTask(task, { app: { db: "pg" } })).error).toBeNull();
    expect(db).toBe("pg");

    const broken = defineTask({
      every: "1d",
      execute() {
        throw new Error("task broke");
      },
    });
    expect(((await runTask(broken)).error as Error).message).toBe("task broke");
  });
});
