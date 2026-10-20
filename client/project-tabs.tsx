/**
 * The project tab row (TR-214): on a wide screen the Inbox button, then the project tabs, each with its
 * letter avatar; New project is pinned at the row's right end, outside the scrolling tabs, so it is
 * reachable with no scroll (TR-071 put it after the last tab). Press and hold a tab, then drag it, to
 * reorder the projects.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, ScrollView, View, type LayoutChangeEvent } from "react-native";

import { dropIndex, moveProject, type TabSlot } from "../shared/project-order";
import { clampScroll, createTabDrag, edgeStep, type TabDrag } from "../shared/tab-drag";
import { AVATAR_LETTER_COLOR, avatarColor, avatarLetter, avatarRadius } from "../shared/project-avatar";
import { CentredLabel } from "./centred-label";
import { CountBadge } from "./count-badge";
import { countBadgeLabel } from "./count-badge-text";
import { Pressable } from "./focus";
import { withAlpha } from "./tint";
import { paneGutter, SPACE } from "./spacing";
import { FONT_SIZE, labelLineHeightFor } from "./type-scale";
import { IconButton } from "./ui";

const AVATAR_SIZE = 18;
/** How long a press is held before the tab lifts for dragging. */
const LIFT_DELAY_MS = 300;
/** On the web a drag across the tabs would select their names instead. */
const NO_SELECT = Platform.OS === "web" ? ({ userSelect: "none" } as object) : null;

export interface TabProject {
  name: string;
  needsYou: number;
}

/** Paseo's sidebar avatar: a rounded square with the name's letter in white (`shared/project-avatar.ts`). */
export function ProjectAvatar({ name, size = AVATAR_SIZE }: { name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: avatarRadius(size), backgroundColor: avatarColor(name), alignItems: "center", justifyContent: "center" }}>
      <CentredLabel style={{ color: AVATAR_LETTER_COLOR, fontSize: Math.round(size * 0.55), lineHeight: labelLineHeightFor(Math.round(size * 0.55)), fontWeight: "700" }}>{avatarLetter(name)}</CentredLabel>
    </View>
  );
}

