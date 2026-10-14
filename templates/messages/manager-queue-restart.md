<!-- Added after the opening and the restart note when the escalation ladder (TR-062) replaces a Manager that left startable tickets queued with a free slot. Placeholders: tickets, minutes, handoff, recount (templates/messages/recount.md). -->
Why you were started: {{tickets}} sat in Backlog with a free owner slot for {{minutes}} minutes after the previous Manager was told, and it did not dispatch them, so the plugin replaced it. Its last handoff, if it wrote one, is in {{handoff}} (it may be old).

{{recount}}

Recount from Paseo and the tracker yourself, then dispatch what the cap and the dependencies allow, oldest first. If a ticket is held on purpose, append a HOLD record with the reason (`HOLD <time> — <reason>`).
