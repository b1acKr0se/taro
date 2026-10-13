# Direct Paseo operations

Use installed Paseo MCP tools or CLI; discover current capabilities/help rather than inventing flags.
Paseo remains responsible for sessions and workspaces. Taro has no launcher, transport bridge or scheduler.

## Profile and project

Read configured profiles and their notes. Use the owner's profile, otherwise a suitable configured one;
discover providers/models if no profile fits. Carry over the profile's model, mode and thinking settings.
Do not hardcode a provider or silently launch with different settings.

Resolve the existing Paseo project from the connection's primaryRoot via workspace/project listings.
Create workspaces with that project ID explicitly; local-isolation paths alone can create new projects.
CLI example: paseo workspace create --isolation local --path <checkout> --project <id> --title <title> --json.
If no project matches, register the primary checkout once; if matches conflict, resolve before creation.
Use the same daemon/host throughout. Never substitute a local path when operating on a remote daemon.

For workers, fetch the configured base and create a dedicated code worktree based on the current remote
base (or configured local base for a local-only repository). Never switch/reset the primary checkout.
Register worker checkouts under the existing Paseo project with a readable workspace title.
For reviewers, create a new agent tab in the implementer's existing Paseo workspace. Pass its recorded
workspaceId explicitly to create_agent; do not call create_workspace or create another Git worktree.
The reviewer shares the worker's checkout: keep HEAD at the assigned full SHA and tracked files clean,
and pause implementation edits until review ends. Never detach, switch or reset this shared checkout.

## Launch and ownership

Prefer MCP create_agent because it exposes notifyOnFinish:
- Manager -> worker: notifyOnFinish=false, intentionally overriding routine child callbacks.
- Worker -> reviewer: workspaceId=<implementer workspaceId>, notifyOnFinish=true. Review opens in a
  new tab in that workspace and its result returns to the implementer.
- Worker -> manager blocker/ready-for-acceptance message: notifyOnFinish=false; no reply-completion loop.

Some versions/defaults enable parent callbacks automatically. If the available interface cannot disable
them, surface that limitation; don't claim the manager stays quiet. Don't use a CLI fallback with
unverified callback behavior. Use the installed Paseo skill/tool schema for exact parameter names.

Record DISPATCH-INTENT with a unique token BEFORE creation; label the new session with taro.project,
taro.ticket, taro.role, taro.dispatch and taro.revision for review. If creation times out, search labels
on the same daemon and adopt a single match before retrying. Multiple matches require resolution.
A listing error does not prove absence.

Use a two-stage launch so work cannot race its assignment:
1. Create the agent with its role, ticket, connection, skill path and an instruction to wait for assignment.
2. Record its returned session/workspace identity and code checkout in the ticket.
3. Send the actual worker/reviewer prompt with the appropriate callback setting.
Do not resend an uncertain start prompt until activity confirms it wasn't received.

Agent titles: "SH-001 · Task title"; reviewer tabs: "Review SH-001 · Task title".
The Review title belongs to the new agent tab, not a new or renamed workspace. Verify the returned
workspaceId matches the implementer's before sending the actual review prompt.
Never use internal attempt numbers as the visible name. Supply absolute skill and connection paths to
every session; provider skill discovery may differ, but agents can read the provided SKILL.md directly.

## Messages and observations

Do not poll running agents for routine status. Use reviewer callbacks and ticket records.
For owner-requested status, inspect bounded relevant activity using recorded session/daemon IDs.
Unknown context usage or cache expiry stays unknown; do not make up measurements or replace sessions
based on guesses. The task owner decides when a fresh reviewer/session is warranted.

Before messaging an idle manager, check current status. If it is busy, use only a documented safe queue
mode; otherwise record the pending alert in the ticket and tell the owner in the task tab. In versions
where sending/steering can replace a turn, don't assume an idle check eliminates the race.
Never compact, archive, stop or replace a live manager as part of ordinary reporting.

Keep native provider automatic compaction enabled. Taro does not ask the manager to monitor token usage
or trigger worker compaction. Checkpoint during work and before requested manual compaction, then reload
role/ticket afterward. Compaction is not a remedy for a hung command or failed provider connection.
For stalls and optional scheduled checks, see [recovery](recovery.md). No recurring checks are installed
by setup; explicitly enabled checks run as separate Paseo schedule sessions, not manager heartbeats.
