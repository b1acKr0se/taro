import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const SKILL = import.meta.dirname;
const read = (page: string) => readFileSync(join(SKILL, page), "utf8").replace(/\s+/g, " ");
const PAGE = "hosts/outside-paseo.md";

describe("the page for harnesses outside Paseo", () => {
  it("says nothing is required, where taro and the tracker are, and how to take over and hand back", () => {
    const page = read(PAGE);
    expect(page).toContain("nothing is required");
    expect(page).toContain("Node 22.18 or newer");
    expect(page).toContain("bin/taro");
    expect(page).toContain("--tracker");
    expect(page).toContain("taro ticket pause");
    expect(page).toContain("--add-label external-host");
    expect(page).toContain("HANDOFF");
    expect(page).toContain("--remove-label external-host");
    expect(page).toContain("taro ticket resume");
    expect(page).toContain("taro ticket create <title> --paseo");
  });

  it("lists each command and whether it needs the Paseo daemon", () => {
    const page = read(PAGE);
    expect(page).toContain("needs the Paseo daemon");
    for (const command of [
      "taro board",
      "taro ticket create",
      "taro ticket view",
      "taro ticket edit",
      "taro ticket list",
      "taro card",
      "taro agent record",
      "taro agent finish",
      "taro check",
      "taro deliver",
      "taro ticket accept",
      "taro decision answer",
    ]) {
      expect(page, command).toContain(command);
    }
  });

  it("has a section per harness, with only Claude Code marked tested", () => {
    const page = readFileSync(join(SKILL, PAGE), "utf8");
    for (const heading of ["## Claude Code", "## Codex", "## Other harnesses"]) expect(page).toContain(heading);
    expect(page).toContain("AGENTS.md");
    expect(page).toContain("CLAUDE.md");
    expect(page.match(/\(tested\)/g)?.length).toBe(1);
    expect(/## Claude Code[^\n]*\(tested\)/.test(page)).toBe(true);
  });

  it("leaves rule 4 of SKILL.md naming Paseo only for work run under Paseo (rule 4 names Paseo only)", () => {
    const skill = read("SKILL.md");
    const rule = /4\. (.*?) 5\. /.exec(skill)?.[1] ?? "";
    expect(rule).toContain("Paseo agents are for work run under Paseo");
    expect(rule).toContain("harness's own means");
    expect(skill).toContain("hosts/outside-paseo.md");
  });

  it("lists the card commands in actions.md and names the page in the README", () => {
    const actions = read("reference/actions.md");
    for (const command of ["taro card ask", "taro card answer", "taro card withdraw", "taro card show", "taro board"]) {
      expect(actions, command).toContain(command);
    }
    const readme = readFileSync(join(SKILL, "..", "README.md"), "utf8");
    expect(readme).toContain("## Use outside Paseo");
    expect(readme).toContain("skill/hosts/outside-paseo.md");
  });
});

describe("bare environment", () => {
  const taro = join(SKILL, "..", "bin", "taro");
  const scratch = mkdtempSync(join(tmpdir(), "taro-bare."));
  const tracker = join(scratch, "tracker");
  const repository = join(scratch, "repository");
  // Nothing of Paseo's or the user's: only a PATH holding node and git, and a home inside the scratch folder.
  const path = [dirname(process.execPath), "/usr/bin", "/bin"].join(":");
  const run = (...args: string[]) => spawnSync(taro, args, { cwd: repository, env: { PATH: path, HOME: scratch }, encoding: "utf8", input: "" });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("runs every command the page says works without Paseo", () => {
    spawnSync("git", ["init", "-q", "-b", "main", repository], { env: { PATH: path, HOME: scratch } });
    spawnSync("git", ["-C", repository, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init"], { env: { PATH: path, HOME: scratch } });
    mkdirSync(tracker);
    const base = ["--tracker", tracker];
    const created = run("ticket", "create", "Try it", ...base);
    expect(created.status, created.stderr).toBe(0);
    const id = /Created (\S+)/.exec(created.stdout)?.[1] ?? "";
    expect(id).not.toBe("");
    expect(run("ticket", "view", id, ...base).stdout).toContain("external-host");
    expect(run("ticket", "edit", id, "--append-notes", "a note", ...base).status).toBe(0);
    expect(run("ticket", "list", ...base).stdout).toContain(id);
    const card = JSON.stringify({ id: "pick", question: "Which?", why: "w", options: [{ label: "A", prompt: "p", consequence: "c" }], recommended: "A", reason: "r" });
    const spawnCard = spawnSync(taro, ["card", "ask", id, "--file", "-", ...base], { cwd: repository, env: { PATH: path, HOME: scratch }, encoding: "utf8", input: card });
    expect(spawnCard.status, spawnCard.stderr).toBe(0);
    expect(run("card", "show", id, "pick", ...base).status).toBe(0);
    expect(run("card", "answer", id, "pick", "--label", "A", ...base).status).toBe(0);
    expect(run("agent", "record", id, "implementer", "--name", "worker", ...base).status).toBe(0);
    expect(run("agent", "finish", id, "worker", "--state", "done", ...base).status).toBe(0);
    expect(run("board", ...base).stdout).toContain(id);
    const check = run("check", "--project", "notes-app", "--ticket", id, ...base, "--", "true");
    expect(check.status, check.stderr).toBe(0);
    // deliver reaches its own checks (it needs the ticket's delivery facts), not a crash for want of Paseo.
    const deliver = run("deliver", id, "--project", "notes-app", ...base);
    expect(deliver.stderr).not.toContain("Paseo daemon");
    expect(deliver.stderr).not.toMatch(/TypeError|ReferenceError/);
  });

  it("answers a button verb with the daemon's absence, not a crash", () => {
    const accept = run("ticket", "accept", "TR-001", "--project", "notes-app", "--home", join(scratch, "no-daemon"));
    expect(accept.status).toBe(4);
  });
});
