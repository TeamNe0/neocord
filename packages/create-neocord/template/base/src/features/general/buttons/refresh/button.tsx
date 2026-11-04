import { ActionRow, Button, Container, Heading } from "@neocord/react";
import { defineButton } from "neocord";
import { Stat } from "../../_components/Stat";

export default defineButton("general/refresh", {
  execute(ctx) {
    return (
      <Container accentColor="#5865f2">
        <Heading>About {ctx.client.user.username}</Heading>
        <Stat label="Servers" value={ctx.client.guilds.cache.size} />
        <Stat label="Latency" value={`${ctx.client.ws.ping} ms`} />
        <ActionRow>
          <Button route="general/refresh" style="secondary">
            Refresh
          </Button>
        </ActionRow>
      </Container>
    );
  },
});
