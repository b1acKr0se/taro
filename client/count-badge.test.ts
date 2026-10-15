/**
 * The Inbox's count badge (TR-123). The pill is React Native that vitest cannot render, so its text is
 * tested as logic and its places by reading their source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COUNT_BADGE_MAX, countBadgeText } from "./count-badge-text";

const source = (name: string) => readFileSync(join(__dirname, name), "utf8");
const between = (text: string, start: string, end: string) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

describe("countBadgeText", () => {
  it("draws nothing when nothing waits", () => {
    expect(countBadgeText(0)).toBeNull();
    expect(countBadgeText(-1)).toBeNull();
    expect(countBadgeText(Number.NaN)).toBeNull();
  });

  it("shows the count up to 99, then 99+", () => {
    expect(countBadgeText(1)).toBe("1");
    expect(countBadgeText(COUNT_BADGE_MAX)).toBe("99");
    expect(countBadgeText(COUNT_BADGE_MAX + 1)).toBe("99+");
    expect(countBadgeText(1234)).toBe("99+");
  });
});

describe("the count badge's places", () => {
  it("is the one pill on the sidebar, the tabs and the switch", () => {
    expect(source("sidebar.tsx")).toContain("<CountBadge theme={theme} count={waiting} />");
    expect(source("taro-screen.tsx")).toContain("<CountBadge theme={theme} count={count} />");
    expect(source("ui.tsx")).toContain("<CountBadge theme={theme} count={option.count ?? 0} />");
    for (const file of ["sidebar.tsx", "taro-screen.tsx"]) expect(source(file)).not.toContain("statusWarning, alignItems");
  });

  it("counts every project's waiting items on the wide Inbox tab and the phone's Inbox segment", () => {
    const screen = source("taro-screen.tsx");
    expect(screen).toMatch(/tab\("inbox", "Inbox", "Inbox", showing === "inbox", \(\) => choose\(selected, "inbox"\), needsYouTotal\(list\)\)/);
    expect(screen).toContain('{ value: "inbox", label: "Inbox", count: needsYouTotal(all) }');
    expect(screen).not.toContain("`Inbox ${");
  });

  it("draws the phone's switch dense, so a 99+ badge and the settings button fit a 360-point phone", () => {
    const phoneSwitch = between(source("taro-screen.tsx"), "<Segmented", "/>");
    expect(phoneSwitch).toMatch(/^<Segmented\s+theme=\{theme\}\s+value=\{phoneTab\}\s+dense\b/);
    expect(between(source("ui.tsx"), "export function Segmented", "export function JumpToEnd")).toContain("paddingHorizontal: SEGMENTED.densePaddingHorizontal");
  });
});
