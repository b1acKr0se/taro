# Taro — Paseo plugin

A Paseo plugin for running software work through agents, one project at a time:
you talk to a **project manager** agent, it looks into each request and files a ticket,
and a **task owner** agent owns each ticket from brainstorming to an accepted result.
Tickets live in a per-project Backlog.md tracker; the plugin gives Paseo a board,
an inbox of everything waiting on you, and the conversations with every agent.

Home: https://github.com/b1acKr0se/taro. This plugin replaces the original instruction-only
Taro; nothing from it needs to be preserved or migrated.

**Status: working plugin, in progress.** Phases 1–2 of `docs/spec.md` are built and checked
end to end on a throwaway Paseo daemon (see `docs/build-log.md`); later phases continue there.

## Install

Needs a Paseo daemon (0.11.2+) with plugins enabled (`"pluginsEnabled": true` in its
`config.json`), the [Backlog.md](https://github.com/MrLesk/Backlog.md) CLI and `git` on the
daemon's machine; the GitHub CLI `gh` is optional (pull-request delivery uses it).

    paseo plugin install github:b1acKr0se/taro
    paseo plugin update taro          # later, to update

No `npm install` or build step: Paseo compiles the plugin. To develop it, clone this repository,
run `npm install`, `npm run typecheck` and `npm test`, and follow `AGENTS.md`.

An app shows Taro as "taro" with "This plugin surface is unavailable." for a moment whenever it
reconnects to the daemon, for example when the phone app returns from the background: Paseo
unloads every plugin while disconnected and loads them again afterwards, and Taro then comes back
where you were. If the message stays, that app could not load Taro's client. Open Settings →
Plugins in the same app: Taro's row shows the error in red. Copy it into a bug report before you
do anything else, because closing the app clears it. Then close the app fully and reopen it, so it
fetches the plugin list again.

The + in Taro's chats attaches images and files. On the phone app it uses the image picker,
clipboard and document picker built into Paseo's app, which plugins reach only through an
undocumented path (`globalThis.expo.modules`), and its image manipulator to shrink a photo too
large for the agent. If a Paseo update changes them, the matching item disappears from the + menu,
or large photos are refused instead of shrunk; see `client/attachment-sources.ts`.

## Read first

| Document | What it holds |
| --- | --- |
| [docs/spec.md](docs/spec.md) | What to build: components, files, agents, tickets, hooks, RPCs, skill, build phases |
| [docs/decisions.md](docs/decisions.md) | Every decision made so far, with the reason |
| [docs/ui-design.md](docs/ui-design.md) | The chosen UI (desktop, phone, onboarding, settings) with screenshots |
| [docs/open-questions.md](docs/open-questions.md) | What was verified, what is postponed, follow-ups |
| [docs/prior-art-firstmate.md](docs/prior-art-firstmate.md) | Analysis of the FirstMate Paseo plugin: what we take and what we don't |
| [docs/paseo-plugin-api.md](docs/paseo-plugin-api.md) | The Paseo 0.11 plugin surfaces this design relies on |

## Layout

    index.server.ts, index.client.tsx   plugin entries
    server/      daemon side: onboarding, tracker, manager, supervision, board, actions
    client/      the Taro screen (React Native)
    shared/      RPC contracts and pure logic shared by both halves
    skill/       what agents read: roles, formats, ticket and paseo commands, templates
    templates/   files and messages the plugin writes or sends
    docs/        design documents
    mockup/      clickable HTML mockup (index.html = chosen v1, phone.html = phone frame)
    images/      screenshots of the mockup and of the built plugin
    examples/    code sketches for the plugin (not wired up, not tested)
    reference/   FirstMate's charter/README, Paseo plugin types

## Run the mockup

    python3 -m http.server 8765 --directory mockup
    # open http://localhost:8765/ (desktop) or /phone.html (phone frame)

A narrow window (< 700px) renders the phone layout. Regenerate screenshots with
`node mockup/screenshot.cjs <path-to-playwright-module>` while the server runs.
