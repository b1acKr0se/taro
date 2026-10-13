/**
 * A conversation with one agent — a project's manager or a task owner — folded
 * to the words, with a composer. Adapted from FirstMate's `client/chat.tsx`
 * (MIT), without attachments. The full session is one press away in Paseo.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, SafeAreaView, ScrollView, Text, View, type LayoutRectangle } from "react-native";

import { listSentImages, type SentImagesMessage } from "../shared/contracts";
import type { StoredDecision } from "../shared/state";
import { DecisionCard } from "./decision-card";
import { drafts } from "./draft";
import { useFollowEnd } from "./follow-end";
import { ImageThumbnail } from "./image-view";
import { useKeyboardOverlap } from "./keyboard";
import { isSendKey, type WebKeyPressEvent } from "./keys";
import { Markdown } from "./markdown";
import { PermissionCard, usePendingRequests } from "./permission-card";
import { matchSentImages } from "./sent-images";
import { offsetShowingRowEnd, placeDecisions, rowEndOnScreen } from "./inline-decisions";
import { groupRows, toolRunSummary, type Group } from "./tool-runs";
import { transcriptRows } from "./transcript-rows";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton, JumpToEnd, LoadingBar, MONOSPACE, Spinner, errorText } from "./ui";
import { SPACE } from "./spacing";
import { useAgentTimeline } from "./use-timeline";

const INPUT_HEIGHT = 110;
const INPUT_HEIGHT_COMPACT = 76;

export interface ChatAgent {
  id: string;
  updatedAt: string;
  pendingPermissions: number;
  status: string;
}

/** A conversation the user can write to, or one only to read (an archived agent's). */
type ChatComposer =
  | {
      placeholder: string;
      /** Sends the user's words; rejects with a sentence on failure. */
      onSend: (text: string) => Promise<void>;
      /** Buttons above the composer (Catch up, Compact, …). */
      actions?: ReactNode;
      readOnly?: undefined;
    }
  | {
      /** No composer and no buttons; a footer says why. */
      readOnly: { note: string };
      placeholder?: undefined;
      onSend?: undefined;
      actions?: undefined;
    };

