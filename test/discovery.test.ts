import assert from "node:assert/strict";
import dgram from "node:dgram";
import { once } from "node:events";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { startDiscovery } from "../src/discovery.js";

const hostKey = "test-key-that-is-long-enough-for-host-authentication";
test("LAN discovery returns current key and port, echoes nonce, rejects malformed queries", async t => {
  const serverId = randomUUID();
  const server = await startDiscovery({ httpPort: 8080, hostKey, serverId, port: 0, lanAddress: "127.0.0.1" });
  const client = dgram.createSocket("udp4");
  t.after(() => { client.close(); server.close(); });
  client.bind(0, "127.0.0.1"); await once(client, "listening");
  const replies: any[] = [];
  client.on("message", packet => replies.push(JSON.parse(packet.toString())));
  for (const value of ['{', JSON.stringify({ type: "kosen.phone.discover", version: 2, nonce: "a".repeat(32) }),
    JSON.stringify({ type: "kosen.phone.discover", version: 1, nonce: "bad" }), " ".repeat(257)]) {
    client.send(value, server.address().port, "127.0.0.1");
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(replies.length, 0);
  const received = once(client, "message");
  client.send(JSON.stringify({ type: "kosen.phone.discover", version: 1, nonce: "a".repeat(32) }), server.address().port, "127.0.0.1");
  await received;
  assert.deepEqual(replies, [{ type: "kosen.phone.offer", version: 1, nonce: "a".repeat(32), serverId, port: 8080, hostKey }]);
});

test("invalid selected LAN interface fails without opening discovery", async () => {
  await assert.rejects(startDiscovery({ httpPort: 8080, hostKey, serverId: randomUUID(), port: 0, lanAddress: "192.0.2.77" }), /not assigned/);
});

test("four games use the discovered dynamic key and receive separate sessions and QR URLs", async t => {
  const { createControllerServer } = await import("../src/server.js");
  const { WebSocket } = await import("ws");
  const app = createControllerServer({ hostKey, publicBaseUrl: "https://controller.example.test" });
  t.after(() => app.close());
  app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
  const address = app.server.address(); assert(address && typeof address !== "string");
  const responder = await startDiscovery({ httpPort: address.port, hostKey, serverId: randomUUID(), port: 0 });
  t.after(() => responder.close());
  const client = dgram.createSocket("udp4");
  t.after(() => client.close());
  client.bind(0, "127.0.0.1"); await once(client, "listening");
  const reply = once(client, "message");
  client.send(JSON.stringify({ type: "kosen.phone.discover", version: 1, nonce: "b".repeat(32) }), responder.address().port, "127.0.0.1");
  const [packet] = await reply;
  const offer = JSON.parse(packet.toString());
  const sessions = await Promise.all(Array.from({ length: 4 }, async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${offer.port}/signal`);
    t.after(() => socket.terminate());
    await once(socket, "open");
    const response = once(socket, "message");
    socket.send(JSON.stringify({ type: "host.create", hostKey: offer.hostKey }));
    const [raw] = await response; return JSON.parse(raw.toString());
  }));
  assert.equal(new Set(sessions.map(s => s.sessionId)).size, 4);
  for (const session of sessions) {
    assert.equal(session.type, "session.created");
    for (const slot of ["p1", "p2"]) {
      const url = new URL(session.slots[slot].joinUrl);
      assert.equal(url.origin, "https://controller.example.test");
      assert.equal(url.searchParams.get("session"), session.sessionId);
      assert.equal(url.searchParams.get("slot"), slot);
    }
  }
});
