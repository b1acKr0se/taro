<!-- Sent to the manager by the minute check (TR-062) when a ticket could start, a slot is free and the manager has been idle for two minutes; once per situation. Placeholders: tickets, recount (templates/messages/recount.md). -->
{{tickets}} could start now: an owner slot is free and you have been idle for a few minutes.

{{recount}}

Dispatch what the cap and the dependencies allow, oldest first. If you hold a ticket on purpose, append a HOLD record with the reason (`HOLD <time> — <reason>`); the plugin stops asking about it until a RELEASE record. Without a dispatch or a HOLD, the user sees an alert after ten minutes.
