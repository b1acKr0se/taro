// The start question: asked only for an empty repository with no tickets and no choice, answered once.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectConfig } from "../shared/project";
import type { PaseoApi } from "./host-types";
import { managerPrompt, newProjectPending, resolveManager, tellManager } from "./manager";
import { onboardProject } from "./onboard";
import { asksStart, chooseStart, forgetStartAnswers, repositoryIsEmpty } from "./project-start";
import { projectPaths, readProjectConfig, writeProjectConfig } from "./projects";

vi.mock("./manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./manager")>()),
  resolveManager: vi.fn(),
  tellManager: vi.fn(),
}));

const resolveManagerMock = vi.mocked(resolveManager);
const tellManagerMock = vi.mocked(tellManager);
const paseo = {} as PaseoApi;

let scratch = "";
let repo = "";
const savedHome = process.env.PASEO_HOME;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@localhost", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
}

async function project(overrides: Partial<ProjectConfig> = {}): Promise<ProjectConfig> {
  const config = await writeProjectConfig({
    repoPath: repo,
    baseBranch: "main",
    ticketPrefix: "NA",
    manager: { model: "claude/haiku", thinking: "" },
    owner: { model: "claude/haiku", thinking: "" },
    subagentModels: [],
    delivery: "local-only",
    acceptAlsoMerges: true,
    mergeMethod: "merge",
    trackerSync: "local",
    compactThresholdTokens: 250_000,
    idleCompactThresholdTokens: 200_000,
    maxParallelOwners: 3,
    notify: true,
    schemaVersion: 1,
    project: "notes-app",
    paseoProjectId: "p1",
    managerAgentId: "",
    managerWorkspaceId: "",
    start: null,
    ...overrides,
  });
  mkdirSync(join((await projectPaths("notes-app")).tracker, "tickets"), { recursive: true });
  return config;
}

async function addTicket(): Promise<void> {
  writeFileSync(join((await projectPaths("notes-app")).tracker, "tickets", "NA-1.md"), "---\nid: \"NA-1\"\n---\n");
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "taro-project-start-"));
  process.env.PASEO_HOME = join(scratch, "paseo");
  repo = join(scratch, "repo");
  mkdirSync(repo);
  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  forgetStartAnswers();
  resolveManagerMock.mockReset();
  tellManagerMock.mockReset();
  resolveManagerMock.mockResolvedValue({ agent: { id: "m1" } as never });
  tellManagerMock.mockResolvedValue({ agentId: "m1", queued: false });
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = savedHome;
  rmSync(scratch, { recursive: true, force: true });
});

describe("whether a project asks", () => {
  it("empty repository with no tickets asks", async () => {
    // No commits at all yet.
    expect(await asksStart(await project())).toBe(true);
    git("commit", "-q", "--allow-empty", "-m", "start");
    forgetStartAnswers();
    expect(await asksStart(await project())).toBe(true);
  });

  it("a commit with files does not ask", async () => {
    writeFileSync(join(repo, "README.md"), "# notes\n");
    git("add", "README.md");
    git("commit", "-q", "-m", "readme");
    expect(await asksStart(await project())).toBe(false);
  });

  it("two commits, even empty ones, do not ask", async () => {
    git("commit", "-q", "--allow-empty", "-m", "one");
    git("commit", "-q", "--allow-empty", "-m", "two");
    expect(await repositoryIsEmpty(repo)).toBe(false);
  });

  it("a ticket in the tracker does not ask", async () => {
    git("commit", "-q", "--allow-empty", "-m", "start");
    const config = await project();
    await addTicket();
    expect(await asksStart(config)).toBe(false);
  });

  it("a stored choice does not ask", async () => {
    git("commit", "-q", "--allow-empty", "-m", "start");
    expect(await asksStart(await project({ start: "existing" }))).toBe(false);
    expect(await asksStart(await project({ start: "new" }))).toBe(false);
  });

  it("a repository git cannot read does not ask", async () => {
    const notRepository = join(scratch, "plain");
    mkdirSync(notRepository);
    expect(await repositoryIsEmpty(notRepository)).toBeNull();
    expect(await asksStart(await project({ repoPath: notRepository }))).toBe(false);
    expect(await asksStart(await project({ repoPath: join(scratch, "missing") }))).toBe(false);
  });

  it("untracked files do not ask", async () => {
    git("commit", "-q", "--allow-empty", "-m", "start");
    writeFileSync(join(repo, "README.md"), "# notes\n");
    expect(await asksStart(await project())).toBe(false);
    // An ignored file alone leaves it empty.
    rmSync(join(repo, "README.md"));
    writeFileSync(join(repo, ".git", "info", "exclude"), "*.log\n");
    writeFileSync(join(repo, "debug.log"), "x\n");
    forgetStartAnswers();
    expect(await asksStart(await project())).toBe(true);
  });

  it("remembers work git found, so the next ask runs no git", async () => {
    writeFileSync(join(repo, "README.md"), "# notes\n");
    const config = await project();
    expect(await asksStart(config)).toBe(false);
    rmSync(join(repo, "README.md"));
    expect(await asksStart(config)).toBe(false);
    // Another repository path is asked afresh.
    const other = join(scratch, "other");
    mkdirSync(other);
    execFileSync("git", ["-C", other, "init", "-q", "-b", "main"]);
    expect(await asksStart(await project({ repoPath: other }))).toBe(true);
  });
});

