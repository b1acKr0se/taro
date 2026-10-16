import { describe, expect, it } from "vitest";

import { askFromRequest, keptAsks, PermissionAskSchema, resolveAsk, type PermissionAsk } from "./permission-asks";

const AT = "2026-10-16T10:00:00.000Z";
const LATER = "2026-10-16T10:01:00.000Z";
const DAY = 24 * 60 * 60 * 1000;

function ask(request: Parameters<typeof askFromRequest>[1]): PermissionAsk {
  return askFromRequest("agent-1", request, AT);
}

describe("askFromRequest", () => {
  it("records a Bash ask by its command, open", () => {
    const made = ask({ id: "p-1", name: "Bash", kind: "tool", title: "Run a command", input: { command: "rm -rf /tmp/x" } });
    expect(made).toEqual({ agentId: "agent-1", requestId: "p-1", kind: "tool", name: "Bash", subject: "rm -rf /tmp/x", askedAt: AT, answeredAt: null, outcome: null, by: null, rule: null, words: null });
    expect(PermissionAskSchema.parse(made)).toEqual(made);
  });

  it("records another tool by its title, then its description, then its name", () => {
    expect(ask({ id: "p", name: "Write", kind: "tool", title: "Write notes.md", description: "Create a file", input: { file_path: "/x" } }).subject).toBe("Write notes.md");
    expect(ask({ id: "p", name: "Write", kind: "tool", title: " ", description: "Create a file" }).subject).toBe("Create a file");
    expect(ask({ id: "p", name: "Write", kind: "tool" }).subject).toBe("Write");
  });

  it("falls back to the title when a Bash ask has no command", () => {
    expect(ask({ id: "p", name: "Bash", kind: "tool", title: "Run", input: {} }).subject).toBe("Run");
  });

  it("records a question by its questions' text", () => {
    const made = ask({
      id: "p",
      name: "AskUserQuestion",
      kind: "question",
      title: "Question",
      input: { questions: [{ question: "Which database?", header: "Database" }, { question: "Which port?", header: "Port" }, "junk"] },
    });
    expect(made.subject).toBe("Which database? Which port?");
    expect(ask({ id: "p", name: "AskUserQuestion", kind: "question", title: "Question", input: {} }).subject).toBe("Question");
  });

  it("keeps the subject on one line, cut to 200 characters", () => {
    expect(ask({ id: "p", name: "Bash", kind: "tool", input: { command: "echo a\n  echo b" } }).subject).toBe("echo a echo b");
    const long = ask({ id: "p", name: "Bash", kind: "tool", input: { command: "x".repeat(300) } }).subject;
    expect(long).toHaveLength(200);
    expect(long.endsWith("…")).toBe(true);
    expect(ask({ id: "p", name: "Bash", kind: "tool", input: { command: "y".repeat(200) } }).subject).toBe("y".repeat(200));
  });
});

describe("resolveAsk", () => {
  const bash = ask({ id: "p-1", name: "Bash", kind: "tool", input: { command: "rm -rf /tmp/x" } });

  it("records an allow by the user", () => {
    expect(resolveAsk(bash, { behavior: "allow" }, LATER, null)).toMatchObject({ answeredAt: LATER, outcome: "allowed", by: "you", rule: null, words: null });
  });

  it("keeps the user's words with a denial, but not a button's canned message", () => {
    expect(resolveAsk(bash, { behavior: "deny", message: "  use the scratch folder  " }, LATER, null)).toMatchObject({ outcome: "denied", by: "you", words: "use the scratch folder" });
    expect(resolveAsk(bash, { behavior: "deny", message: "Denied by the user from the Taro panel." }, LATER, null).words).toBeNull();
    expect(resolveAsk(bash, { behavior: "deny" }, LATER, null).words).toBeNull();
  });

  it("does not quote Paseo's own Deny button as the user's words", () => {
    expect(resolveAsk(bash, { behavior: "deny", message: "Denied by user" }, LATER, null)).toMatchObject({ outcome: "denied", by: "you", words: null });
  });

  it("records an ask Paseo turned down as its turn ended as cancelled, by nobody", () => {
    ["Permission request canceled", "Interrupted", "Removed by rewind"].forEach((message) => {
      expect(resolveAsk(bash, { behavior: "deny", message }, LATER, null)).toMatchObject({ answeredAt: LATER, outcome: "cancelled", by: null, rule: null, words: null });
    });
    expect(resolveAsk(bash, { behavior: "deny", message: "Interrupted twice" }, LATER, null)).toMatchObject({ outcome: "denied", words: "Interrupted twice" });
    expect(PermissionAskSchema.parse(resolveAsk(bash, { behavior: "deny", message: "Interrupted" }, LATER, null)).outcome).toBe("cancelled");
  });

  it("records a denial by the rules with its rule, without their long message", () => {
    expect(resolveAsk(bash, { behavior: "deny", message: "The plugin denied … rule `top-level` …" }, LATER, { rule: "top-level" })).toMatchObject({ outcome: "denied", by: "rules", rule: "top-level", words: null });
    expect(resolveAsk(bash, { behavior: "allow" }, LATER, { rule: "scratch-or-worktree" })).toMatchObject({ outcome: "allowed", by: "rules", rule: "scratch-or-worktree" });
  });

  it("records a question's answers as header: answer", () => {
    const question = ask({ id: "p", name: "AskUserQuestion", kind: "question", input: { questions: [{ question: "Which?", header: "Database" }] } });
    const answered = resolveAsk(question, { behavior: "allow", updatedInput: { questions: [], answers: { Database: "Postgres", Port: "5432", Empty: "" } } }, LATER, null);
    expect(answered).toMatchObject({ outcome: "allowed", by: "you", words: "Database: Postgres; Port: 5432" });
    expect(resolveAsk(question, { behavior: "allow", updatedInput: {} }, LATER, null).words).toBeNull();
    expect(resolveAsk(question, { behavior: "deny", message: "Dismissed by user" }, LATER, null)).toMatchObject({ outcome: "denied", words: null });
  });
});

describe("keptAsks", () => {
  const now = Date.parse("2026-11-01T00:00:00.000Z");
  const at = (ago: number) => new Date(now - ago).toISOString();
  const open = (ago: number): PermissionAsk => ({ ...ask({ id: `open-${ago}`, name: "Bash", kind: "tool" }), askedAt: at(ago) });
  const answered = (ago: number): PermissionAsk => ({ ...open(ago + 20 * DAY), requestId: `answered-${ago}`, answeredAt: at(ago), outcome: "allowed", by: "you" });

  it("is empty for no asks", () => {
    expect(keptAsks([], now)).toEqual([]);
  });

  it("drops asks exactly 14 days old or older, by their answer or else their ask", () => {
    const kept = keptAsks([open(14 * DAY - 1), open(14 * DAY), open(15 * DAY), answered(14 * DAY - 1), answered(14 * DAY)], now);
    expect(kept.map((each) => each.requestId)).toEqual([`open-${14 * DAY - 1}`, `answered-${14 * DAY - 1}`]);
  });
});
