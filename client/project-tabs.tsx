/**
 * The project tab row (TR-214): on a wide screen the Inbox button, then the project tabs, each with its
 * letter avatar; New project is pinned at the row's right end, outside the scrolling tabs, so it is
 * reachable with no scroll (TR-071 put it after the last tab). Press and hold a tab, then drag it, to
 * reorder the projects.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useRef, useState } from "react";
import { PanResponder, Platform, ScrollView, View, type LayoutChangeEvent } from "react-native";

import { dropIndex, moveProject, type TabSlot } from "../shared/project-order";
import { AVATAR_LETTER_COLOR, avatarColor, avatarLetter, avatarRadius } from "../shared/project-avatar";
import { CentredLabel } from "./centred-label";
import { CountBadge } from "./count-badge";
import { countBadgeLabel } from "./count-badge-text";
import { Pressable } from "./focus";
import { paneGutter, SPACE } from "./spacing";
import { FONT_SIZE, labelLineHeightFor } from "./type-scale";
import { IconButton } from "./ui";

const AVATAR_SIZE = 18;
/** How long a press is held before the tab lifts for dragging. */
const LIFT_DELAY_MS = 300;
/** A lifted tab within this many px of the row's edge scrolls the row, per move. */
const EDGE_PX = 40;
const EDGE_STEP_PX = 14;
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
      // A solid accent button, the only filled control in the row, so Inbox reads as a button and not a project.
      inbox: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        alignSelf: "center" as const,
        gap: SPACE.sm,
        marginLeft: paneGutter(false),
        paddingVertical: SPACE.sm,
        paddingHorizontal: SPACE.md + 2,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: colors.accent,
        backgroundColor: colors.accent,
      },
      // Chosen: the same button ringed in the foreground colour, as no project tab is underlined then.
      inboxActive: { borderColor: colors.foreground },
      inboxText: { color: colors.accentForeground, fontSize: FONT_SIZE.body, lineHeight: labelLineHeightFor(FONT_SIZE.body), fontWeight: "700" as const },
      divider: { width: 1, alignSelf: "stretch" as const, marginVertical: SPACE.sm, marginLeft: SPACE.md, backgroundColor: colors.border },
      pinned: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        paddingHorizontal: SPACE.md,
        borderLeftWidth: 1,
        borderLeftColor: colors.border,
        backgroundColor: colors.surface0,
      },
    }),
    [colors],
  );

  const names = projects.map((project) => project.name);
  const [lifted, setLifted] = useState<string | null>(null);
  const [shift, setShift] = useState(0);
  const slots = useRef<Record<string, { x: number; width: number }>>({});
  const scrollRef = useRef<ScrollView>(null);
  const scrollX = useRef(0);
  const viewWidth = useRef(0);
  // What the responder callbacks read: they are made once, so they look the latest values up here.
  const live = useRef({ lifted: null as string | null, names, onReorder, startScroll: 0 });
  live.current.names = names;
  live.current.onReorder = onReorder;

  function slotList(): TabSlot[] {
    return live.current.names.map((name) => ({ name, x: slots.current[name]?.x ?? 0, width: slots.current[name]?.width ?? 0 }));
  }

  function lift(name: string): void {
    live.current.lifted = name;
    live.current.startScroll = scrollX.current;
    setShift(0);
    setLifted(name);
  }

  function drop(): void {
    const name = live.current.lifted;
    live.current.lifted = null;
    setLifted(null);
    if (name === null) return;
    const index = dropIndex(slotList(), name, shiftNow.current);
    const order = moveProject(live.current.names, name, index);
    shiftNow.current = 0;
    setShift(0);
    if (order.join("\n") !== live.current.names.join("\n")) live.current.onReorder(order);
  }

  const shiftNow = useRef(0);
  const responder = useRef(
    PanResponder.create({
      // Only a lifted tab takes the drag, so a plain swipe still scrolls the row.
      onMoveShouldSetPanResponderCapture: () => live.current.lifted !== null,
      onPanResponderMove: (_event, gesture) => {
        const name = live.current.lifted;
        const slot = name === null ? undefined : slots.current[name];
        if (slot === undefined) return;
        const total = gesture.dx + (scrollX.current - live.current.startScroll);
        shiftNow.current = total;
        setShift(total);
        const centreInView = slot.x + slot.width / 2 + total - scrollX.current;
        if (centreInView < EDGE_PX) scrollRef.current?.scrollTo({ x: Math.max(0, scrollX.current - EDGE_STEP_PX), animated: false });
        else if (centreInView > viewWidth.current - EDGE_PX) scrollRef.current?.scrollTo({ x: scrollX.current + EDGE_STEP_PX, animated: false });
      },
      onPanResponderRelease: drop,
      onPanResponderTerminate: drop,
    }),
  ).current;

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
            <Icon name="Inbox" size={15} color={colors.accentForeground} />
            <CentredLabel style={styles.inboxText}>Inbox</CentredLabel>
            <CountBadge theme={theme} count={inboxCount} />
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
        showsHorizontalScrollIndicator={false}
      >
        <View style={[styles.tabs, NO_SELECT]} {...responder.panHandlers}>
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
