import { describe, expect, it } from "vitest";

import { askerName, permissionHeading } from "./permission-heading";

describe("permissionHeading", () => {
  it("names a ticket's owner by the ticket", () => {
    const owner = { kind: "ticket", ticket: "NA-012", role: "owner" } as const;
    expect(permissionHeading(owner, "permission")).toBe("NA-012's owner is asking permission");
    expect(permissionHeading(owner, "question")).toBe("NA-012's owner is asking you");
    expect(permissionHeading(owner, "plan")).toBe("NA-012's owner has a plan for you to approve");
  });

  it("names a subagent by its job", () => {
    expect(askerName({ kind: "ticket", ticket: "NA-012", role: "reviewer" })).toBe("NA-012's reviewer");
    expect(askerName({ kind: "ticket", ticket: "NA-012", role: "implementer" })).toBe("NA-012's implementer");
    expect(askerName({ kind: "ticket", ticket: "NA-012", role: "researcher" })).toBe("NA-012's researcher");
  });

  it("names the manager", () => {
    expect(permissionHeading({ kind: "manager" }, "permission")).toBe("The manager is asking permission");
    expect(permissionHeading({ kind: "manager" }, "plan")).toBe("The manager has a plan for you to approve");
  });
});
