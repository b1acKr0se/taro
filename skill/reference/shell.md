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

## Scratch trackers

`$TARO_TRACKER` in your environment is the live tracker. To try `taro ticket` commands, make a
scratch tracker with `mktemp -d` and pass it as `--tracker`; never experiment against
`$TARO_TRACKER`.

    T=$(mktemp -d /tmp/x-tracker.XXXXXX); taro ticket create "Try" --tracker "$T"

Remove it later by its literal path: `rm -rf -- /tmp/x-tracker.Ab12Cd`.
