/**
 * `taro convert` (TR-081 spec S8): turns a Backlog.md tracker (`backlog/config.yml` and the task files
 * in `backlog/tasks`, `backlog/completed`, `backlog/archive/tasks`, `backlog/drafts`) into Taro's
 * format (`tickets/<ID>.md`, `tracker.json`), then removes `backlog/` and commits once as Taro.
 *
 * Backlog files are read with a parser for the YAML subset Backlog writes (no npm packages): plain,
 * single- and double-quoted scalars (with escapes), block scalars, `- item` and `[a, b]` lists. Text
 * the converter cannot place makes the run refuse rather than drop it; what it drops on purpose
 * (ordinal, assignee, Definition of Done, other Backlog-only keys) is reported when it held anything.
 *
 * Runs under plain `node` type stripping too (the `taro` command): erasable TypeScript only, `.ts`
 * import extensions, Node builtins only.
 */
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  isTicketStatus,
  serializeTicket,
  TICKET_PRIORITIES,
  type Criterion,
  type Ticket,
  type TicketPriority,
  type TicketProblem,
} from "../shared/ticket-format.ts";
import { runChecked } from "./process.ts";
import { createTicketStore, replaceFile, tempSuffix, type TrackerFile } from "./ticket-store.ts";

// ---------------------------------------------------------------- YAML subset

type YamlValue = string | string[] | null;

interface YamlEntry {
  value: YamlValue;
  line: number;
}

