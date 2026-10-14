/**
 * Taro's ticket file format, schema 1 (TR-081 spec S2/S3): JSON-valued frontmatter, then sections
 * bounded by `<!-- taro:<name> -->` markers. The `## Heading` lines are for people; the markers are
 * the structure. Pure and import-free so the daemon, the `taro` command (plain `node` type
 * stripping) and tests all share it: erasable TypeScript only.
 */

/** Kept equal to shared/project.ts TICKET_STATUSES by a test; that file imports zod, so it cannot be imported here. */
export const TICKET_STATUSES = [
  "Backlog",
  "Planning",
  "Ready",
  "In Progress",
  "Reviewing",
  "Awaiting acceptance",
  "Blocked",
  "Cancelled",
  "Done",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["high", "medium", "low"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export interface Criterion {
  index: number;
  text: string;
  checked: boolean;
}

export interface Ticket {
  id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority | null;
  labels: string[];
  parent: string | null;
  dependsOn: string[];
  created: string;
  updated: string;
  description: string;
  plan: string;
  criteria: Criterion[];
  notes: string;
  finalSummary: string;
  /** Unknown frontmatter keys, in their original order, written back after the known ones. */
  extra: Record<string, unknown>;
}

/** What the daemon caches per file: no bodies. */
export interface TicketSummary {
  id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority | null;
  labels: string[];
  parent: string | null;
  dependsOn: string[];
  created: string;
  updated: string;
  criteriaCount: number;
  criteriaChecked: number;
  revision: string;
  file: string;
}

export interface TicketProblem {
  file: string;
  line: number;
  message: string;
}

export type ParseResult =
  | { ok: true; ticket: Ticket; revision: string }
  | { ok: false; problems: TicketProblem[] };

export const TICKET_SCHEMA = 1;

const KNOWN_KEYS = ["schema", "id", "title", "status", "priority", "labels", "parent", "depends_on", "created", "updated"];
const REQUIRED_KEYS = ["schema", "id", "title", "status", "labels", "parent", "depends_on", "created", "updated"];
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const FRONTMATTER_LINE = /^([A-Za-z_][A-Za-z0-9_-]*): (.*)$/;
/** A content line that would read as a marker; written with one extra leading `\`. */
const MARKER_LIKE = /^\\*<!-- \/?taro:[a-z-]+ -->[ \t]*$/;
const MARKER = /^<!-- (\/?)taro:([a-z-]+) -->[ \t]*$/;
const CRITERION = /^- \[([ x])\] #(\d+) (.*)$/;

type SectionName = "description" | "plan" | "criteria" | "notes" | "final-summary";
const SECTION_HEADINGS: Record<SectionName, string> = {
  description: "Description",
  plan: "Plan",
  criteria: "Acceptance criteria",
  notes: "Notes",
  "final-summary": "Final summary",
};

interface OpenSection {
  name: SectionName;
  line: number;
  content: string[];
  duplicate?: boolean;
}

function isSectionName(name: string): name is SectionName {
  return Object.prototype.hasOwnProperty.call(SECTION_HEADINGS, name);
}

/** Strips a BOM and, for a CRLF file (its first line ends in `\r\n`), turns every `\r\n` into `\n`. Line numbers are unchanged. */
function normalise(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstBreak = withoutBom.indexOf("\n");
  if (firstBreak > 0 && withoutBom.charCodeAt(firstBreak - 1) === 13) return withoutBom.split("\r\n").join("\n");
  return withoutBom;
}

/** FNV-1a 64-bit of the normalised text's UTF-8 bytes, as 16 hex characters; 16-bit limbs keep it exact without BigInt. */
export function revisionOf(text: string): string {
  const normalised = normalise(text);
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  const mix = (byte: number): void => {
    h0 ^= byte;
    // Multiply by the FNV prime 0x100000001b3 modulo 2^64.
    let t0 = h0 * 0x1b3;
    let t1 = h1 * 0x1b3;
    let t2 = h2 * 0x1b3 + h0 * 0x100;
    let t3 = h3 * 0x1b3 + h1 * 0x100;
    t1 += t0 >>> 16;
    h0 = t0 & 0xffff;
    t2 += t1 >>> 16;
    h1 = t1 & 0xffff;
    t3 += t2 >>> 16;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  };
  for (let index = 0; index < normalised.length; index++) {
    let code = normalised.codePointAt(index) ?? 0;
    if (code > 0xffff) index++;
    else if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) mix(code);
    else if (code < 0x800) {
      mix(0xc0 | (code >> 6));
      mix(0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      mix(0xe0 | (code >> 12));
      mix(0x80 | ((code >> 6) & 0x3f));
      mix(0x80 | (code & 0x3f));
    } else {
      mix(0xf0 | (code >> 18));
      mix(0x80 | ((code >> 12) & 0x3f));
      mix(0x80 | ((code >> 6) & 0x3f));
      mix(0x80 | (code & 0x3f));
    }
  }
  return [h3, h2, h1, h0].map((limb) => limb.toString(16).padStart(4, "0")).join("");
}

function trimTrailingNewlines(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === "\n" || text[end - 1] === "\r")) end--;
  return text.slice(0, end);
}

