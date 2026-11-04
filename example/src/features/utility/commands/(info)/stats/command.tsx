import { Bold, Container, Heading, List, ListItem, TextDisplay } from "@teamneo/neocord-react";
import { defineCommand } from "neocord";

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default defineCommand({
  description: "Show numbers from every shard",
  cooldown: "10s",
  async execute(ctx) {
    const [guildCounts, shards] = await Promise.all([
      ctx.shards.fetchClientValues<number>("guilds.cache.size"),
      ctx.shards.broadcastEval((client) => ({
        ids: client.shard?.ids ?? [0],
        ping: client.ws.ping,
        heapUsed: process.memoryUsage().heapUsed,
      })),
    ]);
    const guilds = guildCounts.reduce((total, count) => total + count, 0);

    return (
      <Container accentColor="blurple">
        <Heading level={3}>Stats</Heading>
        <TextDisplay>
          <Bold>{guilds}</Bold> servers across <Bold>{ctx.shards.count}</Bold> shards
        </TextDisplay>
        <TextDisplay>
          <List>
            {shards.map((shard) => (
              <ListItem key={shard.ids.join()}>
                Shard {shard.ids.join(", ")}: {megabytes(shard.heapUsed)}, {shard.ping ?? "?"} ms
              </ListItem>
            ))}
          </List>
        </TextDisplay>
      </Container>
    );
  },
});
