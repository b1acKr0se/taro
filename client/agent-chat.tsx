/**
 * A conversation with one agent — a project's manager or a task owner — folded
 * to the words, with a composer that also sends images and files (TR-036). Adapted from
 * FirstMate's `client/chat.tsx` (MIT). The full session is one press away in Paseo.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, ScrollView, Text, useWindowDimensions, View, type LayoutRectangle, type TextInput as NativeTextInput } from "react-native";

import { attachmentProblem, refuseOversizedImages, type DraftAttachment } from "../shared/attachments";
import { answeredPermissionAsks, listAgentDecisions, listChatQueue, listSentImages, removeQueuedMessage, retryQueuedMessage, sendQueuedMessageNow, stopAgentTurn, takeQueuedMessage, type SentImagesMessage } from "../shared/contracts";
import type { PermissionAsk } from "../shared/permission-asks";
import { SCOPE_APPROVAL } from "../shared/decision-view";
import { ActionRow } from "./action-row";
import { droppedFilesAsAttachments, imagesFromPaste, pickAttachments } from "./attachment-pickers";
import { availableSources, type AttachmentSource } from "./attachment-sources";
import { AttachButton, AttachmentPreviews, DropBackdrop } from "./composer-attachments";
import type { StoredDecision } from "../shared/state";
import { WRITING_A_QUESTION } from "../shared/streaming-text";
import { ContextMeter } from "./context-meter";
import { useOnPaneHidden } from "./pane-visibility";
import { DecisionCard } from "./decision-card";
import { drafts } from "./draft";
import { watchFileDrops } from "./file-drop";
import { draftAttachments } from "./draft-attachments";
import { rowButtonStyle } from "./control-colors";
import { Pressable } from "./focus";
import { keepVisibleFrom, nearTheTop, useFollowEnd } from "./follow-end";
import { ImageThumbnail } from "./image-view";
import { KeyboardRevealProvider, useKeyboardOverlap, useKeyboardScroll, useRevealFocused } from "./keyboard";
import { formatClock } from "./format";
import { Markdown } from "./markdown";
import { PermissionCard, usePendingRequests } from "./permission-card";
import { deliveryCards, permissionCards, questionCards, sameAcceptanceRecord, sameQuestionCards, type DeliveryRecord, type QuestionCardView } from "./finished-cards";
import { PastAcceptanceCard, PastPermissionCard, PastPlanCard, PastQuestionCard } from "./past-cards";
import { planLines, type PlanAnswer, type PlanLine } from "./plan-lines";
import { ReplyBox } from "./reply-box";
import { BottomSafeArea } from "./safe-area";
import type { Asker } from "./permission-heading";
import { matchSentImages } from "./sent-images";
import { cardFits, cardOnScreen, deliveryRowKey, offsetShowingCard, placeDecisions } from "./inline-decisions";
import { groupRows, toolRunSummary, type Group, type ToolRow } from "./tool-runs";
import { ATTACHMENTS_ONLY, endStoppedTools, transcriptRows, whileWriting } from "./transcript-rows";
import { FONT_SIZE, labelLineHeightFor, lineHeightFor } from "./type-scale";
import { IconButton, JumpToEnd, LoadingBar, MONOSPACE, Spinner, errorText } from "./ui";
import { composerNotice, hasSomethingToSend, sendLabel } from "./composer-notice";
import { usePendingSends, type ChatSend } from "./use-pending-sends";
import { isCompacting, isWorking, takeBack, type SendMark, type SendView } from "../shared/pending-sends";
import { chatQueueKey, EDIT_SENT_MEANWHILE, editRefusal, editRemoval, queueCompacting, sendingToQueue, takenAttachments, type QueueRowAction, type QueueRowMessage } from "./queue-rows";
import { QueueTrack, useChatQueue } from "./queue-track";
import { COMPOSER_CONTROL_SIZE, composerMetrics } from "./composer-height";
import { CHAT_MAX_WIDTH, paneGutter, SPACE } from "./spacing";
import { useAgentTimeline } from "./use-timeline";
import { Shimmer, WorkingStatus } from "./loading";
import { SHIMMER_LIGHT } from "./shimmer";
import { useLatestCallback } from "./latest-callback";
import { bubbleImageRoom, USER_BUBBLE_SHARE } from "./thumbnail-size";
import { sameGroup, sameItems } from "./transcript-memo";
import type { SentImage } from "./sent-images";

export interface ChatAgent {
  id: string;
  updatedAt: string;
  pendingPermissions: number;
  status: string;
  /** When its current turn started: the time beside the loader at the chat's end counts from it (TR-183). */
  turnStartedAt?: string | null;
}

/** A conversation the user can write to, or one only to read (an archived agent's). */
type ChatComposer =
  | {
      placeholder: string;
      /**
       * Sends the user's words and attachments (the words may be empty when there are some) under the chat's
       * own message id (TR-084); resolves with whether the daemon queued it (TR-171), rejects with a sentence on failure.
       */
      onSend: ChatSend;
      /** Given each send before it leaves the box (TR-161): it calls `send` to go ahead, or later, or never; the words wait in the box meanwhile. */
      beforeSend?: ((send: () => void) => void) | undefined;
      /** Buttons above the composer (Catch up, Compact, …), first in one sideways-scrolling line with the suggestions. */
      actions?: ReactNode;
      /** The agent's context window, drawn as a ring inside the composer beside the send button. */
      context?: { used: number | null | undefined; max: number | null | undefined };
      /** A tooltip over the buttons' line, open while one of them is hovered or held (Replace manager's, TR-128). */
      actionsTip?: string | null;
      readOnly?: undefined;
    }
  | {
      /** No composer and no buttons; a footer says why. */
      readOnly: { note: string };
      placeholder?: undefined;
      onSend?: undefined;
      beforeSend?: undefined;
      actions?: undefined;
      /** How full its context window was, drawn at the footer's end (TR-156). */
      context?: { used: number | null | undefined; max: number | null | undefined };
      actionsTip?: undefined;
    };

