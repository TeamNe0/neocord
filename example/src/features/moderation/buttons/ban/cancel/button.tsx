import { TextDisplay } from "@neocord/react";
import { defineButton } from "neocord";

export default defineButton("moderation/ban/cancel", {
  guildOnly: true,
  permissions: ["BanMembers"],
  execute() {
    return <TextDisplay>Ban cancelled. Nothing happened.</TextDisplay>;
  },
});
