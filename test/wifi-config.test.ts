import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadWifiConfig } from "../src/wifi-config.js";

test("root Wi-Fi1 overrides inherited settings without mixing profiles", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "phone-wifi-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, ".env");
  const inherited = { WIFI_SSID1: "old-network", WIFI_PASS1: "old-password" };
  await writeFile(file, 'WIFI_SSID1="event-ap"\nWIFI_PASS1="event-pass"\nWIFI_SSID3="upstream"\n');
  assert.deepEqual(await loadWifiConfig(file, inherited), { ssid: "event-ap", password: "event-pass" });
  await writeFile(file, 'WIFI_SSID="other-ap"\nWIFI_PASS="other-pass"\n');
  assert.deepEqual(await loadWifiConfig(file, inherited), { ssid: "other-ap", password: "other-pass" });
  await writeFile(file, 'WIFI_SSID1="incomplete"\n');
  assert.deepEqual(await loadWifiConfig(file, inherited), { ssid: "incomplete", password: "" });
  assert.deepEqual(await loadWifiConfig(path.join(dir, "missing"), inherited), { ssid: "old-network", password: "old-password" });
});
