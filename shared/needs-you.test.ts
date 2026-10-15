import { describe, expect, it } from "vitest";

import { askerPrefix, deliveredLine, firstAsk, permissionAsk, plainText } from "./needs-you";

describe("permissionAsk", () => {
  it("names a tool by its title and the command it runs", () => {
    expect(permissionAsk({ name: "Bash", kind: "tool", title: "Run a command", input: { command: "npm install --save-dev vitest" } })).toEqual({
      title: "Run a command",
      detail: "npm install --save-dev vitest",
    });
  });

  it("asks to allow the tool by name without a title, acting on a file, an address or the description", () => {
    expect(permissionAsk({ name: "Bash", kind: "tool", input: { command: "ls" } })).toEqual({ title: "Allow Bash?", detail: "ls" });
    expect(permissionAsk({ name: "Edit", kind: "tool", input: { file_path: "/repo/src/index.ts" } })).toEqual({ title: "Allow Edit?", detail: "/repo/src/index.ts" });
    expect(permissionAsk({ name: "WebFetch", kind: "tool", input: { url: "https://example.com" } })).toEqual({ title: "Allow WebFetch?", detail: "https://example.com" });
    expect(permissionAsk({ name: "Custom", kind: "tool", description: "Writes the cache" })).toEqual({ title: "Allow Custom?", detail: "Writes the cache" });
    expect(permissionAsk({ name: "Custom", kind: "tool" })).toEqual({ title: "Allow Custom?", detail: null });
  });

  it("keeps the first line of a multi-line command", () => {
    expect(permissionAsk({ name: "Bash", kind: "tool", input: { command: "\n  cd /repo\nnpm test" } }).detail).toBe("cd /repo");
  });

  it("cuts a very long command", () => {
    const detail = permissionAsk({ name: "Bash", kind: "tool", input: { command: "x".repeat(500) } }).detail ?? "";
    expect(detail.length).toBe(240);
    expect(detail.endsWith("…")).toBe(true);
  });

  it("shows a question form's first question as what is asked", () => {
    const request = { name: "AskUserQuestion", kind: "question", input: { questions: [{ question: "Which port range?" }, { question: "Second?" }] } };
    expect(permissionAsk(request)).toEqual({ title: "Which port range?", detail: null });
  });

  it("treats a question form without questions as a tool", () => {
    expect(permissionAsk({ name: "AskUserQuestion", kind: "question", input: { questions: [] } })).toEqual({ title: "Allow AskUserQuestion?", detail: null });
  });

  it("shows a plan's first line", () => {
    expect(permissionAsk({ name: "ExitPlanMode", kind: "plan", input: { plan: "# Plan\n1. Do it" } })).toEqual({ title: "Approve the plan", detail: "# Plan" });
  });
});

describe("deliveredLine", () => {
  it("is null without a summary", () => {
    expect(deliveredLine(null)).toBeNull();
    expect(deliveredLine("")).toBeNull();
    expect(deliveredLine("FINAL 2026-10-13T17:50Z —\n\n")).toBeNull();
  });

  it("drops the record header and keeps the first sentence", () => {
    expect(deliveredLine("FINAL 2026-10-13T17:50Z — Manager questions are cards in Needs you. Suggestions sit at the composer.")).toBe(
      "Manager questions are cards in Needs you.",
    );
  });

  it("skips blank lines, rules and Markdown markers", () => {
    expect(deliveredLine("\n---\n## **Delivered**: the `board` strip is gone\nmore")).toBe("Delivered: the board strip is gone");
    expect(deliveredLine("- First bullet\n- Second")).toBe("First bullet");
  });

  it("reads the first What changed bullet of a FINAL in the template's format", () => {
    const final = "FINAL 2026-10-14T08:41Z\n\n## What changed\n- The list shows `recent` projects first. Then more.\n- Second\n\nRevision: abc1234 · PR: none";
    expect(deliveredLine(final)).toBe("The list shows recent projects first.");
    expect(deliveredLine("FINAL 2026-10-14T08:41Z\nRevision: abc1234 · PR: none\n\n**What changed**\n- First change")).toBe("First change");
  });

  it("keeps a sentence whole when no capital follows the full stop", () => {
    expect(deliveredLine("Bumped to v1.2 and e.g. kept the API")).toBe("Bumped to v1.2 and e.g. kept the API");
  });
});

