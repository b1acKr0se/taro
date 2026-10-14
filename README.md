# Taro

Taro is a [Paseo](https://github.com/getpaseo/paseo) plugin that runs software work through agents,
one project at a time. You tell a **Manager** agent what you want; it files a ticket and starts a
**task owner** agent, which takes the ticket from proposal to a delivered, reviewed change. You
answer their questions and accept the result. Tickets live in a [Backlog.md](https://github.com/MrLesk/Backlog.md)
tracker on the project's `taro/backlog` branch, and Taro shows everything in one screen inside
Paseo, on desktop and on the phone.

## Requirements

On the machine that runs the Paseo daemon:

- Paseo 0.11.2 or later, with plugins enabled (`"pluginsEnabled": true` in the daemon's `config.json`)
- the [Backlog.md](https://github.com/MrLesk/Backlog.md) CLI (`backlog`)
- `git`
- optional: the GitHub CLI `gh`, for projects that deliver through pull requests

## Install and update

    paseo plugin install github:b1acKr0se/taro
    paseo plugin update taro

Taro then appears in Paseo's sidebar.

## Getting started

1. **Add a project.** Open Taro and press New project. Pick the repository, the models the agents
   use, and how work is delivered (a pull request or a local branch). Taro sets up the tracker and
   starts the project's Manager.
2. **Talk to the Manager.** Describe what you want in plain words. The Manager files a ticket for
   each request and starts a task owner for it.
3. **Follow the ticket.** Each ticket sits in a board column:
   - **Needs you**: an agent asked you something, waits on a permission, or has finished and waits
     for your acceptance.
   - **Working**: an agent is on it.
   - **Stalled**, **Queued**, **Done**: stopped without saying why, not started yet, accepted.

   A task owner may ask questions or ask you to approve its plan; the answers are buttons on the
   card. When the work is done it moves to **Awaiting acceptance**: read the summary and evidence,
   then press **Accept** (Taro can also merge it, if the project is set to) or **Request
   changes…** with what to change.

## Screens

- **Manager**: your conversation with the project's Manager.
- **Inbox**: everything waiting on you, across all projects. Walk me through takes you through the
  open questions one at a time.
- **Board**: the project's tickets by column. A card says what the ticket needs now; opening it
  shows the task owner's conversation.
- **Stats**: time, turns, agents and cost per ticket.
- **Ticket view**: the conversation with the task owner (Chat) and the ticket itself (Ticket):
  status, acceptance criteria, milestones, delivery and evidence.
- **Attachments**: the + in a chat adds images and files to your message (on the phone: Add image,
  Paste image, Upload file).

## Settings

Project settings (the gear on a project's screen) is the same page as New project: the
repository and tracker sync, agent models, delivery (pull request or local branch; merge when
accepted or merge yourself), limits (owners running at once, when long conversations are
compacted), standing orders the Manager passes to every task owner, and starting or restarting
the Manager.

## Troubleshooting

"This plugin surface is unavailable." for a moment when an app reconnects is Paseo reloading its
plugins; Taro comes back where you were. If it stays, open Settings → Plugins in that app and copy
the error shown on Taro's row.

## License

MIT. Parts are adapted from FirstMate (MIT) and from Paseo (Apache-2.0); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSES/](LICENSES/).
