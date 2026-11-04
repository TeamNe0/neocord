import { TextDisplay } from "@neocord/react";
import { defineCommand } from "neocord";

export default defineCommand({
  description: "Check that the bot is responding",
  ephemeral: true,
  execute(ctx) {
    return <TextDisplay>Pong! Gateway latency is {ctx.client.ws.ping} ms.</TextDisplay>;
  },
});
