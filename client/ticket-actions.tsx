/**
 * The ticket's buttons in a row of their own under the summary card (TR-229), each with a tooltip:
 * Close round on a reopened ticket not yet delivered, Park or Resume, Relaunch owner, Change spec…,
 * Compact and, on a Done ticket, Reopen…. Reopen's and Close round's boxes (`ChangeBox`) take the
 * row's place until they are sent or cancelled.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { View } from "react-native";

import { closeRound, reopenTicket } from "../shared/contracts";
import { ChangeBox } from "./change-box";
import { useRevealFocused } from "./keyboard";
import { SPACE } from "./spacing";
import { TipAnchor } from "./tip-anchor";
import { IconButton } from "./ui";
import type { Actions } from "./use-actions";

export interface RowAction {
  run: () => void;
  state: "busy" | "done" | undefined;
  busy: boolean;
}

export const TIPS = {
  closeRound: "Puts this ticket back to Done without waiting for its owner. Nothing from this round is merged.",
  reopen: "Starts a fresh owner on this Done ticket with your note. It reads the ticket and the earlier owners' chats.",
  park: "Asks the owner for a handoff, then stops it and frees its slot. Resume picks it up later.",
  resume: "Starts a fresh owner from the latest handoff once an owner slot is free.",
  relaunch: "Archives this owner and starts a fresh one in the same worktree, from the latest handoff.",
  changeSpec: "Tells the manager what should change before an owner starts on this ticket.",
  compact: "Asks the owner for a handoff, then compacts its context so later turns cost less.",
  approve: "Approves the plan as written; the owner starts building.",
};

export function TicketActions({
  theme,
  project,
  ticket,
  presses,
  pauseAction,
  compactAction,
  relaunchAction,
  specChange,
  reopenable,
  onReopened,
  closable,
}: {
  theme: PluginTheme;
  project: string;
  ticket: string;
  /** The group's presses: Reopen's Send is one of them, so the buttons wait on each other. */
  presses: Actions;
  /** Park for a queued or under-way ticket, Resume for a parked one (TR-088, TR-166). */
  pauseAction: (RowAction & { kind: "pause" | "resume" }) | null;
  /** Compact beside Park, for an idle owner with a large context (TR-095). */
  compactAction: RowAction | null;
  /** Relaunch owner: a fresh owner from the latest HANDOFF, in any worked status (TR-219). */
  relaunchAction: RowAction | null;
  /** Opens Change spec…'s box, on a Queued ticket with no owner (TR-129). */
  specChange: (() => void) | null;
  reopenable: boolean;
  /** After the server has reopened the ticket or closed its round: told what happened. */
  onReopened: (result: { message: string }) => void;
  /** Close round is offered: a reopened ticket not yet delivered. */
  closable: boolean;
}) {
  const reopen = useRpc(reopenTicket);
  const [open, setOpen] = useState<"reopen" | "close" | null>(null);
  // Kept across Cancel, so reopening the box finds the words again.
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  // The box and its buttons are revealed together, so Reopen stays above a phone's keyboard.
  const foot = useRef<View>(null);
  const reveal = useRevealFocused(foot);

  if (open === "close" && closable) {
    return (
      <CloseRoundBox
        theme={theme}
        project={project}
        ticket={ticket}
        presses={presses}
        value={reason}
        onChangeText={setReason}
        onClosed={(result) => {
          setReason("");
          setOpen(null);
          onReopened(result);
        }}
        onCancel={() => setOpen(null)}
      />
    );
  }
  if (open === "reopen" && reopenable) {
    return (
      <View ref={foot} collapsable={false}>
        <ChangeBox
          theme={theme}
          value={typed}
          onChangeText={setTyped}
          onFocus={reveal}
          placeholder={`What should the owner do on ${ticket}?`}
          sendLabel="Reopen"
          canSend={typed.trim() !== ""}
          busy={presses.busy}
          sendState={presses.stateOf("reopen")}
          onSend={() =>
            presses.press("reopen", () => reopen({ project, ticket, note: typed.trim() }), {
              onSuccess: (result) => {
                setTyped("");
                setOpen(null);
                onReopened(result);
              },
            })
          }
          onCancel={() => setOpen(null)}
        />
      </View>
    );
  }
  if (!closable && !reopenable && pauseAction === null && compactAction === null && relaunchAction === null && specChange === null) return null;
  return (
    // Above what follows, so a tooltip hanging under a button covers it.
    <View style={{ zIndex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: SPACE.sm }}>
      {!closable ? null : (
        <TipAnchor theme={theme} text={TIPS.closeRound}>
          {(tip) => <IconButton icon="CircleCheck" label="Close round" showLabel theme={theme} disabled={presses.busy} onPress={() => setOpen("close")} tip={tip} />}
        </TipAnchor>
      )}
      {!reopenable ? null : (
        <TipAnchor theme={theme} text={TIPS.reopen}>
          {(tip) => <IconButton icon="RotateCcw" label="Reopen…" showLabel theme={theme} disabled={presses.busy} onPress={() => setOpen("reopen")} tip={tip} />}
        </TipAnchor>
      )}
      {pauseAction === null ? null : (
        <TipAnchor theme={theme} text={pauseAction.kind === "pause" ? TIPS.park : TIPS.resume}>
          {(tip) => (
            <IconButton
              icon={pauseAction.kind === "pause" ? "SquareParking" : "Play"}
              label={pauseAction.kind === "pause" ? "Park" : "Resume"}
              showLabel
              theme={theme}
              disabled={pauseAction.busy}
              state={pauseAction.state}
              onPress={pauseAction.run}
              tip={tip}
            />
          )}
        </TipAnchor>
      )}
      {relaunchAction === null ? null : (
        <TipAnchor theme={theme} text={TIPS.relaunch}>
          {(tip) => <IconButton icon="RotateCcw" label="Relaunch owner" showLabel theme={theme} disabled={relaunchAction.busy} state={relaunchAction.state} onPress={relaunchAction.run} tip={tip} />}
        </TipAnchor>
      )}
      {specChange === null ? null : (
        <TipAnchor theme={theme} text={TIPS.changeSpec}>
          {(tip) => <IconButton icon="Pencil" label="Change spec…" showLabel theme={theme} onPress={specChange} tip={tip} />}
        </TipAnchor>
      )}
      {compactAction === null ? null : (
        <TipAnchor theme={theme} text={TIPS.compact}>
          {(tip) => <IconButton icon="Minimize2" label="Compact" showLabel theme={theme} disabled={compactAction.busy} state={compactAction.state} onPress={compactAction.run} tip={tip} />}
        </TipAnchor>
      )}
    </View>
  );
}

