/**
 * One tool call opened in a modal (TR-282): its whole call, its status and time, and its result. The
 * host's `Modal` owns the safe area and draws a sheet on a phone. Drawn only while open, so the clock
 * that ticks a running call runs only then.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { Text, View } from "react-native";

import { readToolTimes } from "../shared/contracts";
import { SPACE } from "./spacing";
import { cutResult, errorWords, toolState, toolText, toolTiming } from "./tool-detail";
import type { ToolRow } from "./tool-runs";
import { watchedStart } from "./tool-watch";
import { FONT_SIZE } from "./type-scale";
import { MONOSPACE } from "./ui";
import { useNow } from "./use-now";

/**
 * Opens a call's modal by its row's key. The chat draws the modal itself, not the call's line: a lone
 * call's line is replaced by a run's when the next call joins it, and a modal kept by the line would
 * close under the reader while the call finishes.
 */
export const OpenToolContext = createContext<(rowKey: string) => void>(() => {});
export const useOpenTool = () => useContext(OpenToolContext);

export function ToolModal({ tool, agentId, open, onOpenChange, theme }: { tool: ToolRow; agentId: string; open: boolean; onOpenChange: (open: boolean) => void; theme: PluginTheme }) {
  return (
    <Modal title={tool.label} open={open} onOpenChange={onOpenChange}>
      <Modal.Content contentContainerStyle={{ padding: SPACE.lg, gap: SPACE.md }}>{open ? <ToolModalBody tool={tool} agentId={agentId} theme={theme} /> : null}</Modal.Content>
    </Modal>
  );
}

function ToolModalBody({ tool, agentId, theme }: { tool: ToolRow; agentId: string; theme: PluginTheme }) {
  const { colors } = theme;
  // Once a second while the call runs; a finished call's text never changes.
  const now = useNow(1000);
  // What the plugin saw of this call, read again when the call's state changes (the daemon records within seconds of it).
  const readTimes = useRpc(readToolTimes);
  const recorded = useQuery({ queryKey: ["taro", "tool-times", agentId, tool.status], queryFn: () => readTimes({ agentId }), staleTime: 0, retry: false });
  const recordedCall = tool.callId === undefined ? undefined : recorded.data?.calls[tool.callId];
  const parts = toolText(tool.detail);
  const state = toolState(tool.status, tool.stopped);
  const failed = state.kind === "failed";
  const running = state.kind === "running";
  // A stopped call has no time of its own to show.
  const timing = state.kind === "stopped" ? { text: "", ticking: false } : toolTiming({ status: tool.status, changedAt: tool.at, now, ...(watchedStart(tool.callId) === undefined ? {} : { watchedStartedAt: watchedStart(tool.callId) as number }), ...(parts.durationMs === undefined ? {} : { ownMs: parts.durationMs }), ...(recordedCall === undefined ? {} : { recorded: recordedCall }) });
  const error = failed ? errorWords(tool.error) : "";
  const result = cutResult(parts.result);
  const heading = { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, letterSpacing: 0.8 };
  const box = { backgroundColor: colors.surface2, borderRadius: 6, padding: SPACE.md };
  const code = { color: colors.foreground, fontSize: FONT_SIZE.code - 1, fontFamily: MONOSPACE };
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACE.sm }}>
        <Icon name={failed ? "TriangleAlert" : running ? "Loader" : state.kind === "stopped" ? "Ban" : "Check"} size={14} color={failed ? colors.statusDanger : colors.foreground} />
        <Text style={{ color: failed ? colors.statusDanger : colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" }}>{state.word}</Text>
        {timing.text === "" ? null : <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.body }}>{timing.text}</Text>}
      </View>
      {parts.call === "" ? null : (
        <View style={{ gap: SPACE.xs }}>
          <Text style={heading}>CALL</Text>
          <View style={box}>
            <Text selectable style={code}>
              {parts.call}
            </Text>
          </View>
        </View>
      )}
      <View style={{ gap: SPACE.xs }}>
        <Text style={heading}>{parts.outcome === undefined ? "RESULT" : `RESULT · ${parts.outcome.toUpperCase()}`}</Text>
        {error === "" ? null : (
          <View style={box}>
            <Text selectable style={[code, { color: colors.statusDanger }]}>
              {error}
            </Text>
          </View>
        )}
        {result.shown === "" && error !== "" ? null : (
          <View style={box}>
            {result.shown === "" ? (
              <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.body }}>{running ? "No output yet." : "No output."}</Text>
            ) : (
              <Text selectable style={code}>
                {result.shown}
              </Text>
            )}
          </View>
        )}
        {result.cut === 0 ? null : <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption }}>{`Cut: ${result.cut.toLocaleString("en-US")} more characters not shown.`}</Text>}
      </View>
    </>
  );
}
