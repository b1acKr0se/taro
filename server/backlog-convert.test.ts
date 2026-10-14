import { describe, expect, it } from "vitest";

import { parseTicket, serializeTicket, type Ticket } from "../shared/ticket-format";
import { backlogDate, parseBacklogTask, parseYamlSubset } from "./backlog-convert";

const FILE = "backlog/tasks/na-001 - Notes.md";

/** A Backlog task file: frontmatter lines (defaults filled in unless given), then the body. */
function taskFile(frontmatter: string[], body = ""): string {
  const keys = new Set(frontmatter.map((line) => /^([a-z_]+):/.exec(line)?.[1]));
  const defaults = [
    keys.has("id") ? null : "id: NA-001",
    keys.has("title") ? null : "title: Notes",
    keys.has("status") ? null : "status: In Progress",
    keys.has("created_date") ? null : "created_date: '2026-10-13 11:21'",
  ].filter((line): line is string => line !== null);
  return `---\n${[...defaults, ...frontmatter].join("\n")}\n---\n${body}`;
}

function parsed(text: string): { ticket: Ticket; reports: string[] } {
  const result = parseBacklogTask(text, FILE);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result;
}

function ticketOf(text: string): Ticket {
  return parsed(text).ticket;
}

function titleOf(...lines: string[]): string {
  return ticketOf(taskFile(lines)).title;
}

function valueOf(lines: string[]): unknown {
  const yaml = parseYamlSubset(lines, 1);
  expect(yaml.problems).toEqual([]);
  return yaml.entries.get("key")?.value;
}

describe("Backlog frontmatter: scalars", () => {
  it("reads a plain scalar, without a trailing comment", () => {
    expect(titleOf("title: Plain title")).toBe("Plain title");
    expect(valueOf(["key: value # a comment"])).toBe("value");
  });

  it("reads a plain scalar continued on indented lines", () => {
    expect(valueOf(["key: first", "  second"])).toBe("first second");
  });

  it("reads a single-quoted scalar with '' for a quote", () => {
    expect(titleOf("title: 'It''s a title: with a colon'")).toBe("It's a title: with a colon");
  });

  it("reads a double-quoted scalar with \\\" and \\\\ escapes", () => {
    expect(titleOf('title: "Say \\"hi\\" \\\\ there"')).toBe('Say "hi" \\ there');
  });

  it("reads \\n in a double-quoted scalar as a newline", () => {
    expect(titleOf('title: "one\\ntwo"')).toBe("one\ntwo");
  });

  it("reads \\uXXXX in a double-quoted scalar", () => {
    expect(titleOf('title: "caf\\u00e9"')).toBe("café");
  });

  it("reads \\U0001F680 in a double-quoted scalar as the emoji", () => {
    expect(titleOf('title: "Ship it \\U0001F680"')).toBe("Ship it 🚀");
  });

  it("folds a double-quoted scalar over several lines", () => {
    expect(valueOf(['key: "one', '  two', "", '  three"'])).toBe("one two\nthree");
  });

  it("reads a >- folded block scalar, and a folded title with a colon", () => {
    expect(titleOf("title: >-", "  Setup page: model, thinking and helper pickers that run", "  over two lines")).toBe(
      "Setup page: model, thinking and helper pickers that run over two lines",
    );
  });

  it("reads a > folded block scalar with its final newline and an empty line as a newline", () => {
    expect(valueOf(["key: >", "  one", "  two", "", "  three"])).toBe("one two\nthree\n");
  });

  it("keeps more-indented lines of a folded block on their own lines", () => {
    expect(valueOf(["key: >-", "  text", "    code", "  more"])).toBe("text\n  code\nmore");
  });

  it("reads a |- literal block scalar", () => {
    expect(valueOf(["key: |-", "  line one", "  line two"])).toBe("line one\nline two");
  });

  it("reads a | literal block scalar with its final newline", () => {
    expect(valueOf(["key: |", "  line one", "  line two", "next: 1"])).toBe("line one\nline two\n");
  });

  it("reads ~ and an empty value as null", () => {
    expect(valueOf(["key: ~"])).toBeNull();
    expect(valueOf(["key:"])).toBeNull();
  });
});

