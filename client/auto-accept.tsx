/**
 * The auto-accept switch (TR-257): one icon button in the manager's top bar, the offer that follows
 * turning it on while tickets wait, and the settings section. Both surfaces read and write the one
 * stored value through `taro.project.auto-accept.set`.
 */
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

import { acceptWaiting, listWaitingForAccept, setAutoAccept } from "../shared/contracts";
import { holdListText, parseHoldList } from "../shared/auto-accept";
import type { ProjectConfig } from "../shared/project";
import { ChoiceCards, Field, FormSection, TextField } from "./settings-form";
import { useRefreshProjects } from "./queries";
import { SPACE } from "./spacing";
import { TipAnchor } from "./tip-anchor";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton } from "./ui";
import { useActions } from "./use-actions";

export interface WaitingTicket {
  id: string;
  title: string;
}

export interface AutoAcceptControl {
  project: string;
  on: boolean;
  state: "busy" | "done" | undefined;
  busy: boolean;
  /** Tickets waiting with complete records, asked about right after the switch was pressed on. */
  offer: readonly WaitingTicket[] | null;
  toggle: () => void;
  /** Turn on and let the plugin accept the waiting tickets now. */
  acceptNow: () => void;
  /** Turn on, but keep the waiting tickets for the user's own Accept. */
  keepThem: () => void;
  dismiss: () => void;
}

/** What the button's tooltip says: the project, what the switch does now, and what a press does. */
export function autoAcceptTip(project: string, on: boolean): string {
  return on
    ? `Auto-accept is on for ${project}: the plugin accepts and merges each ticket that arrives with a complete record. Press to turn it off.`
    : `Auto-accept is off for ${project}: you press Accept on each ticket. Press to let the plugin accept tickets with a complete record.`;
}

export function useAutoAccept(config: Pick<ProjectConfig, "project" | "autoAccept" | "autoAcceptHold">, onChanged: () => void): AutoAcceptControl {
  const project = config.project;
  const set = useRpc(setAutoAccept);
  const waiting = useRpc(listWaitingForAccept);
  const refreshProjects = useRefreshProjects();
  const presses = useActions();
  const [offer, setOffer] = useState<readonly WaitingTicket[] | null>(null);
  const hold = config.autoAcceptHold;
  const changed = () => {
    refreshProjects();
    onChanged();
  };
  return useMemo(
    () => ({
      project,
      on: config.autoAccept,
      state: presses.stateOf("toggle") ?? presses.stateOf("offer"),
      busy: presses.busy,
      offer,
      toggle() {
        if (config.autoAccept) {
          presses.press("toggle", () => set({ project, enabled: false }), { onSuccess: changed });
          return;
        }
        // Waiting tickets are asked about first: turning on takes them at once.
        presses.press(
          "toggle",
          async () => {
            const { tickets } = await waiting({ project });
            if (tickets.length > 0) return tickets;
            await set({ project, enabled: true });
            return null;
          },
          { onSuccess: (tickets) => (tickets === null ? changed() : setOffer(tickets)) },
        );
      },
      acceptNow() {
        presses.press("offer", () => set({ project, enabled: true }), { onSuccess: () => (setOffer(null), changed()), success: "Auto-accept is on: accepting the waiting tickets" });
      },
      keepThem() {
        const held = [...hold, ...(offer ?? []).map((ticket) => ticket.id).filter((id) => !hold.includes(id))];
        presses.press("offer", () => set({ project, enabled: true, hold: held }), { onSuccess: () => (setOffer(null), changed()), success: "Auto-accept is on: the waiting tickets stay for your Accept" });
      },
      dismiss: () => setOffer(null),
    }),
    [project, config.autoAccept, hold, offer, presses.busy, presses.stateOf("toggle"), presses.stateOf("offer")],
  );
}

/** Icon only: filled green when on, flat when off; its tooltip (hover, or held on a phone) says which project and what a press does. */
export function AutoAcceptButton({ theme, control }: { theme: PluginTheme; control: AutoAcceptControl }) {
  return (
    <TipAnchor theme={theme} text={autoAcceptTip(control.project, control.on)}>
      {(tip) => (
        <IconButton
          icon="CheckCheck"
          label={`Auto-accept for ${control.project}`}
          tone={control.on ? "accent" : "default"}
          theme={theme}
          disabled={control.busy}
          state={control.state}
          tip={tip}
          onPress={control.toggle}
        />
      )}
    </TipAnchor>
  );
}

function ticketList(tickets: readonly WaitingTicket[]): string {
  const shown = tickets.slice(0, 3).map((ticket) => ticket.id);
  return tickets.length > shown.length ? `${shown.join(", ")} and ${tickets.length - shown.length} more` : shown.join(", ");
}

