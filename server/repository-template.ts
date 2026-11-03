/** Whether a repository has its own pull-request template, which replaces the default (TR-250). */
import { access } from "node:fs/promises";
import { join } from "node:path";

import { REPOSITORY_TEMPLATE_PATHS } from "../shared/pull-request-template";

const LIFETIME_MS = 60_000;
const known = new Map<string, { at: number; found: Promise<boolean> }>();

async function look(repository: string): Promise<boolean> {
  const present = await Promise.all(REPOSITORY_TEMPLATE_PATHS.map((path) => access(join(repository, path)).then(() => true, () => false)));
  return present.some(Boolean);
}

/** Read again each minute: the board polls, and a template is added rarely. */
export function hasRepositoryTemplate(repository: string, now: number = Date.now()): Promise<boolean> {
  const entry = known.get(repository);
  if (entry !== undefined && now - entry.at < LIFETIME_MS) return entry.found;
  const found = look(repository);
  known.set(repository, { at: now, found });
  return found;
}
