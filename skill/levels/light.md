# Trivial and low tickets

No approval card and no independent review: you build, review yourself and deliver. Ask at most
the one question whose answer changes the code, before you build.

1. **Build at once**: set In Progress, save a MILESTONE, and write the code following the
   repository's conventions, committing as you go. A bug is reproduced first, end to end (separate
   the trigger from the symptom; compare with a path that works); the reproduction becomes the
   regression test and must fail before the fix.
2. **Write the plan** before you deliver, with `taro ticket edit <ID> --plan` following
   `templates/plan.md`: what you did and why, one line per section (trivial) or one or two (low),
   your question's answer included; a low bug's plan gives the cause, the fix and the alternatives.
   The Accept card shows it.
3. **Review yourself**: reread the whole diff against the ticket's words; check every changed
   behaviour has a test that would fail if it regressed (empty, zero, maximum, ordering); run the full
   checks; fix what you find. A visible change also gets the screenshots and the user's-eyes pass of
   `phases/delivery.md`. Record it:
   `REVIEW <time> — self-review of <base>..<branch>: <what you checked, what you fixed> — verdict: clean`.
4. The clean verdict brings `phases/delivery.md`, filled with what the delivery still lacks; follow it.

If the work turns out bigger than its label (a second subsystem, a choice the user would want to
make, contracts, money, auth or stored data), raise the label (`taro ticket edit <ID>
--remove-label complexity-low --add-label complexity-<new>`), stop building and end the turn: the
plugin sends that level's page, and above low the plan's approval comes before more code.
