/**
 * The chat composer's pick lists (TR-232): `/` lists the agent's commands, `@` the project's files and
 * `#` its tickets. Finding the word being typed, ranking each list and putting a pick into the text,
 * pure, for vitest and the phone's Hermes.
 */

export type PickKind = "command" | "file" | "ticket";

/** The word being typed that opens a list: `[start, end)` is the whole word around the cursor, `query` the text between the trigger character and the cursor. */
export interface ActiveTrigger {
  kind: PickKind;
  start: number;
  end: number;
  query: string;
  atStart: boolean;
}

const TRIGGER_KINDS: Record<string, PickKind> = { "/": "command", "@": "file", "#": "ticket" };

const WHITESPACE = /\s/;
const QUOTE = /["']/;

/**
 * The trigger whose word holds the cursor, or null. A trigger opens only at a word's start, so an
 * address (`alex@example.com`), `C#` or `a/b` does not; a word with a second `/` is a path, not a command.
 */
export function findActiveTrigger(text: string, cursor: number): ActiveTrigger | null {
  const clamped = Math.max(0, Math.min(cursor, text.length));
  let start = clamped;
  while (start > 0 && !WHITESPACE.test(text.charAt(start - 1))) start -= 1;
  if (start === clamped) return null;
  const kind = TRIGGER_KINDS[text.charAt(start)];
  if (kind === undefined) return null;
  const query = text.slice(start + 1, clamped);
  if (QUOTE.test(query)) return null;
  let end = clamped;
  while (end < text.length && !WHITESPACE.test(text.charAt(end))) end += 1;
  if (kind === "command" && text.slice(start + 1, end).includes("/")) return null;
  return { kind, start, end, query, atStart: text.slice(0, start).trim() === "" };
}

// Fuzzy matching: the query's letters in order, case-insensitive, scored so word starts, runs of
// letters and (for paths) the file name win. A small dynamic programme finds the best placement,
// as the first placement found greedily often lands in a folder name rather than the file's.

const SCORE_MATCH = 1;
const SCORE_WORD_START = 8;
const SCORE_CASE_CHANGE = 7;
const SCORE_CONSECUTIVE = 5;
const SCORE_IN_NAME = 4;
const PENALTY_GAP_START = 3;
const PENALTY_GAP_EXTENSION = 1;
const SEPARATORS = "/-_. :";

function isLower(character: string): boolean {
  return character >= "a" && character <= "z";
}

function isUpper(character: string): boolean {
  return character >= "A" && character <= "Z";
}

function characterScore(text: string, index: number, nameStart: number): number {
  let score = SCORE_MATCH;
  if (index >= nameStart) score += SCORE_IN_NAME;
  if (index === 0) return score + SCORE_WORD_START;
  const previous = text.charAt(index - 1);
  if (SEPARATORS.includes(previous)) return score + SCORE_WORD_START;
  if (isLower(previous) && isUpper(text.charAt(index))) return score + SCORE_CASE_CHANGE;
  return score;
}

function isSubsequence(lowerText: string, lowerQuery: string): boolean {
  let position = 0;
  for (let index = 0; index < lowerQuery.length; index += 1) {
    const found = lowerText.indexOf(lowerQuery.charAt(index), position);
    if (found === -1) return false;
    position = found + 1;
  }
  return true;
}

interface FuzzyMatch {
  score: number;
  hits: number[];
}

/**
 * The best placement of `lowerQuery` in `text`, or null. `nameStart`: where letters earn the file-name
 * bonus (0 for text that is all name). Without `withHits` only the score is worked out, in two rows.
 */
let scratchPrevious = new Float64Array(256);
let scratchCurrent = new Float64Array(256);

function fuzzyMatch(text: string, lowerText: string, lowerQuery: string, nameStart: number, withHits: boolean): FuzzyMatch | null {
  const queryLength = lowerQuery.length;
  const textLength = text.length;
  if (queryLength === 0 || queryLength > textLength || !isSubsequence(lowerText, lowerQuery)) return null;
  // rows[i][j]: the best score with query letter i placed at j; from[i][j]: where letter i - 1 sits then.
  // Without hits two shared rows serve every call, as allocating per path dominated a large list.
  const from: Int32Array[] = [];
  if (!withHits && scratchPrevious.length < textLength) {
    scratchPrevious = new Float64Array(textLength * 2);
    scratchCurrent = new Float64Array(textLength * 2);
  }
  let previous = withHits ? new Float64Array(textLength) : scratchPrevious;
  let current = withHits ? new Float64Array(textLength) : scratchCurrent;
  for (let queryIndex = 0; queryIndex < queryLength; queryIndex += 1) {
    current.fill(-Infinity, 0, textLength);
    const origin = withHits ? new Int32Array(textLength).fill(-1) : null;
    const letter = lowerQuery.charAt(queryIndex);
    // The best earlier placement two or more letters back, less the gap it leaves.
    let gapBest = -Infinity;
    let gapBestIndex = -1;
    for (let textIndex = queryIndex; textIndex < textLength; textIndex += 1) {
      if (queryIndex > 0 && textIndex >= 2) {
        gapBest -= PENALTY_GAP_EXTENSION;
        const candidate = (previous[textIndex - 2] ?? -Infinity) - PENALTY_GAP_START;
        if (candidate > gapBest) {
          gapBest = candidate;
          gapBestIndex = textIndex - 2;
        }
      }
      if (lowerText.charAt(textIndex) !== letter) continue;
      const own = characterScore(text, textIndex, nameStart);
      if (queryIndex === 0) {
        current[textIndex] = own;
        continue;
      }
      const adjacent = (previous[textIndex - 1] ?? -Infinity) + SCORE_CONSECUTIVE;
      const best = adjacent >= gapBest ? adjacent : gapBest;
      if (best === -Infinity) continue;
      current[textIndex] = own + best;
      if (origin !== null) origin[textIndex] = adjacent >= gapBest ? textIndex - 1 : gapBestIndex;
    }
    if (origin !== null) from.push(origin);
    const finished = current;
    current = withHits ? new Float64Array(textLength) : previous;
    previous = finished;
  }
  let score = -Infinity;
  let endIndex = -1;
  for (let textIndex = 0; textIndex < textLength; textIndex += 1) {
    const value = previous[textIndex] ?? -Infinity;
    if (value > score) {
      score = value;
      endIndex = textIndex;
    }
  }
  if (score === -Infinity) return null;
  if (!withHits) return { score, hits: [] };
  const hits: number[] = new Array<number>(queryLength);
  let position = endIndex;
  for (let queryIndex = queryLength - 1; queryIndex >= 0; queryIndex -= 1) {
    hits[queryIndex] = position;
    position = from[queryIndex]?.[position] ?? -1;
  }
  return { score, hits };
}

function compareText(left: string, right: string): number {
  const lowerLeft = left.toLowerCase();
  const lowerRight = right.toLowerCase();
  if (lowerLeft !== lowerRight) return lowerLeft < lowerRight ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function range(start: number, length: number): number[] {
  return Array.from({ length }, (_, offset) => start + offset);
}

// Commands.

export interface AgentCommand {
  name: string;
  description: string;
  argumentHint: string;
  kind?: string | undefined;
}

export interface CommandRow {
  command: AgentCommand;
  hits: readonly number[];
  section: "recent" | "all" | null;
}

const TIER_PREFIX = 0;
const TIER_WORD_START = 1;
const TIER_CONTIGUOUS = 2;
const TIER_SCATTERED = 3;

interface CommandMatch {
  tier: number;
  score: number;
  hits: number[];
}

function matchCommand(name: string, lowerQuery: string): CommandMatch | null {
  const lowerName = name.toLowerCase();
  const first = lowerName.indexOf(lowerQuery);
  if (first === 0) return { tier: TIER_PREFIX, score: 0, hits: range(0, lowerQuery.length) };
  if (first > 0) {
    for (let found = first; found !== -1; found = lowerName.indexOf(lowerQuery, found + 1)) {
      if (SEPARATORS.includes(name.charAt(found - 1)) || (isLower(name.charAt(found - 1)) && isUpper(name.charAt(found)))) {
        return { tier: TIER_WORD_START, score: 0, hits: range(found, lowerQuery.length) };
      }
    }
    return { tier: TIER_CONTIGUOUS, score: 0, hits: range(first, lowerQuery.length) };
  }
  const fuzzy = fuzzyMatch(name, lowerName, lowerQuery, 0, true);
  return fuzzy === null ? null : { tier: TIER_SCATTERED, score: fuzzy.score, hits: fuzzy.hits };
}

/**
 * The `/` list. Empty query: the recently used commands, then the rest alphabetically. Otherwise the
 * matches, best first; within a tier the shorter name, nearer to what was typed, wins (`co` puts
 * `cost` and `compact` above `code-review`). `wordStartsOnly` (a `/` mid-sentence) keeps only names that
 * begin, or have a word beginning, with the query: there a loose match is more often a path (`/tmp`).
 */
export function rankCommands(commands: readonly AgentCommand[], query: string, recent: readonly string[], wordStartsOnly: boolean = false): CommandRow[] {
  if (query === "") {
    const recentRows: CommandRow[] = [];
    recent.forEach((name) => {
      const command = commands.find((candidate) => candidate.name === name);
      if (command !== undefined && !recentRows.some((row) => row.command.name === name)) recentRows.push({ command, hits: [], section: "recent" });
    });
    const rest = commands
      .filter((command) => !recentRows.some((row) => row.command.name === command.name))
      .sort((left, right) => compareText(left.name, right.name))
      .map((command): CommandRow => ({ command, hits: [], section: "all" }));
    return [...recentRows, ...rest];
  }
  const lowerQuery = query.toLowerCase();
  const matched: { command: AgentCommand; match: CommandMatch }[] = [];
  commands.forEach((command) => {
    const match = matchCommand(command.name, lowerQuery);
    if (match !== null && (!wordStartsOnly || match.tier <= TIER_WORD_START)) matched.push({ command, match });
  });
  matched.sort(
    (left, right) =>
      left.match.tier - right.match.tier ||
      right.match.score - left.match.score ||
      left.command.name.length - right.command.name.length ||
      compareText(left.command.name, right.command.name),
  );
  return matched.map((entry) => ({ command: entry.command, hits: entry.match.hits, section: null }));
}

const RECENT_COMMANDS_KEPT = 8;

/** The recent command names with `name` first, its older copy dropped, at most `max`. */
export function rememberCommand(recent: readonly string[], name: string, max: number = RECENT_COMMANDS_KEPT): string[] {
  return [name, ...recent.filter((candidate) => candidate !== name)].slice(0, max);
}

// Files.

export interface FileIndex {
  files: readonly string[];
  changed: readonly { path: string; status: "new" | "changed" }[];
  recent: readonly string[];
  truncated: boolean;
}

export interface FileRow {
  kind: "file" | "folder";
  path: string;
  hits: readonly number[];
  tag: "new" | "changed" | null;
  section: "changed" | "recent" | "top" | null;
}

export interface FileList {
  rows: FileRow[];
  /** The folder being browsed (`client/`), or null. */
  folder: string | null;
  /** How many files the browsed folder holds at any depth, or null. */
  fileCount: number | null;
}

const FILE_ROWS_SHOWN = 50;
const CHANGED_BOOST = 3;
// Per character: among equal matches the shorter path wins, without outweighing a better match.
const PENALTY_PATH_LENGTH = 0.05;

interface FileCandidate {
  path: string;
  lowerPath: string;
  nameStart: number;
  folder: boolean;
}

interface PreparedFiles {
  candidates: FileCandidate[];
  folders: Set<string>;
  topFolders: string[];
  topFiles: string[];
}

// The folders and lower-cased paths, worked out once per file list rather than on every keystroke.
const preparedByFiles = new WeakMap<readonly string[], PreparedFiles>();

function nameStartOf(path: string, folder: boolean): number {
  const searchFrom = folder ? path.length - 2 : path.length - 1;
  return path.lastIndexOf("/", searchFrom) + 1;
}

function prepareFiles(files: readonly string[]): PreparedFiles {
  const cached = preparedByFiles.get(files);
  if (cached !== undefined) return cached;
  const folders = new Set<string>();
  const candidates: FileCandidate[] = [];
  const topFolders: string[] = [];
  const topFiles: string[] = [];
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const path = files[fileIndex] ?? "";
    candidates.push({ path, lowerPath: path.toLowerCase(), nameStart: nameStartOf(path, false), folder: false });
    if (!path.includes("/")) topFiles.push(path);
    // Deepest folder first: once one is known, so are all above it.
    for (let slash = path.lastIndexOf("/"); slash !== -1; slash = slash === 0 ? -1 : path.lastIndexOf("/", slash - 1)) {
      const folder = path.slice(0, slash + 1);
      if (folders.has(folder)) break;
      folders.add(folder);
      candidates.push({ path: folder, lowerPath: folder.toLowerCase(), nameStart: nameStartOf(folder, true), folder: true });
      if (folder.indexOf("/") === slash) topFolders.push(folder);
    }
  }
  topFolders.sort(compareText);
  topFiles.sort(compareText);
  const prepared = { candidates, folders, topFolders, topFiles };
  preparedByFiles.set(files, prepared);
  return prepared;
}

function changedTags(index: FileIndex): Map<string, "new" | "changed"> {
  const tags = new Map<string, "new" | "changed">();
  index.changed.forEach((entry) => tags.set(entry.path, entry.status));
  return tags;
}

function openingRows(index: FileIndex, prepared: PreparedFiles, limit: number): FileRow[] {
  const rows: FileRow[] = [];
  const shown = new Set<string>();
  const add = (row: FileRow): void => {
    if (shown.has(row.path)) return;
    shown.add(row.path);
    rows.push(row);
  };
  index.changed.forEach((entry) => add({ kind: "file", path: entry.path, hits: [], tag: entry.status, section: "changed" }));
  index.recent.forEach((path) => add({ kind: "file", path, hits: [], tag: null, section: "recent" }));
  prepared.topFolders.forEach((path) => add({ kind: "folder", path, hits: [], tag: null, section: "top" }));
  prepared.topFiles.forEach((path) => add({ kind: "file", path, hits: [], tag: null, section: "top" }));
  return rows.slice(0, limit);
}

function folderRows(index: FileIndex, folder: string, limit: number): FileList {
  const tags = changedTags(index);
  const subfolders = new Set<string>();
  const files: string[] = [];
  let fileCount = 0;
  index.files.forEach((path) => {
    if (!path.startsWith(folder)) return;
    fileCount += 1;
    const slash = path.indexOf("/", folder.length);
    if (slash === -1) files.push(path);
    else subfolders.add(path.slice(0, slash + 1));
  });
  const rows: FileRow[] = [
    ...[...subfolders].sort(compareText).map((path): FileRow => ({ kind: "folder", path, hits: [], tag: null, section: null })),
    ...files.sort(compareText).map((path): FileRow => ({ kind: "file", path, hits: [], tag: tags.get(path) ?? null, section: null })),
  ];
  return { rows: rows.slice(0, limit), folder, fileCount };
}

/**
 * The `@` list. Empty query: the branch's changed files, recent ones, then the top level. A query
 * naming a folder (`client/`) lists what is in it; any other query matches over every path.
 */
export function rankFiles(index: FileIndex, query: string, limit: number = FILE_ROWS_SHOWN): FileList {
  const prepared = prepareFiles(index.files);
  if (query === "") return { rows: openingRows(index, prepared, limit), folder: null, fileCount: null };
  if (query.endsWith("/") && prepared.folders.has(query)) return folderRows(index, query, limit);
  const tags = changedTags(index);
  const lowerQuery = query.toLowerCase();
  const short = lowerQuery.length <= SHORT_QUERY_LENGTH;
  const best = createBestList(limit);
  // Typing on narrows the last query's matches: whatever matches `agch` matched `agc`.
  const narrowing = !short && lastLooseMatches !== null && lastLooseMatches.files === index.files && lowerQuery.startsWith(lastLooseMatches.query);
  const candidates = narrowing && lastLooseMatches !== null ? lastLooseMatches.matched : prepared.candidates;
  const matched: FileCandidate[] = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    if (candidate === undefined) continue;
    const score = short ? shortMatchScore(candidate, lowerQuery) : fuzzyMatch(candidate.path, candidate.lowerPath, lowerQuery, candidate.nameStart, false)?.score;
    if (score === undefined || score === null) continue;
    if (!short) matched.push(candidate);
    const boost = tags.has(candidate.path) ? CHANGED_BOOST : 0;
    best.offer(candidate, score + boost - candidate.path.length * PENALTY_PATH_LENGTH);
  }
  if (!short) lastLooseMatches = { files: index.files, query: lowerQuery, matched };
  // Only the rows shown need their matched letters, the costlier pass.
  const rows = best.entries().map((entry): FileRow => {
    const candidate = entry.candidate;
    const hits = short ? shortMatchHits(candidate, lowerQuery) : (fuzzyMatch(candidate.path, candidate.lowerPath, lowerQuery, candidate.nameStart, true)?.hits ?? []);
    return {
      kind: candidate.folder ? "folder" : "file",
      path: candidate.path,
      hits,
      tag: candidate.folder ? null : (tags.get(candidate.path) ?? null),
      section: null,
    };
  });
  return { rows, folder: null, fileCount: null };
}

