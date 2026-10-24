/**
 * The chat composer's pick list (TR-232), drawn: it floats right above the reply box over the
 * transcript, as wide as the box, best match first and selected. `/` lists the agent's commands, `@`
 * the project's files (a folder opens in place, with a back arrow), `#` its tickets. Drawn in the
 * chat's own pane rather than inside the box's frame: a phone takes no touch outside a view's bounds.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { Platform, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";

import { Pressable } from "./focus";
import {
  fileRowParts,
  headingBefore,
  markedPieces,
  scrollToShow,
  ticketStatusTone,
  type CursorStore,
  type MarkedPiece,
  type PickKeyEvent,
  type PickRow,
} from "./pick-list-state";
import { SPACE } from "./spacing";
import { FONT_SIZE, labelLineHeightFor, lineHeightFor } from "./type-scale";
import { MONOSPACE } from "./ui";
import { usePickList } from "./use-pick-list";

/** Where the list sits in the chat's pane: above the box's top, `room` being the height above it. */
export interface PickAnchor {
  left: number;
  width: number;
  bottom: number;
  room: number;
}

const ROWS_SHOWN = 6;
const ROW_HEIGHT_DESKTOP = 34;
const ROW_HEIGHT_PHONE = 46;
const LIST_PADDING = SPACE.xs;
const ICON_SIZE = 15;

export interface PickListLayerProps {
  theme: PluginTheme;
  compact: boolean;
  text: string;
  cursor: CursorStore;
  project: string;
  agentId: string;
  anchor: PickAnchor | null;
  /** Filled with the list's key handler, which the box calls before its own Enter and Escape. */
  keys: RefObject<((event: PickKeyEvent) => boolean) | null>;
  onPick: (text: string, cursor: number) => void;
}