export function AgentChat({
  agent,
  asker,
  theme,
  compact,
  placeholder,
  onSend,
  beforeSend,
  actions,
  context,
  actionsTip,
  readOnly,
  decorateRow,
  transformText,
  asks,
  delivery,
  records,
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
   * opening when nothing is asked, and `label` as a row at the composer while it is off screen, with
   * `accept` (its Accept button, while `ready`) beside Show. Drawn under the message that delivered,
   * like any other part of the chat, so what is said after it scrolls it away (TR-131); at the end
   * when that message is older than the timeline.
   */
  delivery?: { card: ReactNode; label: string; ready: boolean; accept: ReactNode } | undefined;
  /**
   * The ticket's records (TR-135, TR-149): a plan answered or asked again, and a delivery the user
   * answered, leave a finished card under their message. `plans` is null while the ticket loads (no
   * cards yet); `settling` while a plan just answered has its record read. Undefined for a chat
   * without plans.
   */
  records?: { project: string; ticket: string; plans: readonly PlanAnswer[] | null; deliveries: readonly DeliveryRecord[]; settling: boolean } | undefined;
  /** Things to send (the manager's suggestions, TR-045), after the buttons in their sideways-scrolling line. */
  suggestions?: ReactNode;
} & ChatComposer) {
  const toast = useToast();
  const timeline = useAgentTimeline(agent.id, `${agent.updatedAt}:${agent.pendingPermissions}`);
  // The timeline's read of the agent when it is newer than the board's: it follows the stream.
  const live = timeline.agent !== null && timeline.agent.updatedAt >= agent.updatedAt ? timeline.agent : null;
  const writing = (live?.status ?? agent.status) === "running";
  // The agent's folder, so a tool call's path inside it reads as Paseo shows it.
  const cwd = timeline.agent?.cwd ?? null;
  const working = isWorking(live?.status ?? agent.status);
  // A tool call shimmers only while its turn runs (TR-190).
  const rows = useMemo(() => whileWriting(endStoppedTools(transcriptRows(timeline.entries, cwd), working), writing), [timeline.entries, cwd, working, writing]);
  const groups = useMemo(() => groupRows(rows), [rows]);
  // The newest entry's position, not the count: the timeline is a tail and stops growing in length.
  const sentImages = useSentImages(agent.id, timeline.entries[timeline.entries.length - 1]?.seqStart ?? 0);
  const rowImages = useMemo(() => matchSentImages(rows, sentImages), [rows, sentImages]);
  const agentRows = useMemo(() => rows.filter((row) => row.kind === "agent"), [rows]);
  /** Edit on a message not sent: its words and attachments go back ahead of what the box holds, or it stays when they would not fit. */
  function takeBackFailed(id: string): void {
    const failed = sends.views.find((view) => view.send.id === id)?.send;
    if (failed === undefined) return;
    const back = takeBack({ text: drafts.get(agent.id), attachments: draftAttachments.get(agent.id) }, failed);
    const problem = attachmentProblem(back.attachments);
    if (problem !== null) {
      toast.error(`${problem} Remove some from the box first.`);
      return;
    }
    sends.forget(id);
    drafts.set(agent.id, back.text);
    draftAttachments.set(agent.id, back.attachments);
  }
  const queries = useQueryClient();
  const refreshQueue = () => queries.invalidateQueries({ queryKey: chatQueueKey(agent.id) });
  const sends = usePendingSends({
    agentId: agent.id,
    status: live?.status ?? agent.status,
    entries: timeline.entries,
    hasOlder: timeline.hasOlder,
    onSend,
    onQueued: refreshQueue,
  });
  // The messages waiting on the daemon for the turn to end (TR-171), drawn above the box.
  const queue = useChatQueue(agent.id, working, readOnly === undefined);
  const timelineCompacting = useMemo(() => isCompacting(timeline.entries), [timeline.entries]);
  const compacting = queueCompacting(timelineCompacting, queue.compacting);
  const marksByRow = useMemo(() => new Map(sends.views.flatMap((view) => (view.rowKey === null ? [] : [[view.rowKey, view] as const]))), [sends.views]);
  // On their way to a working agent: drawn in the queue track, where the daemon will put them (TR-171).
  const sendingRows = useMemo(() => sendingToQueue(sends.views, working), [sends.views, working]);
  const echoes = sends.views.filter((view) => view.rowKey === null && !sendingRows.some((row) => row.id === view.send.id));
  const places = useMemo(() => (asks === undefined || asks.decisions.length === 0 ? null : placeDecisions(agentRows, asks.decisions)), [agentRows, asks?.decisions]);
  /** The message whose plan is the live card; every other plan asking gets its line. */
  const livePlanRow = useMemo(() => (places === null ? null : ([...places.byRow].find(([, decisions]) => decisions.some((decision) => decision.id === SCOPE_APPROVAL))?.[0] ?? null)), [places]);
  const pastPlans = useMemo(() => (records?.plans == null ? null : planLines(rows, records.plans, livePlanRow, records.settling)), [rows, records?.plans, records?.settling, livePlanRow]);
  /** The acceptance card's place in the layouts, beside the decisions' keys. */
  const deliveryTarget = `delivery:${agent.id}`;
  /** The message the acceptance card is drawn under; null draws it at the end. */
  const deliveryRow = useMemo(() => (delivery === undefined ? null : deliveryRowKey(agentRows)), [delivery === undefined, agentRows]);
  /** The record that closed each past delivery, by the message that delivered (TR-149). */
  const storedDecisions = useAgentDecisions(agent.id, asks?.decisions, timeline.entries[timeline.entries.length - 1]?.seqStart ?? 0, asks !== undefined);
  /** The questions answered, withdrawn or asked again, left under their message (TR-149). */
  const pastQuestions = useMemo(
    () => (storedDecisions === null ? null : questionCards(agentRows, storedDecisions, new Set((asks?.decisions ?? []).map((decision) => decision.key)), formatClock)),
    [agentRows, storedDecisions, asks?.decisions],
  );
  const pastAcceptances = useMemo(() => (records === undefined ? null : deliveryCards(agentRows, records.deliveries, deliveryRow)), [agentRows, records?.deliveries, deliveryRow]);
  /** Nothing is drawn after the card but what arrives later: it is shown by following the end, as before TR-131. */
  const deliveryLast = deliveryRow === null || groups[groups.length - 1]?.key === deliveryRow;
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
      // An acceptance card with nothing said after it is the transcript's end: one that fits is shown by following the end.
      if (firstKey === deliveryTarget && deliveryLast && cardFits(layout.height, follow.viewport.current)) follow.reveal(firstKey, layout);
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

  /** The first entry drawn, to tell an earlier page put above the reader (TR-169) from any other change. */
  const firstSeq = timeline.entries[0]?.seqStart;
  const drawnFirst = useRef<{ agentId: string; seq: number | undefined }>({ agentId: agent.id, seq: firstSeq });
  const rowsAbove = drawnFirst.current.agentId === agent.id && drawnFirst.current.seq !== undefined && firstSeq !== undefined && firstSeq < drawnFirst.current.seq;
  // Measured while rendering, as the page still shows the rows before them; it only reads.
  if (rowsAbove) follow.holdBefore();
  useLayoutEffect(() => {
    if (rowsAbove) follow.holdAfter();
    drawnFirst.current = { agentId: agent.id, seq: firstSeq };
  }, [agent.id, firstSeq]);

  function jumpToFirst(): void {
    const scroll = () => {
      const layout = firstKey === null ? undefined : cardLayouts.current.get(firstKey);
      if (layout === undefined) return;
      if (firstKey === deliveryTarget && deliveryLast && cardFits(layout.height, follow.viewport.current)) follow.jumpToEnd();
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
   * stale. Both are measured on screen at once, so the scroll offset (reported late) plays no part:
   * asked together, as one asked in the other's answer is read a tick later, after a scroll the
   * opening queued has moved the card (TR-131).
   */
  function measureDelivery(then?: () => void): void {
    const card = deliveryView.current;
    const anchor = contentAnchor.current;
    if (card === null || anchor === null) {
      then?.();
      return;
    }
    let anchorAt: { left: number; top: number } | null = null;
    let cardAt: LayoutRectangle | null = null;
    const both = () => {
      if (anchorAt === null || cardAt === null) return;
      // A hidden pane measures nothing.
      if (cardAt.width > 0 && cardAt.height > 0) noteLayout([deliveryTarget], { x: cardAt.x - anchorAt.left, y: cardAt.y - anchorAt.top, width: cardAt.width, height: cardAt.height });
      then?.();
    };
    anchor.measureInWindow((left, top) => {
      anchorAt = { left, top };
      both();
    });
    card.measureInWindow((x, y, width, height) => {
      cardAt = { x, y, width, height };
      both();
    });
  }

  function decisionCards(decisions: readonly StoredDecision[]) {
    return decisions.map((decision) => (
      <DecisionCard key={decision.key} decision={decision} theme={theme} compact={compact} onAnswered={asks?.onAnswered ?? (() => undefined)} />
    ));
  }
  const { pending, respond } = usePendingRequests(agent.id, timeline.agent?.pendingPermissions, follow.pin);
  const answeredAsks = useAnsweredPermissionAsks(agent.id, `${agent.pendingPermissions}:${timeline.agent?.pendingPermissions?.length ?? 0}`, timeline.entries[timeline.entries.length - 1]?.seqStart ?? 0);
  const pendingIds = pending.map((request) => request.id).join("\n");
  /** Answered permission asks, each left where it was asked (TR-149); one still waiting is the live card below. */
  const permissionPlaces = useMemo(() => {
    const open = new Set(pendingIds.split("\n"));
    return permissionCards(groups, answeredAsks.filter((ask) => !open.has(ask.requestId)), timeline.hasOlder);
  }, [groups, answeredAsks, pendingIds, timeline.hasOlder]);
  function permissionCardsOf(asks: readonly PermissionAsk[] | undefined) {
    if (asks === undefined || asks.length === 0) return null;
    return (
      <View style={styles.agentRow}>
        {asks.map((ask) => (
          <PastPermissionCard key={ask.requestId} ask={ask} theme={theme} />
        ))}
      </View>
    );
  }
  const notice = composerNotice(pending.length > 0);
  // Read when the words leave the box, which a confirmation may put off (`beforeSend`).
  const requestPending = useRef(false);
  requestPending.current = pending.length > 0;
  const [draft, setDraftState] = useState(() => drafts.get(agent.id));
  const [attachments, setAttachmentsState] = useState(() => draftAttachments.get(agent.id));
  const field = useRef<NativeTextInput>(null);
  // A hidden pane stays mounted: its field lets go of the keyboard, as it did when the pane unmounted.
  useOnPaneHidden(() => field.current?.blur());
  const [dropping, setDropping] = useState(false);
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
  // Files dragged onto the pane are attached as Paseo's agent pane takes them (TR-099). The box is free while a send runs (TR-102).
  useEffect(() => {
    if (Platform.OS !== "web" || readOnly !== undefined) return;
    return watchFileDrops(pane.current, {
      onDragging: setDropping,
      disabled: () => false,
      onDrop: (files) => {
        droppedFilesAsAttachments(globalThis, files)
          .then(addAttachments)
          .catch((caught: unknown) => toast.error(errorText(caught)));
      },
    });
  }, [agent.id, readOnly === undefined]);
  useEffect(() => {
    if (keyboard > 0) follow.keepAtEnd();
  }, [keyboard]);

  const windowSize = useWindowDimensions();
  const metrics = composerMetrics(Platform.OS === "web", windowSize.width);
  const nothingToSend = !hasSomethingToSend(draft, attachments.length);

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

  /**
   * Clears the box at once and hands the message to the store, which shows it as a row and sends it
   * after those before it (TR-102). Read from the kept draft, not this render's: a second Enter or tap
   * in the same frame finds the box already empty.
   */
  function sendDraft(): void {
    if (beforeSend === undefined) sendKeptDraft();
    else if (!draftIsEmpty()) beforeSend(sendKeptDraft);
  }

  function draftIsEmpty(): boolean {
    return drafts.get(agent.id).trim() === "" && draftAttachments.get(agent.id).length === 0;
  }

  function sendKeptDraft(): void {
    const text = drafts.get(agent.id).trim();
    const sent = draftAttachments.get(agent.id);
    if (onSend === undefined || (text === "" && sent.length === 0)) return;
    setDraft("");
    setAttachments([]);
    sends.send(text, sent, requestPending.current);
    follow.pin();
  }

  const takeQueued = useRpc(takeQueuedMessage);
  const removeQueued = useRpc(removeQueuedMessage);
  const listQueued = useRpc(listChatQueue);
  const sendQueuedNow = useRpc(sendQueuedMessageNow);
  const retryQueued = useRpc(retryQueuedMessage);
  const stopTurn = useRpc(stopAgentTurn);
  // The agent a stop is under way for, so another agent's chat opened meanwhile shows its own button.
  const [stoppingAgent, setStoppingAgent] = useState<string | null>(null);
  /** The stop button and Escape (TR-181): ends this agent's turn; the queue then sends as after any turn. */
  function stopAgent(): void {
    const agentId = agent.id;
    if (stoppingAgent === agentId) return;
    setStoppingAgent(agentId);
    void stopTurn({ agentId })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setStoppingAgent((current) => (current === agentId ? null : current)));
  }
  const [queueBusy, setQueueBusy] = useState<{ id: string; action: QueueRowAction } | null>(null);
  /** Edit, Send now or Retry on a queued message (TR-171); an error's sentence goes to a toast, and the queue is read again either way. */
  function queueAction(message: QueueRowMessage, action: QueueRowAction): void {
    if (queueBusy !== null) return;
    if (action === "edit") {
      // Before the call: both sets of attachments might not fit together, and the message would be out of the queue.
      const refusal = editRefusal({ text: drafts.get(agent.id), attachments: draftAttachments.get(agent.id).length }, message);
      if (refusal !== null) {
        toast.error(refusal);
        return;
      }
    }
    const input = { agentId: agent.id, messageId: message.id };
    const call =
      action === "edit"
        ? takeQueued(input).then(async (taken) => {
            // The box first, then the message out of the queue: a lost answer on either loses nothing.
            const before = { text: drafts.get(agent.id), attachments: draftAttachments.get(agent.id) };
            const back = takeBack(before, { text: taken.text, attachments: takenAttachments(message.id, taken) });
            setDraft(back.text);
            setAttachments(back.attachments);
            await removeQueued(input).catch(async (caught: unknown) => {
              const queuedIds = await listQueued({ agentId: agent.id }).then(
                (listed) => listed.messages.map((each) => each.id),
                () => null,
              );
              const removal = editRemoval(errorText(caught), message.id, queuedIds);
              if (removal === "sent-meanwhile") toast.show(EDIT_SENT_MEANWHILE);
              if (removal === "sent-meanwhile" || removal === "removed") return;
              if (removal === "still-queued") {
                setDraft(before.text);
                setAttachments(before.attachments);
              }
              throw caught;
            });
          })
        : (action === "send-now" ? sendQueuedNow(input) : retryQueued(input)).then(() => follow.pin());
    setQueueBusy({ id: message.id, action });
    void call
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => {
        setQueueBusy(null);
        void refreshQueue();
      });
  }

  const attachButton = (
    <AttachButton
      theme={theme}
      compact={compact}
      iconSize={metrics.iconSize}
      disabled={false}
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
    if (action === "resend") sends.resend(id);
    else if (action === "retry") sends.retry(id);
    else if (action === "edit") takeBackFailed(id);
    else sends.forget(id);
  });

  const styles = useMemo(
    () => chatStyles(theme, compact),
    [theme, compact],
  );
  const deliveryCard =
    delivery === undefined ? null : (
      <View ref={deliveryView} style={styles.agentRow} onLayout={(event) => noteLayout([deliveryTarget], event.nativeEvent.layout)}>
        {delivery.card}
      </View>
    );

  return (
    <View ref={pane} style={[styles.pane, { paddingBottom: keyboard }]}>
      {readOnly === undefined && Platform.OS === "web" ? <DropBackdrop theme={theme} active={dropping} /> : null}
      {/* Re-reading behind the conversation already drawn (cached, or the last agent's read). */}
      <LoadingBar theme={theme} active={timeline.loading && groups.length > 0} />
      <View style={styles.transcript}>
        <ScrollView
          {...follow.scrollProps}
          // A phone keeps the reader's place as earlier pages go in above them (TR-169); the web does it in `holdAfter`.
          maintainVisibleContentPosition={Platform.OS !== "web" && timeline.olderAsked ? keepVisibleFrom(timeline.error !== null) : undefined}
          onScroll={(event) => {
            follow.scrollProps.onScroll(event);
            keyboardScroll.onScroll(event);
            // The reader scrolled up near the start of what is read: the page before it, ahead of them (TR-169).
            if (timeline.hasOlder && nearTheTop(event.nativeEvent)) timeline.loadOlder();
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
          {/* Out of the flow, so the content's gap does not count it. It, the error and the first line come before the rows: `keepVisibleFrom` counts them. */}
          <View ref={contentAnchor} collapsable={false} pointerEvents="none" style={styles.contentAnchor} />
          <KeyboardRevealProvider value={keyboardScroll.claim}>
            {timeline.error === null ? null : <Text style={styles.error}>{timeline.error}</Text>}
            {groups.length === 0 && pending.length === 0 ? (
              <Text style={styles.hint}>{timeline.loading ? "Loading the conversation…" : "Nothing said yet."}</Text>
            ) : (
              <>
              <EarlierMessages hasOlder={timeline.hasOlder} loading={timeline.loadingOlder} theme={theme} styles={styles} onLoad={timeline.loadOlder} />
              {permissionCardsOf(permissionPlaces.before)}
              {groups.map((group) => {
                const row = "row" in group ? group.row : null;
                return (
                  <Fragment key={group.key}>
                  <TranscriptGroup
                    key={group.key}
                    group={group}
                    open={openGroups.has(group.key)}
                    images={row?.kind === "user" ? rowImages.get(row.key) : undefined}
                    mark={row?.kind === "user" ? marksByRow.get(row.key) : undefined}
                    onMarkAction={markActionLatest}
                    asked={row?.kind === "agent" ? (places?.byRow.get(row.key) ?? NO_DECISIONS) : NO_DECISIONS}
                    pastPlan={row?.kind === "agent" ? pastPlans?.get(row.key) : undefined}
                    pastAcceptance={row?.kind === "agent" ? pastAcceptances?.get(row.key) : undefined}
                    pastQuestions={row?.kind === "agent" ? pastQuestions?.get(row.key) : undefined}
                    project={records?.project}
                    ticketId={records?.ticket}
                    transformText={transformText}
                    decorateRow={decorateRow}
                    theme={theme}
                    compact={compact}
                    styles={styles}
                    onToggle={toggleGroup}
                    onRowLayout={rowLayoutChanged}
                    onOpenLink={openLinkLatest}
                    renderCards={decisionCardsLatest}
                  />
                  {/* Beside the message, not inside it: a direct child of the transcript, measured on screen like before (TR-091). */}
                  {row?.key === deliveryRow ? deliveryCard : null}
                  {permissionCardsOf(permissionPlaces.after.get(group.key))}
                  </Fragment>
                );
              })}
              </>
            )}
            {/* Sent but not in the timeline yet: drawn here until the timeline shows them. A queued one is in the queue track instead. */}
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
            {/* Not during the first read, when no message is in yet: the opening scroll would go to the empty transcript's end, clamped, and read as the reader's (TR-133). */}
            {places === null || places.unplaced.length === 0 || (groups.length === 0 && timeline.loading) ? null : (
              <View style={styles.agentRow} onLayout={(event) => noteLayout(places.unplaced.map((decision) => decision.key), event.nativeEvent.layout)}>
                {decisionCards(places.unplaced)}
              </View>
            )}
            {/* The delivering message is older than the timeline: at the end, before a permission request, which holds the agent up. */}
            {/* Not while the first read is under way: drawn here first, it would move under its message as the rows arrive and the opening scroll would go to where it was. */}
            {deliveryRow === null && (groups.length > 0 || !timeline.loading) ? deliveryCard : null}
            {pending.map((request) => (
              <View key={request.id} onLayout={(event) => follow.reveal(request.id, event.nativeEvent.layout)}>
                <PermissionCard request={request} asker={asker} theme={theme} compact={compact} onRespond={(response) => respond(request.id, response)} onOpenLink={openLink} />
              </View>
            ))}
            {/* An agent held up by a permission request waits for the user, not at work. */}
            {pending.length > 0 ? null : <WorkingStatus theme={theme} status={live?.status ?? agent.status} turnStartedAt={agent.turnStartedAt} />}
          </KeyboardRevealProvider>
          {keyboardScroll.room > 0 ? <View style={{ height: keyboardScroll.room }} /> : null}
        </ScrollView>
        {follow.away ? <JumpToEnd theme={theme} onPress={follow.jumpToEnd} /> : null}
      </View>
      <BottomSafeArea style={styles.composerFrame}>
        {readOnly !== undefined ? (
          <View style={styles.readOnlyBand}>
            <View style={styles.readOnly}>
              <Icon name="Archive" size={14} color={theme.colors.foregroundMuted} />
              <Text style={styles.readOnlyText}>{readOnly.note}</Text>
              {context === undefined ? null : (
                <View style={styles.readOnlyMeter}>
                  <ContextMeter theme={theme} used={context.used} max={context.max} ringSize={metrics.ringSize} />
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.composer}>
            {firstOnScreen || places !== null || delivery === undefined ? null : (
              // Accept at hand while the card is scrolled away (TR-131); Show brings the card back.
              <View style={styles.quick}>
                <Icon name={delivery.ready ? "PackageCheck" : "PackageX"} size={13} color={delivery.ready ? theme.colors.accent : theme.colors.statusWarning} />
                <Text style={[styles.lineText, { color: theme.colors.foreground }]} numberOfLines={1}>
                  {delivery.label}
                </Text>
                {delivery.ready ? delivery.accept : null}
                <Pressable accessibilityRole="button" accessibilityLabel={`Show: ${delivery.label}`} style={styles.show} onPress={jumpToFirst}>
                  <Text style={styles.showText}>Show</Text>
                </Pressable>
              </View>
            )}
            {places?.first === null || places === null || firstOnScreen ? null : (
              <Pressable accessibilityRole="button" accessibilityLabel={`Show the question: ${places.first.question}`} style={styles.quick} onPress={jumpToFirst}>
                <Icon name="Hand" size={13} color={places.first.blocking ? theme.colors.statusWarning : theme.colors.foregroundMuted} />
                <Text style={[styles.lineText, { color: theme.colors.foreground }]} numberOfLines={1}>
                  {places.first.question}
                </Text>
                <View style={styles.show}>
                  <Text style={styles.showText}>Show</Text>
                </View>
              </Pressable>
            )}
            {suggestions === undefined ? (
              // An owner's chat: its one action is a full-width link.
              actions === undefined ? null : <View style={styles.quick}>{actions}</View>
            ) : (
              // The tooltip sits outside the sideways scroll, which would clip it.
              <View style={{ zIndex: 1 }}>
                <ActionRow theme={theme}>
                  {actions}
                  {suggestions}
                </ActionRow>
                {actionsTip === null || actionsTip === undefined ? null : (
                  <View pointerEvents="none" style={styles.actionsTip}>
                    <Text style={styles.actionsTipText}>{actionsTip}</Text>
                  </View>
                )}
              </View>
            )}
            {/* Directly above the box, as Paseo draws its own queue. */}
            <QueueTrack messages={queue.messages} sending={sendingRows} compacting={compacting} busy={queueBusy} theme={theme} onAction={queueAction} />
            {notice === null ? null : (
              <View style={styles.quick}>
                <Icon name="AlertTriangle" size={13} color={theme.colors.statusWarning} />
                <Text style={[styles.lineText, { color: theme.colors.foreground }]}>{notice}</Text>
              </View>
            )}
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
              stop={working ? { onStop: stopAgent, busy: stoppingAgent === agent.id } : undefined}
              sendLabel={sendLabel({ working, requestPending: pending.length > 0 })}
              above={<AttachmentPreviews theme={theme} attachments={attachments} onRemove={(id) => setAttachments(attachments.filter((attachment) => attachment.id !== id))} />}
              leading={attachButton}
              trailing={context === undefined ? null : <ContextMeter theme={theme} used={context.used} max={context.max} ringSize={metrics.ringSize} />}
            />
          </View>
        )}
      </BottomSafeArea>
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
  /** The line left where this message's plan card was, once answered or asked again (TR-135). */
  pastPlan: PlanLine | undefined;
  /** The record that closed this delivery, once answered (TR-149). */
  pastAcceptance: DeliveryRecord | undefined;
  /** The questions of this message that are over, as finished cards (TR-149). */
  pastQuestions: readonly QuestionCardView[] | undefined;
  /** The ticket the finished cards belong to, for View plan. */
  project: string | undefined;
  ticketId: string | undefined;
  transformText: ((text: string) => string) | undefined;
  decorateRow: ((text: string, key: string) => ReactNode) | undefined;
  theme: PluginTheme;
  compact: boolean;
  styles: ChatStyles;
  onToggle: (key: string) => void;
  onRowLayout: (rowKey: string, keys: readonly string[], part: "row" | "cards", layout: LayoutRectangle) => void;
  onOpenLink: (url: string) => void;
  renderCards: (decisions: readonly StoredDecision[]) => ReactNode;
}

/** What a pending message's mark offers (TR-084). */
type MarkAction = "resend" | "dismiss" | "retry" | "edit";

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
  // The bubble is as wide as what it holds, so its images are sized to the room the chat gives it (TR-098), measured on a row as wide as the chat (always: the images arrive after the row's first layout); until then they wait, rather than push the bubble off the pane.
  const [chatWidth, setChatWidth] = useState<number | null>(null);
  const room = chatWidth === null ? null : bubbleImageRoom(chatWidth, USER_BUBBLE_PADDING, USER_BUBBLE_BORDER);
  return (
    <View style={styles.userRow} onLayout={(event) => setChatWidth(event.nativeEvent.layout.width)}>
      <View style={styles.userColumn}>
        <View style={styles.user}>
          <Text selectable style={styles.userText}>
            {text}
          </Text>
          {images === undefined || room === null ? null : (
            <View style={styles.userImages}>
              {images.map((image, index) => (
                <ImageThumbnail
                  key={index}
                  source={image.path}
                  alt="Sent image"
                  theme={theme}
                  room={room}
                  set={images.map((each) => ({ source: each.path, alt: "Sent image" }))}
                  index={index}
                />
              ))}
            </View>
          )}
        </View>
        {mark === undefined ? null : <SendMarkLine view={mark} theme={theme} styles={styles} onAction={onMarkAction} />}
      </View>
    </View>
  );
}

const USER_BUBBLE_PADDING = SPACE.md;
const USER_BUBBLE_BORDER = 1;

const MARK_TEXT: Record<SendMark, string> = {
  sending: "Sending…",
  behind: "Waits for the message above to be sent",
  failed: "Not sent",
  waiting: "Waiting for the agent's next step",
  unread: "Not read: the agent stopped first",
};

const MARK_ACTIONS: Record<SendMark, readonly { action: MarkAction; label: string; icon: string }[]> = {
  sending: [],
  behind: [],
  failed: [
    { action: "retry", label: "Retry", icon: "RotateCcw" },
    { action: "edit", label: "Edit", icon: "Pencil" },
  ],
  waiting: [],
  unread: [
    { action: "resend", label: "Resend", icon: "RotateCcw" },
    { action: "dismiss", label: "Dismiss", icon: "X" },
  ],
};

/** A failed message's mark says why (TR-102). */
function markText(view: SendView): string {
  return view.mark === "failed" ? `Not sent: ${view.send.error ?? "Paseo did not take it."}` : MARK_TEXT[view.mark];
}

function SendMarkLine({
  view,
  theme,
  styles,
  onAction,
}: {
  view: SendView;
  theme: PluginTheme;
  styles: ChatStyles;
  onAction: (id: string, action: MarkAction) => void;
}) {
  const { colors } = theme;
  return (
    <View style={styles.mark}>
      <View style={styles.markLine}>
        {view.mark === "waiting" || view.mark === "sending" ? (
          <Spinner size={11} color={colors.foregroundMuted} />
        ) : (
          <Icon
            name={view.mark === "behind" ? "Timer" : "AlertTriangle"}
            size={12}
            color={view.mark === "behind" ? colors.foregroundMuted : view.mark === "failed" ? colors.statusDanger : colors.statusWarning}
          />
        )}
        <Text style={[styles.markText, view.mark === "failed" ? { color: colors.statusDanger } : null]}>{markText(view)}</Text>
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

/** One tool call as Paseo lists it: its icon, its label and, quieter, the command or path, on one line. */
function ToolLine({ tool, theme, styles }: { tool: ToolRow; theme: PluginTheme; styles: ChatStyles }) {
  const running = tool.status === "running";
  return (
    <View style={styles.toolLine}>
      {/* Its own icon while it runs, muted as in Paseo: the words shimmer instead (TR-183, TR-184). */}
      <Icon name={tool.status === "failed" ? "TriangleAlert" : tool.icon} size={13} color={tool.status === "failed" ? theme.colors.statusDanger : theme.colors.foregroundMuted} />
      <Shimmer
        active={running}
        characters={tool.label.length + (tool.summary?.length ?? 0)}
        style={styles.toolWords}
        render={(tone) => (
          <>
            {/* Apart, not one text with spaces: the web build collapses the spaces Paseo's gap stands for. */}
            <Text style={[styles.toolLabel, tone === "peak" ? styles.toolPeak : running ? styles.toolLabelRunning : null]} numberOfLines={1}>
              {tool.label}
            </Text>
            {tool.summary === undefined ? null : (
              <Text style={[styles.toolText, tone === "peak" ? styles.toolPeak : null]} numberOfLines={1}>
                {tool.summary}
              </Text>
            )}
          </>
        )}
      />
    </View>
  );
}

function TranscriptGroupView({ group, open, images, mark, asked, pastPlan, pastAcceptance, pastQuestions, project, ticketId, transformText, decorateRow, theme, compact, styles, onToggle, onRowLayout, onOpenLink, renderCards, onMarkAction }: TranscriptGroupProps) {
  if ("tools" in group) {
    const [only] = group.tools;
    if (group.tools.length === 1 && only !== undefined) return <ToolLine key={group.key} tool={only} theme={theme} styles={styles} />;
    const summary = toolRunSummary(group.tools);
    const toggle = () => onToggle(group.key);
    return (
      <View key={group.key} style={styles.toolRun}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${summary.title}${summary.failed > 0 ? `, ${summary.failed} failed` : ""}${summary.state === "running" ? ", running" : ""}, ${open ? "fold" : "show"}`}
          style={[styles.toolHead, open ? styles.toolHeadOpen : null]}
          onPress={toggle}
        >
          <Icon name={open ? "ChevronDown" : "Wrench"} size={13} color={open ? theme.colors.foreground : theme.colors.foregroundMuted} />
          <Shimmer
            active={summary.state === "running"}
            characters={summary.title.length}
            style={styles.toolTitleWords}
            render={(tone) => (
              <>
                {/* Never cut: the counts are what the reader wants. */}
                <Text style={[styles.toolTitle, open ? styles.toolTitleOpen : null, tone === "peak" ? styles.toolPeak : summary.state === "running" ? styles.toolLabelRunning : null]}>{summary.title}</Text>
                {/* Its own text, so a long summary is cut before the failure is. */}
                {summary.failed > 0 ? <Text style={[styles.toolFailed, tone === "peak" ? styles.toolPeak : null]}>{`· ${summary.failed} failed`}</Text> : null}
              </>
            )}
          />
        </Pressable>
        {open ? (
          <View style={styles.toolList}>
            {group.tools.map((tool) => (
              <ToolLine key={tool.key} tool={tool} theme={theme} styles={styles} />
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
          {row.asking === true ? <Text style={styles.asking}>{WRITING_A_QUESTION}</Text> : null}
          {decorateRow === undefined ? null : decorateRow(row.text, row.key)}
          {pastPlan === undefined || project === undefined || ticketId === undefined ? null : <PastPlanCard line={pastPlan} project={project} ticket={ticketId} theme={theme} compact={compact} />}
          {pastAcceptance === undefined || ticketId === undefined ? null : <PastAcceptanceCard record={pastAcceptance} ticket={ticketId} theme={theme} />}
          {pastQuestions === undefined ? null : pastQuestions.map((card) => <PastQuestionCard key={card.id} card={card} theme={theme} />)}
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
    samePlanLine(previous.pastPlan, next.pastPlan) &&
    sameAcceptanceRecord(previous.pastAcceptance, next.pastAcceptance) &&
    sameQuestionCards(previous.pastQuestions, next.pastQuestions) &&
    previous.project === next.project &&
    previous.ticketId === next.ticketId &&
    previous.compact === next.compact &&
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

function samePlanLine(left: PlanLine | undefined, right: PlanLine | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.outcome === right.outcome && left.at === right.at && left.words === right.words && left.askedAt === right.askedAt && left.replaced === right.replaced && left.closed === right.closed;
}

/** The chat's styles, built once per theme, width and composer size. */
/**
 * The transcript's first line (TR-169): earlier messages being read, a link to read them (a chat too
 * short to scroll up), or the conversation's start.
 */
function EarlierMessages({ hasOlder, loading, theme, styles, onLoad }: { hasOlder: boolean; loading: boolean; theme: PluginTheme; styles: ChatStyles; onLoad: () => void }) {
  if (!hasOlder) return <Text style={[styles.earlier, styles.earlierStart]}>Start of the conversation</Text>;
  if (loading) {
    return (
      <View style={styles.earlierLoading}>
        <Spinner size={12} color={theme.colors.foregroundMuted} />
        <Text style={styles.earlier}>Loading earlier messages…</Text>
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Load earlier messages" style={styles.earlierLink} onPress={onLoad}>
      <Text style={[styles.earlier, styles.earlierLinkText]}>Load earlier messages</Text>
    </Pressable>
  );
}

function chatStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    pane: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
    transcript: { flex: 1 },
    // Where the acceptance card is measured from (TR-091): the content's top, out of the flow.
    contentAnchor: { position: "absolute" as const, top: 0, left: 0, width: 1, height: 1 },
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
    // The user's bubble at the right, and a pending message's mark under it (TR-084).
    userRow: { alignSelf: "stretch" as const },
    userColumn: { alignSelf: "flex-end" as const, maxWidth: `${USER_BUBBLE_SHARE * 100}%` as const, alignItems: "flex-end" as const, gap: SPACE.xs },
    user: {
      backgroundColor: colors.surface2,
      borderWidth: USER_BUBBLE_BORDER,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: USER_BUBBLE_PADDING,
      paddingVertical: SPACE.sm + 2,
    },
    userImages: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.sm, marginTop: SPACE.sm },
    userText: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) },
    agentRow: { alignSelf: "stretch" as const, gap: SPACE.sm },
    line: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm - 2 },
    // A run of tool calls is the agent working, not talking: one quiet line until the reader opens it, as in Paseo.
    toolRun: { alignSelf: "stretch" as const, gap: SPACE.xs },
    toolHead: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      alignSelf: "flex-start" as const,
      maxWidth: "100%" as const,
      gap: SPACE.sm,
      paddingVertical: SPACE.xs,
      borderRadius: 8,
    },
    toolHeadOpen: { alignSelf: "stretch" as const, paddingHorizontal: SPACE.sm, backgroundColor: colors.surface2 },
    toolList: { gap: SPACE.xs, paddingHorizontal: SPACE.sm },
    toolLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm, paddingVertical: 2 },
    lineText: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
    lineTop: { alignItems: "flex-start" as const },
    lineTextHeight: { lineHeight: lineHeightFor(FONT_SIZE.caption) },
    lineIcon: { height: lineHeightFor(FONT_SIZE.caption), justifyContent: "center" as const },
    // The label and the command or path, together, so the shimmer crosses both (TR-183).
    toolWords: { flex: 1, flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm },
    toolTitleWords: { flexShrink: 1, flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm },
    // While it runs, as Paseo: the label a little dim, so the band brightening it shows.
    toolLabelRunning: { color: colors.foreground, opacity: 0.72 },
    // Paseo's band, white in either theme; the web clips its gradient to these letters instead (TR-184).
    toolPeak: { color: SHIMMER_LIGHT, opacity: 1 },
    toolText: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.body, lineHeight: labelLineHeightFor(FONT_SIZE.body) },
    toolLabel: { flexShrink: 0, maxWidth: "50%" as const, color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: labelLineHeightFor(FONT_SIZE.body) },
    toolTitle: { flexShrink: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.body, lineHeight: labelLineHeightFor(FONT_SIZE.body) },
    toolTitleOpen: { color: colors.foreground },
    // Not the agent's words: the chat saying a question is on its way (TR-144).
    asking: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, fontStyle: "italic" as const },
    toolFailed: { flexShrink: 0, color: colors.statusDanger, fontSize: FONT_SIZE.body, lineHeight: labelLineHeightFor(FONT_SIZE.body) },
    error: { color: colors.statusDanger, fontSize: FONT_SIZE.small },
    hint: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, textAlign: "center" as const, padding: SPACE.lg },
    // The transcript's first line (TR-169), each state the same height so swapping them moves nothing.
    earlier: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption), textAlign: "center" as const },
    earlierLoading: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: SPACE.sm, paddingVertical: SPACE.xs },
    earlierLink: { alignSelf: "center" as const, paddingVertical: SPACE.xs, paddingHorizontal: SPACE.sm, borderRadius: 6 },
    earlierLinkText: { color: colors.accent },
    earlierStart: { paddingVertical: SPACE.xs },
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
    // Above the buttons' line, from its start, as the context meter's tooltip sits above the ring.
    actionsTip: {
      position: "absolute" as const,
      bottom: "100%" as const,
      left: 0,
      marginBottom: SPACE.xs,
      maxWidth: ACTIONS_TIP_MAX_WIDTH,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
    },
    actionsTipText: { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
    // The row is the press target; Show is drawn as a button so the row reads as one (TR-093).
    show: rowButtonStyle(colors),
    showText: { color: colors.accent, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption), fontWeight: "600" as const },
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
    // Into the band's padding, so an agent with a ring has the same band as one without.
    readOnlyMeter: { marginVertical: Math.min(0, (lineHeightFor(FONT_SIZE.small) - COMPOSER_CONTROL_SIZE) / 2) },
    readOnlyText: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
  };
}

/** About 40 characters a line: a few lines over the transcript rather than one across the pane. */
const ACTIONS_TIP_MAX_WIDTH = 320;

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

/**
 * Every decision Taro holds for this agent, for its finished question cards (TR-149). Read again when
 * an open one closes (`open` changes) and as the conversation grows; the last answer stays meanwhile.
 * Null while off or not yet read.
 */
function useAgentDecisions(agentId: string, open: readonly StoredDecision[] | undefined, newestEntry: number, enabled: boolean): readonly StoredDecision[] | null {
  const list = useRpc(listAgentDecisions);
  const openKeys = (open ?? []).map((decision) => decision.key).join(",");
  const query = useQuery({
    queryKey: ["taro", "agent-decisions", agentId, openKeys, newestEntry] as const,
    queryFn: () => list({ agentId }),
    enabled,
    placeholderData: (previous) => previous,
  });
  return enabled ? (query.data?.decisions ?? null) : null;
}

/**
 * The agent's answered permission asks, oldest first (TR-149). Read again when its pending count
 * changes (`pendingKey`) and as the conversation grows, since the answer is stored a moment after it
 * is given; the last answer stays meanwhile.
 */
function useAnsweredPermissionAsks(agentId: string, pendingKey: string, newestEntry: number): readonly PermissionAsk[] {
  const list = useRpc(answeredPermissionAsks);
  const query = useQuery({
    queryKey: ["taro", "answered-permissions", agentId, pendingKey, newestEntry] as const,
    queryFn: () => list({ agentId }),
    placeholderData: (previous) => previous,
  });
  return query.data?.asks ?? NO_ASKS;
}

const NO_ASKS: readonly PermissionAsk[] = [];

const EMPTY_SENT: readonly SentImagesMessage[] = [];

/** The part of a browser's paste event the composer reads. */
interface WebPasteEvent {
  clipboardData: { files: ArrayLike<{ type: string }> } | null;
  preventDefault(): void;
}
