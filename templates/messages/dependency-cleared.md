<!-- Sent to the manager when a ticket is Done or stops holding an owner slot (TR-029). Dependents are listed for both; they can start only once the ticket is Done (TR-043). Placeholders: ticket, status, dependents, afterDone (templates/messages/after-done.md, empty unless a ticket with no parent is Done, TR-147), recount (templates/messages/recount.md). -->
{{ticket}} is now {{status}}. Tickets that depend on it: {{dependents}}; they can start only once {{ticket}} is Done.

{{afterDone}}

{{recount}}

Dispatch what the cap and the dependencies now allow, oldest first. To keep a startable ticket queued on purpose, append a HOLD record with the reason (`HOLD <time> — <reason>`); the plugin then leaves it alone until a RELEASE record.
