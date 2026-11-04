import { Message, TextDisplay } from "@teamneo/neocord-react";
import { defineCommand, option } from "neocord";
import { BanConfirm } from "../../_components/BanConfirm";

export default defineCommand({
  description: "Ban a member after confirming and giving a reason",
  guildOnly: true,
  permissions: ["BanMembers"],
  cooldown: "5s",
  options: {
    user: option.user({ description: "Who to ban", required: true }),
    announce: option.boolean({ description: "Show the confirmation to the whole channel" }),
  },
  execute(ctx) {
    const { user, announce } = ctx.options;
    if (user.id === ctx.user.id) {
      return (
        <Message ephemeral>
          <TextDisplay>You cannot ban yourself.</TextDisplay>
        </Message>
      );
    }
    return (
      <Message ephemeral={announce !== true}>
        <BanConfirm user={user} />
      </Message>
    );
  },
});
