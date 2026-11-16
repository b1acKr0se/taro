import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where the notes live: `NOTES_FILE`, else `.notes.json` in the home folder. */
export function dataPath() {
  return process.env.NOTES_FILE ?? join(homedir(), ".notes.json");
}

/** The stored state: `{ nextId, notes }`. A missing file is an empty store; a damaged one is an error. */
export function loadState(path = dataPath()) {
  if (!existsSync(path)) return { nextId: 1, notes: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} is not valid JSON (${error.message})`);
  }
  if (!Array.isArray(parsed.notes) || !Number.isInteger(parsed.nextId)) throw new Error(`${path} is not a notes file`);
  return parsed;
}

/** Writes the state through a temporary file, so a crash never leaves half a file behind. */
export function saveState(state, path = dataPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temporary, path);
}
