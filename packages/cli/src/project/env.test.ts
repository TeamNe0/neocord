import { afterEach, describe, expect, test } from "bun:test";
import { createFixture, type Fixture } from "../test-support/fixture.ts";
import { applyEnv, envFileNames, loadEnvFiles } from "./env.ts";

const fixtures: Fixture[] = [];

function fixture(files: Record<string, string>): Fixture {
  const created = createFixture({ files, stubs: false });
  fixtures.push(created);
  return created;
}

afterEach(() => {
  for (const created of fixtures.splice(0)) created.cleanup();
});

describe("loadEnvFiles", () => {
  test("loads files in the documented order, later files overriding earlier ones", () => {
    const { root } = fixture({
      ".env": "A=env\nB=env\nC=env\nD=env\n",
      ".env.local": "B=local\nC=local\nD=local\n",
      ".env.development": "C=mode\nD=mode\n",
      ".env.development.local": "D=mode-local\n",
      ".env.production": "A=wrong-mode\n",
    });
    const loaded = loadEnvFiles({ root, mode: "development", env: {}, bunAutoload: false });
    expect(loaded.files).toEqual([".env", ".env.local", ".env.development", ".env.development.local"]);
    expect(loaded.env).toMatchObject({ A: "env", B: "local", C: "mode", D: "mode-local" });
  });

  test("a real environment variable always wins", () => {
    const { root } = fixture({ ".env": "A=env\n", ".env.test.local": "A=file\n" });
    const loaded = loadEnvFiles({ root, mode: "test", env: { A: "real", OTHER: "kept" }, bunAutoload: false });
    expect(loaded.env.A).toBe("real");
    expect(loaded.env.OTHER).toBe("kept");
  });

  test("sets NODE_ENV to the mode", () => {
    const { root } = fixture({ ".env": "NODE_ENV=staging\n" });
    expect(loadEnvFiles({ root, mode: "production", env: {}, bunAutoload: false }).env.NODE_ENV).toBe("production");
    expect(loadEnvFiles({ root, mode: "test", env: { NODE_ENV: "x" }, bunAutoload: false }).env.NODE_ENV).toBe("test");
  });

  test("works without any env files", () => {
    const { root } = fixture({});
    const loaded = loadEnvFiles({ root, mode: "development", env: {}, bunAutoload: false });
    expect(loaded.files).toEqual([]);
    expect(loaded.fromFiles).toEqual({});
  });

  test("does not treat values auto-loaded by bun as real", () => {
    const { root } = fixture({
      ".env": "A=env\nGONE=dev-only-elsewhere\n",
      ".env.local": "B=local\n",
      ".env.production": "A=production\n",
      ".env.development": "ONLY_DEV=dev\n",
    });
    const autoloaded = { A: "env", B: "local", ONLY_DEV: "dev", REAL: "real" };
    const loaded = loadEnvFiles({ root, mode: "production", env: autoloaded, bunAutoload: true });
    expect(loaded.env.A).toBe("production");
    expect(loaded.env.B).toBe("local");
    expect(loaded.env.ONLY_DEV).toBeUndefined();
    expect(loaded.env.REAL).toBe("real");
  });

  test("still prefers a real value that differs from the files under bun", () => {
    const { root } = fixture({ ".env": "A=env\n" });
    expect(loadEnvFiles({ root, mode: "production", env: { A: "real" }, bunAutoload: true }).env.A).toBe("real");
  });

  test("adds SKIP_ENV_VALIDATION only when asked and not already set", () => {
    const { root } = fixture({});
    const base = { root, mode: "production" as const, bunAutoload: false };
    expect(loadEnvFiles({ ...base, env: {} }).env.SKIP_ENV_VALIDATION).toBeUndefined();
    expect(loadEnvFiles({ ...base, env: {}, skipValidation: true }).env.SKIP_ENV_VALIDATION).toBe("true");
    expect(loadEnvFiles({ ...base, env: { SKIP_ENV_VALIDATION: "no" }, skipValidation: true }).env.SKIP_ENV_VALIDATION).toBe("no");
  });

  test("keeps a SKIP_ENV_VALIDATION from an env file", () => {
    const { root } = fixture({ ".env": "SKIP_ENV_VALIDATION=custom\n" });
    const loaded = loadEnvFiles({ root, mode: "production", env: {}, bunAutoload: false, skipValidation: true });
    expect(loaded.env.SKIP_ENV_VALIDATION).toBe("custom");
  });

  test("lists the file names for a mode", () => {
    expect(envFileNames("test")).toEqual([".env", ".env.local", ".env.test", ".env.test.local"]);
  });
});

describe("applyEnv", () => {
  test("adds, updates and removes keys", () => {
    const target: NodeJS.ProcessEnv = { KEEP: "same", OLD: "gone", CHANGED: "before" };
    applyEnv(target, { KEEP: "same", CHANGED: "after", NEW: "added" });
    expect({ ...target }).toEqual({ KEEP: "same", CHANGED: "after", NEW: "added" });
  });
});
