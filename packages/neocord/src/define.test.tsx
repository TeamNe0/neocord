import { describe, expect, expectTypeOf, test } from "bun:test";
import type { RouteParamsRecord } from "@neocord/react";
import {
  ChannelType,
  type Attachment,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Collection,
  type Guild,
  type GuildMember,
  type Message,
  type ModalSubmitFields,
  type Role,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
  type User,
  type VoiceChannel,
} from "discord.js";
import {
  defineButton,
  defineCommand,
  defineConfig,
  defineContext,
  defineEvent,
  defineFeature,
  defineGroup,
  defineMessageCommand,
  defineMiddleware,
  defineModal,
  defineSelect,
  defineTask,
  defineUserCommand,
  option,
  parseDuration,
  useContext,
  type AnyContext,
  type AppContext,
  type ButtonContext,
  type CommandContext,
  type ContextForKind,
  type DefaultModalValues,
  type EventContext,
  type InferAppContext,
  type InferOption,
  type InteractionKind,
  type Manifest,
  type MiddlewareContextForKind,
  type ModalContext,
  type ModalRenderContext,
  type ModuleNamespace,
  type ShowModalArgs,
  type ShowModalMethod,
  type StandardSchemaV1,
} from "./index.ts";

function schemaOf<Input, Output>(
  validate: (value: unknown) => StandardSchemaV1.Result<Output>,
): StandardSchemaV1<Input, Output> {
  return { "~standard": { version: 1, vendor: "test", validate } };
}

describe("define helpers", () => {
  test("add a brand and keep the definition", () => {
    const execute = () => undefined;
    expect(defineCommand({ description: "d", execute }).__neocord).toBe("command");
    expect(defineUserCommand({ name: "n", execute }).__neocord).toBe("user-command");
    expect(defineMessageCommand({ name: "n", execute }).__neocord).toBe("message-command");
    expect(defineGroup({ description: "d" }).__neocord).toBe("group");
    expect(defineFeature({ enabled: false })).toEqual({ __neocord: "feature", enabled: false });
    expect(defineTask({ every: "5m", execute }).__neocord).toBe("task");
    expect(defineConfig({ intents: ["Guilds"] })).toEqual({ __neocord: "config", intents: ["Guilds"] });
  });

  test("store route literals", () => {
    const execute = () => undefined;
    const button = defineButton("mod/confirm/[id]", { execute });
    expect(button.__neocord).toBe("button");
    expect(button.route).toBe("mod/confirm/[id]");
    expect(defineSelect("mod/pick", { type: "role", execute }).route).toBe("mod/pick");
    expect(defineEvent("clientReady", { execute }).event).toBe("clientReady");
    const modal = defineModal("mod/reason", { title: "t", render: () => null, submit: execute });
    expect(modal.route).toBe("mod/reason");
  });

  test("defineMiddleware and defineContext wrap functions", async () => {
    const handler = () => undefined;
    const middleware = defineMiddleware(handler, { kinds: ["command"] });
    expect(middleware).toEqual({ __neocord: "middleware", handler, kinds: ["command"] });
    const context = defineContext(async () => ({ value: { db: 1 } }));
    expect(context.__neocord).toBe("context");
    expect((await context.factory({ client: null as never, logger: null as never })).value.db).toBe(1);
  });

  test("option helpers keep their config", () => {
    expect(option.string({ description: "d", required: true, maxLength: 5 })).toEqual({
      __neocord: "option",
      kind: "string",
      description: "d",
      required: true,
      maxLength: 5,
    });
    expect(option.member({ description: "d" }).kind).toBe("member");
    expect(option.channel({ description: "d", channelTypes: [ChannelType.GuildText] }).channelTypes).toEqual([
      ChannelType.GuildText,
    ]);
  });

  test("useContext is exported as a function and parseDuration works from the main entry", () => {
    expect(typeof useContext).toBe("function");
    expect(parseDuration("1h30m")).toBe(5_400_000);
  });
});

