/**
 * A project's review findings by author model, read from every ticket in its tracker (done and archived included).
 * The Stats tab asks on each load, so each ticket's notes are kept by revision: `list()` re-reads only files whose
 * mtime or size changed, and only a ticket whose revision moved is read again.
 */
import { findingsSummary, type FindingsSummary, type TicketNotes } from "../shared/review-findings";
import { projectPaths } from "./projects";
import { createTicketStore, TicketInvalid, TicketNotFound, type TicketStore } from "./ticket-store";

interface Tracker {
  store: TicketStore;
  notes: Map<string, { revision: string; notes: string }>;
}

const trackers = new Map<string, Tracker>();

function trackerAt(path: string): Tracker {
  let tracker = trackers.get(path);
  if (tracker === undefined) {
    tracker = { store: createTicketStore(path), notes: new Map() };
    trackers.set(path, tracker);
  }
  return tracker;
}

/** Every ticket's notes in the tracker at `path`; none for a tracker that does not exist. */
export async function trackerNotes(path: string): Promise<TicketNotes[]> {
  const tracker = trackerAt(path);
  const { tickets } = await tracker.store.list();
  const present = new Set(tickets.map((ticket) => ticket.id));
  [...tracker.notes.keys()].filter((id) => !present.has(id)).forEach((id) => tracker.notes.delete(id));
  const read = await Promise.all(
    tickets.map(async (summary): Promise<TicketNotes | null> => {
      const kept = tracker.notes.get(summary.id);
      if (kept !== undefined && kept.revision === summary.revision) return { id: summary.id, notes: kept.notes };
      try {
        const ticket = await tracker.store.read(summary.id);
        // Kept under the listed revision: one written since is read again on the next load.
        tracker.notes.set(summary.id, { revision: summary.revision, notes: ticket.notes });
        return { id: summary.id, notes: ticket.notes };
      } catch (error) {
        // Removed, or broken by a hand edit, since it was listed: the next load sees it as listed then.
        if (error instanceof TicketNotFound || error instanceof TicketInvalid) return null;
        throw error;
      }
    }),
  );
  return read.filter((ticket): ticket is TicketNotes => ticket !== null);
}

export async function trackerFindings(path: string): Promise<FindingsSummary> {
  return findingsSummary(await trackerNotes(path));
}

/** The `taro.stats.findings` answer for a project; all zeros for one without a tracker or tickets. */
export async function projectFindings(project: string): Promise<FindingsSummary> {
  return trackerFindings((await projectPaths(project)).tracker);
}
