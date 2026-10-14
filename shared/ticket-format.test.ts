import { describe, expect, it } from "vitest";

import { TICKET_STATUSES as PROJECT_STATUSES } from "./project";
import {
  parseTicket,
  revisionOf,
  serializeTicket,
  summaryOf,
  TICKET_STATUSES,
  withNote,
  type Ticket,
} from "./ticket-format";

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "TR-081",
    title: "Taro-owned tracker",
    status: "In Progress",
    priority: "high",
    labels: ["complexity-high"],
    parent: null,
    dependsOn: ["TR-074"],
    created: "2026-10-14T15:46:00Z",
    updated: "2026-10-14T16:20:31Z",
    description: "Replace Backlog.md.",
    plan: "1. Format\n2. Store",
    criteria: [
      { index: 1, text: "First criterion", checked: true },
      { index: 2, text: "Second", checked: false },
    ],
    notes: "",
    finalSummary: "",
    extra: {},
    ...overrides,
  };
}

function parsed(text: string, file = "TR-081.md"): { ticket: Ticket; revision: string } {
  const result = parseTicket(text, file);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result;
}

function problemsOf(text: string, file = "TR-081.md"): Array<{ line: number; message: string }> {
  const result = parseTicket(text, file);
  if (result.ok) throw new Error("expected problems");
  return result.problems.map(({ line, message }) => ({ line, message }));
}

/** Both round trips: the ticket survives the file, and the file survives the ticket. */
function expectRoundTrip(value: Ticket): void {
  const file = serializeTicket(value);
  const back = parsed(file, `${value.id}.md`).ticket;
  expect(back).toEqual(value);
  expect(serializeTicket(back)).toBe(file);
}

const WRITER_FILE = `---
schema: 1
id: "TR-081"
title: "Taro-owned tracker"
status: "In Progress"
priority: "high"
labels: ["complexity-high"]
parent: null
depends_on: ["TR-074"]
created: "2026-10-14T15:46:00Z"
updated: "2026-10-14T16:20:31Z"
---

## Description

<!-- taro:description -->
Replace Backlog.md.
<!-- /taro:description -->

## Plan

<!-- taro:plan -->
1. Format
2. Store
<!-- /taro:plan -->

## Acceptance criteria

<!-- taro:criteria -->
- [x] #1 First criterion
- [ ] #2 Second
<!-- /taro:criteria -->

## Notes

<!-- taro:notes -->
<!-- /taro:notes -->

## Final summary

<!-- taro:final-summary -->
<!-- /taro:final-summary -->
`;

