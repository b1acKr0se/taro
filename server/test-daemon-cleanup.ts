/**
 * The plugin's half of `taro daemon`: when a ticket is Done or Cancelled, or its owner is archived
 * (Park archives it too), every test daemon recorded for the ticket is stopped, what it left is
 * killed by pid and its throwaway home deleted. Owners forgot them, and each held threads.
 */
import { readdir } from "node:fs/promises";
import { dirname } from "node:path";

import { paseoCli } from "./cli";
import { pluginDataDirectory } from "./data-dir";
import { daemonRecordPath, readDaemonRecords, stopTestDaemons, stoppedDaemonLine } from "./test-daemons";

export async function stopTicketDaemons(project: string, ticket: string, reason: string): Promise<void> {
  const recordPath = daemonRecordPath(pluginDataDirectory(), project, ticket);
  if ((await readDaemonRecords(recordPath)).length === 0) return;
  for (const stopped of await stopTestDaemons({ paseo: (await paseoCli()) ?? "paseo", recordPath })) {
    console.log(`[taro] ${stoppedDaemonLine(ticket, stopped, reason)}`);
  }
}

/**
 * An archived owner's daemons and those recorded under its child tickets (`<ID>.json`, `<ID>.*.json`):
 * its implementers and reviewers start them for the child they work on, and nobody uses them after it.
 */
export async function stopOwnerDaemons(project: string, ticket: string, reason: string): Promise<void> {
  const id = ticket.toUpperCase();
  const folder = dirname(daemonRecordPath(pluginDataDirectory(), project, id));
  const files = await readdir(folder).catch(() => [] as string[]);
  const tickets = files.flatMap((file) => {
    const match = /^(.+)\.json$/.exec(file);
    const recorded = match?.[1];
    return recorded !== undefined && (recorded === id || recorded.startsWith(`${id}.`)) ? [recorded] : [];
  });
  for (const recorded of tickets.sort()) await stopTicketDaemons(project, recorded, recorded === id ? reason : `the owner of its parent ${id} was archived`);
}
