/**
 * Two tickets for the Ticket tab's pure functions (TR-061): a long delivered one in the older
 * free-form shape (a real ticket's text, names made neutral), and the same ticket in the short
 * template formats. Imported by tests only.
 */
import type { TicketFacts } from "./ticket-summary";

export const LEGACY_DESCRIPTION = `## Intent (the user's words)

User feedback on New project: adding a project isn't quick today (fill in name, repository path, base branch and so on). The user should be able to pick from projects the host already knows, with manual entry as the last resort.

"- Find out what the host exposes. The daemon serves a \`project.list.request\` (seen in the daemon log from the apps), the CLI may have project commands (host project ls?), and check the plugin SDK (server API or RPC) for listing projects and workspaces with their repository paths, default branches and remotes.
- New project opens with a searchable list of the host's projects not yet in the plugin (name, repository path, remote), each one tap to pick. Picking pre-fills name, repository, base branch (the repo's default branch), ticket prefix (derived from the name, editable) and remote sync where a remote exists, with sensible defaults for the rest (models from the last project or the defaults, delivery as before). The user can create with one more tap, or adjust first. "Add manually" stays as a small link at the bottom.
- Projects already onboarded show as such (or hidden), and the picker updates when the host's projects change.
- Present 2-3 mockups (phone and desktop) as a decision, with a recommendation; the user picks. Then build, with before and after screenshots."

## Manager notes

- Related: NA-019 (Done) revamped project settings and add-project pages; NA-002 (Done) model pickers. Likely areas: /home/user/project/client/project-setup.tsx, client/settings-form.tsx, server/ onboarding and its RPCs in shared/contracts.ts.
- Keep mockups outside the repository; commit no image files.
- Queued at filing: 3 of 3 owners (NA-051, NA-054, NA-055). NA-053 (exclusive history rewrite) is also queued.
- Kind: change, design first.`;

export const LEGACY_PLAN = `Design first (decision new-project-design), then:
1. shared/project-candidates.ts (pure): suggested name (slug of the host's name), ticket prefix (several words: initials; one word: first letter + next consonant, e.g. shop→SH), short remote text (github.com/acme/shop), and the prefilled draft. Tests.
2. server/host-projects.ts + RPC notes.host-projects.list: the host's git projects whose root still exists, each with origin URL, default branch and the project it already is. Tests with temporary git repositories.
3. client: New project opens the picker (search, list, "Already added" greyed, "Add manually" link), refreshed every 5 s while open.
4. Checks: npm run typecheck, npm test; before/after screenshots desktop + phone on a throwaway daemon with scratch repos; one independent review round.`;

export const LEGACY_NOTES = `DISPATCH-INTENT 2026-10-14T08:08:37Z token tok-na056-1, intended branch work/na-056. Queued: at the cap, 3 of 3 (NA-051, NA-054, NA-055).

2026-10-14T08:09:10Z Wake-up for NA-050 Done said 2 of 3; recount: 3 of 3. Still queued.

EXECUTION 2026-10-14T08:10:48Z: owner agent 00000000-0000-0000-0000-000000000001, workspace wks_0000000000000001, worktree /home/user/worktrees/na-056, branch work/na-056 (from main 98d3dbb), host devbox.

MILESTONE 2026-10-14T08:15Z — Oriented. The host exposes projects.list() / projects.subscribe() to plugin servers (projectId, display name, root path, kind git|non_git|directory); remote and default branch come from git. The CLI has project ls --json (same fields). The plugin client cannot list projects, so a server RPC with polling. Before screenshots and mockups (A list then review page, B inline expand, C picker on top of today's form) in the evidence folder. Proposal (plan, criteria) written; complexity medium (new RPC contract). Next: design decision.

ANSWER 2026-10-14T08:18:56.561Z — new-project-design: "Which design should New project use?" → A, list then review (the user, from the screen)

APPROVAL 2026-10-14T08:19Z — user picked option A (decision new-project-design). Approved: the plan and criteria in the ticket with these refinements.
MILESTONE 2026-10-14T08:19Z — starting build from 98d3dbb.

MILESTONE 2026-10-14T08:35Z — Built option A, commit 6cdd38a. Checks: npm run typecheck exit 0; npm test 73 files, 879 passed. Next: one independent review round.

EXECUTION 2026-10-14T08:35Z — reviewer 00000000-0000-0000-0000-000000000002, job: reviewing main..work/na-056 at 6cdd38a.

REVIEW 2026-10-14T08:41Z — reviewer, revision 6cdd38a, verdict changes needed. 1 blocker, 2 should-fix, 1 smell, 1 nit; all fixed.

EVIDENCE 2026-10-14T08:41Z — before FINAL
check: npm run typecheck — exit 0
check: npm test — 78 files, 938 passed
check: throwaway daemon with scratch repos — every flow
review: one independent round — 1 blocker, 2 should-fix; all fixed
screenshot: before-desktop.png — Add a project before, desktop
screenshot: after-list-desktop.png — New project now

EXECUTION 2026-10-14T08:41Z — review-head: 6c5464bf6ce9bc71fdb40b5f93badd137170ec42 (local-only delivery).

ACCEPTED 2026-10-14T08:42:38.386Z — the user accepted; merging: into main

ACCEPTANCE 2026-10-14T08:42Z — user's words: "I accept NA-056." Accepted revision 6c5464b. Merge: main 1c45fbe → 6c5464b, clean checkout.`;

