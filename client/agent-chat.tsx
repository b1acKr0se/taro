/**
 * A conversation with one agent — a project's manager or a task owner — folded
 * to the words, with a composer that also sends images and files (TR-036). Adapted from
 * FirstMate's `client/chat.tsx` (MIT). The full session is one press away in Paseo.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, SafeAreaView, ScrollView, Text, useWindowDimensions, View, type LayoutRectangle, type TextInput as NativeTextInput } from "react-native";

import { attachmentProblem, refuseOversizedImages, type DraftAttachment } from "../shared/attachments";
import { listSentImages, type SentImagesMessage } from "../shared/contracts";
import { ActionRow } from "./action-row";
import { imagesFromPaste, pickAttachments } from "./attachment-pickers";
import { availableSources, type AttachmentSource } from "./attachment-sources";
import { AttachButton, AttachmentPreviews } from "./composer-attachments";
import type { StoredDecision } from "../shared/state";
import { ContextMeter } from "./context-meter";
import { useOnPaneHidden } from "./pane-visibility";
import { DecisionCard } from "./decision-card";
import { drafts } from "./draft";
import { draftAttachments } from "./draft-attachments";
import { Pressable } from "./focus";
import { useFollowEnd } from "./follow-end";
import { ImageThumbnail } from "./image-view";
import { KeyboardRevealProvider, useKeyboardOverlap, useKeyboardScroll, useRevealFocused } from "./keyboard";
import { Markdown } from "./markdown";
import { PermissionCard, usePendingRequests } from "./permission-card";
import { ReplyBox } from "./reply-box";
import type { Asker } from "./permission-heading";
import { matchSentImages } from "./sent-images";
import { cardFits, cardOnScreen, offsetShowingCard, placeDecisions } from "./inline-decisions";
import { groupRows, toolRunSummary, type Group } from "./tool-runs";
import { ATTACHMENTS_ONLY, transcriptRows } from "./transcript-rows";
import { FONT_SIZE, labelLineHeightFor, lineHeightFor } from "./type-scale";
import { IconButton, JumpToEnd, LoadingBar, MONOSPACE, Spinner, errorText } from "./ui";
import { usePressGuards } from "./use-actions";
import { usePendingSends, type ChatSend } from "./use-pending-sends";
import { handBack, steersMidTurn, type PendingSend, type SendMark, type SendView } from "../shared/pending-sends";
import { composerMetrics } from "./composer-height";
import { CHAT_MAX_WIDTH, paneGutter, SPACE } from "./spacing";
import { useAgentTimeline } from "./use-timeline";
import { useLatestCallback } from "./latest-callback";
import { sameGroup, sameItems } from "./transcript-memo";
import type { SentImage } from "./sent-images";

export interface ChatAgent {
  id: string;
  updatedAt: string;
  pendingPermissions: number;
  status: string;
  /** From the server, which reads Paseo's provider config (TR-084); else judged from the provider id. */
  steers?: boolean | undefined;
}

