/**
 * The plugin's half of `taro daemon`: when a ticket is Done or Cancelled, or its owner is archived
 * (Park archives it too), every test daemon recorded for the ticket is stopped, what it left is
 * killed by pid and its throwaway home deleted. Owners forgot them, and each held threads.
 */
import { paseoCli } from "./cli";
import { pluginDataDirectory } from "./data-dir";
import { daemonRecordPath, readDaemonRecords, stopTestDaemons } from "./test-daemons";

export async function stopTicketDaemons(project: string, ticket: string, reason: string): Promise<void> {
  const recordPath = daemonRecordPath(pluginDataDirectory(), project, ticket);
  if ((await readDaemonRecords(recordPath)).length === 0) return;
  for (const stopped of await stopTestDaemons({ paseo: (await paseoCli()) ?? "paseo", recordPath })) {
    const killed = stopped.killed.length === 0 ? "nothing left to kill" : `killed ${stopped.killed.join(", ")}`;
    const problems = stopped.problems.length === 0 ? "" : `; ${stopped.problems.join("; ")}`;
    console.log(`[taro] stopped ${ticket}'s test daemon ${stopped.record.home} (port ${stopped.record.port}) because ${reason}: ${killed}${problems}`);
  }
}