/** Under the manager's top bar after the switch was pressed on with tickets waiting: take them now, or keep them for the user. */
export function AutoAcceptOffer({ theme, control }: { theme: PluginTheme; control: AutoAcceptControl }) {
  const tickets = control.offer;
  if (tickets === null) return null;
  return (
    <View
      style={{
        flexShrink: 0,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: SPACE.sm,
        paddingHorizontal: SPACE.md,
        paddingVertical: SPACE.sm,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small), flexGrow: 1, flexBasis: 200 }}>
        {tickets.length === 1 ? "1 ticket is waiting" : `${tickets.length} tickets are waiting`} with a complete record ({ticketList(tickets)}). Accept {tickets.length === 1 ? "it" : "them"} now, or keep {tickets.length === 1 ? "it" : "them"} for your own Accept?
      </Text>
      <IconButton icon="CheckCheck" label={`Accept ${tickets.length} now`} showLabel tone="accent" theme={theme} disabled={control.busy} state={control.state} onPress={control.acceptNow} />
      <IconButton icon="Hand" label="Keep them for me" showLabel theme={theme} disabled={control.busy} onPress={control.keepThem} />
      <IconButton icon="X" label="Cancel" showLabel theme={theme} disabled={control.busy} onPress={control.dismiss} />
    </View>
  );
}

/** Project settings: the switch, the tickets it never takes, and the bulk Accept for what waits (which works with the switch off). */
export function AutoAcceptSettings({ theme, wide, config }: { theme: PluginTheme; wide: boolean; config: ProjectConfig }) {
  const project = config.project;
  const refreshProjects = useRefreshProjects();
  const control = useAutoAccept(config, () => undefined);
  const set = useRpc(setAutoAccept);
  const waiting = useRpc(listWaitingForAccept);
  const bulk = useRpc(acceptWaiting);
  const presses = useActions();
  const [held, setHeld] = useState(() => holdListText(config.autoAcceptHold));
  const [tickets, setTickets] = useState<readonly WaitingTicket[]>([]);
  useEffect(() => setHeld(holdListText(config.autoAcceptHold)), [config.autoAcceptHold.join(",")]);
  useEffect(() => {
    void waiting({ project }).then((result) => setTickets(result.tickets)).catch(() => setTickets([]));
  }, [project, config.autoAccept, config.autoAcceptHold.join(",")]);
  const parsed = parseHoldList(held);
  const saved = parsed.invalid.length === 0 && parsed.ids.join(",") === config.autoAcceptHold.join(",");
  return (
    <FormSection theme={theme} icon="CheckCheck" title="Auto-accept" description={`Who presses Accept on ${project}'s finished tickets. The manager's top bar has the same switch.`}>
      <Field theme={theme} wide={wide} label="Accept">
        <ChoiceCards
          theme={theme}
          value={config.autoAccept ? "auto" : "me"}
          onChange={(value) => {
            if ((value === "auto") !== config.autoAccept) control.toggle();
          }}
          options={[
            { value: "me", title: "I press Accept", description: "Every finished ticket waits for your press, as now." },
            { value: "auto", title: "Accept for me", description: "The plugin accepts and merges a ticket the moment it reaches Awaiting acceptance with its evidence, summary and delivery record complete and no question or review blocker open." },
          ]}
        />
      </Field>
      <AutoAcceptOffer theme={theme} control={control} />
      <Field theme={theme} wide={wide} label="Never auto-accept" hint="Ticket ids, one per line or separated by commas. Each keeps its Accept button and gets a note." error={parsed.invalid.length === 0 ? null : `${parsed.invalid.join(", ")} ${parsed.invalid.length === 1 ? "is" : "are"} not ticket ids (like TR-12).`}>
        <TextField theme={theme} accessibilityLabel="Never auto-accept" value={held} onChangeText={setHeld} multiline placeholder="TR-12" invalid={parsed.invalid.length > 0} />
        <IconButton
          icon="Save"
          label="Save list"
          showLabel
          theme={theme}
          disabled={saved || parsed.invalid.length > 0 || presses.busy}
          state={presses.stateOf("hold")}
          onPress={() => presses.press("hold", () => set({ project, hold: parsed.ids }), { success: "Saved the list", onSuccess: refreshProjects })}
        />
      </Field>
      {tickets.length === 0 ? null : (
        <Field theme={theme} wide={wide} label="Waiting now" hint={`${ticketList(tickets)}. Accepts each as if you pressed Accept on it.`}>
          <IconButton
            icon="CheckCheck"
            label={`Accept ${tickets.length} now`}
            showLabel
            theme={theme}
            disabled={presses.busy}
            state={presses.stateOf("bulk")}
            onPress={() =>
              presses.press("bulk", () => bulk({ project }), {
                onSuccess: (result) => {
                  setTickets([]);
                  refreshProjects();
                  if (result.failed.length > 0) setTickets(tickets.filter((ticket) => result.failed.some((each) => each.id === ticket.id)));
                },
                success: "Accepting the waiting tickets",
              })
            }
          />
        </Field>
      )}
    </FormSection>
  );
}
