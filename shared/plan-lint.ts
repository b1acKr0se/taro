/**
 * The plan linter: a high ticket's plan approval waits until its children's build specs leave no
 * hole a builder would find later. Writing the definitions of done is what finds them (a child the
 * plan names but nobody created, two children editing one file at the same time, an interface one
 * child uses and none provides, a part too big to build in one go), and an independent review of the
 * plan finds the rest; asking the user to approve before either is asking twice. Each gap is told to
 * the owner in its own terms (`templates/messages/plan-lint.md`), as the mockups hold does. Pure.
 */
import { roundRecords } from "./execution";
import { parsePlan } from "./plan";
import { reopenRound } from "./reopen";
import { ticketLevel } from "./ticket-level";

/** A child ticket as the linter reads it. */
export interface LintChild {
  id: string;
  /** Its definition of done (`skill/templates/definition-of-done.md`). */
  description: string | null;
  labels: readonly string[];
  dependencies: readonly string[];
}

export interface LintTicket {
  labels: readonly string[];
  plan: string | null;
  notes: string | null;
  /** When the plan text last changed (the store's `plan_updated`); null for a plan written before it was recorded. */
  planUpdatedAt: string | null;
  /** The ticket's children; a part naming another id is one that does not exist. */
  children: readonly LintChild[];
}

/** Sizes a child may have: anything bigger is two children. */
const SIZES: ReadonlySet<string> = new Set(["XXS", "XS", "S", "M", "L"]);

const HEADING = /^#{1,3}\s+(.+?)\s*#*\s*$/;
const PLACEHOLDER = /^[-*\s]*<[^>]*>[.\s]*$/;
const RECORD_TIME = /^REVIEW\b[ \t]+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/;
/** `REVIEW <time> — plan review …`: the review of the plan and the child specs before the approval card. */
const PLAN_REVIEW = /^REVIEW\b(?:[ \t]+\d{4}-\d{2}-\d{2}T[\d:.]+Z?)?[ \t]*(?:—|–|--|-|:)?[ \t]*plan review\b/i;

/** Whether a note record is a plan review, which the code review's `verdict: clean` must not be read from. */
export function isPlanReview(record: string): boolean {
  return PLAN_REVIEW.test(record);
}

/** A definition of done's sections by lower-case heading, each with its lines that are not empty or a template placeholder. */
function sectionsOf(markdown: string | null): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  (markdown ?? "").replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const name = (heading[1] ?? "").replace(/:$/, "").trim().toLowerCase();
      current = sections.get(name) ?? [];
      sections.set(name, current);
      return;
    }
    if (current !== null && line.trim() !== "" && !PLACEHOLDER.test(line)) current.push(line);
  });
  return sections;
}

/** The first section present among the names (the template's heading, then the short forms owners write). */
function section(sections: Map<string, string[]>, names: readonly string[]): string[] | null {
  for (const name of names) {
    const found = sections.get(name);
    if (found !== undefined) return found;
  }
  return null;
}

/** The thing a line names: its first backticked span, else its first word, without bullet or trailing punctuation. */
function named(text: string): string {
  const quoted = /`([^`]+)`/.exec(text);
  const raw = quoted !== null ? quoted[1] ?? "" : text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim().split(/\s+/)[0] ?? "";
  return raw.trim().replace(/[,;:]$/, "");
}

/** An interface's name: `toCsv(rows): string` is `toCsv`, `export function readRows` is `readRows`, `POST /api/export` stays whole. */
function interfaceName(text: string): string {
  return named(text)
    .replace(/^(?:export\s+)?(?:async\s+)?(?:function|const|type|interface|class)\s+/, "")
    .split(/[(<{=:]/)[0]!
    .trim();
}

interface Interfaces {
  provides: { name: string; examples: number }[];
  uses: { name: string; existing: boolean }[];
}

const PROVIDE = /^\s*(?:[-*+]\s+)?\**provides?\**:?\s*(.*)$/i;
const USE = /^\s*(?:[-*+]\s+)?\**uses?\**:?\s*(.*)$/i;
const EXAMPLE = /\be\.g\.?/i;
/** `Use: none` or `Provide: none — why`: the line says there is nothing, so it names no interface. */
const NOTHING = /^[`*\s]*none\b/i;

function interfacesOf(lines: readonly string[]): Interfaces {
  const result: Interfaces = { provides: [], uses: [] };
  let last: { name: string; examples: number } | null = null;
  lines.forEach((line) => {
    const provide = PROVIDE.exec(line);
    const use = provide === null ? USE.exec(line) : null;
    if ((provide !== null || use !== null) && NOTHING.test((provide ?? use)?.[1] ?? "")) {
      last = null;
    } else if (provide !== null) {
      last = { name: interfaceName(provide[1] ?? ""), examples: EXAMPLE.test(provide[1] ?? "") ? 1 : 0 };
      result.provides.push(last);
    } else if (use !== null) {
      last = null;
      result.uses.push({ name: interfaceName(use[1] ?? ""), existing: /\bexisting\b/i.test(use[1] ?? "") });
    } else if (EXAMPLE.test(line) && last !== null) {
      last.examples += 1;
    }
  });
  return result;
}

