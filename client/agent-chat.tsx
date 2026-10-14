/**
 * A conversation with one agent — a project's manager or a task owner — folded
 * to the words, with a composer that also sends images and files (TR-036). Adapted from
 * FirstMate's `client/chat.tsx` (MIT). The full session is one press away in Paseo.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, Pressable, SafeAreaView, ScrollView, Text, useWindowDimensions, View, type LayoutRectangle, type TextInput as NativeTextInput } from "react-native";

import { attachmentProblem, outgoingAttachments, refuseOversizedImages, type DraftAttachment, type OutgoingFile, type OutgoingImage } from "../shared/attachments";
import { listSentImages, type SentImagesMessage } from "../shared/contracts";
import { imagesFromPaste, pickAttachments } from "./attachment-pickers";
import { availableSources, type AttachmentSource } from "./attachment-sources";
import { AttachButton, AttachmentPreviews } from "./composer-attachments";
import type { StoredDecision } from "../shared/state";
import { ContextMeter } from "./context-meter";
import { DecisionCard } from "./decision-card";
import { drafts } from "./draft";
import { draftAttachments } from "./draft-attachments";
import { useFollowEnd } from "./follow-end";
import { ImageThumbnail } from "./image-view";
import { KeyboardRevealProvider, useKeyboardOverlap, useKeyboardScroll, useRevealFocused } from "./keyboard";
import { isSendKey, type WebKeyPressEvent } from "./keys";
import { Markdown } from "./markdown";
import { PermissionCard, usePendingRequests } from "./permission-card";
import { matchSentImages } from "./sent-images";
import { cardOnScreen, deliveryRowKey, offsetShowingCard, placeDecisions } from "./inline-decisions";
import { groupRows, toolRunSummary, type Group } from "./tool-runs";
import { transcriptRows } from "./transcript-rows";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { JumpToEnd, LoadingBar, MONOSPACE, Spinner, errorText } from "./ui";
import { COMPOSER_CONTROL_SIZE, COMPOSER_FONT_SIZE, COMPOSER_WEB_LINE_HEIGHT, composerMaxHeight, composerMetrics } from "./composer-height";
import { useComposerHeight } from "./composer-input-height";
import { CHAT_MAX_WIDTH, paneGutter, SPACE } from "./spacing";
import { useAgentTimeline } from "./use-timeline";

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
      /** Sends the user's words and attachments (the words may be empty when there are some); rejects with a sentence on failure. */
      onSend: (text: string, attachments: { images: OutgoingImage[]; files: OutgoingFile[] }) => Promise<void>;
      /** Buttons above the composer (Catch up, Compact, …). */
      actions?: ReactNode;
      /** The agent's context window, drawn as a ring inside the composer beside the send button. */
      context?: { used: number | null | undefined; max: number | null | undefined };
      readOnly?: undefined;
    }
  | {
      /** No composer and no buttons; a footer says why. */
      readOnly: { note: string };
      placeholder?: undefined;
      onSend?: undefined;
      actions?: undefined;
      context?: undefined;
    };