describe("choosing", () => {
  beforeEach(() => {
    git("commit", "-q", "--allow-empty", "-m", "start");
  });

  it("start-new stores the choice and tells the manager", async () => {
    await project();
    expect(await chooseStart(paseo, "notes-app", "new")).toMatchObject({ told: true });
    expect((await readProjectConfig("notes-app"))?.start).toBe("new");
    expect(tellManagerMock).toHaveBeenCalledTimes(1);
    const [, name, text] = tellManagerMock.mock.calls[0] ?? [];
    expect(name).toBe("notes-app");
    expect(text).toContain("The user started notes-app as a brand new project.");
    expect(text).toMatch(/\/skill\/reference\/new-project\.md/);
    expect(text).not.toContain("{{");
  });

  it("start-existing stores the choice and tells no one", async () => {
    await project();
    expect(await chooseStart(paseo, "notes-app", "existing")).toMatchObject({ told: false });
    expect((await readProjectConfig("notes-app"))?.start).toBe("existing");
    expect(tellManagerMock).not.toHaveBeenCalled();
  });

  it("no manager: stored, told at its start", async () => {
    resolveManagerMock.mockResolvedValue({ agent: null });
    await project();
    expect(await chooseStart(paseo, "notes-app", "new")).toMatchObject({ told: false, reason: "no manager running" });
    const config = (await readProjectConfig("notes-app")) as ProjectConfig;
    expect(config.start).toBe("new");
    expect(tellManagerMock).not.toHaveBeenCalled();
    expect(await newProjectPending(config)).toBe(true);
    expect(await managerPrompt("notes-app", false, null)).toContain("The user started notes-app as a brand new project.");
    // Not once the manager has filed a ticket, and never for an existing project.
    await addTicket();
    expect(await newProjectPending(config)).toBe(false);
    expect(await managerPrompt("notes-app", true, null)).not.toContain("brand new project");
    await writeProjectConfig({ ...config, start: "existing" });
    expect(await newProjectPending({ ...config, start: "existing" })).toBe(false);
    expect(await managerPrompt("notes-app", false, null)).not.toContain("brand new project");
  });

  it("a manager's prompt reads the choice as stored when it is built, not as its starter read it", async () => {
    const stale = await project();
    await writeProjectConfig({ ...stale, start: "new" });
    expect(stale.start).toBeNull();
    expect(await managerPrompt(stale.project, false, null)).toContain("brand new project");
  });

  it("a send that fails keeps the choice and says why, without promising the running manager gets it", async () => {
    tellManagerMock.mockRejectedValue(new Error("the manager is gone"));
    await project();
    const answer = await chooseStart(paseo, "notes-app", "new");
    expect(answer).toMatchObject({ told: false, reason: "the manager is gone" });
    expect(answer.message).toContain("could not be told (the manager is gone)");
    expect((await readProjectConfig("notes-app"))?.start).toBe("new");
  });

  it("a second choice refuses", async () => {
    await project();
    await chooseStart(paseo, "notes-app", "new");
    await expect(chooseStart(paseo, "notes-app", "existing")).rejects.toThrow("Already chosen: new.");
    await expect(chooseStart(paseo, "notes-app", "new")).rejects.toThrow("Already chosen: new.");
    expect(tellManagerMock).toHaveBeenCalledTimes(1);
    expect((await readProjectConfig("notes-app"))?.start).toBe("new");
  });

  it("two choices at once: one wins, one message", async () => {
    await project();
    const results = await Promise.allSettled([chooseStart(paseo, "notes-app", "new"), chooseStart(paseo, "notes-app", "new")]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(tellManagerMock).toHaveBeenCalledTimes(1);
  });

  it("a project with work refuses", async () => {
    writeFileSync(join(repo, "README.md"), "# notes\n");
    await project();
    await expect(chooseStart(paseo, "notes-app", "new")).rejects.toThrow("This project already has work; nothing to choose.");
    expect((await readProjectConfig("notes-app"))?.start).toBeNull();
    expect(tellManagerMock).not.toHaveBeenCalled();
  });
});

describe("onboarding", () => {
  it("onboarding keeps the start choice", async () => {
    git("commit", "-q", "--allow-empty", "-m", "start");
    const host = { projects: { list: async () => ({ projects: [{ projectId: "p1", projectRootPath: repo }] }) } } as unknown as PaseoApi;
    const input = {
      project: "notes-app",
      startManager: false,
      settings: {
        repoPath: repo,
        baseBranch: "main",
        ticketPrefix: "NA",
        manager: { model: "claude/haiku", thinking: "" },
        owner: { model: "claude/haiku", thinking: "" },
        subagentModels: [],
        delivery: "local-only" as const,
        acceptAlsoMerges: true,
        mergeMethod: "merge" as const,
        trackerSync: "local" as const,
        compactThresholdTokens: 250_000,
        idleCompactThresholdTokens: 200_000,
        maxParallelOwners: 3,
        notify: true,
      },
    };
    // A fresh project starts with no choice.
    expect((await onboardProject(host, input)).config.start).toBeNull();
    await writeProjectConfig({ ...((await readProjectConfig("notes-app")) as ProjectConfig), start: "new" });
    expect((await onboardProject(host, input)).config.start).toBe("new");
    expect((await readProjectConfig("notes-app"))?.start).toBe("new");
  }, 30_000);
});
