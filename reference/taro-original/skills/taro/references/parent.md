# Parent ticket tracking

The existing ticket owner proposes child tickets when they help and remains responsible for the whole result.
Use children for distinct deliverables with useful independent progress or acceptance criteria, not
every coding step or every agent. Small work stays one ticket with a checklist. The user does not need
to request children, and the project manager does not choose or coordinate them.

## Break down the scope

During brainstorming, include proposed deliverables, criteria, dependencies and integration checks in
the plan the user approves. Get explicit confirmation of the proposed breakdown before creating any
children; scope approval alone is not confirmation to split the ticket. Confirmation may be part of
approving a plan that explicitly includes the breakdown, with no second question needed. Then create
child tickets in the shared backlogRoot with `--parent`, using Backlog's allocated IDs.
See [ticket commands](tickets.md#parent-and-child-tickets). Keep the parent plan
as an index of the children and shared decisions. Inspect existing children before retrying an uncertain
creation so you do not duplicate them.

Record the approved scope/criteria on the parent. Each child references that approval and the part it
covers, including the breakdown confirmation. Do not ask again for an already-confirmed breakdown.
If decomposition becomes useful during execution, propose it and wait for confirmation even when the
scope is unchanged. Additional children or a materially revised breakdown also need confirmation.
New scope or changed acceptance criteria need user approval in this parent tab as well.

## Fit tracking around the execution workflow

Use the user's chosen workflow, skills, direct implementation or delegated agents. Taro does not
prescribe how many agents to create, which skills to invoke, or a one-child/one-worker/one-PR mapping.
You own Backlog updates for both parent and children. Execution agents need not read Taro or edit tickets.
Resolve their questions yourself or bring decisions to the user here; the user need not visit child tabs.
Only overall readiness or a real blocker needing external intervention reaches the project manager.

Before starting, map the workflow's steps to child IDs and identify where control/results return to you.
At those boundaries update affected tickets: before work begins, when implementation or review starts,
after meaningful results, on blockers, and before pausing or compaction. Record the actual operation,
evidence and next action using MILESTONE; use EXECUTION to link the parent owner and any relevant
workflow task/session, checkout or artifact. Do not invent separate worker assignments where none exist.
Update progress during work, not just when the entire workflow finishes.

If an execution skill runs a long sequence internally, arrange milestone returns or a supported
progress callback, or invoke it in bounded stages so you can persist updates. Routine returns go to
you, not the project manager. If none is available, record the active operation and the visibility
limit; do not claim the board reflects unseen internal progress. Skills alone cannot intercept arbitrary
workflows. Do not install a polling service to compensate.

The chosen workflow owns execution mechanics. It must still respect repository instructions, approved
scope, the execution boundary, required checks/review and owner acceptance. The worker role's direct
Paseo reviewer-launch recipe is a default, not an additional review to run on top of equivalent review
evidence from the chosen workflow. Record who reviewed which exact revision and the actual verdict.
For pull-request delivery, preserve implementation/checks → draft PR → review/fixes → ready ordering;
local-review stays local. Merging and deployment still require separate authorization.

## Keep progress and delivery truthful

Each child has its own current phase, latest milestone, blocker and next action. Keep the parent
In Progress while deliverables are underway, with a concise overall milestone and relevant child IDs.
Dependencies identify ordering; a prerequisite's status alone does not prove its code is available.
Record what is needed and verify availability before dependent implementation. A normal dependency
wait is not a hang. Use Blocked for an actual external impediment and record the required action.

Verified children move to Awaiting acceptance, not Done. Finishing the children does not prove the
feature works: verify the parent's end-to-end criteria against the combined result, recording exact
revisions, integration checks and review evidence. Each FINAL references the relevant delivered
revision(s)/PR(s) or artifacts; multiple children may share a PR. The parent FINAL lists included child
IDs and their delivered revisions, overall evidence, limitations and the next action. No empty parent
PR is needed when child PRs already contain the delivery. Move the parent to Awaiting acceptance and
notify the manager once when that whole result is ready.

The user can accept the complete feature once in this tab or the manager tab. Follow
[owner acceptance](tickets.md#owner-acceptance) for the explicitly covered delivery and children;
never infer acceptance merely from child completion. After compaction, reload the parent and relevant
child records and reconcile the workflow's actual state before resuming or dispatching more work.