export function AgentChat({
  agent,
  theme,
  compact,
  placeholder,
  onSend,
  actions,
  context,
  readOnly,
  decorateRow,
  transformText,
  asks,
  delivery,
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
  /**
   * A delivered ticket's acceptance card (TR-026), drawn under the message where the owner presented
   * it and handled like a question: brought into view on opening when nothing is asked, and `label`
   * as a jump link at the composer while it is off screen. `ready`: Accept is offered.
   */
  delivery?: { card: ReactNode; label: string; ready: boolean } | undefined;
} & ChatComposer) {
  const toast = useToast();
  const timeline = useAgentTimeline(agent.id, `${agent.updatedAt}:${agent.pendingPermissions}`);
  const rows = useMemo(() => transcriptRows(timeline.entries), [timeline.entries]);
  const groups = useMemo(() => groupRows(rows), [rows]);
  // The newest entry's position, not the count: the timeline is a tail and stops growing in length.
  const sentImages = useSentImages(agent.id, timeline.entries[timeline.entries.length - 1]?.seqStart ?? 0);
  const rowImages = useMemo(() => matchSentImages(rows, sentImages), [rows, sentImages]);
  const mateRows = useMemo(() => rows.filter((row) => row.kind === "mate"), [rows]);
  const places = useMemo(() => (asks === undefined || asks.decisions.length === 0 ? null : placeDecisions(mateRows, asks.decisions)), [mateRows, asks?.decisions]);
  const deliveryKey = useMemo(() => (delivery === undefined ? null : deliveryRowKey(mateRows)), [mateRows, delivery === undefined]);
  /** The acceptance card's place in the layouts, beside the decisions' keys. */
  const deliveryTarget = `delivery:${agent.id}`;
  /** What is brought into view and jumped to: the first open question, else the acceptance card. */
  const firstKey = places?.first?.key ?? (delivery === undefined ? null : deliveryTarget);
  /** Where each card lies in the transcript, by decision key (or the acceptance card's). */
  const cardLayouts = useRef(new Map<string, LayoutRectangle>());
  /** A message row's place in the transcript, and its cards' place in the row, by row key. */
  const rowLayouts = useRef(new Map<string, LayoutRectangle>());
  const rowCardLayouts = useRef(new Map<string, LayoutRectangle>());
  const [firstOnScreen, setFirstOnScreen] = useState(true);
  /**
   * The card brought into view when this agent's pane opened. Only it is scrolled to: a question
   * asked later, or the next after an answer, gets the jump link and leaves the reader where they are.
   */
  const openingCard = useRef<{ agentId: string; key: string } | null>(null);
  const follow = useFollowEnd((offset, viewportHeight) => {
    const layout = firstKey === null ? undefined : cardLayouts.current.get(firstKey);
    setFirstOnScreen(layout === undefined || cardOnScreen(layout.y, layout.height, offset, viewportHeight));
  });

  /** Brings the first open decision into view on opening, and says whether the jump link is needed. */
  function placeFirst(): void {
    const layout = firstKey === null ? undefined : cardLayouts.current.get(firstKey);
    if (firstKey === null || layout === undefined) return;
    if (openingCard.current?.agentId !== agent.id) openingCard.current = { agentId: agent.id, key: firstKey };
    if (openingCard.current.key === firstKey) follow.revealRow(firstKey, layout, offsetShowingCard);
    setFirstOnScreen(cardOnScreen(layout.y, layout.height, follow.offset.current, follow.viewport.current));
  }

  function noteLayout(keys: readonly string[], layout: LayoutRectangle): void {
    keys.forEach((key) => cardLayouts.current.set(key, layout));
    placeFirst();
  }

  /** Cards under a message: placed by the row (which moves as rows above lay out) plus their place in it. */
  function noteRowLayout(rowKey: string, keys: readonly string[], part: "row" | "cards", layout: LayoutRectangle): void {
    (part === "row" ? rowLayouts : rowCardLayouts).current.set(rowKey, layout);
    const row = rowLayouts.current.get(rowKey);
    const cards = rowCardLayouts.current.get(rowKey);
    if (row !== undefined && cards !== undefined) noteLayout(keys, { x: row.x + cards.x, y: row.y + cards.y, width: cards.width, height: cards.height });
  }

  // Answering the first makes another first, whose row may not lay out again: the jump link needs to know.
  useEffect(placeFirst, [firstKey]);

  function jumpToFirst(): void {
    const layout = firstKey === null ? undefined : cardLayouts.current.get(firstKey);
    if (layout !== undefined) follow.scrollTo(offsetShowingCard(layout.y, layout.height, follow.viewport.current));
  }

  function decisionCards(decisions: readonly StoredDecision[]) {
    return decisions.map((decision) => (
      <DecisionCard key={decision.key} decision={decision} theme={theme} compact={compact} onAnswered={asks?.onAnswered ?? (() => undefined)} />
    ));
  }
  const { pending, respond } = usePendingRequests(agent.id, timeline.agent?.pendingPermissions, follow.pin);
  const [draft, setDraftState] = useState(() => drafts.get(agent.id));
  const [attachments, setAttachmentsState] = useState(() => draftAttachments.get(agent.id));
  const field = useRef<NativeTextInput>(null);
  const [sending, setSending] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const pane = useRef<View>(null);
  const keyboard = useKeyboardOverlap(pane);
  // The pane pads itself clear of the keyboard, so the transcript only scrolls a field inside it
  // (a decision's or a permission's text) into view; its room measures zero once the pane is padded.
  const keyboardScroll = useKeyboardScroll(follow.scrollProps.ref);
  // Outside the transcript's provider: the composer's focus is no scroll area's, which tells the transcript so.
  const releaseKeyboardClaim = useRevealFocused();

  useEffect(() => {
    const reread = () => setDraftState(drafts.get(agent.id));
    const stop = drafts.subscribe(reread);
    reread();
    return stop;
  }, [agent.id]);
  useEffect(() => {
    const reread = () => setAttachmentsState(draftAttachments.get(agent.id));
    const stop = draftAttachments.subscribe(reread);
    reread();
    return stop;
  }, [agent.id]);
  // A browser pastes an image into the field as Paseo's composer takes it: as an attachment. On the web the field is the DOM's textarea.
  useEffect(() => {
    const node = field.current as unknown as { addEventListener?: (type: string, listener: (event: WebPasteEvent) => void) => void; removeEventListener?: (type: string, listener: (event: WebPasteEvent) => void) => void } | null;
    if (Platform.OS !== "web" || node === null || typeof node.addEventListener !== "function") return;
    const onPaste = (event: WebPasteEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.some((file) => file.type.startsWith("image/"))) return;
      event.preventDefault();
      imagesFromPaste(globalThis, event.clipboardData)
        .then(addAttachments)
        .catch((caught: unknown) => toast.error(errorText(caught)));
    };
    node.addEventListener("paste", onPaste);
    return () => node.removeEventListener?.("paste", onPaste);
  }, [agent.id, readOnly === undefined]);
  useEffect(() => {
    if (keyboard > 0) follow.keepAtEnd();
  }, [keyboard]);

  const submitOnEnter = Platform.OS === "web" && !compact;
  const windowSize = useWindowDimensions();
  const metrics = composerMetrics(Platform.OS === "web", windowSize.width);
  const fieldHeight = useComposerHeight({ text: draft, field, minHeight: metrics.minHeight, maxHeight: composerMaxHeight(windowSize.height) });
  const nothingToSend = sending || (draft.trim() === "" && attachments.length === 0);

  function setDraft(text: string): void {
    drafts.set(agent.id, text);
    setDraftState(text);
  }

  function setAttachments(next: readonly DraftAttachment[]): void {
    draftAttachments.set(agent.id, next);
    setAttachmentsState(next);
  }

  /** Adds to what is attached, but no image too large for the agent, and nothing when together they are too many or too large to send. */
  function addAttachments(added: readonly DraftAttachment[]): void {
    const { fitting, problem: oversized } = refuseOversizedImages(added);
    if (oversized !== null) toast.error(oversized);
    if (fitting.length === 0) return;
    const next = [...draftAttachments.get(agent.id), ...fitting];
    const problem = attachmentProblem(next);
    if (problem !== null) toast.error(problem);
    else setAttachments(next);
  }

  function pick(source: AttachmentSource): void {
    pickAttachments(globalThis, Platform.OS, source)
      .then(addAttachments)
      .catch((caught: unknown) => toast.error(errorText(caught)));
  }

  function sendDraft(): void {
    const text = draft.trim();
    const sent = attachments;
    if (onSend === undefined || (text === "" && sent.length === 0) || sending) return;
    setSending(true);
    follow.pin();
    setDraft("");
    setAttachments([]);
    onSend(text, outgoingAttachments(sent))
      .catch((caught: unknown) => {
        toast.error(errorText(caught));
        // Put back only into an empty composer: whatever was written or attached since stays.
        if (drafts.get(agent.id).trim() === "") drafts.set(agent.id, text);
        if (draftAttachments.get(agent.id).length === 0) draftAttachments.set(agent.id, sent);
      })
      .finally(() => setSending(false));
  }

  const attachButton = (
    <AttachButton
      theme={theme}
      compact={compact}
      iconSize={metrics.iconSize}
      disabled={sending}
      sources={() => availableSources(globalThis, Platform.OS)}
      onBeforeOpen={compact ? Keyboard.dismiss : undefined}
      onPick={pick}
    />
  );

  function openLink(url: string): void {
    void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
  }

  const styles = useMemo(() => {
    const { colors } = theme;
    return {
      pane: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
      transcript: { flex: 1 },
      // Room between turns, so a reply, a tool run and the next message read as separate things.
      // Centred at a reading width in a wide pane (TR-027); the scroll bar stays at the pane's edge.
      transcriptBody: {
        width: "100%" as const,
        maxWidth: CHAT_MAX_WIDTH,
        alignSelf: "center" as const,
        paddingVertical: compact ? SPACE.md : SPACE.lg,
        paddingHorizontal: paneGutter(compact),
        gap: compact ? SPACE.md : SPACE.lg,
      },
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
      // The transcript's side padding, so the box lines up with the messages above it.
      composer: {
        width: "100%" as const,
        maxWidth: CHAT_MAX_WIDTH,
        alignSelf: "center" as const,
        paddingHorizontal: paneGutter(compact),
        paddingVertical: SPACE.md,
        gap: SPACE.sm,
      },
      quick: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.sm, alignItems: "center" as const },
      // Paseo's composer box (TR-039): attachments, then the text across the full width, then a row
      // of controls: the + at the left, the context ring and the send button at the right. Its border
      // stays plain while typing, as Paseo's does.
      inputBox: {
        flexShrink: 1,
        flexDirection: "column" as const,
        gap: SPACE.md,
        backgroundColor: colors.surface1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        paddingTop: metrics.paddingTop,
        paddingBottom: metrics.paddingBottom,
        paddingHorizontal: metrics.paddingHorizontal,
      },
      input: {
        flexShrink: 1,
        width: "100%" as const,
        color: colors.foreground,
        fontSize: COMPOSER_FONT_SIZE,
        textAlignVertical: "top" as const,
        // No line height on a phone, as in Paseo: React Native draws one as a span over the text, and
        // an empty last line takes the font's own, so the field jumped when a new line began.
        // The box shows nothing for focus, and a browser's outline would cut it in two.
        ...(Platform.OS === "web" ? { lineHeight: COMPOSER_WEB_LINE_HEIGHT, outlineWidth: 0 } : null),
      },
      // The row reaches 6 px into the box's padding, so the round buttons sit in its corners.
      controls: {
        flexShrink: 0,
        flexDirection: "row" as const,
        alignItems: "flex-end" as const,
        justifyContent: "space-between" as const,
        marginHorizontal: -6,
      },
      controlsEnd: { flexShrink: 0, flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.xs },
      // A filled circle, the size of the + and the ring's slot.
      send: {
        width: COMPOSER_CONTROL_SIZE,
        height: COMPOSER_CONTROL_SIZE,
        borderRadius: COMPOSER_CONTROL_SIZE / 2,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: colors.accent,
        marginLeft: SPACE.xs,
      },
      readOnly: {
        width: "100%" as const,
        maxWidth: CHAT_MAX_WIDTH,
        alignSelf: "center" as const,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.sm,
        paddingHorizontal: paneGutter(compact),
        paddingVertical: SPACE.md,
      },
      // The band spans the pane; only its note is held to the reading width.
      readOnlyBand: { backgroundColor: colors.surface1 },
      readOnlyText: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
    };
  }, [theme, compact, metrics.paddingTop, metrics.paddingBottom, metrics.paddingHorizontal]);

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
                  <ImageThumbnail
                    key={index}
                    source={image.path}
                    alt="Sent image"
                    theme={theme}
                    set={images.map((each) => ({ source: each.path, alt: "Sent image" }))}
                    index={index}
                  />
                ))}
              </View>
            )}
          </View>
        );
      }
      case "mate": {
        const asked = places?.byRow.get(row.key) ?? [];
        const presented = delivery !== undefined && row.key === deliveryKey;
        const targets = [...asked.map((decision) => decision.key), ...(presented ? [deliveryTarget] : [])];
        return (
          <View key={row.key} style={styles.agentRow} onLayout={targets.length === 0 ? undefined : (event) => noteRowLayout(row.key, targets, "row", event.nativeEvent.layout)}>
            <Markdown source={transformText === undefined ? row.text : transformText(row.text)} theme={theme} onOpenLink={openLink} />
            {decorateRow === undefined ? null : decorateRow(row.text, row.key)}
            {targets.length === 0 ? null : (
              <View style={styles.agentRow} onLayout={(event) => noteRowLayout(row.key, targets, "cards", event.nativeEvent.layout)}>
                {decisionCards(asked)}
                {presented ? delivery.card : null}
              </View>
            )}
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
        <ScrollView
          {...follow.scrollProps}
          onScroll={(event) => {
            follow.scrollProps.onScroll(event);
            keyboardScroll.onScroll(event);
          }}
          onContentSizeChange={(width, height) => {
            follow.scrollProps.onContentSizeChange(width, height);
            keyboardScroll.onContentSizeChange();
          }}
          onLayout={(event) => {
            follow.scrollProps.onLayout(event);
            keyboardScroll.onLayout();
          }}
          style={styles.transcript}
          contentContainerStyle={styles.transcriptBody}
        >
          <KeyboardRevealProvider value={keyboardScroll.claim}>
            {timeline.error === null ? null : <Text style={styles.error}>{timeline.error}</Text>}
            {groups.length === 0 && pending.length === 0 ? (
              <Text style={styles.hint}>{timeline.loading ? "Loading the conversation…" : "Nothing said yet."}</Text>
            ) : (
              groups.map(renderGroup)
            )}
            {places === null || places.unplaced.length === 0 ? null : (
              <View style={styles.agentRow} onLayout={(event) => noteLayout(places.unplaced.map((decision) => decision.key), event.nativeEvent.layout)}>
                {decisionCards(places.unplaced)}
              </View>
            )}
            {/* The message that presented the delivery is older than the loaded timeline. */}
            {delivery === undefined || deliveryKey !== null ? null : (
              <View style={styles.agentRow} onLayout={(event) => noteLayout([deliveryTarget], event.nativeEvent.layout)}>
                {delivery.card}
              </View>
            )}
            {pending.map((request) => (
              <View key={request.id} onLayout={(event) => follow.reveal(request.id, event.nativeEvent.layout)}>
                <PermissionCard request={request} theme={theme} compact={compact} onRespond={(response) => respond(request.id, response)} onOpenLink={openLink} />
              </View>
            ))}
          </KeyboardRevealProvider>
          {keyboardScroll.room > 0 ? <View style={{ height: keyboardScroll.room }} /> : null}
        </ScrollView>
        {follow.away ? <JumpToEnd theme={theme} onPress={follow.jumpToEnd} /> : null}
      </View>
      <SafeAreaView style={styles.composerFrame}>
        {readOnly !== undefined ? (
          <View style={styles.readOnlyBand}>
            <View style={styles.readOnly}>
              <Icon name="Archive" size={14} color={theme.colors.foregroundMuted} />
              <Text style={styles.readOnlyText}>{readOnly.note}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.composer}>
            {firstOnScreen || places !== null || delivery === undefined ? null : (
              <Pressable accessibilityRole="button" accessibilityLabel={`Show: ${delivery.label}`} style={styles.quick} onPress={jumpToFirst}>
                <Icon name={delivery.ready ? "PackageCheck" : "PackageX"} size={13} color={delivery.ready ? theme.colors.accent : theme.colors.statusWarning} />
                <Text style={[styles.lineText, { color: theme.colors.foreground }]} numberOfLines={1}>
                  {delivery.label}
                </Text>
                <Text style={{ color: theme.colors.accent, fontSize: FONT_SIZE.caption, fontWeight: "600" }}>Show</Text>
              </Pressable>
            )}
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
            <View style={styles.inputBox}>
              <AttachmentPreviews theme={theme} attachments={attachments} onRemove={(id) => setAttachments(attachments.filter((attachment) => attachment.id !== id))} />
              <TextInput
                ref={field}
                value={draft}
                onChangeText={setDraft}
                onFocus={releaseKeyboardClaim}
                placeholder={submitOnEnter ? `${placeholder} (Enter sends, Shift+Enter for a new line)` : placeholder}
                placeholderTextColor={theme.colors.foregroundMuted}
                multiline
                scrollEnabled={fieldHeight.scrollEnabled}
                onKeyPress={
                  submitOnEnter
                    ? (event: WebKeyPressEvent) => {
                        if (!isSendKey(event.nativeEvent) || nothingToSend) return;
                        event.preventDefault();
                        sendDraft();
                      }
                    : undefined
                }
                style={[styles.input, fieldHeight.style]}
              />
              <View style={styles.controls}>
                {attachButton}
                <View style={styles.controlsEnd}>
                  {context === undefined ? null : <ContextMeter theme={theme} used={context.used} max={context.max} ringSize={metrics.ringSize} />}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send"
                    accessibilityState={{ disabled: nothingToSend }}
                    disabled={nothingToSend}
                    style={[styles.send, { opacity: nothingToSend ? 0.5 : 1 }]}
                    onPress={sendDraft}
                  >
                    <Icon name="ArrowUp" size={metrics.iconSize} color={theme.colors.accentForeground} />
                  </Pressable>
                </View>
              </View>
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

/** The part of a browser's paste event the composer reads. */
interface WebPasteEvent {
  clipboardData: { files: ArrayLike<{ type: string }> } | null;
  preventDefault(): void;
}