describe("deliveredLine as plain text (TR-048)", () => {
  it("drops HTML the summary quotes, and the brackets it leaves empty", () => {
    expect(
      deliveredLine(
        'FINAL 2026-10-14T06:22Z — The README opens with the logo, centred at 120 px above the title (<p align="center"><img src="assets/logo.svg" width="120" alt="Logo"></p>). Revision 29ab312.',
      ),
    ).toBe("The README opens with the logo, centred at 120 px above the title.");
  });

  it("skips a first line that is only markup", () => {
    expect(deliveredLine('<p align="center">\n  <img src="assets/logo.svg" width="120">\n</p>\n\nThe logo sits on top.')).toBe("The logo sits on top.");
    expect(deliveredLine("```ts\nconst x = 1;\n```\nShipped the parser.")).toBe("const x = 1;");
    expect(deliveredLine("***\n> **Delivered** the export")).toBe("Delivered the export");
  });

  it("is null when nothing but markup was written", () => {
    expect(deliveredLine("<br>\n<!-- note -->\n---")).toBeNull();
  });

  it("cuts the plain text, not the markup, to its limit", () => {
    const line = deliveredLine(`<b>${"word ".repeat(80)}</b>`);
    expect(line).toHaveLength(240);
    expect(line?.endsWith("…")).toBe(true);
    expect(line).not.toContain("<b>");
  });
});

describe("plainText", () => {
  it("reads links by their text and images by their alt text", () => {
    expect(plainText("See [the guide](https://example.com/guide) and ![a chart](chart.png)")).toBe("See the guide and a chart");
    expect(plainText("Logo: ![](logo.svg) done")).toBe("Logo: done");
  });

  it("drops emphasis, strike-through and code marks but keeps the words", () => {
    expect(plainText("**Bold**, __strong__, *soft*, _quiet_, ~~gone~~ and `npm test` or ``a`b``")).toBe("Bold, strong, soft, quiet, gone and npm test or ab");
  });

  it("leaves a lone asterisk or underscore inside words alone", () => {
    expect(plainText("5 * 3 in file_name and snake_case_name")).toBe("5 * 3 in file_name and snake_case_name");
  });

  it("drops tags and comments, decodes entities, and collapses whitespace", () => {
    expect(plainText('A <span class="x">tag</span>,<br/>  a <!-- note --> comment &amp; &lt;p&gt; &#169; &#x2014; &bogus;')).toBe("A tag, a comment & <p> © — &bogus;");
    expect(plainText("an out-of-range &#99999999; stays")).toBe("an out-of-range &#99999999; stays");
  });

  it("keeps brackets that hold something, and a sentence's closing stop", () => {
    expect(plainText("Revision (29ab312) [main] ( ) [ ] .")).toBe("Revision (29ab312) [main].");
  });

  it("is empty for empty input", () => {
    expect(plainText("")).toBe("");
    expect(plainText("   ")).toBe("");
  });
});

describe("firstAsk (TR-096)", () => {
  const request = (id: string, command: string) => ({ id, name: "Bash", kind: "tool", input: { command } });
  const asking = (id: string, role: string, requests: ReturnType<typeof request>[], workspaceId?: string) => ({
    id,
    labels: { "taro.project": "notes-app", "taro.role": role, "taro.ticket": "NA-1" },
    workspaceId,
    pendingPermissions: requests,
  });

  it("is null when nobody asks", () => {
    expect(firstAsk([])).toBeNull();
    expect(firstAsk([asking("owner-1", "owner", [])])).toBeNull();
  });

  it("gives the first asker's first request, who asks, and every request counted", () => {
    const ask = firstAsk([asking("researcher-1", "researcher", [request("p1", "npm test"), request("p2", "ls")], "workspace-1"), asking("reviewer-1", "reviewer", [request("p3", "git log")])]);
    expect(ask).toEqual({ title: "Allow Bash?", detail: "npm test", id: "p1", agentId: "researcher-1", role: "researcher", workspaceId: "workspace-1", count: 3 });
  });

  it("skips an agent whose requests cleared, and reads a missing role or input", () => {
    const ask = firstAsk([asking("owner-1", "owner", []), { id: "x", labels: {}, pendingPermissions: [{ id: "p9", name: "Edit", kind: "tool", input: null }] }]);
    expect(ask).toMatchObject({ title: "Allow Edit?", detail: null, agentId: "x", role: null, workspaceId: null, count: 1 });
  });

  it("names a subagent or the Manager, never the owner whose card it is", () => {
    expect(askerPrefix("researcher")).toBe("Researcher asks");
    expect(askerPrefix("implementer")).toBe("Implementer asks");
    expect(askerPrefix("manager")).toBe("Manager asks");
    expect(askerPrefix("owner")).toBeNull();
    expect(askerPrefix(null)).toBeNull();
  });
});
