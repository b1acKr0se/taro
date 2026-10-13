# Taro — developer guide

A Paseo plugin (0.11.2). Read `docs/spec.md` (what to build), `docs/decisions.md` (why), and
`docs/build-log.md` (what is verified) before changing behaviour. This repository is also run as a
Taro project, so the plugin you change is the one supervising you: change it carefully.

## Layout and rules

- `index.server.ts` / `index.client.tsx`: wiring only. `server/` (daemon side, Node), `client/`
  (React Native; may import only `react`, `react-native`, `@tanstack/react-query`, `zod`,
  `@getpaseo/plugin*`), `shared/` (zod contracts and pure logic, no Node, no React). A code file at
  the root other than the two entries fails Paseo's compile.
- No runtime dependencies: everything is a devDependency (`server/host-imports.test.ts` guards it).
  Paseo types come from `server/host-types.ts`, never `@getpaseo/client` in reachable code.
- RPC wire names match `/^[a-z][a-z0-9._-]*$/`. Colours only from `theme.colors`. In client code,
  never capture a `for…of` loop variable in a closure (Hermes); use `.map`.
- Agent-facing text lives in `skill/` (what agents read) and `templates/` (what the plugin writes or
  sends), never in code.
- Comments explain why, briefly. Full identifiers, no abbreviations.

## Checks

    npm install
    npm run typecheck
    npm test

Put pure logic in `shared/` or plain `.ts` files so vitest can import it (a test importing a `.tsx`
that pulls in React Native fails to parse).

## Testing against Paseo — never the real daemon

**Never** run `paseo daemon restart`, `paseo plugin reload|install|remove` or anything else against
the real daemon (`~/.paseo`, port 6767): it runs the user's agents, including you. Use a throwaway
daemon with its own home and port, unique to your ticket:

    PORT=68$((RANDOM % 90 + 10)); HOME_DIR=/tmp/paseo-$TICKET_ID
    mkdir -p $HOME_DIR
    printf '{"version":1,"daemon":{"listen":"127.0.0.1:%s"},"pluginsEnabled":true,"features":{"webUi":{"enabled":true}}}' $PORT > $HOME_DIR/config.json
    nohup paseo daemon run --home $HOME_DIR > $HOME_DIR/run.log 2>&1 &
    paseo plugin install "$PWD" --home $HOME_DIR      # your worktree
    paseo plugin reload taro --home $HOME_DIR          # after each change
    paseo plugin logs taro --home $HOME_DIR

- Drive RPCs: `TARO_DAEMON_URL=ws://127.0.0.1:$PORT/ws node tools/rpc.mjs <wire name> '<json>'`.
- Look at the UI: Paseo's web app is served at `http://127.0.0.1:$PORT/`. Screenshots:
  `node tools/shot.cjs <playwright module> http://127.0.0.1:$PORT/ out.png "Taro" [click text…]`
  (prefix a click text with `=` for an exact match), phone size: `TARO_WEB_URL=… node tools/phone.cjs
  <playwright module> out.png [click text…]`. Any installed Playwright module works;
  find one with `find / -path '*/node_modules/playwright/package.json' 2>/dev/null` and pass its
  directory.
- Onboard a scratch git repository (not this one) with cheap models (Sonnet/Haiku) for end-to-end
  runs; agents on a throwaway daemon cost real money, so keep runs short.
- Installing writes `plugins` into that home's `config.json`; keep that key if you rewrite it.
- Stop your daemon when done: `paseo daemon stop --home $HOME_DIR` (or kill its pid), and delete
  the home.

## Delivery

This project is local-only: leave a clean branch that fast-forwards from `main`. The user reloads
the real plugin after merging.
