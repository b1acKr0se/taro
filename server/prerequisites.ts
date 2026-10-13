/** What a project needs on the daemon host before onboarding (spec §6). */
import { paseoCli } from "./cli";
import type { PaseoApi } from "./host-types";
import { runCommand } from "./process";
import { usableProviders } from "./summaries";
import { backlogBinary } from "./tracker";

export interface PrerequisiteCheck {
  name: string;
  ok: boolean;
  detail: string;
}

async function versionOf(command: string, args: readonly string[]): Promise<string | null> {
  try {
    const result = await runCommand(command, args, { timeoutMs: 15_000 });
    return result.code === 0 ? result.stdout.trim().split("\n")[0] ?? "" : null;
  } catch {
    return null;
  }
}

export async function checkPrerequisites(paseo: PaseoApi): Promise<PrerequisiteCheck[]> {
  const checks: PrerequisiteCheck[] = [];
  const cli = await paseoCli();
  checks.push({ name: "paseo CLI", ok: cli !== null, detail: cli ?? "not found on the daemon's PATH" });

  const backlog = await backlogBinary();
  const backlogVersion = backlog === null ? null : await versionOf(backlog, ["--version"]);
  checks.push({ name: "Backlog.md CLI", ok: backlogVersion !== null, detail: backlogVersion === null ? "install backlog.md (npm i -g backlog.md)" : `backlog ${backlogVersion}` });

  const gitVersion = await versionOf("git", ["--version"]);
  checks.push({ name: "git", ok: gitVersion !== null, detail: gitVersion ?? "not found" });

  const ghStatus = await runCommand("gh", ["auth", "status"], { timeoutMs: 15_000 }).catch(() => null);
  checks.push({
    name: "GitHub CLI (for pull requests)",
    ok: ghStatus !== null && ghStatus.code === 0,
    detail: ghStatus === null ? "gh not found; needed only for pull-request delivery" : ghStatus.code === 0 ? "logged in" : "run `gh auth login`",
  });

  try {
    const usable = (await usableProviders(paseo)).map((entry) => entry.provider);
    checks.push({ name: "Agent providers", ok: usable.length > 0, detail: usable.length > 0 ? usable.join(", ") : "no provider is available" });
  } catch (error) {
    checks.push({ name: "Agent providers", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  return checks;
}
