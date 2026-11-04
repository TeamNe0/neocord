import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ActionRow, Button, Message, TextDisplay } from "@neocord/react";
import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ComponentType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  ModalSubmitInteraction,
  type Client,
  type Interaction,
} from "discord.js";
import { useState, type ReactNode } from "react";
import { defineButton, defineCommand, defineModal, option } from "../index.ts";
import type { Manifest, ManifestRoute } from "../types.ts";
import { testClient } from "./fakes.ts";
import { createHarness } from "./run.tsx";

interface RestCall {
  method: "post" | "patch" | "delete";
  route: string;
  body: { type?: number; data?: { flags?: number; components?: unknown[]; custom_id?: string }; flags?: number; components?: unknown[] };
}

type Restish = Record<"post" | "patch" | "delete", (route: string, options: { body: RestCall["body"] }) => Promise<unknown>>;

const USER = { id: "111111111111111111", username: "ada", discriminator: "0", global_name: null, avatar: null };

function baseRaw(type: InteractionType): Record<string, unknown> {
  return {
    id: "222222222222222222",
    application_id: "333333333333333333",
    token: "interaction-token",
    version: 1,
    type,
    user: USER,
    channel_id: "444444444444444444",
    locale: "en-US",
    app_permissions: "0",
    entitlements: [],
    authorizing_integration_owners: {},
    context: 1,
    attachment_size_limit: 1000,
  };
}

function route(kind: ManifestRoute["kind"], id: string, value: unknown): ManifestRoute {
  return {
    kind,
    id,
    feature: "core",
    file: `${id}.tsx`,
    segments: kind === "command" ? id.split(" ") : id.split("/").slice(1),
    module: { default: value },
    middleware: [],
    layouts: [],
    error: null,
    loading: null,
  };
}

function manifestOf(routes: ManifestRoute[]): Manifest {
  return { version: 1, context: null, features: [], groups: [], routes };
}

function construct<T>(Class: unknown, raw: unknown): T {
  const Constructor = Class as new (client: Client, data: unknown) => T;
  return new Constructor(testClient(), raw);
}

