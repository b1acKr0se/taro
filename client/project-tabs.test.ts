/**
 * The project tab row (TR-071, TR-214) is React Native that vitest cannot render, so these read its source:
 * New Project is pinned outside the scrolling tabs, Inbox is a solid button beside them, each tab has its
 * letter avatar and can be dragged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const tabs = readFileSync(join(__dirname, "project-tabs.tsx"), "utf8");
const screen = readFileSync(join(__dirname, "taro-screen.tsx"), "utf8");

describe("the New Project button in the project tab row", () => {
  it("is the Catch up button's kind, labelled New Project with a +, its words dropped on a phone", () => {
    expect(tabs).toContain('<IconButton icon="Plus" label="New Project" showLabel={!compact} theme={theme} onPress={onNewProject} />');
    expect(tabs).not.toMatch(/label="New project"|>New project</);
  });

  it("sits after the scrolling tabs, outside them, so it needs no scroll to be reached", () => {
    const scroller = tabs.slice(tabs.indexOf("<ScrollView"), tabs.indexOf("</ScrollView>"));
    expect(scroller).not.toContain("IconButton");
    expect(tabs).toMatch(/<\/ScrollView>\s*<View style=\{styles\.pinned\}>\s*<IconButton icon="Plus"/);
    expect(tabs).toMatch(/pinned: \{[^}]*borderLeftWidth/);
  });

  it("is the screen's only draw of the row: no second copy of the tabs in the screen", () => {
    expect(screen).toContain("<ProjectTabs");
    expect(screen).not.toContain('<ScrollView horizontal contentContainerStyle={styles.tabs}');
    expect(screen).toContain('onNewProject={() => choose(selected, "setup")}');
  });
});

describe("the Inbox button", () => {
  it("is a bell button with a danger-coloured count on its corner, on a wide screen only, with a divider before the tabs, not a tab", () => {
    expect(tabs).toMatch(/inbox: \{[^}]*backgroundColor: colors\.surface1/s);
    expect(tabs).toContain('<Icon name="Bell"');
    expect(tabs).toContain("background={colors.statusDanger}");
    expect(tabs).toContain("compact || projects.length === 0 ? null");
    expect(tabs).toMatch(/inboxActive: \{ borderColor: colors\.foreground, backgroundColor: withAlpha\(colors\.accent, 0\.3\) \}/);
    // Not drawn with the project tabs' underline or avatar.
    const inbox = tabs.slice(tabs.indexOf('onPress={onOpenInbox}'), tabs.indexOf("styles.divider"));
    expect(inbox).not.toContain("ProjectAvatar");
    expect(inbox).not.toContain("tabActive");
  });
});

describe("the project tabs", () => {
  it("each draw the letter avatar", () => {
    expect(tabs).toMatch(/<ProjectAvatar name=\{project\.name\} \/>/);
  });

  it("lift on a long press and take the drag only then, so a swipe still scrolls", () => {
    expect(tabs).toContain("onLongPress={() => lift(project.name)}");
    expect(tabs).toContain("onMoveShouldSetPanResponderCapture: () => drag.current?.lifted() !== null");
    expect(tabs).toContain("onPanResponderTerminationRequest: () => false");
    expect(tabs).toContain("scrollEnabled={lifted === null}");
  });

  it("put a held tab back when the finger lifts with no move, and scroll the row by a timer at its edge (the state machine is tested in shared/tab-drag.test.ts)", () => {
    expect(tabs).toContain("onPressOut={releaseHold}");
    expect(tabs).toContain("drag.current?.cancelHold()");
    expect(tabs).toContain("setInterval(");
    expect(tabs).not.toContain("const live = useRef({ lifted");
  });

  it("save the order a drop makes, and only when it changed", () => {
    expect(tabs).toContain("if (order.join");
    expect(screen).toContain("saveOrder({ order })");
  });
});
