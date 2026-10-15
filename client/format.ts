/**
 * Formatting functions shared by the Taro screen. `formatTokenCount`,
 * `contextPercent`, `contextTone`, `relativeTime`, `shortPath` and `errorText`
 * come from FirstMate's `client/format.ts` (MIT).
 */
import type { PluginTheme } from "@getpaseo/plugin";

/** A token count as Paseo's own context meter writes it: "840", "84k", "1m". */
export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return Math.round(value).toString();
}

/** How full a context window is, in percent, or null while the provider has not said. */
export function contextPercent(used: number | null | undefined, max: number | null | undefined): number | null {
  if (typeof used !== "number" || typeof max !== "number") return null;
  if (!Number.isFinite(used) || !Number.isFinite(max) || used < 0 || max <= 0) return null;
  return (used / max) * 100;
}

/** The meter's colour, at Paseo's own thresholds: past 90% danger, from 70% a warning. */
export function contextTone(theme: PluginTheme, percent: number): string {
  if (percent > 90) return theme.colors.statusDanger;
  if (percent >= 70) return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** The last `max` characters of a path, from a separator. */
export function shortPath(path: string, max = 48): string {
  if (path.length <= max) return path;
  const tail = path.slice(-max);
  const cut = tail.indexOf("/");
  return `…${cut > 0 ? tail.slice(cut) : tail}`;
}

/** The provider and model, `claude/opus` style. */
export function modelLabel(agent: { provider: string; model: string | null }): string {
  return agent.model === null ? agent.provider : `${agent.provider}/${agent.model}`;
}

/** The handler's own sentence, without the RPC wrapper ("Request failed: … requestType=… code=…"). */
export function errorText(caught: unknown): string {
  const raw = caught instanceof Error ? caught.message : String(caught);
  const clean = raw
    .replace(/^Request failed:\s*/, "")
    .replace(/\s+requestType=\S+(\s+code=\S+)?\s*$/, "")
    .trim();
  return clean === "" ? raw : clean;
}

/** A span of time at a glance: "40s", "12m", "2h 05m", "3d 4h"; "—" for nothing. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * A Done card's "26m wall · 25m active · 5 turns". No-break spaces keep each figure with its word, so a
 * narrow card wraps only after a "·" (TR-103).
 */
export function cardStatsText(stats: { wallMs: number; agentActiveMs: number; turns: number }): string {
  const together = (text: string) => text.replace(/ /g, "\u00a0");
  return [
    `${formatDuration(stats.wallMs)} wall`,
    `${formatDuration(stats.agentActiveMs)} active`,
    `${stats.turns} turn${stats.turns === 1 ? "" : "s"}`,
  ]
    .map(together)
    .join(" · ");
}

/** Dollars to the cent, below a cent as "<$0.01"; "—" when no agent reported a cost. */
export function formatCost(usd: number | null): string {
  if (usd === null) return "—";
  if (usd > 0 && usd < 0.005) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** "PR #42 · owner/repo" for a GitHub-style pull request URL, else the URL itself. */
export function pullRequestLabel(url: string): string {
  const match = /\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(url);
  // No-break spaces keep "PR #42 ·" together when a card's meta line wraps (TR-095).
  return match === null ? url : `PR\u00a0#${match[2]}\u00a0· ${match[1]}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A record's clock time on the milestone timeline, in local time ("14:03"); null when it has none or it is unreadable. */
export function formatClock(iso: string | null): string | null {
  const then = readTime(iso);
  if (then === null) return null;
  return `${String(then.getHours()).padStart(2, "0")}:${String(then.getMinutes()).padStart(2, "0")}`;
}

/**
 * The day a record falls on, in local time, for the timeline's day headings: "Today", "Yesterday",
 * "Oct 12", or "Oct 12 2025" in another year; null when it has no readable time.
 */
export function formatDay(iso: string | null, now: number = Date.now()): string | null {
  const then = readTime(iso);
  if (then === null) return null;
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const same = (left: Date, right: Date) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  if (same(then, today)) return "Today";
  if (same(then, yesterday)) return "Yesterday";
  const day = `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === today.getFullYear() ? day : `${day} ${then.getFullYear()}`;
}

function readTime(iso: string | null): Date | null {
  if (iso === null) return null;
  const then = new Date(iso);
  return Number.isNaN(then.getTime()) ? null : then;
}