/** Appends a record to the notes after a blank line; the record's trailing newlines are dropped. */
export function withNote(notes: string, record: string): string {
  const trimmedRecord = trimTrailingNewlines(record);
  if (trimmedRecord === "") return notes;
  const trimmedNotes = trimTrailingNewlines(notes);
  return trimmedNotes === "" ? trimmedRecord : `${trimmedNotes}\n\n${trimmedRecord}`;
}

export function summaryOf(ticket: Ticket, revision: string, file: string): TicketSummary {
  return {
    id: ticket.id,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    labels: [...ticket.labels],
    parent: ticket.parent,
    dependsOn: [...ticket.dependsOn],
    created: ticket.created,
    updated: ticket.updated,
    criteriaCount: ticket.criteria.length,
    criteriaChecked: ticket.criteria.filter((criterion) => criterion.checked).length,
    revision,
    file,
  };
}

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === "string" && (TICKET_STATUSES as readonly string[]).includes(value);
}

/** `2026-10-14T15:46:00Z`: UTC, seconds, no milliseconds. */
export function timestampOf(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function baseName(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
  const name = fileName.slice(slash + 1);
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

export function parseTicket(text: string, fileName: string): ParseResult {
  const lines = normalise(text).split("\n");
  const problems: TicketProblem[] = [];
  const problem = (line: number, message: string): void => {
    problems.push({ file: fileName, line, message });
  };

  if (lines[0] !== "---") {
    problem(1, "the file must start with a `---` frontmatter line");
    return { ok: false, problems };
  }
  let closing = -1;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index] === "---") {
      closing = index;
      break;
    }
  }
  if (closing < 0) {
    problem(1, "unclosed frontmatter: no closing `---` line");
    return { ok: false, problems };
  }

  const values = new Map<string, { value: unknown; line: number }>();
  const badKeys = new Set<string>();
  for (let index = 1; index < closing; index++) {
    const line = index + 1;
    const match = FRONTMATTER_LINE.exec(lines[index] ?? "");
    if (match === null) {
      problem(line, "frontmatter lines must be `key: <JSON value>`");
      continue;
    }
    const key = match[1] ?? "";
    if (values.has(key)) {
      problem(line, `duplicate frontmatter key "${key}"`);
      continue;
    }
    try {
      values.set(key, { value: JSON.parse(match[2] ?? ""), line });
    } catch {
      badKeys.add(key);
      problem(line, `bad JSON value for "${key}"`);
    }
  }
  const closingLine = closing + 1;
  for (const key of REQUIRED_KEYS) {
    if (!values.has(key) && !badKeys.has(key)) {
      problem(closingLine, `missing required key "${key}"`);
    }
  }
  const field = (key: string, valid: (value: unknown) => boolean, expected: string): unknown => {
    const entry = values.get(key);
    if (entry === undefined) return undefined;
    if (!valid(entry.value)) {
      problem(entry.line, `"${key}" must be ${expected}`);
      return undefined;
    }
    return entry.value;
  };
  field("schema", (value) => value === TICKET_SCHEMA, `${TICKET_SCHEMA}`);
  const id = field("id", (value) => typeof value === "string" && value !== "", "a non-empty string") as string | undefined;
  if (id !== undefined && id !== baseName(fileName)) {
    problem(values.get("id")?.line ?? 1, `id "${id}" does not match the file name ${baseName(fileName)}.md`);
  }
  const title = field("title", (value) => typeof value === "string" && value !== "", "a non-empty string") as string | undefined;
  const status = field("status", isTicketStatus, `one of ${TICKET_STATUSES.join(", ")}`) as TicketStatus | undefined;
  const priority = field(
    "priority",
    (value) => value === null || (TICKET_PRIORITIES as readonly unknown[]).includes(value),
    `"high", "medium", "low" or null`,
  ) as TicketPriority | null | undefined;
  const labels = field("labels", isStringArray, "an array of strings") as string[] | undefined;
  const parent = field("parent", (value) => value === null || (typeof value === "string" && value !== ""), "a ticket id or null") as
    | string
    | null
    | undefined;
  const dependsOn = field("depends_on", isStringArray, "an array of strings") as string[] | undefined;
  const isTimestamp = (value: unknown): boolean => typeof value === "string" && TIMESTAMP.test(value);
  const created = field("created", isTimestamp, "an ISO 8601 UTC time with seconds, like 2026-10-14T15:46:00Z") as string | undefined;
  const updated = field("updated", isTimestamp, "an ISO 8601 UTC time with seconds, like 2026-10-14T15:46:00Z") as string | undefined;
  const extra: Record<string, unknown> = {};
  for (const [key, entry] of values) {
    if (!KNOWN_KEYS.includes(key)) extra[key] = entry.value;
  }

  const sections: Partial<Record<SectionName, { line: number; content: string[] }>> = {};
  // A duplicate section stays open (to swallow its end marker) but is not kept.
  let open: OpenSection | null = null;
  const close = (): void => {
    if (open !== null && open.duplicate !== true) sections[open.name] = open;
    open = null;
  };
  for (let index = closing + 1; index < lines.length; index++) {
    const text = lines[index] ?? "";
    const line = index + 1;
    const marker = MARKER.exec(text);
    if (marker === null) {
      if (open !== null) {
        const current: OpenSection = open;
        current.content.push(MARKER_LIKE.test(text) && text.startsWith("\\") ? text.slice(1) : text);
      }
      continue;
    }
    const isEnd = marker[1] === "/";
    const name = marker[2] ?? "";
    if (!isSectionName(name)) {
      problem(line, `unknown marker "${text.trim()}"; escape a marker in text with a leading \\`);
      continue;
    }
    if (open !== null) {
      const current: OpenSection = open;
      if (isEnd && name === current.name) {
        close();
        continue;
      }
      problem(current.line, `unclosed section "${current.name}": line ${line} has "${text.trim()}" before its end marker`);
      open = null;
    }
    if (isEnd) {
      problem(line, `end marker "${text.trim()}" without its begin marker`);
      continue;
    }
    if (sections[name] !== undefined) {
      problem(line, `duplicate section "${name}"`);
      open = { name, line, content: [], duplicate: true };
      continue;
    }
    open = { name, line, content: [] };
  }
  if (open !== null) {
    const current: OpenSection = open;
    problem(current.line, `unclosed section "${current.name}": no "<!-- /taro:${current.name} -->" line`);
  }

  const criteria: Criterion[] = [];
  const criteriaSection = sections.criteria;
  criteriaSection?.content.forEach((text, offset) => {
    const match = CRITERION.exec(text);
    if (match === null) {
      problem(criteriaSection.line + offset + 1, "criteria lines must be `- [ ] #<n> <text>` or `- [x] #<n> <text>`");
      return;
    }
    criteria.push({ index: Number(match[2]), text: match[3] ?? "", checked: match[1] === "x" });
  });

  if (problems.length > 0) return { ok: false, problems: problems.sort((left, right) => left.line - right.line) };
  const sectionText = (name: SectionName): string => (sections[name]?.content ?? []).join("\n");
  const ticket: Ticket = {
    id: id ?? "",
    title: title ?? "",
    status: status ?? "Backlog",
    priority: priority ?? null,
    labels: labels ?? [],
    parent: parent ?? null,
    dependsOn: dependsOn ?? [],
    created: created ?? "",
    updated: updated ?? "",
    description: sectionText("description"),
    plan: sectionText("plan"),
    criteria,
    notes: sectionText("notes"),
    finalSummary: sectionText("final-summary"),
    extra,
  };
  return { ok: true, ticket, revision: revisionOf(text) };
}

