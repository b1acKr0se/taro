/**
 * TR-073: the Backlog CLI runs as the native binary behind npm's wrapper, in the tracker, at most
 * four at once. A fake npm layout on PATH: `bin/backlog` → `backlog.md/cli.js`, and the platform
 * package's `backlog`, which records how it was run.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { forgetBacklogLookup, runBacklog } from "./tracker";

const previousPath = process.env.PATH;
let root = "";

function executable(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "taro-run-backlog-")));
  const modules = join(root, "lib", "node_modules");
  const log = join(root, "log");
  const running = join(root, "running");
  mkdirSync(running);
  executable(join(modules, "backlog.md", "cli.js"), `#!/bin/sh\necho wrapper >> "${log}"\n`);
  // Counts the copies running beside it, then stays a moment so the calls overlap.
  executable(
    join(modules, "backlog.md", "node_modules", `backlog.md-${process.platform}-${process.arch}`, "backlog"),
    `#!/bin/sh\ntouch "${running}/$$"\necho "native $(ls "${running}" | wc -l) $BACKLOG_CWD $(pwd)" >> "${log}"\nsleep 0.2\nrm "${running}/$$"\necho "ran $*"\n`,
  );
  mkdirSync(join(root, "bin"));
  symlinkSync(join(modules, "backlog.md", "cli.js"), join(root, "bin", "backlog"));
  mkdirSync(join(root, "tracker"));
  process.env.PATH = [join(root, "bin"), previousPath ?? ""].join(delimiter);
  forgetBacklogLookup();
});

afterEach(() => {
  process.env.PATH = previousPath;
  forgetBacklogLookup();
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("runBacklog", () => {
  it("runs the native binary in the tracker, never more than four at once", async () => {
    const tracker = join(root, "tracker");
    const outputs = await Promise.all(Array.from({ length: 10 }, (_, index) => runBacklog(tracker, ["task", "view", `X-${index}`, "--json"])));
    expect(outputs).toEqual(Array.from({ length: 10 }, (_, index) => `ran task view X-${index} --json\n`));
    const lines = readFileSync(join(root, "log"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(10);
    expect(lines.some((line) => line === "wrapper")).toBe(false);
    const counts = lines.map((line) => Number(line.split(" ")[1]));
    expect(Math.max(...counts)).toBe(4);
    expect(lines.every((line) => line.endsWith(` ${tracker} ${tracker}`))).toBe(true);
  });

  it("runs the wrapper when the platform package is gone", async () => {
    rmSync(join(root, "lib", "node_modules", "backlog.md", "node_modules"), { recursive: true });
    forgetBacklogLookup();
    await runBacklog(join(root, "tracker"), ["task", "list", "--json"]);
    expect(readFileSync(join(root, "log"), "utf8")).toBe("wrapper\n");
  });
});
