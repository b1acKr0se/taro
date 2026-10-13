---
name: taro
description: Taro's workflow for Paseo agents — a manager per project files Backlog.md tickets, a task owner owns each ticket from proposal to accepted delivery, subagents (implementers, reviewers, researchers) work to an explicit definition of done.
---

# Taro

Taro runs software work through agents inside **Paseo**, one project at a time:

- the **manager** triages the user's requests, files tickets and starts task owners;
- a **task owner** owns one ticket from proposal to the user's acceptance, and talks to the user directly;
- **subagents**, which an owner launches and names by their job: **implementers** build parts of a
  ticket, **reviewers** review it, **researchers** find things out; each works to an explicit brief.

The **Taro plugin** watches every agent: it reads your status line and decision blocks, shows them
to the user as cards, nudges stalled agents, delivers subagents' reports to their owner, and commits
the tracker. Write for it exactly as `reference/formats.md` says.

## Read your role

- Manager: `roles/manager.md`
- Task owner: `roles/owner.md`
- Implementer: `roles/implementer.md`
- Reviewer: `roles/reviewer.md`
- Researcher: `roles/researcher.md`

Read only your role and the references it names.

## Rules for every role

1. **End every turn with a status line** — the last line of your last message — and ask the user
   things only with a decision block. Both formats: `reference/formats.md`.
2. **Tickets live in the tracker**, a Backlog.md project on the `taro/backlog` branch. Use the
   Backlog CLI with `BACKLOG_CWD` set to the tracker path you were given (it is also in your
   environment). Never edit task files by hand, never commit the tracker (the plugin does), never
   use a `backlog/` folder inside a code worktree. Commands: `reference/tickets.md`.
3. **A conversation is never the only copy.** Scope, approvals (the user's exact words), decisions,
   milestones and handoffs go into the ticket as you make them. Your context may be compacted at any
   time; after that, reread your role and the ticket before continuing.
4. **Agents are Paseo agents**, started with the `paseo` CLI (`reference/paseo.md`), never your
   provider's built-in subagents.
5. **Use absolute paths** in everything you write for another agent.
6. **Never** push to the base branch, merge without the user's acceptance, deploy, or delete work
   that has not landed.
