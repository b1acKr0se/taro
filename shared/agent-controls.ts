/**
 * What the composer's model and effort controls read, as Paseo's composer words them.
 * Ported from Paseo (v0.11.2, Apache-2.0): `formatThinkingOptionLabel` in
 * `packages/app/src/agent-controls/labels.ts`.
 */

/** "xhigh" is "Extra high", as Paseo words it; any other id is split at `_` and `-` and sentence-cased. */
export function thinkingLabel(id: string): string {
  const compact = id.replace(/[\s_-]+/g, "").toLowerCase();
  if (compact === "xhigh" || compact === "extrahigh") return "Extra high";
  const words = id
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return words === "" ? words : `${words.charAt(0).toUpperCase()}${words.slice(1).toLowerCase()}`;
}

/** Its effort: the one it was started with, else the model's own default (what it runs on when none was chosen); null when neither is known. */
export function effortOf(
  models: readonly { id: string; defaultThinking: string }[],
  agent: { provider: string; model: string | null; thinking: string | null },
): string | null {
  if (agent.thinking !== null && agent.thinking !== "") return agent.thinking;
  const listed = models.find((option) => option.id === `${agent.provider}/${agent.model}`);
  return listed === undefined || listed.defaultThinking === "" ? null : listed.defaultThinking;
}

/** The model as the provider names it ("Sonnet 5.5"); its raw id while the provider's list has no such model. */
export function modelName(
  models: readonly { id: string; modelLabel: string }[],
  agent: { provider: string; model: string | null },
): string | null {
  if (agent.model === null) return null;
  const listed = models.find((option) => option.id === `${agent.provider}/${agent.model}`);
  return listed === undefined || listed.modelLabel === "" ? agent.model : listed.modelLabel;
}