function sectionBody(text: string): string[] {
  if (text === "") return [];
  return text.split("\n").map((line) => (MARKER_LIKE.test(line) ? `\\${line}` : line));
}

export function serializeTicket(ticket: Ticket): string {
  const frontmatter: Array<[string, unknown]> = [
    ["schema", TICKET_SCHEMA],
    ["id", ticket.id],
    ["title", ticket.title],
    ["status", ticket.status],
    ["priority", ticket.priority],
    ["labels", ticket.labels],
    ["parent", ticket.parent],
    ["depends_on", ticket.dependsOn],
    ["created", ticket.created],
    ["updated", ticket.updated],
  ];
  for (const key of Object.keys(ticket.extra)) {
    if (!KNOWN_KEYS.includes(key)) frontmatter.push([key, ticket.extra[key]]);
  }
  const out: string[] = ["---", ...frontmatter.map(([key, value]) => `${key}: ${JSON.stringify(value)}`), "---"];
  const section = (name: SectionName, body: string[]): void => {
    out.push("", `## ${SECTION_HEADINGS[name]}`, "", `<!-- taro:${name} -->`, ...body, `<!-- /taro:${name} -->`);
  };
  section("description", sectionBody(ticket.description));
  section("plan", sectionBody(ticket.plan));
  if (ticket.criteria.length > 0) {
    section(
      "criteria",
      ticket.criteria.map((criterion) => {
        if (criterion.text.includes("\n")) throw new Error(`Criterion #${criterion.index} of ${ticket.id} spans more than one line.`);
        return `- [${criterion.checked ? "x" : " "}] #${criterion.index} ${criterion.text}`;
      }),
    );
  }
  section("notes", sectionBody(ticket.notes));
  section("final-summary", sectionBody(ticket.finalSummary));
  return `${out.join("\n")}\n`;
}
