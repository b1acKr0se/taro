# Taro — Paseo plugin

A Paseo plugin for running software work through agents, one project at a time:
you talk to a **project manager** agent, it looks into each request and files a ticket,
and a **task owner** agent owns each ticket from brainstorming to an accepted result.
Tickets live in a per-project Backlog.md tracker; the plugin gives Paseo a board,
an inbox of everything waiting on you, and the conversations with every agent.

This repository replaces the original instruction-only Taro
(`github.com/b1acKr0se/taro`, kept for reference in `reference/taro-original/`).
Nothing from it needs to be preserved or migrated.

**Status: working plugin, in progress.** Phases 1–2 of `docs/spec.md` are built and checked
end to end on a throwaway Paseo daemon (see `docs/build-log.md`); later phases continue there.

Install on a Paseo daemon (0.11.2+) with plugins enabled: `npm install`, then
`paseo plugin install "$PWD"`. Develop with `npm run typecheck`, `npm test`, and
`paseo plugin reload taro`.

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
    images/      screenshots of the mockup, plus FirstMate's phone UI for reference
    examples/    code sketches for the plugin (not wired up, not tested)
    reference/   original Taro instructions, FirstMate's charter/README, Paseo plugin types

## Run the mockup

    python3 -m http.server 8765 --directory mockup
    # open http://localhost:8765/ (desktop) or /phone.html (phone frame)

A narrow window (< 700px) renders the phone layout. Regenerate screenshots with
`node mockup/screenshot.cjs <path-to-playwright-module>` while the server runs.