describe("real discord.js interaction classes", () => {
  let calls: RestCall[];
  let original: Restish;

  beforeEach(() => {
    calls = [];
    const rest = testClient().rest as unknown as Restish;
    original = { post: rest.post, patch: rest.patch, delete: rest.delete };
    for (const method of ["post", "patch", "delete"] as const) {
      rest[method] = async (path, options) => {
        calls.push({ method, route: path, body: options?.body });
        return { id: "555555555555555555", channel_id: "444444444444444444" };
      };
    }
  });

  afterEach(() => {
    Object.assign(testClient().rest, original);
  });

  test("a chat input command resolves real options and replies with components v2", async () => {
    const definition = defineCommand({
      description: "d",
      ephemeral: true,
      options: {
        who: option.user({ description: "d", required: true }),
        count: option.integer({ description: "d" }),
      },
      execute: (ctx) => <TextDisplay>{`${ctx.options.who.username} ${String(ctx.options.count)}`}</TextDisplay>,
    });
    const harness = createHarness({ manifest: manifestOf([route("command", "greet", definition)]) });
    const interaction = construct<Interaction>(ChatInputCommandInteraction, {
      ...baseRaw(InteractionType.ApplicationCommand),
      data: {
        id: "666666666666666666",
        name: "greet",
        type: 1,
        options: [{ name: "who", type: ApplicationCommandOptionType.User, value: USER.id }],
        resolved: { users: { [USER.id]: USER } },
      },
    });

    await harness.dispatch(interaction);
    await harness.close();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("post");
    expect(calls[0]?.route).toContain("/interactions/222222222222222222/interaction-token/callback");
    expect(calls[0]?.body.type).toBe(InteractionResponseType.ChannelMessageWithSource);
    expect(calls[0]?.body.data?.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
    expect(calls[0]?.body.data?.components).toEqual([{ type: ComponentType.TextDisplay, content: "ada undefined" }] as never);
    expect(harness.errors).toEqual([]);
  });

  test("subcommand groups route on the real option resolver", async () => {
    const definition = defineCommand({
      description: "d",
      options: { id: option.string({ description: "d", required: true }) },
      execute: (ctx) => `case ${ctx.options.id}`,
    });
    const harness = createHarness({ manifest: manifestOf([route("command", "mod case view", definition)]) });
    const interaction = construct<Interaction>(ChatInputCommandInteraction, {
      ...baseRaw(InteractionType.ApplicationCommand),
      data: {
        id: "666666666666666666",
        name: "mod",
        type: 1,
        options: [
          {
            name: "case",
            type: ApplicationCommandOptionType.SubcommandGroup,
            options: [
              {
                name: "view",
                type: ApplicationCommandOptionType.Subcommand,
                options: [{ name: "id", type: ApplicationCommandOptionType.String, value: "7" }],
              },
            ],
          },
        ],
      },
    });
    await harness.dispatch(interaction);
    await harness.close();
    expect(calls[0]?.body.data?.components).toEqual([{ type: ComponentType.TextDisplay, content: "case 7" }] as never);
  });

  test("an ephemeral payload is accepted by a real update and a real edit", async () => {
    const definition = defineButton("core/go", {
      async execute(ctx) {
        await ctx.deferUpdate();
        return (
          <Message ephemeral>
            <TextDisplay>after</TextDisplay>
          </Message>
        );
      },
    });
    const update = defineButton("core/up", {
      execute: () => (
        <Message ephemeral>
          <TextDisplay>updated</TextDisplay>
        </Message>
      ),
    });
    const harness = createHarness({
      manifest: manifestOf([route("button", "core/go", definition), route("button", "core/up", update)]),
    });
    const raw = (customId: string) => ({
      ...baseRaw(InteractionType.MessageComponent),
      data: { component_type: ComponentType.Button, custom_id: customId },
      message: {
        id: "777777777777777777",
        channel_id: "444444444444444444",
        author: USER,
        content: "",
        timestamp: new Date(0).toISOString(),
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: [],
        pinned: false,
        type: 0,
        flags: MessageFlags.IsComponentsV2,
        components: [],
      },
    });

    await harness.dispatch(construct<Interaction>(ButtonInteraction, raw("core/go")));
    expect(calls.map((call) => call.method)).toEqual(["post", "patch"]);
    expect(calls[0]?.body.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    expect(decodeURIComponent(calls[1]?.route ?? "")).toContain("/webhooks/333333333333333333/interaction-token/messages/@original");
    expect(calls[1]?.body.flags).toBe(MessageFlags.IsComponentsV2);

    calls.length = 0;
    await harness.dispatch(construct<Interaction>(ButtonInteraction, raw("core/up")));
    expect(calls[0]?.body.type).toBe(InteractionResponseType.UpdateMessage);
    expect(calls[0]?.body.data?.flags).toBe(MessageFlags.IsComponentsV2);
    expect(harness.errors).toEqual([]);
    await harness.close();
  });

  describe("a route on a message sent without Components V2", () => {
    const plainMessage = {
      id: "777777777777777777",
      channel_id: "444444444444444444",
      author: USER,
      content: "Close this ticket?",
      timestamp: new Date(0).toISOString(),
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [{ title: "Ticket" }],
      pinned: false,
      type: 0,
      flags: 0,
      components: [],
    };

    test("a real update serialises the fields Discord requires cleared", async () => {
      const definition = defineButton("core/close", { execute: () => <TextDisplay>closed</TextDisplay> });
      const harness = createHarness({ manifest: manifestOf([route("button", "core/close", definition)]) });
      await harness.dispatch(
        construct<Interaction>(ButtonInteraction, {
          ...baseRaw(InteractionType.MessageComponent),
          data: { component_type: ComponentType.Button, custom_id: "core/close" },
          message: plainMessage,
        }),
      );
      await harness.close();
      expect(harness.errors).toEqual([]);
      const data = calls[0]?.body.data as { content?: unknown; embeds?: unknown; flags?: number };
      expect(calls[0]?.body.type).toBe(InteractionResponseType.UpdateMessage);
      expect(data.content).toBe("");
      expect(data.embeds).toEqual([]);
      expect(data.flags).toBe(MessageFlags.IsComponentsV2);
    });

    test("a real edit after a deferred update serialises them too", async () => {
      const definition = defineButton("core/close", {
        async execute(ctx) {
          await ctx.deferUpdate();
          return <TextDisplay>closed</TextDisplay>;
        },
      });
      const harness = createHarness({ manifest: manifestOf([route("button", "core/close", definition)]) });
      await harness.dispatch(
        construct<Interaction>(ButtonInteraction, {
          ...baseRaw(InteractionType.MessageComponent),
          data: { component_type: ComponentType.Button, custom_id: "core/close" },
          message: plainMessage,
        }),
      );
      await harness.close();
      expect(harness.errors).toEqual([]);
      const body = calls[1]?.body as { content?: unknown; embeds?: unknown; flags?: number };
      expect(calls[1]?.method).toBe("patch");
      expect(body.content).toBe("");
      expect(body.embeds).toEqual([]);
      expect(body.flags).toBe(MessageFlags.IsComponentsV2);
    });

    test("a real modal update serialises them too", async () => {
      const modal = defineModal("core/close", {
        title: "t",
        respond: "update",
        render: () => null,
        submit: () => <TextDisplay>closed</TextDisplay>,
      });
      const harness = createHarness({ manifest: manifestOf([route("modal", "core/close", modal)]) });
      await harness.dispatch(
        construct<Interaction>(ModalSubmitInteraction, {
          ...baseRaw(InteractionType.ModalSubmit),
          data: { custom_id: "core/close", components: [] },
          message: plainMessage,
        }),
      );
      await harness.close();
      expect(harness.errors).toEqual([]);
      const data = calls[0]?.body.data as { content?: unknown; embeds?: unknown; flags?: number };
      expect(calls[0]?.body.type).toBe(InteractionResponseType.UpdateMessage);
      expect(data.content).toBe("");
      expect(data.embeds).toEqual([]);
    });

    test("a source with the flag sends no content or embeds", async () => {
      const definition = defineButton("core/close", { execute: () => <TextDisplay>closed</TextDisplay> });
      const harness = createHarness({ manifest: manifestOf([route("button", "core/close", definition)]) });
      await harness.dispatch(
        construct<Interaction>(ButtonInteraction, {
          ...baseRaw(InteractionType.MessageComponent),
          data: { component_type: ComponentType.Button, custom_id: "core/close" },
          message: { ...plainMessage, content: "", embeds: [], flags: MessageFlags.IsComponentsV2 },
        }),
      );
      await harness.close();
      const data = calls[0]?.body.data as { content?: unknown; embeds?: unknown };
      expect(data.content).toBeUndefined();
      expect(data.embeds).toBeUndefined();
    });
  });

  test("a live click on a real button updates through the real API", async () => {
    function Counter(): ReactNode {
      const [count, setCount] = useState(0);
      return (
        <>
          <TextDisplay>{`count ${count}`}</TextDisplay>
          <ActionRow>
            <Button label="add" onClick={(interaction) => setCount(interaction.customId.length > 0 ? count + 1 : count)} />
          </ActionRow>
        </>
      );
    }
    const definition = defineCommand({ description: "d", execute: () => <Counter /> });
    const harness = createHarness({ manifest: manifestOf([route("command", "live", definition)]) });
    await harness.dispatch(
      construct<Interaction>(ChatInputCommandInteraction, {
        ...baseRaw(InteractionType.ApplicationCommand),
        data: { id: "666666666666666666", name: "live", type: 1 },
      }),
    );
    const replied = JSON.stringify(calls[0]?.body);
    const customId = /"custom_id":"(~[^"]+)"/.exec(replied)?.[1] ?? "";
    expect(customId).not.toBe("");
    calls.length = 0;

    await harness.dispatch(
      construct<Interaction>(ButtonInteraction, {
        ...baseRaw(InteractionType.MessageComponent),
        data: { component_type: ComponentType.Button, custom_id: customId },
        message: {
          id: "777777777777777777",
          channel_id: "444444444444444444",
          author: USER,
          content: "",
          timestamp: new Date(0).toISOString(),
          edited_timestamp: null,
          tts: false,
          mention_everyone: false,
          mentions: [],
          mention_roles: [],
          attachments: [],
          embeds: [],
          pinned: false,
          type: 0,
          flags: MessageFlags.IsComponentsV2,
          components: [],
        },
      }),
    );
    expect(calls[0]?.body.type).toBe(InteractionResponseType.UpdateMessage);
    expect(JSON.stringify(calls[0]?.body)).toContain("count 1");
    await harness.close();
  });

  test("Label wrapped modal components of every kind are read", async () => {
    let values: unknown;
    let files = 0;
    const modal = defineModal("core/form/[id]", {
      title: "t",
      render: () => null,
      submit(ctx) {
        values = ctx.values;
        files = ctx.fields.getUploadedFiles("upload")?.size ?? 0;
        return `id ${ctx.params.id}`;
      },
    });
    const harness = createHarness({ manifest: manifestOf([route("modal", "core/form/[id]", modal)]) });
    const attachment = {
      id: "888888888888888888",
      filename: "a.png",
      size: 1,
      url: "https://cdn.example/a.png",
      proxy_url: "https://cdn.example/a.png",
    };
    const label = (id: number, component: Record<string, unknown>) => ({ type: ComponentType.Label, id, component });
    const interaction = construct<Interaction>(ModalSubmitInteraction, {
      ...baseRaw(InteractionType.ModalSubmit),
      data: {
        custom_id: "core/form/9",
        resolved: { attachments: { [attachment.id]: attachment } },
        components: [
          label(1, { type: ComponentType.TextInput, id: 11, custom_id: "text", value: "hello" }),
          label(2, { type: ComponentType.TextInput, id: 12, custom_id: "blank", value: "" }),
          label(3, { type: ComponentType.StringSelect, id: 13, custom_id: "select", values: ["a", "b"] }),
          label(4, { type: ComponentType.FileUpload, id: 14, custom_id: "upload", values: [attachment.id] }),
          label(5, { type: ComponentType.RadioGroup, id: 15, custom_id: "radio", value: "r1" }),
          label(6, { type: ComponentType.RadioGroup, id: 16, custom_id: "radioNone", value: null }),
          label(7, { type: ComponentType.CheckboxGroup, id: 17, custom_id: "boxes", values: ["x"] }),
          label(8, { type: ComponentType.Checkbox, id: 18, custom_id: "tick", value: true }),
          label(9, { type: ComponentType.Checkbox, id: 19, custom_id: "untick", value: false }),
        ],
      },
    });

    await harness.dispatch(interaction);
    await harness.close();

    expect(harness.errors).toEqual([]);
    expect(values).toEqual({
      text: "hello",
      select: ["a", "b"],
      upload: [attachment.id],
      radio: "r1",
      boxes: ["x"],
      tick: true,
      untick: false,
    });
    expect(files).toBe(1);
    expect(calls[0]?.body.data?.components).toEqual([{ type: ComponentType.TextDisplay, content: "id 9" }] as never);
  });

  test("a real showModal posts a modal callback", async () => {
    const modal = defineModal("core/form", {
      title: "Form",
      render: () => <TextDisplay>body</TextDisplay>,
      submit: () => "x",
    });
    const definition = defineCommand({
      description: "d",
      async execute(ctx) {
        await ctx.showModal("core/form");
      },
    });
    const harness = createHarness({
      manifest: manifestOf([route("command", "open", definition), route("modal", "core/form", modal)]),
    });
    await harness.dispatch(
      construct<Interaction>(ChatInputCommandInteraction, {
        ...baseRaw(InteractionType.ApplicationCommand),
        data: { id: "666666666666666666", name: "open", type: 1 },
      }),
    );
    await harness.close();
    expect(harness.errors).toEqual([]);
    expect(calls[0]?.body.type).toBe(InteractionResponseType.Modal);
    expect(calls[0]?.body.data?.custom_id).toBe("core/form");
  });
});
