import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { makeThrowaway } from "./daemon.ts";
import { briefFor, installOwnerPytest, isPythonTask, ownerEnvArguments, PYTHON_BRIEF_LINE } from "./python-task.ts";

describe("python tasks", () => {
  it("owner_gets_pythonpath_for_python_tasks", async () => {
    const task = mkdtempSync(join(tmpdir(), "python-task-test."));
    writeFileSync(join(task, "test-command"), 'PYTHONPATH="$PYTEST_PATH:$PWD" python3 -m pytest hidden_tests\n');
    expect(isPythonTask(task)).toBe(true);
    writeFileSync(join(task, "test-command"), "node --test\n");
    expect(isPythonTask(task)).toBe(false);
    rmSync(task, { recursive: true, force: true });

    const throwaway = makeThrowaway("/x");
    const calls: string[][] = [];
    const folder = await installOwnerPytest(throwaway, (async (_command: string, args: readonly string[]) => {
      calls.push([...args]);
      return { code: 0, stdout: "", stderr: "" };
    }) as never);
    expect(calls[0]).toEqual(["-m", "pip", "install", "-q", "--target", folder, "pytest"]);
    expect(throwaway.folders).toContain(folder);
    expect(ownerEnvArguments(folder)).toEqual(["--env", `PYTHONPATH=${folder}`]);
    expect(briefFor("Brief.", folder)).toBe(`Brief.\n\n${PYTHON_BRIEF_LINE}`);
    rmSync(folder, { recursive: true, force: true });
  });

  it("leaves a node task's brief and environment alone", () => {
    expect(ownerEnvArguments(null)).toEqual([]);
    expect(briefFor("Brief.", null)).toBe("Brief.");
  });

  it("fails loudly when pytest cannot be installed", async () => {
    const throwaway = makeThrowaway("/x");
    await expect(installOwnerPytest(throwaway, (async () => ({ code: 1, stdout: "", stderr: "no network" })) as never)).rejects.toThrow(/no network/);
    throwaway.folders.forEach((folder) => rmSync(folder, { recursive: true, force: true }));
  });
});
