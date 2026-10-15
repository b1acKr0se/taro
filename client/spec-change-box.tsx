/**
 * Change spec… on a Queued ticket with no owner (TR-129): the button opens the box Request changes…
 * opens (`ChangeBox`), and Send to manager hands the words to the manager, tagged with the ticket,
 * which rewrites the ticket. The Chat tab draws it in place of an owner's chat, the Ticket tab under
 * its summary block.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useRef, useState } from "react";
import { View } from "react-native";

import { changeQueuedSpec } from "../shared/contracts";
import { ChangeBox } from "./change-box";
import { useRevealFocused } from "./keyboard";
import { IconButton } from "./ui";
import { useActions } from "./use-actions";

export function SpecChangeBox({
  project,
  ticket,
  theme,
  compact,
  onSent,
  open: openAs,
  onOpenChange,
}: {
  project: string;
  ticket: string;
  theme: PluginTheme;
  compact?: boolean | undefined;
  /** After the manager has the words: the ticket's records show the SCOPE-CHANGE. */
  onSent?: (() => void) | undefined;
  /** Set where the button sits elsewhere (the Ticket tab's summary row): the box alone, while open. */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const send = useRpc(changeQueuedSpec);
  const presses = useActions();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openAs ?? ownOpen;
  const setOpen = (next: boolean) => (onOpenChange ?? setOwnOpen)(next);
  // Kept across Cancel, so reopening the box finds the words again.
  const [typed, setTyped] = useState("");
  // The box and its buttons are revealed together, so Send to manager stays above a phone's keyboard.
  const foot = useRef<View>(null);
  const reveal = useRevealFocused(foot);

  if (!open) {
    if (openAs !== undefined) return null;
    return (
      <View style={{ alignItems: "flex-start" }}>
        <IconButton icon="Pencil" label="Change spec…" showLabel theme={theme} onPress={() => setOpen(true)} />
      </View>
    );
  }
  return (
    <View ref={foot} collapsable={false}>
      <ChangeBox
        theme={theme}
        compact={compact}
        value={typed}
        onChangeText={setTyped}
        onFocus={reveal}
        placeholder={`What should change in ${ticket}?`}
        sendLabel="Send to manager"
        canSend={typed.trim() !== ""}
        busy={presses.busy}
        sendState={presses.stateOf("send")}
        onSend={() =>
          presses.press("send", () => send({ project, ticket, text: typed.trim() }), {
            success: "Sent to the manager.",
            onSuccess: () => {
              setTyped("");
              setOpen(false);
              onSent?.();
            },
          })
        }
        onCancel={() => setOpen(false)}
      />
    </View>
  );
}
