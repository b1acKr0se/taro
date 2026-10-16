/**
 * The finished cards an owner's chat leaves (TR-149): a past plan, a past acceptance, a past question
 * and an answered permission ask, drawn from the pure views in finished-cards.ts with the one FinishedCard.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { memo } from "react";

import type { PermissionAsk } from "../shared/permission-asks";

import { FinishedCard } from "./finished-card";
import { deliveryCardView, permissionCardView, planCardView, samePermissionAsks, type DeliveryRecord, type QuestionCardView } from "./finished-cards";
import { formatClock } from "./format";
import { useViewPlan } from "./plan-navigation";
import type { PlanLine } from "./plan-lines";

/** A past plan; View plan opens it in the Taro screen (TR-061) and is left out elsewhere. */
export function PastPlanCard({ line, project, ticket, theme }: { line: PlanLine; project: string; ticket: string; theme: PluginTheme }) {
  const viewPlan = useViewPlan();
  const view = planCardView(line, formatClock);
  return (
    <FinishedCard
      theme={theme}
      subject={`Plan for ${ticket}`}
      outcome={view.outcome}
      tone={view.tone}
      time={view.time}
      words={view.words}
      action={viewPlan === null ? null : { label: "View plan", onPress: () => viewPlan(project, ticket) }}
    />
  );
}

/** A past acceptance: how the user answered the delivery, or that the owner's question ended it. */
export function PastAcceptanceCard({ record, ticket, theme }: { record: DeliveryRecord; ticket: string; theme: PluginTheme }) {
  const view = deliveryCardView(record, formatClock);
  return <FinishedCard theme={theme} subject={`${ticket} delivered`} outcome={view.outcome} tone={view.tone} time={view.time} words={view.words} />;
}

/** A question that was answered, withdrawn or asked again, left where its block was. */
export function PastQuestionCard({ card, theme }: { card: QuestionCardView; theme: PluginTheme }) {
  return <FinishedCard theme={theme} lead="Question" subject={card.subject} outcome={card.outcome} tone={card.tone} time={card.time} words={card.words} />;
}

/** An answered permission ask or tool question, where it was asked: who answered it how, and when. */
function PastPermissionCardView({ ask, theme }: { ask: PermissionAsk; theme: PluginTheme }) {
  const view = permissionCardView(ask, formatClock);
  return (
    <FinishedCard
      theme={theme}
      lead={view.kind}
      subject={view.subject}
      code={ask.kind !== "question" && ask.name === "Bash"}
      outcome={view.outcome}
      tone={view.tone}
      time={view.time}
      words={view.words}
    />
  );
}

/** Drawn between messages, outside their memoised rows: drawn again only when its ask changes. */
export const PastPermissionCard = memo(
  PastPermissionCardView,
  (previous, next) => samePermissionAsks([previous.ask], [next.ask]) && previous.theme === next.theme,
);
