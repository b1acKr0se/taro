/** What the screen needs of an agent, and the model list for settings. */
import type { AgentBrief } from "../shared/contracts";
import type { PaseoAgent, PaseoApi } from "./host-types";

export function agentBrief(agent: PaseoAgent): AgentBrief {
  const usage = agent.lastUsage ?? null;
  return {
    id: agent.id,
    title: agent.title ?? null,
    status: agent.status,
    provider: agent.provider,
    model: agent.model ?? null,
    workspaceId: agent.workspaceId ?? null,
    pendingPermissions: agent.pendingPermissions.length,
    updatedAt: agent.updatedAt,
    contextUsedTokens: usage?.contextWindowUsedTokens ?? null,
    contextMaxTokens: usage?.contextWindowMaxTokens ?? null,
  };
}

export interface ModelOption {
  id: string;
  label: string;
  thinkingOptions: string[];
  defaultThinking: string;
}

/** Every selectable model of every available provider, as `provider/model`. */
export async function listModelOptions(paseo: PaseoApi): Promise<ModelOption[]> {
  const snapshot = await paseo.providers.snapshot();
  const options: ModelOption[] = [];
  for (const entry of snapshot.entries) {
    if (entry.status !== "ready" || !entry.enabled) continue;
    for (const model of entry.models ?? []) {
      if (model.isSelectable === false) continue;
      options.push({
        id: `${entry.provider}/${model.id}`,
        label: `${entry.label ?? entry.provider} · ${model.label}`,
        thinkingOptions: (model.thinkingOptions ?? []).map((option) => option.id),
        defaultThinking: model.defaultThinkingOptionId ?? "",
      });
    }
  }
  return options;
}
