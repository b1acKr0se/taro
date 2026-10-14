import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BACKLOG_VERSION,
  backlogEnvironment,
  createBacklogInstaller,
  describeNpmFailure,
  nodeDirectory,
  taroBacklogDirectory,
  taroBacklogPath,
  toolsDirectory,
} from "./backlog-install";
import { pathWithBacklog } from "./environment";
import { backlogCheck, backlogVersion, ghCheck } from "./prerequisites";
import { runCommand } from "./process";
import { backlogBinary, findBacklog, forgetBacklogLookup } from "./tracker";

vi.mock("./package-files", () => ({ skillDirectory: async () => "/skill" }));

let scratch: string;
const savedHome = process.env.PASEO_HOME;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "taro-backlog-install-"));
  process.env.PASEO_HOME = join(scratch, "home");
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = savedHome;
  rmSync(scratch, { recursive: true, force: true });
});

function script(path: string, body: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("which backlog Taro uses", () => {
  it("takes one on the PATH before its own copy", async () => {
    const onPath = script(join(scratch, "bin", "backlog"), "echo 1.0.0");
    script(taroBacklogPath(), "echo 1.53.0");
    expect(await findBacklog([join(scratch, "empty"), join(scratch, "bin")])).toBe(onPath);
  });

  it("falls back to its own copy, and finds nothing without one", async () => {
    expect(await findBacklog([join(scratch, "bin")])).toBeNull();
    script(taroBacklogPath(), "echo 1.53.0");
    expect(await findBacklog([join(scratch, "bin")])).toBe(taroBacklogPath());
  });

  it("skips a file that is not executable", async () => {
    mkdirSync(join(scratch, "bin"), { recursive: true });
    writeFileSync(join(scratch, "bin", "backlog"), "not a program");
    expect(await findBacklog([join(scratch, "bin")])).toBeNull();
  });

  it("looks again after finding nothing, so a backlog installed from a terminal shows", async () => {
    forgetBacklogLookup();
    const directories = [join(scratch, "bin")];
    const find = vi.fn(() => findBacklog(directories));
    expect(await backlogBinary(find)).toBeNull();
    const installed = script(join(scratch, "bin", "backlog"), "echo 1.53.0");
    expect(await backlogBinary(find)).toBe(installed);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("keeps a found backlog without searching again", async () => {
    forgetBacklogLookup();
    const found = script(join(scratch, "bin", "backlog"), "echo 1.53.0");
    const find = vi.fn(() => findBacklog([join(scratch, "bin")]));
    expect(await backlogBinary(find)).toBe(found);
    expect(await backlogBinary(find)).toBe(found);
    expect(find).toHaveBeenCalledTimes(1);
    forgetBacklogLookup();
    expect(await backlogBinary(find)).toBe(found);
    expect(find).toHaveBeenCalledTimes(2);
    forgetBacklogLookup();
  });

  it("gives only its own copy the daemon's Node", () => {
    expect(backlogEnvironment("/usr/local/bin/backlog")).toEqual({});
    expect(backlogEnvironment(taroBacklogPath()).PATH?.split(delimiter)[0]).toBe(nodeDirectory());
  });
});

describe("the agents' PATH", () => {
  it("is left alone with no backlog or the user's own", () => {
    expect(pathWithBacklog(null, "/usr/bin")).toEqual({});
    expect(pathWithBacklog("/usr/local/bin/backlog", "/usr/bin")).toEqual({});
  });

  it("puts Taro's copy first and the daemon's Node last, once", () => {
    const first = pathWithBacklog(taroBacklogPath(), ["/opt/tools/bin", "/bin"].join(delimiter)).PATH ?? "";
    expect(first.split(delimiter)).toEqual([taroBacklogDirectory(), "/opt/tools/bin", "/bin", nodeDirectory()]);
    // A resumed agent arrives with that PATH already.
    expect(pathWithBacklog(taroBacklogPath(), first).PATH).toBe(first);
    expect(pathWithBacklog(taroBacklogPath(), undefined).PATH).toBe([taroBacklogDirectory(), nodeDirectory()].join(delimiter));
  });

  it("keeps a project's own Node ahead of the daemon's", () => {
    const projectNode = "/home/user/.nvm/versions/node/v22.0.0/bin";
    const path = (pathWithBacklog(taroBacklogPath(), [projectNode, "/bin"].join(delimiter)).PATH ?? "").split(delimiter);
    expect(path.indexOf(projectNode)).toBeLessThan(path.indexOf(nodeDirectory()));
    expect(path).toEqual([taroBacklogDirectory(), projectNode, "/bin", nodeDirectory()]);
  });

  it("leaves the daemon's Node where it already is", () => {
    const projectNode = "/home/user/.volta/bin";
    const path = pathWithBacklog(taroBacklogPath(), [projectNode, nodeDirectory(), "/bin"].join(delimiter)).PATH ?? "";
    expect(path.split(delimiter)).toEqual([taroBacklogDirectory(), projectNode, nodeDirectory(), "/bin"]);
  });
});

/** A stand-in npm: records its arguments, then acts as `mode` says. */
function standInNpm(mode: "ok" | "offline" | "missing-version" | "denied" | "other" | "no-space" | "broken-copy"): string {
  const record = join(scratch, "npm-args");
  const linkBody = mode === "broken-copy" ? "echo boom >&2; exit 3" : `echo ${BACKLOG_VERSION}`;
  const outcomes: Record<typeof mode, string> = {
    ok: "",
    "broken-copy": "",
    offline: "echo 'npm error code ENOTFOUND' >&2; echo 'npm error network request to https://registry.npmjs.org/backlog.md failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org' >&2; exit 1",
    "missing-version": `echo 'npm error code ETARGET' >&2; echo 'npm error notarget No matching version found for backlog.md@${BACKLOG_VERSION}.' >&2; exit 1`,
    denied: "echo 'npm error code EACCES' >&2; exit 243",
    other: [
      "echo 'npm warn something harmless' >&2",
      "echo 'npm error code E500' >&2",
      "echo 'npm error 500 Internal Server Error - GET https://registry.example.com/backlog.md' >&2",
      "echo 'npm error A complete log of this run can be found in: /home/user/.npm/_logs/debug.log' >&2",
      "exit 1",
    ].join("; "),
    "no-space": [
      "echo 'npm error code ENOSPC' >&2",
      "echo 'npm error syscall write' >&2",
      "echo 'npm error errno -28' >&2",
      "echo 'npm error nospc Invalid response body while trying to fetch backlog.md: ENOSPC: no space left on device, write' >&2",
      "exit 1",
    ].join("; "),
  };
  return script(
    join(scratch, "npm-bin", "npm"),
    [
      `printf '%s\\n' "$@" >> '${record}'`,
      `echo run >> '${record}.count'`,
      outcomes[mode],
      // npm install --prefix <dir> …: link the CLI where npm would.
      `prefix="$3"; mkdir -p "$prefix/node_modules/.bin"; printf '#!/bin/sh\\n${linkBody}\\n' > "$prefix/node_modules/.bin/backlog"; chmod +x "$prefix/node_modules/.bin/backlog"`,
    ].join("\n"),
  );
}

function installerWith(npm: string | null) {
  const installed = vi.fn();
  const installer = createBacklogInstaller({ findNpm: async () => npm, run: runCommand, installed });
  return { installer, installed };
}

describe("installing Backlog.md", () => {
  it("installs the pinned version into Taro's folder with npm --prefix and reports it", async () => {
    const { installer, installed } = installerWith(standInNpm("ok"));
    expect(installer.state().phase).toBe("idle");
    const started = installer.start();
    expect(started.phase).toBe("running");
    expect(started.step).not.toBeNull();
    await installer.settled();
    expect(installer.state()).toEqual({ phase: "done", step: null, error: null, version: BACKLOG_VERSION });
    const args = readFileSync(join(scratch, "npm-args"), "utf8").split("\n");
    expect(args.slice(0, 4)).toEqual(["install", "--prefix", toolsDirectory(), `backlog.md@${BACKLOG_VERSION}`]);
    expect(args).not.toContain("-g");
    expect(installed).toHaveBeenCalledTimes(1);
    expect(await findBacklog([join(scratch, "nothing")])).toBe(taroBacklogPath());
  });

  it("runs one install for a double press", async () => {
    const { installer } = installerWith(standInNpm("ok"));
    installer.start();
    expect(installer.start().phase).toBe("running");
    await installer.settled();
    expect(readFileSync(join(scratch, "npm-args.count"), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("says npm is missing, with the Node.js link, without trying", async () => {
    const { installer, installed } = installerWith(null);
    installer.start();
    await installer.settled();
    const state = installer.state();
    expect(state.phase).toBe("failed");
    expect(state.error).toContain("npm was not found");
    expect(state.error).toContain("https://nodejs.org/");
    expect(installed).not.toHaveBeenCalled();
    expect(existsSync(toolsDirectory())).toBe(false);
  });

  it("says the registry could not be reached when offline, and can be tried again", async () => {
    const { installer, installed } = installerWith(standInNpm("offline"));
    installer.start();
    await installer.settled();
    expect(installer.state().phase).toBe("failed");
    expect(installer.state().error).toContain("Could not reach the npm registry");
    expect(installed).not.toHaveBeenCalled();
    installer.start();
    await installer.settled();
    expect(readFileSync(join(scratch, "npm-args.count"), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("names npm's own error otherwise", async () => {
    const { installer } = installerWith(standInNpm("other"));
    installer.start();
    await installer.settled();
    expect(installer.state().error).toBe(
      "npm could not install Backlog.md: 500 Internal Server Error - GET https://registry.example.com/backlog.md (E500)",
    );
  });

  it("shows npm's message rather than its code, syscall or errno", async () => {
    const { installer } = installerWith(standInNpm("no-space"));
    installer.start();
    await installer.settled();
    expect(installer.state().error).toBe(
      "npm could not install Backlog.md: nospc Invalid response body while trying to fetch backlog.md: ENOSPC: no space left on device, write",
    );
  });

  it("refuses a copy that does not run", async () => {
    const { installer, installed } = installerWith(standInNpm("broken-copy"));
    installer.start();
    await installer.settled();
    expect(installer.state().error).toBe("Backlog.md was installed but does not run: boom");
    expect(installed).not.toHaveBeenCalled();
  });

  it("turns a crash in the install into a failure, not a stuck spinner", async () => {
    const installer = createBacklogInstaller({
      findNpm: async () => "/nowhere/npm",
      run: async () => {
        throw new Error("spawn /nowhere/npm ENOENT");
      },
      installed: () => undefined,
    });
    installer.start();
    await installer.settled();
    expect(installer.state()).toMatchObject({ phase: "failed", error: "Installing Backlog.md failed: spawn /nowhere/npm ENOENT" });
  });
});

describe("npm's failures in words", () => {
  const failed = (stderr: string) => describeNpmFailure({ code: 1, stdout: "", stderr });

  it("tells a missing version and a refused folder apart", () => {
    expect(failed("npm error code ETARGET")).toContain(`no backlog.md ${BACKLOG_VERSION}`);
    expect(failed("npm error code EACCES")).toContain("not allowed to write");
    expect(failed("npm error code EAI_AGAIN")).toContain("Could not reach the npm registry");
  });

  it("offers the manual command on the known failures", () => {
    expect(failed("npm error code ETIMEDOUT")).toContain(`npm i -g backlog.md@${BACKLOG_VERSION}`);
  });

  it("falls back to the first line when npm says nothing it recognises", () => {
    expect(describeNpmFailure({ code: 7, stdout: "", stderr: "" })).toBe("npm could not install Backlog.md: exit 7");
    expect(failed("Segmentation fault")).toBe("npm could not install Backlog.md: Segmentation fault");
  });
});

describe("the prerequisite lines", () => {
  it("offers Install only on a missing Backlog.md", () => {
    expect(backlogCheck(null)).toMatchObject({ id: "backlog", ok: false, fix: "install-backlog" });
    expect(backlogCheck(null).detail).toContain(BACKLOG_VERSION);
    expect(backlogCheck("1.53.0")).toMatchObject({ ok: true, detail: "backlog 1.53.0", fix: null });
  });

  it("tells a missing gh from a logged-out one", () => {
    expect(ghCheck(null)).toMatchObject({ id: "gh", ok: false });
    expect(ghCheck(null).detail).toContain("https://cli.github.com/");
    expect(ghCheck({ code: 1 }).detail).toContain("gh auth login");
    expect(ghCheck({ code: 0 })).toMatchObject({ ok: true, detail: "logged in" });
  });
});

describe("a copy removed after it was found", () => {
  it("is looked up again, so the check offers Install instead of a stale path", async () => {
    const gone = join(scratch, "gone", "backlog");
    const working = script(join(scratch, "bin", "backlog"), "echo 1.53.0");
    const found = [gone, working];
    const forget = vi.fn(() => found.shift());
    expect(await backlogVersion({ find: async () => found[0] ?? null, forget })).toBe("1.53.0");
    expect(forget).toHaveBeenCalledTimes(1);
  });

  it("reports none when nothing runs, without looping", async () => {
    const forget = vi.fn();
    expect(await backlogVersion({ find: async () => join(scratch, "gone", "backlog"), forget })).toBeNull();
    expect(forget).toHaveBeenCalledTimes(2);
  });
});
