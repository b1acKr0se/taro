<!-- Sent when the owner of a high ticket asked `scope-approval` and its plan, its children's definitions of done or its plan review leave a gap (shared/plan-lint.ts). Placeholders: {{ticket}}, {{gaps}} (one `- ` line each), {{skill}}. -->
Your `scope-approval` for {{ticket}} was not shown to the user: a high plan settles every child before the one approval, and this one still lacks:
{{gaps}}

Fix each in the plan (`taro ticket edit {{ticket}} --plan …`, Parts as {{skill}}/templates/plan.md says) or in the child's definition of done (`taro ticket edit <child> -d …`, {{skill}}/templates/definition-of-done.md). Once the plan is fixed, have an independent reviewer read the plan and the child specs, fix what it finds, and record its REVIEW (`REVIEW <time> — plan review by <reviewer>: …`) after the plan's last edit ({{skill}}/levels/high.md). Then ask `scope-approval` again in a later turn.