export function ProjectTabs({
  theme,
  compact,
  projects,
  active,
  inboxActive,
  inboxCount,
  onOpenProject,
  onOpenInbox,
  onNewProject,
  onReorder,
}: {
  theme: PluginTheme;
  compact: boolean;
  projects: readonly TabProject[];
  /** The open project's name, or null when none is drawn as chosen (Inbox or New project is showing). */
  active: string | null;
  inboxActive: boolean;
  inboxCount: number;
  onOpenProject: (name: string) => void;
  onOpenInbox: () => void;
  onNewProject: () => void;
  onReorder: (order: string[]) => void;
}) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      row: { flexDirection: "row" as const, alignItems: "stretch" as const, borderBottomWidth: 1, borderBottomColor: colors.border },
      scroller: { flex: 1, minWidth: 0 },
      tabs: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.lg, paddingHorizontal: paneGutter(false) },
      tab: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.sm,
        paddingHorizontal: SPACE.xs,
        paddingTop: SPACE.md,
        paddingBottom: SPACE.md - 2,
        borderBottomWidth: 2,
        borderBottomColor: "transparent",
      },
      tabActive: { borderBottomColor: colors.accent },
      tabLifted: { zIndex: 10, backgroundColor: colors.surface2, borderRadius: 6 },
      tabText: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: labelLineHeightFor(FONT_SIZE.body), fontWeight: "600" as const },
      tabMuted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.body, lineHeight: labelLineHeightFor(FONT_SIZE.body), fontWeight: "500" as const },
      insertion: { position: "absolute" as const, top: SPACE.sm, bottom: SPACE.sm, width: 2, borderRadius: 1, backgroundColor: colors.accent },
      // A bell with the word Inbox in a bordered button, the count on its corner in the danger colour; its margins give the row its height.
      inbox: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        alignSelf: "center" as const,
        gap: SPACE.sm,
        paddingVertical: SPACE.sm,
        paddingHorizontal: SPACE.md + 2,
        marginVertical: SPACE.sm,
        marginLeft: 0,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      // Chosen: a stronger wash, ringed in the foreground colour, as no project tab is underlined then.
      inboxActive: { borderColor: colors.foreground, backgroundColor: withAlpha(colors.accent, 0.3) },
      inboxText: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: labelLineHeightFor(FONT_SIZE.body), fontWeight: "600" as const },
      inboxBadge: { position: "absolute" as const, top: -7, right: -8, borderWidth: 2, borderColor: colors.surface0, borderRadius: 11 },
      // The same full-height line as the one before New Project.
      divider: { width: 1, alignSelf: "stretch" as const, marginLeft: SPACE.md, backgroundColor: colors.border },
      pinned: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        paddingHorizontal: SPACE.md,
        borderLeftWidth: 1,
        borderLeftColor: colors.border,
        backgroundColor: colors.surface0,
      },
    }),
    [colors, compact],
  );

  const names = projects.map((project) => project.name);
  const [lifted, setLifted] = useState<string | null>(null);
  const [shift, setShift] = useState(0);
  const slots = useRef<Record<string, { x: number; width: number }>>({});
  const scrollRef = useRef<ScrollView>(null);
  const scrollX = useRef(0);
  const viewWidth = useRef(0);
  const contentWidth = useRef(0);
  const drag = useRef<TabDrag | null>(null);
  if (drag.current === null) drag.current = createTabDrag();
  // What the responder callbacks read: they are made once, so they look the latest values up here.
  const live = useRef({ names, onReorder });
  live.current.names = names;
  live.current.onReorder = onReorder;

  function slotList(): TabSlot[] {
    return live.current.names.map((name) => ({ name, x: slots.current[name]?.x ?? 0, width: slots.current[name]?.width ?? 0 }));
  }

  function lift(name: string): void {
    drag.current?.lift(name, scrollX.current);
    setShift(0);
    setLifted(name);
  }

  /** The finger lifted off a held tab that never moved: put it back, once the responder has had its chance to take a drag. */
  function releaseHold(): void {
    setTimeout(() => {
      if (drag.current?.cancelHold() === true) {
        setShift(0);
        setLifted(null);
      }
    }, 60);
  }

  function drop(): void {
    const done = drag.current?.finish() ?? null;
    setLifted(null);
    setShift(0);
    if (done === null) return;
    const order = moveProject(live.current.names, done.name, dropIndex(slotList(), done.name, done.shift));
    if (order.join("\n") !== live.current.names.join("\n")) live.current.onReorder(order);
  }

  /** Where the lifted tab's centre is within the visible row, for edge scrolling. */
  function centreInView(): number | null {
    const name = drag.current?.lifted() ?? null;
    const slot = name === null ? undefined : slots.current[name];
    return slot === undefined ? null : slot.x + slot.width / 2 + (drag.current?.shift() ?? 0) - scrollX.current;
  }

  // While a tab is held near the row's edge the row scrolls, even when the finger stands still.
  useEffect(() => {
    if (lifted === null) return undefined;
    const timer = setInterval(() => {
      const centre = centreInView();
      const step = centre === null ? 0 : edgeStep(centre, viewWidth.current);
      if (step === 0 || drag.current?.moved() !== true) return;
      const next = clampScroll(scrollX.current, step, contentWidth.current, viewWidth.current);
      if (next === scrollX.current) return;
      scrollX.current = next;
      scrollRef.current?.scrollTo({ x: scrollX.current, animated: false });
      setShift(drag.current?.scrolled(scrollX.current) ?? 0);
    }, 16);
    return () => clearInterval(timer);
  }, [lifted]);

  const responder = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (responder.current === null) {
    responder.current = PanResponder.create({
      // Only a lifted tab takes the drag, so a plain swipe still scrolls the row.
      onMoveShouldSetPanResponderCapture: () => drag.current?.lifted() !== null,
      // The row's own scroll (an edge scroll on the web) must not take the drag from a lifted tab.
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => setShift(drag.current?.move(gesture.dx, scrollX.current) ?? 0),
      onPanResponderRelease: drop,
      onPanResponderTerminate: drop,
    });
  }

  const target = lifted === null ? null : dropIndex(slotList(), lifted, shift);
  const others = lifted === null ? [] : slotList().filter((slot) => slot.name !== lifted);
  const insertionX = target === null ? 0 : target < others.length ? (others[target]?.x ?? 0) - SPACE.lg / 2 : (others.length === 0 ? 0 : (others[others.length - 1]?.x ?? 0) + (others[others.length - 1]?.width ?? 0) + SPACE.lg / 2);

  function onTabLayout(name: string, event: LayoutChangeEvent): void {
    const { x, width } = event.nativeEvent.layout;
    slots.current[name] = { x, width };
  }

  return (
    <View style={styles.row}>
      {compact || projects.length === 0 ? null : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: inboxActive }}
            accessibilityLabel={countBadgeLabel("Inbox", inboxCount)}
            style={[styles.inbox, inboxActive ? styles.inboxActive : null]}
            onPress={onOpenInbox}
          >
            <Icon name="Bell" size={16} color={colors.foreground} />
            <CentredLabel style={styles.inboxText}>Inbox</CentredLabel>
            <View style={styles.inboxBadge}>
              <CountBadge theme={theme} count={inboxCount} background={colors.statusDanger} />
            </View>
          </Pressable>
          <View style={styles.divider} />
        </>
      )}
      <ScrollView
        ref={scrollRef}
        horizontal
        style={styles.scroller}
        scrollEnabled={lifted === null}
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollX.current = event.nativeEvent.contentOffset.x;
        }}
        onLayout={(event) => {
          viewWidth.current = event.nativeEvent.layout.width;
        }}
        onContentSizeChange={(width) => {
          contentWidth.current = width;
        }}
        showsHorizontalScrollIndicator={false}
      >
        <View style={[styles.tabs, NO_SELECT]} {...responder.current.panHandlers}>
          {projects.map((project) => {
            const isActive = active === project.name;
            const isLifted = lifted === project.name;
            return (
              <Pressable
                key={project.name}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={countBadgeLabel(project.name, compact ? 0 : project.needsYou)}
                accessibilityHint="Press and hold, then drag, to move this project"
                delayLongPress={LIFT_DELAY_MS}
                onLongPress={() => lift(project.name)}
                onPressOut={releaseHold}
                onLayout={(event) => onTabLayout(project.name, event)}
                onPress={() => onOpenProject(project.name)}
                style={[styles.tab, isActive ? styles.tabActive : null, isLifted ? styles.tabLifted : null, isLifted ? { transform: [{ translateX: shift }] } : null]}
              >
                <ProjectAvatar name={project.name} />
                <CentredLabel style={isActive ? styles.tabText : styles.tabMuted}>{project.name}</CentredLabel>
                {compact ? null : <CountBadge theme={theme} count={project.needsYou} />}
              </Pressable>
            );
          })}
          {lifted === null ? null : <View pointerEvents="none" style={[styles.insertion, { left: insertionX }]} />}
        </View>
      </ScrollView>
      <View style={styles.pinned}>
        <IconButton icon="Plus" label="New Project" showLabel={!compact} theme={theme} onPress={onNewProject} />
      </View>
    </View>
  );
}
