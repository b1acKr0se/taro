/**
 * Dismiss on a card asking several questions closes the question, as on a single card (TR-239):
 * clearing only the shown pick left the user a button that read as closing but did nothing they
 * could see on the agent's side. A pick is cleared by tapping it again. React Native that vitest
 * cannot render, so this reads the source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "decision-card.tsx"), "utf8");
const severalCard = source.slice(source.indexOf("function SeveralCard("), source.indexOf("type CardStyles"));
const optionRadios = source.slice(source.indexOf("function OptionRadios("));

describe("Dismiss on a card asking several questions", () => {
  it("closes the question through the dismiss RPC, held until it leaves, then forgets the kept picks", () => {
    expect(severalCard).toContain("const dismiss = useRpc(dismissManagerQuestion);");
    expect(severalCard).toMatch(/label="Dismiss"[\s\S]*?presses\.press\("dismiss", \(\) => dismiss\(\{ project: decision\.project, key: decision\.key \}\), \{\s*after: "hold",\s*onSuccess: \(\) => \{\s*kept\.forget\(\);\s*onAnswered\(\);/);
  });

  it("no longer only clears the shown pick, and is not greyed while nothing is picked", () => {
    expect(severalCard).not.toContain("onPress={() => setDraft(null)}");
    expect(severalCard).not.toMatch(/label="Dismiss"[^>]*draft === null/);
  });

  it("leaves Submit still while Dismiss runs", () => {
    expect(severalCard).toContain('state={submitLook(presses.stateOf("submit"), busy, presses.stateOf("dismiss") !== undefined)}');
  });

  it("clears a pick when the picked option is tapped again", () => {
    expect(optionRadios).toContain("onPress={() => onPick(isPicked ? null : index)}");
    expect(severalCard).toContain("if (next === null) setDraft(null);");
  });
});
