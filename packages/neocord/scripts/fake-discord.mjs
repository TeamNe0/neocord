import { createServer } from "node:http";
import { createRequire } from "node:module";

const discordRequire = createRequire(createRequire(import.meta.url).resolve("discord.js"));
const { WebSocketServer } = createRequire(discordRequire.resolve("@discordjs/ws"))("ws");

const BOT_ID = "100000000000000000";

export async function startFakeDiscord() {
  const fake = {
    http: "ok",
    dropped: 0,
    identifies: new Map(),
    sockets: new Map(),
    closeShard(id, code) {
      fake.sockets.get(id)?.close(code);
    },
    async close() {
      for (const socket of wss.clients) socket.terminate();
      wss.close();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };

  const server = createServer((request, response) => {
    if (fake.http === "drop") {
      fake.dropped += 1;
      request.socket.destroy();
      return;
    }
    const json = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (fake.http === "unauthorized") {
      json(401, { message: "401: Unauthorized", code: 0 });
      return;
    }
    if (request.url?.includes("/gateway/bot")) {
      json(200, {
        url: `ws://127.0.0.1:${server.address().port}`,
        shards: 1,
        session_start_limit: { total: 1000, remaining: 1000, reset_after: 1000, max_concurrency: 16 },
      });
      return;
    }
    json(200, {});
  });

  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ op: 10, s: null, t: null, d: { heartbeat_interval: 45_000 } }));
    socket.on("message", (raw) => {
      const packet = JSON.parse(String(raw));
      if (packet.op === 1) {
        socket.send(JSON.stringify({ op: 11, s: null, t: null, d: null }));
      } else if (packet.op === 2) {
        const shardId = packet.d.shard?.[0] ?? 0;
        fake.identifies.set(shardId, (fake.identifies.get(shardId) ?? 0) + 1);
        fake.sockets.set(shardId, socket);
        socket.send(
          JSON.stringify({
            op: 0,
            s: 1,
            t: "READY",
            d: {
              v: 10,
              user: { id: BOT_ID, username: "fake", discriminator: "0", bot: true, avatar: null, global_name: null },
              guilds: [],
              session_id: `session-${shardId}`,
              resume_gateway_url: `ws://127.0.0.1:${server.address().port}`,
              application: { id: BOT_ID, flags: 0 },
              shard: packet.d.shard,
            },
          }),
        );
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.api = `http://127.0.0.1:${server.address().port}/api`;
  return fake;
}
