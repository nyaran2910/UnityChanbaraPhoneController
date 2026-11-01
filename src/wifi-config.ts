import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

// npm and both launchers run the service from apps/phone.
export async function loadWifiConfig(file = path.resolve("../../.env"), environment = process.env) {
  let values = environment;
  try {
    const settings = parseEnv(await readFile(file, "utf8"));
    // Treat file settings as one profile; never mix a new SSID with an old password.
    if (Object.keys(settings).some(key => /^WIFI_(SSID|PASS)_?1?$/.test(key))) values = settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read AP Wi-Fi configuration");
  }
  const ssid = values.WIFI_SSID1 ?? values.WIFI_SSID_1 ?? values.WIFI_SSID;
  const password = values.WIFI_PASS1 ?? values.WIFI_PASS_1 ?? values.WIFI_PASS;
  return ssid || password ? { ssid: ssid ?? "", password: password ?? "" } : undefined;
}
