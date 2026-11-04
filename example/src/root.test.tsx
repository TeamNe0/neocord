import { describe, expect, test } from "bun:test";
import { TextDisplay } from "@teamneo/neocord-react";
import { defineCommand } from "neocord";
import { runCommand } from "neocord/testing";
import RootError from "./error";
import RootLayout from "./layout";
import rootMiddleware from "./middleware";
import { createRecordingLogger } from "./test-support/logger";

const hello = defineCommand({
  description: "Say hello",
  execute: () => <TextDisplay>hello</TextDisplay>,
});

describe("root segment files", () => {
  test("middleware logs every interaction after it finishes", async () => {
    const logger = createRecordingLogger();
    const { text } = await runCommand(hello, { middleware: [rootMiddleware], logger });

    expect(text).toBe("hello");
    expect(logger.lines.some((line) => /^info: command test for \d+ took \d+ms$/.test(line))).toBe(true);
  });

  test("layout adds a footer naming the feature and shard", async () => {
    const { text } = await runCommand(hello, { layouts: [RootLayout] });

    expect(text).toBe("hello\n-# test on shard 0");
  });

  test("error view replaces the built-in message and is ephemeral", async () => {
    const broken = defineCommand({
      description: "Break",
      execute() {
        throw new Error("secret details");
      },
    });
    const { text, ephemeral, error } = await runCommand(broken, { error: RootError });

    expect(text).toContain("Something went wrong");
    expect(text).not.toContain("secret details");
    expect(ephemeral).toBe(true);
    expect(error).toBeInstanceOf(Error);
  });
});
