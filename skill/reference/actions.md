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
  they refuse inside an agent session (`$PASEO_AGENT_ID` set; exit 1, like any refusal). Never work around that; an
  agent asks the user. Pause, resume and relaunch-owner run anywhere.
