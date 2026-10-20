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
  --env TARO_TRACKER=<tracker> --env TARO_PROJECT=<project> --env TARO_SKILL=<skill> \
  --json "<owner brief>"
# → agentId
```

## A subagent (task owner only)

```bash
paseo run -d --workspace <your workspaceId> --provider <model> [--thinking <id>] --mode <bypass mode> \
  --title "<ID> · <job>: <task>" \
  --label taro.project=<project> --label taro.role=<job> --label taro.ticket=<ID> \
  --env TARO_TRACKER=<tracker> --env TARO_PROJECT=<project> --env TARO_SKILL=<skill> \
  --json "<brief: an implementer's is its definition of done>"
```

`<ID>` is the ticket the subagent works on: a child's id for work on a child ticket, so its card
shows the subagent and its state. `<job>` is what the subagent does: `implementer`, `reviewer` or `researcher`. Name it by that job in
its title and brief too, never "helper". `<task>` is what it is doing, in words the user understands
at a glance, as a phrase starting with a verb in -ing: `building the board columns, cards and Ticket
tab`, `checking the whole branch`. The board shows it as "Implementer building the board columns… ·
26m"; never a bare "step 3" (a step number may follow as a hint: `…, 2 of 3`).

Bypass mode ids: Claude `bypassPermissions`, Codex `full-access`. Models: `paseo provider models
<provider> --json`; pick from the project's allowed list.

**Parallel children only** (`roles/owner.md`, Children): commit what they build on first (the
skeleton child), then give each child its own worktree, branching from your branch, and start its
implementer in that workspace (`--workspace <its workspaceId>`):

```bash
paseo workspace create --isolation worktree --path <repoPath> --project <paseoProjectId> \
  --new-branch taro/<child-id-lowercase> --base taro/<your-id-lowercase> \
  --worktree-slug <child-id-lowercase> --title "<child ID> · <title>" --json
```

When its report is verified, merge its branch into yours from your worktree (`git -C <your
worktree> merge taro/<child-id-lowercase>`), then run the seam check.

The plugin delivers each subagent's final message to you when its turn ends; you do not need to poll.
To look anyway: `paseo inspect <agentId> --json`, `paseo logs <agentId>`. To steer a subagent:
`paseo send <agentId> "<message>"`. To end one: `paseo archive <agentId>`.
