import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectConfig } from "../shared/project";
import type { PaseoApi } from "./host-types";
import { onboardingProblems } from "./onboard";
import { forgetGitFacts, listPaseoProjects, settingsTemplate } from "./paseo-projects";

let home = "";
vi.mock("./config", () => ({ readGlobalConfig: async () => ({}), resolveTaroHome: () => home }));

let root = "";

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
}

async function repository(name: string, branch = "main"): Promise<string> {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  git(path, "init", "-q", "-b", branch);
  git(path, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init");
  return path;
}

/** A repository cloned from a bare remote whose HEAD names `remoteDefault`. */
async function cloned(name: string, remoteDefault: string): Promise<string> {
  const source = await repository(`${name}-source`, remoteDefault);
  const bare = join(root, `${name}.git`);
  execFileSync("git", ["clone", "-q", "--bare", source, bare]);
  const path = join(root, name);
  execFileSync("git", ["clone", "-q", bare, path]);
  git(path, "checkout", "-q", "-b", "feature");
  return path;
}

function config(project: string, repoPath: string, overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    schemaVersion: 1,
    project,
    paseoProjectId: `prj_taro_${project}`,
    managerAgentId: "",
    managerWorkspaceId: "",
    repoPath,
    baseBranch: "main",
    ticketPrefix: "AB",
    manager: { model: "claude/sonnet", thinking: "" },
    owner: { model: "claude/opus", thinking: "high" },
    subagentModels: [],
    delivery: "pull-request",
    acceptAlsoMerges: true,
    trackerSync: "local",
    compactThresholdTokens: 250_000,
    idleCompactThresholdTokens: 200_000,
    maxParallelOwners: 3,
    ...overrides,
  };
}

interface FakeProject {
  projectId: string;
  projectDisplayName: string;
  projectCustomName?: string | null;
  projectRootPath: string;
  projectKind: "git" | "non_git" | "directory";
}

function fakePaseo(projects: FakeProject[], workspaces: { projectId: string; activityAt: string | null; statusEnteredAt?: string | null }[] = []): PaseoApi {
  return {
    projects: { list: async () => ({ requestId: "r", projects }) },
    workspaces: { list: async () => ({ requestId: "r", entries: workspaces.map((workspace) => ({ statusEnteredAt: null, ...workspace })), pageInfo: {} }) },
  } as unknown as PaseoApi;
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "taro-paseo-projects-")));
  home = join(root, "taro-home");
  forgetGitFacts();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("listPaseoProjects", () => {
  it("reads the remote and its default branch, and the last activity of the project's workspaces", async () => {
    const shop = await cloned("shop", "develop");
    const paseo = fakePaseo(
      [{ projectId: "prj_shop", projectDisplayName: "shop", projectRootPath: shop, projectKind: "git" }],
      [
        { projectId: "prj_shop", activityAt: "2026-10-01T00:00:00Z" },
        { projectId: "prj_shop", activityAt: null, statusEnteredAt: "2026-10-12T00:00:00Z" },
        { projectId: "prj_other", activityAt: "2026-10-13T00:00:00Z" },
      ],
    );
    const [candidate] = await listPaseoProjects(paseo, []);
    expect(candidate).toEqual({
      paseoProjectId: "prj_shop",
      name: "shop",
      repoPath: shop,
      remoteUrl: join(root, "shop.git"),
      defaultBranch: "develop",
      lastActiveAt: "2026-10-12T00:00:00Z",
      taroProject: null,
    });
  });

  it("uses the checked-out branch without a remote, the custom name, and null when never used", async () => {
    const notes = await repository("notes", "trunk");
    const paseo = fakePaseo([{ projectId: "prj_notes", projectDisplayName: "notes", projectCustomName: "Notes App", projectRootPath: notes, projectKind: "git" }]);
    expect(await listPaseoProjects(paseo, [])).toMatchObject([{ name: "Notes App", remoteUrl: null, defaultBranch: "trunk", lastActiveAt: null }]);
  });

  it("leaves out projects that are not git or whose repository is gone", async () => {
    const plain = join(root, "plain");
    await mkdir(plain);
    const paseo = fakePaseo([
      { projectId: "prj_plain", projectDisplayName: "plain", projectRootPath: plain, projectKind: "directory" },
      { projectId: "prj_gone", projectDisplayName: "gone", projectRootPath: join(root, "gone"), projectKind: "git" },
    ]);
    expect(await listPaseoProjects(paseo, [])).toEqual([]);
  });

  it("names the Taro project a repository already is, also through a worktree of it", async () => {
    const shop = await repository("shop");
    const worktree = join(root, "shop-worktree");
    git(shop, "worktree", "add", "-q", "-b", "side", worktree);
    const blog = await repository("blog");
    const paseo = fakePaseo([
      { projectId: "prj_shop", projectDisplayName: "shop", projectRootPath: shop, projectKind: "git" },
      { projectId: "prj_blog", projectDisplayName: "blog", projectRootPath: blog, projectKind: "git" },
    ]);
    const listed = await listPaseoProjects(paseo, [config("store", worktree)]);
    expect(listed.map((candidate) => [candidate.name, candidate.taroProject])).toEqual([
      ["shop", "store"],
      ["blog", null],
    ]);
  });

  it("matches by Paseo project id when the Taro project's repository is gone", async () => {
    const shop = await repository("shop");
    const paseo = fakePaseo([{ projectId: "prj_shop", projectDisplayName: "shop", projectRootPath: shop, projectKind: "git" }]);
    expect(await listPaseoProjects(paseo, [config("store", join(root, "moved"), { paseoProjectId: "prj_shop" })])).toMatchObject([{ taroProject: "store" }]);
  });

  it("still lists projects when the workspace listing fails", async () => {
    const shop = await repository("shop");
    const paseo = {
      projects: { list: async () => ({ requestId: "r", projects: [{ projectId: "prj_shop", projectDisplayName: "shop", projectRootPath: shop, projectKind: "git" }] }) },
      workspaces: { list: async () => Promise.reject(new Error("offline")) },
    } as unknown as PaseoApi;
    expect(await listPaseoProjects(paseo, [])).toMatchObject([{ name: "shop", lastActiveAt: null }]);
  });
});