/**
 * One or two letters match nearly every path loosely, and scoring each placement cost a phone a quarter
 * of a second a keystroke on a large project; so a short query matches only where a word starts, the
 * file name's first, with the letters together.
 */
const SHORT_QUERY_LENGTH = 2;

/** The last loose query's matching paths, for the next keystroke that adds to it. */
let lastLooseMatches: { files: readonly string[]; query: string; matched: FileCandidate[] } | null = null;
const SHORT_NAME_START = 300;
const SHORT_NAME_WORD = 200;
const SHORT_PATH_WORD = 100;

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text.charAt(index - 1);
  return SEPARATORS.includes(previous) || (isLower(previous) && isUpper(text.charAt(index)));
}

/** Where a short query sits at a word start, preferring the file name's start, then a word in the name, then a folder's. */
function shortMatchStart(candidate: FileCandidate, lowerQuery: string): { at: number; score: number } | null {
  if (candidate.lowerPath.startsWith(lowerQuery, candidate.nameStart)) return { at: candidate.nameStart, score: SHORT_NAME_START };
  let inFolder: number | null = null;
  for (let found = candidate.lowerPath.indexOf(lowerQuery); found !== -1; found = candidate.lowerPath.indexOf(lowerQuery, found + 1)) {
    if (!isWordStart(candidate.path, found)) continue;
    if (found >= candidate.nameStart) return { at: found, score: SHORT_NAME_WORD };
    if (inFolder === null) inFolder = found;
  }
  return inFolder === null ? null : { at: inFolder, score: SHORT_PATH_WORD };
}

