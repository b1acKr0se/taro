/**
 * TR-073: a command given up on leaves no process behind. The fake command stands in for npm's
 * `backlog`, a wrapper that starts the real binary and waits on it; both hang.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nativeBacklog } from "./backlog-install";
import { concurrencyLimit, resumeCommands, runCommand, runningCommands, stopCommands } from "./process";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "taro-process-"));
});

afterEach(() => {
  resumeCommands();
  rmSync(root, { recursive: true, force: true });
});

/** A wrapper that starts a child, writes both process ids, and waits on the child. */
function hangingWrapper(): { path: string; pids: string } {
  const path = join(root, "wrapper.sh");
  writeFileSync(path, '#!/bin/sh\nsleep 300 &\necho "$$ $!" > "$1"\nwait\n');
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
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
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

describe("concurrencyLimit", () => {
  it("runs at most the limit at once, the rest in the order they came", async () => {
    const turn = concurrencyLimit(3);
    let active = 0;
    let most = 0;
    const order: number[] = [];
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        turn(async () => {
          order.push(index);
          active++;
          most = Math.max(most, active);
          await new Promise((resolve) => setTimeout(resolve, 5 + (index % 3) * 5));
          active--;
          return index * 2;
        }),
      ),
    );
    expect(most).toBe(3);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it("frees the turn of work that fails", async () => {
    const turn = concurrencyLimit(1);
    await expect(turn(async () => Promise.reject(new Error("broken")))).rejects.toThrow("broken");
    await expect(turn(async () => "next")).resolves.toBe("next");
  });

  it("with a limit of one, never overlaps", async () => {
    const turn = concurrencyLimit(1);
    let active = 0;
    let most = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        turn(async () => {
          active++;
          most = Math.max(most, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active--;
        }),
      ),
    );
    expect(most).toBe(1);
  });
});

describe.skipIf(process.platform === "win32")("nativeBacklog", () => {
  function executable(path: string): void {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "#!/bin/sh\n");
    chmodSync(path, 0o755);
  }

  function wrapper(modules: string): string {
    executable(join(modules, "backlog.md", "cli.js"));
    mkdirSync(join(root, "bin"), { recursive: true });
    const link = join(root, "bin", "backlog");
    symlinkSync(join(modules, "backlog.md", "cli.js"), link);
    return link;
  }

  it("finds the platform binary npm nests inside the wrapper's package", async () => {
    const modules = join(root, "lib", "node_modules");
    const link = wrapper(modules);
    const binary = join(modules, "backlog.md", "node_modules", "backlog.md-linux-x64", "backlog");
    executable(binary);
    expect(await nativeBacklog(link, "linux", "x64")).toBe(binary);
  });

  it("finds it hoisted beside the wrapper's package, as an npm --prefix install puts it", async () => {
    const modules = join(root, "tools", "node_modules");
    const link = wrapper(modules);
    const binary = join(modules, "backlog.md-darwin-arm64", "backlog");
    executable(binary);
    expect(await nativeBacklog(link, "darwin", "arm64")).toBe(binary);
  });

  it("names the Windows package and executable as the wrapper does", async () => {
    const modules = join(root, "lib", "node_modules");
    const link = wrapper(modules);
    const binary = join(modules, "backlog.md", "node_modules", "backlog.md-windows-x64", "backlog.exe");
    executable(binary);
    expect(await nativeBacklog(link, "win32", "x64")).toBe(binary);
  });

  it("keeps the wrapper when the platform package is missing or for another platform", async () => {
    const modules = join(root, "lib", "node_modules");
    const link = wrapper(modules);
    executable(join(modules, "backlog.md", "node_modules", "backlog.md-linux-arm64", "backlog"));
    expect(await nativeBacklog(link, "linux", "x64")).toBeNull();
  });

  it("keeps a backlog that is not npm's wrapper, or does not exist", async () => {
    const plain = join(root, "usr", "bin", "backlog");
    executable(plain);
    expect(await nativeBacklog(plain, "linux", "x64")).toBeNull();
    expect(await nativeBacklog(join(root, "missing"), "linux", "x64")).toBeNull();
  });
});
