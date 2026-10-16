# Shell commands that run unattended

You often run with nobody watching. Claude Code keeps a few built-in safety checks even in bypass
mode: a command that hits one waits for a person to approve it, and overnight nobody does. Each of
these waits for approval:

- `cd <dir> && rm -rf sub/*`: a relative glob removed after a `cd`
- `rm -rf $(…)` or `` rm -rf `…` ``: a removal target made by a command
- `rm -rf $DIR/` or `rm -rf $DIR/*`: a variable that leaves `/` or `/*` when it is empty
- removing the working directory, one of its parents, your home, or a system directory

Write removals so they pass instead:

- **Make scratch space with `mktemp -d`** and print its path. Remove it later by that literal
  absolute path, `rm -rf -- /tmp/x-scratch.Ab12Cd`, or in the same command with the variable quoted
  and guarded: `S=$(mktemp -d /tmp/x-scratch.XXXXXX); …; rm -rf -- "${S:?}"`. Let the `mktemp -d`
  directory be the thing itself (a scratch repository: `R=$(mktemp -d /tmp/notes-app.XXXXXX); git
  -C "$R" init`), never a folder inside it that you later climb out of with `dirname`.
- **Remove absolute paths**, never relative paths after a `cd`. Prefer `git -C <path>` and
  absolute paths to `cd`.
- **Guard any variable you remove under**: `"${NAME:?}/sub"`, never `$NAME/` or `$NAME/*`.
- Never remove a worktree or directory you are working in; leave that to the plugin or the user.

## When Taro answers the ask for you

In bypass mode the plugin answers some of these asks by fixed rules, without asking the user, and
notes each answer on your ticket as a PERMISSION record:

- **Allowed:** every removal in the command targets a literal absolute path (or a variable the same
  command set to one) inside `/tmp/<name>` or inside your working directory, and the rest of the
  command only reads (`ls`, `echo`, `test`…).
- **Denied:** a removal of `/`, a folder directly under `/`, a system folder, your home or a folder
  directly in it, your working directory or a folder that contains it, or a path that one of those
  becomes when a variable in it is empty. The denial names the rule; it counts as a breach of these
  rules on your ticket. Do not retry the removal in another form: leave a folder you made by mistake
  and name it in your report, or rewrite the command as above.
- Everything else waits for the user, as before.

## Scratch trackers

`$TARO_TRACKER` in your environment is the live tracker. To try `taro ticket` commands, make a
scratch tracker with `mktemp -d` and pass it as `--tracker`; never experiment against
`$TARO_TRACKER`.

    T=$(mktemp -d /tmp/x-tracker.XXXXXX); taro ticket create "Try" --tracker "$T"

Remove it later by its literal path: `rm -rf -- /tmp/x-tracker.Ab12Cd`.
