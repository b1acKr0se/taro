import { describe, expect, it } from "vitest";

import { alreadyRecorded, unlabelledAlerts, unlabelledChildren, unlabelledRecord, type ChildAgent } from "./unlabelled-agents";

const owner = { id: "owner-1", ticket: "FF-021" };
const child = (overrides: Partial<ChildAgent>): ChildAgent => ({ id: "57bc922c-0000", title: "reviewer", status: "running", archivedAt: null, labels: { "paseo.parent-agent-id": "owner-1" }, ...overrides });

describe("unlabelledChildren", () => {
  it("finds a live child with no project label, as the retry reviewer started by a bare paseo run", () => {
    expect(unlabelledChildren(owner, [child({})])).toEqual([{ id: "57bc922c-0000", title: "reviewer", ticket: "FF-021", ownerId: "owner-1" }]);
  });

  it("leaves labelled, archived, closed and the owner's own entries out", () => {
    const children = [
      child({ id: "a", labels: { "paseo.parent-agent-id": "owner-1", "taro.project": "ff", "taro.role": "reviewer", "taro.ticket": "FF-021" } }),
      child({ id: "b", archivedAt: "2026-11-08T09:00:00Z" }),
      child({ id: "c", status: "closed" }),
      child({ id: "owner-1" }),
    ];
    expect(unlabelledChildren(owner, children)).toEqual([]);
  });

  it("treats an empty project label as missing and an absent archivedAt as live", () => {
    const { archivedAt: _omitted, ...bare } = child({ id: "d", labels: { "taro.project": "" } });
    expect(unlabelledChildren(owner, [bare]).map((agent) => agent.id)).toEqual(["d"]);
  });

  it("finds a child with only some of the labels, since the board lists none of them", () => {
    const partial = { "paseo.parent-agent-id": "owner-1", "taro.project": "ff" };
    const noTicket = { ...partial, "taro.role": "reviewer" };
    expect(unlabelledChildren(owner, [child({ id: "e", labels: partial }), child({ id: "f", labels: noTicket })]).map((agent) => agent.id)).toEqual(["e", "f"]);
  });

  it("finds none among no children", () => {
    expect(unlabelledChildren(owner, [])).toEqual([]);
  });
});

describe("alerts and records", () => {
  const [agent] = unlabelledChildren(owner, [child({})]);
  it("names the agent, the ticket and what is lost, one alert per agent", () => {
    const alerts = unlabelledAlerts(agent === undefined ? [] : [agent], new Set(["57bc922c-0000"]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.id).toBe("unlabelled-57bc922c-0000");
    expect(alerts[0]?.text).toContain("reviewer (57bc922c)");
    expect(alerts[0]?.text).toContain("FF-021");
    expect(alerts[0]?.text).toContain("permission ask");
  });

  it("does not say the owner was told until they were", () => {
    const text = unlabelledAlerts(agent === undefined ? [] : [agent], new Set())[0]?.text ?? "";
    expect(text).not.toContain("has been told");
    expect(text).toContain("tries again every minute");
  });

  it("falls back to the id when the agent has no title", () => {
    expect(unlabelledAlerts([{ id: "57bc922c-0000", title: null, ticket: "FF-021", ownerId: "o" }], new Set())[0]?.text).toMatch(/^57bc922c was started/);
  });

  it("recognises a recorded agent in the notes and no other", () => {
    const note = unlabelledRecord("2026-11-08T09:30Z", agent!);
    expect(note.startsWith("UNLABELLED 2026-11-08T09:30Z — reviewer (57bc922c)")).toBe(true);
    expect(alreadyRecorded(`MILESTONE x\n\n${note}`, "57bc922c-0000")).toBe(true);
    expect(alreadyRecorded(`MILESTONE mentions 57bc922c`, "57bc922c-0000")).toBe(false);
    expect(alreadyRecorded(note, "99999999-0000")).toBe(false);
    expect(alreadyRecorded(null, "57bc922c-0000")).toBe(false);
  });
});
