<!-- Sent to the manager when an owner of a ticket still holding a slot is archived (a park, an Archive) and a queued ticket can start (TR-245). The ticket's status does not change, so no other wake-up comes. Placeholders: ticket, status, recount (templates/messages/recount.md). -->
{{ticket}}'s owner was archived while the ticket is still {{status}} (parked or archived), so its owner slot is free.

{{recount}}

Dispatch what the cap and the dependencies now allow, oldest first. To keep a startable ticket queued on purpose, append a HOLD record with the reason (`HOLD <time> — <reason>`); the plugin then leaves it alone until a RELEASE record.
