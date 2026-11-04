import { afterEach, describe, expect, test } from "bun:test";
import { createFixture, STANDARD_FILES, type Fixture } from "../test-support/fixture.ts";
import { scanProject, type ScannedRoute } from "./scan.ts";

const fixtures: Fixture[] = [];

function fixture(files: Record<string, string>): Fixture {
  const created = createFixture({ files, stubs: false });
  fixtures.push(created);
  return created;
}

function route(routes: readonly ScannedRoute[], kind: string, id: string): ScannedRoute {
  const found = routes.find((item) => item.kind === kind && item.id === id);
  if (!found) throw new Error(`Missing route ${kind} ${id}`);
  return found;
}

afterEach(() => {
  for (const created of fixtures.splice(0)) created.cleanup();
});

describe("scanProject", () => {
  test("classifies every convention and ignores private and test files", async () => {
    const { root } = fixture(STANDARD_FILES);
    const scan = await scanProject({ root });

    expect(scan.issues).toEqual([]);
    expect(scan.context).toBe("src/context.ts");
    expect(scan.env).toBe("src/env.ts");
    expect(scan.features).toEqual([
      { name: "general", file: null },
      { name: "moderation", file: "src/features/moderation/feature.ts" },
    ]);
    expect(scan.groups.map((group) => group.segments)).toEqual([["mod"]]);

    const files = scan.routes.map((item) => item.file);
    expect(files).not.toContain("src/features/moderation/commands/ban/command.test.tsx");
    expect(files.some((file) => file.includes("_lib"))).toBe(false);
    expect(files.some((file) => file.includes("src/lib"))).toBe(false);
  });

  test("orders the segment chain from root to leaf and picks the closest error and loading", async () => {
    const { root } = fixture(STANDARD_FILES);
    const { routes } = await scanProject({ root });
    const ban = route(routes, "command", "ban");

    expect(ban.middleware).toEqual([
      "src/middleware.ts",
      "src/features/moderation/middleware.ts",
      "src/features/moderation/commands/ban/middleware.ts",
    ]);
    expect(ban.layouts).toEqual(["src/layout.tsx", "src/features/moderation/layout.tsx"]);
    expect(ban.error).toBe("src/features/moderation/error.tsx");
    expect(ban.loading).toBe("src/loading.tsx");

    const ping = route(routes, "command", "ping");
    expect(ping.middleware).toEqual(["src/middleware.ts"]);
    expect(ping.error).toBe("src/error.tsx");
  });

  test("applies segments inside route groups only to routes beneath them", async () => {
    const { root } = fixture(STANDARD_FILES);
    const { routes } = await scanProject({ root });

    expect(route(routes, "command", "mod warn").layouts).toEqual([
      "src/layout.tsx",
      "src/features/moderation/layout.tsx",
      "src/features/moderation/commands/(staff)/layout.tsx",
    ]);
    expect(route(routes, "command", "ban").layouts).not.toContain("src/features/moderation/commands/(staff)/layout.tsx");
  });

  test("handles route groups, params and catch-all segments", async () => {
    const { root } = fixture(STANDARD_FILES);
    const { routes } = await scanProject({ root });

    expect(route(routes, "command", "mod case view").segments).toEqual(["mod", "case", "view"]);
    expect(route(routes, "button", "moderation/confirm-ban/[userId]").segments).toEqual(["confirm-ban", "[userId]"]);
    expect(route(routes, "button", "moderation/pages/[...rest]").file).toBe(
      "src/features/moderation/buttons/pages/[...rest]/button.tsx",
    );
    expect(route(routes, "modal", "moderation/ban-reason/[userId]").feature).toBe("moderation");
    expect(route(routes, "task", "moderation/cleanup").segments).toEqual(["cleanup"]);
  });

  test("allows several events with the same id", async () => {
    const { root } = fixture(STANDARD_FILES);
    const scan = await scanProject({ root });
    expect(scan.routes.filter((item) => item.kind === "event" && item.id === "guildMemberAdd")).toHaveLength(2);
    expect(scan.issues).toEqual([]);
  });

  test("collects invalid files with a reason", async () => {
    const { root } = fixture({
      "src/features/fun/commands/joke/handler.ts": "export {};\n",
      "src/features/fun/utils.ts": "export {};\n",
      "src/features/stray.ts": "export {};\n",
    });
    const scan = await scanProject({ root });
    expect(scan.issues.map((issue) => issue.file)).toEqual([
      "src/features/fun/commands/joke/handler.ts",
      "src/features/fun/utils.ts",
      "src/features/stray.ts",
    ]);
    expect(scan.issues[0]?.message).toContain('must be named "command.ts"');
    expect(scan.routes).toEqual([]);
  });

  test("detects colliding routes of the same kind but not across kinds", async () => {
    const { root } = fixture({
      "src/features/a/commands/ban/command.tsx": "export {};\n",
      "src/features/b/commands/(x)/ban/command.tsx": "export {};\n",
      "src/features/a/buttons/go/button.tsx": "export {};\n",
      "src/features/a/buttons/(y)/go/button.tsx": "export {};\n",
      "src/features/a/modals/go/modal.tsx": "export {};\n",
      "src/features/a/tasks/clean.ts": "export {};\n",
      "src/features/a/tasks/clean/run.ts": "export {};\n",
    });
    const scan = await scanProject({ root });
    const messages = scan.issues.map((issue) => `${issue.file} ${issue.message}`);

    expect(messages).toHaveLength(3);
    expect(messages.some((message) => message.includes('command route "ban"'))).toBe(true);
    expect(messages.some((message) => message.includes('button route "a/go"'))).toBe(true);
    expect(messages.some((message) => message.includes('task route "a/clean"'))).toBe(true);
    expect(messages.some((message) => message.includes("modal"))).toBe(false);
  });

  test("detects interaction routes the router cannot tell apart", async () => {
    const { root } = fixture({
      "src/features/a/buttons/go/[one]/button.tsx": "export {};\n",
      "src/features/a/buttons/go/[two]/button.tsx": "export {};\n",
      "src/features/a/selects/[...rest]/more/select.tsx": "export {};\n",
    });
    const scan = await scanProject({ root });
    expect(scan.issues.map((issue) => issue.message).join("\n")).toContain('uses param "two"');
    expect(scan.issues.map((issue) => issue.message).join("\n")).toContain("must end with its catch-all segment");
  });

  test("enforces slash command layout rules", async () => {
    const { root } = fixture({
      "src/features/a/commands/one/two/three/four/command.tsx": "export {};\n",
      "src/features/a/commands/mod/command.tsx": "export {};\n",
      "src/features/a/commands/mod/warn/command.tsx": "export {};\n",
      "src/features/a/commands/[bad]/command.tsx": "export {};\n",
      "src/features/a/commands/both/group.ts": "export {};\n",
      "src/features/a/commands/both/command.tsx": "export {};\n",
      "src/features/a/commands/shared/group.ts": "export {};\n",
      "src/features/b/commands/shared/group.ts": "export {};\n",
    });
    const scan = await scanProject({ root });
    const text = scan.issues.map((issue) => issue.message).join("\n");

    expect(text).toContain("at most 3 levels deep");
    expect(text).toContain('"/mod" cannot be both a command and the parent of "/mod warn"');
    expect(text).toContain('"[bad]" is not a valid slash command name');
    expect(text).toContain('"/both" cannot be both a command and a group');
    expect(text).toContain('The command group "shared"');
  });

  test("reports duplicate singleton files", async () => {
    const { root } = fixture({
      "src/context.ts": "export {};\n",
      "src/context.tsx": "export {};\n",
      "src/layout.ts": "export {};\n",
      "src/layout.tsx": "export {};\n",
      "src/features/a/feature.ts": "export {};\n",
      "src/features/a/feature.tsx": "export {};\n",
    });
    const scan = await scanProject({ root });
    expect(scan.issues.map((issue) => issue.file)).toEqual([
      "src/context.tsx",
      "src/features/a/feature.tsx",
      "src/layout.tsx",
    ]);
  });

  test("supports a features folder outside the source folder and missing folders", async () => {
    const { root } = fixture({
      "app/middleware.ts": "export {};\n",
      "modules/fun/commands/joke/command.tsx": "export {};\n",
    });
    const scan = await scanProject({ root, sourceDir: "app", featuresDir: "modules" });
    expect(scan.routes.map((item) => item.id)).toEqual(["joke"]);
    expect(scan.routes[0]?.middleware).toEqual(["app/middleware.ts"]);

    const empty = await scanProject({ root, sourceDir: "missing" });
    expect(empty.routes).toEqual([]);
    expect(empty.issues).toEqual([]);
  });

  test("ignores non-source and declaration files", async () => {
    const { root } = fixture({
      "src/features/notes.md": "# notes\n",
      "src/features/a/commands/joke/command.tsx": "export {};\n",
      "src/features/a/commands/joke/command.d.ts": "export {};\n",
    });
    const scan = await scanProject({ root });
    expect(scan.issues).toEqual([]);
    expect(scan.routes).toHaveLength(1);
  });
});