function shortMatchScore(candidate: FileCandidate, lowerQuery: string): number | null {
  return shortMatchStart(candidate, lowerQuery)?.score ?? null;
}

function shortMatchHits(candidate: FileCandidate, lowerQuery: string): number[] {
  const start = shortMatchStart(candidate, lowerQuery);
  return start === null ? [] : range(start.at, lowerQuery.length);
}

interface ScoredCandidate {
  candidate: FileCandidate;
  score: number;
}

function ranksBefore(left: ScoredCandidate, right: ScoredCandidate): boolean {
  if (left.score !== right.score) return left.score > right.score;
  return compareText(left.candidate.path, right.candidate.path) < 0;
}

/** The best `limit` candidates in order, kept as they come: sorting every match cost more than matching. */
function createBestList(limit: number) {
  const kept: ScoredCandidate[] = [];
  return {
    offer(candidate: FileCandidate, score: number): void {
      const entry = { candidate, score };
      const last = kept[kept.length - 1];
      if (kept.length >= limit && (last === undefined || !ranksBefore(entry, last))) return;
      let position = kept.length;
      while (position > 0) {
        const before = kept[position - 1];
        if (before === undefined || !ranksBefore(entry, before)) break;
        position -= 1;
      }
      kept.splice(position, 0, entry);
      if (kept.length > limit) kept.pop();
    },
    entries(): ScoredCandidate[] {
      return kept;
    },
  };
}

