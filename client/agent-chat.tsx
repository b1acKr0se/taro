/**
 * A conversation with one agent — a project's manager or a task owner — folded
 * to the words, with a composer. Adapted from FirstMate's `client/chat.tsx`
 * (MIT), without attachments. The full session is one press away in Paseo.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";

import { drafts } from "./draft";
import { useFollowEnd } from "./follow-end";
import { useKeyboardOverlap } from "./keyboard";
import { isSendKey, type WebKeyPressEvent } from "./keys";
import { Markdown } from "./markdown";
import { PermissionCard, usePendingRequests } from "./permission-card";
import { transcriptRows, type TranscriptRow } from "./transcript-rows";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton, JumpToEnd, MONOSPACE, Spinner, errorText } from "./ui";
import { useAgentTimeline } from "./use-timeline";

const TOOL_RUN_VISIBLE = 2;
const INPUT_HEIGHT = 110;
const INPUT_HEIGHT_COMPACT = 76;

type Group = { key: string; row: TranscriptRow } | { key: string; tools: Extract<TranscriptRow, { kind: "tool" }>[] };

function groupRows(rows: readonly TranscriptRow[]): Group[] {
  const groups: Group[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (row.kind === "tool" && last !== undefined && "tools" in last) last.tools.push(row);
    else if (row.kind === "tool") groups.push({ key: row.key, tools: [row] });
    else groups.push({ key: row.key, row });
  }
  return groups;
}

export interface ChatAgent {
  id: string;
  updatedAt: string;
  pendingPermissions: number;
  status: string;
}

export function AgentChat({
  agent,
  theme,
  compact,
  placeholder,
  onSend,
  actions,
  decorateRow,
  transformText,
}: {
  agent: ChatAgent;
  theme: PluginTheme;
  compact: boolean;
  placeholder: string;
  /** Sends the user's words; rejects with a sentence on failure. */
  onSend: (text: string) => Promise<void>;
  /** Buttons above the composer (Catch up, Compact, …). */
  actions?: ReactNode;
  /** Draws extra content under an agent message (decision cards). */
  decorateRow?: (text: string, key: string) => ReactNode;
  /** Rewrites an agent message before it is drawn (drops decision blocks drawn as cards). */
  transformText?: (text: string) => string;
}) {
  const toast = useToast();
  const timeline = useAgentTimeline(agent.id, `${agent.updatedAt}:${agent.pendingPermissions}`);
  const rows = useMemo(() => transcriptRows(timeline.entries), [timeline.entries]);
  const groups = useMemo(() => groupRows(rows), [rows]);
  const follow = useFollowEnd();
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
    if (text === "" || sending) return;
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
      transcriptBody: { padding: compact ? 10 : 14, gap: 10 },
      user: {
        alignSelf: "flex-end" as const,
        maxWidth: "88%" as const,
        backgroundColor: colors.surface2,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
      },
      userText: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) },
      agentRow: { alignSelf: "stretch" as const, gap: 6 },
      line: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      lineText: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      toolText: { flex: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontFamily: MONOSPACE },
      more: { color: colors.accent, fontSize: FONT_SIZE.caption },
      error: { color: colors.statusDanger, fontSize: FONT_SIZE.small },
      hint: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, textAlign: "center" as const, padding: 16 },
      composerFrame: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface0 },
      composer: { padding: compact ? 8 : 10, gap: 8 },
      quick: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, alignItems: "center" as const },
      inputRow: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: 8 },
      input: {
        flex: 1,
        color: colors.foreground,
        fontSize: FONT_SIZE.content,
        lineHeight: lineHeightFor(FONT_SIZE.content),
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        height: compact ? INPUT_HEIGHT_COMPACT : INPUT_HEIGHT,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: colors.surface1,
        textAlignVertical: "top" as const,
      },
    };
  }, [theme, compact]);

  function renderGroup(group: Group) {
    if ("tools" in group) {
      const open = openGroups.has(group.key);
      const shown = open ? group.tools : group.tools.slice(-TOOL_RUN_VISIBLE);
      const hidden = group.tools.length - shown.length;
      return (
        <View key={group.key} style={{ gap: 3 }}>
          {hidden > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => setOpenGroups((current) => new Set([...current, group.key]))}>
              <Text style={styles.more}>+ {hidden} more tool calls</Text>
            </Pressable>
          ) : null}
          {shown.map((tool) => (
            <View key={tool.key} style={styles.line}>
              {tool.status === "running" ? (
                <Spinner size={11} color={theme.colors.foregroundMuted} />
              ) : (
                <Icon name={tool.status === "failed" ? "X" : "Wrench"} size={11} color={tool.status === "failed" ? theme.colors.statusDanger : theme.colors.foregroundMuted} />
              )}
              <Text style={styles.toolText} numberOfLines={1}>
                {tool.text}
              </Text>
            </View>
          ))}
        </View>
      );
    }
    const row = group.row;
    switch (row.kind) {
      case "captain":
        return (
          <View key={row.key} style={styles.user}>
            <Text selectable style={styles.userText}>
              {row.text}
            </Text>
          </View>
        );
      case "mate":
        return (
          <View key={row.key} style={styles.agentRow}>
            <Markdown source={transformText === undefined ? row.text : transformText(row.text)} theme={theme} onOpenLink={openLink} />
            {decorateRow === undefined ? null : decorateRow(row.text, row.key)}
          </View>
        );
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
      <View style={styles.transcript}>
        <ScrollView {...follow.scrollProps} style={styles.transcript} contentContainerStyle={styles.transcriptBody}>
          {timeline.error === null ? null : <Text style={styles.error}>{timeline.error}</Text>}
          {groups.length === 0 && pending.length === 0 ? (
            <Text style={styles.hint}>{timeline.loading ? "Loading the conversation…" : "Nothing said yet."}</Text>
          ) : (
            groups.map(renderGroup)
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
        <View style={styles.composer}>
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
      </SafeAreaView>
    </View>
  );
}
