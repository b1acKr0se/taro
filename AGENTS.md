# Taro — developer guide

A Paseo plugin (0.11.2). This repository is also run as a Taro project, so the plugin you change
is the one supervising you: change it carefully. The tracker tickets (intent, plan, approvals,
EVIDENCE, FINAL) are the record of what was built, why and how it was verified.

## Layout and rules

- `index.server.ts` / `index.client.tsx`: wiring only. `server/` (daemon side, Node), `client/`
  (React Native; may import only `react`, `react-native`, `@tanstack/react-query`, `zod`,
  `@getpaseo/plugin*`), `shared/` (zod contracts and pure logic, no Node, no React). A code file at
  the root other than the two entries fails Paseo's compile.
- No runtime dependencies: everything is a devDependency (`server/host-imports.test.ts` guards it).
  Paseo types come from `server/host-types.ts`, never `@getpaseo/client` in reachable code.
- RPC wire names match `/^[a-z][a-z0-9._-]*$/`. Colours only from `theme.colors`, except the
  image viewer's opaque black backdrop and white controls (`VIEWER` in `client/image-view.tsx`) and
  GitHub's merged purple on a Done card's PR (`GITHUB_MERGED` in `client/github-colors.ts`).
- Client code reaches the phone's Hermes from source, without Metro: no classes (use a factory
  function returning an object), and never capture a `for…of` loop variable in a closure (use
  `.map`). `server/client-bundle.test.ts` compiles the client as Paseo does and fails on either;
  it also loads the bundle in a Hermes VM (`hermes-engine-cli`) as the phone app does and fails
  when the load throws or `contribute()` stops registering the Taro screen.
- Composer attachments on the phone (TR-036, decision 53) use Expo native modules Paseo's app ships
  for its own composer, through the undocumented `globalThis.expo.modules` (`ExponentImagePicker`,
  `ExpoClipboard`, `ExpoDocumentPicker`, `ExponentFileSystem`, and `ExpoImageManipulator` to
  shrink an image over the agent's limit, TR-037): names and functions are in
  `client/attachment-sources.ts`. Look a module up when it is used, never at module scope. If the
  phone stops offering Add image, Paste image or Upload file after a Paseo update, or refuses every
  large photo as one that "could not be made smaller", a module was renamed or reshaped there.
- The image viewer keeps its top bar below the macOS desktop app's traffic lights (TR-048) by reading
  `window.paseoDesktop`, the undocumented object Paseo's desktop shell injects (`windowChromeMode`,
  `platform`): `client/window-chrome.ts`; full screen comes from its `window.getCurrentWindow()`
  (`client/desktop-window.ts`), whose calls may answer with a promise, a plain value or nothing
  (`onResized` returns a plain unsubscribe; assuming a promise failed the plugin, TR-054), so every
  call there is feature-detected and guarded. If the ✕ sits under the window controls again after a
  Paseo update, that object was renamed or reshaped. The viewer sits in an error boundary
  (`client/error-boundary.ts`, a constructor function, as classes are out).
