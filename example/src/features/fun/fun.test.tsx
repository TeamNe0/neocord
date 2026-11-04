import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { GuildMemberRoleManager } from "discord.js";
import { mockGuild, mockMember, mockRole, mockUser, runAutocomplete, runButton, runCommand, runModal, runSelect } from "neocord/testing";
import { toRouteWords } from "./_lib/eight-ball";
import askAgain from "./buttons/8ball/[...question]/button";
import eightBall from "./commands/8ball/command";
import counter from "./commands/counter/command";
import joke from "./commands/joke/command";
import JokeLoading from "./commands/joke/loading";
import pollCommand from "./commands/poll/command";
import quiz from "./commands/quiz/command";
import rolePicker from "./commands/role-picker/command";
import roll from "./commands/roll/command";
import FunError from "./error";
import pollModal from "./modals/poll/modal";
import roleSelect from "./selects/role-picker/select";

describe("/roll", () => {
  test("rolls the requested dice and totals them", async () => {
    const { text, error } = await runCommand(roll, { options: { sides: 6, count: 3 } });

    expect(error).toBeNull();
    expect(text).toContain("3 x classic cube");
    const total = Number(/total of \*\*(\d+)\*\*/.exec(text)?.[1]);
    expect(total).toBeGreaterThanOrEqual(3);
    expect(total).toBeLessThanOrEqual(18);
  });

  test("defaults to one die", async () => {
    const { text } = await runCommand(roll, { options: { sides: 20 } });

    expect(text).toContain("1 x icosahedron");
  });

  test("a missing required option gets the same notice as production", async () => {
    const { text, ephemeral } = await runCommand(roll);

    expect(text).toContain('"sides" option could not be resolved');
    expect(ephemeral).toBe(true);
  });
});

describe("/joke", () => {
  const fetchSpy = () => spyOn(globalThis, "fetch");

  afterEach(() => {
    fetchSpy().mockRestore();
  });

  test("shows loading.tsx first, then replaces it with the joke", async () => {
    fetchSpy().mockResolvedValue(Response.json({ joke: "I only know 25 letters. I don't know y." }));

    const { replies, edits, text } = await runCommand(joke, { loading: JokeLoading });

    expect(JSON.stringify(replies[0])).toContain("Asking the internet");
    expect(edits).toHaveLength(1);
    expect(text).toContain("I don't know y.");
  });

  test("falls back when the network fails", async () => {
    fetchSpy().mockRejectedValue(new Error("offline"));

    const { text } = await runCommand(joke);

    expect(text).toContain("it timed out");
  });

  test("falls back when the response has an unexpected shape", async () => {
    fetchSpy().mockResolvedValue(Response.json({ message: "rate limited" }));

    const { text } = await runCommand(joke);

    expect(text).toContain("it timed out");
  });
});

describe("/poll", () => {
  test("the command opens the modal as its first response", async () => {
    const { modal, replies } = await runCommand(pollCommand, { modals: [pollModal] });

    expect(modal?.custom_id).toBe("fun/poll");
    expect(replies).toHaveLength(0);
  });

  test("a poll needs at least two different choices", async () => {
    const { text, ephemeral } = await runModal(pollModal, {
      values: { question: "Lunch?", choices: "Pizza\nPizza" },
    });

    expect(text).toContain("Add at least 2 different choices");
    expect(ephemeral).toBe(true);
  });

  test("the modal starts a live session that counts one vote per person", async () => {
    const author = mockUser();
    const guest = mockUser();
    const { text, live } = await runModal(pollModal, {
      user: author,
      live: true,
      values: { question: "Lunch?", choices: "Pizza\nTacos" },
    });

    expect(text).toContain("Lunch?");
    expect(text).toContain("Pizza: **0**");

    expect((await live!.click("Pizza", { user: guest })).text).toContain("Pizza: **1**");
    expect((await live!.click("Pizza")).text).toContain("Pizza: **2**");

    const changed = await live!.click("Tacos", { user: guest });
    expect(changed.text).toContain("Pizza: **1**");
    expect(changed.text).toContain("Tacos: **1**");
    await live!.close();
  });

  test("only the author can close the poll, and closing disables voting", async () => {
    const author = mockUser();
    const { live } = await runModal(pollModal, {
      user: author,
      live: true,
      values: { question: "Lunch?", choices: "Pizza\nTacos" },
    });

    const refused = await live!.click("Close poll", { user: mockUser() });
    expect(refused.text).toBe("Only the person who made this poll can close it.");
    expect(refused.ephemeral).toBe(true);

    const closed = await live!.click("Close poll");
    const payload = JSON.stringify(closed.updates[0]);
    expect(payload).toContain('"label":"Closed"');
    expect(payload).toContain('"label":"Pizza"');
    expect(payload).not.toContain('"disabled":false');
    await live!.close();
  });
});

describe("/counter", () => {
  test("inline handlers update state across clicks", async () => {
    const clicker = mockUser({ username: "ada" });
    const { text, live } = await runCommand(counter, { live: true });

    expect(text).toContain("Count: **0**");
    expect(text).toContain("nobody yet");

    await live!.click("+1", { user: clicker });
    const up = await live!.click("+1", { user: clicker });
    expect(up.text).toContain("Count: **2**");
    expect(up.text).toContain("Last clicked by ada");

    expect((await live!.click("-1")).text).toContain("Count: **1**");
    expect((await live!.click("Reset")).text).toContain("Count: **0**");
    await live!.close();
  });
});

