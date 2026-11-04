import { describe, expect, expectTypeOf, test } from "bun:test";
import {
  buildCustomId,
  classifyFile,
  createRouter,
  CustomIdError,
  getParamNames,
  RouteConflictError,
  type RouteParams,
} from "./index.ts";

describe("classifyFile", () => {
  test("classifies a top-level slash command", () => {
    expect(classifyFile("src/features/moderation/commands/ban/command.tsx")).toEqual({
      type: "route",
      kind: "command",
      feature: "moderation",
      routeId: "ban",
      segments: ["ban"],
      scopes: [
        "src/features/moderation",
        "src/features/moderation/commands",
        "src/features/moderation/commands/ban",
      ],
    });
  });

  test("turns nested folders into subcommands and ignores route groups", () => {
    const file = classifyFile("src/features/moderation/commands/(staff)/mod/case/view/command.ts");
    expect(file).toMatchObject({ type: "route", routeId: "mod case view", segments: ["mod", "case", "view"] });
  });

  test("namespaces interaction routes by feature", () => {
    expect(classifyFile("src/features/moderation/buttons/confirm-ban/[userId]/button.tsx")).toMatchObject({
      type: "route",
      kind: "button",
      routeId: "moderation/confirm-ban/[userId]",
    });
    expect(classifyFile("src/features/fun/selects/pick/select.tsx")).toMatchObject({ kind: "select", routeId: "fun/pick" });
    expect(classifyFile("src/features/fun/modals/poll/modal.tsx")).toMatchObject({ kind: "modal", routeId: "fun/poll" });
  });

  test("classifies events and tasks in both accepted layouts", () => {
    expect(classifyFile("src/features/fun/events/guildMemberAdd.ts")).toMatchObject({ kind: "event", routeId: "guildMemberAdd" });
    expect(classifyFile("src/features/fun/events/guildMemberAdd/welcome.ts")).toMatchObject({ kind: "event", routeId: "guildMemberAdd" });
    expect(classifyFile("src/features/fun/tasks/cleanup.ts")).toMatchObject({ kind: "task", routeId: "fun/cleanup" });
  });

  test("classifies segment, group, feature and root files", () => {
    expect(classifyFile("src/middleware.ts")).toEqual({ type: "segment", kind: "middleware", feature: null, scope: "src" });
    expect(classifyFile("src/features/fun/error.tsx")).toMatchObject({ type: "segment", kind: "error", feature: "fun" });
    expect(classifyFile("src/features/fun/commands/mod/layout.tsx")).toMatchObject({ type: "segment", kind: "layout" });
    expect(classifyFile("src/features/fun/commands/mod/group.ts")).toMatchObject({ type: "group", segments: ["mod"] });
    expect(classifyFile("src/features/fun/feature.ts")).toEqual({ type: "feature", feature: "fun" });
    expect(classifyFile("src/context.ts")).toEqual({ type: "context" });
    expect(classifyFile("src/env.ts")).toEqual({ type: "env" });
  });

  test("ignores private folders, tests and files elsewhere", () => {
    expect(classifyFile("src/features/fun/_lib/jokes.ts")).toEqual({ type: "private" });
    expect(classifyFile("src/features/fun/commands/joke/_view.tsx")).toEqual({ type: "private" });
    expect(classifyFile("src/features/fun/commands/joke/command.test.tsx")).toEqual({ type: "outside" });
    expect(classifyFile("src/lib/db.ts")).toEqual({ type: "outside" });
    expect(classifyFile("neocord.config.ts")).toEqual({ type: "outside" });
  });

  test("reports misplaced files", () => {
    expect(classifyFile("src/features/fun/commands/joke/handler.ts").type).toBe("invalid");
    expect(classifyFile("src/features/fun/helpers/joke.ts").type).toBe("invalid");
    expect(classifyFile("src/features/fun/utils.ts").type).toBe("invalid");
    expect(classifyFile("src/features/orphan.ts").type).toBe("invalid");
    expect(classifyFile("src/features/fun/commands/command.tsx").type).toBe("invalid");
    expect(classifyFile("src/features/fun/commands/group.ts").type).toBe("invalid");
  });

  test("treats inherited object keys as unknown folders", () => {
    const file = classifyFile("src/features/fun/constructor/thing.ts");
    expect(file).toMatchObject({ type: "invalid", reason: expect.stringContaining("Unknown folder") });
  });

  test("allows events and tasks named like segment files", () => {
    expect(classifyFile("src/features/fun/events/error.ts")).toMatchObject({ type: "route", kind: "event", routeId: "error" });
    expect(classifyFile("src/features/fun/tasks/loading.ts")).toMatchObject({ type: "route", kind: "task", routeId: "fun/loading" });
  });

  test("accepts windows separators and custom directories", () => {
    expect(classifyFile("src\\features\\fun\\buttons\\a\\button.ts")).toMatchObject({ routeId: "fun/a" });
    expect(classifyFile("bot/mods/fun/buttons/a/button.ts", { sourceDir: "bot", featuresDir: "bot/mods" })).toMatchObject({ routeId: "fun/a" });
  });
});

