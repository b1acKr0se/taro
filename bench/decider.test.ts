import { describe, expect, it } from "vitest";

import { answerEvents, awaitsAcceptance, choosesAction, DECIDER_RULES, deciderPrompt, parseReplies, parseReply, permissionVerdict, deleteDeciderAgent, isFatalDeciderError, releaseFailedKey, severalAnswerInput, severalCard, staleWaiting, WAITING_NOTICE_MS, type OpenDecision } from "./decider.ts";

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

const several: OpenDecision = {
  key: "agent:export-format",
  id: "export-format",
  question: "2 questions: Tag format · Attachments",
  why: "",
  blocking: true,
  status: "open",
  askedAt: "2026-10-20T12:00:00Z",
  options: [],
  recommended: "",
  reason: "",
  questions: [
    {
      header: "Tag format",
      question: "Should exported notes keep their tags as YAML front matter or as a hashtag line?",
      why: "Front matter is read by static site tools",
      options: [
        { label: "YAML front matter", prompt: "Write tags as YAML front matter", consequence: "site tools read it" },
        { label: "Hashtag line", prompt: "Write tags as a hashtag line at the top" },
      ],
      recommended: "YAML front matter",
      reason: "the notes are published through a site generator",
    },
    {
      header: "Attachments",
      question: "What should happen to images attached to notes?",
      why: "",
      options: [
        { label: "Copy beside each note", prompt: "Copy images beside each note" },
        { label: "Leave them out", prompt: "Leave images out of the export" },
      ],
      recommended: "Copy beside each note",
      reason: "an export should open without the app",
    },
  ],
};

describe("several questions on one card", () => {
  it("several questions: one block per question in order", () => {
    const prompt = deciderPrompt({ kind: "question", card: severalCard(several), spec: "SPEC", brief: "BRIEF", history: [], nonce: "n0nce", questions: 2 });
    const first = prompt.indexOf("Question 1 of 2 — Tag format:");
    const second = prompt.indexOf("Question 2 of 2 — Attachments:");
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(prompt.slice(first, second)).toContain("- YAML front matter (recommended) — site tools read it");
    expect(prompt.slice(first, second)).toContain("Why recommended: the notes are published through a site generator");
    expect(prompt.slice(second)).toContain("- Leave them out");
    ["answer 1: <", "text 1:", "preference 1:", "brief 1:", "answer 2: <", "text 2:", "preference 2:", "brief 2:"].forEach((part) => expect(prompt).toContain(part));
    expect(prompt.indexOf("answer 1: <")).toBeLessThan(prompt.indexOf("answer 2: <"));
    expect(prompt).not.toContain("choice: <");
  });
  it("one question: the prompt is unchanged", () => {
    const prompt = deciderPrompt({ kind: "question", card: "Question: Which?\nOptions:\n- A", spec: "SPEC", brief: "BRIEF", history: ['- plan "x" → Approve'], nonce: "n0nce" });
    // Captured from the code before several questions were added.
    const before = "\n\nSPEC:\nSPEC\n\nBRIEF the owner was given:\nBRIEF\n\nDecided so far:\n- plan \"x\" → Approve\n\nTHE CARD (question):\nQuestion: Which?\nOptions:\n- A\n\nBegin your final reply with a line that is exactly \"REPLY n0nce\", then these four lines and nothing else:\nchoice: <choice is one option's exact label, or Other>\ntext: <the words to type, one line; empty when none>\npreference: <P1, P2 ... or none>\nbrief: <yes or no>";
    expect(prompt).toBe(DECIDER_RULES + before);
  });
});

describe("parseReplies", () => {
  const log = (body: string) => `\nthinking\nREPLY abc123\n${body}\n`;
  const three = "answer 1: A\ntext 1: one\npreference 1: P1\nbrief 1: no\nanswer 2: Other\ntext 2: my words\npreference 2: none\nbrief 2: yes\nanswer 3: C\ntext 3:\npreference 3: P2\nbrief 3: no";
  it("reads three answers", () => {
    expect(parseReplies(log(three), "abc123", 3)).toEqual([
      { choice: "A", text: "one", preference: "P1", briefAnswered: false },
      { choice: "Other", text: "my words", preference: "none", briefAnswered: true },
      { choice: "C", text: "", preference: "P2", briefAnswered: false },
    ]);
  });
  it("null when one answer is missing", () => {
    expect(parseReplies(log(three.replace("answer 2: Other", "answer 2:")), "abc123", 3)).toBeNull();
    expect(parseReplies(log("answer 1: A\nanswer 2: B"), "abc123", 3)).toBeNull();
    expect(parseReplies("\nanswer 1: A", "abc123", 1)).toBeNull();
  });
  it("strips (recommended)", () => {
    expect(parseReplies(log("answer 1: Copy beside each note (recommended)\nanswer 2: B"), "abc123", 2)?.map((reply) => reply.choice)).toEqual(["Copy beside each note", "B"]);
  });
});

