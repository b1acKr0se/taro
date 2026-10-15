import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { TARO_HOOK_MARKER, reloadHookCommand, taroHookEntry, withTaroHook } from "../shared/claude-settings";

const command = reloadHookCommand("/home/user/.paseo/plugin-data/taro/reload", "/home/user/.paseo/plugins/taro/skill");

/** The text `withTaroHook` inserted: everything else must equal the original, byte for byte. */
function inserted(before: string, after: string): string {
  let prefix = 0;
  while (prefix < before.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  expect(after.slice(0, prefix) + after.slice(after.length - suffix)).toBe(before);
  return after.slice(prefix, after.length - suffix);
}

function sessionStart(text: string): unknown[] {
  return (JSON.parse(text) as { hooks: { SessionStart: unknown[] } }).hooks.SessionStart;
}

describe("withTaroHook", () => {
  it("writes a new file when there is none, or only whitespace", () => {
    for (const text of [null, "", "  \n"]) {
      const merged = withTaroHook(text, command) ?? "";
      expect(JSON.parse(merged)).toEqual({ hooks: { SessionStart: [taroHookEntry(command)] } });
      expect(merged.endsWith("}\n")).toBe(true);
    }
  });

  it("keeps a user's permissions file byte for byte and adds only Taro's hook", () => {
    const before = '{\n  "permissions": {\n    "allow": ["Bash(npm test:*)", "Read(//tmp/**)"],\n    "deny": []\n  },\n  "model": "sonnet"\n}\n';
    const after = withTaroHook(before, command) ?? "";
    const added = inserted(before, after);
    expect(added.startsWith(',\n  "hooks": {\n    "SessionStart": [\n      {\n        "matcher": "compact"')).toBe(true);
    expect(JSON.parse(after)).toMatchObject({ permissions: { allow: ["Bash(npm test:*)", "Read(//tmp/**)"], deny: [] }, model: "sonnet" });
    expect(sessionStart(after)).toEqual([taroHookEntry(command)]);
  });

  it("follows the file's own indent and odd spacing without touching it", () => {
    const before = '{\n\t"permissions" :{"allow":["Bash(ls)"]},\n\t"env":  {"A": "1"}\n}';
    const after = withTaroHook(before, command) ?? "";
    expect(inserted(before, after)).toMatch(/^,\n\t"hooks": \{\n\t\t"SessionStart": \[\n\t\t\t\{/);
    expect(JSON.parse(after)).toMatchObject({ env: { A: "1" } });
  });

  it("adds SessionStart beside the user's other hooks, and Taro's entry after the user's SessionStart ones", () => {
    const user = { type: "command", command: "echo hi" };
    const withPreTool = JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [user] }] } }, null, 2);
    const merged = withTaroHook(withPreTool, command) ?? "";
    inserted(withPreTool, merged);
    expect(JSON.parse(merged)).toEqual({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [user] }], SessionStart: [taroHookEntry(command)] } });

    const withStart = JSON.stringify({ hooks: { SessionStart: [{ matcher: "startup", hooks: [user] }] } }, null, 2);
    const both = withTaroHook(withStart, command) ?? "";
    inserted(withStart, both);
    expect(sessionStart(both)).toEqual([{ matcher: "startup", hooks: [user] }, taroHookEntry(command)]);
  });

  it("fills empty objects and arrays, minified or not", () => {
    for (const before of ["{}", "{ }", '{"hooks":{}}', '{"hooks":{"SessionStart":[]}}']) {
      const after = withTaroHook(before, command) ?? "";
      expect(sessionStart(after)).toEqual([taroHookEntry(command)]);
    }
  });

  it("is idempotent, and replaces only its own entry when the command changes", () => {
    const before = '{\n  "permissions": {"allow": []},\n  "hooks": {\n    "SessionStart": [\n      {"matcher": "startup", "hooks": []}\n    ]\n  }\n}\n';
    const once = withTaroHook(before, command) ?? "";
    expect(withTaroHook(once, command)).toBe(once);
    const moved = reloadHookCommand("/srv/paseo/plugin-data/taro/reload", "/srv/paseo/plugins/taro/skill");
    const again = withTaroHook(once, moved) ?? "";
    expect(sessionStart(again)).toEqual([{ matcher: "startup", hooks: [] }, taroHookEntry(moved)]);
    // Taro's entry swapped back gives the very first merge: nothing else moved.
    expect(withTaroHook(again, command)).toBe(once);
  });

  it("drops duplicate Taro entries, keeping the user's", () => {
    const user = { matcher: "startup", hooks: [] };
    const before = JSON.stringify({ hooks: { SessionStart: [taroHookEntry("old # " + TARO_HOOK_MARKER), user, taroHookEntry("older # " + TARO_HOOK_MARKER)] } }, null, 2);
    expect(sessionStart(withTaroHook(before, command) ?? "")).toEqual([taroHookEntry(command), user]);
  });

  it("leaves alone a file it cannot merge without rewriting it", () => {
    for (const text of ["{ not json", "[]", '"text"', '{"hooks": []}', '{"hooks": {"SessionStart": {}}}', "// comment\n{}"]) {
      expect(withTaroHook(text, command)).toBeNull();
    }
  });

  it("keeps keys and strings holding brackets, quotes and escapes intact", () => {
    const before = '{"a]\\"}": "x{[\\\\", "b": [1, -2.5e3, true, null, {"c": "]"}]}';
    const after = withTaroHook(before, command) ?? "";
    inserted(before, after);
    expect(JSON.parse(after)).toMatchObject({ 'a]"}': "x{[\\", b: [1, -2500, true, null, { c: "]" }] });
  });
});

