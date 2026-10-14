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

## Throwaway Backlog projects

`BACKLOG_CWD` and `TARO_TRACKER` in your environment point at the live tracker, and the Backlog
CLI follows `BACKLOG_CWD` from any directory: `backlog init` there renames the live project. For a
scratch or test Backlog project, make a `mktemp -d` directory and run every `backlog` command for it
as `env -u BACKLOG_CWD -u TARO_TRACKER backlog …` from inside it. Never run `backlog init` with
`BACKLOG_CWD` set. The plugin restores a tracker renamed this way and raises an alert, but the
user then has to look into it.