/** A conversation the user can write to, or one only to read (an archived agent's). */
type ChatComposer =
  | {
      placeholder: string;
      /**
       * Sends the user's words and attachments (the words may be empty when there are some) under the chat's
       * own message id (TR-084); rejects with a sentence on failure.
       */
      onSend: ChatSend;
      /** Buttons above the composer (Catch up, Compact, …), first in one sideways-scrolling line with the suggestions. */
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
  asker,
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
  suggestions,
}: {
  agent: ChatAgent;
  /** Who this agent is to the user, named on its permission and question cards. */
  asker: Asker;
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
   * A delivered ticket's acceptance card (TR-026), handled like a question: brought into view on
   * opening when nothing is asked, and `label` as a jump link at the composer while it is off screen.
   * Drawn at the transcript's end (TR-091), so what is said after the delivery never buries it.
   * `ready`: Accept is offered.
   */
  delivery?: { card: ReactNode; label: string; ready: boolean } | undefined;
  /** Things to send (the Manager's suggestions, TR-045), after the buttons in their sideways-scrolling line. */
  suggestions?: ReactNode;
} & ChatComposer) {
  const toast = useToast();
  const timeline = useAgentTimeline(agent.id, `${agent.updatedAt}:${agent.pendingPermissions}`);
  const rows = useMemo(() => transcriptRows(timeline.entries), [timeline.entries]);
  const groups = useMemo(() => groupRows(rows), [rows]);
  // The newest entry's position, not the count: the timeline is a tail and stops growing in length.
  const sentImages = useSentImages(agent.id, timeline.entries[timeline.entries.length - 1]?.seqStart ?? 0);
  const rowImages = useMemo(() => matchSentImages(rows, sentImages), [rows, sentImages]);
  const agentRows = useMemo(() => rows.filter((row) => row.kind === "agent"), [rows]);
  // The timeline's read of the agent when it is newer than the board's: it follows the stream.
  const live = timeline.agent !== null && timeline.agent.updatedAt >= agent.updatedAt ? timeline.agent : null;
  function putBack(send: PendingSend): void {
    const back = handBack({ text: drafts.get(agent.id), attachments: draftAttachments.get(agent.id) }, send);
    if (back.text !== null) drafts.set(agent.id, back.text);
    if (back.attachments !== null) draftAttachments.set(agent.id, back.attachments);
  }
  const sends = usePendingSends({
    agentId: agent.id,
    status: live?.status ?? agent.status,
    steers: agent.steers ?? steersMidTurn(timeline.agent?.provider),
    entries: timeline.entries,
    hasOlder: timeline.hasOlder,
    onSend,
    onFailed: (failed, error) => {
      toast.error(errorText(error));
      putBack(failed);
    },
  });
  const marksByRow = useMemo(() => new Map(sends.views.flatMap((view) => (view.rowKey === null ? [] : [[view.rowKey, view] as const]))), [sends.views]);
  const echoes = sends.views.filter((view) => view.rowKey === null);
  const places = useMemo(() => (asks === undefined || asks.decisions.length === 0 ? null : placeDecisions(agentRows, asks.decisions)), [agentRows, asks?.decisions]);
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
    if (openingCard.current.key === firstKey) {
      // The acceptance card is the transcript's end: one that fits is shown by following the end, as new messages arrive above it.
      if (firstKey === deliveryTarget && cardFits(layout.height, follow.viewport.current)) follow.reveal(firstKey, layout);
      else follow.revealRow(firstKey, layout, offsetShowingCard);
    }
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
    const scroll = () => {
      const layout = firstKey === null ? undefined : cardLayouts.current.get(firstKey);
      if (layout === undefined) return;
      if (firstKey === deliveryTarget && cardFits(layout.height, follow.viewport.current)) follow.jumpToEnd();
      else follow.scrollTo(offsetShowingCard(layout.y, layout.height, follow.viewport.current));
    };
    if (firstKey === deliveryTarget) measureDelivery(scroll);
    else scroll();
  }

  const deliveryView = useRef<View>(null);
  /** The transcript content's top, on screen: the acceptance card is measured from it. */
  const contentAnchor = useRef<View>(null);
  /**
   * The acceptance card's place, measured afresh (TR-091): messages arriving above it move it
   * without resizing it, and a web browser's onLayout reports only a resize, so its last layout goes
   * stale. Both are measured on screen at once, so the scroll offset (reported late) plays no part.
   */
  function measureDelivery(then?: () => void): void {
    const card = deliveryView.current;
    const anchor = contentAnchor.current;
    if (card === null || anchor === null) {
      then?.();
      return;
    }
    anchor.measureInWindow((anchorLeft, anchorTop) => {
      card.measureInWindow((left, top, width, height) => {
        // A hidden pane measures nothing.
        if (width > 0 && height > 0) noteLayout([deliveryTarget], { x: left - anchorLeft, y: top - anchorTop, width, height });
        then?.();
      });
    });
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
  // A hidden pane stays mounted: its field lets go of the keyboard, as it did when the pane unmounted.
  useOnPaneHidden(() => field.current?.blur());
  const [sending, setSending] = useState(false);
  const guardFor = usePressGuards();
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

  const windowSize = useWindowDimensions();
  const metrics = composerMetrics(Platform.OS === "web", windowSize.width);
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
    if (onSend === undefined || (text === "" && sent.length === 0)) return;
    // The guard, not `sending`, stops a second Enter or tap in the same frame; a held message sends nothing yet.
    const running = guardFor("send").run("send", () => sends.send(text, sent) ?? Promise.resolve());
    if (running === null) return;
    setSending(true);
    follow.pin();
    setDraft("");
    setAttachments([]);
    // A failure was reported, and the words handed back, by `onFailed`.
    void running.then(() => setSending(false));
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

  const toggleGroup = useLatestCallback((key: string) =>
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    }),
  );
  const rowLayoutChanged = useLatestCallback(noteRowLayout);
  const openLinkLatest = useLatestCallback(openLink);
  const decisionCardsLatest = useLatestCallback(decisionCards);
  const markActionLatest = useLatestCallback((id: string, action: MarkAction) => {
    if (action === "send-now") sends.sendNow(id);
    else if (action === "resend") sends.resend(id);
    else {
      const held = sends.views.find((view) => view.send.id === id);
      sends.forget(id);
      // A cancelled message goes back into the composer, to change or send later.
      if (action === "cancel" && held !== undefined) putBack(held.send);
    }
  });

  const styles = useMemo(
    () => chatStyles(theme, compact),
    [theme, compact],
  );

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
            if (delivery !== undefined) measureDelivery();
          }}
          onLayout={(event) => {
            follow.scrollProps.onLayout(event);
            keyboardScroll.onLayout();
          }}
          style={styles.transcript}
          contentContainerStyle={styles.transcriptBody}
        >
          {/* Out of the flow, so the content's gap does not count it. */}
          <View ref={contentAnchor} collapsable={false} pointerEvents="none" style={styles.contentAnchor} />
          <KeyboardRevealProvider value={keyboardScroll.claim}>
            {timeline.error === null ? null : <Text style={styles.error}>{timeline.error}</Text>}
            {groups.length === 0 && pending.length === 0 ? (
              <Text style={styles.hint}>{timeline.loading ? "Loading the conversation…" : "Nothing said yet."}</Text>
            ) : (
              groups.map((group) => {
                const row = "row" in group ? group.row : null;
                return (
                  <TranscriptGroup
                    key={group.key}
                    group={group}
                    open={openGroups.has(group.key)}
                    images={row?.kind === "user" ? rowImages.get(row.key) : undefined}
                    mark={row?.kind === "user" ? marksByRow.get(row.key) : undefined}
                    onMarkAction={markActionLatest}
                    asked={row?.kind === "agent" ? (places?.byRow.get(row.key) ?? NO_DECISIONS) : NO_DECISIONS}
                    transformText={transformText}
                    decorateRow={decorateRow}
                    theme={theme}
                    styles={styles}
                    onToggle={toggleGroup}
                    onRowLayout={rowLayoutChanged}
                    onOpenLink={openLinkLatest}
                    renderCards={decisionCardsLatest}
                  />
                );
              })
            )}
            {/* Sent but not in the timeline yet, or held: drawn here until the timeline shows them. */}
            {echoes.map((view) => (
              <UserMessage
                key={view.send.id}
                text={view.send.text === "" ? ATTACHMENTS_ONLY : view.send.text}
                images={undefined}
                mark={view}
                theme={theme}
                styles={styles}
                onMarkAction={markActionLatest}
              />
            ))}
            {places === null || places.unplaced.length === 0 ? null : (
              <View style={styles.agentRow} onLayout={(event) => noteLayout(places.unplaced.map((decision) => decision.key), event.nativeEvent.layout)}>
                {decisionCards(places.unplaced)}
              </View>
            )}
            {/* Under everything said since the delivery; a permission request, which holds the agent up, stays last. */}
            {delivery === undefined ? null : (
              <View ref={deliveryView} style={styles.agentRow} onLayout={(event) => noteLayout([deliveryTarget], event.nativeEvent.layout)}>
                {delivery.card}
              </View>
            )}
            {pending.map((request) => (
              <View key={request.id} onLayout={(event) => follow.reveal(request.id, event.nativeEvent.layout)}>
                <PermissionCard request={request} asker={asker} theme={theme} compact={compact} onRespond={(response) => respond(request.id, response)} onOpenLink={openLink} />
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
            {suggestions === undefined ? (
              // An owner's chat: its one action is a full-width link.
              actions === undefined ? null : <View style={styles.quick}>{actions}</View>
            ) : (
              <ActionRow theme={theme}>
                {actions}
                {suggestions}
              </ActionRow>
            )}
            {sends.holds ? (
              <View style={styles.quick}>
                <Icon name="AlertTriangle" size={13} color={theme.colors.statusWarning} />
                <Text style={[styles.lineText, { color: theme.colors.foreground }]}>Sending now would stop its current step, so Send holds your message until the step ends.</Text>
              </View>
            ) : null}
            <ReplyBox
              theme={theme}
              compact={compact}
              fieldRef={field}
              value={draft}
              onChangeText={setDraft}
              onFocus={releaseKeyboardClaim}
              placeholder={placeholder}
              enterHint
              onSend={sendDraft}
              canSend={!nothingToSend}
              sendState={sending ? "busy" : undefined}
              sendLabel={sends.holds ? "Hold until its step ends" : "Send"}
              above={<AttachmentPreviews theme={theme} attachments={attachments} onRemove={(id) => setAttachments(attachments.filter((attachment) => attachment.id !== id))} />}
              leading={attachButton}
              trailing={context === undefined ? null : <ContextMeter theme={theme} used={context.used} max={context.max} ringSize={metrics.ringSize} />}
            />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

/** One message or tool run of the transcript, drawn again only when what it shows changed (TR-069). */
interface TranscriptGroupProps {
  group: Group;
  /** A tool run the reader opened. */
  open: boolean;
  /** The images sent with a user's message. */
  images: readonly SentImage[] | undefined;
  /** A user's message the agent has not taken up yet (TR-084). */
  mark: SendView | undefined;
  onMarkAction: (id: string, action: MarkAction) => void;
  /** The open decisions this message asked, drawn under it. */
  asked: readonly StoredDecision[];
  transformText: ((text: string) => string) | undefined;
  decorateRow: ((text: string, key: string) => ReactNode) | undefined;
  theme: PluginTheme;
  styles: ChatStyles;
  onToggle: (key: string) => void;
  onRowLayout: (rowKey: string, keys: readonly string[], part: "row" | "cards", layout: LayoutRectangle) => void;
  onOpenLink: (url: string) => void;
  renderCards: (decisions: readonly StoredDecision[]) => ReactNode;
}

/** What a pending message's mark offers (TR-084). */
type MarkAction = "send-now" | "cancel" | "resend" | "dismiss";

/** The user's words, with the mark of a message the agent has not taken up yet under them. */
function UserMessage({
  text,
  images,
  mark,
  theme,
  styles,
  onMarkAction,
}: {
  text: string;
  images: readonly SentImage[] | undefined;
  mark: SendView | undefined;
  theme: PluginTheme;
  styles: ChatStyles;
  onMarkAction: (id: string, action: MarkAction) => void;
}) {
  return (
    <View style={styles.userColumn}>
      <View style={styles.user}>
        <Text selectable style={styles.userText}>
          {text}
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
      {mark === undefined ? null : <SendMarkLine view={mark} theme={theme} styles={styles} onAction={onMarkAction} />}
    </View>
  );
}

const MARK_TEXT: Record<SendMark, string> = {
  waiting: "Waiting for the agent's next step",
  held: "Held until its current step ends",
  unread: "Not read: the agent stopped first",
};

const MARK_ACTIONS: Record<SendMark, readonly { action: MarkAction; label: string; icon: string }[]> = {
  waiting: [],
  held: [
    { action: "send-now", label: "Send now and stop it", icon: "Send" },
    { action: "cancel", label: "Cancel", icon: "X" },
  ],
  unread: [
    { action: "resend", label: "Resend", icon: "RotateCcw" },
    { action: "dismiss", label: "Dismiss", icon: "X" },
  ],
};

function SendMarkLine({ view, theme, styles, onAction }: { view: SendView; theme: PluginTheme; styles: ChatStyles; onAction: (id: string, action: MarkAction) => void }) {
  const { colors } = theme;
  return (
    <View style={styles.mark}>
      <View style={styles.markLine}>
        {view.mark === "waiting" ? (
          <Spinner size={11} color={colors.foregroundMuted} />
        ) : (
          <Icon name={view.mark === "held" ? "Timer" : "AlertTriangle"} size={12} color={view.mark === "held" ? colors.foregroundMuted : colors.statusWarning} />
        )}
        <Text style={styles.markText}>{MARK_TEXT[view.mark]}</Text>
      </View>
      {/* The shared button (Catch up's style), in a row of their own under the words, right-aligned with the bubble. */}
      {MARK_ACTIONS[view.mark].length === 0 ? null : (
        <View style={styles.markActions}>
          {MARK_ACTIONS[view.mark].map((each) => (
            <IconButton key={each.action} icon={each.icon} label={each.label} showLabel theme={theme} onPress={() => onAction(view.send.id, each.action)} />
          ))}
        </View>
      )}
    </View>
  );
}

function TranscriptGroupView({ group, open, images, mark, asked, transformText, decorateRow, theme, styles, onToggle, onRowLayout, onOpenLink, renderCards, onMarkAction }: TranscriptGroupProps) {
  if ("tools" in group) {
    const summary = toolRunSummary(group.tools);
    const lone = group.tools.length === 1;
    const toggle = () => onToggle(group.key);
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
    case "user":
      return <UserMessage key={row.key} text={row.text} images={images} mark={mark} theme={theme} styles={styles} onMarkAction={onMarkAction} />;
    case "agent": {
      const targets = asked.map((decision) => decision.key);
      return (
        <View key={row.key} style={styles.agentRow} onLayout={targets.length === 0 ? undefined : (event) => onRowLayout(row.key, targets, "row", event.nativeEvent.layout)}>
          <Markdown source={transformText === undefined ? row.text : transformText(row.text)} theme={theme} onOpenLink={onOpenLink} />
          {decorateRow === undefined ? null : decorateRow(row.text, row.key)}
          {targets.length === 0 ? null : (
            <View style={styles.agentRow} onLayout={(event) => onRowLayout(row.key, targets, "cards", event.nativeEvent.layout)}>
              {renderCards(asked)}
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

const TranscriptGroup = memo(
  TranscriptGroupView,
  (previous, next) =>
    sameGroup(previous.group, next.group) &&
    sameItems(previous.images, next.images, (left, right) => left.path === right.path) &&
    previous.mark?.mark === next.mark?.mark &&
    previous.mark?.send.id === next.mark?.send.id &&
    previous.onMarkAction === next.onMarkAction &&
    sameItems(previous.asked, next.asked) &&
    previous.open === next.open &&
    previous.transformText === next.transformText &&
    previous.decorateRow === next.decorateRow &&
    previous.theme === next.theme &&
    previous.styles === next.styles &&
    previous.onToggle === next.onToggle &&
    previous.onRowLayout === next.onRowLayout &&
    previous.onOpenLink === next.onOpenLink &&
    previous.renderCards === next.renderCards,
);

const NO_DECISIONS: readonly StoredDecision[] = [];

/** The chat's styles, built once per theme, width and composer size. */
function chatStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    pane: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
    transcript: { flex: 1 },
    // Room between turns, so a reply, a tool run and the next message read as separate things.
    // Centred at a reading width in a wide pane (TR-027); the scroll bar stays at the pane's edge.
    contentAnchor: { position: "absolute" as const, top: 0, left: 0, width: 1, height: 1 },
    transcriptBody: {
      width: "100%" as const,
      maxWidth: CHAT_MAX_WIDTH,
      alignSelf: "center" as const,
      paddingVertical: compact ? SPACE.md : SPACE.lg,
      paddingHorizontal: paneGutter(compact),
      gap: compact ? SPACE.md : SPACE.lg,
    },
    // The user's bubble at the right, and a pending message's mark under it (TR-084).
    userColumn: { alignSelf: "flex-end" as const, maxWidth: "88%" as const, alignItems: "flex-end" as const, gap: SPACE.xs },
    user: {
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
    toolLatest: { flexShrink: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption), fontFamily: MONOSPACE },
    lineText: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
    toolText: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontFamily: MONOSPACE },
    toolTitle: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption), fontWeight: "600" as const },
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
    mark: { alignItems: "flex-end" as const, gap: SPACE.xs },
    markLine: { flexDirection: "row" as const, flexWrap: "wrap" as const, justifyContent: "flex-end" as const, alignItems: "center" as const, columnGap: SPACE.sm, rowGap: 2 },
    markText: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
    markActions: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: SPACE.sm },
    quick: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.sm, alignItems: "center" as const },
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
}

type ChatStyles = ReturnType<typeof chatStyles>;

/** The images the user sent this agent, re-read whenever the conversation grows. */
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
