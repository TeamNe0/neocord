import { afterEach, describe, expect, test } from "bun:test";
import { createLogger, resolveLogLevel, type LogMethod } from "./logger.ts";

function capture(options: Parameters<typeof createLogger>[0] = {}) {
  const lines: { level: LogMethod; line: string }[] = [];
  const logger = createLogger({ level: "debug", ...options, sink: (level, line) => lines.push({ level, line }) });
  return { logger, lines };
}

const FAKE_TOKEN = `${"a".repeat(24)}.${"b".repeat(6)}.${"c".repeat(27)}`;

describe("logger", () => {
  const originalLevel = process.env.NEOCORD_LOG_LEVEL;
  const originalToken = process.env.DISCORD_TOKEN;

  afterEach(() => {
    if (originalLevel === undefined) delete process.env.NEOCORD_LOG_LEVEL;
    else process.env.NEOCORD_LOG_LEVEL = originalLevel;
    if (originalToken === undefined) delete process.env.DISCORD_TOKEN;
    else process.env.DISCORD_TOKEN = originalToken;
  });

  test("respects the level", () => {
    const { logger, lines } = capture({ level: "warn" });
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    expect(lines.map((entry) => entry.level)).toEqual(["warn", "error"]);
  });

  test("silent logs nothing", () => {
    const { logger, lines } = capture({ level: "silent" });
    logger.error("nope");
    expect(lines).toEqual([]);
  });

  test("env overrides config, and an invalid env value is ignored", () => {
    delete process.env.NEOCORD_LOG_LEVEL;
    expect(resolveLogLevel()).toBe("info");
    expect(resolveLogLevel("error")).toBe("error");
    process.env.NEOCORD_LOG_LEVEL = "DEBUG";
    expect(resolveLogLevel("error")).toBe("debug");
    process.env.NEOCORD_LOG_LEVEL = "loud";
    expect(resolveLogLevel("error")).toBe("error");
  });

  test("prefixes shard ids and scopes", () => {
    const { logger, lines } = capture({ shard: 3 });
    logger.info("one");
    logger.child("route").child("nested").info("two");
    expect(lines[0]?.line).toContain("[shard 3] one");
    expect(lines[1]?.line).toContain("[shard 3 route nested] two");
    const multi = capture({ shard: [0, 1] });
    multi.logger.info("x");
    expect(multi.lines[0]?.line).toContain("[shard 0,1] x");
  });

  test("never leaks a token in messages, details or errors", () => {
    const { logger, lines } = capture({ secrets: ["my-explicit-secret"] });
    logger.info(`token is ${FAKE_TOKEN}`);
    logger.warn("details", { token: FAKE_TOKEN, nested: { token: FAKE_TOKEN } });
    logger.error("failed", new Error(`bad ${FAKE_TOKEN}`));
    logger.info("explicit my-explicit-secret value");
    const all = lines.map((entry) => entry.line).join("\n");
    expect(all).not.toContain(FAKE_TOKEN);
    expect(all).not.toContain("my-explicit-secret");
    expect(all).toContain("[redacted]");
  });

  test("redacts the DISCORD_TOKEN env value even if it has an unusual shape", () => {
    process.env.DISCORD_TOKEN = "short-env-token";
    const { logger, lines } = capture();
    logger.info("value short-env-token here");
    expect(lines[0]?.line).toBe(lines[0]?.line.replace("short-env-token", "[redacted]"));
    expect(lines[0]?.line).toContain("value [redacted] here");
  });

  test("redaction survives child loggers", () => {
    const { logger, lines } = capture({ secrets: ["child-secret"] });
    logger.child("x").error("child-secret");
    expect(lines[0]?.line).not.toContain("child-secret");
  });

  test("formats errors with stacks and objects compactly", () => {
    const { logger, lines } = capture();
    logger.error("boom", new Error("inner"));
    logger.info("object", { a: 1 });
    expect(lines[0]?.line).toContain("Error: inner");
    expect(lines[1]?.line).toContain("{ a: 1 }");
  });
});
