/**
 * Every place the user types a reply draws Taro's one reply box (TR-083), the chat composer's look: only
 * the reply box itself and the settings form (fields with nothing to send) draw a text field directly.
 * The send button sits inside the box in the chats; a card keeps its buttons under the box.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientFiles = readdirSync(join(root, "client"))
  .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
  .map((name) => ({ name: `client/${name}`, source: readFileSync(join(root, "client", name), "utf8") }));

describe("reply box sources", () => {
  it("draws a text field only in the reply box and the settings form", () => {
    const fields = clientFiles.filter((file) => file.name !== "client/focus.tsx" && /<TextInput\b/.test(file.source)).map((file) => file.name);
    expect(fields.sort()).toEqual(["client/reply-box.tsx", "client/settings-form.tsx"]);
  });

  it("answers in the reply box wherever the user types a reply", () => {
    const users = clientFiles.filter((file) => /<ReplyBox\b/.test(file.source)).map((file) => file.name);
    expect(users.sort()).toEqual(["client/agent-chat.tsx", "client/change-box.tsx", "client/decision-card.tsx", "client/permission-card.tsx"]);
  });

  it("offers the chat's stop button and Escape only while the agent works, through the reply box (TR-181)", () => {
    const chat = clientFiles.find((file) => file.name === "client/agent-chat.tsx")?.source ?? "";
    expect(chat).toMatch(/stop=\{working \? \{ onStop: stopAgent, busy: stoppingAgent === agent\.id \} : undefined\}/);
    const box = clientFiles.find((file) => file.name === "client/reply-box.tsx")?.source ?? "";
    expect(box).toMatch(/isStopKey\(event\.nativeEvent\)/);
    expect(box).toMatch(/primaryAction\(/);
  });

  it("asks for changes alike on the acceptance and plan cards and Change spec…: one change box behind Request changes… (TR-112, TR-129)", () => {
    const users = clientFiles.filter((file) => /<ChangeBox\b/.test(file.source)).map((file) => file.name);
    expect(users.sort()).toEqual(["client/acceptance-card.tsx", "client/plan-card.tsx", "client/spec-change-box.tsx"]);
    const plan = clientFiles.find((file) => file.name === "client/plan-card.tsx")?.source ?? "";
    expect(plan).toMatch(/label="Request changes…"/);
  });

  it("reveals a change box's buttons with it on a phone, though the box focuses itself as it mounts (TR-129)", () => {
    // autoFocus runs before the wrapper's ref is set: a companion read at focus time was null, and the
    // buttons stayed under the keyboard. The reveal reads it when it runs.
    const keyboard = clientFiles.find((file) => file.name === "client/keyboard.tsx")?.source ?? "";
    expect(keyboard).toMatch(/claim\(\(\) => \(companion\?\.current \?\? null\)/);
    expect(keyboard).toMatch(/revealedWith\.current\?\.\(\)/);
    expect(clientFiles.find((file) => file.name === "client/change-box.tsx")?.source).toMatch(/\bautoFocus\b/);
  });

  it("puts the send button inside the box only in the chats; cards send with their buttons under it", () => {
    // Each element runs from "<ReplyBox" to its own closing line, a lone "/>".
    const elements = (source: string) => source.split("<ReplyBox").slice(1).map((rest) => rest.split(/\n\s*\/>\n/)[0] ?? "");
    const inside = clientFiles.filter((file) => elements(file.source).some((element) => /\bonSend=/.test(element))).map((file) => file.name);
    expect(inside).toEqual(["client/agent-chat.tsx"]);
  });

  it("greys the box of a card with options until Other is picked", () => {
    for (const name of ["client/decision-card.tsx", "client/permission-card.tsx"]) {
      const source = clientFiles.find((file) => file.name === name)?.source ?? "";
      expect(source, name).toMatch(/greyed=\{/);
      expect(source, name).toMatch(/onPressGreyed=\{/);
    }
  });
});
