import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCommand, defineGroup } from "../index.ts";
import type { Manifest, ManifestRoute } from "../types.ts";
import { applicationIdFromToken, deployWithRest, type DeployRest } from "./deploy.ts";

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

const APP_A = "100000000000000001";
const APP_B = "200000000000000002";
const TOKEN_A = `${Buffer.from(APP_A).toString("base64")}.GAAAAA.signature`;
const TOKEN_B = `${Buffer.from(APP_B).toString("base64url")}.GBBBBB.signature`;

function stubRest(overrides: { getError?: unknown; applicationId?: string } = {}): StubRest {
  const stub: StubRest = {
    calls: [],
    token: null,
    setToken(token) {
      stub.token = token;
    },
    async get(path) {
      stub.calls.push({ method: "get", route: path });
      if (overrides.getError !== undefined) throw overrides.getError;
      return { id: overrides.applicationId ?? "app-1" };
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

  test("clear removes every command from a scope and forgets its hash", async () => {
    const options = { config: { token: "tok" }, manifest: manifest(), stateFile, guildId: "g1" };
    await deployWithRest(options, () => stubRest());

    const rest = stubRest();
    const result = await deployWithRest({ ...options, clear: true }, () => rest);
    expect(result.status).toBe("cleared");
    expect(result.commandCount).toBe(0);
    expect(rest.calls.find((call) => call.method === "put")?.body).toEqual([]);

    const state = JSON.parse(await readFile(stateFile, "utf8")) as { scopes: Record<string, unknown> };
    expect(state.scopes["guild:g1"]).toBeUndefined();

    const redeployed = await deployWithRest(options, () => stubRest());
    expect(redeployed.status).toBe("deployed");
  });

  test("clear ignores manifest errors and a dry run does not call Discord", async () => {
    const broken = manifest([route("Bad Name")]);
    const rest = stubRest();
    const preview = await deployWithRest({ config: {}, manifest: broken, clear: true, dryRun: true }, () => rest);
    expect(preview.status).toBe("dry-run");
    expect(rest.calls).toHaveLength(0);

    const cleared = await deployWithRest({ config: { token: "tok" }, manifest: broken, clear: true }, () => rest);
    expect(cleared.status).toBe("cleared");
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
    const deployed = await deployWithRest({ config: { token: TOKEN_A }, manifest: manifest(), stateFile }, () => first);
    const second = stubRest();
    const result = await deployWithRest({ config: { token: TOKEN_A }, manifest: manifest(), stateFile }, () => second);
    expect(result.status).toBe("unchanged");
    expect(result.hash).toBe(deployed.hash);
    expect(second.calls).toEqual([]);
  });

  describe("per application state", () => {
    test("a second application with the same commands deploys instead of reporting unchanged", async () => {
      await deployWithRest({ config: { token: TOKEN_A }, manifest: manifest(), stateFile }, () => stubRest());
      const rest = stubRest();
      const result = await deployWithRest({ config: { token: TOKEN_B }, manifest: manifest(), stateFile }, () => rest);
      expect(result.status).toBe("deployed");
      expect(rest.calls.map((call) => call.method)).toEqual(["get", "put"]);
      const state = JSON.parse(await readFile(stateFile, "utf8")) as { scopes: Record<string, { applicationId?: string }> };
      expect(state.scopes.global?.applicationId).toBe(APP_B);
    });

    test("switching back to the first application deploys again", async () => {
      await deployWithRest({ config: { token: TOKEN_A }, manifest: manifest(), stateFile }, () => stubRest());
      await deployWithRest({ config: { token: TOKEN_B }, manifest: manifest(), stateFile }, () => stubRest());
      const result = await deployWithRest({ config: { token: TOKEN_A }, manifest: manifest(), stateFile }, () => stubRest());
      expect(result.status).toBe("deployed");
    });

    test("a token that cannot be decoded falls back to the id from the API", async () => {
      const first = stubRest({ applicationId: "app-a" });
      await deployWithRest({ config: { token: "opaque-a" }, manifest: manifest(), stateFile }, () => first);
      const same = stubRest({ applicationId: "app-a" });
      const unchanged = await deployWithRest({ config: { token: "opaque-a" }, manifest: manifest(), stateFile }, () => same);
      expect(unchanged.status).toBe("unchanged");
      expect(same.calls.map((call) => call.method)).toEqual(["get"]);

      const other = stubRest({ applicationId: "app-b" });
      const deployed = await deployWithRest({ config: { token: "opaque-b" }, manifest: manifest(), stateFile }, () => other);
      expect(deployed.status).toBe("deployed");
      expect(other.calls.map((call) => call.method)).toEqual(["get", "put"]);
    });

    test("a state file from before this change is treated as not matching", async () => {
      const deployed = await deployWithRest({ config: { token: TOKEN_A }, manifest: manifest(), stateFile }, () => stubRest());
      await writeFile(
        stateFile,
        JSON.stringify({ version: 1, scopes: { global: { hash: deployed.hash, commandCount: 1, deployedAt: "2026-01-01T00:00:00.000Z" } } }),
      );
      const result = await deployWithRest({ config: { token: TOKEN_A }, manifest: manifest(), stateFile }, () => stubRest());
      expect(result.status).toBe("deployed");
    });

    test.each([["[1,2]"], ['{"version":1,"scopes":null}'], ['{"version":2}'], ['{"version":1,"scopes":{"global":7}}']])(
      "a malformed state file %s does not crash",
      async (content) => {
        await deployWithRest({ config: { token: TOKEN_A }, manifest: manifest(), stateFile }, () => stubRest());
        await writeFile(stateFile, content);
        const result = await deployWithRest({ config: { token: TOKEN_A }, manifest: manifest(), stateFile }, () => stubRest());
        expect(result.status).toBe("deployed");
      },
    );

    test("the id is decoded from the first segment of the token", () => {
      expect(applicationIdFromToken(TOKEN_A)).toBe(APP_A);
      expect(applicationIdFromToken(`Bot ${TOKEN_B}`)).toBe(APP_B);
      expect(applicationIdFromToken("not-a-token")).toBeNull();
      expect(applicationIdFromToken("")).toBeNull();
    });
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
