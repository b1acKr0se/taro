<p align="center"><img src="assets/taro-logo.svg" width="180" alt="Taro"></p>

<h1 align="center">Taro</h1>

Taro is a [Paseo](https://github.com/getpaseo/paseo) plugin that runs software work through agents.
Each project gets its own manager, ticket tracker and board. You tell a **manager** agent what you want; it files a ticket and starts a
**task owner** agent, which takes the ticket from proposal to a delivered, reviewed change. You
answer their questions and accept the result. Tickets are Taro's own
files, kept in a tracker on the project's `taro/tickets` branch and read and written with the `taro`
command.

<p align="center">
  <img src="assets/screenshots/board.png" width="100%" alt="Taro's board beside a task owner's chat"><br>
  <em>The board beside a task owner's chat.</em>
</p>

<p align="center">
  <img src="assets/screenshots/ticket-view.png" width="100%" alt="A task owner's chat with its subagents beside the ticket's summary and evidence"><br>
  <em>An owner's chat with its subagents, beside the ticket's summary and evidence.</em>
</p>

<p align="center">
  <img src="assets/screenshots/walk-me-through.png" width="100%" alt="The Inbox stepping through an open decision"><br>
  <em>Walk me through: the Inbox stepping through an open decision.</em>
</p>

## Why should you use Taro?

- **It works on desktop and on your phone.** The manager chat, Inbox, Board, Stats and ticket view
  are the same screens in Paseo's desktop and mobile apps, so you can answer a question or accept a
  change wherever you are.
- **One place for tickets and agents.** You describe the work to the manager in plain words and talk
  to each task owner in its ticket. Questions arrive as cards with options and a recommendation, and
  you answer with a button. Inbox gathers them across projects.
- **You see progress at a glance.** The Board sorts tickets into **Needs you**, **Working**,
  **Stalled**, **Queued** and **Done**, and each card says what the ticket needs now. Stats shows
  time, turns, agents and cost per ticket.
- **Every ticket has the same layout.** A plan with its goal, choices and how it will be proved,
  then milestones, delivery, evidence and a short summary, so you know where to look in the
  ticket view.
- **Work goes on while you are away.** Taro nudges stalled agents, restarts crashed ones and
  compacts long conversations (see Unattended work and cost, below).

## Requirements

On the machine that runs the Paseo daemon:

- Paseo 0.11.2 or later, with plugins enabled (`"pluginsEnabled": true` in the daemon's `config.json`)
- Node.js 22.18 or later (the `taro` command runs TypeScript directly)
- `git`
- optional: the GitHub CLI `gh`, logged in with `gh auth login`, for projects that deliver through pull
  requests; until it is, Taro offers only local-branch delivery

## Install and update

    paseo plugin install github:b1acKr0se/taro
    paseo plugin update taro

Taro then appears in Paseo's sidebar.

## Getting started

1. **Add a project.** Open Taro and press New project. Pick the repository, the models the agents
   use, and how work is delivered (a pull request or a local branch). Taro sets up the tracker and
   starts the project's manager.
2. **Talk to the manager.** Describe what you want in plain words. The manager files a ticket for
   each request and starts a task owner for it.
3. **Follow the ticket.** Each ticket sits in a board column:
   - **Needs you**: an agent asked you something, waits on a permission, or has finished and waits
     for your acceptance.
   - **Working**: an agent is on it.
   - **Stalled**, **Queued**, **Done**: stopped without saying why, not started yet, accepted.

## How the work flows

- **The manager triages each request.** It asks you only when it cannot tell what you mean, files
  a ticket that keeps your words as its intent, and starts a task owner in the ticket's own
  worktree and branch. Owners run up to the project's cap; the rest wait in the queue, and a
  ticket that depends on another waits for it.
- **The task owner scales its work to the ticket** (trivial, low, medium or high complexity). It
  reads the code, proposes a plan and acceptance criteria, and asks you to approve only when it
  made a choice you did not. Then it builds, starting subagents when the ticket needs them
  (implementers, reviewers, researchers, each on a model matched to the task's difficulty from the
  models allowed in the project's settings), and gets the work reviewed: a self-review for small
  tickets, an independent reviewer for larger ones.
- **It records evidence and delivers.** The checks it ran, the review's outcome and screenshots go
  into the ticket; the change arrives as a pull request or a local branch, as the project is set.
  The ticket moves to **Awaiting acceptance**.
- **You accept or request changes.** Read the summary and evidence, then press **Accept** (Taro
  can also merge it, if the project is set to) or **Request changes…** with what to change, which
  sends the ticket back to its owner.
- **Questions arrive as decision cards**, with options and a recommendation; you answer with a
  button. Inbox gathers them across projects.

## Unattended work and cost

Agents keep working while you are away; Taro watches them so work does not sit still and tokens are
not wasted.

- **Every turn is read.** When an agent's turn ends, Taro reads its status line and questions and
  updates its card.
- **Stalls get a nudge.** A task owner that stops without saying it is done, waiting or blocked
  gets one nudge; if it stops again, its card turns **Stalled** for you to nudge or relaunch
  (Compact is in the ticket view).
- **Crashes are recovered.** An agent whose process dies is restarted with its conversation intact;
  when that fails, a task owner or the manager is started afresh. After two recoveries within an
  hour Taro stops and leaves the card **Stalled**.
- **Long conversations are compacted.** A task owner whose conversation passes the compaction
  threshold is compacted after its turn, and an owner or manager left idle with a large
  conversation is compacted just before the provider's one-hour prompt cache expires. Both
  thresholds are in the project's settings.
- **Finished agents are archived** when their ticket is Done.
- **Starting agents is limited.** No more task owners run than the project's cap, and new owners
  and crash recoveries wait while the host is above 85% of its thread limit. A ticket in **Awaiting
  acceptance** no longer counts towards the cap, so the next queued ticket can start.

## Settings

Project settings (the gear on a project's screen) is the same page as New project: the
repository and tracker sync, agent models, delivery (pull request or local branch; merge when
accepted or merge yourself), limits (owners running at once, when long conversations are
compacted), standing orders the manager passes to every task owner, and starting or restarting
the manager.

## License

MIT, see [LICENSE](LICENSE). Parts are adapted from FirstMate (MIT) and from Paseo (Apache-2.0);
their notices and licence texts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
