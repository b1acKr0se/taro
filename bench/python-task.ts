/**
 * Python tasks (their test command uses `$PYTEST_PATH`): this host has neither `uv` nor `python3 -m venv`,
 * so the ported specs' `uv run pytest` does not exist. The harness installs pytest into a folder of its own
 * for the owner and points the owner's PYTHONPATH at it, so `python3 -m pytest` works. Runs under Node
 * type stripping: erasable syntax, `.ts` import extensions, no packages.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { scratchDirectory, type Throwaway } from "./daemon.ts";
import { run } from "./process.ts";

export const PYTHON_BRIEF_LINE = "Python tests: run them with `python3 -m pytest` (PYTHONPATH already holds pytest); `uv run pytest` in the specification does not exist on this host.";

export function isPythonTask(taskDirectory: string): boolean {
  const file = join(taskDirectory, "test-command");
  return existsSync(file) && readFileSync(file, "utf8").includes("PYTEST_PATH");
}

/** Installs pytest into a scratch folder of the run (removed with the other folders at cleanup); returns the folder. */
export async function installOwnerPytest(throwaway: Throwaway, runner: typeof run = run): Promise<string> {
  const target = scratchDirectory(throwaway, "owner-pytest");
  const installed = await runner("python3", ["-m", "pip", "install", "-q", "--target", target, "pytest"], { timeoutMs: 300_000 });
  if (installed.code !== 0) throw new Error(`pytest install for the owner failed (exit ${installed.code}): ${installed.stderr}`);
  return target;
}

/** The brief a python task's owner reads: the task's own, plus one line on how to run the tests. */
export function briefFor(brief: string, pytestFolder: string | null): string {
  return pytestFolder === null ? brief : `${brief}\n\n${PYTHON_BRIEF_LINE}`;
}

/** The `paseo run` arguments that give the owner its PYTHONPATH; none for a task that does not use pytest. */
export function ownerEnvArguments(pytestFolder: string | null): string[] {
  return pytestFolder === null ? [] : ["--env", `PYTHONPATH=${pytestFolder}`];
}
