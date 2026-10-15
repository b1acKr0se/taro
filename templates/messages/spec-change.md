<!-- Sent to the manager, as the user's words, when the user presses Change spec… on a Queued ticket with no owner (TR-129). Placeholders: ticket, title, text. -->
Spec change for queued {{ticket}} ({{title}}): {{text}}

Rewrite {{ticket}}'s Description to the scope as it now stands, in the brief's shape (`taro ticket edit {{ticket}} -d … --revision …`); the plugin has recorded my words as a SCOPE-CHANGE record. If the ticket has an owner by now, send my words to the owner instead.
