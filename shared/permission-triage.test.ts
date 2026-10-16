import { describe, expect, it } from "vitest";

import { triageCommand, triagePermission, type Triage } from "./permission-triage";

const context = { cwd: "/home/user/.paseo/worktrees/abc/tr-1", home: "/home/user" };
const verdict = (command: string): Triage => triageCommand(command, context);

describe("triagePermission", () => {
  it("decides only shell tool asks", () => {
    const command = { command: "rm -rf -- /" };
    expect(triagePermission({ name: "Bash", kind: "tool", input: command }, context)).toMatchObject({ verdict: "deny", rule: "root" });
    expect(triagePermission({ name: "Write", kind: "tool", input: command }, context)).toEqual({ verdict: "ask" });
    expect(triagePermission({ name: "Bash", kind: "question", input: command }, context)).toEqual({ verdict: "ask" });
    expect(triagePermission({ name: "ExitPlanMode", kind: "plan", input: { plan: "rm -rf /" } }, context)).toEqual({ verdict: "ask" });
    expect(triagePermission({ name: "Bash", kind: "tool", input: {} }, context)).toEqual({ verdict: "ask" });
    expect(triagePermission({ name: "Bash", kind: "tool", input: null }, context)).toEqual({ verdict: "ask" });
  });
});

describe("allowed: literal paths in scratch space or the worktree", () => {
  it.each([
    ["rm -rf -- /tmp/paseo-TR-012", ["/tmp/paseo-TR-012"]],
    ["rm -rf /tmp/paseo-TR-012 /tmp/notes-app.Ab12Cd", ["/tmp/paseo-TR-012", "/tmp/notes-app.Ab12Cd"]],
    ["rm -f '/tmp/a b/c.png'", ["/tmp/a b/c.png"]],
    ["rm -rf /home/user/.paseo/worktrees/abc/tr-1/node_modules", ["/home/user/.paseo/worktrees/abc/tr-1/node_modules"]],
    ["S=/tmp/x-scratch.Ab12Cd; ls $S; rm -rf -- \"${S:?}\"", ["/tmp/x-scratch.Ab12Cd"]],
    ["export S=/tmp/x; rm -rf \"$S/sub\"", ["/tmp/x/sub"]],
    ["rmdir /tmp/empty && echo done 2>&1 >/dev/null", ["/tmp/empty"]],
    ["cd /tmp && rm -rf /tmp/old # cleanup", ["/tmp/old"]],
    ["D='/tmp/x y'; rm -rf \"$D\"", ["/tmp/x y"]],
    ["S=/tmp/a && rm -rf $S", ["/tmp/a"]],
    ["echo hi 2>&1 >&2 >&-; rm -rf /tmp/a", ["/tmp/a"]],
  ])("%s", (command, paths) => {
    expect(verdict(command)).toEqual({ verdict: "allow", rule: "scratch-or-worktree", paths });
  });
});

describe("denied: removals no unattended agent should make", () => {
  it.each([
    // TR-140: cleanup after `mkdir -p $E` with E empty.
    ["E=/x; mkdir -p $E; cp /tmp/a.png $E/; ls $E; rm -rf -- /TR-140; ls -d /TR-140", "top-level", "/TR-140"],
    ["rm -rf /", "root", "/"],
    ["rm -rf /*", "root", "/"],
    ["rm -rf /tmp", "top-level", "/tmp"],
    ["rm -rf /tmp/*", "top-level", "/tmp"],
    ["rm -rf /tmp/..", "root", "/"],
    ["rm -rf ~", "home", "/home/user"],
    ["rm -rf ~/", "home", "/home/user"],
    ["rm -rf /home/user/workspace", "home", "/home/user/workspace"],
    ["rm -rf /home/user/.paseo/worktrees/abc/tr-1", "working-directory", "/home/user/.paseo/worktrees/abc/tr-1"],
    ["rm -rf /home/user/.paseo/worktrees", "working-directory", "/home/user/.paseo/worktrees"],
    ["rm -rf /usr/local/lib/thing", "system", "/usr/local/lib/thing"],
    ["rm -rf /etc", "system", "/etc"],
    ["rm -rf /var/tmp", "system", "/var/tmp"],
    ["rm -rf $DIR/", "unguarded-variable", "/"],
    ["rm -rf $DIR/*", "unguarded-variable", "/"],
    ["rm -rf \"$DIR\"/home", "unguarded-variable", "/home"],
    ["rm -rf /tmp/$NAME", "unguarded-variable", "/tmp"],
    // An assignment that may not have run in this shell leaves the variable unknown.
    ["true || HOME=/tmp/a; rm -rf $HOME/", "unguarded-variable", "/"],
    ["HOME=/tmp/a & rm -rf $HOME/", "unguarded-variable", "/"],
    ["D=/tmp/a | rm -rf $D/", "unguarded-variable", "/"],
    ["rm -rf $DIR/sub", "unguarded-variable", "/sub"],
    ["E=$TARO_EVIDENCE/TR-140; rm -rf $E", "unguarded-variable", "/TR-140"],
    ["E=; rm -rf $E/x", "top-level", "/x"],
    ["ls /tmp; rm -rf /tmp/ok /", "root", "/"],
  ])("%s", (command, rule, path) => {
    expect(verdict(command)).toEqual({ verdict: "deny", rule, path });
  });
});

describe("left to the user", () => {
  it.each([
    "cd /home/user/project && rm -rf sub/*",
    "rm -rf build",
    "rm -rf $(mktemp -d)",
    "rm -rf `pwd`/x",
    "rm -rf \"${S:?}\"",
    "rm -rf \"${S:?}/sub\"",
    "rm -rf /tmp/tr-1-*",
    "rm -rf /tmp/*.png",
    "rm -rf /home/user/work/other-project",
    "rm -rf /home/user/.paseo/worktrees/abc/tr-1/.git",
    "rm -rf /var/tmp/x",
    // Review of TR-143: an unquoted value is split and globbed; an IFS change splits elsewhere.
    "cd /; D='/tmp/x etc'; rm -rf $D",
    "cd /; IFS=/; D=/tmp/etc; rm -rf $D",
    "D='/tmp/*'; rm -rf $D",
    // `>&file` writes the file.
    "echo x >&/home/user/.bashrc; rm -rf /tmp/a",
    "echo x >& /home/user/.bashrc; rm -rf /tmp/a",
    "echo x 2>&1x; rm -rf /tmp/a",
    // Modes that write or assign.
    "D=/tmp/a; printf -v D %s /etc; rm -rf -- \"$D\"/x",
    "date -s 2020-01-01; rm -rf /tmp/a",
    "rm -rf /tmp/a/../b",
    "rm -rf /tmp/x; echo hi > /home/user/.bashrc",
    "rm -rf /tmp/x && git push --force",
    "rm -rf /tmp/x | sh",
    "rm -rf /tmp/x; cat <<EOF\nhi\nEOF",
    "(rm -rf /tmp/x)",
    "{ rm -rf /tmp/x; }",
    "sudo rm -rf /tmp/x",
    "$RM -rf /tmp/x",
    "rm -rf 'unterminated",
    "git clean -fdx",
    "echo hello",
    "",
  ])("%s", (command) => {
    expect(verdict(command)).toEqual({ verdict: "ask" });
  });
});
