/**
 * Taro's edits to a working directory's `.claude/settings.local.json`: the compact hook (TR-101) and
 * the skills a trimmed agent does without (TR-139). The file may be the user's own, so each edit is a
 * merge of the text in place, one at a time per file; a file the repository tracks is left alone, and
 * an untracked one is kept out of git.
 */
import { join } from "node:path";

import { readTextIfPresent, writeTextAtomically } from "./files";
import { runCommand } from "./process";
import { serialized } from "./serialize";

export const SETTINGS_FILE = join(".claude", "settings.local.json");
const EXCLUDE_PATTERN = "**/.claude/settings.local.json";
const GIT_TIMEOUT_MS = 10_000;

/** Adds the pattern to the repository's own `info/exclude` unless git already ignores the file; outside a repository, nothing. */
async function excludeFromGit(cwd: string): Promise<void> {
  const ignored = await runCommand("git", ["-C", cwd, "check-ignore", "-q", SETTINGS_FILE], { timeoutMs: GIT_TIMEOUT_MS });
  if (ignored.code !== 1) return; // 0: ignored already; 128: not a repository
  const located = await runCommand("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], { timeoutMs: GIT_TIMEOUT_MS });
  const exclude = located.stdout.trim();
  if (located.code !== 0 || exclude === "") return;
  const current = (await readTextIfPresent(exclude)) ?? "";
  if (current.split("\n").includes(EXCLUDE_PATTERN)) return;
  await writeTextAtomically(exclude, `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}${EXCLUDE_PATTERN}\n`);
}

/**
 * Merges `cwd`'s settings file with `merge` (the current text, null when there is none, to the new
 * text, or null when it cannot be merged). Returns what it changed, for the log, or null when nothing
 * changed. `what` names the edit in that line.
 */
export function mergeLocalSettings(cwd: string, what: string, merge: (current: string | null) => string | null): Promise<string | null> {
  const settingsPath = join(cwd, SETTINGS_FILE);
  return serialized(`local-settings:${settingsPath}`, async () => {
    // A file the repository tracks would show the edit, with this machine's paths, as a change to commit.
    const tracked = await runCommand("git", ["-C", cwd, "ls-files", "--error-unmatch", SETTINGS_FILE], { timeoutMs: GIT_TIMEOUT_MS });
    if (tracked.code === 0) return `left ${settingsPath} alone: the repository tracks it`;
    const current = await readTextIfPresent(settingsPath);
    const merged = merge(current);
    if (merged === null) return `left ${settingsPath} alone: it is not a settings object Taro can add to`;
    await excludeFromGit(cwd);
    if (merged === current) return null;
    await writeTextAtomically(settingsPath, merged);
    return `${what} written to ${settingsPath}`;
  });
}
