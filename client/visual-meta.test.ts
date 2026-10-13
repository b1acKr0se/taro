import { describe, expect, it } from "vitest";

import { phaseLook, recordKindLook, statusStateLook } from "./visual-meta";

describe("recordKindLook", () => {
  it("gives the known record kinds their icon and tone", () => {
    expect(recordKindLook("MILESTONE")).toEqual({ icon: "Flag", tone: "accent" });
    expect(recordKindLook("APPROVAL")).toEqual({ icon: "ThumbsUp", tone: "success" });
    expect(recordKindLook("ACCEPTANCE")).toEqual({ icon: "CircleCheck", tone: "success" });
    expect(recordKindLook("RECOVERY")).toEqual({ icon: "LifeBuoy", tone: "warning" });
    expect(recordKindLook("DISPATCH-INTENT").icon).toBe("Send");
    expect(recordKindLook("HANDOFF").icon).toBe("ArrowRightLeft");
  });

  it("falls back to a muted dot for any other kind", () => {
    expect(recordKindLook("NOTE")).toEqual({ icon: "Dot", tone: "muted" });
    expect(recordKindLook("milestone")).toEqual({ icon: "Dot", tone: "muted" });
  });
});

describe("phaseLook", () => {
  it("colours work under way with the accent and the rest by what it asks", () => {
    expect(phaseLook("Planning")).toEqual({ icon: "PencilRuler", tone: "accent" });
    expect(phaseLook("In Progress")).toEqual({ icon: "Hammer", tone: "accent" });
    expect(phaseLook("Reviewing")).toEqual({ icon: "Eye", tone: "accent" });
    expect(phaseLook("Awaiting acceptance")).toEqual({ icon: "Hourglass", tone: "warning" });
    expect(phaseLook("Blocked")).toEqual({ icon: "Ban", tone: "danger" });
    expect(phaseLook("Done")).toEqual({ icon: "CircleCheck", tone: "success" });
  });

  it("draws other statuses as a muted circle", () => {
    expect(phaseLook("Backlog")).toEqual({ icon: "Circle", tone: "muted" });
    expect(phaseLook("Something new")).toEqual({ icon: "Circle", tone: "muted" });
  });
});

describe("statusStateLook", () => {
  it("has an icon for every status state", () => {
    expect(statusStateLook("waiting").icon).toBe("Clock");
    expect(statusStateLook("blocked")).toEqual({ icon: "CircleAlert", tone: "danger" });
    expect(statusStateLook("done").icon).toBe("Check");
    expect(statusStateLook("failed").icon).toBe("X");
  });
});
