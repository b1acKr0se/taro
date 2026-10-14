import { describe, expect, it } from "vitest";

import {
  ANSWER_PLACEHOLDER,
  answeredInPlan,
  CHANGE_PLACEHOLDER,
  READ_ONLY_NOTES,
  answerPlaceholder,
  askedBy,
  decisionBlockView,
  decisionOptionRows,
  decisionSubmit,
  decisionTimelineItems,
  isChangeOption,
  optionAsksForWords,
  optionChips,
  planCardOptions,
  planChangeField,
  planPrimaryButton,
  ticketViewApproval,
  untrackedDecision,
  type DecisionLookup,
} from "./decision-view";
import { parsePlan } from "./plan";
import { decisionMessageSegments, parseDecisionBody, type ParsedDecision } from "./reports";
import type { StoredDecision } from "./state";

const block = (id: string, question = "Approve?") =>
  ["```decision", `id: ${id}`, `question: ${question}`, "options:", "  - label: Yes", "    prompt: Yes please", "recommended: Yes", "```"].join("\n");

function stored(decision: ParsedDecision, change: Partial<StoredDecision> = {}): StoredDecision {
  return { ...untrackedDecision(decision, "agent-1"), key: `agent-1:${decision.id}`, project: "p", ...change };
}

describe("decisionMessageSegments", () => {
  it("returns null for a message without a block", () => {
    expect(decisionMessageSegments("")).toBeNull();
    expect(decisionMessageSegments("Just text\n```ts\ncode\n```")).toBeNull();
  });

  it("keeps text and blocks in order", () => {
    const segments = decisionMessageSegments(`Before.\n\n${block("a")}\n\nBetween.\n${block("b", "Second?")}\n\nwaiting: approval`);
    expect(segments?.map((segment) => (segment.kind === "text" ? `text:${segment.text}` : `decision:${segment.decision.id}`))).toEqual([
      "text:Before.",
      "decision:a",
      "text:Between.",
      "decision:b",
      "text:waiting: approval",
    ]);
  });

  it("drops blank text around adjacent blocks and reads CRLF", () => {
    const segments = decisionMessageSegments(`${block("a")}\r\n\r\n${block("b")}`.replace(/\n/g, "\r\n"));
    expect(segments?.map((segment) => segment.kind)).toEqual(["decision", "decision"]);
    expect(segments?.[0]?.kind === "decision" && segments[0].decision.question).toBe("Approve?");
  });

  it("leaves an unclosed block as text", () => {
    expect(decisionMessageSegments("Text\n```decision\nid: a\nquestion: half")).toBeNull();
  });
});

