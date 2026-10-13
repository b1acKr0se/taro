/**
 * Sketch: reading a project's Backlog.md tasks on the daemon side (decision 15).
 * Not wired up or tested.
 *
 * Backlog.md stores one markdown file per task under backlog/tasks/ with YAML
 * frontmatter and body sections fenced by marker comments, e.g.
 *
 *     ---
 *     id: SH-001
 *     title: Hide LIVE label in activity marquee on mobile
 *     status: Done
 *     parent: SH-000          # optional
 *     dependencies: []
 *     labels: []
 *     ---
 *     ## Description
 *     <!-- SECTION:DESCRIPTION:BEGIN -->
 *     ...
 *     <!-- SECTION:DESCRIPTION:END -->
 *     ## Acceptance Criteria
 *     <!-- AC:BEGIN -->
 *     - [x] #1 ...
 *     <!-- AC:END -->
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export interface Ticket {
  id: string;
  title: string;
  status: string;
  parent: string | null;
  dependencies: string[];
  acceptanceCriteria: { done: boolean; text: string }[];
  notes: string;
  filePath: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const ACCEPTANCE_BLOCK = /<!-- AC:BEGIN -->([\s\S]*?)<!-- AC:END -->/;
const ACCEPTANCE_LINE = /^- \[([ xX])\] (?:#\d+ )?(.*)$/;
const NOTES_BLOCK = /<!-- SECTION:NOTES:BEGIN -->([\s\S]*?)<!-- SECTION:NOTES:END -->/;

export function parseTicket(filePath: string, contents: string): Ticket | null {
  const match = FRONTMATTER.exec(contents);
  if (match === null) return null;
  const frontmatter = parseYaml(match[1]) ?? {};
  const body = match[2];
  if (typeof frontmatter.id !== "string" || typeof frontmatter.title !== "string") return null;

  const acceptanceCriteria = (ACCEPTANCE_BLOCK.exec(body)?.[1] ?? "")
    .split("\n")
    .map((line) => ACCEPTANCE_LINE.exec(line.trim()))
    .filter((lineMatch): lineMatch is RegExpExecArray => lineMatch !== null)
    .map((lineMatch) => ({ done: lineMatch[1] !== " ", text: lineMatch[2] }));

  return {
    id: frontmatter.id,
    title: frontmatter.title,
    status: String(frontmatter.status ?? "Backlog"),
    parent: typeof frontmatter.parent === "string" ? frontmatter.parent : null,
    dependencies: Array.isArray(frontmatter.dependencies) ? frontmatter.dependencies.map(String) : [],
    acceptanceCriteria,
    notes: (NOTES_BLOCK.exec(body)?.[1] ?? "").trim(),
    filePath,
  };
}

/** A file that fails to parse is skipped rather than failing the whole board. */
export async function readTickets(backlogRoot: string): Promise<Ticket[]> {
  const tasksDirectory = path.join(backlogRoot, "backlog", "tasks");
  const fileNames = (await readdir(tasksDirectory)).filter((fileName) => fileName.endsWith(".md"));
  const tickets = await Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = path.join(tasksDirectory, fileName);
      return parseTicket(filePath, await readFile(filePath, "utf8"));
    }),
  );
  return tickets.filter((ticket): ticket is Ticket => ticket !== null);
}
