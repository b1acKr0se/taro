# Starting agents with the paseo CLI

Agents start agents with the `paseo` CLI (in your environment as `$PASEO_CLI` if `paseo` is not on
PATH). It records you as the parent automatically. Never use your provider's built-in subagents.

Always pass the Taro labels and environment, and quote the prompt as one argument (write long
prompts to a file first and pass `"$(cat <file>)"`).

## A task owner (manager only)

```bash
paseo workspace create --isolation worktree --path <repoPath> --project <paseoProjectId> \
  --new-branch taro/<ticket-id-lowercase> --base origin/<baseBranch> \
  --worktree-slug <ticket-id-lowercase> --title "<ID> · <title>" --json
# → workspaceId, cwd   (no remote: --base <baseBranch>)

paseo run -d --workspace <workspaceId> --provider <ownerModel> [--thinking <id>] --mode <ownerMode> \
  --title "<ID> · <title>" \
  --label taro.project=<project> --label taro.role=owner --label taro.ticket=<ID> \
  --env BACKLOG_CWD=<tracker> --env TARO_TRACKER=<tracker> --env TARO_PROJECT=<project> --env TARO_SKILL=<skill> \
  --json "<owner brief>"
# → agentId
```

## A helper or reviewer (task owner only)

```bash
paseo run -d --workspace <your workspaceId> --provider <model> [--thinking <id>] --mode <bypass mode> \
  --title "<ID> · <role>: <task>" \
  --label taro.project=<project> --label taro.role=helper --label taro.ticket=<ID> \
  --env BACKLOG_CWD=<tracker> --env TARO_TRACKER=<tracker> --env TARO_PROJECT=<project> --env TARO_SKILL=<skill> \
  --json "<definition of done>"
```

`<task>` is what the agent is doing, in words the user understands at a glance, as a phrase starting
with a verb in -ing: `building the board columns, cards and Ticket tab`, `checking the whole branch`.
The board shows it as "Implementer building the board columns… · 26m"; never a bare "step 3" (a
step number may follow as a hint: `…, 2 of 3`).

Use `taro.role=reviewer` for reviewers. Bypass mode ids: Claude `bypassPermissions`, Codex
`full-access`. Models: `paseo provider models <provider> --json`; pick from the project's allowed
list. Parallel children only: create their own worktree first (as for an owner, branching from your
parent branch) and run them there.

The plugin delivers each helper's final message to you when its turn ends; you do not need to poll.
To look anyway: `paseo inspect <agentId> --json`, `paseo logs <agentId>`. To steer a helper:
`paseo send <agentId> "<message>"`. To end one: `paseo archive <agentId>`.