describe("reloadHookCommand", () => {
  const scratch = mkdtempSync(join(tmpdir(), "taro-hook-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const environment = (agentId: string | null) => {
    const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
    if (agentId !== null) env.PASEO_AGENT_ID = agentId;
    return env;
  };
  const run = (hook: string, agentId: string | null = "agent-1") =>
    spawnSync("sh", ["-c", hook], { encoding: "utf8", env: environment(agentId), input: '{"hook_event_name":"SessionStart","source":"compact"}', timeout: 5000 });
  const skill = mkdtempSync(join(scratch, "skill "));
  const folder = mkdtempSync(join(scratch, "it's reload-"));
  writeFileSync(join(folder, "agent-1.md"), "Your context was compacted. Reread the rules.\n");

  it("prints the agent's own reload text while the plugin's skill and its file are there", () => {
    expect(run(reloadHookCommand(folder, skill))).toMatchObject({ status: 0, stdout: "Your context was compacted. Reread the rules.\n", stderr: "" });
  });

  it("exits 0 and prints nothing when the plugin was moved, updated or removed, or the reload file is gone", () => {
    const cases: [string, string | null][] = [
      [reloadHookCommand(folder, join(scratch, "no-skill")), "agent-1"], // plugin moved or removed
      [reloadHookCommand(join(scratch, "no-folder"), skill), "agent-1"], // data folder gone
      [reloadHookCommand(join(scratch, "no-folder"), join(scratch, "no-skill")), "agent-1"],
      [reloadHookCommand(folder, skill), "agent-2"], // a subagent sharing the worktree, or an archived agent
      [reloadHookCommand(folder, skill), null], // not a Paseo agent
      [reloadHookCommand(folder, skill), ""],
    ];
    for (const [hook, agentId] of cases) expect(run(hook, agentId)).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });

  it("exits 0 and prints nothing when the reload file is a folder", () => {
    const odd = mkdtempSync(join(scratch, "odd-"));
    mkdirSync(join(odd, "agent-1.md"));
    expect(run(reloadHookCommand(odd, skill))).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });

  it("never waits on its input and carries a short timeout", async () => {
    // Claude keeps the hook's stdin open; a command reading it would hang the session start.
    const child = spawn("sh", ["-c", reloadHookCommand(folder, skill)], { env: environment("agent-1"), stdio: ["pipe", "pipe", "pipe"] });
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(-1);
      }, 5000);
      child.on("close", (status) => {
        clearTimeout(timer);
        resolve(status);
      });
    });
    expect(code).toBe(0);
    expect(taroHookEntry(command)).toMatchObject({ hooks: [{ timeout: 10 }] });
  });
});