interface YamlResult {
  entries: Map<string, YamlEntry>;
  problems: Array<{ line: number; message: string }>;
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*?))?[ \t]*$/;
const BLOCK_HEADER = /^([|>])([+-]?)([1-9]?)([+-]?)(?:[ \t]+#.*)?$/;

function indentationOf(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === " ") count++;
  return count;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** Characters for a double-quoted escape, or undefined for an unknown one. */
function escapeCharacter(text: string, index: number): { value: string; length: number } | undefined {
  const code = text[index];
  const simple: Record<string, string> = {
    "0": "\0",
    a: "\x07",
    b: "\b",
    t: "\t",
    "\t": "\t",
    n: "\n",
    v: "\v",
    f: "\f",
    r: "\r",
    e: "\x1b",
    " ": " ",
    '"': '"',
    "/": "/",
    "\\": "\\",
    N: "\u0085",
    _: " ",
    L: " ",
    P: " ",
  };
  if (code !== undefined && Object.hasOwn(simple, code)) return { value: simple[code] as string, length: 1 };
  const width = code === "x" ? 2 : code === "u" ? 4 : code === "U" ? 8 : 0;
  if (width === 0) return undefined;
  const hex = text.slice(index + 1, index + 1 + width);
  if (!new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) return undefined;
  const point = Number.parseInt(hex, 16);
  if (point > 0x10ffff) return undefined;
  return { value: String.fromCodePoint(point), length: 1 + width };
}

/**
 * The text of a quoted scalar from just after its opening quote; it may run over several lines,
 * folded as YAML folds them (a line break is a space, each empty line a newline). Returns where it
 * ended so the caller can check what follows the closing quote.
 */
function readQuoted(
  lines: readonly string[],
  startIndex: number,
  startColumn: number,
  quote: "'" | '"',
): { value: string; endIndex: number; rest: string } | { error: string } {
  let value = "";
  let index = startIndex;
  let column = startColumn;
  for (;;) {
    const line = lines[index] as string;
    while (column < line.length) {
      const character = line[column] as string;
      if (quote === "'" && character === "'") {
        if (line[column + 1] === "'") {
          value += "'";
          column += 2;
          continue;
        }
        return { value, endIndex: index, rest: line.slice(column + 1) };
      }
      if (quote === '"' && character === '"') return { value, endIndex: index, rest: line.slice(column + 1) };
      if (quote === '"' && character === "\\") {
        if (column + 1 >= line.length) {
          // An escaped line break: joins the lines with nothing between them.
          index = nextContinuation(lines, index);
          if (index < 0) return { error: "unclosed double-quoted value" };
          column = indentationOf(lines[index] as string);
          continue;
        }
        const escape = escapeCharacter(line, column + 1);
        if (escape === undefined) return { error: `unknown escape \\${line[column + 1]} in a double-quoted value` };
        value += escape.value;
        column += 1 + escape.length;
        continue;
      }
      value += character;
      column++;
    }
    // The line ended inside the quotes: fold into the next non-empty line.
    value = value.replace(/[ \t]+$/, "");
    let empty = 0;
    index++;
    while (index < lines.length && isBlank(lines[index] as string)) {
      empty++;
      index++;
    }
    if (index >= lines.length) return { error: `unclosed ${quote === '"' ? "double" : "single"}-quoted value` };
    value += empty > 0 ? "\n".repeat(empty) : " ";
    const next = lines[index] as string;
    column = next.length - next.trimStart().length;
  }
}

function nextContinuation(lines: readonly string[], index: number): number {
  return index + 1 < lines.length ? index + 1 : -1;
}

/** What may follow a closing quote: spaces and a comment. */
function onlyComment(rest: string): boolean {
  return /^[ \t]*(#.*)?$/.test(rest);
}

/** A plain scalar without its trailing comment. */
function plainScalar(text: string): string {
  const comment = text.search(/[ \t]#/);
  return (comment < 0 ? text : text.slice(0, comment)).trim();
}

/** One flow-sequence item or `- item`: quoted or plain. */
function scalarItem(text: string): { value: string } | { error: string } {
  const trimmed = text.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quoted = readQuoted([trimmed], 0, 1, trimmed[0] as "'" | '"');
    if ("error" in quoted) return quoted;
    if (!onlyComment(quoted.rest)) return { error: `unexpected text after a quoted value: ${quoted.rest.trim()}` };
    return { value: quoted.value };
  }
  return { value: plainScalar(trimmed) };
}

/** `[a, "b, c", 'd']` on one line. */
function flowSequence(text: string): { value: string[] } | { error: string } {
  const comment = /\][ \t]*(#.*)?$/.exec(text);
  if (!text.startsWith("[") || comment === null) return { error: "a [list] must close on its line" };
  const inner = text.slice(1, comment.index);
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let index = 0; index < inner.length; index++) {
    const character = inner[index] as string;
    if (quote !== null) {
      current += character;
      if (quote === '"' && character === "\\") {
        current += inner[index + 1] ?? "";
        index++;
      } else if (character === quote) {
        if (quote === "'" && inner[index + 1] === "'") {
          current += "'";
          index++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    if (character === ",") {
      items.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (quote !== null) return { error: "unclosed quote in a [list]" };
  if (current.trim() !== "" || items.length > 0) items.push(current);
  const values: string[] = [];
  for (const item of items) {
    if (item.trim() === "") continue;
    const parsed = scalarItem(item);
    if ("error" in parsed) return parsed;
    values.push(parsed.value);
  }
  return { value: values };
}

/** A `|` or `>` block scalar's lines (already without their indentation), folded and chomped. */
function blockScalar(style: string, chomping: string, content: readonly string[]): string {
  let end = content.length;
  while (end > 0 && content[end - 1] === "") end--;
  const trailingEmpty = content.length - end;
  const body = content.slice(0, end);
  let text = "";
  if (style === "|") {
    text = body.join("\n");
  } else {
    let previous: "normal" | "more" | null = null;
    let empty = 0;
    for (const line of body) {
      if (line === "") {
        empty++;
        continue;
      }
      const kind = line.startsWith(" ") || line.startsWith("\t") ? "more" : "normal";
      if (previous === null) text += "\n".repeat(empty);
      else if (previous === "normal" && kind === "normal") text += empty > 0 ? "\n".repeat(empty) : " ";
      else text += "\n".repeat(empty + 1);
      text += line;
      previous = kind;
      empty = 0;
    }
  }
  if (body.length === 0) return chomping === "+" ? "\n".repeat(trailingEmpty) : "";
  if (chomping === "-") return text;
  if (chomping === "+") return text + "\n".repeat(trailingEmpty + 1);
  return `${text}\n`;
}

/** Parses the frontmatter lines (between the `---` lines); `firstLine` is the file line of `lines[0]`. */
export function parseYamlSubset(lines: readonly string[], firstLine: number): YamlResult {
  const entries = new Map<string, YamlEntry>();
  const problems: YamlResult["problems"] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    const lineNumber = firstLine + index;
    if (isBlank(line) || /^[ \t]*#/.test(line)) {
      index++;
      continue;
    }
    const match = KEY_LINE.exec(line);
    if (match === null) {
      problems.push({ line: lineNumber, message: "frontmatter line is not `key: value`" });
      index++;
      continue;
    }
    const key = match[1] as string;
    const rest = match[2] ?? "";
    if (entries.has(key)) problems.push({ line: lineNumber, message: `duplicate frontmatter key "${key}"` });
    const set = (value: YamlValue): void => {
      if (!entries.has(key)) entries.set(key, { value, line: lineNumber });
    };
    // The lines indented under this key (and blank lines among them).
    const nested = (): string[] => {
      const found: string[] = [];
      let next = index + 1;
      while (next < lines.length) {
        const candidate = lines[next] as string;
        if (!isBlank(candidate) && indentationOf(candidate) === 0 && !candidate.startsWith("\t")) break;
        found.push(candidate);
        next++;
      }
      while (found.length > 0 && isBlank(found[found.length - 1] as string)) found.pop();
      return found;
    };

    const block = BLOCK_HEADER.exec(rest);
    if (block !== null) {
      const style = block[1] as string;
      const chomping = block[2] || block[4] || "";
      const explicit = block[3] === "" ? 0 : Number(block[3]);
      // Trailing blank lines belong to the scalar (keep chomping), so collect without trimming them.
      const raw: string[] = [];
      let next = index + 1;
      while (next < lines.length) {
        const candidate = lines[next] as string;
        if (!isBlank(candidate) && indentationOf(candidate) === 0) break;
        raw.push(candidate);
        next++;
      }
      // A trailing blank run before the next key belongs to the scalar only if indented content follows; at the end it is kept for `+`.
      const firstContent = raw.find((candidate) => !isBlank(candidate));
      const indentation = explicit > 0 ? explicit : firstContent === undefined ? 0 : indentationOf(firstContent);
      if (raw.some((candidate) => !isBlank(candidate) && indentationOf(candidate) < indentation)) {
        problems.push({ line: lineNumber, message: `block value of "${key}" is less indented than its first line` });
      }
      set(blockScalar(style, chomping, raw.map((candidate) => (isBlank(candidate) ? "" : candidate.slice(indentation)))));
      index = next;
      continue;
    }

    if (rest === "" || rest.startsWith("#")) {
      const children = nested();
      const sameLevel: string[] = [];
      // `key:` then `- item` lines at the key's own indentation is a list too.
      let next = index + 1 + children.length;
      if (children.length === 0) {
        while (next < lines.length && /^-([ \t]|$)/.test(lines[next] as string)) {
          sameLevel.push(lines[next] as string);
          next++;
        }
      }
      const itemLines = children.length > 0 ? children : sameLevel;
      if (itemLines.length === 0) {
        set(null);
        index++;
        continue;
      }
      const items: string[] = [];
      itemLines.forEach((itemLine, offset) => {
        if (isBlank(itemLine)) return;
        const item = /^[ \t]*-(?:[ \t]+(.*))?$/.exec(itemLine);
        if (item === null) {
          problems.push({ line: lineNumber + 1 + offset, message: `"${key}" holds something other than a list of - items` });
          return;
        }
        const text = item[1] ?? "";
        if (/^[|>]/.test(text) || /^[[{]/.test(text)) {
          problems.push({ line: lineNumber + 1 + offset, message: `"${key}" list item is not a plain or quoted value` });
          return;
        }
        const parsed = scalarItem(text);
        if ("error" in parsed) problems.push({ line: lineNumber + 1 + offset, message: parsed.error });
        else items.push(parsed.value);
      });
      set(items);
      index += 1 + itemLines.length;
      continue;
    }

    if (rest.startsWith("[")) {
      const parsed = flowSequence(rest);
      if ("error" in parsed) problems.push({ line: lineNumber, message: `"${key}": ${parsed.error}` });
      else set(parsed.value);
      index++;
      continue;
    }
    if (rest.startsWith("{")) {
      problems.push({ line: lineNumber, message: `"${key}" holds a {mapping}, which Taro cannot convert` });
      index++;
      continue;
    }

    if (rest.startsWith('"') || rest.startsWith("'")) {
      // The quoted value starts after `key:` and its spaces: find that column in the line.
      const column = line.indexOf(rest) + 1;
      const quoted = readQuoted(lines, index, column, rest[0] as "'" | '"');
      if ("error" in quoted) {
        problems.push({ line: lineNumber, message: `"${key}": ${quoted.error}` });
        index++;
        continue;
      }
      if (!onlyComment(quoted.rest)) problems.push({ line: firstLine + quoted.endIndex, message: `"${key}": unexpected text after the closing quote` });
      set(quoted.value);
      index = quoted.endIndex + 1;
      continue;
    }

    // A plain scalar, perhaps continued on more-indented lines (folded with spaces, empty lines as newlines).
    const children = nested();
    let value = plainScalar(rest);
    let empty = 0;
    for (const child of children) {
      if (isBlank(child)) {
        empty++;
        continue;
      }
      value += empty > 0 ? "\n".repeat(empty) : " ";
      value += plainScalar(child);
      empty = 0;
    }
    set(value === "~" || value === "null" ? null : value);
    index += 1 + children.length;
  }
  return { entries, problems };
}

// ---------------------------------------------------------------- task files

export type BacklogParseResult =
  | { ok: true; ticket: Ticket; reports: string[] }
  | { ok: false; problems: TicketProblem[] };

type BacklogSection = "DESCRIPTION" | "PLAN" | "NOTES" | "FINAL_SUMMARY" | "AC" | "DOD";

const SECTION_BEGIN = /^<!-- (?:SECTION:(DESCRIPTION|PLAN|NOTES|FINAL_SUMMARY)|(AC|DOD)):BEGIN -->[ \t]*$/;
/** Headings Backlog writes around its sections; anything else outside a section would be lost. */
const BACKLOG_HEADINGS = new Set([
  "## Description",
  "## Implementation Plan",
  "## Implementation Notes",
  "## Final Summary",
  "## Acceptance Criteria",
  "## Definition of Done",
]);
const BACKLOG_CRITERION = /^- \[([ xX])\] #(\d+) (.*)$/;
const ID_SHAPE = /^[A-Za-z][A-Za-z0-9]*-\d+(\.\d+)*$/;
const BACKLOG_DATE = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?)?$/;
/** Backlog keys Taro has no place for; dropped silently when empty, reported when not. */
const SILENTLY_DROPPED = new Set(["ordinal"]);
const KNOWN_KEYS = new Set(["id", "title", "status", "priority", "labels", "dependencies", "parent_task_id", "created_date", "updated_date", "assignee"]);

function endMarker(section: BacklogSection): string {
  return section === "AC" || section === "DOD" ? `<!-- ${section}:END -->` : `<!-- SECTION:${section}:END -->`;
}

function normaliseNewlines(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.split("\r\n").join("\n");
}

/** Section text: the lines between the markers, without the blank lines Backlog leaves at either end. */
function sectionText(lines: readonly string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start] as string)) start++;
  while (end > start && isBlank(lines[end - 1] as string)) end--;
  return lines.slice(start, end).join("\n");
}

/** `2026-10-13 11:21` (Backlog's format, UTC) or `2026-10-13` → `2026-10-13T11:21:00Z`. */
export function backlogDate(value: string): string | null {
  const match = BACKLOG_DATE.exec(value.trim());
  if (match === null) return null;
  const iso = `${match[1]}T${match[2] ?? "00"}:${match[3] ?? "00"}:${match[4] ?? "00"}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function described(value: YamlValue): string {
  return Array.isArray(value) ? value.join(", ") : (value ?? "");
}

function isEmptyValue(value: YamlValue): boolean {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export function parseBacklogTask(text: string, fileName: string): BacklogParseResult {
  const lines = normaliseNewlines(text).split("\n");
  const problems: TicketProblem[] = [];
  const reports: string[] = [];
  const problem = (line: number, message: string): void => {
    problems.push({ file: fileName, line, message });
  };
  if ((lines[0] ?? "").trimEnd() !== "---") {
    problem(1, "a Backlog task file starts with a `---` frontmatter line");
    return { ok: false, problems };
  }
  let closing = -1;
  for (let index = 1; index < lines.length; index++) {
    if ((lines[index] as string).trimEnd() === "---") {
      closing = index;
      break;
    }
  }
  if (closing < 0) {
    problem(1, "unclosed frontmatter: no closing `---` line");
    return { ok: false, problems };
  }
  const yaml = parseYamlSubset(lines.slice(1, closing), 2);
  for (const entry of yaml.problems) problem(entry.line, entry.message);
  const fields = yaml.entries;
  const closingLine = closing + 1;

  const scalar = (key: string): string | null => {
    const entry = fields.get(key);
    if (entry === undefined || entry.value === null) return null;
    if (Array.isArray(entry.value)) {
      problem(entry.line, `"${key}" must be a single value, not a list`);
      return null;
    }
    return entry.value;
  };
  const list = (key: string): string[] => {
    const entry = fields.get(key);
    if (entry === undefined || entry.value === null) return [];
    if (typeof entry.value === "string") return entry.value === "" ? [] : [entry.value];
    return entry.value;
  };
  const required = (key: string): string | null => {
    const value = scalar(key);
    if (value === null || value.trim() === "") {
      if (!fields.has(key) || fields.get(key)?.value === null || fields.get(key)?.value === "") {
        problem(fields.get(key)?.line ?? closingLine, `missing "${key}"`);
      }
      return null;
    }
    return value;
  };

  const id = required("id");
  if (id !== null && !ID_SHAPE.test(id)) problem(fields.get("id")?.line ?? 1, `id "${id}" is not a ticket id (like TR-081 or TR-081.01)`);
  const title = required("title");

  const backlogStatus = scalar("status");
  let status: Ticket["status"] = "Backlog";
  if (backlogStatus !== null && isTicketStatus(backlogStatus)) status = backlogStatus;
  else reports.push(backlogStatus === null ? "no status; set to Backlog" : `status "${backlogStatus}" is not one of Taro's; set to Backlog`);

  const backlogPriority = scalar("priority");
  let priority: TicketPriority | null = null;
  if (backlogPriority !== null && backlogPriority !== "") {
    const lower = backlogPriority.toLowerCase();
    if ((TICKET_PRIORITIES as readonly string[]).includes(lower)) priority = lower as TicketPriority;
    else reports.push(`priority "${backlogPriority}" is not high, medium or low; dropped`);
  }

  const dateOf = (key: string): string | null => {
    const value = scalar(key);
    if (value === null || value === "") return null;
    const iso = backlogDate(value);
    if (iso === null) problem(fields.get(key)?.line ?? closingLine, `"${key}" is not a date like 2026-10-13 11:21`);
    return iso;
  };
  const created = dateOf("created_date");
  if (created === null && !problems.some((entry) => entry.message.includes("created_date"))) problem(closingLine, 'missing "created_date"');
  const updated = dateOf("updated_date") ?? created;

  const parentValue = scalar("parent_task_id");
  const parent = parentValue === null || parentValue === "" ? null : parentValue;
  if (parent !== null && !ID_SHAPE.test(parent)) problem(fields.get("parent_task_id")?.line ?? 1, `parent_task_id "${parent}" is not a ticket id`);
  const dependsOn = list("dependencies");
  const labels = list("labels");

  const assignee = fields.get("assignee")?.value ?? null;
  if (!isEmptyValue(assignee)) reports.push(`assignee ${described(assignee)} dropped`);
  for (const [key, entry] of fields) {
    if (KNOWN_KEYS.has(key) || SILENTLY_DROPPED.has(key) || isEmptyValue(entry.value)) continue;
    reports.push(`${key} ${described(entry.value)} dropped`);
  }

  // Body: sections by their markers. Inside a section only its own end marker counts, so text that
  // shows other Backlog markers (in a code fence, say) stays as it is.
  const sections = new Map<BacklogSection, { line: number; content: string[] }>();
  let open: { name: BacklogSection; line: number; content: string[] } | null = null;
  for (let index = closing + 1; index < lines.length; index++) {
    const line = lines[index] as string;
    const lineNumber = index + 1;
    if (open !== null) {
      if (line.trimEnd() === endMarker(open.name)) {
        if (sections.has(open.name)) problem(open.line, `duplicate section ${open.name}`);
        else sections.set(open.name, { line: open.line, content: open.content });
        open = null;
      } else {
        open.content.push(line);
      }
      continue;
    }
    const begin = SECTION_BEGIN.exec(line);
    if (begin !== null) {
      open = { name: (begin[1] ?? begin[2]) as BacklogSection, line: lineNumber, content: [] };
      continue;
    }
    if (isBlank(line) || BACKLOG_HEADINGS.has(line.trimEnd())) continue;
    problem(lineNumber, "text outside Backlog's section markers would be lost; move it into a section");
  }
  if (open !== null) {
    const current: { name: BacklogSection; line: number } = open;
    problem(current.line, `unclosed section ${current.name}: no "${endMarker(current.name)}" line`);
  }

  const criteria: Criterion[] = [];
  const criteriaSection = sections.get("AC");
  criteriaSection?.content.forEach((line, offset) => {
    if (isBlank(line)) return;
    const match = BACKLOG_CRITERION.exec(line);
    if (match === null) {
      problem(criteriaSection.line + offset + 1, "criteria lines must be `- [ ] #<n> <text>` or `- [x] #<n> <text>`");
      return;
    }
    criteria.push({ index: Number(match[2]), text: match[3] ?? "", checked: match[1] !== " " });
  });
  const definitionOfDone = (sections.get("DOD")?.content ?? []).filter((line) => !isBlank(line));
  if (definitionOfDone.length > 0) {
    reports.push(`Definition of Done dropped (${definitionOfDone.length} ${definitionOfDone.length === 1 ? "line" : "lines"})`);
  }

  if (problems.length > 0) return { ok: false, problems: problems.sort((left, right) => left.line - right.line) };
  const textOf = (name: BacklogSection): string => sectionText(sections.get(name)?.content ?? []);
  const ticket: Ticket = {
    id: id as string,
    title: title as string,
    status,
    priority,
    labels,
    parent,
    dependsOn,
    created: created as string,
    updated: updated as string,
    description: textOf("DESCRIPTION"),
    plan: textOf("PLAN"),
    criteria,
    notes: textOf("NOTES"),
    finalSummary: textOf("FINAL_SUMMARY"),
    extra: {},
  };
  return { ok: true, ticket, reports };
}

// ---------------------------------------------------------------- the tracker

export const BACKLOG_FOLDERS = ["tasks", "completed", "archive/tasks", "drafts"] as const;
export const CONVERSION_COMMIT_MESSAGE = "taro: convert tracker to Taro's format";
export const GITIGNORE_ENTRIES = [".taro/", "tickets/.*.tmp"];

export interface PlannedTicket {
  /** Relative to the tracker: `backlog/tasks/tr-001 - Title.md`. */
  source: string;
  folder: (typeof BACKLOG_FOLDERS)[number];
  /** Relative to the tracker: `tickets/TR-001.md`. */
  target: string;
  ticket: Ticket;
  reports: string[];
}

export interface ConversionPlan {
  trackerPath: string;
  tickets: PlannedTicket[];
  tracker: TrackerFile;
  /** About the tracker as a whole: files under backlog/ that are removed without being converted. */
  reports: string[];
  /** Any problem makes the real run refuse. */
  problems: TicketProblem[];
}

export interface ConversionResult {
  plan: ConversionPlan;
  commit: string;
}

/** A refusal: one clear line, nothing changed. */
export class ConversionRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversionRefused";
  }
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

async function filesUnder(root: string, relative: string): Promise<string[]> {
  const entries = await readdir(join(root, relative), { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await filesUnder(root, path)));
    else found.push(path);
  }
  return found;
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Reads `backlog/` and works out every ticket file and tracker.json; never writes. */
export async function planConversion(trackerPath: string): Promise<ConversionPlan> {
  const backlog = join(trackerPath, "backlog");
  let configText: string;
  try {
    configText = await readFile(join(backlog, "config.yml"), "utf8");
  } catch {
    throw new ConversionRefused(`No backlog/config.yml in ${trackerPath}: nothing to convert.`);
  }
  const problems: TicketProblem[] = [];
  const config = parseYamlSubset(normaliseNewlines(configText).split("\n"), 1);
  for (const entry of config.problems) problems.push({ file: "backlog/config.yml", line: entry.line, message: entry.message });
  const configScalar = (key: string): string | null => {
    const value = config.entries.get(key)?.value;
    return typeof value === "string" ? value : null;
  };
  // Backlog writes ids with its prefix upper-cased; its default prefix is "task".
  const prefix = (configScalar("task_prefix") ?? "task").toUpperCase();
  const paddingText = configScalar("zero_padded_ids");
  const padding = paddingText !== null && /^\d+$/.test(paddingText) ? Number(paddingText) : 0;
  const ownId = new RegExp(`^${prefix.replace(/[^A-Za-z0-9]/g, "\\$&")}-(\\d+)((?:\\.\\d+)*)$`, "i");

  const tickets: PlannedTicket[] = [];
  const converted = new Set<string>(["config.yml"]);
  for (const folder of BACKLOG_FOLDERS) {
    const names = (await readdir(join(backlog, folder)).catch(() => [] as string[])).filter((name) => name.endsWith(".md") && !name.startsWith(".")).sort();
    for (const name of names) {
      const source = `backlog/${folder}/${name}`;
      converted.add(`${folder}/${name}`);
      let text: string;
      try {
        text = await readFile(join(backlog, folder, name), "utf8");
      } catch (error) {
        problems.push({ file: source, line: 1, message: `cannot be read: ${(error as Error).message}` });
        continue;
      }
      const parsed = parseBacklogTask(text, source);
      if (!parsed.ok) {
        problems.push(...parsed.problems);
        continue;
      }
      const { ticket } = parsed;
      const own = ownId.exec(ticket.id);
      if (own === null) {
        problems.push({ file: source, line: 1, message: `id "${ticket.id}" does not fit the prefix ${prefix}; give it a ${prefix}- id or remove the file first` });
        continue;
      }
      ticket.id = `${prefix}-${own[1]}${own[2]}`;
      if (ticket.parent !== null) {
        const parentOwn = ownId.exec(ticket.parent);
        if (parentOwn !== null) ticket.parent = `${prefix}-${parentOwn[1]}${parentOwn[2]}`;
      }
      const reports = folder === "tasks" ? parsed.reports : [`from backlog/${folder}`, ...parsed.reports];
      tickets.push({ source, folder, target: `tickets/${ticket.id}.md`, ticket, reports });
    }
  }
  tickets.sort((left, right) => compareIds(left.ticket.id, right.ticket.id));
  const seen = new Map<string, string>();
  for (const planned of tickets) {
    const earlier = seen.get(planned.ticket.id);
    if (earlier !== undefined) problems.push({ file: planned.source, line: 1, message: `id ${planned.ticket.id} is also used by ${earlier}` });
    else seen.set(planned.ticket.id, planned.source);
  }

  let lastId = 0;
  const lastChild: Record<string, number> = {};
  for (const { ticket } of tickets) {
    const own = ownId.exec(ticket.id);
    if (own === null) continue;
    lastId = Math.max(lastId, Number(own[1]));
    const dot = ticket.id.lastIndexOf(".");
    if (dot > 0) {
      const parentId = ticket.id.slice(0, dot);
      lastChild[parentId] = Math.max(lastChild[parentId] ?? 0, Number(ticket.id.slice(dot + 1)));
    }
  }

  const reports = (await filesUnder(backlog, ""))
    .filter((path) => !converted.has(path))
    .sort()
    .map((path) => `backlog/${path} is removed with backlog/, not converted`);
  return {
    trackerPath,
    tickets,
    tracker: { schema: 1, prefix, padding, lastId, lastChild },
    reports,
    problems: problems.sort((left, right) => compareIds(left.file, right.file) || left.line - right.line),
  };
}

/** The dry run's lines: one per ticket and its reports, the tracker's reports and problems, then totals. */
export function describePlan(plan: ConversionPlan): string {
  const lines: string[] = [];
  for (const planned of plan.tickets) {
    lines.push(`${planned.ticket.id} → ${planned.target}`);
    for (const report of planned.reports) lines.push(`  ${report}`);
  }
  lines.push(...plan.reports);
  for (const entry of plan.problems) lines.push(`${entry.file}:${entry.line}: ${entry.message}`);
  const byFolder = BACKLOG_FOLDERS.map((folder) => `${plan.tickets.filter((planned) => planned.folder === folder).length} ${folder}`).join(", ");
  const reportCount = plan.tickets.reduce((count, planned) => count + planned.reports.length, 0) + plan.reports.length;
  const { tracker } = plan;
  lines.push(
    `${plural(plan.tickets.length, "ticket")} (${byFolder}), ${plural(reportCount, "report")}, ${plural(plan.problems.length, "problem")}; ` +
      `tracker.json: prefix ${tracker.prefix}, padding ${tracker.padding}, lastId ${tracker.lastId}`,
  );
  return `${lines.join("\n")}\n`;
}

async function git(trackerPath: string, args: readonly string[]): Promise<string> {
  return runChecked("git", args, { cwd: trackerPath });
}

/** The refusals that leave everything as it is. */
async function assertConvertible(trackerPath: string): Promise<void> {
  // An empty tickets/ (an older plugin made one while watching) holds nothing to lose.
  const tickets = join(trackerPath, "tickets");
  if (await exists(tickets) && (await readdir(tickets)).length > 0) throw new ConversionRefused(`${tickets} already exists: this tracker looks converted.`);
  if (await exists(join(trackerPath, "tracker.json"))) throw new ConversionRefused(`${join(trackerPath, "tracker.json")} already exists: this tracker looks converted.`);
}

function withGitignoreEntries(existing: string): string {
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = GITIGNORE_ENTRIES.filter((entry) => !present.has(entry));
  if (missing.length === 0) return existing;
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  return `${existing}${separator}${missing.join("\n")}\n`;
}

/** Writes every ticket, tracker.json and .gitignore under the tracker lock, removes backlog/ and commits once as Taro. */
export async function convertTracker(trackerPath: string): Promise<ConversionResult> {
  if (!(await exists(join(trackerPath, "backlog", "config.yml")))) {
    throw new ConversionRefused(`No backlog/config.yml in ${trackerPath}: nothing to convert.`);
  }
  await assertConvertible(trackerPath);
  const status = await git(trackerPath, ["status", "--porcelain"]);
  if (status.trim() !== "") throw new ConversionRefused(`${trackerPath} has uncommitted changes (git status --porcelain); commit or discard them first.`);
  const plan = await planConversion(trackerPath);
  const [first] = plan.problems;
  if (first !== undefined) {
    const more = plan.problems.length > 1 ? ` (and ${plan.problems.length - 1} more; see taro convert --dry-run)` : "";
    throw new ConversionRefused(`${first.file}:${first.line}: ${first.message}${more}`);
  }

  const store = createTicketStore(trackerPath);
  await store.withLock(async () => {
    await assertConvertible(trackerPath);
    try {
      await writeConversion(trackerPath, plan);
    } catch (error) {
      throw await rolledBack(trackerPath, error);
    }
  });
  const commit = (await git(trackerPath, ["rev-parse", "HEAD"])).trim();
  return { plan, commit };
}

/**
 * A step failed after writing began (git's index lock held a moment, a signing setup that
 * fails): the tree was clean before, so HEAD plus removing the new files puts it back exactly.
 */
async function rolledBack(trackerPath: string, error: unknown): Promise<ConversionRefused> {
  const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
  try {
    await git(trackerPath, ["reset", "-q", "--hard", "HEAD"]);
    await rm(join(trackerPath, "tickets"), { recursive: true, force: true });
    await rm(join(trackerPath, "tracker.json"), { force: true });
    return new ConversionRefused(`${reason} — the tracker was put back as it was; fix that and run taro convert again.`);
  } catch {
    return new ConversionRefused(`${reason} — and putting the tracker back failed; restore it with: git -C ${trackerPath} reset --hard && rm -rf -- ${join(trackerPath, "tickets")} ${join(trackerPath, "tracker.json")}`);
  }
}

async function writeConversion(trackerPath: string, plan: ConversionPlan): Promise<void> {
  const ticketsDirectory = join(trackerPath, "tickets");
  await mkdir(ticketsDirectory, { recursive: true });
  for (const { ticket } of plan.tickets) {
    await replaceFile(ticketsDirectory, `.${ticket.id}.${tempSuffix()}`, join(ticketsDirectory, `${ticket.id}.md`), serializeTicket(ticket));
  }
  await replaceFile(join(trackerPath, ".taro"), `tracker.json.${tempSuffix()}`, join(trackerPath, "tracker.json"), `${JSON.stringify(plan.tracker)}\n`);
  const gitignore = join(trackerPath, ".gitignore");
  const existing = await readFile(gitignore, "utf8").catch(() => "");
  await replaceFile(join(trackerPath, ".taro"), `gitignore.${tempSuffix()}`, gitignore, withGitignoreEntries(existing));
  await git(trackerPath, ["rm", "-r", "-q", "backlog"]);
  // git leaves the folders it does not track (Backlog.md's empty docs/, decisions/, .locks/); the tree was clean, so nothing else is in them.
  await rm(join(trackerPath, "backlog"), { recursive: true, force: true });
  await git(trackerPath, ["add", "tickets", "tracker.json", ".gitignore"]);
  await git(trackerPath, [
    "-c",
    "user.name=Taro",
    "-c",
    "user.email=taro@localhost",
    "commit",
    "--no-verify",
    "-q",
    "-m",
    CONVERSION_COMMIT_MESSAGE,
  ]);
}
