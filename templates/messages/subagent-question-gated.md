<!-- Sent by the plugin when a subagent asks a blocking question without a `surprise:` field after its ticket's plan is approved (TR-263). -->
{{ticket}}'s plan is approved, so the plugin did not ask the user as you asked:
{{questions}}

After approval your owner decides questions like this, not the user. Go on with your `default` if it has one; otherwise stop. Either way, end your turn with `waiting: <the question>` and your recommendation so your owner decides it. Ask the user only when an approved criterion or an Out of scope line would change: then ask again with `surprise:` naming that line ({{skill}}/reference/formats.md).
