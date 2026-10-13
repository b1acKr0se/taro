---
name: taro-update
description: Update an existing Taro project's instruction checkout, dependencies and board configuration, then reload the manager's workflow for newly created workers. Use when the owner asks the project manager to update Taro. Existing workers and reviewers are not contacted or reconfigured.
---

# Update Taro

Use the manager's supplied project.json connection. If invoked outside its session, resolve the
connection for the requested project; ask for the project only when it cannot be inferred.
Read JSON as data, never as shell code. Its instructionFile identifies the authoritative Taro skill.

Read references/update.md beside that instructionFile and carry out its procedure. In a repository
checkout this is [the update procedure](../taro/references/update.md); use the connection's path when
this skill was copied elsewhere. No skill installation is required to read it directly.

This updates the local instruction source and existing project setup, not application code or the
Paseo daemon. If you are the manager, reload your own role in this session. If another agent performs
the update, provide the short reload instruction for the manager instead of messaging it unasked.

Leave all existing workers and reviewers alone: do not list, message, restart, compact, move or archive
them. Newly dispatched workers read the updated files. Do not create tasks, dispatch agents, change
execution permissions, or enable schedules as part of an update.