describe("decisionTimelineItems", () => {
  it("leaves streaming and block-free messages to Paseo", () => {
    expect(decisionTimelineItems(`Hi\n${block("a")}`, "streaming")).toBeUndefined();
    expect(decisionTimelineItems("Hi", "complete")).toBeUndefined();
  });

  it("explodes a finished message into text and decision items with stable ids", () => {
    const result = decisionTimelineItems(`Hi\n${block("a")}\nwaiting: you`, "complete");
    expect(result?.items.map((item) => [item.id, item.kind])).toEqual([
      ["segment-0", "taro-decision-text"],
      ["segment-1", "taro-decision-block"],
      ["segment-2", "taro-decision-text"],
    ]);
    // Data must survive JSON (Paseo's contract).
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe("decisionBlockView", () => {
  const asked = parseDecisionBody("id: a\nquestion: Approve?\nblocking: true\noptions:\n  - label: Yes\n    prompt: Yes please");
  const done = (decision: StoredDecision | null, agentLive = true): DecisionLookup => ({ state: "done", decision, agentLive });

  it("is read-only while loading, after a failed lookup, and when Taro holds no record", () => {
    expect(decisionBlockView(asked, { state: "loading" })).toEqual({ kind: "read-only", note: READ_ONLY_NOTES.loading });
    expect(decisionBlockView(asked, { state: "error" })).toEqual({ kind: "read-only", note: READ_ONLY_NOTES.error });
    // Also a decision Taro dropped 14 days after it closed: never an invitation to answer.
    expect(decisionBlockView(asked, done(null))).toEqual({ kind: "read-only", note: READ_ONLY_NOTES.untracked });
    expect(new Set(Object.values(READ_ONLY_NOTES)).size).toBe(3);
  });

  it("is the open card while open and the agent is live", () => {
    const decision = stored(asked);
    expect(decisionBlockView(asked, done(decision))).toEqual({ kind: "open", decision });
  });

  it("is withdrawn when the agent is gone or the decision withdrawn", () => {
    expect(decisionBlockView(asked, done(stored(asked), false))).toEqual({ kind: "withdrawn" });
    expect(decisionBlockView(asked, done(stored(asked, { status: "withdrawn" })))).toEqual({ kind: "withdrawn" });
  });

  it("shows the answer once answered, whether the agent lives or not", () => {
    const answered = stored(asked, { status: "answered", answer: { text: "Yes please", label: "Yes", at: "t" } });
    expect(decisionBlockView(asked, done(answered, false))).toEqual({ kind: "answered", answer: "Yes please", label: "Yes" });
    const typed = stored(asked, { status: "answered", answer: { text: "Only the README", label: null, at: "t" } });
    expect(decisionBlockView(asked, done(typed))).toEqual({ kind: "answered", answer: "Only the README", label: null });
  });

  it("is replaced when a later block with the same id asks something else", () => {
    const later = parseDecisionBody("id: a\nquestion: Approve the new scope?\nblocking: true\noptions:\n  - label: Yes\n    prompt: Yes please");
    expect(decisionBlockView(asked, done(stored(later)))).toEqual({ kind: "replaced" });
  });

  it("marks a withdrawing block as such, whatever the lookup says", () => {
    const withdrawal = parseDecisionBody("id: a\nstatus: withdrawn");
    expect(decisionBlockView(withdrawal, done(stored(asked)))).toEqual({ kind: "withdrawal" });
    expect(decisionBlockView(withdrawal, { state: "loading" })).toEqual({ kind: "withdrawal" });
  });
});

describe("decisionOptionRows", () => {
  const option = (label: string, consequence = "") => ({ label, prompt: `${label} please`, consequence, images: [] });

  it("keeps the agent's order and puts the reason on the recommended row only", () => {
    const { rows, looseReason } = decisionOptionRows({ options: [option("A", "first"), option("B", "second"), option("C")], recommended: "B", reason: "fits best" });
    expect(rows.map((row) => [row.label, row.recommended, row.reason])).toEqual([["A", false, ""], ["B", true, "fits best"], ["C", false, ""]]);
    expect(rows[0]).toMatchObject({ prompt: "A please", consequence: "first" });
    expect(looseReason).toBe("");
  });

  it("carries each option's images to its row, and none for an option stored before TR-055", () => {
    const image = { file: "option-a-phone.png", caption: "on a phone", path: "/evidence/notes/NA-1/option-a-phone.png" };
    const old = { label: "B", prompt: "B", consequence: "" } as unknown as ReturnType<typeof option>;
    const { rows } = decisionOptionRows({ options: [{ ...option("A"), images: [image] }, old], recommended: "A", reason: "r" });
    expect(rows.map((row) => row.images)).toEqual([[image], []]);
  });

  it("returns the reason loose when the recommendation names no option", () => {
    const { rows, looseReason } = decisionOptionRows({ options: [option("A"), option("B")], recommended: "Z", reason: "because" });
    expect(rows.every((row) => !row.recommended && row.reason === "")).toBe(true);
    expect(looseReason).toBe("because");
  });

  it("marks only the first of two options with the recommended label", () => {
    const { rows } = decisionOptionRows({ options: [option("Same"), option("Same")], recommended: "Same", reason: "r" });
    expect(rows.map((row) => row.recommended)).toEqual([true, false]);
  });

  it("handles no options and an empty reason", () => {
    expect(decisionOptionRows({ options: [], recommended: "", reason: "" })).toEqual({ rows: [], looseReason: "", hidden: 0 });
    const { rows } = decisionOptionRows({ options: [option("A")], recommended: "A", reason: "" });
    expect(rows[0]).toMatchObject({ recommended: true, reason: "" });
  });
});

describe("decisionOptionRows without change options", () => {
  const option = (label: string) => ({ label, prompt: label, consequence: "", images: [] });

  it("hides change options, counts them and keeps the real ones in order", () => {
    const { rows, hidden } = decisionOptionRows({ options: [option("Approve"), option("Change…"), option("Split into children"), option("Other")], recommended: "Approve", reason: "r" });
    expect(rows.map((row) => row.label)).toEqual(["Approve", "Split into children"]);
    expect(hidden).toBe(2);
  });

  it("returns the reason loose when the recommended option is a hidden one", () => {
    const { rows, looseReason } = decisionOptionRows({ options: [option("Keep"), option("Change…")], recommended: "Change…", reason: "needs work" });
    expect(rows.some((row) => row.recommended)).toBe(false);
    expect(looseReason).toBe("needs work");
  });
});

describe("decisionSubmit", () => {
  const { rows } = decisionOptionRows({
    options: [
      { label: "Keep", prompt: "Keep it", consequence: "", images: [] },
      { label: "Rename…", prompt: "Rename it like this…", consequence: "", images: [] },
      { label: "Pick", prompt: "Pick one…", consequence: "", images: [] },
    ],
    recommended: "Keep",
    reason: "",
  });

  it("is disabled, the box greyed, with nothing picked, whatever was typed", () => {
    expect(decisionSubmit(rows, null, "")).toEqual({ enabled: false, label: null, text: "", placeholder: "Answer in your own words…", fieldEnabled: false });
    expect(decisionSubmit(rows, null, "my own way")).toMatchObject({ enabled: false, text: "", fieldEnabled: false });
  });

  it("sends the words typed under Other alone, trimmed, and needs them", () => {
    expect(decisionSubmit(rows, "other", "  my own way \n")).toEqual({ enabled: true, label: null, text: "my own way", placeholder: "Answer in your own words…", fieldEnabled: true });
    expect(decisionSubmit(rows, "other", "")).toMatchObject({ enabled: false, fieldEnabled: true });
    expect(decisionSubmit(rows, "other", "   \n").enabled).toBe(false);
  });

  it("sends a regular option alone, its box greyed and the kept words left out", () => {
    expect(decisionSubmit(rows, 0, "")).toEqual({ enabled: true, label: "Keep", text: "", placeholder: "Answer in your own words…", fieldEnabled: false });
    expect(decisionSubmit(rows, 0, " typed under Other ")).toMatchObject({ enabled: true, label: "Keep", text: "", fieldEnabled: false });
  });

  it("opens the box on an option whose label or prompt ends with …, and waits for words", () => {
    expect(decisionSubmit(rows, 1, "")).toMatchObject({ enabled: false, label: "Rename…", placeholder: "Say how for “Rename”…", fieldEnabled: true });
    expect(decisionSubmit(rows, 1, "call it fees")).toMatchObject({ enabled: true, label: "Rename…", text: "call it fees" });
    expect(decisionSubmit(rows, 2, " ")).toMatchObject({ enabled: false, fieldEnabled: true });
  });

  it("treats a pick past the end as no pick", () => {
    expect(decisionSubmit(rows, 7, "words")).toMatchObject({ enabled: false, label: null, fieldEnabled: false });
  });

  it("says the box asks for a change when told to, except under an option asking for words", () => {
    expect(decisionSubmit(rows, null, "", CHANGE_PLACEHOLDER).placeholder).toBe("Describe a change…");
    expect(decisionSubmit(rows, "other", "", CHANGE_PLACEHOLDER).placeholder).toBe("Describe a change…");
    expect(decisionSubmit(rows, 1, "", CHANGE_PLACEHOLDER).placeholder).toBe("Say how for “Rename”…");
  });
});

describe("isChangeOption", () => {
  it("matches change, other and something else, alone or with …, ... or :, in any case", () => {
    ["Change", "change…", "CHANGE...", "Other...", "other:", "Something else:", "something else …", "  Other  ", "Change …"].forEach((label) => expect(isChangeOption(label), label).toBe(true));
  });

  it("keeps real options, and an empty or blank label", () => {
    ["Changes needed", "Other approach", "Split into children", "Changed my mind", "Change the name", "Something else entirely", "Others", "", "   "].forEach((label) => expect(isChangeOption(label), label).toBe(false));
  });
});

describe("answerPlaceholder", () => {
  const options = (...labels: string[]) => labels.map((label) => ({ label, prompt: label, consequence: "", images: [] }));

  it("asks for a change on a scope approval, whatever its options", () => {
    expect(answerPlaceholder({ id: "scope-approval", options: options("Yes", "No") })).toBe(CHANGE_PLACEHOLDER);
  });

  it("asks for a change when an option was hidden or one starts with Approve", () => {
    expect(answerPlaceholder({ id: "fee-storage", options: options("Per trade", "Other") })).toBe(CHANGE_PLACEHOLDER);
    expect(answerPlaceholder({ id: "child-breakdown", options: options("Approve the split", "Fewer children") })).toBe(CHANGE_PLACEHOLDER);
  });

  it("asks for an answer otherwise", () => {
    expect(answerPlaceholder({ id: "fee-storage", options: options("Per trade", "Hourly", "Other approach") })).toBe(ANSWER_PLACEHOLDER);
    expect(answerPlaceholder({ id: "q", options: [] })).toBe("Answer in your own words…");
  });
});

describe("planChangeField", () => {
  it("leaves the change field off the compact card and keeps it under the full plan", () => {
    expect(planChangeField("card")).toBe(false);
    expect(planChangeField("unfolded card")).toBe(true);
    expect(planChangeField("ticket plan")).toBe(true);
  });
});

describe("planCardOptions", () => {
  const option = (label: string, prompt = label) => ({ label, prompt, consequence: "", images: [] });

  it("sends the option starting with Approve, the others beside it, change options hidden", () => {
    expect(planCardOptions({ options: [option("Split into children"), option("Approve the plan"), option("Change…")], recommended: "Split into children" })).toEqual({
      approve: "Approve the plan",
      approveLabel: "Approve the plan",
      others: [{ label: "Split into children", asksForWords: false }],
    });
  });

  it("sends the recommended one of two Approve options, and its button says what it sends", () => {
    const options = planCardOptions({ options: [option("Approve as planned"), option("Approve without the migration"), option("Split into children")], recommended: "Approve without the migration" });
    expect(options?.approve).toBe("Approve without the migration");
    expect(options?.approveLabel).toBe("Approve without the migration");
    expect(options?.others.map((other) => other.label)).toEqual(["Approve as planned", "Split into children"]);
  });

  it("sends the first Approve option when the recommended one does not start with Approve", () => {
    const options = planCardOptions({ options: [option("Approve now"), option("Approve later"), option("Wait")], recommended: "Wait" });
    expect(options?.approve).toBe("Approve now");
    expect(options?.others.map((other) => other.label)).toEqual(["Approve later", "Wait"]);
  });

  it("sends the recommended option when none starts with Approve, and the button shows its label", () => {
    expect(planCardOptions({ options: [option("Go ahead"), option("Rename", "Rename it…")], recommended: "Go ahead" })).toEqual({
      approve: "Go ahead",
      approveLabel: "Go ahead",
      others: [{ label: "Rename", asksForWords: true }],
    });
  });

  it("says Approve on the button only when plain Approve is what it sends", () => {
    expect(planCardOptions({ options: [option("Approve"), option("Split into children")], recommended: "Split into children" })?.approveLabel).toBe("Approve");
    expect(planCardOptions({ options: [option(" approve ")], recommended: "" })).toEqual({ approve: " approve ", approveLabel: "Approve", others: [] });
  });

  it("is null when there is neither, or the recommended one is a hidden change option", () => {
    expect(planCardOptions({ options: [option("Go ahead"), option("Wait")], recommended: "" })).toBeNull();
    expect(planCardOptions({ options: [option("Keep"), option("Change…")], recommended: "Change…" })).toBeNull();
    expect(planCardOptions({ options: [], recommended: "" })).toBeNull();
  });
});

describe("optionChips", () => {
  const option = (label: string, prompt = label) => ({ label, prompt, consequence: "", images: [] });

  it("is empty for a question without options", () => {
    expect(optionChips({ options: [], recommended: "", reason: "" })).toEqual([]);
  });

  it("keeps the agent's order and labels, marking only the recommended one", () => {
    const chips = optionChips({ options: [option("Approve"), option("Rename…"), option("Split into children")], recommended: "Approve", reason: "clear" });
    expect(chips).toEqual([
      { label: "Approve", recommended: true, asksForWords: false },
      { label: "Rename…", recommended: false, asksForWords: true },
      { label: "Split into children", recommended: false, asksForWords: false },
    ]);
  });

  it("leaves out change, other and something else options", () => {
    const chips = optionChips({ options: [option("Approve"), option("Change…"), option("Other"), option("Something else:"), option("Other approach")], recommended: "Approve", reason: "" });
    expect(chips.map((chip) => chip.label)).toEqual(["Approve", "Other approach"]);
  });

  it("marks none when the recommendation names no option", () => {
    expect(optionChips({ options: [option("A"), option("B")], recommended: "C", reason: "" }).some((chip) => chip.recommended)).toBe(false);
  });

  it("keeps every option of a long list", () => {
    const options = Array.from({ length: 9 }, (_, index) => option(`Option ${index + 1}`));
    expect(optionChips({ options, recommended: "Option 9", reason: "" }).map((chip) => chip.recommended)).toEqual([false, false, false, false, false, false, false, false, true]);
  });
});

describe("optionAsksForWords", () => {
  it("reads the ellipsis on the label or the prompt, ignoring trailing space", () => {
    expect(optionAsksForWords({ label: "Change…", prompt: "Change" })).toBe(true);
    expect(optionAsksForWords({ label: "Other", prompt: "Say how… " })).toBe(true);
    expect(optionAsksForWords({ label: "Keep", prompt: "Keep it" })).toBe(false);
    // Three dots are not the ellipsis the format names.
    expect(optionAsksForWords({ label: "Wait...", prompt: "Wait" })).toBe(false);
  });
});

describe("askedBy", () => {
  const base = { project: "notes", ticket: null, agentTitle: null, agentRole: "manager" as const };
  it("names the project once for a Manager whose title already carries it", () => {
    expect(askedBy({ ...base, agentTitle: "notes · Manager" })).toBe("notes · Manager");
  });
  it("adds the project, and the ticket when the title lacks it", () => {
    expect(askedBy({ ...base, ticket: "NA-002", agentRole: "owner", agentTitle: "NA-002 · Sync" })).toBe("notes · NA-002 · Sync");
    expect(askedBy({ ...base, ticket: "NA-002", agentRole: "reviewer", agentTitle: "Reviewer checking the branch" })).toBe("notes · NA-002 · Reviewer checking the branch");
  });
  it("falls back to the role without a title", () => {
    expect(askedBy(base)).toBe("notes · manager");
  });
});

describe("answeredInPlan", () => {
  const option = (label: string) => ({ label, prompt: label, consequence: "", images: [] });
  const approval = { id: "scope-approval", ticket: "NA-001", options: [option("Approve"), option("Split into children")], recommended: "Approve" };

  it("answers a scope approval on the panel's ticket in its Ticket view", () => {
    expect(answeredInPlan(approval, "NA-001")).toBe(true);
  });

  it("answers it once, in the Ticket view, whether or not the plan follows the template", () => {
    // A free-form (legacy) plan: the Ticket view draws its Approve rows and the panel draws no card, by one condition.
    expect(parsePlan("1. Do it\n2. Test it")).toBeNull();
    const decisions = [{ ...approval, status: "open" as const }, { ...approval, id: "zip-name", status: "open" as const }];
    expect(ticketViewApproval(decisions, "NA-001")?.decision.id).toBe("scope-approval");
    expect(ticketViewApproval(decisions, "NA-001")?.options.approve).toBe("Approve");
    expect(decisions.filter((decision) => !answeredInPlan(decision, "NA-001")).map((decision) => decision.id)).toEqual(["zip-name"]);
  });

  it("gives the Ticket view nothing to answer when Approve has nothing to send, so the panel keeps the card", () => {
    const decisions = [{ ...approval, options: [option("Go"), option("Wait")], recommended: "", status: "open" as const }];
    expect(ticketViewApproval(decisions, "NA-001")).toBeNull();
    expect(decisions.filter((decision) => !answeredInPlan(decision, "NA-001"))).toHaveLength(1);
    expect(ticketViewApproval([{ ...approval, status: "answered" as const }], "NA-001")).toBeNull();
  });

  it("keeps other decisions, another ticket's approval, and one with nothing for Approve to send", () => {
    expect(answeredInPlan({ ...approval, id: "zip-name" }, "NA-001")).toBe(false);
    expect(answeredInPlan(approval, "NA-002")).toBe(false);
    expect(answeredInPlan(approval, null)).toBe(false);
    expect(answeredInPlan({ ...approval, ticket: null }, "NA-001")).toBe(false);
    expect(answeredInPlan({ ...approval, options: [option("Go"), option("Wait")], recommended: "" }, "NA-001")).toBe(false);
  });
});

describe("planPrimaryButton", () => {
  it("approves while the change box is empty or blank", () => {
    expect(planPrimaryButton("Approve", "Approve", "")).toEqual({ label: "Approve", icon: "Check", option: "Approve" });
    expect(planPrimaryButton("Approve the split", "Approve the split", "  \n")).toEqual({ label: "Approve the split", icon: "Check", option: "Approve the split" });
  });

  it("sends the typed change alone once there are words", () => {
    expect(planPrimaryButton("Approve", "Approve", "drop the second chart")).toEqual({ label: "Send change", icon: "Send", option: null });
  });
});
