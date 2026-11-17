/** Each user-only RPC's handler calls the worker guard first: a removed call would let a ticket's owner accept its own work. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(import.meta.dirname, "..", "index.server.ts"), "utf8");

describe("worker guard wiring", () => {
  it.each([
    ["acceptTicket", "refuseTicketWorker"],
    ["reopenTicket", "refuseTicketWorker"],
    ["requestChanges", "refuseTicketWorker"],
    ["changeQueuedSpec", "refuseTicketWorker"],
    ["closeRound", "refuseTicketWorker"],
    ["answerDecision", "refuseDecisionWorker"],
    ["dismissManagerQuestionRpc", "refuseDecisionWorker"],
  ])("%s calls %s before acting", (rpc, guard) => {
    const start = source.indexOf(`server.handle(${rpc},`);
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\n  });", start));
    expect(body).toContain("caller");
    expect(body.indexOf(guard)).toBeGreaterThan(-1);
    expect(body.indexOf(guard)).toBeLessThan(body.indexOf("actions."));
  });
});