- Kept view state (the screen's view, drafts, the timeline cache) lives on `globalThis` slots
  (`client/kept.ts`): Paseo's app unloads every plugin when it disconnects and evaluates the bundles
  again on reconnect. Change a kept field's type and it starts over; version the slot.
- Text fields on the phone use `KeyboardScrollView` or `useRevealFocused()` (`client/keyboard.tsx`);
  a plugin cannot import `react-native-keyboard-controller`.
- After any compaction a Claude manager or owner rereads its rules through a SessionStart hook
  (matcher `compact`) the plugin merges into `.claude/settings.local.json` in its working directory
  when its session opens (`server/compact-hook.ts`; Paseo lets a plugin change only a session's env).
  The merge edits the text in place, so a user's own file keeps every other byte, and the hook prints
  `<plugin data>/reload/$PASEO_AGENT_ID.md` only while the skill folder exists, always exiting 0.
- Claude owners and subagents start trimmed (TR-139): the `before("agent.create")` hook adds
  `disallowedTools` (Paseo's MCP server and the built-in tools no role uses) for an agent carrying
  `TARO_PROJECT` outside a manager's home, and turns Paseo's agent skills and `loop` off through
  `skillOverrides` in the same settings file; the manager is untouched. The lists are in
  `shared/agent-trim.ts`, with the evidence rule for changing them. A later turn that reaches for
  one adds a TOOL-MISS note to its ticket; a start above 30k tokens adds a CONTEXT note. If a role
  needs a new tool (a skill or template tells agents to use one), check it is not on those lists.
- Images over Claude's limit (5 MB of base64, about 3.75 MB of file) are shrunk when attached
  (`client/image-shrink.ts`); Paseo's own cap is 10 attachments and 30 MB a message.
- Code adapted from FirstMate (MIT) or ported from Paseo (Apache-2.0) keeps its header comment and
  its entry in `THIRD_PARTY_NOTICES.md`. The plugin theme has no `borderAccent` or `surface3`.
- Tickets are Taro's own files on the `taro/tickets` branch: `tickets/<ID>.md`, one `key: <JSON>`
  frontmatter line per field, sections between `<!-- taro:… -->` markers. Every write goes through
  one locked path in `server/ticket-store.ts`. The `taro` command (`bin/taro`) runs `.ts` under
  Node ≥ 22.18 type stripping, so every file reachable from `server/taro-cli.ts` uses erasable
  syntax (no enums, namespaces or parameter properties), `.ts` import extensions and no npm packages.
- Agent-facing text lives in `skill/` (what agents read) and `templates/` (what the plugin writes or
  sends), never in code.
- Comments explain why, briefly. Full identifiers, no abbreviations.

## Paseo plugin API essentials

- `index.client.tsx` exports `contribute(client)`: `addScreen` (string `params`),
  `addSidebarHeaderItem`, `addWorkspacePanel`, `addTimelineTransformer` / `addTimelineRenderer`.
  A transformer's `transform({ item, phase })` is synchronous: `undefined` keeps Paseo's item,
  `{ items }` replaces it with plugin items, `[]` hides it; a plugin item cannot reuse Paseo's
  rendering, so Taro draws the message text too. `props.navigation` may be undefined on older hosts.
- Server calls are `rpc(contract, input)` against zod contracts in `shared/contracts.ts`.
- The `before("agent.session_open")` hook also runs on resume; it sees the working directory and
  title but not labels, so Taro agents are recognised by working directory. Env set there reaches
  the agent's shell.
- Each Claude agent costs about 65 of the host's 2,048 threads; read
  `/sys/fs/cgroup/pids.current` and `pids.max` before starting agents or daemons.

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
  directory. A text field with a phone keyboard open (simulated): `node tools/keyboard.cjs
  <playwright module> http://127.0.0.1:$PORT/ out "<placeholder>" [click text…]` (usage in its header).
- Onboard a scratch git repository (not this one) with cheap models (Sonnet/Haiku) for end-to-end
  runs; agents on a throwaway daemon cost real money, so keep runs short. Make the repository the
  `mktemp -d` directory itself and print its path: `R=$(mktemp -d /tmp/notes-app.XXXXXX); git -C
  "$R" init -q -b main; echo "$R"`.
- Installing writes `plugins` into that home's `config.json`; keep that key if you rewrite it.
- Stop your daemon when done: `paseo daemon stop --home $HOME_DIR` (or kill its pid), then check
  `ps -eo pid,ppid,etime,args` for leftovers (its plugin process, a `git` reparented to
  PID 1), kill them by pid, and delete the home and the scratch repository by their literal paths:
  `rm -rf -- /tmp/paseo-TR-012 /tmp/notes-app.Ab12Cd` (`skill/reference/shell.md`; a target worked
  out by a command, such as `"$(dirname $R)"`, stops you for approval).
- Every command the plugin runs goes through `server/process.ts`: its own process group, killed
  whole on a timeout or the plugin's stop. Never `spawn` elsewhere.

## Commits

Conventional Commits: `<type>: <summary>`, type one of `feat`, `fix`, `refactor`, `docs`, `test`,
`chore` (`perf` and `build` only when really needed); never `change:`. A behaviour change is `feat`
(new capability) or `fix` (wrong behaviour); restructuring is `refactor`. Keep the summary short and
imperative, with no ticket number (put it in the body if needed).

## Delivery

This project is local-only: leave a clean branch that fast-forwards from `main`. The user reloads
the real plugin after merging.
