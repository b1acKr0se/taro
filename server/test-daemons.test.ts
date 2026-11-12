/** The plugin's stop of a ticket's test daemons, on real processes: a stub `paseo`, a leftover that names the daemon's home. */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { daemonRecordPath } from "./test-daemons";

let scratch = "";
let home = "";
const previous = { PASEO_HOME: process.env.PASEO_HOME, PASEO_CLI: process.env.PASEO_CLI };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "taro-test-daemons-"));
  home = mkdtempSync("/tmp/paseo-TR-90-");
  process.env.PASEO_HOME = join(scratch, "paseo-home");
  const stub = join(scratch, "paseo");
  writeFileSync(stub, `#!/bin/sh\necho "$@" >> "${join(scratch, "calls.log")}"\n`);
  chmodSync(stub, 0o755);
  process.env.PASEO_CLI = stub;
  vi.resetModules();
});

afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

/** A pid that was used and is free now. */
function freedPid(): number {
  const exited = spawnSync("true");
  return exited.pid ?? 999_999;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("stopTicketDaemons", () => {
  it("kills by pid what a daemon whose pid is gone left, deletes its home and forgets it, without asking it to stop", async () => {
    const recordPath = daemonRecordPath(join(process.env.PASEO_HOME as string, "plugin-data", "taro"), "notes-app", "TR-90");
    mkdirSync(join(recordPath, ".."), { recursive: true });
    writeFileSync(recordPath, JSON.stringify([{ home, port: 6851, pid: freedPid(), startedAt: "2026-11-12T07:00:00.000Z", startedBy: null }]));
    // A plugin process the daemon left: its arguments name the home.
    const leftover = spawn(process.execPath, ["-e", "setTimeout(() => undefined, 300_000)", home], { detached: true, stdio: "ignore" });
    leftover.unref();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(leftover.pid as number)).toBe(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { stopTicketDaemons } = await import("./test-daemon-cleanup");
    await stopTicketDaemons("notes-app", "TR-90", "TR-90 is Done");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(leftover.pid as number)).toBe(false);
    expect(existsSync(home)).toBe(false);
    expect(existsSync(recordPath)).toBe(false);
    expect(existsSync(join(scratch, "calls.log"))).toBe(false);
    expect(log.mock.calls.map((call) => String(call[0]))).toEqual([`[taro] stopped TR-90's test daemon ${home} (port 6851) because TR-90 is Done: killed ${leftover.pid}`]);
    log.mockRestore();
  });

  it("does nothing for a ticket with no recorded daemon", async () => {
    const { stopTicketDaemons } = await import("./test-daemon-cleanup");
    await stopTicketDaemons("notes-app", "TR-91", "TR-91 is Done");
    expect(existsSync(join(scratch, "calls.log"))).toBe(false);
  });
});