export const PickListLayer = memo(function PickListLayer({ theme, compact, text, cursor, project, agentId, anchor, keys, onPick }: PickListLayerProps) {
  const list = usePickList({ text, cursor, project, agentId, onPick });
  useLayoutEffect(() => {
    keys.current = list.onKey;
  });
  useEffect(
    () => () => {
      keys.current = null;
    },
    [keys],
  );
  const { colors } = theme;
  const desktop = Platform.OS === "web" && !compact;
  const rowHeight = desktop ? ROW_HEIGHT_DESKTOP : ROW_HEIGHT_PHONE;
  const styles = useMemo(() => pickListStyles(colors, rowHeight), [colors, rowHeight]);
  const scroll = useRef<ScrollView>(null);
  const rowLayouts = useRef(new Map<number, { top: number; height: number }>());
  const scrollState = useRef({ offset: 0, viewport: 0 });

  const view = list.view;
  const rows = view?.rows ?? [];
  const selected = list.selected;
  function reveal(): void {
    const layout = rowLayouts.current.get(selected);
    if (layout === undefined) return;
    const next = scrollToShow(scrollState.current.offset, scrollState.current.viewport, layout.top, layout.height);
    if (Math.abs(next - scrollState.current.offset) < 1) return;
    scrollState.current.offset = next;
    scroll.current?.scrollTo({ y: next, animated: false });
  }
  useEffect(reveal, [selected, rows.length, view?.trigger.query]);

  if (view === null || anchor === null) return null;
  const browsing = view.folder !== null;
  const headerHeight = browsing ? rowHeight + 1 : 0;
  const hintHeight = desktop && rows.length > 0 ? lineHeightFor(FONT_SIZE.caption) + 2 * SPACE.sm + 1 : 0;
  const listHeight = Math.max(
    rowHeight + 2 * LIST_PADDING,
    Math.min(ROWS_SHOWN * rowHeight + 2 * LIST_PADDING, anchor.room - headerHeight - hintHeight - SPACE.lg),
  );

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.layer,
        {
          left: anchor.left,
          width: anchor.width,
          bottom: anchor.bottom + SPACE.xs,
        },
      ]}
    >
      <View style={styles.box} accessibilityLabel={view.trigger.kind === "command" ? "Commands" : view.trigger.kind === "file" ? "Files" : "Tickets"}>
        {view.folder === null ? null : (
          <View style={[styles.folderBar, { height: rowHeight }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to the folder above" style={styles.back} onPress={list.back}>
              <Icon name="ChevronLeft" size={ICON_SIZE} color={colors.foregroundMuted} />
            </Pressable>
            <Text style={styles.folderPath} numberOfLines={1}>
              {view.folder}
            </Text>
            {view.fileCount === null ? null : <Text style={styles.folderCount}>{view.fileCount === 1 ? "1 file" : `${view.fileCount} files`}</Text>}
          </View>
        )}
        {view.message !== null ? (
          <View style={styles.message}>
            <Text style={styles.messageText}>{view.message.text}</Text>
            {view.message.detail === null ? null : (
              <Text style={styles.messageDetail} numberOfLines={2}>
                {view.message.detail}
              </Text>
            )}
          </View>
        ) : (
          <ScrollView
            ref={scroll}
            style={{ maxHeight: listHeight, flexGrow: 0 }}
            contentContainerStyle={styles.rows}
            keyboardShouldPersistTaps="always"
            scrollEventThrottle={16}
            onLayout={(event: LayoutChangeEvent) => {
              scrollState.current.viewport = event.nativeEvent.layout.height;
              reveal();
            }}
            onScroll={(event) => {
              scrollState.current.offset = event.nativeEvent.contentOffset.y;
            }}
          >
            {rows.map((row, index) => {
              const heading = headingBefore(rows, index);
              return (
                <Fragment key={row.key}>
                  {heading === null ? null : (
                    <View style={styles.heading}>
                      {heading.icon === null ? null : <Icon name={heading.icon} size={12} color={colors.foregroundMuted} />}
                      <Text style={styles.headingText}>{heading.text}</Text>
                    </View>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    aria-selected={index === selected}
                    style={[styles.row, index === selected ? styles.rowSelected : null]}
                    onLayout={(event: LayoutChangeEvent) => {
                      rowLayouts.current.set(index, {
                        top: event.nativeEvent.layout.y,
                        height: event.nativeEvent.layout.height,
                      });
                      if (index === selected) reveal();
                    }}
                    onPress={() => list.pick(row)}
                  >
                    <RowContent row={row} browsing={browsing} theme={theme} styles={styles} />
                  </Pressable>
                </Fragment>
              );
            })}
          </ScrollView>
        )}
        {hintHeight === 0 ? null : (
          <View style={styles.hints}>
            <KeyHint keys={["↑", "↓"]} label="move" styles={styles} />
            <KeyHint keys={["Enter", "Tab"]} label="pick" styles={styles} />
            <KeyHint keys={["Esc"]} label="close" styles={styles} />
          </View>
        )}
      </View>
    </View>
  );
});

type PickListStyles = ReturnType<typeof pickListStyles>;

function KeyHint({ keys, label, styles }: { keys: readonly string[]; label: string; styles: PickListStyles }) {
  return (
    <View style={styles.hint}>
      {keys.map((key) => (
        <View key={key} style={styles.keycap}>
          <Text style={styles.keycapText}>{key}</Text>
        </View>
      ))}
      <Text style={styles.hintText}>{label}</Text>
    </View>
  );
}

/** Matched letters bold in the accent; the rest in the colour of the `Text` around them. */
function Marked({ pieces, styles }: { pieces: readonly MarkedPiece[]; styles: PickListStyles }) {
  return (
    <>
      {pieces.map((piece, index) =>
        piece.marked ? (
          <Text key={index} style={styles.marked}>
            {piece.text}
          </Text>
        ) : (
          // inherits colour
          <Fragment key={index}>{piece.text}</Fragment>
        ),
      )}
    </>
  );
}

function Tag({ text, tone, theme, styles }: { text: string; tone: "success" | "warning" | "danger" | "muted"; theme: PluginTheme; styles: PickListStyles }) {
  const { colors } = theme;
  const colour =
    tone === "success" ? colors.statusSuccess : tone === "warning" ? colors.statusWarning : tone === "danger" ? colors.statusDanger : colors.foregroundMuted;
  return (
    <View style={[styles.tag, { borderColor: tone === "muted" ? colors.border : colour }]}>
      <Text style={[styles.tagText, { color: colour }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function RowContent({ row, browsing, theme, styles }: { row: PickRow; browsing: boolean; theme: PluginTheme; styles: PickListStyles }) {
  const { colors } = theme;
  if (row.kind === "command") {
    const command = row.row.command;
    return (
      <>
        <Icon name={command.kind === "skill" ? "Star" : "SquareSlash"} size={ICON_SIZE} color={colors.foregroundMuted} />
        <Text style={styles.line} numberOfLines={1}>
          /
          <Marked pieces={markedPieces(command.name, row.row.hits)} styles={styles} />
          {command.argumentHint === "" ? null : <Text style={styles.hintArgument}>{`  ${command.argumentHint}`}</Text>}
          {command.description === "" ? null : <Text style={styles.detail}>{`  ${command.description}`}</Text>}
        </Text>
      </>
    );
  }
  if (row.kind === "ticket") {
    const ticket = row.row.ticket;
    return (
      <>
        <Icon name="Ticket" size={ICON_SIZE} color={colors.foregroundMuted} />
        <Text style={styles.line} numberOfLines={1}>
          <Marked pieces={markedPieces(ticket.id, row.row.hits)} styles={styles} />
          <Text style={styles.detail}>
            {"  "}
            <Marked pieces={markedPieces(ticket.title, row.row.titleHits)} styles={styles} />
          </Text>
        </Text>
        <Tag text={ticket.status} tone={ticketStatusTone(ticket.status)} theme={theme} styles={styles} />
      </>
    );
  }
  const file = row.row;
  const parts = fileRowParts(file, browsing);
  return (
    <>
      <Icon name={file.kind === "folder" ? "Folder" : "File"} size={ICON_SIZE} color={colors.foregroundMuted} />
      <Text style={styles.line} numberOfLines={1}>
        <Marked pieces={parts.name} styles={styles} />
        {parts.folder.length === 0 ? null : (
          <Text style={styles.detail}>
            {"  "}
            <Marked pieces={parts.folder} styles={styles} />
          </Text>
        )}
      </Text>
      {file.tag === null ? null : <Tag text={file.tag} tone={file.tag === "new" ? "success" : "muted"} theme={theme} styles={styles} />}
      {file.kind === "folder" ? <Icon name="ChevronRight" size={ICON_SIZE} color={colors.foregroundMuted} /> : null}
    </>
  );
}

function pickListStyles(colors: PluginTheme["colors"], rowHeight: number) {
  return {
    layer: { position: "absolute" as const, zIndex: 20 },
    // The platform's default shadow colour: the theme has none to give it.
    box: {
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      overflow: "hidden" as const,
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    rows: { padding: LIST_PADDING },
    heading: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE.xs + SPACE.xxs,
      paddingHorizontal: SPACE.md,
      paddingTop: SPACE.sm,
      paddingBottom: SPACE.xxs,
    },
    headingText: {
      color: colors.foregroundMuted,
      fontSize: FONT_SIZE.caption,
      lineHeight: labelLineHeightFor(FONT_SIZE.caption),
      fontWeight: "600" as const,
    },
    row: {
      minHeight: rowHeight,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE.sm + SPACE.xxs,
      paddingHorizontal: SPACE.md - LIST_PADDING + SPACE.xs,
      borderRadius: 8,
    },
    rowSelected: { backgroundColor: colors.surface2 },
    line: {
      flex: 1,
      minWidth: 0,
      color: colors.foreground,
      fontSize: FONT_SIZE.body,
      lineHeight: labelLineHeightFor(FONT_SIZE.body),
    },
    marked: { color: colors.accent, fontWeight: "700" as const },
    detail: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small },
    hintArgument: {
      color: colors.foregroundMuted,
      fontSize: FONT_SIZE.caption,
      fontFamily: MONOSPACE,
    },
    tag: {
      flexShrink: 0,
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: SPACE.xs + SPACE.xxs,
      paddingVertical: 1,
    },
    tagText: {
      fontSize: FONT_SIZE.caption,
      lineHeight: labelLineHeightFor(FONT_SIZE.caption),
    },
    folderBar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE.xs,
      paddingRight: SPACE.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    back: {
      alignSelf: "stretch" as const,
      justifyContent: "center" as const,
      paddingLeft: SPACE.md,
      paddingRight: SPACE.xs,
    },
    folderPath: {
      flex: 1,
      minWidth: 0,
      color: colors.foreground,
      fontSize: FONT_SIZE.small,
      fontFamily: MONOSPACE,
    },
    folderCount: {
      flexShrink: 0,
      color: colors.foregroundMuted,
      fontSize: FONT_SIZE.caption,
    },
    message: {
      paddingHorizontal: SPACE.md,
      paddingVertical: SPACE.md,
      gap: SPACE.xxs,
    },
    messageText: {
      color: colors.foregroundMuted,
      fontSize: FONT_SIZE.small,
      lineHeight: lineHeightFor(FONT_SIZE.small),
    },
    messageDetail: {
      color: colors.foregroundMuted,
      fontSize: FONT_SIZE.caption,
      lineHeight: lineHeightFor(FONT_SIZE.caption),
      opacity: 0.8,
    },
    hints: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      alignItems: "center" as const,
      columnGap: SPACE.lg,
      rowGap: SPACE.xxs,
      paddingHorizontal: SPACE.md,
      paddingVertical: SPACE.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    hint: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: SPACE.xs,
    },
    keycap: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      paddingHorizontal: SPACE.xs,
    },
    keycapText: {
      color: colors.foregroundMuted,
      fontSize: FONT_SIZE.micro,
      lineHeight: labelLineHeightFor(FONT_SIZE.micro),
    },
    hintText: {
      color: colors.foregroundMuted,
      fontSize: FONT_SIZE.caption,
      lineHeight: labelLineHeightFor(FONT_SIZE.caption),
    },
  };
}
