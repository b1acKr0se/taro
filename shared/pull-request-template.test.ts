// TR-250: a pull request body is checked against the default template's headings; a warning, never a gate.
import { describe, expect, it } from "vitest";

import { pullRequestBodyProblem, pullRequestBodyWarning, pullRequestTemplateWaived } from "./pull-request-template";

const templateBody = `Notes can be pinned to the top.

## What changed
- Pin from the menu

## Ticket
NA-001 — Pin notes (Taro tracker)

## Checks
- \`npm test\` — passed

## Evidence
- Screenshots: none — no visible change
`;
const check = (body: string, commitMessages: string[] = []) => pullRequestBodyProblem({ body, commitMessages });

describe("pullRequestBodyProblem", () => {
  it("passes a body with every heading, extra text and other levels or case included", () => {
    expect(check(templateBody)).toBeNull();
    expect(check(templateBody + "\n## Notes\nmore")).toBeNull();
    expect(check("### what changed\n#### TICKET ##\n# Checks\n## Evidence  ")).toBeNull();
  });

  it("says an empty or blank body is empty", () => {
    expect(check("")).toBe("is empty");
    expect(check(" \n\t\n")).toBe("is empty");
  });

  it("names each missing heading", () => {
    expect(check(templateBody.replace("## Ticket", "## Tickets"))).toBe("has no Ticket section");
    expect(check("## What changed\n- x")).toBe("has no Ticket, Checks, Evidence sections");
    expect(check("Just some prose about the change.")).toBe("has no What changed, Ticket, Checks, Evidence sections");
  });

  it("does not count the heading words written as plain lines", () => {
    expect(check("What changed\nTicket\nChecks\nEvidence")).toBe("has no What changed, Ticket, Checks, Evidence sections");
  });

  it("says a body copying a commit message repeats it, even with all the headings", () => {
    const message = "fix: pin notes\n\nPins stay on top of the list.";
    expect(check(message, [message])).toBe("repeats the commit message");
    expect(check("fix: pin notes", [message])).toBe("repeats the commit message");
    expect(check("Pins stay on top of the list.", [message])).toBe("repeats the commit message");
    expect(check(templateBody, [templateBody.trim()])).toBe("repeats the commit message");
    expect(check("Something different\n\n## What changed\n## Ticket\n## Checks\n## Evidence", [message])).toBeNull();
  });
});

describe("pullRequestTemplateWaived", () => {
  it("is true for a PR-TEMPLATE record, whatever its decoration", () => {
    expect(pullRequestTemplateWaived("PR-TEMPLATE 2026-01-01T10:00Z — the repo's contributing guide asks for a changelog body")).toBe(true);
    expect(pullRequestTemplateWaived("MILESTONE x\n\n**PR-TEMPLATE** 2026-01-01T10:00Z — why")).toBe(true);
  });

  it("is false without one, or when the word only appears inside text", () => {
    expect(pullRequestTemplateWaived(null)).toBe(false);
    expect(pullRequestTemplateWaived("MILESTONE 2026-01-01T10:00Z — add the PR-TEMPLATE record later")).toBe(false);
  });
});

describe("pullRequestBodyWarning", () => {
  it("says what is wrong and how to clear it", () => {
    expect(pullRequestBodyWarning("is empty")).toBe("The pull request description is empty, but the default template applies. Fix the description, or record why the template does not fit.");
  });
});