describe("ticket format", () => {
  it("writes the documented layout", () => {
    expect(serializeTicket(ticket())).toBe(WRITER_FILE);
  });

  it("status list equals shared/project.ts TICKET_STATUSES", () => {
    expect([...TICKET_STATUSES]).toEqual([...PROJECT_STATUSES]);
  });

  describe("round trip is exact", () => {
    const texts: Record<string, string> = {
      "dollar patterns $ $& $$5 $1": "Costs $5, $& matched, $$5 doubled, $1 group, $' and $` too, ending $",
      "emoji and ZWJ sequences": "Launch 🚀 family 👨‍👩‍👧‍👦 flag 🏳️‍🌈 skin 👍🏽",
      CJK: "中文的票据 日本語のチケット 한국어 티켓",
      tabs: "\tindented\twith\ttabs\t",
      "trailing spaces": "line with trailing spaces   \nanother \t ",
      "## headings": "## Description\n\n### Sub\n## Notes\n# Top",
      "leading and trailing blank lines": "\n\nmiddle\n\n",
      "a single newline": "\n",
      "lone carriage returns and CRLF in text": "a\r\nb\rc",
    };
    for (const [name, text] of Object.entries(texts)) {
      it(`text with ${name}`, () => {
        expectRoundTrip(
          ticket({ title: text.split("\n").join(" "), description: text, plan: text, notes: text, finalSummary: text }),
        );
      });
    }

    const sections = ["description", "plan", "criteria", "notes", "final-summary", "unknown-name"];
    const markerLines = sections.flatMap((name) => [`<!-- taro:${name} -->`, `<!-- /taro:${name} -->`]);
    it("marker lines (begin and end, of every section) bare in content", () => {
      const text = markerLines.join("\n");
      expectRoundTrip(ticket({ description: text, plan: text, notes: text, finalSummary: text }));
    });
    it("marker lines inside ``` fences", () => {
      const text = ["```", ...markerLines, "```"].join("\n");
      expectRoundTrip(ticket({ description: text, plan: text, notes: text, finalSummary: text }));
    });
    it("marker lines already escaped, with trailing blanks", () => {
      const text = ["\\<!-- taro:notes -->", "\\\\<!-- /taro:plan -->", "<!-- taro:notes -->  \t", " <!-- taro:notes -->"].join("\n");
      expectRoundTrip(ticket({ description: text, notes: text }));
      const file = serializeTicket(ticket({ description: text }));
      expect(file).toContain("\n\\\\<!-- taro:notes -->\n\\\\\\<!-- /taro:plan -->\n\\<!-- taro:notes -->  \t\n <!-- taro:notes -->\n");
    });
    it("empty description, plan and notes", () => {
      expectRoundTrip(ticket({ description: "", plan: "", notes: "", finalSummary: "", criteria: [] }));
    });
    it("a 1 MB notes section", () => {
      const notes = Array.from({ length: 20_000 }, (_, index) => `record ${index} ${"x".repeat(40)} $& 🚀`).join("\n\n");
      expect(notes.length).toBeGreaterThan(1_000_000);
      expectRoundTrip(ticket({ notes }));
    });
    it("a title with quotes, colons and a newline (JSON encodes it)", () => {
      const value = ticket({ title: 'Say "hi": now\nsecond line \\ end' });
      expectRoundTrip(value);
      expect(serializeTicket(value)).toContain('title: "Say \\"hi\\": now\\nsecond line \\\\ end"\n');
    });
    it("labels with spaces", () => {
      expectRoundTrip(ticket({ labels: ["needs review", "  padded  ", "emoji 🚀"] }));
    });
    it("unknown frontmatter keys are kept and written back in order", () => {
      const file = WRITER_FILE.replace('updated: "2026-10-14T16:20:31Z"\n', 'updated: "2026-10-14T16:20:31Z"\nzeta: 1\nalpha: {"a":[1,2]}\nmid: "m"\n');
      const back = parsed(file).ticket;
      expect(Object.keys(back.extra)).toEqual(["zeta", "alpha", "mid"]);
      expect(back.extra).toEqual({ zeta: 1, alpha: { a: [1, 2] }, mid: "m" });
      expect(serializeTicket(back)).toBe(file);
    });
    it("unknown keys placed among known keys move after them, keeping their order", () => {
      const file = WRITER_FILE.replace('schema: 1\n', 'schema: 1\nb: 2\n').replace('parent: null\n', 'parent: null\na: 1\n');
      const back = parsed(file).ticket;
      expect(Object.keys(back.extra)).toEqual(["b", "a"]);
      expect(serializeTicket(back)).toBe(WRITER_FILE.replace('updated: "2026-10-14T16:20:31Z"\n', 'updated: "2026-10-14T16:20:31Z"\nb: 2\na: 1\n'));
    });
  });

  describe("line endings and missing sections", () => {
    it("a CRLF file parses to the same ticket as the LF file", () => {
      const crlf = WRITER_FILE.split("\n").join("\r\n");
      expect(parsed(crlf).ticket).toEqual(parsed(WRITER_FILE).ticket);
      expect(parsed(crlf).revision).toBe(parsed(WRITER_FILE).revision);
    });
    it("a BOM parses to the same ticket as the LF file", () => {
      expect(parsed(`﻿${WRITER_FILE}`).ticket).toEqual(parsed(WRITER_FILE).ticket);
      expect(parsed(`﻿${WRITER_FILE.split("\n").join("\r\n")}`).ticket).toEqual(parsed(WRITER_FILE).ticket);
    });
    it("CRLF problem lines are the file's lines", () => {
      const crlf = WRITER_FILE.replace('status: "In Progress"', 'status: "Nope"').split("\n").join("\r\n");
      expect(problemsOf(crlf)[0]?.line).toBe(5);
    });
    it("a file with no Notes section parses with empty notes, and appending a note writes the record", () => {
      const start = WRITER_FILE.indexOf("## Notes");
      const end = WRITER_FILE.indexOf("## Final summary");
      const withoutNotes = WRITER_FILE.slice(0, start) + WRITER_FILE.slice(end);
      const value = parsed(withoutNotes).ticket;
      expect(value.notes).toBe("");
      const appended = serializeTicket({ ...value, notes: withNote(value.notes, "2026-10-14 record\n\n\n") });
      expect(parsed(appended).ticket.notes).toBe("2026-10-14 record");
      expect(appended).toContain("<!-- taro:notes -->\n2026-10-14 record\n<!-- /taro:notes -->");
    });
    it("a file with only frontmatter parses with every section empty", () => {
      const value = parsed(WRITER_FILE.slice(0, WRITER_FILE.indexOf("\n## Description"))).ticket;
      expect([value.description, value.plan, value.notes, value.finalSummary, value.criteria]).toEqual(["", "", "", "", []]);
    });
  });

  describe("malformed input returns problems with the right line", () => {
    const replaceLine = (from: string, to: string): string => {
      expect(WRITER_FILE).toContain(from);
      return WRITER_FILE.replace(from, to);
    };
    it("unclosed frontmatter", () => {
      expect(problemsOf("---\nschema: 1\nid: \"TR-081\"\n")).toEqual([{ line: 1, message: expect.stringContaining("unclosed frontmatter") }]);
    });
    it("no frontmatter at all", () => {
      expect(problemsOf("just text\n")[0]?.line).toBe(1);
      expect(problemsOf("")[0]?.line).toBe(1);
    });
    it("bad JSON value", () => {
      expect(problemsOf(replaceLine('title: "Taro-owned tracker"', "title: Taro-owned tracker"))).toEqual([
        { line: 4, message: expect.stringContaining('bad JSON value for "title"') },
      ]);
    });
    it("a frontmatter line that is not key: value", () => {
      expect(problemsOf(replaceLine("parent: null", "parent:null"))).toEqual(
        expect.arrayContaining([{ line: 8, message: expect.stringContaining("key: <JSON value>") }]),
      );
    });
    it("missing required key", () => {
      expect(problemsOf(replaceLine('depends_on: ["TR-074"]\n', ""))).toEqual([
        { line: 11, message: 'missing required key "depends_on"' },
      ]);
    });
    it("invalid required key", () => {
      expect(problemsOf(replaceLine("schema: 1", "schema: 2"))).toEqual([{ line: 2, message: '"schema" must be 1' }]);
      expect(problemsOf(replaceLine('labels: ["complexity-high"]', 'labels: "x"'))[0]?.line).toBe(7);
      expect(problemsOf(replaceLine('created: "2026-10-14T15:46:00Z"', 'created: "2026-10-14 15:46"'))[0]?.line).toBe(10);
      expect(problemsOf(replaceLine('title: "Taro-owned tracker"', 'title: ""'))[0]?.line).toBe(4);
      expect(problemsOf(replaceLine('priority: "high"', 'priority: "urgent"'))[0]?.line).toBe(6);
    });
    it("duplicate frontmatter key", () => {
      expect(problemsOf(replaceLine("parent: null", "parent: null\nparent: null"))).toEqual([
        { line: 9, message: 'duplicate frontmatter key "parent"' },
      ]);
    });
    it("id not equal to the file name", () => {
      expect(problemsOf(WRITER_FILE, "tickets/TR-082.md")).toEqual([
        { line: 3, message: expect.stringContaining('id "TR-081" does not match the file name TR-082.md') },
      ]);
      expect(problemsOf(WRITER_FILE, "tickets/TR-082.md")).toHaveLength(1);
      expect(parseTicket(WRITER_FILE, "/abs/tickets/TR-081.md").ok).toBe(true);
    });
    it("unknown status", () => {
      expect(problemsOf(replaceLine('status: "In Progress"', 'status: "Doing"'))).toEqual([
        { line: 5, message: expect.stringContaining('"status" must be one of') },
      ]);
    });
    it("unknown marker", () => {
      expect(problemsOf(replaceLine("## Plan\n", "## Plan\n<!-- taro:planning -->\n"))).toEqual([
        { line: 21, message: expect.stringContaining("unknown marker") },
      ]);
    });
    it("unknown marker inside a section", () => {
      expect(problemsOf(replaceLine("Replace Backlog.md.\n", "Replace Backlog.md.\n<!-- taro:summary -->\n"))).toEqual([
        { line: 18, message: expect.stringContaining("unknown marker") },
      ]);
    });
    it("unclosed section at the end of the file", () => {
      expect(problemsOf(replaceLine("<!-- /taro:final-summary -->\n", "text\n"))).toEqual([
        { line: 41, message: expect.stringContaining('unclosed section "final-summary"') },
      ]);
    });
    it("unclosed section followed by another section", () => {
      expect(problemsOf(replaceLine("<!-- /taro:description -->\n", ""))).toEqual([
        { line: 16, message: expect.stringContaining('unclosed section "description"') },
      ]);
    });
    it("end marker without its begin", () => {
      expect(problemsOf(replaceLine("## Plan\n", "## Plan\n<!-- /taro:notes -->\n"))).toEqual([
        { line: 21, message: expect.stringContaining("without its begin marker") },
      ]);
    });
    it("duplicate section", () => {
      const file = `${WRITER_FILE}\n<!-- taro:plan -->\nagain\n<!-- /taro:plan -->\n`;
      expect(problemsOf(file)).toEqual([{ line: 44, message: 'duplicate section "plan"' }]);
    });
    it("bad criteria line", () => {
      expect(problemsOf(replaceLine("- [ ] #2 Second", "- [ ] Second"))).toEqual([
        { line: 31, message: expect.stringContaining("criteria lines must be") },
      ]);
      expect(problemsOf(replaceLine("- [ ] #2 Second", ""))[0]?.line).toBe(31);
    });
    it("several problems at once, sorted by line", () => {
      const file = replaceLine('status: "In Progress"', 'status: "Doing"').replace("- [ ] #2 Second", "- [?] #2 Second");
      expect(problemsOf(file).map((problem) => problem.line)).toEqual([5, 31]);
    });
    it("never throws on arbitrary input", () => {
      const inputs = ["---", "---\n---", "---\n: x\n---", "\u0000￿", "---\nid: \"x\n---\n<!-- taro:notes -->", "\r\n\r\n"];
      for (const input of inputs) expect(() => parseTicket(input, "x.md")).not.toThrow();
    });
  });

  describe("revisionOf", () => {
    it("is FNV-1a 64-bit as 16 hex characters", () => {
      expect(revisionOf("")).toBe("cbf29ce484222325");
      expect(revisionOf("a")).toBe("af63dc4c8601ec8c");
      expect(revisionOf("foobar")).toBe("85944171f73967e8");
    });
    it("hashes UTF-8 bytes", () => {
      const reference = (text: string): string => {
        let hash = 0xcbf29ce484222325n;
        for (const byte of new TextEncoder().encode(text)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
        return hash.toString(16).padStart(16, "0");
      };
      for (const text of ["é", "中文", "🚀👨‍👩‍👧", WRITER_FILE]) expect(revisionOf(text)).toBe(reference(text));
    });
    it("changes with any byte and ignores BOM and CRLF", () => {
      expect(revisionOf(WRITER_FILE)).not.toBe(revisionOf(`${WRITER_FILE} `));
      expect(revisionOf(`﻿${WRITER_FILE.split("\n").join("\r\n")}`)).toBe(revisionOf(WRITER_FILE));
    });
  });

  describe("withNote", () => {
    it("appends after a blank line and trims the record's trailing newlines", () => {
      expect(withNote("", "first")).toBe("first");
      expect(withNote("first", "second\n\n\n\n\n")).toBe("first\n\nsecond");
      expect(withNote("first\n\n", "second\r\n")).toBe("first\n\nsecond");
      expect(withNote("first", "$& $1 $$")).toBe("first\n\n$& $1 $$");
      expect(withNote("first", "\n\n")).toBe("first");
    });
  });

  it("summaryOf keeps no body text", () => {
    const summary = summaryOf(ticket({ description: "secret body" }), "0123456789abcdef", "tickets/TR-081.md");
    expect(Object.keys(summary).sort()).toEqual(
      ["created", "criteriaChecked", "criteriaCount", "dependsOn", "file", "id", "labels", "parent", "priority", "revision", "status", "title", "updated"].sort(),
    );
    expect(summary.criteriaCount).toBe(2);
    expect(summary.criteriaChecked).toBe(1);
  });

  it("refuses a criterion that spans lines", () => {
    expect(() => serializeTicket(ticket({ criteria: [{ index: 1, text: "a\nb", checked: false }] }))).toThrow(/more than one line/);
  });
});
