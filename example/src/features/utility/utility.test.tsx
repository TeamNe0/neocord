import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CommandInfo } from "neocord";
import { mockMember, mockUser, runCommand, runEvent } from "neocord/testing";
import { createTestDatabase, type TestDatabase } from "~/test-support/database";
import { createRecordingLogger } from "~/test-support/logger";
import { createCase } from "~/features/moderation/_lib/cases";
import about from "./commands/(info)/about/command";
import help from "./commands/(info)/help/command";
import ping from "./commands/(info)/ping/command";
import stats from "./commands/(info)/stats/command";
import card from "./commands/card/command";
import UtilityError from "./error";
import clientReady from "./events/clientReady";

describe("/ping", () => {
  test("replies privately", async () => {
    const { text, ephemeral } = await runCommand(ping);

    expect(text).toContain("Pong!");
    expect(ephemeral).toBe(true);
  });
});

describe("/about", () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  test("waits for suspended data before replying", async () => {
    await createCase(database.db, { guildId: "1", userId: "2", moderatorId: null, type: "ban", reason: "Raid" });

    const { text } = await runCommand(about, { app: database.app });

    expect(text).toContain("About neocord-test-bot");
    expect(text).toContain("Moderation cases on record: **1**");
    expect(text).not.toContain("Counting cases");
  });

  test("a rejected query reaches the error view", async () => {
    database.close();

    const { text, ephemeral, error } = await runCommand(about, { app: database.app, error: UtilityError });

    expect(error).not.toBeNull();
    expect(text).toContain("Could not finish test.");
    expect(ephemeral).toBe(true);
  });
});

describe("/stats", () => {
  test("combines fetchClientValues and broadcastEval, which run locally without a manager", async () => {
    const { text, error } = await runCommand(stats);

    expect(error).toBeNull();
    expect(text).toMatch(/\*\*\d+\*\* servers across \*\*1\*\* shards/);
    expect(text).toMatch(/Shard 0: \d+\.\d MB/);
  });
});

describe("/card", () => {
  test("collects Buffers into attachments and references them", async () => {
    const { replies, text, error } = await runCommand(card, {
      user: mockUser({ username: "ada" }),
      options: { theme: "forest" },
    });

    expect(error).toBeNull();
    expect(text).toContain("Theme: forest");
    const payload = replies[0];
    expect(payload?.files?.map((file) => file.name).sort()).toEqual(["banner.png", "card.txt", "swatch.png"]);

    const json = JSON.stringify(payload?.components);
    expect(json).toContain("attachment://swatch.png");
    expect(json).toContain("attachment://banner.png");
    expect(json).toContain("attachment://card.txt");

    const banner = payload?.files?.find((file) => file.name === "banner.png")?.attachment;
    expect(Buffer.isBuffer(banner)).toBe(true);
    expect((banner as Buffer).subarray(1, 4).toString("ascii")).toBe("PNG");

    const receipt = payload?.files?.find((file) => file.name === "card.txt")?.attachment;
    expect((receipt as Buffer).toString()).toBe("Card for ada\nTheme: forest\n");
  });
});

describe("/help", () => {
  const commands: readonly CommandInfo[] = [
    { kind: "command", name: "ping", description: "Check the bot", feature: "utility", guildOnly: false, permissions: [] },
    { kind: "command", name: "mod warn", description: "Warn a member", feature: "moderation", guildOnly: true, permissions: ["ModerateMembers"] },
    { kind: "user-command", name: "Warn user", description: null, feature: "moderation", guildOnly: true, permissions: ["ModerateMembers"] },
    { kind: "message-command", name: "Report message", description: null, feature: "moderation", guildOnly: true, permissions: [] },
  ];

  test("groups commands by feature for someone who can use them all", async () => {
    const { text, ephemeral } = await runCommand(help, {
      commands,
      member: mockMember({ permissions: ["ModerateMembers"] }),
    });

    expect(ephemeral).toBe(true);
    expect(text).toContain("**moderation**");
    expect(text).toContain("**utility**");
    expect(text).toContain("`/mod warn` Warn a member");
    expect(text).toContain("`Warn user` Right-click a user");
    expect(text).toContain("`Report message` Right-click a message");
  });

  test("hides commands the member lacks permissions for", async () => {
    const { text } = await runCommand(help, { commands, member: mockMember({ permissions: ["SendMessages"] }) });

    expect(text).toContain("`/ping`");
    expect(text).toContain("`Report message`");
    expect(text).not.toContain("/mod warn");
    expect(text).not.toContain("Warn user");
  });

  test("hides server commands in direct messages", async () => {
    const { text } = await runCommand(help, { commands });

    expect(text).toContain("`/ping`");
    expect(text).not.toContain("moderation");
  });
});

describe("clientReady", () => {
  test("logs the user and shard information", async () => {
    const logger = createRecordingLogger();
    const client = mockUser().client;

    const { error } = await runEvent(clientReady, [client], { logger });

    expect(error).toBeNull();
    expect(logger.lines.some((line) => /^info: neocord-test-bot.* is ready on shard 0 of 1, serving \d+ servers$/.test(line))).toBe(true);
  });
});
