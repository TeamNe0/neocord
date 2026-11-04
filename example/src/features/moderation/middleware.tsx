import { Message, TextDisplay } from "@neocord/react";
import { defineMiddleware } from "neocord";

export default defineMiddleware(
  async (ctx, next) => {
    if (!ctx.member?.permissions.any(["BanMembers", "KickMembers", "ModerateMembers"])) {
      return (
        <Message ephemeral>
          <TextDisplay>Only moderators can do that.</TextDisplay>
        </Message>
      );
    }
    ctx.state.moderatorId = ctx.user.id;
    await next();
  },
  { kinds: ["command", "user-command", "button", "select", "modal"] },
);