// Tickets.

export interface TicketSummary {
  id: string;
  title: string;
  status: string;
}

export interface TicketRow {
  ticket: TicketSummary;
  hits: readonly number[];
  titleHits: readonly number[];
}

const TICKET_ROWS_SHOWN = 50;
const CLOSED_STATUSES = ["done", "cancelled"];

function ticketNumber(id: string): number {
  const digits = /(\d+)$/.exec(id);
  return digits === null ? -1 : Number(digits[1]);
}

function isOpen(ticket: TicketSummary): boolean {
  return !CLOSED_STATUSES.includes(ticket.status.toLowerCase());
}

interface IdMatch {
  hits: number[];
  exact: boolean;
}

/**
 * The id's letters and digits, lower-cased, with where each sits in the id, so `tr232` and `TR-23`
 * both find `TR-232`.
 */
function idCharacters(id: string): { text: string; positions: number[] } {
  let text = "";
  const positions: number[] = [];
  for (let index = 0; index < id.length; index += 1) {
    const character = id.charAt(index).toLowerCase();
    if (!/[a-z0-9]/.test(character)) continue;
    text += character;
    positions.push(index);
  }
  return { text, positions };
}

/** A match on the id from its start (`tr-23`, `TR232`) or on its number alone (`232`, `39` for `TR-039`). */
function matchTicketId(id: string, query: string): IdMatch | null {
  const wanted = idCharacters(query).text;
  if (wanted === "") return null;
  const own = idCharacters(id);
  if (own.text.startsWith(wanted)) return { hits: own.positions.slice(0, wanted.length), exact: own.text === wanted };
  if (!/^\d+$/.test(wanted)) return null;
  const digits = /(\d+)$/.exec(id);
  if (digits === null) return null;
  const number = digits[1] ?? "";
  const numberStart = id.length - number.length;
  const unpadded = number.replace(/^0+(?=\d)/, "");
  const wantedUnpadded = wanted.replace(/^0+(?=\d)/, "");
  if (number.startsWith(wanted)) return { hits: range(numberStart, wanted.length), exact: number === wanted };
  if (unpadded.startsWith(wantedUnpadded)) {
    const offset = numberStart + number.length - unpadded.length;
    return { hits: range(offset, wantedUnpadded.length), exact: unpadded === wantedUnpadded };
  }
  return null;
}