describe("option inference", () => {
  test("string options", () => {
    const required = option.string({ description: "d", required: true });
    expectTypeOf<InferOption<typeof required>>().toEqualTypeOf<string>();

    const optional = option.string({ description: "d" });
    expectTypeOf<InferOption<typeof optional>>().toEqualTypeOf<string | undefined>();

    const explicitFalse = option.string({ description: "d", required: false });
    expectTypeOf<InferOption<typeof explicitFalse>>().toEqualTypeOf<string | undefined>();
  });

  test("choices infer literal unions without as const", () => {
    const strings = option.string({
      description: "d",
      required: true,
      choices: [
        { name: "A", value: "a" },
        { name: "B", value: "b" },
      ],
    });
    expectTypeOf<InferOption<typeof strings>>().toEqualTypeOf<"a" | "b">();

    const numbers = option.integer({ description: "d", choices: [{ name: "One", value: 1 }] });
    expectTypeOf<InferOption<typeof numbers>>().toEqualTypeOf<1 | undefined>();

    const decimals = option.number({ description: "d", required: true, choices: [{ name: "Half", value: 0.5 }] });
    expectTypeOf<InferOption<typeof decimals>>().toEqualTypeOf<0.5>();
  });

  test("resolved discord.js types", () => {
    const user = option.user({ description: "d", required: true });
    expectTypeOf<InferOption<typeof user>>().toEqualTypeOf<User>();
    const member = option.member({ description: "d", required: true });
    expectTypeOf<InferOption<typeof member>>().toEqualTypeOf<GuildMember>();
    const role = option.role({ description: "d" });
    expectTypeOf<InferOption<typeof role>>().toEqualTypeOf<Role | undefined>();
    const attachment = option.attachment({ description: "d", required: true });
    expectTypeOf<InferOption<typeof attachment>>().toEqualTypeOf<Attachment>();
    const mentionable = option.mentionable({ description: "d", required: true });
    expectTypeOf<InferOption<typeof mentionable>>().toEqualTypeOf<User | GuildMember | Role>();
    const bool = option.boolean({ description: "d", required: true });
    expectTypeOf<InferOption<typeof bool>>().toEqualTypeOf<boolean>();
  });

  test("channelTypes narrows the channel type", () => {
    const text = option.channel({ description: "d", required: true, channelTypes: [ChannelType.GuildText] });
    expectTypeOf<InferOption<typeof text>>().toEqualTypeOf<TextChannel>();

    const either = option.channel({
      description: "d",
      required: true,
      channelTypes: [ChannelType.GuildText, ChannelType.GuildVoice],
    });
    expectTypeOf<InferOption<typeof either>>().toEqualTypeOf<TextChannel | VoiceChannel>();
  });
});

