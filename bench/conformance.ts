/**
 * `node bench/conformance.ts <tracker dir>`: the workflow conformance check (shared/conformance.ts)
 * over every ticket in a tracker, read-only. Prints the violations per ticket and the totals by kind.
 * Runs under Node type stripping: erasable syntax, `.ts` import extensions, no packages.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { conformanceViolations, type ConformanceViolation } from "../shared/conformance.ts";

export interface TrackerReport {
  tickets: number;
  perTicket: { id: string; status: string; violations: ConformanceViolation[] }[];
  totals: Record<string, number>;
  ticketsWithViolations: number;
}

export function checkTracker(trackerDirectory: string): TrackerReport {
  const directory = join(trackerDirectory, "tickets");
  const files = readdirSync(directory).filter((name) => name.endsWith(".md")).sort();
  const perTicket = files.map((name) => {
    const text = readFileSync(join(directory, name), "utf8");
    return { id: name.slice(0, -3), status: /^status:\s*"([^"]+)"/m.exec(text)?.[1] ?? "?", violations: conformanceViolations(text) };
  });
  const totals: Record<string, number> = {};
  perTicket.forEach(({ violations }) => violations.forEach(({ kind }) => (totals[kind] = (totals[kind] ?? 0) + 1)));
  return { tickets: files.length, perTicket, totals, ticketsWithViolations: perTicket.filter(({ violations }) => violations.length > 0).length };
}

export function formatReport(report: TrackerReport): string {
  const lines: string[] = [];
  report.perTicket.forEach(({ id, status, violations }) => {
    if (violations.length === 0) return;
    lines.push(`${id} [${status}]`);
    violations.forEach(({ kind, detail }) => lines.push(`  ${kind}: ${detail}`));
  });
  lines.push("", `${report.tickets} tickets, ${report.ticketsWithViolations} with violations`);
  Object.entries(report.totals)
    .sort((left, right) => right[1] - left[1])
    .forEach(([kind, count]) => lines.push(`  ${kind}: ${count}`));
  return lines.join("\n");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2];
  if (directory === undefined) {
    console.error("usage: node bench/conformance.ts <tracker dir>");
    process.exit(2);
  }
  console.log(formatReport(checkTracker(directory)));
}
