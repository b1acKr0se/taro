<!-- Sent to the manager when a ticket with no parent becomes Done and the dependency-cleared wake-up is not due, so it still hears of every Done (TR-147). One short turn per accepted ticket. Placeholders: ticket, afterDone (templates/messages/after-done.md). -->
{{ticket}} is Done. {{afterDone}}

It gives no queued ticket a start (none depends on it, or no owner slot is free for the queue); the plugin wakes you again when one can start.
