import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCommand, defineGroup } from "../index.ts";
import type { Manifest, ManifestRoute } from "../types.ts";
import { deployWithRest, type DeployRest } from "./deploy.ts";

const execute = () => "ok";

function route(id: string, description = "Desc"): ManifestRoute {
  return {
    kind: "command",
    id,
    feature: "core",
    file: `${id}.tsx`,
    segments: id.split(" "),
    module: { default: defineCommand({ description, guildOnly: true, execute }) },
    middleware: [],
    layouts: [],
    error: null,
    loading: null,
  };
}

function manifest(routes: ManifestRoute[] = [route("ban")], groups: Manifest["groups"] = []): Manifest {
  return { version: 1, context: null, features: [], groups, routes };
}

interface StubRest extends DeployRest {
  calls: { method: string; route: string; body?: unknown }[];
  token: string | null;
}

function stubRest(overrides: { getError?: unknown } = {}): StubRest {
  const stub: StubRest = {
    calls: [],
    token: null,
    setToken(token) {
      stub.token = token;
    },
    async get(path) {
      stub.calls.push({ method: "get", route: path });
      if (overrides.getError !== undefined) throw overrides.getError;
      return { id: "app-1" };
    },
    async put(path, options) {
      stub.calls.push({ method: "put", route: path, body: options.body });
      return [];
    },
  };
  return stub;
}

