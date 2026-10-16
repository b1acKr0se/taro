/**
 * The finished cards an owner's chat leaves (TR-149): a past plan and a past acceptance, drawn from
 * the pure views in finished-cards.ts with the one FinishedCard.
 */
import type { PluginTheme } from "@getpaseo/plugin";

import { FinishedCard } from "./finished-card";
import { deliveryCardView, planCardView, type DeliveryRecord } from "./finished-cards";
import { formatClock } from "./format";
import { useViewPlan } from "./plan-navigation";
import type { PlanLine } from "./plan-lines";
import { IconButton } from "./ui";

/** A past plan; View plan opens it in the Taro screen (TR-061) and is left out elsewhere. */
export function PastPlanCard({ line, project, ticket, theme, compact }: { line: PlanLine; project: string; ticket: string; theme: PluginTheme; compact: boolean }) {
  const viewPlan = useViewPlan();
  const view = planCardView(line, formatClock);
  return (
    <FinishedCard
      theme={theme}
      compact={compact}
      icon="Map"
      kind="Plan"
      subject={`Plan for ${ticket}`}
      outcome={view.outcome}
      tone={view.tone}
      time={view.time}
      words={view.words}
      actions={viewPlan === null ? null : <IconButton icon="Map" label="View plan" showLabel theme={theme} onPress={() => viewPlan(project, ticket)} />}
    />
  );
}

/** A past acceptance: how the user answered the delivery, or that the owner's question ended it. */
export function PastAcceptanceCard({ record, ticket, theme, compact }: { record: DeliveryRecord; ticket: string; theme: PluginTheme; compact: boolean }) {
  const view = deliveryCardView(record, formatClock);
  return <FinishedCard theme={theme} compact={compact} icon="PackageCheck" kind="Acceptance" subject={`${ticket} delivered`} outcome={view.outcome} tone={view.tone} time={view.time} words={view.words} />;
}
