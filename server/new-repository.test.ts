import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepository, ensureFirstCommit, planRepository } from "./new-repository";

let root = "";
const savedEnvironment = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM, name: process.env.GIT_AUTHOR_NAME };
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "taro-newrepo-")));
  // No git identity anywhere: the empty commit must still be made.
  process.env.GIT_CONFIG_GLOBAL = join(root, "no-global-config");
  process.env.GIT_CONFIG_SYSTEM = join(root, "no-system-config");
  delete process.env.GIT_AUTHOR_NAME;
});
afterEach(async () => {
  for (const [key, value] of [["GIT_CONFIG_GLOBAL", savedEnvironment.global], ["GIT_CONFIG_SYSTEM", savedEnvironment.system], ["GIT_AUTHOR_NAME", savedEnvironment.name]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(root, { recursive: true, force: true });
});

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
}

describe("a project's repository that does not exist yet", () => {
  it("creates the folder and a repository on the base branch with one empty commit, with no git identity set", async () => {
    const path = join(root, "a", "notes-app");
    const plan = await planRepository(path);
    expect(plan).toEqual({ kind: "create", path });
    const created = await createRepository(plan, "develop");
    await ensureFirstCommit(created, "develop");
    expect(git(created, "symbolic-ref", "--short", "HEAD")).toBe("develop");
    expect(git(created, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(created, "show", "--stat", "--format=%s", "HEAD")).toBe("chore: start the project");
  });

  it("initialises a folder that has files and leaves them untracked and unchanged", async () => {
    const path = join(root, "notes");
    await mkdir(path);
    await writeFile(join(path, "todo.txt"), "milk\n", "utf8");
    const created = await createRepository(await planRepository(path), "main");
    await ensureFirstCommit(created, "main");
    expect(git(created, "status", "--porcelain")).toBe("?? todo.txt");
    expect(git(created, "ls-tree", "-r", "--name-only", "HEAD")).toBe("");
    expect(await readFile(join(path, "todo.txt"), "utf8")).toBe("milk\n");
  });

  it("gives a repository with no commits its first one, and leaves one with commits alone", async () => {
    const path = join(root, "empty");
    await mkdir(path);
    git(path, "init", "-q", "-b", "develop");
    await ensureFirstCommit(path, "develop");
    expect(git(path, "rev-list", "--count", "HEAD")).toBe("1");
    await ensureFirstCommit(path, "develop");
    expect(git(path, "rev-list", "--count", "HEAD")).toBe("1");
  });

  it("does not commit on a branch other than the base branch", async () => {
    const path = join(root, "other");
    await mkdir(path);
    git(path, "init", "-q", "-b", "trunk");
    await ensureFirstCommit(path, "develop");
    expect(git(path, "rev-list", "--all", "--count")).toBe("0");
  });

  it("plans an existing repository's top for a folder inside it, and refuses a file", async () => {
    const path = join(root, "repo");
    await mkdir(join(path, "src"), { recursive: true });
    git(path, "init", "-q", "-b", "main");
    expect(await planRepository(join(path, "src"))).toEqual({ kind: "existing", root: path });
    await writeFile(join(root, "f"), "", "utf8");
    await expect(planRepository(join(root, "f"))).rejects.toThrow("is a file");
    await expect(planRepository("relative")).rejects.toThrow("absolute");
  });
});
