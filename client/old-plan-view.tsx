/**
 * The Old plan view (TR-157): View plan on a finished plan card opens that plan as it stood when the
 * user answered it, read from the tracker's history, in a sheet of its own over the chat rather than
 * the ticket's Ticket tab, which shows the current plan. Its fixed header says it is an old plan;
 * above the plan, scrolling with it, how it was answered and when, and Open current plan, which leads to the Ticket tab where the Taro screen offers it.
 * Full screen on a phone; on a wide screen a centred panel, kept clear of the macOS window controls.
 * A plan the history does not reach is said to be missing, never replaced by the current one.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { Modal, Platform, SafeAreaView, ScrollView, Text, View } from "react-native";

import { loadPastPlan } from "../shared/contracts";
import { parsePlan } from "../shared/plan";
import { OLD_PLAN_MISSING, oldPlanCaption, type OldPlanView } from "./finished-cards";
import { Pressable } from "./focus";
import { errorText } from "./format";
import { Markdown } from "./markdown";
import { PlanBody } from "./plan-card";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton, Spinner } from "./ui";

/** The wide panel's width, and its margin above and below: past the macOS traffic lights' 45 px strip. */
const PANEL_WIDTH = 760;
const PANEL_MARGIN = 56;
const OUTCOME_ICON = { positive: "CircleCheck", warning: "TriangleAlert", negative: "CircleX", neutral: "Circle" } as const;

interface WebKeyEvent {
  key: string;
}
interface WebDocument {
  addEventListener(type: string, listener: (event: WebKeyEvent) => void): void;
  removeEventListener(type: string, listener: (event: WebKeyEvent) => void): void;
}

export function OldPlanSheet({
  open,
  view,
  project,
  ticket,
  theme,
  compact,
  onClose,
  onOpenCurrent,
}: {
  open: boolean;
  view: OldPlanView;
  project: string;
  ticket: string;
  theme: PluginTheme;
  compact: boolean;
  onClose: () => void;
  /** Opens the ticket's current plan; null where there is no Taro screen to open it in. */
  onOpenCurrent: (() => void) | null;
}) {
  const { colors } = theme;
  const toast = useToast();
  const load = useRpc(loadPastPlan);
  const found = useQuery({
    queryKey: ["taro", "past-plan", project, ticket, view.answeredAt ?? "", view.askedAt],
    queryFn: () => load({ project, ticket, answeredAt: view.answeredAt, askedAt: view.askedAt }),
    enabled: open,
  });
  const source = found.data?.plan ?? null;
  const plan = useMemo(() => parsePlan(source), [source]);
  const caption = oldPlanCaption(view, found.isLoading || found.error !== null ? "loading" : source === null ? "missing" : "found");

  // The web's Escape closes it, as it does the image viewer.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open || Platform.OS !== "web") return undefined;
    const page = (globalThis as { document?: WebDocument }).document;
    const onKey = (event: WebKeyEvent) => {
      if (event.key === "Escape") close.current();
    };
    page?.addEventListener("keydown", onKey);
    return () => page?.removeEventListener("keydown", onKey);
  }, [open]);

  const toneColor = view.tone === "positive" ? colors.accent : view.tone === "warning" ? colors.statusWarning : view.tone === "negative" ? colors.statusDanger : colors.foregroundMuted;
  const small = { fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) };
  const message = (text: string) => <Text style={[small, { color: colors.foregroundMuted }]}>{text}</Text>;

  let body;
  if (found.isLoading) {
    body = (
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
        <Spinner size={14} color={colors.foregroundMuted} />
        {message("Reading the plan from the tracker’s history…")}
      </View>
    );
  } else if (found.error !== null) {
    body = <Text style={[small, { color: colors.statusDanger }]}>{errorText(found.error)}</Text>;
  } else if (source === null) {
    body = message(OLD_PLAN_MISSING);
  } else if (plan === null) {
    body = <Markdown source={source} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={(url) => void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)))} />;
  } else {
    body = <PlanBody plan={plan} theme={theme} />;
  }

  const sheet = (
    <View
      style={{
        flex: compact ? 1 : undefined,
        width: "100%",
        maxWidth: compact ? undefined : PANEL_WIDTH,
        maxHeight: "100%",
        backgroundColor: colors.surface0,
        borderRadius: compact ? 0 : 12,
        borderWidth: compact ? 0 : 1,
        borderColor: colors.border,
        overflow: "hidden",
      }}
    >
      {/* Only the title and ✕ stay put; the answer and Open current plan scroll away with the plan. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingLeft: SPACE.lg, paddingRight: SPACE.md, paddingVertical: SPACE.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface1 }}>
        <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body), fontWeight: "600" }}>
          {`Old plan for ${ticket}`}
        </Text>
        <IconButton icon="X" label="Close" theme={theme} onPress={onClose} />
      </View>
      <ScrollView style={{ flexGrow: 0, flexShrink: 1 }}>
        <View style={{ paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md, gap: SPACE.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm }}>
            <View style={{ height: lineHeightFor(FONT_SIZE.small), justifyContent: "center" }}>
              <Icon name={OUTCOME_ICON[view.tone]} size={13} color={toneColor} />
            </View>
            <Text style={[small, { flex: 1, color: toneColor, fontWeight: "600" }]}>
              {view.outcome}
              {view.time === null ? null : <Text style={{ color: colors.foregroundMuted, fontWeight: "400" }}>{`  ${view.time}`}</Text>}
            </Text>
          </View>
          {view.words === null ? null : <Text style={[small, { color: colors.foregroundMuted, fontStyle: "italic" }]}>{`“${view.words}”`}</Text>}
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: SPACE.sm }}>
            {caption === null ? null : <Text style={[small, { flexShrink: 1, color: colors.foregroundMuted }]}>{caption}</Text>}
            {/* On the right in every case: beside the caption, under it when it wraps, alone when there is none. */}
            {onOpenCurrent === null ? null : (
              <View style={{ marginLeft: "auto" }}>
                <IconButton icon="Map" label="Open current plan" showLabel theme={theme} onPress={onOpenCurrent} />
              </View>
            )}
          </View>
        </View>
        <View style={{ padding: SPACE.lg }}>{body}</View>
      </ScrollView>
    </View>
  );

  return (
    <Modal visible={open} transparent={!compact} animationType={compact ? "slide" : "fade"} onRequestClose={onClose}>
      {!open ? null : compact ? (
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface0 }}>{sheet}</SafeAreaView>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: PANEL_MARGIN, paddingHorizontal: SPACE.xl }}>
          {/* The dimmed page behind closes it, as a click outside a dialog does. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the old plan"
            onPress={onClose}
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: withAlpha(colors.surface0, 0.75) }}
          />
          {sheet}
        </View>
      )}
    </Modal>
  );
}
