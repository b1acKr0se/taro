/**
 * TR-073: a command given up on leaves no process behind. The fake command stands in for a
 * wrapper that starts a real binary and waits on it; both hang.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resumeCommands, runCommand, runningCommands, stopCommands } from "./process";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "taro-process-"));
});

afterEach(() => {
  resumeCommands();
  rmSync(root, { recursive: true, force: true });
});

/** A wrapper that starts a child, writes both process ids, and waits on the child; `prelude` runs first. */
function hangingWrapper(prelude = ""): { path: string; pids: string } {
  const path = join(root, "wrapper.sh");
  writeFileSync(path, `#!/bin/sh\n${prelude}\nsleep 300 &\necho "$$ $!" > "$1"\nwait\n`);
  chmodSync(path, 0o755);
  return { path, pids: join(root, "pids") };
}

async function startedPids(file: string): Promise<number[]> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const text = (() => {
      try {
        return readFileSync(file, "utf8").trim();
      } catch {
        return "";
      }
    })();
    if (text.split(" ").length === 2) return text.split(" ").map(Number);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the wrapper never started its child");
}

/** Alive and not a zombie: an orphan's zombie lingers where nothing reaps it, as in a container. */
function alive(pid: number): boolean {
  try {
    const state = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0];
    return state !== undefined && state !== "Z";
  } catch {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

async function gone(pids: readonly number[]): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (pids.every((pid) => !alive(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

describe.skipIf(process.platform === "win32")("runCommand", () => {
  it("kills a timed-out command together with the child it started", async () => {
    const wrapper = hangingWrapper();
    const run = runCommand(wrapper.path, [wrapper.pids], { timeoutMs: 500 });
    const pids = await startedPids(wrapper.pids);
    expect(pids.every(alive)).toBe(true);
    await expect(run).rejects.toThrow(/did not finish within 0.5 seconds/);
    expect(await gone(pids)).toBe(true);
  });

  it("asks with SIGTERM first, so git can remove its lock files", async () => {
    const said = join(root, "said");
    const wrapper = hangingWrapper(`trap 'echo terminated > "${said}"; exit 0' TERM`);
    const run = runCommand(wrapper.path, [wrapper.pids], { timeoutMs: 300 });
    const pids = await startedPids(wrapper.pids);
    await expect(run).rejects.toThrow(/did not finish/);
    expect(await gone(pids)).toBe(true);
    expect(readFileSync(said, "utf8")).toBe("terminated\n");
  });

  it("kills a group that ignores SIGTERM", async () => {
    const wrapper = hangingWrapper("trap '' TERM");
    const run = runCommand(wrapper.path, [wrapper.pids], { timeoutMs: 300 });
    const pids = await startedPids(wrapper.pids);
    await expect(run).rejects.toThrow(/did not finish/);
    expect(await gone(pids)).toBe(true);
  });

  it.each(["SIGTERM", "SIGINT", "SIGHUP"])("takes its commands along when the plugin process ends on %s", async (signal) => {
    const wrapper = hangingWrapper();
    const script = join(root, "plugin.mts");
    const processModule = join(fileURLToPath(import.meta.url), "..", "process.ts");
    writeFileSync(script, `import { runCommand } from ${JSON.stringify(processModule)};\nvoid runCommand(${JSON.stringify(wrapper.path)}, [${JSON.stringify(wrapper.pids)}]).catch(() => {});\n`);
    const plugin = spawn(process.execPath, [script], { stdio: "ignore" });
    const pids = await startedPids(wrapper.pids);
    const ended = new Promise<NodeJS.Signals | null>((resolve) => plugin.on("exit", (_code, how) => resolve(how)));
    plugin.kill(signal as NodeJS.Signals);
    // Ends as it would have without the listener: by the same signal.
    expect(await ended).toBe(signal);
    expect(await gone(pids)).toBe(true);
  });

  it("returns a quick command's output and exit code", async () => {
    await expect(runCommand("sh", ["-c", "echo out; echo err >&2; exit 3"])).resolves.toEqual({ code: 3, stdout: "out\n", stderr: "err\n" });
    expect(runningCommands()).toBe(0);
  });
});

describe.skipIf(process.platform === "win32")("stopCommands", () => {
  it("kills commands still running after the grace period, with their children, and starts no new ones", async () => {
    const wrapper = hangingWrapper();
    const run = runCommand(wrapper.path, [wrapper.pids], { timeoutMs: 60_000 });
    const pids = await startedPids(wrapper.pids);
    const started = Date.now();
    await stopCommands(200);
    // The grace, then SIGTERM's.
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
    expect(await gone(pids)).toBe(true);
    expect((await run).code).toBeNull();
    await expect(runCommand("true", [])).rejects.toThrow(/Taro is stopping/);
  });

  it("lets a command that ends within the grace period finish", async () => {
    const run = runCommand("sh", ["-c", "sleep 0.2; echo committed"]);
    await stopCommands(5_000);
    await expect(run).resolves.toEqual({ code: 0, stdout: "committed\n", stderr: "" });
  });

  it("returns at once with nothing running", async () => {
    const started = Date.now();
    await stopCommands(5_000);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
