import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ComponentType, GuildBanManager, type GuildBan, type User } from "discord.js";
import {
  mockGuild,
  mockMember,
  mockMessage,
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
} from "neocord/testing";
import { eq } from "drizzle-orm";
import { cases } from "~/db/schema";
import RootLayout from "~/layout";
import { createTestDatabase, type TestDatabase } from "~/test-support/database";
import { createRecordingLogger } from "~/test-support/logger";
import { countActiveWarnings, createCase } from "./_lib/cases";
import cancelBan from "./buttons/ban/cancel/button";
import confirmBan from "./buttons/ban/confirm/[userId]/button";
import banCommand from "./commands/ban/command";
import viewCases from "./commands/mod/case/view/command";
import warnCommand from "./commands/mod/warn/command";
import ModerationError from "./error";
import guildBanAdd from "./events/guildBanAdd";
import guildMemberAdd from "./events/guildMemberAdd";
import ModerationLayout from "./layout";
import reportMessage from "./message-commands/report-message/command";
import moderationMiddleware from "./middleware";
import banReason from "./modals/ban-reason/[userId]/modal";
import warnReason from "./modals/warn-reason/[userId]/modal";
import caseFilter from "./selects/case-filter/select";
import expireWarningsTask from "./tasks/expire-warnings";
import warnUser from "./user-commands/warn-user/command";

let database: TestDatabase;

beforeEach(async () => {
  database = await createTestDatabase();
});

afterEach(() => {
  database.close();
});

function seedCase(guildId: string, type: "warn" | "ban" | "report", reason: string, userId = "1") {
  return createCase(database.db, { guildId, userId, moderatorId: "2", type, reason });
}

function banEvent(guildId: string, user: User, reason: string | null): GuildBan {
  return { guild: mockGuild({ id: guildId }), user, reason } as unknown as GuildBan;
}

describe("/ban", () => {
  test("replies with a private confirmation addressed to the target", async () => {
    const target = mockUser({ username: "spammer" });
    const { text, ephemeral, replies } = await runCommand(banCommand, { options: { user: target } });

    expect(text).toContain("Ban spammer?");
    expect(ephemeral).toBe(true);
    const payload = JSON.stringify(replies[0]);
    expect(payload).toContain(`"custom_id":"moderation/ban/confirm/${target.id}"`);
    expect(payload).toContain('"custom_id":"moderation/ban/cancel"');
  });

  test("the announce option makes the confirmation public", async () => {
    const { ephemeral } = await runCommand(banCommand, { options: { user: mockUser(), announce: true } });

    expect(ephemeral).toBe(false);
  });

  test("refuses to ban yourself", async () => {
    const self = mockUser();
    const { text, ephemeral } = await runCommand(banCommand, { user: self, options: { user: self } });

    expect(text).toBe("You cannot ban yourself.");
    expect(ephemeral).toBe(true);
  });

  test("requires the Ban Members permission", async () => {
    const { text } = await runCommand(banCommand, {
      member: mockMember({ permissions: ["SendMessages"] }),
      options: { user: mockUser() },
    });

    expect(text).toContain("Ban Members");
  });

  test("only works in a server", async () => {
    const { text } = await runCommand(banCommand, { guild: null, options: { user: mockUser() } });

    expect(text).toContain("only be used in a server");
  });
});

describe("ban buttons", () => {
  test("confirm opens the reason modal for that user", async () => {
    const { modal, updates } = await runButton(confirmBan, { params: { userId: "42" }, modals: [banReason] });

    expect(modal?.custom_id).toBe("moderation/ban-reason/42");
    expect(updates).toHaveLength(0);
  });

  test("cancel updates the message and removes the buttons", async () => {
    const { text, updates } = await runButton(cancelBan);

    expect(text).toBe("Ban cancelled. Nothing happened.");
    expect(JSON.stringify(updates[0])).not.toContain("custom_id");
  });
});