/** A file an Owns line names, as written apart from a leading `./`. */
function ownedFile(line: string): string {
  return named(line).replace(/^\.\//, "");
}

/** Every child that `id` depends on, directly or through others. */
function dependenciesOf(id: string, direct: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [...(direct.get(id) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(direct.get(next) ?? []));
  }
  return seen;
}

/** A record time to the minute (`2026-11-12T10:05`), the precision owners write records in. */
function minuteOf(time: string): string {
  return time.slice(0, 16);
}

/** Whether the round has a plan review written in or after the minute of the plan's last edit. */
function planReviewed(notes: string | null, planUpdatedAt: string | null): boolean {
  const reviews = roundRecords(notes).filter(isPlanReview);
  if (planUpdatedAt === null) return reviews.length > 0;
  return reviews.some((record) => {
    const time = RECORD_TIME.exec(record)?.[1];
    return time !== undefined && time >= minuteOf(planUpdatedAt);
  });
}

/**
 * What the high plan still lacks before its approval may be asked, one line per gap in the owner's
 * terms; empty when it may be asked, and for any ticket that is not high (or a reopened round, worked
 * as low) or a plan not in the template's shape.
 */
export function lintPlan(ticket: LintTicket): string[] {
  if (ticketLevel(ticket.labels) !== "high" || reopenRound(ticket.notes) > 1) return [];
  const plan = parsePlan(ticket.plan);
  if (plan === null) return [];
  const gaps: string[] = [];
  const partsSection = plan.sections.find((each) => each.key === "parts");
  if (partsSection === undefined) gaps.push("a Parts section (one line per child: `<id> — <what it does> — <S|M|L> — depends on: <ids or none>`, or `- none — <why>`)");
  else if (plan.parts.length === 0 && !partsSection.items.some((item) => /^`?none`?\b/i.test(item))) gaps.push("a child line under Parts (`<id> — <what it does> — <S|M|L> — depends on: <ids or none>`), or `- none — <why>`");

  const children = new Map(ticket.children.map((child) => [child.id, child]));
  const direct = new Map<string, string[]>();
  plan.parts.forEach((part) => direct.set(part.id, [...part.dependsOn]));
  ticket.children.forEach((child) => direct.set(child.id, [...new Set([...(direct.get(child.id) ?? []), ...child.dependencies])]));

  const specs: { id: string; owns: string[]; interfaces: Interfaces }[] = [];
  plan.parts.forEach((part) => {
    if (part.size === "") gaps.push(`a size (S, M or L) on ${part.id}'s Parts line`);
    else if (!SIZES.has(part.size)) gaps.push(`a split of ${part.id}: sized ${part.size}, over L (make it two or more children)`);
    const child = children.get(part.id);
    if (child === undefined) {
      gaps.push(`child ticket ${part.id}, named in Parts (create it with \`taro ticket create … -p <parent>\`, or fix the id)`);
      return;
    }
    const sections = sectionsOf(child.description);
    const owns = section(sections, ["owns"]);
    const interfaces = section(sections, ["interfaces"]);
    const tests = section(sections, ["tests required", "tests"]);
    const focus = section(sections, ["review focus"]);
    const lacking: string[] = [];
    if (owns === null || owns.length === 0) lacking.push("Owns (its exact files)");
    if (interfaces === null || interfaces.length === 0) lacking.push("Interfaces (what it provides and uses, or `none — <why>`)");
    if (tests === null || tests.length === 0) lacking.push("Tests required (each test named, with its input and expected output)");
    if (lacking.length > 0) gaps.push(`${lacking.join(", ")} in ${part.id}'s definition of done`);
    if (child.labels.includes("risk") && (focus === null || focus.length === 0)) gaps.push(`a Review Focus in ${part.id}'s definition of done (it is labelled risk: each risky input with the test that covers it)`);
    const read = interfacesOf(interfaces ?? []);
    read.provides.filter((each) => each.examples === 0).forEach((each) => gaps.push(`examples for ${part.id}'s \`${each.name}\` under Interfaces (two or three \`e.g. <call> → <result>\` lines)`));
    specs.push({ id: part.id, owns: (owns ?? []).map(ownedFile).filter((file) => file !== "" && !/^none$/i.test(file)), interfaces: read });
  });

  // Two children that may run at the same time must not change one file.
  specs.forEach((left, leftIndex) => {
    specs.slice(leftIndex + 1).forEach((right) => {
      if (dependenciesOf(left.id, direct).has(right.id) || dependenciesOf(right.id, direct).has(left.id)) return;
      const shared = [...new Set(left.owns.filter((file) => right.owns.includes(file)))];
      if (shared.length > 0) gaps.push(`an owner for ${shared.map((file) => `\`${file}\``).join(", ")}: both ${left.id} and ${right.id} own it and neither depends on the other (give it to one, or add a dependency)`);
    });
  });

  const provided = new Set(specs.flatMap((spec) => spec.interfaces.provides.map((each) => each.name)));
  specs.forEach((spec) => {
    spec.interfaces.uses
      .filter((use) => !use.existing && use.name !== "" && !provided.has(use.name))
      .forEach((use) => gaps.push(`a provider for \`${use.name}\`, which ${spec.id} uses and no child provides (add it to one child's Interfaces, or mark the Use line \`existing\`)`));
  });

  if (!planReviewed(ticket.notes, ticket.planUpdatedAt)) {
    const after = ticket.planUpdatedAt === null ? "" : `, written after the plan's last edit at ${ticket.planUpdatedAt}`;
    gaps.push(`a plan review: an independent reviewer's REVIEW record (\`REVIEW <time> — plan review by <reviewer>: <findings, each fixed or rejected> — verdict: <clean|findings>\`)${after}`);
  }
  return gaps;
}
