<!-- Sent to the manager when a ticket with no parent becomes Done and the dependency-cleared wake-up is not due, so it still hears of every Done (TR-147). One short turn per accepted ticket. Placeholders: ticket, afterDone (templates/messages/after-done.md). -->
{{ticket}} is Done. {{afterDone}}

This Done clears no dependents and frees no new owner slot, so it starts nothing new; the plugin wakes you when a ticket can start.