function byNumberDescending(left: TicketSummary, right: TicketSummary): number {
  return ticketNumber(right.id) - ticketNumber(left.id) || compareText(left.id, right.id);
}

/**
 * The `#` list. Empty query: open tickets, then closed ones, newest first. Otherwise id matches
 * first, then title matches, best first.
 */
export function rankTickets(tickets: readonly TicketSummary[], query: string, limit: number = TICKET_ROWS_SHOWN): TicketRow[] {
  if (query === "") {
    const open = tickets.filter(isOpen).sort(byNumberDescending);
    const closed = tickets.filter((ticket) => !isOpen(ticket)).sort(byNumberDescending);
    return [...open, ...closed].slice(0, limit).map((ticket) => ({ ticket, hits: [], titleHits: [] }));
  }
  const lowerQuery = query.toLowerCase();
  const byId: { ticket: TicketSummary; match: IdMatch }[] = [];
  const byTitle: { ticket: TicketSummary; match: FuzzyMatch }[] = [];
  tickets.forEach((ticket) => {
    const idMatch = matchTicketId(ticket.id, query);
    if (idMatch !== null) {
      byId.push({ ticket, match: idMatch });
      return;
    }
    const titleMatch = fuzzyMatch(ticket.title, ticket.title.toLowerCase(), lowerQuery, 0, true);
    if (titleMatch !== null) byTitle.push({ ticket, match: titleMatch });
  });
  byId.sort(
    (left, right) =>
      Number(right.match.exact) - Number(left.match.exact) || left.ticket.id.length - right.ticket.id.length || byNumberDescending(left.ticket, right.ticket),
  );
  byTitle.sort((left, right) => right.match.score - left.match.score || byNumberDescending(left.ticket, right.ticket));
  return [
    ...byId.map((entry): TicketRow => ({ ticket: entry.ticket, hits: entry.match.hits, titleHits: [] })),
    ...byTitle.map((entry): TicketRow => ({ ticket: entry.ticket, hits: [], titleHits: entry.match.hits })),
  ].slice(0, limit);
}

