import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchLiveAgent } from "./agents";
import { installCompactHook, reloadFilePath, removeReloadFile } from "./compact-hook";
import type { PaseoAgent, PaseoApi } from "./host-types";

const scratch = mkdtempSync(join(tmpdir(), "taro-compact-hook-"));
const data = join(scratch, "plugin-data");
const projects = join(scratch, "projects");
const skill = join(scratch, "skill");
mkdirSync(skill);

vi.mock("./agents", () => ({ fetchLiveAgent: vi.fn() }));
vi.mock("./data-dir", () => ({ dataPath: (entry: string) => join(data, entry) }));
vi.mock("./projects", () => ({ projectsDirectory: async () => projects }));
vi.mock("./package-files", () => ({ skillDirectory: async () => skill }));
vi.mock("./supervision", () => ({
  identityFromLabels: (labels: Record<string, string>) =>
    labels["taro.role"] === undefined ? null : { project: labels["taro.project"], role: labels["taro.role"], ticket: labels["taro.ticket"] ?? null, title: null },
  reloadText: async (identity: { role: string; ticket: string | null }) => `reload ${identity.role} ${identity.ticket ?? "-"}`,
}));

// Git here must not see this machine's own ignore files (one may already ignore settings.local.json).
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.XDG_CONFIG_HOME = join(scratch, "xdg");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

function repository(): string {
  const path = mkdtempSync(join(scratch, "notes-app-"));
  git(path, "init", "-q", "-b", "main");
  writeFileSync(join(path, "README.md"), "notes\n");
  git(path, "add", ".");
  git(path, "-c", "user.name=Alex", "-c", "user.email=alex@example.com", "commit", "-q", "-m", "init");
  return path;
}

function liveAgent(labels: Record<string, string> | null): void {
  vi.mocked(fetchLiveAgent).mockResolvedValue(labels === null ? null : ({ id: "agent-1", labels } as unknown as PaseoAgent));
}

const owner = { "taro.project": "notes-app", "taro.role": "owner", "taro.ticket": "NA-7" };
const paseo = {} as PaseoApi;

beforeEach(() => vi.mocked(fetchLiveAgent).mockReset());

describe("installCompactHook", () => {
  it("adds the hook to an owner's existing settings byte for byte, excludes the file and leaves the worktree clean", async () => {
    const worktree = repository();
    mkdirSync(join(worktree, ".claude"));
    const before = '{\n  "permissions": {\n    "allow": ["Bash(npm test:*)"]\n  }\n}\n';
    writeFileSync(join(worktree, ".claude", "settings.local.json"), before);
    liveAgent(owner);

    expect(await installCompactHook(paseo, { agentId: "agent-1", cwd: worktree, provider: "claude" })).toMatch(/hook written/);
    const after = readFileSync(join(worktree, ".claude", "settings.local.json"), "utf8");
    expect(after.startsWith('{\n  "permissions": {\n    "allow": ["Bash(npm test:*)"]\n  },\n  "hooks": {')).toBe(true);
    expect(after.endsWith("  }\n}\n")).toBe(true);
    expect(readFileSync(reloadFilePath("agent-1"), "utf8")).toBe("reload owner NA-7\n");
    expect(readFileSync(join(worktree, ".git", "info", "exclude"), "utf8")).toMatch(/\n\*\*\/\.claude\/settings\.local\.json\n$/);
    expect(git(worktree, "status", "--porcelain")).toBe("");

    // Its hook prints this agent's reload text, from the worktree's own settings.
    const command = (JSON.parse(after) as { hooks: { SessionStart: { hooks: { command: string }[] }[] } }).hooks.SessionStart[0]?.hooks[0]?.command ?? "";
    expect(execFileSync("sh", ["-c", command], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", PASEO_AGENT_ID: "agent-1" } })).toBe("reload owner NA-7\n");

    // A resume changes nothing and adds no second exclude line.
    expect(await installCompactHook(paseo, { agentId: "agent-1", cwd: worktree, provider: "claude" })).toBeNull();
    expect(readFileSync(join(worktree, ".claude", "settings.local.json"), "utf8")).toBe(after);
    expect(readFileSync(join(worktree, ".git", "info", "exclude"), "utf8").match(/settings\.local\.json/g)).toHaveLength(1);
  });

  it("excludes through the main repository from a linked worktree", async () => {
    const main = repository();
    const linked = join(scratch, "linked-worktree");
    git(main, "worktree", "add", "-q", "-b", "taro/na-8", linked);
    liveAgent({ ...owner, "taro.ticket": "NA-8" });
    await installCompactHook(paseo, { agentId: "agent-2", cwd: linked, provider: "claude" });
    expect(git(linked, "status", "--porcelain")).toBe("");
    expect(git(main, "status", "--porcelain")).toBe("");
  });

  it("finds a manager by its home under the projects folder when it has no labels yet", async () => {
    const home = join(projects, "notes-app");
    mkdirSync(home, { recursive: true });
    liveAgent(null);
    expect(await installCompactHook(paseo, { agentId: "manager-1", cwd: home, provider: "claude" })).toMatch(/hook written/);
    expect(readFileSync(reloadFilePath("manager-1"), "utf8")).toBe("reload manager -\n");
    expect(existsSync(join(home, ".claude", "settings.local.json"))).toBe(true);
  });

  it("leaves Codex agents, subagents and other agents alone", async () => {
    const worktree = repository();
    liveAgent(owner);
    expect(await installCompactHook(paseo, { agentId: "agent-3", cwd: worktree, provider: "codex" })).toBeNull();
    liveAgent({ ...owner, "taro.role": "implementer" });
    expect(await installCompactHook(paseo, { agentId: "agent-4", cwd: worktree, provider: "claude" })).toBeNull();
    liveAgent({});
    expect(await installCompactHook(paseo, { agentId: "agent-5", cwd: worktree, provider: "claude" })).toBeNull();
    expect(existsSync(join(worktree, ".claude"))).toBe(false);
    expect(existsSync(join(worktree, ".git", "info", "exclude")) ? readFileSync(join(worktree, ".git", "info", "exclude"), "utf8") : "").not.toMatch(/settings\.local/);
  });

  it("leaves a settings file it cannot merge exactly as it was", async () => {
    const worktree = repository();
    mkdirSync(join(worktree, ".claude"));
    writeFileSync(join(worktree, ".claude", "settings.local.json"), "{ broken");
    liveAgent(owner);
    expect(await installCompactHook(paseo, { agentId: "agent-6", cwd: worktree, provider: "claude" })).toMatch(/left .* alone/);
    expect(readFileSync(join(worktree, ".claude", "settings.local.json"), "utf8")).toBe("{ broken");
  });

  it("quiets an archived agent's hook by removing its reload file", async () => {
    const worktree = repository();
    liveAgent(owner);
    await installCompactHook(paseo, { agentId: "agent-7", cwd: worktree, provider: "claude" });
    await removeReloadFile("agent-7");
    expect(existsSync(reloadFilePath("agent-7"))).toBe(false);
    await removeReloadFile("agent-7"); // already gone: no error
  });
});