describe("Backlog frontmatter: lists", () => {
  it("reads - item lists, indented or not, quoted or plain", () => {
    expect(ticketOf(taskFile(["labels:", "  - complexity-low", '  - "quoted, \\"label\\""', "  - 'single'"])).labels).toEqual([
      "complexity-low",
      'quoted, "label"',
      "single",
    ]);
    expect(valueOf(["key:", "- a", "- b"])).toEqual(["a", "b"]);
  });

  it("reads [] as an empty list", () => {
    expect(ticketOf(taskFile(["labels: []", "dependencies: []"])).labels).toEqual([]);
  });

  it("reads an inline [a, b] list with quoted items", () => {
    expect(ticketOf(taskFile(["dependencies: [NA-002, 'NA-003', \"NA-004\"]"])).dependsOn).toEqual(["NA-002", "NA-003", "NA-004"]);
    expect(valueOf(['key: ["a, b", c]'])).toEqual(["a, b", "c"]);
  });

  it("reports a {mapping} and a nested key as problems, never drops them silently", () => {
    expect(parseYamlSubset(["key: {a: 1}"], 1).problems).toHaveLength(1);
    expect(parseYamlSubset(["key:", "  nested: 1"], 1).problems).toHaveLength(1);
  });
});

describe("Backlog task files", () => {
  it("reads a CRLF file like an LF one", () => {
    const lf = taskFile(["labels:", "  - a"], "\n## Description\n\n<!-- SECTION:DESCRIPTION:BEGIN -->\nLine one\nLine two\n<!-- SECTION:DESCRIPTION:END -->\n");
    const crlf = lf.split("\n").join("\r\n");
    expect(ticketOf(crlf)).toEqual(ticketOf(lf));
    expect(ticketOf(crlf).description).toBe("Line one\nLine two");
  });

  it("reads the DESCRIPTION, PLAN, NOTES and FINAL_SUMMARY sections", () => {
    const body = [
      "",
      "## Description",
      "",
      "<!-- SECTION:DESCRIPTION:BEGIN -->",
      "The description",
      "## Its own heading",
      "<!-- SECTION:DESCRIPTION:END -->",
      "",
      "## Implementation Plan",
      "",
      "<!-- SECTION:PLAN:BEGIN -->",
      "1. Plan",
      "<!-- SECTION:PLAN:END -->",
      "",
      "## Implementation Notes",
      "",
      "<!-- SECTION:NOTES:BEGIN -->",
      "A note",
      "<!-- SECTION:NOTES:END -->",
      "",
      "## Final Summary",
      "",
      "<!-- SECTION:FINAL_SUMMARY:BEGIN -->",
      "Done.",
      "<!-- SECTION:FINAL_SUMMARY:END -->",
      "",
    ].join("\n");
    const ticket = ticketOf(taskFile([], body));
    expect(ticket.description).toBe("The description\n## Its own heading");
    expect(ticket.plan).toBe("1. Plan");
    expect(ticket.notes).toBe("A note");
    expect(ticket.finalSummary).toBe("Done.");
  });

  it("reads criteria between <!-- AC:BEGIN/END --> with - [ ] #n and - [x] #n", () => {
    const body = "\n## Acceptance Criteria\n<!-- AC:BEGIN -->\n- [ ] #1 First $1\n- [x] #2 Second 🚀\n<!-- AC:END -->\n";
    expect(ticketOf(taskFile([], body)).criteria).toEqual([
      { index: 1, text: "First $1", checked: false },
      { index: 2, text: "Second 🚀", checked: true },
    ]);
  });

  it("reports a criteria line it cannot read as a problem", () => {
    const result = parseBacklogTask(taskFile([], "<!-- AC:BEGIN -->\n- [ ] no number\n<!-- AC:END -->\n"), FILE);
    expect(result.ok).toBe(false);
  });

  it("turns yyyy-mm-dd HH:MM and yyyy-mm-dd dates into ISO UTC with seconds", () => {
    const ticket = ticketOf(taskFile(["created_date: '2026-10-13 11:21'", "updated_date: 2026-10-14"]));
    expect(ticket.created).toBe("2026-10-13T11:21:00Z");
    expect(ticket.updated).toBe("2026-10-14T00:00:00Z");
    expect(backlogDate("2026-13-45 99:99")).toBeNull();
  });

  it("takes updated from created when there is no updated_date", () => {
    expect(ticketOf(taskFile([])).updated).toBe("2026-10-13T11:21:00Z");
  });

  it("maps parent_task_id to parent and dependencies to dependsOn", () => {
    const ticket = ticketOf(taskFile(["id: NA-003.01", "parent_task_id: NA-003", "dependencies:", "  - NA-001"]));
    expect(ticket.parent).toBe("NA-003");
    expect(ticket.dependsOn).toEqual(["NA-001"]);
    expect(ticketOf(taskFile([])).parent).toBeNull();
  });

  it("keeps a high, medium or low priority, and none as null", () => {
    expect(ticketOf(taskFile(["priority: high"])).priority).toBe("high");
    expect(ticketOf(taskFile(["priority: Low"])).priority).toBe("low");
    expect(ticketOf(taskFile([])).priority).toBeNull();
  });

  it("reads an empty notes section as empty", () => {
    expect(ticketOf(taskFile([], "<!-- SECTION:NOTES:BEGIN -->\n<!-- SECTION:NOTES:END -->\n")).notes).toBe("");
  });

  it("reads a ticket with no sections at all, and a file with only frontmatter", () => {
    const withHeadings = ticketOf(taskFile([], "\n## Description\n\n## Implementation Notes\n"));
    expect([withHeadings.description, withHeadings.plan, withHeadings.notes, withHeadings.finalSummary]).toEqual(["", "", "", ""]);
    const bare = ticketOf(taskFile([]));
    expect(bare.criteria).toEqual([]);
    expect(bare.description).toBe("");
  });

  it("refuses text outside the section markers rather than losing it", () => {
    const result = parseBacklogTask(taskFile([], "\nStray paragraph\n"), FILE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.line).toBe(8);
  });

  it("reports an unclosed section and a missing id or title", () => {
    expect(parseBacklogTask(taskFile([], "<!-- SECTION:NOTES:BEGIN -->\ntext\n"), FILE).ok).toBe(false);
    expect(parseBacklogTask("---\nstatus: Done\ncreated_date: 2026-10-13\n---\n", FILE).ok).toBe(false);
  });
});

