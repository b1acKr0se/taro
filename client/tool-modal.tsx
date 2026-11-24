/**
 * One tool call opened in a modal (TR-282): its whole call, its status and time, and its result. The
 * host's `Modal` owns the safe area and draws a sheet on a phone. Drawn only while open, so the clock
 * that ticks a running call runs only then.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";

import { SPACE } from "./spacing";
import { cutResult, errorWords, toolText, toolTiming } from "./tool-detail";
import type { ToolRow } from "./tool-runs";
import { watchedStart } from "./tool-watch";
import { FONT_SIZE } from "./type-scale";
import { MONOSPACE } from "./ui";
import { useNow } from "./use-now";

const STATUS_WORDS: Record<string, string> = { running: "Running", completed: "Completed", failed: "Failed", canceled: "Stopped" };

export function ToolModal({ tool, open, onOpenChange, theme }: { tool: ToolRow; open: boolean; onOpenChange: (open: boolean) => void; theme: PluginTheme }) {
  return (
    <Modal title={tool.label} open={open} onOpenChange={onOpenChange}>
      <Modal.Content contentContainerStyle={{ padding: SPACE.lg, gap: SPACE.md }}>{open ? <ToolModalBody tool={tool} theme={theme} /> : null}</Modal.Content>
    </Modal>
  );
}

function ToolModalBody({ tool, theme }: { tool: ToolRow; theme: PluginTheme }) {
  const { colors } = theme;
  // Once a second while the call runs; a finished call's text never changes.
  const now = useNow(1000);
  const parts = toolText(tool.detail);
  const failed = tool.status === "failed";
  const running = tool.status === "running";
  const timing = toolTiming({ status: tool.status, changedAt: tool.at, now, ...(watchedStart(tool.callId) === undefined ? {} : { watchedStartedAt: watchedStart(tool.callId) as number }), ...(parts.durationMs === undefined ? {} : { ownMs: parts.durationMs }) });
  const error = failed ? errorWords(tool.error) : "";
  const result = cutResult(parts.result);
  const heading = { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, letterSpacing: 0.8 };
  const box = { backgroundColor: colors.surface2, borderRadius: 6, padding: SPACE.md };
  const code = { color: colors.foreground, fontSize: FONT_SIZE.code - 1, fontFamily: MONOSPACE };
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACE.sm }}>
        <Icon name={failed ? "TriangleAlert" : running ? "Loader" : "Check"} size={14} color={failed ? colors.statusDanger : colors.foreground} />
        <Text style={{ color: failed ? colors.statusDanger : colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" }}>{STATUS_WORDS[tool.status] ?? tool.status}</Text>
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
