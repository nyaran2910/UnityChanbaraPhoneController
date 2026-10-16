import { randomUUID } from "node:crypto";
import { startDiscovery, DISCOVERY_PORT } from "./discovery.js";
import { createControllerServer } from "./server.js";

const hostKey = process.env.HOST_KEY ?? "";
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "";
const port = Number(process.env.PORT ?? "8080");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535");
}

const discoveryPort = Number(process.env.PHONE_DISCOVERY_PORT ?? DISCOVERY_PORT);
if (!Number.isInteger(discoveryPort) || discoveryPort < 1 || discoveryPort > 65535)
  throw new Error("PHONE_DISCOVERY_PORT must be an integer from 1 to 65535");
const app = createControllerServer({ hostKey, publicBaseUrl });
let discovery: Awaited<ReturnType<typeof startDiscovery>> | undefined;
try {
  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(port, process.env.PHONE_HOST ?? "0.0.0.0", resolve);
  });
  discovery = await startDiscovery({ httpPort: port, hostKey, serverId: randomUUID(),
    port: discoveryPort, lanAddress: process.env.PHONE_LAN_ADDRESS,
    onError: error => { console.error(error); void shutdown(1); } });
  console.log(`controller signaling listening on ${port}; discovery UDP ${discoveryPort}`);
} catch (error) {
  console.error(error);
  await shutdown(1);
}

async function shutdown(code = 0) {
  discovery?.close();
  discovery = undefined;
  await app.close();
  process.exit(code);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
