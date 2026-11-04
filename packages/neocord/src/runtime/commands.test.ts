import { describe, expect, test } from "bun:test";
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
} from "discord.js";
import {
  defineCommand,
  defineFeature,
  defineGroup,
  defineMessageCommand,
  defineUserCommand,
  option,
} from "../index.ts";
import type { Manifest, ManifestRoute } from "../types.ts";
import { serializeCommands } from "./commands.ts";

const execute = () => "ok";

export function route(kind: ManifestRoute["kind"], id: string, value: unknown, feature = "core"): ManifestRoute {
  return {
    kind,
    id,
    feature,
    file: `src/features/${feature}/${kind}/${id.replaceAll(" ", "/")}.tsx`,
    segments: kind === "command" ? id.split(" ") : id.split("/").slice(1),
    module: { default: value },
    middleware: [],
    layouts: [],
    error: null,
    loading: null,
  };
}

export function manifest(partial: Partial<Manifest>): Manifest {
  return { version: 1, context: null, features: [], groups: [], routes: [], ...partial };
}

function group(segments: string[], value: unknown, feature = "core"): Manifest["groups"][number] {
  return { feature, segments, file: `src/features/${feature}/commands/${segments.join("/")}/group.ts`, module: { default: value } };
}

describe("serializeCommands", () => {
  test("serializes a flat command with options and required first", () => {
    const [command] = serializeCommands(
      manifest({
        routes: [
          route(
            "command",
            "ban",
            defineCommand({
              description: "Ban a member",
              permissions: ["BanMembers"],
              guildOnly: true,
              nsfw: false,
              options: {
                reason: option.string({ description: "Why", maxLength: 200, minLength: 2 }),
                user: option.user({ description: "Who", required: true }),
                days: option.integer({ description: "Days", minValue: 1, maxValue: 7, choices: [{ name: "One", value: 1 }] }),
                member: option.member({ description: "Mem", required: true }),
              },
              execute,
            }),
          ),
        ],
      }),
    );
    expect(command).toEqual({
      type: ApplicationCommandType.ChatInput,
      name: "ban",
      description: "Ban a member",
      nsfw: false,
      default_member_permissions: PermissionFlagsBits.BanMembers.toString(),
      contexts: [InteractionContextType.Guild],
      options: [
        { type: ApplicationCommandOptionType.User, name: "user", description: "Who", required: true },
        { type: ApplicationCommandOptionType.User, name: "member", description: "Mem", required: true },
        { type: ApplicationCommandOptionType.String, name: "reason", description: "Why", min_length: 2, max_length: 200 },
        {
          type: ApplicationCommandOptionType.Integer,
          name: "days",
          description: "Days",
          min_value: 1,
          max_value: 7,
          choices: [{ name: "One", value: 1 }],
        },
      ],
    } as never);
  });

  test("serializes every option kind", () => {
    const [command] = serializeCommands(
      manifest({
        routes: [
          route(
            "command",
            "all",
            defineCommand({
              description: "d",
              options: {
                a: option.string({ description: "d", autocomplete: () => [] }),
                b: option.number({ description: "d", autocomplete: () => [] }),
                c: option.boolean({ description: "d" }),
                d: option.channel({ description: "d", channelTypes: [ChannelType.GuildText] }),
                e: option.role({ description: "d" }),
                f: option.mentionable({ description: "d" }),
                g: option.attachment({ description: "d" }),
              },
              execute,
            }),
          ),
        ],
      }),
    );
    const options = (command as { options: { type: number; autocomplete?: boolean; channel_types?: number[] }[] }).options;
    expect(options.map((entry) => entry.type)).toEqual([
      ApplicationCommandOptionType.String,
      ApplicationCommandOptionType.Number,
      ApplicationCommandOptionType.Boolean,
      ApplicationCommandOptionType.Channel,
      ApplicationCommandOptionType.Role,
      ApplicationCommandOptionType.Mentionable,
      ApplicationCommandOptionType.Attachment,
    ]);
    expect(options[0]?.autocomplete).toBe(true);
    expect(options[3]?.channel_types).toEqual([ChannelType.GuildText]);
  });

  test("keeps localizations", () => {
    const [command] = serializeCommands(
      manifest({
        routes: [
          route(
            "command",
            "hi",
            defineCommand({
              description: "d",
              nameLocalizations: { fr: "salut" },
              descriptionLocalizations: { fr: "dire" },
              options: {
                who: option.string({
                  description: "d",
                  nameLocalizations: { fr: "qui" },
                  descriptionLocalizations: { fr: "qd" },
                  choices: [{ name: "A", value: "a", nameLocalizations: { fr: "Ah" } }],
                }),
              },
              execute,
            }),
          ),
        ],
      }),
    );
    expect(command?.name_localizations).toEqual({ fr: "salut" });
    const inner = (command as unknown as { options: Record<string, unknown>[] }).options[0];
    expect(inner?.name_localizations).toEqual({ fr: "qui" });
    expect(inner?.description_localizations).toEqual({ fr: "qd" });
    expect(inner?.choices).toEqual([{ name: "A", value: "a", name_localizations: { fr: "Ah" } }]);
  });

  test("nests subcommands and groups using metadata", () => {
    const commands = serializeCommands(
      manifest({
        groups: [
          group(
            ["mod"],
            defineGroup({ description: "Moderation", permissions: ["KickMembers"], guildOnly: true, nsfw: true }),
          ),
          group(["mod", "case"], defineGroup({ description: "Cases", nameLocalizations: { fr: "cas" } })),
        ],
        routes: [
          route("command", "mod warn", defineCommand({ description: "Warn", execute })),
          route(
            "command",
            "mod case view",
            defineCommand({
              description: "View",
              options: { id: option.string({ description: "Id", required: true }) },
              execute,
            }),
          ),
          route("command", "mod case close", defineCommand({ description: "Close", execute })),
        ],
      }),
    );
    expect(commands).toEqual([
      {
        type: ApplicationCommandType.ChatInput,
        name: "mod",
        description: "Moderation",
        default_member_permissions: PermissionFlagsBits.KickMembers.toString(),
        contexts: [InteractionContextType.Guild],
        nsfw: true,
        options: [
          { type: ApplicationCommandOptionType.Subcommand, name: "warn", description: "Warn" },
          {
            type: ApplicationCommandOptionType.SubcommandGroup,
            name: "case",
            description: "Cases",
            name_localizations: { fr: "cas" },
            options: [
              {
                type: ApplicationCommandOptionType.Subcommand,
                name: "view",
                description: "View",
                options: [{ type: ApplicationCommandOptionType.String, name: "id", description: "Id", required: true }],
              },
              { type: ApplicationCommandOptionType.Subcommand, name: "close", description: "Close" },
            ],
          },
        ],
      },
    ] as never);
  });

  test("serializes context menus", () => {
    const commands = serializeCommands(
      manifest({
        routes: [
          route(
            "user-command",
            "core/report",
            defineUserCommand({ name: "Report user", guildOnly: true, permissions: ["ManageMessages"], execute }),
          ),
          route("message-command", "core/quote", defineMessageCommand({ name: "Quote", execute })),
        ],
      }),
    );
    expect(commands).toEqual([
      {
        type: ApplicationCommandType.User,
        name: "Report user",
        default_member_permissions: PermissionFlagsBits.ManageMessages.toString(),
        contexts: [InteractionContextType.Guild],
      },
      { type: ApplicationCommandType.Message, name: "Quote" },
    ] as never);
  });

  test("throws for a missing group description rather than inventing one", () => {
    expect(() =>
      serializeCommands(manifest({ routes: [route("command", "mod warn", defineCommand({ description: "W", execute }))] })),
    ).toThrow('Command group "/mod" needs a description');
  });

  test("throws for duplicates and for mixed command and parent", () => {
    expect(() =>
      serializeCommands(
        manifest({
          routes: [
            route("command", "ban", defineCommand({ description: "a", execute }), "one"),
            route("command", "ban", defineCommand({ description: "b", execute }), "two"),
          ],
        }),
      ),
    ).toThrow('"/ban" is defined by both');

    expect(() =>
      serializeCommands(
        manifest({
          groups: [group(["mod"], defineGroup({ description: "g" }))],
          routes: [
            route("command", "mod", defineCommand({ description: "a", execute })),
            route("command", "mod warn", defineCommand({ description: "b", execute })),
          ],
        }),
      ),
    ).toThrow("cannot be both a command and a parent");
  });

  test("rejects unbranded modules, naming the file", () => {
    expect(() => serializeCommands(manifest({ routes: [route("command", "x", { description: "d" })] }))).toThrow(
      "src/features/core/command/x.tsx",
    );
  });

  test("skips disabled features", () => {
    const commands = serializeCommands(
      manifest({
        features: [
          { name: "off", module: { default: defineFeature({ enabled: false }) } },
          { name: "on", module: { default: defineFeature({}) } },
        ],
        routes: [
          route("command", "a", defineCommand({ description: "a", execute }), "off"),
          route("command", "b", defineCommand({ description: "b", execute }), "on"),
        ],
      }),
    );
    expect(commands.map((command) => command.name)).toEqual(["b"]);
  });
});
