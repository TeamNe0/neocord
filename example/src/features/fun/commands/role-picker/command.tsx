import { ActionRow, Container, Heading, RoleSelect, Subtext } from "@neocord/react";
import { defineCommand } from "neocord";

export default defineCommand({
  description: "Post a menu people can use to give themselves roles",
  guildOnly: true,
  permissions: ["ManageRoles"],
  execute() {
    return (
      <Container accentColor="fuchsia">
        <Heading level={3}>Pick your roles</Heading>
        <Subtext>Roles with permissions or managed by an integration cannot be picked.</Subtext>
        <ActionRow>
          <RoleSelect route="fun/role-picker" placeholder="Choose roles" minValues={1} maxValues={5} />
        </ActionRow>
      </Container>
    );
  },
});
