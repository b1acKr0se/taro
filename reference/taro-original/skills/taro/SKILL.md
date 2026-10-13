---
name: taro
description: Onboard or update a repository's Taro workflow around Backlog.md and Paseo. Use for Taro-managed tickets, project status requests, and manager-triggered Taro updates.
---

# Taro

Backlog.md owns tickets and the board. Paseo owns sessions and code worktrees.
Taro supplies this workflow and a setup script; there is no Taro runtime CLI or database.
Read this file directly from a Taro repository checkout; installing it as a skill is optional.
For first-time setup from the GitHub link, begin with the repository's START.md.

## Select your role

- **Onboard a project or start its manager:** read [onboarding](references/onboarding.md).
- **Update Taro for an existing project:** read [update](references/update.md). Reload this manager only;
  newly dispatched workers read the update and existing workers/reviewers stay untouched.
- **Manager:** read [manager](references/manager.md). Dispatch, then leave execution to the worker.
- **Task owner / implementer:** read [worker](references/worker.md). Own planning through review and completion.
- **Work with distinct deliverables:** the ticket owner proposes children for user confirmation; read
  [parent tracking](references/parent.md) to maintain them around the chosen execution workflow.
- **Independent reviewer:** read [reviewer](references/reviewer.md).
- **Investigate a stalled task or run an explicitly enabled health check:** read [recovery](references/recovery.md).

Read only your role and its linked references. Follow explicit owner instructions and repository rules.
The default execution boundary is pull-request: finish implementation/checks, push the feature branch
and open a draft PR, then review/fix and mark it ready. No extra approval is needed to open the PR.
Respect a narrower owner/project boundary.
When delivery is verified, move to Awaiting acceptance. Done requires the owner's explicit acceptance
of the delivered result; scope approval and an agent review are not owner acceptance.
Merging, deployment, archiving agents and taking over active work require separate authorization.

## Shared task location

Read the supplied connection file, normally ~/.taro/projects/<project>/project.json.
It contains the primary checkout, shared backlog checkout, base branch, and absolute Backlog executable.
The connection's instructionFile points at this file in the Taro checkout.
A dispatch must give every agent the absolute connection file and instructionFile path.
If a nondefault setup home was used, use the supplied path instead of guessing.

All ticket reads/writes use the connection's **backlogRoot**, even from another code worktree.
Run Backlog with BACKLOG_CWD explicitly set to that path. Never use a worker's local backlog copy.
MCP is optional: pin its server to the same backlogRoot and verify the project before writing.
A server that follows the current code worktree is not suitable for shared ticket writes.

For ticket commands and the concise record format, read [ticket records](references/tickets.md).
For creation or messaging, read [Paseo operations](references/paseo.md).

## Recovery

After restart or compaction, reread this role, the connection, and the current ticket.
Managers load tickets only for the owner's request. Workers recover from the latest milestone,
approved brief, and review evidence; a conversation ending is not task completion.
Native provider task/plan tools hold the detailed checklist; Backlog holds durable milestones.
Before pausing, ending a long turn, or requested compaction, save the next action and changed reasoning.
Keep checkpoints during work: native automatic compaction may happen without a chance to write one first.
These are agent obligations, not a validator that intercepts tool calls.
