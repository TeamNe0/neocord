import assert from "node:assert/strict";
import { test } from "node:test";
import { runCommand } from "neocord/testing";
import command from "./command";

test("ping replies with the text it was given", async () => {
  const { replies } = await runCommand(command, { options: { message: "hello" } });

  assert.equal(replies.length, 1);
  assert.match(JSON.stringify(replies[0]), /hello/);
});
