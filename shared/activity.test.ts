import { describe, expect, it } from "vitest";

import { latestActivity, toolActivity } from "./activity";

const shell = (command: string) => toolActivity({ type: "tool_call", name: "Bash", detail: { type: "shell", command } });

describe("toolActivity", () => {
  it("names what a shell command is for", () => {
    expect(shell("npm test > /tmp/test.log 2>&1")).toBe("running tests");
    expect(shell("cd /home/user/project && npx vitest run client/card-now.test.ts")).toBe("running tests");
    expect(shell("npm run typecheck")).toBe("type-checking");
    expect(shell("node tools/phone.cjs /pw out.png Board")).toBe("taking screenshots");
    expect(shell("git -c user.name=x commit -m 'fix: y'")).toBe("committing");
    expect(shell("git rebase main")).toBe("rebasing");
    expect(shell("taro ticket edit NA-001 --append-notes 'x'")).toBe("updating the ticket");
    expect(shell("cd /tracker && TARO_TRACKER=/tracker taro ticket view NA-001")).toBe("updating the ticket");
    expect(shell("paseo run -d --provider claude/x 'brief'")).toBe("managing agents");
    expect(shell("grep -rn lastStatus server")).toBe("searching the code");
    expect(shell("npm install")).toBe("installing dependencies");
  });

  it("falls back to the program run, or a plain phrase for an empty command", () => {
    expect(shell("claude -p 'Reply with ok'")).toBe("running claude");
    expect(shell("gh api repos/o/r/pulls")).toBe("running gh api");
    expect(shell("")).toBe("running a command");
    expect(shell("$UNSET x")).toBe("running a command");
  });

  it("keeps every wording a whole command matches, even past its first command (TR-160)", () => {
    expect(shell("taro ticket edit NA-1 -s Planning; echo 'screenshots next'")).toBe("taking screenshots");
    expect(shell("python3 - <<'EOF'\nopen('a.test.ts')\nEOF\nnpx vitest run")).toBe("running tests");
  });

  // TR-160: the kinds found in 2,601 real commands that matched no purpose, which read as their first word.
  it("names the work inside loops, never the shell word", () => {
    expect(shell("cd /home/user/project; for f in client/a.tsx server/b.ts; do echo \"=== $f\"; awk '/^<<<<<<< /,/^>>>>>>> /' \"$f\"; done")).toBe("reading files");
    expect(shell("for t in 5m 1h; do python3 -I -c \"import json; print(1)\" /tmp/run-$t.json $t; done")).toBe("running a Python script");
    expect(shell("for i in $(seq 1 60); do TARO_DAEMON_URL=ws://127.0.0.1:$(cat /tmp/notes-port)/ws node tools/rpc.mjs taro.board '{}'; sleep 5; done")).toBe("running a Node script");
    expect(shell("until [ $(date -u +%s) -ge 1760000000 ]; do sleep 5; done; date -u +%H:%M:%S")).toBe("waiting");
    expect(shell("until [ -f /tmp/notes/out.png ] || ! pgrep -f \"tools/cap.cjs\" >/dev/null; do sleep 2; done; ls -la /tmp/notes")).toBe("waiting");
  });

  it("reads past assignments, set-up and wrappers to the program", () => {
    expect(shell("T=/home/user/project/bin/taro; NOW=$(date -u +%Y-%m-%dT%H:%MZ); $T ticket edit NA-1 --append-notes \"MILESTONE $NOW — x\"")).toBe("updating the ticket");
    expect(shell("export TARO_TRACKER=/home/user/tracker; T=/home/user/project/bin/taro; $T ticket edit NA-1 -s Done")).toBe("updating the ticket");
    expect(shell("cd /home/user/project; export TARO_TRACKER=/home/user/tracker; T=/home/user/project/bin/taro; $T ticket view NA-1")).toBe("reading the ticket");
    expect(shell("B=/home/user/project/bin/taro; T=/tmp/tracker; cd /tmp; $B ticket create \"Sort notes\" --tracker $T")).toBe("updating the ticket");
    expect(shell("set -e; H=/tmp/paseo-NA-1; R=/tmp/notes-app.Ab12Cd; mkdir -p $H/data; git -C $R worktree add -q --orphan -b taro/tickets $H/tracker")).toBe("running git worktree");
    expect(shell("echo \"${TARO_EVIDENCE:-unset}\"; E=/tmp/evidence/NA-1; mkdir -p \"$E\"; cp /tmp/shots/*.png \"$E\"/")).toBe("copying files");
    expect(shell("timeout 300 paseo agent wait 0b1c --home /tmp/paseo-NA-1 > /tmp/w.log 2>&1; echo $?")).toBe("managing agents");
    expect(shell("sleep 60; cat /tmp/tasks/b1.output")).toBe("waiting");
    expect(shell("S=/tmp/shots; PORT=$(cat /tmp/notes-port); sleep 3; node $S/hover.cjs /pw http://127.0.0.1:$PORT/")).toBe("running a Node script");
  });

  it("names scripts by their kind, never by their file name", () => {
    expect(shell("D=/tmp/notes/drive.sh; $D answer scope-approval Approve \"\"; $D show")).toBe("running a shell script");
    expect(shell("/tmp/probe.Ab12Cd/mock.sh b \"Searched the code\"")).toBe("running a shell script");
    expect(shell("bash -c \"printf '[%s]' x\"")).toBe("running a shell script");
    expect(shell("cd /home/user/project; python3 - <<'EOF'\np='a.ts'\nEOF")).toBe("running a Python script");
    expect(shell("/usr/local/bin/python3 scripts/migrate.py")).toBe("running a Python script");
    expect(shell("node tools/rpc.mjs taro.decisions.open '{}'")).toBe("running a Node script");
    expect(shell("npx tsx /tmp/notes/tally.mts")).toBe("running a Node script");
    expect(shell("node --version")).toBe("checking node's version");
    expect(shell("P=$(mktemp -d /tmp/probe.XXXXXX); echo $P; cat > $P/probe.mjs <<'EOF'\nconsole.log(1)\nEOF")).toBe("writing a file");
    expect(shell("S=$(mktemp -d /tmp/prompts.XXXXXX)\nmk() { printf '%s' \"$1\" > $S/$2.txt; }\nmk \"$(cat <<'EOF'\nhello\nEOF\n)\" one")).toBe("writing a file");
  });

  it("words common programs plainly", () => {
    expect(shell("H=/tmp/paseo-NA-1; R=/tmp/notes-app.Ab12Cd; paseo project create \"$R\" --home $H --json")).toBe("calling paseo");
    expect(shell("paseo agent archive 0b1c --force --home /tmp/paseo-NA-1")).toBe("managing agents");
    expect(shell("H=/tmp/paseo-NA-1; paseo logs 0b1c --home $H > /tmp/l.log 2>&1; sed -n 1,4p /tmp/l.log")).toBe("reading an agent's log");
    expect(shell("rm -rf -- /tmp/notes-app.Ab12Cd /tmp/paseo-NA-1")).toBe("removing files");
    expect(shell("E=/tmp/evidence/NA-1; mkdir -p $E && mv /tmp/shots/a.png $E/")).toBe("moving files");
    expect(shell("S=$(mktemp -d /tmp/mock.XXXXXX); echo $S; mkdir -p /tmp/evidence/NA-1")).toBe("making a folder");
    expect(shell("cd /home/user/project; wc -l server/a.ts; sed -n 1,40p server/a.ts")).toBe("reading files");
    expect(shell("cut -c1-400 /tmp/l.log")).toBe("reading files");
    expect(shell("stat -c '%y %n' /home/user/.config/a.json")).toBe("reading files");
    expect(shell("readlink -f $(which paseo)")).toBe("reading files");
    expect(shell("which claude; claude --version")).toBe("looking up a program");
    expect(shell("git checkout -- server/a.test.ts; sed -n 1,34p server/b.ts")).toBe("running git checkout");
    expect(shell("npm run format")).toBe("running the format script");
    expect(shell("echo $PASEO_AGENT_ID")).toBe("printing a value");
    expect(shell("[[ -f /tmp/a ]] && node b.js")).toBe("running a Node script");
    expect(shell("command -v node")).toBe("looking up a program");
    expect(shell("sudo -u bob node a.js")).toBe("running a Node script");
    expect(shell("time -p node a.js")).toBe("running a Node script");
  });

  it("names files by their base name", () => {
    expect(toolActivity({ type: "tool_call", name: "Read", detail: { type: "read", filePath: "/home/user/project/client/card-now.ts" } })).toBe("reading card-now.ts");
    expect(toolActivity({ type: "tool_call", name: "Edit", detail: { type: "edit", filePath: "/home/user/project/shared/board.ts" } })).toBe("editing board.ts");
    expect(toolActivity({ type: "tool_call", name: "Write", detail: { type: "write", filePath: "" } })).toBe("editing");
  });

  it("covers searches, the web, subagents and other tools", () => {
    expect(toolActivity({ type: "tool_call", name: "Grep", detail: { type: "search", toolName: "grep" } })).toBe("searching the code");
    expect(toolActivity({ type: "tool_call", name: "WebSearch", detail: { type: "search", toolName: "web_search" } })).toBe("searching the web");
    expect(toolActivity({ type: "tool_call", name: "WebFetch", detail: { type: "fetch" } })).toBe("reading a web page");
    expect(toolActivity({ type: "tool_call", name: "Task", detail: { type: "sub_agent" } })).toBe("running a subagent");
    expect(toolActivity({ type: "tool_call", name: "mcp__paseo__browser_screenshot", detail: { type: "unknown" } })).toBe("taking screenshots");
    expect(toolActivity({ type: "tool_call", name: "mcp__paseo__browser_click", detail: { type: "unknown" } })).toBe("using the browser");
    expect(toolActivity({ type: "tool_call", name: "mcp__paseo__create_agent", detail: { type: "unknown" } })).toBe("using create agent");
    expect(toolActivity({ type: "tool_call", detail: { type: "unknown" } })).toBe("working");
    expect(toolActivity({ type: "tool_call", name: "Task notification", detail: { type: "plain_text", label: "Run integration suite" } })).toBe("reading a background task's result");
  });
});

describe("latestActivity", () => {
  it("takes the last tool call, past the words after it", () => {
    const entries = [
      { item: { type: "tool_call", name: "Read", detail: { type: "read", filePath: "/a/b.ts" } }, timestamp: "2026-01-01T10:00:00Z" },
      { item: { type: "tool_call", name: "Bash", detail: { type: "shell", command: "npm test" } }, timestamp: "2026-01-01T10:01:00Z" },
      { item: { type: "assistant_message" }, timestamp: "2026-01-01T10:02:00Z" },
    ];
    expect(latestActivity(entries)).toEqual({ text: "running tests", at: "2026-01-01T10:01:00Z" });
  });

  it("is null without a tool call", () => {
    expect(latestActivity([])).toBeNull();
    expect(latestActivity([{ item: { type: "user_message" }, timestamp: "2026-01-01T10:00:00Z" }])).toBeNull();
  });
});
