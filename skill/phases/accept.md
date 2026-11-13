# Accept

The plugin runs Accept's steps itself when the user presses Accept: it merges, records ACCEPTANCE
(or NOT-MERGED) and sets Done, and you hear nothing; it archives you after Done. Only when it stops
on something that needs judgement (a moved head, a conflict, a base branch that moved under a local
branch, an unexpected gh or git answer) does a message reach you, or a fresh owner after a long
idle: it says what the plugin found, and the ticket's ACCEPT-HANDOFF record says so too. Take it
from that step; the steps are safe to repeat. If the message says to merge, merge only what the user
reviewed.

- **Pull request**, in this order:
  1. The PR is already `MERGED` (an earlier Accept merged it, then was cut off) → go to 3.
  2. Merge only when the PR's `headRefOid` still equals the recorded review head, with the merge
     method the message names: `gh pr merge <url> --merge|--rebase|--squash --match-head-commit
     <sha>`, then confirm `state` is `MERGED`. A moved head → present it again. A conflict or a
     branch behind the base →
     merge the base branch into yours, push, rerun the quick checks, wait until `gh pr view --json
     mergeable` is not `UNKNOWN`, and merge with `--match-head-commit` set to the new head (name it
     in ACCEPTANCE); the base moves while you work, so repeat until it merges. Do this only if the
     resolution is mechanical, otherwise present again. Never end a turn with the pull request open
     and the ticket not Done: the plugin tells you each time you do, and after three the card
     returns to the user. GitHub refusing the method → never try another: record
     **NOT-MERGED** with GitHub's reason and what the user does (pick another Merge method in the
     project's settings, or allow it on GitHub), then Accept again; end with `waiting: <reason>`.
     Any other refusal → say why.
  3. Bring the base branch in the main checkout up to GitHub's: only while it is on the base
     branch and `git -C <repository path> status --porcelain` prints nothing (an untracked file
     counts), `git -C <repository path> fetch origin <base>`, then `git -C <repository path>
     merge --ff-only origin/<base>`. Dirty, on
     another branch, commits origin lacks (the fast-forward fails) or the fetch failed → do not
     touch it (no stash, checkout, reset or merge) and go on to 4: the pull request merged, so the
     ticket closes. Never leave it waiting for another Accept.
  4. Record ACCEPTANCE with the method and the local base `<old>` → `<new>` in its prose (or, when 3
     left it alone, `local <base> not updated: <reason>`), then its
     fixed field `merge: merged <merge commit>` (`reference/tickets.md`), set **Done**, and end
     with `done: merged <url>`.
- **Local branch**, in this order:
  1. Your branch head is not the recorded review head → do not merge; present the new head again.
  2. The main checkout (the repository path) has uncommitted or untracked changes, or is not on
     the base branch → do not touch it (no stash, checkout or reset): record **NOT-MERGED** with
     the reason, what the user does first, in one short line; end with `waiting: <reason>`. The card goes back to Needs you
     with Accept offered again once the user has fixed it.
  3. The base branch moved since your branch → rebase your branch onto it in your worktree. It
     applied with no conflicts at all and the checks pass → go on; name the rebased head and the
     checks in ACCEPTANCE, never as a new review-head or EVIDENCE (both read as presenting again). Any conflict, even
     one you resolved, or failing checks → the user has not seen it: present it again.
  4. `git -C <repository path> merge --ff-only <your branch>`, then confirm the base branch's head
     is your branch's. Record ACCEPTANCE (`merge: merged <old> → <new>`), set **Done**, and end
     with `done: merged into <base>`.

**Present it again** means: back to In Progress; fix it on your branch (resolve the conflict, fix
the checks); rerun the checks; record a new EVIDENCE record; `taro deliver <ID>` (new
review-head, FINAL's revision line, back to Awaiting acceptance), saying what changed
since the user accepted and why it did not merge (in a MILESTONE: NOT-MERGED is only for the
main checkout, local step 2, or a merge method GitHub refuses). Pressing Accept again would hit the same wall, so never leave such a
ticket waiting for Accept unchanged. The plugin cleans up after Done.