describe("deployCommands", () => {
  let directory: string;
  let stateFile: string;
  const originalToken = process.env.DISCORD_TOKEN;
  const originalLevel = process.env.NEOCORD_LOG_LEVEL;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "neocord-deploy-"));
    stateFile = join(directory, "nested", "deploy.json");
    delete process.env.DISCORD_TOKEN;
    process.env.NEOCORD_LOG_LEVEL = "silent";
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    if (originalToken === undefined) delete process.env.DISCORD_TOKEN;
    else process.env.DISCORD_TOKEN = originalToken;
    if (originalLevel === undefined) delete process.env.NEOCORD_LOG_LEVEL;
    else process.env.NEOCORD_LOG_LEVEL = originalLevel;
  });

  test("deploys globally through the current application route", async () => {
    const rest = stubRest();
    const result = await deployWithRest({ config: { token: "tok" }, manifest: manifest(), stateFile }, () => rest);
    expect(result.status).toBe("deployed");
    expect(result.scope).toBe("global");
    expect(result.commandCount).toBe(1);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rest.token).toBe("tok");
    expect(rest.calls.map((call) => `${call.method} ${call.route}`)).toEqual([
      "get /oauth2/applications/@me",
      "put /applications/app-1/commands",
    ]);
    const body = rest.calls[1]?.body as { contexts?: number[] }[];
    expect(body[0]?.contexts).toEqual([0]);
  });

  test("deploys to a guild without contexts", async () => {
    const rest = stubRest();
    const result = await deployWithRest({ config: { token: "tok" }, manifest: manifest(), guildId: "g1" }, () => rest);
    expect(result.scope).toBe("guild");
    expect(result.guildId).toBe("g1");
    expect(rest.calls[1]?.route).toBe("/applications/app-1/guilds/g1/commands");
    const body = rest.calls[1]?.body as { contexts?: number[] }[];
    expect(body[0]?.contexts).toBeUndefined();
  });

  test("uses DISCORD_TOKEN when the config has none", async () => {
    process.env.DISCORD_TOKEN = "env-token";
    const rest = stubRest();
    await deployWithRest({ config: {}, manifest: manifest() }, () => rest);
    expect(rest.token).toBe("env-token");
  });

  test("skips when the hash in the state file matches", async () => {
    const first = stubRest();
    const deployed = await deployWithRest({ config: { token: "t" }, manifest: manifest(), stateFile }, () => first);
    const second = stubRest();
    const result = await deployWithRest({ config: { token: "t" }, manifest: manifest(), stateFile }, () => second);
    expect(result.status).toBe("unchanged");
    expect(result.hash).toBe(deployed.hash);
    expect(second.calls).toEqual([]);
  });

  test("does not need a token when unchanged", async () => {
    await deployWithRest({ config: { token: "t" }, manifest: manifest(), stateFile }, () => stubRest());
    const result = await deployWithRest({ config: {}, manifest: manifest(), stateFile }, () => stubRest());
    expect(result.status).toBe("unchanged");
  });

  test("force deploys even when unchanged", async () => {
    await deployWithRest({ config: { token: "t" }, manifest: manifest(), stateFile }, () => stubRest());
    const rest = stubRest();
    const result = await deployWithRest({ config: { token: "t" }, manifest: manifest(), stateFile, force: true }, () => rest);
    expect(result.status).toBe("deployed");
    expect(rest.calls).toHaveLength(2);
  });

  test("a changed payload deploys again", async () => {
    await deployWithRest({ config: { token: "t" }, manifest: manifest(), stateFile }, () => stubRest());
    const rest = stubRest();
    const result = await deployWithRest(
      { config: { token: "t" }, manifest: manifest([route("ban", "Changed")]), stateFile },
      () => rest,
    );
    expect(result.status).toBe("deployed");
  });

  test("scope is part of the hash and tracked separately", async () => {
    const global = await deployWithRest({ config: { token: "t" }, manifest: manifest(), stateFile }, () => stubRest());
    const guild = await deployWithRest(
      { config: { token: "t" }, manifest: manifest(), stateFile, guildId: "g1" },
      () => stubRest(),
    );
    expect(guild.status).toBe("deployed");
    expect(guild.hash).not.toBe(global.hash);
    const state = JSON.parse(await readFile(stateFile, "utf8")) as { scopes: Record<string, { hash: string }> };
    expect(state.scopes.global?.hash).toBe(global.hash);
    expect(state.scopes["guild:g1"]?.hash).toBe(guild.hash);

    const again = await deployWithRest({ config: { token: "t" }, manifest: manifest(), stateFile }, () => stubRest());
    expect(again.status).toBe("unchanged");
  });

  test("dry run touches nothing and needs no token", async () => {
    const rest = stubRest();
    const result = await deployWithRest({ config: {}, manifest: manifest(), stateFile, dryRun: true }, () => rest);
    expect(result.status).toBe("dry-run");
    expect(result.commands).toHaveLength(1);
    expect(rest.calls).toEqual([]);
    await expect(readFile(stateFile, "utf8")).rejects.toThrow();
  });

  test("a corrupt state file is treated as empty", async () => {
    await deployWithRest({ config: { token: "t" }, manifest: manifest(), stateFile }, () => stubRest());
    const { writeFile } = await import("node:fs/promises");
    await writeFile(stateFile, "not json");
    const result = await deployWithRest({ config: { token: "t" }, manifest: manifest(), stateFile }, () => stubRest());
    expect(result.status).toBe("deployed");
  });

  test("a missing token has an actionable message", async () => {
    await expect(deployWithRest({ config: {}, manifest: manifest() }, () => stubRest())).rejects.toThrow(
      "No Discord bot token found",
    );
  });

  test("a rejected token has an actionable message", async () => {
    const rest = stubRest({ getError: Object.assign(new Error("401"), { status: 401 }) });
    await expect(deployWithRest({ config: { token: "t" }, manifest: manifest() }, () => rest)).rejects.toThrow(
      "Discord rejected the bot token",
    );
  });

  test("refuses to deploy an invalid manifest", async () => {
    await expect(
      deployWithRest({ config: { token: "t" }, manifest: manifest([route("mod warn")]) }, () => stubRest()),
    ).rejects.toThrow('"/mod" has subcommands but no group.ts');

    const good = await deployWithRest(
      {
        config: { token: "t" },
        manifest: manifest(
          [route("mod warn")],
          [{ feature: "core", segments: ["mod"], file: "g.ts", module: { default: defineGroup({ description: "Mod" }) } }],
        ),
      },
      () => stubRest(),
    );
    expect(good.status).toBe("deployed");
  });
});
