// Prints an agent's user messages, oldest first, on the throwaway daemon: node timeline.mjs <agent id> [limit]
// One line each: the chat's message id (or "-") and the words, to check none was lost, doubled or reordered,
// and each compaction's state.
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const { DaemonClient } = await import(require.resolve("@getpaseo/client/internal/daemon-client"));
const [agentId, limit = "300"] = process.argv.slice(2);
const client = new DaemonClient({ url: process.env.TARO_DAEMON_URL ?? "ws://127.0.0.1:6799/ws", clientId: "taro-e2e-timeline", clientType: "cli", appVersion: "0.11.2", reconnect: { enabled: false } });
await client.connect();
try {
  const page = await client.fetchAgentTimeline(agentId, { direction: "tail", limit: Number(limit), projection: "projected" });
  for (const entry of page.entries) {
    // Compactions too, to see whether a message sent during one cut it short.
    if (entry.item.type === "compaction") console.log(`[compaction ${entry.item.status}${entry.item.trigger ? ` ${entry.item.trigger}` : ""}] ${entry.timestamp}`);
    if (entry.item.type !== "user_message") continue;
    console.log(`${entry.item.clientMessageId ?? "-"}\t${JSON.stringify(entry.item.text)}`);
  }
} catch (error) {
  console.error("timeline failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.close();
}
