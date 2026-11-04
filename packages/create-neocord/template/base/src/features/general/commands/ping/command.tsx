import { Message } from "@neocord/react";
import { defineCommand, option } from "neocord";

export default defineCommand({
  description: "Check that the bot is responding",
  options: {
    message: option.string({ description: "Text to send back", maxLength: 100 }),
  },
  execute(ctx) {
    return <Message>Pong! {ctx.options.message ?? `Gateway latency is ${ctx.client.ws.ping} ms.`}</Message>;
  },
});
