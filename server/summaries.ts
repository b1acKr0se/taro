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
    createdAt: agent.createdAt ?? null,
  };
}

export interface ModelOption {
  id: string;
  label: string;
  thinkingOptions: string[];
  defaultThinking: string;
}

/** Providers that are enabled and not known to be broken (a provider still loading counts). */
export async function usableProviders(paseo: PaseoApi): Promise<{ provider: string; label: string }[]> {
  const snapshot = await paseo.providers.snapshot();
  return snapshot.entries
    .filter((entry) => entry.enabled && entry.status !== "unavailable" && entry.status !== "error")
    .map((entry) => ({ provider: entry.provider, label: entry.label ?? entry.provider }));
}

/** Every selectable model of every usable provider, as `provider/model`. A provider that cannot list is left out. */
export async function listModelOptions(paseo: PaseoApi): Promise<ModelOption[]> {
  const providers = await usableProviders(paseo);
  const lists = await Promise.all(
    providers.map(async ({ provider, label }) => {
      try {
        const result = await paseo.providers.listModels(provider);
        return (result.models ?? [])
          .filter((model) => model.isSelectable !== false)
          .map((model) => ({
            id: `${provider}/${model.id}`,
            label: `${label} · ${model.label}`,
            thinkingOptions: (model.thinkingOptions ?? []).map((option) => option.id),
            defaultThinking: model.defaultThinkingOptionId ?? "",
          }));
      } catch {
        return [];
      }
    }),
  );
  return lists.flat();
}
