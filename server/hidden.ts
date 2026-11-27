/**
 * The hidden Needs you items (TR-293), kept in the daemon so every device shows the same list: one
 * file in the plugin's state folder, a list of entries per project. The board decides what an entry
 * still hides and drops the rest (`dropHidden`), so an item that came back is not hidden again if it
 * later returns to what it was.
 */
import { z } from "zod";

import { HiddenEntrySchema, type HiddenEntry } from "../shared/hidden";
import { statePath } from "./data-dir";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import { serialized } from "./serialize";

const FileSchema = z.record(z.string(), z.array(HiddenEntrySchema));
type HiddenFile = z.infer<typeof FileSchema>;

const LOCK = "hidden-items";

function hiddenPath(): string {
  return statePath("hidden-items.json");
}

async function readFile(): Promise<HiddenFile> {
  try {
    return FileSchema.parse(await readJsonIfPresent(hiddenPath()));
  } catch {
    // No file yet, or a damaged one: nothing is hidden, never an error on the board.
    return {};
  }
}

export async function readHidden(project: string): Promise<HiddenEntry[]> {
  return (await readFile())[project] ?? [];
}

/** Hides an item as it is now; hiding again replaces the entry. */
export function hideEntry(project: string, entry: HiddenEntry): Promise<void> {
  return serialized(LOCK, async () => {
    const all = await readFile();
    all[project] = [...(all[project] ?? []).filter((other) => other.key !== entry.key), entry];
    await writeJsonAtomically(hiddenPath(), all);
  });
}

/** Brings an item back; false when it was not hidden. */
export function unhideEntry(project: string, key: string): Promise<boolean> {
  return serialized(LOCK, async () => {
    const all = await readFile();
    const before = all[project] ?? [];
    const after = before.filter((entry) => entry.key !== key);
    if (after.length === before.length) return false;
    all[project] = after;
    await writeJsonAtomically(hiddenPath(), all);
    return true;
  });
}

/**
 * Forgets entries the board saw no longer hide anything. An entry is matched by its key and time, so
 * one hidden again since the board read is kept.
 */
export function dropHidden(project: string, stale: readonly HiddenEntry[]): Promise<void> {
  if (stale.length === 0) return Promise.resolve();
  return serialized(LOCK, async () => {
    const all = await readFile();
    const before = all[project] ?? [];
    const after = before.filter((entry) => !stale.some((gone) => gone.key === entry.key && gone.at === entry.at));
    if (after.length === before.length) return;
    all[project] = after;
    await writeJsonAtomically(hiddenPath(), all);
  });
}
