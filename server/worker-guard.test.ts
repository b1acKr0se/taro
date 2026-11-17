import { describe, expect, it } from "vitest";

import type { PaseoApi } from "./host-types";
import { refuseDecisionWorker, refuseTicketWorker } from "./worker-guard";

/** A Paseo whose agents are the given labels by id. */
function paseoWith(agents: Record<string, Record<string, string>>, failing: readonly string[] = []): PaseoApi {
  return {
    agents: {
      ref: (id: string) => ({
        refresh: async () => {
          if (failing.includes(id)) throw new Error("socket closed");
          return agents[id] === undefined ? null : { agent: { id, labels: agents[id], title: null, archivedAt: null } };
        },
      }),
    },
  } as unknown as PaseoApi;
}

const labels = (ticket: string | null, role = "owner", project = "p") => ({ "taro.project": project, "taro.role": role, ...(ticket === null ? {} : { "taro.ticket": ticket }) });
const paseo = paseoWith({ owner: labels("TR-7"), sub: labels("TR-7", "reviewer"), manager: labels(null, "manager"), other: labels("TR-8"), plain: {}, kid: { "paseo.parent-agent-id": "owner" }, grandkid: { "paseo.parent-agent-id": "kid" }, stray: { "paseo.parent-agent-id": "other" } });

describe("refuseTicketWorker", () => {
  it("refuses the ticket's owner and subagents", async () => {
    await expect(refuseTicketWorker(paseo, "owner", "p", "TR-7", "ticket accept")).rejects.toThrow("ticket accept");
    await expect(refuseTicketWorker(paseo, "sub", "p", "TR-7", "ticket accept")).rejects.toThrow("own owner and subagents");
  });

  it("refuses an owner's child started without Taro labels, through its parent chain", async () => {
    await expect(refuseTicketWorker(paseo, "kid", "p", "TR-7", "ticket accept")).rejects.toThrow("own owner and subagents");
    await expect(refuseTicketWorker(paseo, "grandkid", "p", "TR-7", "ticket accept")).rejects.toThrow("own owner and subagents");
    await expect(refuseTicketWorker(paseo, "stray", "p", "TR-7", "ticket accept")).resolves.toBeUndefined();
  });

  it("refuses when the caller cannot be looked up, rather than letting an owner through", async () => {
    const failing = paseoWith({ owner: labels("TR-7") }, ["owner"]);
    await expect(refuseTicketWorker(failing, "owner", "p", "TR-7", "ticket accept")).rejects.toThrow("could not check");
  });

  it("lets another session through: the manager, another ticket's agent, an unlabelled or unknown agent, a button", async () => {
    for (const caller of ["manager", "other", "plain", "gone", undefined]) {
      await expect(refuseTicketWorker(paseo, caller, "p", "TR-7", "ticket accept")).resolves.toBeUndefined();
    }
  });
});

describe("refuseDecisionWorker", () => {
  const decision = { agentId: "owner", project: "p", ticket: "TR-7" };

  it("refuses the asking agent and the ticket's workers, never another session", async () => {
    await expect(refuseDecisionWorker(paseo, "owner", decision, "decision answer")).rejects.toThrow();
    await expect(refuseDecisionWorker(paseo, "sub", decision, "decision answer")).rejects.toThrow();
    await expect(refuseDecisionWorker(paseo, "plain", decision, "decision answer")).resolves.toBeUndefined();
    await expect(refuseDecisionWorker(paseo, "manager", { agentId: "owner", project: "p", ticket: null }, "decision dismiss")).resolves.toBeUndefined();
    await expect(refuseDecisionWorker(paseo, "manager", { agentId: "manager", project: "p", ticket: null }, "decision dismiss")).rejects.toThrow();
  });
});