export function AgentChat({
  agent,
  theme,
  compact,
  placeholder,
  onSend,
  actions,
  readOnly,
  decorateRow,
  transformText,
  asks,
}: {
  agent: ChatAgent;
  theme: PluginTheme;
  compact: boolean;
  /** Draws extra content under an agent message (decision cards). */
  decorateRow?: (text: string, key: string) => ReactNode;
  /** Rewrites an agent message before it is drawn (drops decision blocks drawn as cards). */
  transformText?: (text: string) => string;
  /**
   * This agent's open decisions (TR-026): each drawn as a card under the message that asked it and
   * answered there, the first brought into view on opening, and a jump link at the composer while it
   * is off screen. No pinned area.
   */
  asks?: { decisions: readonly StoredDecision[]; onAnswered: () => void };
} & ChatComposer) {
  const toast = useToast();
  const timeline = useAgentTimeline(agent.id, `${agent.updatedAt}:${agent.pendingPermissions}`);
  const rows = useMemo(() => transcriptRows(timeline.entries), [timeline.entries]);
  const groups = useMemo(() => groupRows(rows), [rows]);
  // The newest entry's position, not the count: the timeline is a tail and stops growing in length.
  const sentImages = useSentImages(agent.id, timeline.entries[timeline.entries.length - 1]?.seqStart ?? 0);
  const rowImages = useMemo(() => matchSentImages(rows, sentImages), [rows, sentImages]);
  const places = useMemo(
    () => (asks === undefined || asks.decisions.length === 0 ? null : placeDecisions(rows.filter((row) => row.kind === "mate"), asks.decisions)),
    [rows, asks?.decisions],
  );
  const firstKey = places?.first?.key ?? null;
  /** Where each open decision's message (or the cards at the end) lies in the transcript, by decision key. */
  const decisionLayouts = useRef(new Map<string, LayoutRectangle>());
  const [firstOnScreen, setFirstOnScreen] = useState(true);
  const follow = useFollowEnd((offset, viewportHeight) => {
    const layout = firstKey === null ? undefined : decisionLayouts.current.get(firstKey);
    setFirstOnScreen(layout === undefined || rowEndOnScreen(layout.y, layout.height, offset, viewportHeight));
  });

  /** Brings the first open decision into view once, and says whether the jump link is needed. */
  function placeFirst(): void {
    const layout = firstKey === null ? undefined : decisionLayouts.current.get(firstKey);
    if (firstKey === null || layout === undefined) return;
    follow.revealRow(firstKey, layout, offsetShowingRowEnd);
    setFirstOnScreen(rowEndOnScreen(layout.y, layout.height, follow.offset.current, follow.viewport.current));
  }

  function noteLayout(decisions: readonly StoredDecision[], layout: LayoutRectangle): void {
    decisions.forEach((decision) => decisionLayouts.current.set(decision.key, layout));
    placeFirst();
  }

  // Answering the first makes another first, whose row may not lay out again.
  useEffect(placeFirst, [firstKey]);

  function jumpToFirst(): void {
    const layout = firstKey === null ? undefined : decisionLayouts.current.get(firstKey);
    if (layout !== undefined) follow.scrollTo(offsetShowingRowEnd(layout.y, layout.height, follow.viewport.current));
  }

  function decisionCards(decisions: readonly StoredDecision[]) {
    return decisions.map((decision) => (
      <DecisionCard key={decision.key} decision={decision} theme={theme} compact={compact} onAnswered={asks?.onAnswered ?? (() => undefined)} />
    ));
  }
  const { pending, respond } = usePendingRequests(agent.id, timeline.agent?.pendingPermissions, follow.pin);
  const [draft, setDraftState] = useState(() => drafts.get(agent.id));
  const [sending, setSending] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const pane = useRef<View>(null);
  const keyboard = useKeyboardOverlap(pane);

  useEffect(() => {
    const reread = () => setDraftState(drafts.get(agent.id));
    const stop = drafts.subscribe(reread);
    reread();
    return stop;
  }, [agent.id]);
  useEffect(() => {
    if (keyboard > 0) follow.keepAtEnd();
  }, [keyboard]);

  const submitOnEnter = Platform.OS === "web" && !compact;

  function setDraft(text: string): void {
    drafts.set(agent.id, text);
    setDraftState(text);
  }

  function sendDraft(): void {
    const text = draft.trim();
    if (onSend === undefined || text === "" || sending) return;
    setSending(true);
    follow.pin();
    setDraft("");
    onSend(text)
      .catch((caught: unknown) => {
        toast.error(errorText(caught));
        if (drafts.get(agent.id).trim() === "") drafts.set(agent.id, text);
      })
      .finally(() => setSending(false));
  }

  function openLink(url: string): void {
    void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
  }

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      pane: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
      transcript: { flex: 1 },
      // Room between turns, so a reply, a tool run and the next message read as separate things.
      transcriptBody: { padding: compact ? SPACE.md : SPACE.lg, gap: compact ? SPACE.md : SPACE.lg },
      user: {
        alignSelf: "flex-end" as const,
        maxWidth: "88%" as const,
        backgroundColor: colors.surface2,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        paddingHorizontal: SPACE.md,
        paddingVertical: SPACE.sm + 2,
      },
      userImages: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.sm, marginTop: SPACE.sm },
      userText: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) },
      agentRow: { alignSelf: "stretch" as const, gap: SPACE.sm },
      line: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm - 2 },
      // A run of tool calls is the agent working, not talking: one quiet line until the reader opens it.
      toolRun: { alignSelf: "flex-start" as const, maxWidth: "100%" as const, gap: SPACE.xs },
      toolHead: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.sm - 2,
        paddingHorizontal: SPACE.sm,
        paddingVertical: SPACE.xs,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
      },
      toolList: { gap: SPACE.xs, marginLeft: SPACE.md, paddingLeft: SPACE.sm, borderLeftWidth: 1, borderLeftColor: colors.border },
      toolLatest: { flexShrink: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontFamily: MONOSPACE },
      lineText: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      toolText: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontFamily: MONOSPACE },
      toolTitle: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      error: { color: colors.statusDanger, fontSize: FONT_SIZE.small },
      hint: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, textAlign: "center" as const, padding: SPACE.lg },
      composerFrame: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface0 },
      composer: { padding: SPACE.md, gap: SPACE.sm },
      quick: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.sm, alignItems: "center" as const },
      inputRow: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: SPACE.sm },
      input: {
        flex: 1,
        color: colors.foreground,
        fontSize: FONT_SIZE.content,
        lineHeight: lineHeightFor(FONT_SIZE.content),
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        height: compact ? INPUT_HEIGHT_COMPACT : INPUT_HEIGHT,
        paddingHorizontal: SPACE.md,
        paddingVertical: SPACE.sm + 2,
        backgroundColor: colors.surface1,
        textAlignVertical: "top" as const,
      },
      readOnly: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.sm,
        paddingHorizontal: compact ? SPACE.md : SPACE.lg,
        paddingVertical: SPACE.md,
        backgroundColor: colors.surface1,
      },
      readOnlyText: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
    };
  }, [theme, compact]);

  function renderGroup(group: Group) {
    if ("tools" in group) {
      const open = openGroups.has(group.key);
      const summary = toolRunSummary(group.tools);
      const lone = group.tools.length === 1;
      const toggle = () =>
        setOpenGroups((current) => {
          const next = new Set(current);
          if (open) next.delete(group.key);
          else next.add(group.key);
          return next;
        });
      return (
        <View key={group.key} style={styles.toolRun}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={lone ? summary.title : `${summary.title}, ${open ? "fold" : "show"}`}
            disabled={lone}
            style={[styles.toolHead, summary.state === "failed" ? { borderColor: theme.colors.statusDanger } : null]}
            onPress={toggle}
          >
            {summary.state === "running" ? (
              <Spinner size={11} color={theme.colors.foregroundMuted} />
            ) : (
              <Icon name={summary.state === "failed" ? "X" : "Wrench"} size={11} color={summary.state === "failed" ? theme.colors.statusDanger : theme.colors.foregroundMuted} />
            )}
            <Text style={lone ? styles.toolLatest : styles.toolTitle} numberOfLines={1}>
              {summary.title}
              {summary.failed > 0 && !lone ? ` · ${summary.failed} failed` : ""}
            </Text>
            {summary.latest === null || open ? null : (
              <Text style={styles.toolLatest} numberOfLines={1}>
                {summary.latest}
              </Text>
            )}
            {lone ? null : <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={theme.colors.foregroundMuted} />}
          </Pressable>
          {open && !lone ? (
            <View style={styles.toolList}>
              {group.tools.map((tool) => (
                <View key={tool.key} style={styles.line}>
                  {tool.status === "running" ? (
                    <Spinner size={11} color={theme.colors.foregroundMuted} />
                  ) : (
                    <Icon name={tool.status === "failed" ? "X" : "Dot"} size={11} color={tool.status === "failed" ? theme.colors.statusDanger : theme.colors.foregroundMuted} />
                  )}
                  <Text style={styles.toolText} numberOfLines={1}>
                    {tool.text}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      );
    }
    const row = group.row;
    switch (row.kind) {
      case "captain": {
        const images = rowImages.get(row.key);
        return (
          <View key={row.key} style={styles.user}>
            <Text selectable style={styles.userText}>
              {row.text}
            </Text>
            {images === undefined ? null : (
              <View style={styles.userImages}>
                {images.map((image, index) => (
                  <ImageThumbnail key={index} source={image.path} alt="Sent image" theme={theme} />
                ))}
              </View>
            )}
          </View>
        );
      }
      case "mate": {
        const asked = places?.byRow.get(row.key) ?? [];
        return (
          <View key={row.key} style={styles.agentRow} onLayout={asked.length === 0 ? undefined : (event) => noteLayout(asked, event.nativeEvent.layout)}>
            <Markdown source={transformText === undefined ? row.text : transformText(row.text)} theme={theme} onOpenLink={openLink} />
            {decorateRow === undefined ? null : decorateRow(row.text, row.key)}
            {decisionCards(asked)}
          </View>
        );
      }
      case "error":
        return (
          <Text key={row.key} style={styles.error}>
            {row.text}
          </Text>
        );
      default:
        return (
          <View key={row.key} style={styles.line}>
            <Icon name="Bell" size={11} color={theme.colors.foregroundMuted} />
            <Text style={styles.lineText}>{row.text}</Text>
          </View>
        );
    }
  }

  return (
    <View ref={pane} style={[styles.pane, { paddingBottom: keyboard }]}>
      {/* Re-reading behind the conversation already drawn (cached, or the last agent's read). */}
      <LoadingBar theme={theme} active={timeline.loading && groups.length > 0} />
      <View style={styles.transcript}>
        <ScrollView {...follow.scrollProps} style={styles.transcript} contentContainerStyle={styles.transcriptBody}>
          {timeline.error === null ? null : <Text style={styles.error}>{timeline.error}</Text>}
          {groups.length === 0 && pending.length === 0 ? (
            <Text style={styles.hint}>{timeline.loading ? "Loading the conversation…" : "Nothing said yet."}</Text>
          ) : (
            groups.map(renderGroup)
          )}
          {places === null || places.unplaced.length === 0 ? null : (
            <View style={styles.agentRow} onLayout={(event) => noteLayout(places.unplaced, event.nativeEvent.layout)}>
              {decisionCards(places.unplaced)}
            </View>
          )}
          {pending.map((request) => (
            <View key={request.id} onLayout={(event) => follow.reveal(request.id, event.nativeEvent.layout)}>
              <PermissionCard request={request} theme={theme} compact={compact} onRespond={(response) => respond(request.id, response)} onOpenLink={openLink} />
            </View>
          ))}
        </ScrollView>
        {follow.away ? <JumpToEnd theme={theme} onPress={follow.jumpToEnd} /> : null}
      </View>
      <SafeAreaView style={styles.composerFrame}>
        {readOnly !== undefined ? (
          <View style={styles.readOnly}>
            <Icon name="Archive" size={14} color={theme.colors.foregroundMuted} />
            <Text style={styles.readOnlyText}>{readOnly.note}</Text>
          </View>
        ) : (
          <View style={styles.composer}>
            {places?.first === null || places === null || firstOnScreen ? null : (
              <Pressable accessibilityRole="button" accessibilityLabel={`Show the question: ${places.first.question}`} style={styles.quick} onPress={jumpToFirst}>
                <Icon name="Hand" size={13} color={places.first.blocking ? theme.colors.statusWarning : theme.colors.foregroundMuted} />
                <Text style={[styles.lineText, { color: theme.colors.foreground }]} numberOfLines={1}>
                  {places.first.question}
                </Text>
                <Text style={{ color: theme.colors.accent, fontSize: FONT_SIZE.caption, fontWeight: "600" }}>Show</Text>
              </Pressable>
            )}
            {actions === undefined ? null : <View style={styles.quick}>{actions}</View>}
            <View style={styles.inputRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={submitOnEnter ? `${placeholder} (Enter sends, Shift+Enter for a new line)` : placeholder}
                placeholderTextColor={theme.colors.foregroundMuted}
                multiline
                onKeyPress={
                  submitOnEnter
                    ? (event: WebKeyPressEvent) => {
                        if (!isSendKey(event.nativeEvent) || sending || draft.trim() === "") return;
                        event.preventDefault();
                        sendDraft();
                      }
                    : undefined
                }
                style={styles.input}
              />
              <IconButton icon="Send" label="Send" tone="accent" theme={theme} disabled={sending || draft.trim() === ""} onPress={sendDraft} />
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

/** The images the captain sent this agent, re-read whenever the conversation grows. */
function useSentImages(agentId: string, newestEntry: number) {
  const list = useRpc(listSentImages);
  const query = useQuery({
    queryKey: ["taro", "sent-images", agentId, newestEntry] as const,
    queryFn: () => list({ agentId }),
    placeholderData: (previous) => previous,
  });
  return query.data?.messages ?? EMPTY_SENT;
}

const EMPTY_SENT: readonly SentImagesMessage[] = [];