/**
 * Close round's confirm box (TR-229), in the Ticket tab's row and above the owner's chat box: an
 * optional reason, then Close round and Cancel, so a stray tap never stops a working owner. On a
 * failure the box stays open with the words, and the press says why in an error toast.
 */
export function CloseRoundBox({
  theme,
  compact,
  project,
  ticket,
  presses,
  value,
  onChangeText,
  onClosed,
  onCancel,
}: {
  theme: PluginTheme;
  compact?: boolean | undefined;
  project: string;
  ticket: string;
  presses: Actions;
  value: string;
  onChangeText: (text: string) => void;
  /** After the server has closed the round: told what happened. */
  onClosed: (result: { message: string }) => void;
  onCancel: () => void;
}) {
  const close = useRpc(closeRound);
  const foot = useRef<View>(null);
  const reveal = useRevealFocused(foot);
  return (
    <View ref={foot} collapsable={false} style={{ width: "100%" }}>
      <ChangeBox
        theme={theme}
        compact={compact}
        value={value}
        onChangeText={onChangeText}
        onFocus={reveal}
        placeholder="Why close this round? (optional)"
        sendLabel="Close round"
        canSend
        busy={presses.busy}
        sendState={presses.stateOf("close-round")}
        onSend={() => presses.press("close-round", () => close({ project, ticket, reason: value.trim() }), { onSuccess: onClosed })}
        onCancel={onCancel}
      />
    </View>
  );
}
