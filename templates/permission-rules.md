<!-- Why the plugin refuses each removal rule in shared/permission-triage.ts (TR-143), one `- <rule>: <text>` line each, filled into messages/permission-denied.md as {{why}}. Every rule needs a line. -->
- root: the whole filesystem.
- home: the user's home folder or a folder directly in it, which holds their own work.
- working-directory: the folder you work in or one that contains it; worktrees are removed by the plugin or the user, never by an agent.
- system: a system folder.
- top-level: a folder directly under `/`. Such a folder is usually made by a path built from an empty variable.
- unguarded-variable: had a variable in it been empty or unset, since the variable is not guarded.