describe("settingsTemplate", () => {
  async function writeConfig(value: ProjectConfig, changedAt: Date): Promise<void> {
    const path = join(home, "projects", value.project, "taro.json");
    await mkdir(join(home, "projects", value.project), { recursive: true });
    await writeFile(path, JSON.stringify(value), "utf8");
    await utimes(path, changedAt, changedAt);
  }

  it("is the settings of the project changed last", async () => {
    const older = config("older", "/a", { owner: { model: "claude/old", thinking: "" } });
    const newer = config("newer", "/b", { owner: { model: "claude/new", thinking: "max" }, delivery: "local-only", maxParallelOwners: 5 });
    await writeConfig(older, new Date("2026-10-01T00:00:00Z"));
    await writeConfig(newer, new Date("2026-10-10T00:00:00Z"));
    expect(await settingsTemplate([older, newer])).toMatchObject({ project: "newer", owner: { model: "claude/new", thinking: "max" }, delivery: "local-only", maxParallelOwners: 5 });
  });

  it("is null before the first project", async () => {
    expect(await settingsTemplate([])).toBeNull();
  });
});

describe("onboardingProblems", () => {
  const settings = (repoPath: string, overrides: Partial<ProjectConfig> = {}) => {
    const { project: _project, schemaVersion: _version, paseoProjectId: _id, managerAgentId: _agent, managerWorkspaceId: _workspace, ...rest } = config("x", repoPath, overrides);
    return rest;
  };

  it("finds nothing for a fresh repository and an existing branch, local or on the remote", async () => {
    const shop = await cloned("shop", "develop");
    expect(await onboardingProblems({ project: "shop", settings: settings(shop, { baseBranch: "feature" }) })).toEqual({});
    expect(await onboardingProblems({ project: "shop", settings: settings(shop, { baseBranch: "develop" }) })).toEqual({});
  });

  it("puts each problem on its field", async () => {
    const shop = await repository("shop");
    expect(await onboardingProblems({ project: "shop", settings: settings(shop, { baseBranch: "release" }) })).toEqual({ baseBranch: "The repository has no branch named release." });
    expect(await onboardingProblems({ project: "Shop!", settings: settings(join(root, "nowhere")) })).toMatchObject({ project: expect.any(String), repoPath: expect.stringContaining("not inside a git repository") });
    expect(await onboardingProblems({ project: "shop", settings: settings("relative/path") })).toMatchObject({ repoPath: expect.stringContaining("absolute") });
  });

  it("refuses a name another repository has and a repository another project is, but lets the same pair repair", async () => {
    const shop = await repository("shop");
    const blog = await repository("blog");
    await mkdir(join(home, "projects", "store"), { recursive: true });
    await writeFile(join(home, "projects", "store", "taro.json"), JSON.stringify(config("store", shop)), "utf8");
    expect(await onboardingProblems({ project: "store", settings: settings(blog) })).toEqual({ project: "A Taro project is already named store; choose another name." });
    expect(await onboardingProblems({ project: "shop", settings: settings(shop) })).toEqual({ repoPath: "This repository is already the Taro project store." });
    expect(await onboardingProblems({ project: "store", settings: settings(shop) })).toEqual({});
  });
});
