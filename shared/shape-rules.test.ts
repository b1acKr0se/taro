import { describe, expect, it, vi } from "vitest";

import { buildGap } from "./approval-gate";
import { lacksPlan } from "./no-plan";
import { isShape, isSpecTask, ticketLevel } from "./ticket-level";

vi.mock("../server/projects", () => ({ projectPaths: async () => ({ tracker: "/tracker" }), readProjectConfig: async () => null }));
vi.mock("../server/evidence", () => ({ ticketEvidence: async () => ({ missing: [] }) }));
vi.mock("../server/tickets", () => ({
  viewTicket: async (_tracker: string, id: string) => ({ id, status: "Awaiting acceptance", labels: ["shape"], subtasks: [], acceptanceCriteria: [], implementationPlan: null, implementationNotes: null, finalSummary: "FINAL" }),
  listTickets: async () => [],
}));

const shape = (labels: string[]) => ({ status: "In Progress", plan: null, criteria: 0, labels, notes: null });

describe("shape rules", () => {
  it("shape builds without plan or approval, rated high or unrated", () => {
    for (const labels of [["shape"], ["shape", "complexity-high"], ["shape", "complexity-medium"]]) {
      expect(buildGap(shape(labels))).toBeNull();
      expect(lacksPlan(shape(labels))).toBe(false);
    }
    expect(buildGap(shape(["complexity-high"]))).toBe("no-plan");
  });

  it("shape delivery gaps have no plan gap", async () => {
    const { stepTicket } = await import("../server/next-step");
    const ticket = await stepTicket("taro", "TR-1");
    expect(ticket.deliveryGaps.some((gap) => gap.startsWith("the plan"))).toBe(false);
  });

  it("task is floored at medium", () => {
    expect(ticketLevel(["spec-task", "complexity-low"])).toBe("medium");
    expect(ticketLevel(["spec-task", "complexity-trivial"])).toBe("medium");
    expect(ticketLevel(["spec-task"])).toBe("medium");
    expect(ticketLevel(["spec-task", "complexity-medium"])).toBe("medium");
    expect(ticketLevel(["spec-task", "complexity-high"])).toBe("high");
    expect(ticketLevel(["complexity-low"])).toBe("low");
    expect(ticketLevel([])).toBeNull();
  });

  it("a spec task in Planning with an APPROVAL and a plan is not stopped, and one with no plan is told to plan, not to ask approval", () => {
    const notes = "APPROVAL 2026-11-01T10:30Z — by spec: \"SPEC.md\"";
    const task = { status: "Planning", criteria: 0, labels: ["spec-task"], notes };
    expect(buildGap({ ...task, plan: "## Goal\nx" })).toBeNull();
    expect(buildGap({ ...task, plan: null })).toBe("no-plan");
  });

  it("recognises the labels", () => {
    expect(isShape(["shape", "complexity-high"])).toBe(true);
    expect(isShape(["spec-task"])).toBe(false);
    expect(isShape([])).toBe(false);
    expect(isSpecTask(["spec-task"])).toBe(true);
    expect(isSpecTask([])).toBe(false);
  });
});
