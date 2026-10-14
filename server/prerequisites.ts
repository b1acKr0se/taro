/** What a project needs on the daemon host before onboarding (spec §6). */
import type { Prerequisite } from "../shared/contracts";
import { backlogEnvironment, BACKLOG_VERSION } from "./backlog-install";
import { paseoCli } from "./cli";
import type { PaseoApi } from "./host-types";
import { runCommand } from "./process";
import { usableProviders } from "./summaries";
import { backlogBinary, forgetBacklogLookup } from "./tracker";

export type PrerequisiteCheck = Prerequisite;

async function versionOf(command: string, args: readonly string[], env: Record<string, string> = {}): Promise<string | null> {
  try {
    const result = await runCommand(command, args, { env, timeoutMs: 15_000 });
    return result.code === 0 ? result.stdout.trim().split("\n")[0] ?? "" : null;
  } catch {
    return null;
  }
}

/** gh's state from `gh auth status`: null when gh did not start at all. */
export function ghCheck(status: { code: number | null } | null): Prerequisite {
  const ok = status !== null && status.code === 0;
  const detail =
    status === null
      ? "not installed; needed only for pull-request delivery. Install it from https://cli.github.com/, then run gh auth login"
      : ok
        ? "logged in"
        : "installed but not logged in; run gh auth login on this machine";
  return { id: "gh", name: "GitHub CLI (for pull requests)", ok, detail, fix: null };
}

export function backlogCheck(version: string | null): Prerequisite {
  return version === null
    ? { id: "backlog", name: "Backlog.md CLI", ok: false, detail: `not installed. Taro can install Backlog.md ${BACKLOG_VERSION} into its own data folder; nothing is installed system-wide.`, fix: "install-backlog" }
    : { id: "backlog", name: "Backlog.md CLI", ok: true, detail: `backlog ${version}`, fix: null };
}

/** The version of the backlog in use; one that stopped running (removed since it was found) is looked up again once. */
export async function backlogVersion(lookup: { find: () => Promise<string | null>; forget: () => void } = { find: backlogBinary, forget: forgetBacklogLookup }): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const backlog = await lookup.find();
    if (backlog === null) return null;
    const version = await versionOf(backlog, ["--version"], backlogEnvironment(backlog));
    if (version !== null) return version;
    lookup.forget();
  }
  return null;
}

export async function checkPrerequisites(paseo: PaseoApi): Promise<PrerequisiteCheck[]> {
  const checks: PrerequisiteCheck[] = [];
  const cli = await paseoCli();
  checks.push({
    id: "paseo-cli",
    name: "paseo CLI",
    ok: cli !== null,
    detail: cli ?? "not found on the daemon's PATH. Install Paseo's command-line tool and restart the daemon from a shell where the paseo command runs",
    fix: null,
  });

  checks.push(backlogCheck(await backlogVersion()));

  const gitVersion = await versionOf("git", ["--version"]);
  checks.push({ id: "git", name: "git", ok: gitVersion !== null, detail: gitVersion ?? "not found on the daemon's PATH. Install git from https://git-scm.com/ and restart the daemon", fix: null });

  checks.push(ghCheck(await runCommand("gh", ["auth", "status"], { timeoutMs: 15_000 }).catch(() => null)));

  try {
    const usable = (await usableProviders(paseo)).map((entry) => entry.provider);
    checks.push({ id: "providers", name: "Agent providers", ok: usable.length > 0, detail: usable.length > 0 ? usable.join(", ") : "no provider is available; set one up in Paseo's settings", fix: null });
  } catch (error) {
    checks.push({ id: "providers", name: "Agent providers", ok: false, detail: error instanceof Error ? error.message : String(error), fix: null });
  }
  return checks;
}
