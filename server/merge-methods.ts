/** Which merge methods the repository's GitHub settings allow (TR-110), for the settings form. */
import { isAbsolute } from "node:path";

import { GH_ALLOWED_FIELDS, MERGE_METHODS, parseAllowedMergeMethods, type AllowedMergeMethods } from "../shared/merge-method";
import { runCommand } from "./process";

/** Null when gh cannot say: not installed or logged in, no GitHub remote, not a repository. */
export async function allowedMergeMethods(repoPath: string): Promise<AllowedMergeMethods | null> {
  if (!isAbsolute(repoPath)) return null;
  const fields = MERGE_METHODS.map((method) => GH_ALLOWED_FIELDS[method]).join(",");
  const result = await runCommand("gh", ["repo", "view", "--json", fields], { cwd: repoPath, timeoutMs: 15_000 }).catch(() => null);
  return result === null || result.code !== 0 ? null : parseAllowedMergeMethods(result.stdout);
}
