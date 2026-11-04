import { describe, expect, test } from "bun:test";
import {
  defineButton,
  defineCommand,
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
} from "../index.ts";
import type { Manifest, ManifestRoute } from "../types.ts";
import { validateManifest, type ManifestIssue } from "./validate.ts";

const execute = () => "ok";

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

function manifest(partial: Partial<Manifest>): Manifest {
  return { version: 1, context: null, features: [], groups: [], routes: [], ...partial };
}

function errors(issues: ManifestIssue[]): string[] {
  return issues.filter((issue) => issue.severity === "error").map((issue) => issue.message);
}

function warnings(issues: ManifestIssue[]): string[] {
  return issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message);
}

const goodCommand = defineCommand({ description: "Good", execute });

describe("validateManifest", () => {
  test("a valid manifest has no issues", () => {
    const issues = validateManifest(
      manifest({
        context: { default: defineContext(() => ({ value: {} })) },
        features: [{ name: "core", module: { default: defineFeature({}) } }, { name: "plain", module: null }],
        groups: [{ feature: "core", segments: ["mod"], file: "g.ts", module: { default: defineGroup({ description: "Mod" }) } }],
        routes: [
          route("command", "ban", goodCommand),
          route("command", "mod warn", goodCommand),
          route("user-command", "core/report", defineUserCommand({ name: "Report", execute })),
          route("message-command", "core/quote", defineMessageCommand({ name: "Quote", execute })),
          route("button", "core/a/[id]", defineButton("core/a/[id]", { execute })),
          route("select", "core/a/[id]", defineSelect("core/a/[id]", { execute })),
          route("modal", "core/a/[id]", defineModal("core/a/[id]", { title: "t", render: () => null, submit: execute })),
          route("event", "clientReady", defineEvent("clientReady", { execute })),
          route("task", "core/job", defineTask({ every: "5m", execute })),
        ],
      }),
    );
    expect(issues).toEqual([]);
  });

  test("reports modules without a brand, naming the file", () => {
    const issues = validateManifest(
      manifest({
        context: { default: {} },
        features: [{ name: "core", module: { default: {} } }],
        groups: [{ feature: "core", segments: ["a"], file: "group.ts", module: {} }],
        routes: [
          route("command", "ban", { description: "x" }),
          route("button", "core/a", defineSelect("core/a", { execute })),
          route("command", "ok", goodCommand, {
            middleware: [{ file: "mw.ts", module: { default: () => undefined } }],
            layouts: [{ file: "layout.tsx", module: { default: "nope" } }],
            error: { file: "error.tsx", module: {} },
            loading: { file: "loading.tsx", module: { default: 1 } },
          }),
        ],
      }),
    );
    const found = errors(issues).join("\n");
    expect(found).toContain("src/context.ts must default export defineContext");
    expect(found).toContain('Feature "core" must default export defineFeature');
    expect(found).toContain("group.ts must default export defineGroup");
    expect(found).toContain('f/command/ban.tsx must default export defineCommand(...). Its default export has no "command" brand');
    expect(found).toContain('f/button/core/a.tsx must default export defineButton');
    expect(found).toContain("mw.ts must default export defineMiddleware");
    expect(found).toContain("layout.tsx must default export a React component");
    expect(found).toContain("error.tsx must default export a React component");
    expect(found).toContain("loading.tsx must default export a React component");
  });

  test("route literals must equal the route id", () => {
    const issues = validateManifest(
      manifest({
        routes: [
          route("button", "core/right", defineButton("core/wrong", { execute })),
          route("select", "core/right", defineSelect("core/wrong", { execute })),
          route("modal", "core/right", defineModal("core/wrong", { title: "t", render: () => null, submit: execute })),
        ],
      }),
    );
    expect(errors(issues)).toEqual([
      'defineButton() was given "core/wrong" but this file\'s route is "core/right".',
      'defineSelect() was given "core/wrong" but this file\'s route is "core/right".',
      'defineModal() was given "core/wrong" but this file\'s route is "core/right".',
    ]);
  });

  test("event names must equal the route id", () => {
    const issues = validateManifest(
      manifest({ routes: [route("event", "guildCreate", defineEvent("guildDelete", { execute }))] }),
    );
    expect(errors(issues)[0]).toContain('defineEvent() was given "guildDelete"');
  });

  test("depth, names and description lengths", () => {
    const deep = validateManifest(
      manifest({
        groups: [
          { feature: "core", segments: ["a"], file: "1.ts", module: { default: defineGroup({ description: "d" }) } },
          { feature: "core", segments: ["a", "b"], file: "2.ts", module: { default: defineGroup({ description: "d" }) } },
          { feature: "core", segments: ["a", "b", "c"], file: "3.ts", module: { default: defineGroup({ description: "d" }) } },
        ],
        routes: [route("command", "a b c d", goodCommand)],
      }),
    );
    expect(errors(deep).join("\n")).toContain("Commands allow at most 3 segments");
    expect(errors(deep).join("\n")).toContain('Group "/a b c" is too deep');

    const bad = validateManifest(
      manifest({
        routes: [
          route("command", "Upper", goodCommand),
          route("command", "long", defineCommand({ description: "x".repeat(101), execute })),
          route("command", "empty", defineCommand({ description: "", execute })),
        ],
      }),
    );
    const found = errors(bad).join("\n");
    expect(found).toContain('"Upper" is not a valid command name');
    expect(found).toContain("/long needs a description of 1-100 characters");
    expect(found).toContain("/empty needs a description of 1-100 characters");
  });

  test("option limits", () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 26 }, (_, index) => [`o${index}`, option.string({ description: "d" })]),
    );
    const issues = validateManifest(
      manifest({
        routes: [
          route("command", "many", defineCommand({ description: "d", options: tooMany, execute })),
          route(
            "command",
            "bad",
            defineCommand({
              description: "d",
              options: {
                Upper: option.string({ description: "d" }),
                blank: option.string({ description: "" }),
                nochoices: option.string({ description: "d", choices: [] }),
                both: { ...option.string({ description: "d", choices: [{ name: "a", value: "a" }] }), autocomplete: () => [] },
                longchoice: option.string({ description: "d", choices: [{ name: "x".repeat(101), value: "a" }] }),
                raw: { kind: "string", description: "d" } as never,
              },
              execute,
            }),
          ),
        ],
      }),
    );
    const found = errors(issues).join("\n");
    expect(found).toContain("/many has 26 options");
    expect(found).toContain('option "Upper" has an invalid name');
    expect(found).toContain('option "blank" needs a description');
    expect(found).toContain('option "nochoices" needs 1-25 choices');
    expect(found).toContain('option "both" cannot use both choices and autocomplete');
    expect(found).toContain('option "longchoice" has a choice name outside');
    expect(found).toContain('option "raw" must be created with an option.* helper');
  });

  test("duplicate commands across features are errors", () => {
    const issues = validateManifest(
      manifest({
        routes: [
          route("command", "ban", goodCommand, { feature: "one", file: "one/ban.tsx" }),
          route("command", "ban", goodCommand, { feature: "two", file: "two/ban.tsx" }),
          route("user-command", "one/r", defineUserCommand({ name: "Report", execute }), { file: "u1.tsx" }),
          route("user-command", "two/r", defineUserCommand({ name: "Report", execute }), { file: "u2.tsx" }),
          route("message-command", "two/r", defineMessageCommand({ name: "Report", execute }), { file: "m.tsx" }),
        ],
      }),
    );
    const found = errors(issues).join("\n");
    expect(found).toContain('/ban is also defined by one/ban.tsx (feature "one")');
    expect(found).toContain('user-command "Report" is also defined by u1.tsx');
    expect(found.match(/also defined/g)).toHaveLength(2);
  });

  test("groups: missing, leaf conflict, empty and duplicate", () => {
    const issues = validateManifest(
      manifest({
        groups: [
          { feature: "core", segments: ["ban"], file: "ban-group.ts", module: { default: defineGroup({ description: "d" }) } },
          { feature: "core", segments: ["unused"], file: "unused.ts", module: { default: defineGroup({ description: "d" }) } },
          { feature: "a", segments: ["dup"], file: "dup1.ts", module: { default: defineGroup({ description: "d" }) } },
          { feature: "b", segments: ["dup"], file: "dup2.ts", module: { default: defineGroup({ description: "d" }) } },
          { feature: "b", segments: ["blank"], file: "blank.ts", module: { default: defineGroup({ description: "" }) } },
        ],
        routes: [
          route("command", "ban", goodCommand),
          route("command", "mod warn", goodCommand),
          route("command", "dup x", goodCommand),
          route("command", "blank x", goodCommand),
        ],
      }),
    );
    const found = errors(issues).join("\n");
    expect(found).toContain('"/mod" has subcommands but no group.ts');
    expect(found).toContain('"/ban" cannot be both a group and a command');
    expect(found).toContain('Group "/dup" is also defined by dup1.ts');
    expect(found).toContain('Group "/blank" needs a description');
    expect(warnings(issues).join("\n")).toContain('Group "/unused" has no subcommands');
  });

  test("a command cannot also be a parent", () => {
    const issues = validateManifest(
      manifest({
        groups: [{ feature: "core", segments: ["mod"], file: "g.ts", module: { default: defineGroup({ description: "d" }) } }],
        routes: [route("command", "mod", goodCommand), route("command", "mod warn", goodCommand)],
      }),
    );
    expect(errors(issues).join("\n")).toContain('"/mod" cannot be both');
  });

  test("subcommand permissions and guildOnly warn about runtime only enforcement", () => {
    const issues = validateManifest(
      manifest({
        groups: [
          { feature: "core", segments: ["mod"], file: "g.ts", module: { default: defineGroup({ description: "d" }) } },
          { feature: "core", segments: ["mod", "x"], file: "x.ts", module: { default: defineGroup({ description: "d", guildOnly: true }) } },
        ],
        routes: [
          route("command", "mod warn", defineCommand({ description: "d", permissions: ["BanMembers"], guildOnly: true, execute })),
          route("command", "mod x y", goodCommand),
        ],
      }),
    );
    const found = warnings(issues).join("\n");
    expect(found).toContain("sets permissions on a subcommand");
    expect(found).toContain("sets guildOnly on a subcommand");
    expect(found).toContain('Group "/mod x" is nested');
  });

  test("interaction route limits and conflicts", () => {
    const long = `core/${"x".repeat(100)}`;
    const issues = validateManifest(
      manifest({
        routes: [
          route("button", long, defineButton(long, { execute })),
          route("button", "~core/a", defineButton("~core/a", { execute })),
          route("button", "core/[a]/x", defineButton("core/[a]/x", { execute })),
          route("button", "core/[b]/y", defineButton("core/[b]/y", { execute })),
        ],
      }),
    );
    const found = errors(issues).join("\n");
    expect(found).toContain("exceeds Discord's 100 character custom id limit");
    expect(found).toContain('starts with "~"');
    expect(found).toContain('uses param "b" where "a" is already registered');
  });

  test("a button and a modal can share an id", () => {
    const issues = validateManifest(
      manifest({
        routes: [
          route("button", "core/same", defineButton("core/same", { execute })),
          route("modal", "core/same", defineModal("core/same", { title: "t", render: () => null, submit: execute })),
        ],
      }),
    );
    expect(issues).toEqual([]);
  });

  test("durations are checked", () => {
    const issues = validateManifest(
      manifest({
        routes: [
          route("task", "core/bad", defineTask({ every: "soon" as never, execute })),
          route("task", "core/zero", defineTask({ every: 0, execute })),
          route("command", "ban", defineCommand({ description: "d", cooldown: "later" as never, execute })),
        ],
      }),
    );
    const found = errors(issues).join("\n");
    expect(found).toContain('every: Invalid duration "soon"');
    expect(found).toContain("every must be between");
    expect(found).toContain('cooldown: Invalid duration "later"');
  });

  test("intents are checked against config and enabled features", () => {
    const routes = [
      route("event", "guildMemberAdd", defineEvent("guildMemberAdd", { execute })),
      route("event", "messageCreate", defineEvent("messageCreate", { execute })),
      route("event", "presenceUpdate", defineEvent("presenceUpdate", { execute })),
      route("event", "clientReady", defineEvent("clientReady", { execute })),
    ];

    const missing = warnings(validateManifest(manifest({ routes }), { intents: ["Guilds"] })).join("\n");
    expect(missing).toContain('"guildMemberAdd" needs the GuildMembers intent');
    expect(missing).toContain('"messageCreate" needs the GuildMessages or DirectMessages intent');
    expect(missing).toContain("MessageContent intent");
    expect(missing).toContain('"presenceUpdate" needs the GuildPresences intent');
    expect(missing).not.toContain("clientReady");

    const covered = warnings(
      validateManifest(
        manifest({
          routes,
          features: [
            {
              name: "core",
              module: { default: defineFeature({ intents: ["GuildMembers", "GuildMessages", "MessageContent", "GuildPresences"] }) },
            },
          ],
        }),
        { intents: ["Guilds"] },
      ),
    );
    expect(covered).toEqual([]);

    expect(warnings(validateManifest(manifest({ routes })))).toEqual([]);
  });

  test("warns when the Guilds intent is missing", () => {
    expect(warnings(validateManifest(manifest({}), { intents: ["GuildMessages"] })).join("\n")).toContain(
      "Guilds intent is not enabled",
    );
  });

  test("disabled features are ignored", () => {
    const issues = validateManifest(
      manifest({
        features: [{ name: "off", module: { default: defineFeature({ enabled: false, intents: ["GuildPresences"] }) } }],
        groups: [{ feature: "off", segments: ["x"], file: "x.ts", module: {} }],
        routes: [
          route("command", "Bad Name", { nope: true }, { feature: "off" }),
          route("event", "presenceUpdate", defineEvent("presenceUpdate", { execute })),
        ],
      }),
      { intents: ["Guilds"] },
    );
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues).join("\n")).toContain('"presenceUpdate" needs the GuildPresences intent');
  });

  test("middleware modules are only reported once", () => {
    const middleware = [{ file: "mw.ts", module: { default: 1 } }];
    const issues = validateManifest(
      manifest({
        routes: [route("command", "a", goodCommand, { middleware }), route("command", "b", goodCommand, { middleware })],
      }),
    );
    expect(errors(issues).filter((message) => message.includes("mw.ts"))).toHaveLength(1);
    expect(defineMiddleware(() => undefined).__neocord).toBe("middleware");
  });
});