// Picking.

export type Pick = { kind: "command"; name: string } | { kind: "file"; path: string } | { kind: "folder"; path: string } | { kind: "ticket"; id: string };

function pickText(pick: Pick): string {
  switch (pick.kind) {
    case "command":
      return `/${pick.name}`;
    case "file":
      return WHITESPACE.test(pick.path) ? `@"${pick.path}"` : `@${pick.path}`;
    case "folder": {
      const folder = pick.path.endsWith("/") ? pick.path : `${pick.path}/`;
      return WHITESPACE.test(folder) ? `@"${folder}"` : `@${folder}`;
    }
    case "ticket":
      return pick.id;
  }
}

/**
 * The text with the trigger's word replaced by the pick, and where the cursor goes. A folder leaves the
 * cursor straight after it so the list stays open on that folder; anything else is followed by one space.
 */
export function applyPick(text: string, trigger: ActiveTrigger, pick: Pick): { text: string; cursor: number } {
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  const inserted = pickText(pick);
  const insertedEnd = before.length + inserted.length;
  // A quoted folder ends the word, so it cannot stay open in the list: it goes in like a file.
  if (pick.kind === "folder" && !WHITESPACE.test(pick.path)) return { text: before + inserted + after, cursor: insertedEnd };
  if (WHITESPACE.test(after.charAt(0))) return { text: before + inserted + after, cursor: insertedEnd + 1 };
  return { text: `${before}${inserted} ${after}`, cursor: insertedEnd + 1 };
}

// Keys.

export type PickListKey = "up" | "down" | "pick" | "close";

/** What a key does while a list is open; null leaves it to the text field (Shift+Enter is a new line). */
export function pickListKey(key: string, shiftKey: boolean): PickListKey | null {
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if ((key === "Enter" || key === "Tab") && !shiftKey) return "pick";
  if (key === "Escape") return "close";
  return null;
}

/** The selected row after a move, wrapping round both ends. */
export function moveSelection(index: number, count: number, direction: "up" | "down"): number {
  if (count <= 0) return 0;
  const next = direction === "up" ? index - 1 : index + 1;
  return ((next % count) + count) % count;
}
