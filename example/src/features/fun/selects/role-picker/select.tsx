import { List, ListItem, RoleMention, Subtext, TextDisplay } from "@neocord/react";
import { defineSelect } from "neocord";

export default defineSelect("fun/role-picker", {
  type: "role",
  guildOnly: true,
  ephemeral: true,
  respond: "reply",
  async execute(ctx) {
    const grantable = ctx.roles.filter((role) => !role.managed && role.permissions.bitfield === 0n);
    if (grantable.size === 0) {
      return <Subtext>None of those roles can be self-assigned.</Subtext>;
    }
    await ctx.member.roles.add([...grantable.keys()], "Picked with /role-picker");
    return (
      <TextDisplay>
        You now have:
        <List>
          {grantable.map((role) => (
            <ListItem key={role.id}>
              <RoleMention id={role.id} />
            </ListItem>
          ))}
        </List>
      </TextDisplay>
    );
  },
});
