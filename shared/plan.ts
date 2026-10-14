/**
 * The plan of a scope approval (TR-061), written by owners in the template's sections
 * (`skill/templates/plan.md`). Parsed so the approval card can show Goal, Choices I made and Size
 * as labelled rows, and the Ticket tab can show every section with its limit; a plan without a Goal
 * section is an older free-form one and stays Markdown.
 */

export type PlanSectionKey = "goal" | "choices" | "see" | "outOfScope" | "proof" | "size";

/** The template's sections in order, each with its limit: lines for Goal and Size, bullets for the rest. */
export const PLAN_SECTIONS: readonly { key: PlanSectionKey; heading: string; limit: number }[] = [
  { key: "goal", heading: "Goal", limit: 1 },
  { key: "choices", heading: "Choices I made", limit: 4 },
  { key: "see", heading: "What you'll see", limit: 5 },
  { key: "outOfScope", heading: "Out of scope", limit: 3 },
  { key: "proof", heading: "How I'll prove it", limit: 4 },
  { key: "size", heading: "Size", limit: 1 },
];

export interface PlanSection {
  /** The template section it is, or null for one the template does not have. */
  key: PlanSectionKey | null;
  /** The heading as the owner wrote it. */
  heading: string;
  /** The bullets, a wrapped bullet's lines joined. */
  items: string[];
  /** Lines that are not bullets, joined by line breaks. */
  prose: string;
  /** The template's limit, or null for an unknown section. */
  limit: number | null;
  /** How many bullets (or, for Goal and Size, lines) it has past its limit. */
  over: number;
}

/** One "Choices I made" bullet, split at its first dash: the choice and its one-line why. */
export interface PlanChoice {
  choice: string;
  why: string;
}

export interface ParsedPlan {
  /** Text before the first heading. */
  intro: string;
  /** The template's sections present, in template order, then unknown ones in the order written. */
  sections: PlanSection[];
  goal: string;
  choices: PlanChoice[];
  size: string;
  /** Past-limit counts per template section; 0 when within it or missing. */
  over: Record<PlanSectionKey, number>;
}

const HEADING = /^#{1,3}\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const CHOICE_SEPARATOR = / (?:—|–|--|-) /;

function headingKey(heading: string): PlanSectionKey | null {
  const normalized = heading.replace(/[’‘`]/g, "'").replace(/:$/, "").trim().toLowerCase();
  return PLAN_SECTIONS.find((section) => section.heading.toLowerCase() === normalized)?.key ?? null;
}

interface RawSection {
  key: PlanSectionKey | null;
  heading: string;
  lines: string[];
}

function sectionFrom(raw: RawSection): PlanSection {
  const items: string[] = [];
  const prose: string[] = [];
  let lastWasBullet = false;
  raw.lines.forEach((line) => {
    if (line.trim() === "") {
      lastWasBullet = false;
      return;
    }
    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      items.push((bullet[1] ?? "").trim());
      lastWasBullet = true;
    } else if (lastWasBullet && /^\s+/.test(line)) {
      // An indented line under a bullet wraps it.
      items[items.length - 1] = `${items[items.length - 1] ?? ""} ${line.trim()}`;
    } else {
      prose.push(line.trim());
      lastWasBullet = false;
    }
  });
  const limit = raw.key === null ? null : PLAN_SECTIONS.find((section) => section.key === raw.key)?.limit ?? null;
  const oneLine = raw.key === "goal" || raw.key === "size";
  const count = oneLine ? prose.length + items.length : items.length;
  return { key: raw.key, heading: raw.heading, items, prose: prose.join("\n"), limit, over: limit === null ? 0 : Math.max(0, count - limit) };
}

/** A one-line section's text: its prose, or its bullets when it was written as a list. */
function lineOf(section: PlanSection | undefined): string {
  if (section === undefined) return "";
  return [section.prose.replace(/\n/g, " "), ...section.items].filter((part) => part !== "").join(" ");
}

export function splitChoice(item: string): PlanChoice {
  const match = CHOICE_SEPARATOR.exec(item);
  if (match === null) return { choice: item.trim(), why: "" };
  return { choice: item.slice(0, match.index).trim(), why: item.slice(match.index + match[0].length).trim() };
}

/** The plan's sections, or null when it has no Goal section (no plan, or an older free-form one). */
export function parsePlan(markdown: string | null): ParsedPlan | null {
  if (markdown === null || markdown.trim() === "") return null;
  const raws: RawSection[] = [];
  const intro: string[] = [];
  let inFence = false;
  markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((line) => {
      if (FENCE.test(line)) inFence = !inFence;
      const heading = inFence ? null : HEADING.exec(line);
      if (heading !== null) {
        const text = (heading[1] ?? "").trim();
        raws.push({ key: headingKey(text), heading: text, lines: [] });
        return;
      }
      const current = raws[raws.length - 1];
      if (current === undefined) intro.push(line);
      else current.lines.push(line);
    });
  // A repeated template heading adds to the first one.
  const merged: RawSection[] = [];
  raws.forEach((raw) => {
    const earlier = raw.key === null ? undefined : merged.find((each) => each.key === raw.key);
    if (earlier === undefined) merged.push({ ...raw, lines: [...raw.lines] });
    else earlier.lines.push("", ...raw.lines);
  });
  const sections = merged.map(sectionFrom);
  const byKey = (key: PlanSectionKey) => sections.find((section) => section.key === key);
  const goal = byKey("goal");
  if (goal === undefined) return null;
  const known = PLAN_SECTIONS.flatMap((template) => {
    const section = byKey(template.key);
    return section === undefined ? [] : [section];
  });
  const over = Object.fromEntries(PLAN_SECTIONS.map((template) => [template.key, byKey(template.key)?.over ?? 0])) as Record<PlanSectionKey, number>;
  return {
    intro: intro.join("\n").trim(),
    sections: [...known, ...sections.filter((section) => section.key === null)],
    goal: lineOf(goal),
    choices: (byKey("choices")?.items ?? []).map(splitChoice),
    size: lineOf(byKey("size")),
    over,
  };
}
