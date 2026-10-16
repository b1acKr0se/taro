import { describe, expect, it } from "vitest";

import { commandsRun } from "./shell-command";

const programs = (command: string) => commandsRun(command).map((run) => [run.program, ...run.args].join(" "));

describe("commandsRun", () => {
  it("splits at separators, pipes, new lines and subshells", () => {
    expect(programs("cd /home/user/project && npm test > /tmp/test.log 2>&1; echo $? || true")).toEqual(["cd /home/user/project", "npm test", "echo $?", "true"]);
    expect(programs("grep -rn x src | head -5\nwc -l a.ts")).toEqual(["grep -rn x src", "head -5", "wc -l a.ts"]);
    expect(programs("(npm run typecheck > /tmp/tc.log 2>&1; echo done) & wait")).toEqual(["npm run typecheck", "echo done", "wait"]);
  });

  it("keeps quoted text and substitutions whole", () => {
    expect(programs(`taro ticket edit NA-1 --append-notes "MILESTONE $(date -u +%H:%M) — a; b && c" 'x | y'`)).toEqual([
      "taro ticket edit NA-1 --append-notes MILESTONE $(date -u +%H:%M) — a; b && c x | y",
    ]);
    expect(programs("echo `date`; ls")).toEqual(["echo `date`", "ls"]);
  });

  it("skips heredoc bodies and comments", () => {
    const command = "python3 - <<'EOF'\nimport os\nos.remove('a') ; git status\nEOF\n# then the tests\nnpm test";
    expect(programs(command)).toEqual(["python3 -", "npm test"]);
    expect(programs("cat <<-END > /tmp/a.txt\n\tgit push\n\tEND\nls")).toEqual(["cat", "ls"]);
  });

  it("marks output written to a file, not to /dev/null or another stream", () => {
    expect(commandsRun("cat > /tmp/notes/probe.mjs <<'EOF'\nx\nEOF").map((run) => run.writesFile)).toEqual([true]);
    expect(commandsRun("grep -q x a.ts > /dev/null 2>&1").map((run) => run.writesFile)).toEqual([false]);
    expect(commandsRun("npm test 2>&1").map((run) => run.writesFile)).toEqual([false]);
  });

  it("takes shell words, assignments and wrappers off the front", () => {
    expect(programs("for f in a.ts b.ts; do echo \"== $f\"; awk '/x/' \"$f\"; done")).toEqual(["echo == $f", "awk /x/ $f"]);
    expect(programs("if grep -q x a.ts; then npm test; else echo no; fi")).toEqual(["grep -q x a.ts", "npm test", "echo no"]);
    expect(programs("{ npm test; } 2>&1")).toEqual(["npm test"]);
    expect(programs("case $x in a) ls ;; esac")).toEqual(["ls"]);
    expect(programs("FOO=1 BAR=$(date -u +%s) time env -u NAME -i A=b nohup timeout -s KILL 300 paseo agent wait id")).toEqual(["paseo agent wait id"]);
    expect(programs("! sudo npm install")).toEqual(["npm install"]);
  });

  it("resolves a program kept in a variable set earlier on the line", () => {
    expect(programs("T=/home/user/project/bin/taro; NOW=$(date -u +%Y-%m-%dT%H:%MZ); $T ticket edit NA-1")).toEqual(["/home/user/project/bin/taro ticket edit NA-1"]);
    expect(programs('export TARO_TRACKER=/tmp/tracker T="/opt/bin/taro"; ${T} ticket view NA-1')).toEqual(["export TARO_TRACKER=/tmp/tracker T=/opt/bin/taro", "/opt/bin/taro ticket view NA-1"]);
    expect(programs("$UNSET run")).toEqual(["$UNSET run"]);
  });

  it("drops calls of a function defined on the line, keeping its body", () => {
    expect(programs("mk() { printf '%s' \"$1\" > /tmp/$2.txt; }\nmk a one\nmk b two")).toEqual(["printf %s $1"]);
  });

  it("marks commands inside while and until loops, not for loops", () => {
    const wait = (command: string) => commandsRun(command).map((run) => `${run.program}:${run.inWaitLoop}`);
    expect(wait("until [ -f /tmp/out.png ]; do sleep 2; done; ls")).toEqual(["[:true", "sleep:true", "ls:false"]);
    expect(wait("for i in 1 2; do sleep 1; done")).toEqual(["sleep:false"]);
  });

  it("reads nothing from an empty or blank line", () => {
    expect(commandsRun("")).toEqual([]);
    expect(commandsRun("  \n ; ")).toEqual([]);
  });
});