describe("params", () => {
  test("infers param types from a route id", () => {
    expectTypeOf<RouteParams<"mod/ban/[userId]">>().toEqualTypeOf<{ userId: string }>();
    expectTypeOf<RouteParams<"mod/[a]/[...rest]">>().toEqualTypeOf<{ a: string; rest: string[] }>();
    expectTypeOf<RouteParams<"mod/ban">>().toEqualTypeOf<{}>();
  });

  test("lists param names", () => {
    expect(getParamNames("a/[b]/c/[...d]")).toEqual(["b", "d"]);
  });

  test("builds encoded custom ids", () => {
    expect(buildCustomId("mod/ban/[userId]", { userId: 123n })).toBe("mod/ban/123");
    expect(buildCustomId("mod/[q]", { q: "a/b c" })).toBe("mod/a%2Fb%20c");
    expect(buildCustomId("mod/[...rest]", { rest: ["a", 1] })).toBe("mod/a/1");
  });

  test("rejects missing params and ids over the Discord limit", () => {
    expect(() => buildCustomId("mod/[id]")).toThrow(CustomIdError);
    expect(() => buildCustomId("mod/[...rest]", { rest: [] })).toThrow(CustomIdError);
    expect(() => buildCustomId("mod/[id]", { id: "x".repeat(100) })).toThrow(CustomIdError);
  });
});

describe("createRouter", () => {
  function router() {
    const instance = createRouter<string>();
    instance.add("mod/ban/confirm", "static");
    instance.add("mod/ban/[userId]", "param");
    instance.add("mod/files/[...path]", "catch-all");
    return instance;
  }

  test("prefers static over dynamic matches", () => {
    expect(router().match("mod/ban/confirm")).toEqual({ route: "static", params: {} });
    expect(router().match("mod/ban/42")).toEqual({ route: "param", params: { userId: "42" } });
  });

  test("decodes params and collects catch-all segments", () => {
    expect(router().match("mod/ban/a%2Fb")?.params).toEqual({ userId: "a/b" });
    expect(router().match("mod/files/a/b/c")).toEqual({ route: "catch-all", params: { path: ["a", "b", "c"] } });
  });

  test("returns null when nothing matches or a param cannot be decoded", () => {
    expect(router().match("mod/ban")).toBeNull();
    expect(router().match("other")).toBeNull();
    expect(router().match("mod/ban/%E0%A4%A")).toBeNull();
  });

  test("round-trips ids built by buildCustomId", () => {
    const id = buildCustomId("mod/ban/[userId]", { userId: "a b/c" });
    expect(router().match(id)?.params).toEqual({ userId: "a b/c" });
  });

  test("rejects conflicting routes", () => {
    expect(() => router().add("mod/ban/confirm", "again")).toThrow(RouteConflictError);
    expect(() => router().add("mod/ban/[other]", "again")).toThrow(RouteConflictError);
    expect(() => router().add("mod/[...a]/b", "again")).toThrow(RouteConflictError);
  });
});
