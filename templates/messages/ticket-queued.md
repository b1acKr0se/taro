<!-- Sent to the manager when a new ticket lands in Backlog while a slot is free and the manager is idle (TR-062). Placeholders: tickets, recount (templates/messages/recount.md). -->
{{tickets}} landed in Backlog while an owner slot is free, and nothing has started it.

{{recount}}

Dispatch what the cap and the dependencies allow, oldest first. To keep a ticket queued on purpose, append a HOLD record with the reason (`HOLD <time> — <reason>`); the plugin then leaves it alone until a RELEASE record.
