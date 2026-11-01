/**
 * Where the loader and the turn's time are drawn, and what holds them still (TR-183). React Native
 * that vitest cannot render, so these read the source, as `tool-line.test.ts` does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");
const chat = read("agent-chat.tsx");
const loading = read("loading.tsx");

describe("the working status at the end of a chat", () => {
  it("is hidden while a permission request waits on the user", () => {
    expect(chat).toMatch(/\{pending\.length > 0 \? null : <WorkingStatus theme=\{theme\} shown=\{loaderShown\} turnStartedAt=\{working \? agent\.turnStartedAt : null\} \/>\}/);
    expect(chat.match(/<WorkingStatus\b/g)).toHaveLength(1);
  });

  it("gets the turn's start from every chat that draws an agent", () => {
    for (const file of ["owner-pane.tsx", "taro-screen.tsx"]) {
      const agents = read(file).match(/<AgentChat[\s\S]*?agent=\{\{[^}]*\}\}/g) ?? [];
      expect(agents.length).toBeGreaterThan(0);
      for (const agent of agents) expect(agent).toMatch(/turnStartedAt: \w+(\.\w+)*\.turnStartedAt/);
    }
  });

  it("never brings back the word Working…", () => {
    expect(chat).not.toMatch(/Working…/);
    expect(loading).not.toMatch(/Working…/);
  });
});

describe("the chat's status (TR-201)", () => {
  it("follows the stream's turn start or end over the last read, everywhere the chat reads the status", () => {
    expect(chat).toMatch(/const status = statusWithTurn\(live\?\.status \?\? agent\.status, timeline\.turn\);/);
    expect(chat).not.toMatch(/live\?\.status \?\? agent\.status(?!, timeline\.turn)/);
  });

  it("tells the ticket pane, whose header shows the shown agent's status from it rather than the board's older read", () => {
    expect(chat).toMatch(/useEffect\(\(\) => \{\s*onStatus\?\.\(status\);\s*\}, \[status\]\);/);
    const pane = read("owner-pane.tsx");
    expect(pane).toMatch(/onStatus=\{\(status\) => setChatStatus\(\{ agentId: shown\.id, status \}\)\}/);
    expect(pane).toMatch(/subtitle=\{shown === null \? undefined : `\$\{shown\.label\} · \$\{paneStatus\(shown, chatStatus\)\}`\}/);
  });

  it("shows the loader while a message is on its way, and the turn's time only while a turn runs", () => {
    expect(chat).toMatch(/const loaderShown = showsLoader\(status, sends\.views\.map\(\(view\) => view\.mark\)\);/);
  });
});

describe("the loader and the shimmer", () => {
  it("start no animation when the phone asks for reduced motion", () => {
    const loop = loading.slice(loading.indexOf("function useLoop("), loading.indexOf("\n}\n", loading.indexOf("function useLoop(")));
    expect(loop).toMatch(/value\.setValue\(from\);\s*if \(still\) return;\s*const loop = Animated\.loop/);
    expect(loading).toMatch(/useLoop\(step, 0, SYNCED_LOADER_DOT_COUNT, SYNCED_LOADER_DURATION_MS, reduced\)/);
    expect(loading).toMatch(/const running = active && !reduced;/);
    // The phone's letters are recoloured by a timer that runs only while moving (TR-246).
    expect(loading).toMatch(/useBandClock\(running && !WEB,/);
    // The web's copy, whose animation runs in the browser, is drawn only while moving (TR-184).
    expect(loading).toMatch(/if \(WEB && running && size\.width > 0 && webShimmerSupported\(\)\) \{/);
  });

  it("crosses only the letters the measured row shows, on the phone too (TR-246)", () => {
    expect(loading).toMatch(/shimmerMetrics\(visibleLetters\(spanCharacters, size\.width\)\)/);
    expect(loading).toMatch(/onLayout=\{WEB \|\| active \? measure : undefined\}/);
  });

  it("draws the phone's shimmer in the words' own text, never as copies laid over them (TR-246)", () => {
    expect(loading).not.toMatch(/ShimmerBand|shimmerLayers|overflow: "hidden"/);
    const shimmer = loading.slice(loading.indexOf("export function Shimmer("));
    expect(loading).toMatch(/shimmerRuns\(text, start, clock\.position, peakLetters\)/);
    expect(shimmer).toMatch(/if \(WEB \|\| !active\) return text;/);
  });

  it("recolours on a tick only the painted spans, and only when a shade changed (TR-246)", () => {
    // The tick never sets the Shimmer's own state, so the tool line does not render again.
    const clockBody = loading.slice(loading.indexOf("function useBandClock("), loading.indexOf("function PaintedWords("));
    expect(clockBody).not.toMatch(/setState|setPosition|useState/);
    expect(loading).toMatch(/sameRuns\(current, next\) \? current : next/);
  });

  it("keeps the label's width from rest while the band recolours it (TR-246)", () => {
    const chat = read("agent-chat.tsx");
    expect(chat).toMatch(/\{ width: pinned \}/);
    expect(chat).toMatch(/Math\.ceil\(event\.nativeEvent\.layout\.width\)/);
  });

  it("styles the web's copy before the browser paints it, and again when its words change (TR-184)", () => {
    expect(loading).toMatch(/useLayoutEffect\(\(\) => watchWebShimmer\(copy\.current, durationMs\), \[durationMs, size\.width, size\.height\]\);/);
  });

  it("hides the shimmer's copies of the words from screen readers, on the web too", () => {
    const body = (name: string) => loading.slice(loading.indexOf(`function ${name}(`), loading.indexOf("\n}\n", loading.indexOf(`function ${name}(`)));
    expect(body("WebShimmerCopy")).toMatch(/^\s+aria-hidden$/m);
    for (const name of ["WebShimmerCopy"]) {
      expect(body(name)).toMatch(/accessibilityElementsHidden/);
      expect(body(name)).toMatch(/importantForAccessibility="no-hide-descendants"/);
    }
  });
});
