<!-- Returned to a bypass-mode agent, as the denial of its shell permission ask, when the plugin refuses the command by a fixed rule (TR-143). The user was not asked. Placeholders: path, rule, why, skill. The line for each rule is in permission-rules.md. -->
Taro refused this command by its shell rules without asking the user (rule `{{rule}}`): it would remove {{path}}, {{why}}

Do not run the removal again in another form. If you made {{path}} by mistake, leave it and name it in your report so the user removes it. If you still need a removal, write it as {{skill}}/reference/shell.md says: literal absolute paths, scratch space from `mktemp -d`, a variable only quoted and guarded (`"${NAME:?}/sub"`).
