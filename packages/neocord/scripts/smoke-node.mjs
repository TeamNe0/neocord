import assert from "node:assert/strict";
import { createElement, useState } from "react";
import { ActionRow, Button, TextDisplay } from "@teamneo/neocord-react";
import { defineButton, defineCommand, defineConfig, defineModal, option, parseDuration } from "neocord";
import { deployCommands, serializeCommands, startBot, startManager, validateManifest } from "neocord/runtime";
import { mockMember, mockUser, renderModalOf, runButton, runCommand, runModal } from "neocord/testing";

const ping = defineCommand({
  description: "Ping",
  options: { message: option.string({ description: "Text", required: true }) },
  execute: (ctx) => createElement(TextDisplay, null, `${ctx.user.username}: ${ctx.options.message}`),
});

const pinged = await runCommand(ping, { options: { message: "hello" }, user: mockUser({ username: "node" }) });
assert.equal(pinged.text, "node: hello");
assert.equal(pinged.replies.length, 1);
assert.equal(pinged.error, null);

const guarded = defineCommand({ description: "d", permissions: ["BanMembers"], execute: () => "ok" });
const denied = await runCommand(guarded, { member: mockMember({ permissions: ["SendMessages"] }) });
assert.match(denied.text, /Ban Members/);

const button = defineButton("core/go/[id]", { execute: (ctx) => `id ${ctx.params.id}` });
assert.equal((await runButton(button, { params: { id: 3 } })).text, "id 3");

const modal = defineModal("core/ask", {
  title: "Ask",
  render: () => createElement(TextDisplay, null, "body"),
  submit: (ctx) => `got ${ctx.values.reason}`,
});
assert.equal((await runModal(modal, { values: { reason: "x" } })).text, "got x");
assert.equal(renderModalOf(modal).custom_id, "core/ask");

function Counter() {
  const [count] = useState(1);
  return createElement(ActionRow, null, createElement(Button, { label: `n${count}`, onClick: () => undefined }));
}
const live = await runCommand(defineCommand({ description: "d", execute: () => createElement(Counter) }));
assert.match(JSON.stringify(live.replies[0]), /"custom_id":"~[0-9a-f]{16}:0"/);

const manifest = {
  version: 1,
  context: null,
  features: [],
  groups: [],
  routes: [
    {
      kind: "command",
      id: "ping",
      feature: "core",
      file: "ping.tsx",
      segments: ["ping"],
      module: { default: ping },
      middleware: [],
      layouts: [],
      error: null,
      loading: null,
    },
  ],
};
assert.deepEqual(validateManifest(manifest), []);
assert.equal(serializeCommands(manifest)[0].name, "ping");
assert.equal((await deployCommands({ config: {}, manifest, dryRun: true })).status, "dry-run");
assert.equal(typeof startBot, "function");
assert.equal(typeof startManager, "function");
assert.equal(defineConfig({ intents: ["Guilds"] }).__neocord, "config");
assert.equal(parseDuration("1h30m"), 5_400_000);

process.stdout.write(`smoke ok on ${typeof Bun === "undefined" ? `node ${process.version}` : "bun"}\n`);
process.exit(0);
