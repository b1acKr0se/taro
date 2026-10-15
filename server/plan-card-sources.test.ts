/**
 * A plan approval waiting for the user opens its ticket's chat from anywhere on the card, as the other
 * cards in Needs you and the Inbox do (TR-126): only its buttons, links and change box do otherwise.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (name: string) => readFileSync(join(root, "client", name), "utf8");

/** Each `<PlanDecision …>` opening tag, from its name to the `>` that ends it on its own or after `}`. */
function planDecisionTags(text: string): string[] {
  return text
    .split("<PlanDecision")
    .slice(1)
    .map((rest) => rest.split(/(?:\}|")>|^\s*>/m)[0] ?? "");
}

describe("plan card sources", () => {
  it("passes an opener to every plan card on the board and in the Inbox", () => {
    for (const name of ["ticket-card.tsx", "inbox.tsx"]) {
      const tags = planDecisionTags(source(name));
      expect(tags.length, name).toBeGreaterThan(0);
      for (const tag of tags) expect(tag, name).toMatch(/\bonOpen=\{/);
    }
  });

  it("makes the whole card the pressable that opens, not only its head", () => {
    const plan = source("plan-card.tsx");
    expect(plan).not.toMatch(/onOpenHead/);
    expect(plan).toMatch(/<Pressable accessibilityRole="button"[^>]*onPress=\{writing \? undefined : onOpen\}[^>]*style=\{styles\.card\}/);
  });

  it("stops opening while the change box is open, so a click in its field stays there", () => {
    const plan = source("plan-card.tsx");
    expect(plan).toMatch(/onPress=\{writing \? undefined : onOpen\}/);
    // Disabled, the card would mark the box's own buttons disabled on the web.
    expect(plan).not.toMatch(/disabled=\{writing\}/);
    expect(plan).toMatch(/onWriting=\{setWriting\}/);
  });
});