export const LEGACY_FINAL = `FINAL — New project picks from the host's projects (option A, as tuned by the user).
Delivered: New project opens a searchable list of the host's git projects (most recently used first; name, path, remote; search focused on desktop), those already added greyed at the bottom and opening the project when tapped, Add manually as a small link, and an empty state with Add manually as the main action. The list re-reads the host every 5 s while open.
Revision: 6c5464bf6ce9bc71fdb40b5f93badd137170ec42 on work/na-056 (local-only; fast-forwards from main). New RPCs notes.host-projects.list and notes.project.onboard.check.
Evidence: criteria 1-5 by the screenshots and checks in the EVIDENCE record; npm run typecheck exit 0, npm test 78 files 938 passed.
Review: one independent round: 1 blocker (first project skipped progress), 2 should-fix, 1 smell, 1 nit, all fixed and retested.
Limitations: the list is polled (5 s), not pushed; a late tracker failure is shown above Create rather than beside a field.`;

export const LEGACY: TicketFacts = {
  title: "New project: pick from the host's known projects, pre-filled; manual entry last (pick a design)",
  status: "Done",
  description: LEGACY_DESCRIPTION,
  plan: LEGACY_PLAN,
  acceptanceCriteria: [{ checked: true }, { checked: true }, { checked: true }, { checked: true }, { checked: true }],
  notes: LEGACY_NOTES,
  finalSummary: LEGACY_FINAL,
  children: [],
  evidence: { checks: [{}, {}, {}], screenshots: [{}, {}] },
};

export const SHORT_PLAN = `## Goal
Add a project by picking one the host already knows, pre-filled; manual entry last.

## Choices I made
- A list, then a short review page — the user picked option A.
- Recently used first — the projects you work on are at the top.
- Projects already added are greyed and open the project — no dead rows.
- The list is polled every 5 s — the client cannot subscribe.

## What you'll see
- New project opens a searchable list of the host's projects.

## Out of scope
- Changing existing project settings.

## How I'll prove it
- Screenshots of the list and review page, phone and desktop.

## Size
Medium: one independent review; about 1 hour.`;

export const SHORT_FINAL = `FINAL 2026-10-14T08:41Z — new project picker

## What changed
- New project lists the host's git projects; picking one pre-fills the form and Create is one more tap.
- Most recently used first, search focused on desktop.
- Create checks first and shows problems under their field.
- The list re-reads the host every 5 s.
- New calls \`notes.host-projects.list\` and \`notes.project.onboard.check\`.

## How it was verified
- \`npm run typecheck\` exit 0; \`npm test\` 78 files, 938 passed.
- Throwaway daemon with scratch repos: every flow on desktop and phone.
- One review: 1 blocker, 2 should-fix; all fixed.

## Limitations
- The list is polled every 5 s, not pushed.
- A late tracker failure shows above Create, not beside a field.

Revision: 6c5464bf6ce9bc71fdb40b5f93badd137170ec42 · PR: none (local-only)`;

export const SHORT_DESCRIPTION = `## User's intent

Adding a project isn't quick today. Let me pick from projects the host already knows, with manual entry as the last resort.

## Manager's notes

- Outcomes: I pick a project and press Create.
- Related: NA-019 (Done).
- Likely areas: client/project-setup.tsx.
- Kind: change, design first.`;

export const SHORT: TicketFacts = {
  ...LEGACY,
  description: SHORT_DESCRIPTION,
  plan: SHORT_PLAN,
  acceptanceCriteria: [],
  finalSummary: SHORT_FINAL,
};
