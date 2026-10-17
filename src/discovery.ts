import dgram from "node:dgram";
import { networkInterfaces } from "node:os";

export const DISCOVERY_PORT = 42045;

// The shared LAN is trusted. Never publish this key through the HTTPS tunnel.
export async function startDiscovery(options: {
  httpPort: number; hostKey: string; serverId: string; port?: number;
  lanAddress?: string; onError?: (error: Error) => void;
}) {
  const socket = dgram.createSocket("udp4");
  const onError = options.onError ?? console.error;
  // A lost peer only loses this reply; it must not stop all LAN services.
  const onSendError = (error: Error | null) => {
    if (error) console.warn(`Discovery reply failed: ${error.message}`);
  };
  const onSocketError = (error: NodeJS.ErrnoException) => {
    if (['EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ENETDOWN', 'ECONNREFUSED', 'ENOBUFS', 'EAGAIN'].includes(error.code ?? '')) {
      onSendError(error);
    } else onError(error);
  };

  const lan = Object.values(networkInterfaces()).flat().find(a => a?.address === options.lanAddress);
  if (options.lanAddress && !lan) throw new Error("Phone discovery LAN address is not assigned to this PC");
  const number = (ip: string) => ip.split(".").reduce((n, v) => (n * 256 + Number(v)) >>> 0, 0);
  socket.on("message", (packet, remote) => {
    // With a selected LAN adapter, reject school Wi-Fi and other interfaces.
    if (lan && remote.address !== "127.0.0.1" &&
        (number(remote.address) & number(lan.netmask)) !== (number(lan.address) & number(lan.netmask))) return;
    if (packet.length > 256) return;
    let query;
    try { query = JSON.parse(packet.toString("utf8")); } catch { return; }
    if (query?.type !== "kosen.phone.discover" || query.version !== 1 ||
        typeof query.nonce !== "string" || !/^[a-f0-9]{32}$/.test(query.nonce)) return;
    const reply = Buffer.from(JSON.stringify({ type: "kosen.phone.offer", version: 1,
      nonce: query.nonce, serverId: options.serverId, port: options.httpPort, hostKey: options.hostKey }));
    socket.send(reply, remote.port, remote.address, onSendError);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(options.port ?? DISCOVERY_PORT, "0.0.0.0", () => { socket.removeListener("error", reject); resolve(); });
  }).catch(error => { socket.close(); throw error; });
  socket.on("error", onSocketError);
  return socket;
}