describe("handler inference", () => {
  test("defineCommand exposes typed options and interaction", () => {
    const command = defineCommand({
      description: "Ban",
      options: {
        user: option.user({ description: "who", required: true }),
        reason: option.string({ description: "why" }),
        days: option.integer({ description: "days", choices: [{ name: "One", value: 1 }] }),
      },
      execute(ctx) {
        expectTypeOf(ctx.options.user).toEqualTypeOf<User>();
        expectTypeOf(ctx.options.reason).toEqualTypeOf<string | undefined>();
        expectTypeOf(ctx.options.days).toEqualTypeOf<1 | undefined>();
        expectTypeOf(ctx.guild).toEqualTypeOf<Guild | null>();
        expectTypeOf(ctx.member).toEqualTypeOf<GuildMember | null>();
        expectTypeOf(ctx.user).toEqualTypeOf<User>();
        expectTypeOf(ctx.interaction).toEqualTypeOf<ChatInputCommandInteraction>();
        expectTypeOf(ctx.app).toEqualTypeOf<AppContext>();
        return "ok";
      },
    });
    expect(command.options?.user.required).toBe(true);
  });

  test("guildOnly narrows guild and member", () => {
    defineCommand({
      description: "Ban",
      guildOnly: true,
      execute(ctx) {
        expectTypeOf(ctx.guild).toEqualTypeOf<Guild>();
        expectTypeOf(ctx.member).toEqualTypeOf<GuildMember>();
        expectTypeOf(ctx.interaction).toEqualTypeOf<ChatInputCommandInteraction<"cached">>();
      },
    });
    defineButton("a/b", {
      guildOnly: true,
      execute(ctx) {
        expectTypeOf(ctx.guild).toEqualTypeOf<Guild>();
        expectTypeOf(ctx.member).toEqualTypeOf<GuildMember>();
      },
    });
    defineUserCommand({
      name: "Report",
      guildOnly: true,
      execute(ctx) {
        expectTypeOf(ctx.target).toEqualTypeOf<User>();
        expectTypeOf(ctx.targetMember).toEqualTypeOf<GuildMember | null>();
      },
    });
    defineUserCommand({
      name: "Report",
      execute(ctx) {
        expectTypeOf(ctx.targetMember).toEqualTypeOf<GuildMember | null>();
      },
    });
    defineMessageCommand({
      name: "Quote",
      execute(ctx) {
        expectTypeOf(ctx.target).toEqualTypeOf<Message>();
      },
    });
  });

  test("button params come from the route literal", () => {
    defineButton("moderation/confirm-ban/[userId]", {
      execute(ctx) {
        expectTypeOf(ctx.params).toEqualTypeOf<{ userId: string }>();
        expectTypeOf(ctx.interaction).toEqualTypeOf<ButtonInteraction>();
        expectTypeOf(ctx.message).toEqualTypeOf<Message>();
      },
    });
    defineButton("a/[first]/[...rest]", {
      execute(ctx) {
        expectTypeOf(ctx.params).toEqualTypeOf<{ first: string; rest: string[] }>();
      },
    });
    defineButton("a/plain", {
      execute(ctx) {
        expectTypeOf(ctx.params).toEqualTypeOf<{}>();
      },
    });
  });

  test("select contexts match their type", () => {
    defineSelect("a/roles", {
      type: "role",
      execute(ctx) {
        expectTypeOf(ctx.values).toEqualTypeOf<string[]>();
        expectTypeOf(ctx.interaction).toEqualTypeOf<RoleSelectMenuInteraction>();
        expectTypeOf(ctx.roles).toEqualTypeOf<RoleSelectMenuInteraction["roles"]>();
        expectTypeOf(ctx.roles).toExtend<Collection<string, unknown>>();
      },
    });
    defineSelect("a/strings/[id]", {
      execute(ctx) {
        expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
        expectTypeOf(ctx.interaction).toEqualTypeOf<StringSelectMenuInteraction>();
      },
    });
    defineSelect("a/mentionable", {
      type: "mentionable",
      execute(ctx) {
        expectTypeOf(ctx).toHaveProperty("roles");
        expectTypeOf(ctx).toHaveProperty("users");
        expectTypeOf(ctx).toHaveProperty("members");
      },
    });
  });

  test("modal schema drives field names and values", () => {
    const schema = schemaOf<{ reason: string; age?: string }, { reason: string; age: number }>((value) => ({
      value: value as { reason: string; age: number },
    }));
    defineModal("mod/reason/[userId]", {
      title: ({ params }) => {
        expectTypeOf(params).toEqualTypeOf<{ userId: string }>();
        return "t";
      },
      schema,
      render({ params, field }) {
        expectTypeOf(params.userId).toEqualTypeOf<string>();
        expectTypeOf(field).parameter(0).toEqualTypeOf<"reason" | "age">();
        return field("reason");
      },
      submit(ctx) {
        expectTypeOf(ctx.params.userId).toEqualTypeOf<string>();
        expectTypeOf(ctx.values).toEqualTypeOf<{ reason: string; age: number }>();
        expectTypeOf(ctx.fields).toEqualTypeOf<ModalSubmitFields>();
        expectTypeOf(ctx).not.toHaveProperty("showModal");
      },
    });
  });

  test("modal without schema gets the default values", () => {
    defineModal("mod/plain", {
      title: "t",
      render({ field }) {
        expectTypeOf(field).parameter(0).toEqualTypeOf<string>();
        return null;
      },
      submit(ctx) {
        expectTypeOf(ctx.values).toEqualTypeOf<DefaultModalValues>();
      },
    });
    expectTypeOf<ModalRenderContext<"a">["params"]>().toEqualTypeOf<{}>();
    expectTypeOf<ModalContext["kind"]>().toEqualTypeOf<"modal">();
  });

  test("events take their arguments from ClientEvents", () => {
    defineEvent("guildMemberAdd", {
      execute(ctx, member) {
        expectTypeOf(ctx).toEqualTypeOf<EventContext>();
        expectTypeOf(member).toEqualTypeOf<GuildMember>();
      },
    });
    defineEvent("roleUpdate", {
      async execute(_ctx, oldRole, newRole) {
        expectTypeOf(oldRole).toEqualTypeOf<Role>();
        expectTypeOf(newRole).toEqualTypeOf<Role>();
      },
    });
  });

  test("defineContext infers sync and async factories", () => {
    const asyncContext = defineContext(async () => ({ value: { db: "postgres" }, dispose: () => undefined }));
    expectTypeOf<InferAppContext<typeof asyncContext>>().toEqualTypeOf<{ db: string }>();
    const syncContext = defineContext(() => ({ value: { cache: 1 } }));
    expectTypeOf<InferAppContext<typeof syncContext>>().toEqualTypeOf<{ cache: number }>();
    expectTypeOf<InferAppContext<string>>().toEqualTypeOf<never>();
  });

  test("middleware context follows kinds", () => {
    defineMiddleware((ctx, next) => {
      expectTypeOf(ctx).toEqualTypeOf<MiddlewareContextForKind[InteractionKind]>();
      expectTypeOf(next).returns.toEqualTypeOf<Promise<void>>();
    });
    defineMiddleware(
      (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<Omit<ModalContext, "values">>();
        expectTypeOf(ctx).not.toHaveProperty("values");
        expectTypeOf(ctx).toHaveProperty("fields");
      },
      { kinds: ["modal"] },
    );
    defineMiddleware(
      (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<ContextForKind["command" | "button"]>();
      },
      { kinds: ["command", "button"] },
    );
    expectTypeOf<ContextForKind["button"]>().toEqualTypeOf<ButtonContext>();
    expectTypeOf<ContextForKind["command"]>().toEqualTypeOf<CommandContext>();
  });

  test("showModal params are required exactly when the route needs them", () => {
    expectTypeOf<ShowModalArgs<"mod/reason/[userId]">>().toEqualTypeOf<[params: { userId: string | number | bigint }]>();
    expectTypeOf<ShowModalArgs<"mod/plain">>().toEqualTypeOf<[params?: undefined]>();
    expectTypeOf<ShowModalArgs<string>>().toEqualTypeOf<[params?: RouteParamsRecord]>();
    type Routed = ShowModalMethod<"mod/reason/[userId]" | "mod/plain">;
    expectTypeOf<Parameters<Routed>[0]>().toEqualTypeOf<"mod/reason/[userId]" | "mod/plain">();
    defineButton("a/b", {
      async execute(ctx) {
        await ctx.showModal("mod/reason/[userId]", { userId: "1" });
        await ctx.showModal("mod/plain");
      },
    });
  });

  test("a module namespace fits the manifest", () => {
    const namespace = { helper: 1 };
    expectTypeOf(namespace).toExtend<ModuleNamespace>();
    expectTypeOf<{ default: () => void }>().toExtend<ModuleNamespace>();
    const manifest: Manifest = { version: 1, context: namespace, features: [], groups: [], routes: [] };
    expect(manifest.version).toBe(1);
  });
});