describe("Backlog to Taro mapping", () => {
  it("sets a status that is not Taro's to Backlog and reports it", () => {
    const result = parsed(taskFile(["status: To Do"]));
    expect(result.ticket.status).toBe("Backlog");
    expect(result.reports).toEqual(['status "To Do" is not one of Taro\'s; set to Backlog']);
  });

  it("drops ordinal silently", () => {
    const result = parsed(taskFile(["ordinal: 1000"]));
    expect(result.reports).toEqual([]);
    expect(result.ticket.extra).toEqual({});
  });

  it("drops an empty assignee silently and reports a non-empty one", () => {
    expect(parsed(taskFile(["assignee: []"])).reports).toEqual([]);
    expect(parsed(taskFile(["assignee:", "  - alex@example.com"])).reports).toEqual(["assignee alex@example.com dropped"]);
  });

  it("reports a non-empty Definition of Done as dropped", () => {
    const body = "\n## Definition of Done\n<!-- DOD:BEGIN -->\n- [ ] #1 Tests pass\n- [ ] #2 Docs\n<!-- DOD:END -->\n";
    expect(parsed(taskFile([], body)).reports).toEqual(["Definition of Done dropped (2 lines)"]);
    expect(parsed(taskFile([], "<!-- DOD:BEGIN -->\n<!-- DOD:END -->\n")).reports).toEqual([]);
  });

  it("reports other non-empty Backlog keys as dropped", () => {
    expect(parsed(taskFile(["milestone: v1", "references: []"])).reports).toEqual(["milestone v1 dropped"]);
  });

  it("keeps $, emoji and a code fence of Backlog-looking markers verbatim, through Taro's file format", () => {
    const description = [
      "Costs $5, $& and $$ 🚀 — ünïcode\tand a tab  ",
      "```",
      "<!-- SECTION:NOTES:BEGIN -->",
      "<!-- AC:BEGIN -->",
      "- [ ] #1 not a criterion",
      "<!-- AC:END -->",
      "<!-- SECTION:PLAN:END -->",
      "<!-- taro:notes -->",
      "```",
    ].join("\n");
    const ticket = ticketOf(taskFile([], `<!-- SECTION:DESCRIPTION:BEGIN -->\n${description}\n<!-- SECTION:DESCRIPTION:END -->\n`));
    expect(ticket.description).toBe(description);
    expect(ticket.criteria).toEqual([]);
    const written = parseTicket(serializeTicket(ticket), "NA-001.md");
    expect(written.ok && written.ticket).toEqual(ticket);
  });
});
