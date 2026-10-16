---
name: taro
description: Taro's workflow for Paseo agents — a manager per project files tickets, a task owner owns each ticket from proposal to accepted delivery, subagents (implementers, reviewers, researchers) work to an explicit definition of done.
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

Read only your role, the references it names, and `reference/shell.md` before your first command:
every role runs commands with nobody there to approve them, cleanup included.

## Rules for every role

1. **End every turn with a status line** — the last line of your last message — and ask the user
   things only with a decision block. Both formats: `reference/formats.md`.
2. **Tickets live in the tracker**, a folder of ticket files on the `taro/tickets` branch. Use the
   `taro ticket` command (its tracker path is `$TARO_TRACKER`, also in your brief). Never edit
   ticket files by hand, never commit the tracker (the plugin does), never keep tickets inside a
   code worktree. Commands: `reference/tickets.md`.
3. **A conversation is never the only copy.** Scope, approvals (the user's exact words), decisions,
   milestones and handoffs go into the ticket as you make them. Your context may be compacted at any
   time; after that, reread your role and the ticket before continuing. Every record's time is
   the output of `date -u +%Y-%m-%dT%H:%MZ` run as you write it: never typed, estimated or
   converted by hand (`taro ticket` refuses a time later than the host clock).
4. **Agents are Paseo agents**, started with the `paseo` CLI (`reference/paseo.md`), never your
   provider's built-in subagents.
5. **Use absolute paths** in everything you write for another agent.
6. **Never** push to the base branch, merge without the user's acceptance, deploy, or delete work
   that has not landed.
7. **Write shell commands that need no approval**, as nobody may be there to give it: remove only
   literal or guarded absolute paths, make scratch space with `mktemp -d`, and try ticket commands
   only on a scratch tracker (`--tracker <mktemp dir>`). Details: `reference/shell.md`.
8. **Write as if the repository were public**: it may be published. No real names, paths, hosts or
   emails from this machine in code, tests, fixtures or docs; use neutral examples (`notes-app`,
   `/home/user/project`, `alex@example.com`).
9. **Answer every message that arrives while you work** (TR-168). The user, or a subagent's owner,
   may write mid-turn: it reaches you as a new message in the middle of your work, easy to miss.
   Answer it in that turn, starting with a quote of their words (`> …`) so they see what you answer:
   at once when it is short, or "noted, I'll answer after <step>" and then the answer before the turn
   ends. A message that changes the plan or scope is handled as such (an owner asks for approval
   again). Subagents answer in their report. For owners and the manager the plugin checks the quote:
   a message nothing after it quotes comes back to you as a reminder when the turn ends.