describe("ban reason modal", () => {
  const banSpy = () => spyOn(GuildBanManager.prototype, "create");

  test("renders typed fields", () => {
    const rendered = renderModalOf(banReason, { params: { userId: "42" } });
    const payload = JSON.stringify(rendered);

    expect(rendered.custom_id).toBe("moderation/ban-reason/42");
    expect(rendered.title).toBe("Ban reason");
    expect(payload).toContain('"custom_id":"reason"');
    expect(payload).toContain('"custom_id":"history"');
  });

  test("a valid submit bans, stores a case and updates the confirmation", async () => {
    const guild = mockGuild();
    const moderator = mockUser();
    const create = banSpy().mockResolvedValue("42");

    const { text, updates, replies } = await runModal(banReason, {
      params: { userId: "42" },
      values: { reason: "  Spam links  ", history: "7" },
      guild,
      user: moderator,
      app: database.app,
      message: mockMessage(),
    });

    expect(create).toHaveBeenCalledWith("42", { reason: "Spam links", deleteMessageSeconds: 604_800 });
    expect(updates).toHaveLength(1);
    expect(replies).toHaveLength(0);
    expect(text).toContain("Member banned");
    expect(text).toContain("Spam links");

    const stored = await database.db.select().from(cases).where(eq(cases.guildId, guild.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ userId: "42", moderatorId: moderator.id, type: "ban", reason: "Spam links" });
    create.mockRestore();
  });

  test("a failed parse reports the issue and skips submit", async () => {
    const create = banSpy().mockResolvedValue("42");

    const { text, ephemeral } = await runModal(banReason, {
      params: { userId: "42" },
      values: { reason: "no" },
      app: database.app,
    });

    expect(text).toContain("Give a reason of at least 3 characters.");
    expect(ephemeral).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(await database.db.select().from(cases)).toHaveLength(0);
    create.mockRestore();
  });

  test("the error boundary explains a failed ban and the case is rolled back", async () => {
    const create = banSpy().mockRejectedValue(new Error("Missing Permissions"));

    const { text, ephemeral, error } = await runModal(banReason, {
      params: { userId: "42" },
      values: { reason: "Spam links" },
      app: database.app,
      error: ModerationError,
    });

    expect(text).toContain("That moderation action failed");
    expect(text).toContain("Missing Permissions");
    expect(ephemeral).toBe(true);
    expect((error as Error).message).toBe("Missing Permissions");
    expect(await database.db.select().from(cases)).toHaveLength(0);
    create.mockRestore();
  });
});

describe("moderation middleware", () => {
  test("short-circuits for non-moderators so the handler never runs", async () => {
    const { text, ephemeral } = await runCommand(warnCommand, {
      member: mockMember({ permissions: ["SendMessages"] }),
      middleware: [moderationMiddleware],
      app: database.app,
      options: { user: mockUser(), reason: "Being rude" },
    });

    expect(text).toBe("Only moderators can do that.");
    expect(ephemeral).toBe(true);
    expect(await database.db.select().from(cases)).toHaveLength(0);
  });

  test("lets moderators through", async () => {
    const { text } = await runCommand(warnCommand, {
      member: mockMember({ permissions: ["ModerateMembers"] }),
      middleware: [moderationMiddleware],
      app: database.app,
      options: { user: mockUser(), reason: "Being rude" },
    });

    expect(text).toContain("Warning issued");
  });

  test("does not apply to message commands, so anyone can report", async () => {
    const { text } = await runMessageCommand(reportMessage, {
      member: mockMember({ permissions: ["SendMessages"] }),
      middleware: [moderationMiddleware],
      app: database.app,
      target: mockMessage({ content: "buy my crypto" }),
    });

    expect(text).toContain("Report received");
  });
});

describe("moderation layout", () => {
  test("wraps handler output in a red container inside the root layout", async () => {
    const { replies, text } = await runCommand(warnCommand, {
      layouts: [RootLayout, ModerationLayout],
      app: database.app,
      options: { user: mockUser(), reason: "Being rude" },
    });
    const [first, second] = replies[0]?.components ?? [];

    expect(first?.type).toBe(ComponentType.Container);
    expect(first).toMatchObject({ accent_color: 0xed4245 });
    expect(second?.type).toBe(ComponentType.TextDisplay);
    expect(text).toContain("Warning issued");
    expect(text).toEndWith("-# test on shard 0");
  });
});

describe("/mod warn", () => {
  test("stores a warning that expires and counts active warnings", async () => {
    const guild = mockGuild();
    const target = mockUser();
    await seedCase(guild.id, "warn", "First offence", target.id);

    const { text, ephemeral } = await runCommand(warnCommand, {
      guild,
      app: database.app,
      options: { user: target, reason: "Second offence" },
    });

    expect(text).toContain("Second offence");
    expect(text).toContain("Active warnings: **2**");
    expect(text).toContain("Expires <t:");
    expect(ephemeral).toBe(true);
  });

  test("escapes markdown in the stored reason", async () => {
    const { text } = await runCommand(warnCommand, {
      app: database.app,
      options: { user: mockUser(), reason: "**loud**" },
    });

    expect(text).toContain("\\*\\*loud\\*\\*");
  });
});

