# Follow-up change

A small change the user asks for after delivery (Request changes, or chat) stays on the same
ticket, branch and owner: no new ticket, no new plan card. Keep it light, the user is waiting.

**Small** means all of: you judge it small, the diff touches no new files and no contracts, and it
changes no stored data, money, auth or the daemon. Otherwise size it like a new task and use the
full flow.

1. **Look first, when the change is visual.** Show one side-by-side image of the changed component
   only (before and after, or the options), made by a top-tier subagent when the project allows one
   (`reference/model-tiers.md`): it suggests better styles than a cheaper model. Name it `mockup-<what>-<device>.png`. Build nothing until the user picks.
2. **Build the picked change** only. Fix a pre-existing bug only when the user asks; note it in
   FINAL as a limitation.
3. **Run only the checks the diff affects** (the touched tests, typecheck), then the full checks
   once before delivering.
4. **Screenshot only the surfaces the diff touches**: each distinct visual change once, cropped to
   the changed part, with the theme rule of `phases/delivery.md` (a drawn change shows dark and
   light). The coverage map and `ux:` line list only these.
5. **Review once, on the diff** since the delivered `review-head:`: one reviewer given only that
   range and the follow-up's screenshot paths. A second look only when the first found a High finding.
6. **Record briefly**: one EVIDENCE record for the follow-up (checks, review, `ux:` line, its
   screenshots), and a short "Follow-up change" section in the PR body (`gh pr edit`). Do not
   redraft FINAL or the first EVIDENCE: add one FINAL bullet for the follow-up. Deliver as usual.