describe("/quiz", () => {
  test("autocomplete filters topics by what was typed", async () => {
    const { choices, error } = await runAutocomplete(quiz, { option: "topic", value: "SPA" });

    expect(error).toBeNull();
    expect(choices).toEqual([{ name: "Space", value: "space" }]);
  });

  test("autocomplete offers everything before anything is typed", async () => {
    const { choices } = await runAutocomplete(quiz, { option: "topic" });

    expect(choices.map((choice) => choice.value)).toEqual(["space", "animals", "computers"]);
  });

  test("an unknown topic is rejected privately", async () => {
    const { text, ephemeral } = await runCommand(quiz, { options: { topic: "nope" } });

    expect(text).toContain("no quiz on that topic");
    expect(ephemeral).toBe(true);
  });

  test("a live select reveals whether the answer was right", async () => {
    const { text, live } = await runCommand(quiz, { live: true, options: { topic: "computers" } });
    expect(text).toContain("How many bits are in a byte?");

    const answered = await live!.select(["8"]);
    expect(answered.text).toContain("Correct!");
    expect(JSON.stringify(answered.updates[0])).toContain('"disabled":true');
    await live!.close();
  });

  test("a wrong answer shows the right one", async () => {
    const { live } = await runCommand(quiz, { live: true, options: { topic: "animals" } });

    const answered = await live!.select(["One"], { placeholder: "Pick an answer" });
    expect(answered.text).toContain("Not quite. The answer is **Three**.");
    await live!.close();
  });
});

describe("/8ball", () => {
  test("the command puts the question in a catch-all button route", async () => {
    const { text, replies } = await runCommand(eightBall, { options: { question: "will it work" } });

    expect(text).toContain("You asked: will it work");
    expect(JSON.stringify(replies[0])).toContain('"custom_id":"fun/8ball/will/it/work"');
  });

  test("the button reads the question back from its params", async () => {
    const { text, updates } = await runButton(askAgain, { params: { question: ["is", "it", "café", "time"] } });

    expect(updates).toHaveLength(1);
    expect(text).toContain("You asked: is it café time");
  });

  test("a raw custom id decodes the same way", async () => {
    const { text } = await runButton(askAgain, { customId: "fun/8ball/caf%C3%A9" });

    expect(text).toContain("You asked: café");
  });

  test("long questions still fit Discord's custom id limit", async () => {
    const question = "🎱 ".repeat(100);
    const { replies, error } = await runCommand(eightBall, { options: { question } });

    expect(error).toBeNull();
    const words = toRouteWords(question);
    expect(words.length).toBeGreaterThan(0);
    expect(words.length).toBeLessThan(100);
    const customId = /"custom_id":"([^"]+)"/.exec(JSON.stringify(replies[0]))?.[1] ?? "";
    expect(customId.length).toBeLessThanOrEqual(100);
  });

  test("a question with nothing usable still builds a route", () => {
    expect(toRouteWords("   ")).toEqual(["?"]);
  });
});

describe("/role-picker", () => {
  const addSpy = () => spyOn(GuildMemberRoleManager.prototype, "add");

  test("the command renders a role select addressed by route", async () => {
    const { replies } = await runCommand(rolePicker);
    const payload = JSON.stringify(replies[0]);

    expect(payload).toContain('"custom_id":"fun/role-picker"');
    expect(payload).toContain('"type":6');
  });

  test("the select grants plain roles and ignores privileged ones", async () => {
    const guild = mockGuild();
    const member = mockMember({ guild });
    const plain = mockRole({ guild, name: "gamer" });
    const admin = mockRole({ guild, name: "admin", permissions: ["Administrator"] });
    const add = addSpy().mockResolvedValue(member);

    const { text, ephemeral, updates } = await runSelect(roleSelect, {
      member,
      values: [plain.id, admin.id],
      roles: [plain, admin],
    });

    expect(add).toHaveBeenCalledWith([plain.id], "Picked with /role-picker");
    expect(text).toContain(`<@&${plain.id}>`);
    expect(text).not.toContain(admin.id);
    expect(ephemeral).toBe(true);
    expect(updates).toHaveLength(0);
    add.mockRestore();
  });

  test("only privileged roles means nothing is granted", async () => {
    const guild = mockGuild();
    const member = mockMember({ guild });
    const admin = mockRole({ guild, permissions: ["Administrator"] });
    const add = addSpy().mockResolvedValue(member);

    const { text } = await runSelect(roleSelect, { member, values: [admin.id], roles: [admin] });

    expect(text).toContain("None of those roles");
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });

  test("a failed grant reaches the feature's error view", async () => {
    const guild = mockGuild();
    const plain = mockRole({ guild });
    const add = addSpy().mockRejectedValue(new Error("Missing Access"));

    const { text, ephemeral } = await runSelect(roleSelect, {
      member: mockMember({ guild }),
      values: [plain.id],
      roles: [plain],
      error: FunError,
    });

    expect(text).toContain("That was not much fun");
    expect(ephemeral).toBe(true);
    add.mockRestore();
  });
});
