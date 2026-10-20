import { describe, expect, it } from "vitest";

import { awaitsAcceptance, choosesAction, deciderPrompt, parseReply, permissionVerdict, staleWaiting, WAITING_NOTICE_MS } from "./decider.ts";

describe("parseReply", () => {
  const log = (body: string) => `\nsome thinking\nREPLY abc123\n${body}\n`;
  it("reads the four fields after the nonce line", () => {
    expect(parseReply(log("choice: Approve\ntext: \npreference: none\nbrief: no"), "abc123")).toEqual({ choice: "Approve", text: "", preference: "none", briefAnswered: false });
  });
  it("reads a question reply with a preference and a brief hit", () => {
    expect(parseReply(log("choice: Slug of the title\ntext: Lowercase it.\npreference: P1\nbrief: yes"), "abc123")).toEqual({ choice: "Slug of the title", text: "Lowercase it.", preference: "P1", briefAnswered: true });
  });
  it("drops a (recommended) tag the card showed", () => {
    expect(parseReply(log("choice: Note id (recommended)\ntext:\npreference: none\nbrief: no"), "abc123")?.choice).toBe("Note id");
  });
  it("is null without the nonce line (another turn's text) or without a choice", () => {
    expect(parseReply("\nchoice: Approve\n", "abc123")).toBeNull();
    expect(parseReply(log("text: hello"), "abc123")).toBeNull();
    expect(parseReply(log("choice:"), "abc123")).toBeNull();
  });
  it("takes the last reply when the nonce is repeated", () => {
    expect(parseReply(`\nREPLY abc123\nchoice: Other\n\nREPLY abc123\nchoice: Approve`, "abc123")?.choice).toBe("Approve");
  });
});

describe("choosesAction", () => {
  it("ignores case, an ellipsis and a full stop", () => {
    expect(choosesAction("Approve", "Approve")).toBe(true);
    expect(choosesAction(" accept. ", "Accept")).toBe(true);
    expect(choosesAction("Request changes…", "Approve")).toBe(false);
  });
});

describe("awaitsAcceptance", () => {
  const ticket = (status: string, notes: string) => `---\nstatus: "${status}"\n---\n<!-- taro:notes -->\n${notes}\n<!-- /taro:notes -->`;
  it("is true for a delivered ticket not yet accepted", () => {
    expect(awaitsAcceptance(ticket("Awaiting acceptance", "EVIDENCE x"))).toBe(true);
  });
  it("is false once accepted, or in another status", () => {
    expect(awaitsAcceptance(ticket("Awaiting acceptance", "ACCEPTED 2026 — merging"))).toBe(false);
    expect(awaitsAcceptance(ticket("In Progress", ""))).toBe(false);
  });
});

describe("deciderPrompt", () => {
  it("carries the rules, the spec, the brief, the history, the card and the reply format", () => {
    const prompt = deciderPrompt({ kind: "question", card: "Question: Which?", spec: "SPEC TEXT", brief: "BRIEF TEXT", history: ['- plan "x" → Approve'], nonce: "n0nce" });
    ["never write code", "SPEC TEXT", "BRIEF TEXT", '- plan "x" → Approve', "Question: Which?", 'exactly "REPLY n0nce"', "choice is one option's exact label, or Other"].forEach((part) => expect(prompt.toLowerCase()).toContain(part.toLowerCase()));
  });
});

describe("permissionVerdict", () => {
  it("allows a command on the scratch project, even one with cd and rm in /tmp", () => {
    expect(permissionVerdict("Allow Bash?\ncd /tmp/taro-bench-home.Ab12/worktrees/x/na-001; python3 - <<'EOF'\nEOF\nrm -rf /tmp/na001-shots")).toBe("allow");
  });
  it("denies a command that reaches the real daemon or its home", () => {
    expect(permissionVerdict("Allow Bash?\npaseo daemon restart --host 127.0.0.1:6767")).toBe("deny");
    expect(permissionVerdict("Allow Bash?\nrm -rf ~/.paseo/worktrees")).toBe("deny");
    expect(permissionVerdict("Allow Bash?\nls /root/.paseo/plugin-data")).toBe("deny");
  });
});

describe("staleWaiting", () => {
  const now = Date.parse("2026-01-05T12:00:00Z");
  const waited = (minutes: number) => ({ state: "waiting", at: new Date(now - minutes * 60_000).toISOString() });
  it("returns the status time once the owner has waited long enough", () => {
    expect(staleWaiting({ status: "In Progress", ownerRunning: false, lastStatus: waited(9) }, now)).toBe(waited(9).at);
    expect(staleWaiting({ status: "Planning", lastStatus: waited(WAITING_NOTICE_MS / 60_000) }, now)).not.toBeNull();
  });
  it("is null when the wait is short, the owner is running, or the status is not waiting", () => {
    expect(staleWaiting({ status: "In Progress", lastStatus: waited(3) }, now)).toBeNull();
    expect(staleWaiting({ status: "In Progress", ownerRunning: true, lastStatus: waited(30) }, now)).toBeNull();
    expect(staleWaiting({ status: "In Progress", lastStatus: { state: "working", at: waited(30).at } }, now)).toBeNull();
    expect(staleWaiting({ status: "In Progress", lastStatus: null }, now)).toBeNull();
  });
  it("leaves a delivered or finished ticket to its own card", () => {
    expect(staleWaiting({ status: "Awaiting acceptance", lastStatus: waited(30) }, now)).toBeNull();
    expect(staleWaiting({ status: "Done", lastStatus: waited(30) }, now)).toBeNull();
  });
});
