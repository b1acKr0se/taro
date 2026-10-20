<!-- Sent by the plugin when an owner's turn ends with commits on its branch and no plan on its ticket (TR-206). -->
Stop building: {{ticket}} has no plan, and your branch {{branch}} already has {{commits}} past {{base}}. Every ticket writes its plan before code, trivial included ({{skill}}/roles/owner.md, step 3).

Write the plan now (`taro ticket edit {{ticket}} --plan …`, following {{skill}}/templates/plan.md) and bring the ticket's records up to date. Above trivial, ask `scope-approval` and wait for the answer before building on; if the user's answer changes the plan, change the commits to match. If a `taro` command fails, follow {{skill}}/reference/tickets.md, When a command fails: never go on without the ticket. Then end your turn with a status line.
