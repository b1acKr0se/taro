<!-- Sent by the plugin when an owner's turn ends with commits on its branch while the round's plan is not approved (TR-263). -->
Stop building: {{ticket}}'s plan is not approved this round, and your branch {{branch}} already has {{commits}} past {{base}}. Above low, nothing is built before the user approves the plan ({{skill}}/levels/medium.md, The approval).

Ask `scope-approval` now (a blocking decision, as that page shows) and wait for the answer: build nothing more until it is Approve. If the answer changes the plan, change the commits to match. Then end your turn with a status line.
