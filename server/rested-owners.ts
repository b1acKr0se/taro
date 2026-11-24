import { ownerRested } from "../shared/closed-owner";
import type { PaseoAgent } from "./host-types";
import type { PluginState } from "./state";

/** An owner Paseo lists as closed, marked when it only rested after an idle hour (`ownerRested`) rather than being cut off. */
export type OwnerAgent = PaseoAgent & { rested: boolean };

export async function markRestedOwners(agents: readonly PaseoAgent[], state: Pick<PluginState, "agent">): Promise<OwnerAgent[]> {
  return Promise.all(agents.map(async (agent) => Object.assign(agent, { rested: agent.status === "closed" && ownerRested(await state.agent(agent.id), agent.updatedAt) })));
}
