# The user's buttons, from a command line

Every action a button offers has a `taro` command that calls the running daemon: the same handler
and the same checks as the button, so a refusal reads as the button's would. For scripts and the
user's own terminal.

    taro ticket accept|close-round|pause|resume|relaunch-owner <ID>
    taro ticket reopen <ID> --note <text>
    taro ticket request-changes|change-spec <ID> --text <text>
    taro decision answer <key> [--label <option>] [--text <words>]
    taro decision dismiss <key>

- `--project <name>` or `$TARO_PROJECT`; the daemon is found through `--home` or `$PASEO_HOME`
  (default `~/.paseo`). `--note -` and `--text -` read standard input. `--json` prints the daemon's answer.
- Exit codes: 0 done, 1 the action refused (its reason on stderr), 2 usage, 4 the daemon is not reachable.
- **Accept, reopen, request-changes, change-spec, close-round and the decision verbs are the user's**:
  they refuse the ticket's own owner and subagents (exit 1);
  ask the user. Never work around that (`env -u PASEO_AGENT_ID`, a raw RPC). Any other session may run them. Pause, resume and relaunch-owner run anywhere.

## The owner's mechanical steps

    taro agent start <job> <ID> --model <id> [--thinking <id>] --brief-file <file> [--task "<task>"] [--worktree]
    taro agent stop <agentId>
    taro check [--ticket <ID>] [--again] -- <command>
    taro deliver <ID> [--evidence-from-checks]
    taro daemon start|stop|list <ID>

- Starting an agent or a daemon waits while threads are above 85% (`--wait <seconds>`, then refuses).
- `taro check` logs the exit code and summary line for the ticket its branch names, warns of stray files and skips a pass at this clean commit (`--again` runs it); `taro deliver`
  is the owner's (`phases/delivery.md`). A test daemon never uses port 6767 or `~/.paseo`.

## Cards and the board, from any session

No daemon is needed (`hosts/outside-paseo.md`):

    taro card ask <ID> --file <json|->
    taro card answer <ID> <cardId> [--label <option>] [--text <words>]
    taro card withdraw <ID> <cardId>
    taro card show <ID> [<cardId>] [--wait <seconds>]
    taro board [--watch]
