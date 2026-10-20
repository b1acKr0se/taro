/**
 * The Inbox's count badge (TR-123). The pill is React Native that vitest cannot render, so its text is
 * tested as logic and its places by reading their source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COUNT_BADGE_MAX, countBadgeLabel, countBadgeText, needsYouTotal } from "./count-badge-text";

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

describe("countBadgeLabel", () => {
  it("keeps a tab's name alone at zero and reads the badge's count after it otherwise", () => {
    expect(countBadgeLabel("Inbox", 0)).toBe("Inbox");
    expect(countBadgeLabel("Inbox", 6)).toBe("Inbox, 6 waiting");
    expect(countBadgeLabel("Inbox", 250)).toBe("Inbox, 99+ waiting");
  });
});

describe("needsYouTotal", () => {
  it("adds every project's waiting items, zero for none", () => {
    expect(needsYouTotal([])).toBe(0);
    expect(needsYouTotal([{ needsYou: 4 }, { needsYou: 0 }, { needsYou: 2 }])).toBe(6);
  });
});

describe("the count badge's places", () => {
  it("is the one pill on the sidebar, the tabs and the switch", () => {
    expect(source("sidebar.tsx")).toContain("<CountBadge theme={theme} count={waiting} />");
    expect(source("project-tabs.tsx")).toContain("<CountBadge theme={theme} count={project.needsYou} />");
    expect(source("project-tabs.tsx")).toContain("<CountBadge theme={theme} count={inboxCount} />");
    expect(source("ui.tsx")).toContain("<CountBadge theme={theme} count={option.count ?? 0} />");
    for (const file of ["sidebar.tsx", "taro-screen.tsx", "project-tabs.tsx"]) expect(source(file)).not.toContain("statusWarning, alignItems");
  });

  it("names the count to screen readers on the tabs and the switch's segments", () => {
    expect(source("project-tabs.tsx")).toContain("accessibilityLabel={countBadgeLabel(project.name, compact ? 0 : project.needsYou)}");
    expect(source("project-tabs.tsx")).toContain('accessibilityLabel={countBadgeLabel("Inbox", inboxCount)}');
    expect(source("ui.tsx")).toContain("accessibilityLabel={countBadgeLabel(option.label, option.count ?? 0)}");
  });

  it("counts every project's waiting items on the wide Inbox tab, which lists them all", () => {
    const screen = source("taro-screen.tsx");
    expect(screen).toContain("inboxCount={needsYouTotal(list)}");
    expect(screen).toMatch(/<MemoInbox projects=\{list\}/);
    expect(screen).not.toContain("`Inbox ${");
  });

  it("counts and lists only the open project's items on the phone's Inbox segment (TR-137)", () => {
    const screen = source("taro-screen.tsx");
    const phone = between(screen, "if (compact) {", "if (!layout.board)");
    expect(phone).toContain('{ value: "inbox", label: "Inbox", count: summary.needsYou }');
    expect(phone).toContain("<MemoInbox projects={inboxProjects}");
    expect(screen).toContain("const inboxProjects = useMemo(() => [summary], [summary]);");
    expect(phone).not.toContain("needsYouTotal");
  });

  it("draws the phone's switch dense, so a 99+ badge and the settings button fit a 360-point phone", () => {
    const phoneSwitch = between(source("taro-screen.tsx"), "<Segmented", "/>");
    expect(phoneSwitch).toMatch(/^<Segmented\s+theme=\{theme\}\s+value=\{phoneTab\}\s+dense\b/);
    expect(between(source("ui.tsx"), "export function Segmented", "export function JumpToEnd")).toContain("paddingHorizontal: SEGMENTED.densePaddingHorizontal");
  });
});