describe("/mod case view and the case filter select", () => {
  test("lists cases for this guild only", async () => {
    const guild = mockGuild();
    await seedCase(guild.id, "warn", "Rude");
    await seedCase(guild.id, "ban", "Raiding");
    await seedCase(mockGuild().id, "ban", "Elsewhere");

    const { text, replies } = await runCommand(viewCases, { guild, app: database.app });

    expect(text).toContain("All cases");
    expect(text).toContain("Rude");
    expect(text).toContain("Raiding");
    expect(text).not.toContain("Elsewhere");
    expect(JSON.stringify(replies[0])).toContain('"custom_id":"moderation/case-filter"');
  });

  test("the type option narrows the list", async () => {
    const guild = mockGuild();
    await seedCase(guild.id, "warn", "Rude");
    await seedCase(guild.id, "ban", "Raiding");

    const { text } = await runCommand(viewCases, { guild, app: database.app, options: { type: "ban" } });

    expect(text).toContain("Raiding");
    expect(text).not.toContain("Rude");
  });

  test("the select re-renders with the chosen filter selected", async () => {
    const guild = mockGuild();
    await seedCase(guild.id, "warn", "Rude");
    await seedCase(guild.id, "ban", "Raiding");

    const { text, updates } = await runSelect(caseFilter, { guild, app: database.app, values: ["warn"] });

    expect(updates).toHaveLength(1);
    expect(text).toContain("Warnings");
    expect(text).toContain("Rude");
    expect(text).not.toContain("Raiding");
    expect(JSON.stringify(updates[0])).toContain('"value":"warn","default":true');
  });

  test("an empty result explains itself", async () => {
    const { text } = await runSelect(caseFilter, { app: database.app, values: ["report"] });

    expect(text).toContain("No cases match this filter.");
  });
});

describe("context menus", () => {
  test("Warn user opens a modal for the target, and the modal stores the warning", async () => {
    const target = mockUser();
    const guild = mockGuild();

    const opened = await runUserCommand(warnUser, { target, guild, modals: [warnReason] });
    expect(opened.modal?.custom_id).toBe(`moderation/warn-reason/${target.id}`);

    const submitted = await runModal(warnReason, {
      params: { userId: target.id },
      values: { reason: "Spamming pings" },
      guild,
      app: database.app,
    });
    expect(submitted.text).toContain("Active warnings: **1**");
    expect(submitted.ephemeral).toBe(true);
  });

  test("Report message stores a report against the author", async () => {
    const guild = mockGuild();
    const author = mockUser();

    const { text, ephemeral } = await runMessageCommand(reportMessage, {
      guild,
      app: database.app,
      target: mockMessage({ author, content: "buy my crypto" }),
    });

    expect(text).toContain("Report received");
    expect(ephemeral).toBe(true);
    const [stored] = await database.db.select().from(cases).where(eq(cases.userId, author.id));
    expect(stored).toMatchObject({ guildId: guild.id, type: "report", reason: "buy my crypto" });
  });
});

describe("events", () => {
  test("guildBanAdd records bans made outside the bot", async () => {
    const guild = mockGuild();
    const user = mockUser();

    const { error } = await runEvent(guildBanAdd, [banEvent(guild.id, user, "Raid")], { app: database.app });

    expect(error).toBeNull();
    const stored = await database.db.select().from(cases);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ userId: user.id, moderatorId: null, type: "ban", reason: "Raid" });
  });

  test("guildBanAdd skips bans the modal already recorded", async () => {
    const guild = mockGuild();
    const user = mockUser();
    await seedCase(guild.id, "ban", "From the modal", user.id);

    await runEvent(guildBanAdd, [banEvent(guild.id, user, "Raid")], { app: database.app });

    expect(await database.db.select().from(cases)).toHaveLength(1);
  });

  test("guildMemberAdd warns about rejoining members with active warnings", async () => {
    const guild = mockGuild();
    const member = mockMember({ guild });
    const logger = createRecordingLogger();
    await seedCase(guild.id, "warn", "Rude", member.id);

    const { error } = await runEvent(guildMemberAdd, [member], { app: database.app, logger });

    expect(error).toBeNull();
    expect(logger.lines).toContain(`warn: ${member.id} rejoined ${guild.id} with 1 active warnings`);
  });

  test("guildMemberAdd stays quiet for clean members", async () => {
    const logger = createRecordingLogger();

    await runEvent(guildMemberAdd, [mockMember()], { app: database.app, logger });

    expect(logger.lines).toEqual([]);
  });
});

describe("expire-warnings task", () => {
  test("expires old warnings and keeps fresh ones", async () => {
    const guild = mockGuild();
    const old = await seedCase(guild.id, "warn", "Old", "1");
    await seedCase(guild.id, "warn", "Fresh", "1");
    await seedCase(guild.id, "ban", "Permanent", "1");
    await database.db
      .update(cases)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(cases.id, old.id));
    const logger = createRecordingLogger();

    const { error } = await runTask(expireWarningsTask, { app: database.app, logger });

    expect(error).toBeNull();
    expect(await countActiveWarnings(database.db, guild.id, "1")).toBe(1);
    expect(logger.lines).toContain("info: Expired 1 warnings");
    const [ban] = await database.db.select().from(cases).where(eq(cases.type, "ban"));
    expect(ban?.active).toBe(true);
  });
});
