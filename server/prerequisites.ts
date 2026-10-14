/** What a project needs on the daemon host before onboarding (spec §6). */
import type { Prerequisite } from "../shared/contracts";
import { paseoCli } from "./cli";
import type { PaseoApi } from "./host-types";
import { runCommand } from "./process";
import { usableProviders } from "./summaries";

export type PrerequisiteCheck = Prerequisite;

async function versionOf(command: string, args: readonly string[]): Promise<string | null> {
  try {
    const result = await runCommand(command, args, { timeoutMs: 15_000 });
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
  return { id: "gh", name: "GitHub CLI (for pull requests)", ok, detail };
}

export async function checkPrerequisites(paseo: PaseoApi): Promise<PrerequisiteCheck[]> {
  const checks: PrerequisiteCheck[] = [];
  const cli = await paseoCli();
  checks.push({
    id: "paseo-cli",
    name: "paseo CLI",
    ok: cli !== null,
    detail: cli ?? "not found on the daemon's PATH. Install Paseo's command-line tool and restart the daemon from a shell where the paseo command runs",
  });

  const gitVersion = await versionOf("git", ["--version"]);
  checks.push({ id: "git", name: "git", ok: gitVersion !== null, detail: gitVersion ?? "not found on the daemon's PATH. Install git from https://git-scm.com/ and restart the daemon" });

  checks.push(ghCheck(await runCommand("gh", ["auth", "status"], { timeoutMs: 15_000 }).catch(() => null)));

  try {
    const usable = (await usableProviders(paseo)).map((entry) => entry.provider);
    checks.push({ id: "providers", name: "Agent providers", ok: usable.length > 0, detail: usable.length > 0 ? usable.join(", ") : "no provider is available; set one up in Paseo's settings" });
  } catch (error) {
    checks.push({ id: "providers", name: "Agent providers", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  return checks;
}