describe("severalAnswerInput", () => {
  it("maps labels and Other to answers in order", () => {
    expect(
      severalAnswerInput(several, [
        { choice: "yaml front matter", text: "", preference: "none", briefAnswered: false },
        { choice: "Other", text: "Only PNG files", preference: "P1", briefAnswered: false },
      ]).answers,
    ).toEqual([
      { header: "Tag format", label: "YAML front matter", text: "Write tags as YAML front matter" },
      { header: "Attachments", label: null, text: "Only PNG files" },
    ]);
  });

  it("keeps words typed beside a chosen option, and falls back to the label without a prompt", () => {
    const answers = severalAnswerInput(several, [
      { choice: "Hashtag line", text: "but put it last", preference: "none", briefAnswered: false },
      { choice: "Skip", text: "", preference: "none", briefAnswered: false },
    ]).answers;
    expect(answers[0]).toEqual({ header: "Tag format", label: "Hashtag line", text: "but put it last" });
    expect(answers[1]?.text).not.toBe("");
  });

  it("maps the whole input", () => {
    expect(
      severalAnswerInput(several, [
        { choice: "yaml front matter", text: "", preference: "none", briefAnswered: false },
        { choice: "Other", text: "Only PNG files", preference: "P1", briefAnswered: false },
      ]),
    ).toEqual({
      key: "agent:export-format",
      label: null,
      text: "",
      from: "screen",
      answers: [
        { header: "Tag format", label: "YAML front matter", text: "Write tags as YAML front matter" },
        { header: "Attachments", label: null, text: "Only PNG files" },
      ],
    });
  });
});

describe("answerEvents", () => {
  it("one answer event per question", () => {
    const events = answerEvents(
      several,
      [
        { choice: "YAML front matter", text: "", preference: "P2", briefAnswered: true },
        { choice: "Other", text: "Only PNG", preference: "none", briefAnswered: false },
      ],
      "rpc",
      "2026-10-20T12:01:00Z",
    );
    expect(events).toEqual([
      { type: "answer", at: "2026-10-20T12:01:00Z", kind: "question", id: "export-format#Tag format", via: "rpc", choice: "YAML front matter", text: "", preference: "P2", briefAnswered: true },
      { type: "answer", at: "2026-10-20T12:01:00Z", kind: "question", id: "export-format#Attachments", via: "rpc", choice: "Other", text: "Only PNG", preference: "none", briefAnswered: false },
    ]);
  });
});

describe("releaseFailedKey", () => {
  const at = "2026-10-20T12:00:00Z";
  it("drops the key so the card is asked again, and returns a violation to log", () => {
    const handled = new Set(["agent:export-format@t1", "other"]);
    const event = releaseFailedKey(handled, new Map(), "agent:export-format@t1", new Error("rpc failed: boom\nmore"), at);
    expect(handled.has("agent:export-format@t1")).toBe(false);
    expect(handled.has("other")).toBe(true);
    expect(event).toEqual({ type: "violation", at, kind: "card-unanswered", detail: "agent:export-format@t1 could not be answered on screen or over RPC (attempt 1 of 3): rpc failed: boom" });
  });

  it("gives up on a card after 3 attempts: the key stays handled and the last violation says so, once", () => {
    const handled = new Set(["k"]);
    const attempts = new Map<string, number>();
    const events = [1, 2, 3].map(() => {
      handled.add("k");
      return releaseFailedKey(handled, attempts, "k", new Error("boom"), at);
    });
    expect(events.map((event) => event.detail.includes("giving up"))).toEqual([false, false, true]);
    expect(handled.has("k")).toBe(true);
  });

  it("counts each key on its own", () => {
    const handled = new Set(["a", "b"]);
    const attempts = new Map<string, number>();
    [1, 2].forEach(() => releaseFailedKey(handled, attempts, "a", new Error("x"), at));
    releaseFailedKey(handled, attempts, "b", new Error("x"), at);
    expect(handled.has("b")).toBe(false);
  });
});

describe("isFatalDeciderError", () => {
  it("only an unreadable reply ends the decider; any other pass failure is logged and retried", () => {
    expect(isFatalDeciderError(new Error("the decider gave no readable reply for scope-approval"))).toBe(true);
    expect(isFatalDeciderError(new Error("rpc taro.decision.answer failed: boom"))).toBe(false);
    expect(isFatalDeciderError("locator timed out")).toBe(false);
  });
});

describe("deleteDeciderAgent", () => {
  it("runs paseo delete on the daemon home and logs a non-zero exit", async () => {
    const calls: string[][] = [];
    const lines: string[] = [];
    const runner = async (command: string, args: readonly string[]) => {
      calls.push([command, ...args]);
      return { code: 1, stderr: "agent busy\n" };
    };
    await deleteDeciderAgent(runner, ["--home", "/tmp/taro-bench-home.x"], "agent-1", (line) => lines.push(line));
    expect(calls).toEqual([["paseo", "delete", "agent-1", "--home", "/tmp/taro-bench-home.x"]]);
    expect(lines).toEqual(["decider: paseo delete agent-1 exited 1: agent busy"]);
  });
  it("is silent when the delete succeeds", async () => {
    const lines: string[] = [];
    await deleteDeciderAgent(async () => ({ code: 0, stderr: "" }), [], "agent-1", (line) => lines.push(line));
    expect(lines).toEqual([]);
  });
});
