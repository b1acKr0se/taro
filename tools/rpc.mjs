// Drives one Taro plugin RPC on the throwaway daemon: node rpc.mjs <wire name> '<json input>'
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const { DaemonClient } = await import(require.resolve("@getpaseo/client/internal/daemon-client"));
const [method, input = "{}"] = process.argv.slice(2);
const client = new DaemonClient({ url: process.env.TARO_DAEMON_URL ?? "ws://127.0.0.1:6799/ws", clientId: "taro-e2e-driver", clientType: "cli", appVersion: "0.11.2", reconnect: { enabled: false } });
await client.connect();
try {
  const result = await client.invokePluginRpc("taro", method, JSON.parse(input));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("RPC failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.close();
}
