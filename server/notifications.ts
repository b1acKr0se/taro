/**
 * Telling the user when something enters Needs you (TR-059). Paseo has no plugin notification API and
 * pushes nothing for agents with a parent, which every task owner is, so Taro sends its own:
 *
 * - to the phone, an Expo push exactly as Paseo's daemon sends one (`push/push-service.js`): to the
 *   tokens the app registered in `$PASEO_HOME/push-tokens.json`, read only and never rewritten, with
 *   `{ serverId, agentId, workspaceId }` so a tap opens the agent. Both files are Paseo's own and
 *   undocumented; a missing or reshaped one sends nothing and is logged once.
 * - to a desktop window, through the feed its client polls; the window shows it with Paseo's own
 *   desktop notifier. Like Paseo (`agent-attention-policy.js`), the phone is not pushed while a window
 *   that can show it was used in the last three minutes.
 */
import { join } from "node:path";

import type { FeedNotification } from "../shared/contracts";
import { freshEntries, HOST_SEEN, isHostEntry, needsYouEntries, SeenEntriesSchema, someonePresent, type NeedsYouEntry, type SeenEntries } from "../shared/notifications";
import { loadBoard } from "./board";
import { paseoHome, statePath } from "./data-dir";
import { readJsonIfPresent, readTextIfPresent, writeJsonAtomically } from "./files";
import type { PaseoApi } from "./host-types";
import { readProjectConfig } from "./projects";
import type { BoardAlert } from "../shared/recovery";
import { serialized } from "./serialize";
import type { PluginState } from "./state";

/** Paseo's `EXPO_PUSH_URL`; `TARO_EXPO_PUSH_URL` points a throwaway daemon's tests at a local stand-in. */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_BATCH_SIZE = 100;
/** Notifications a window can still collect; it polls every few seconds, so a short list is plenty. */
const FEED_LENGTH = 50;

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: "default";
}

/** The tokens of `push-tokens.json` (`{ subscriptions: [{ token, expiresAt }] }`) whose lease has not run out. */
export function activePushTokens(raw: unknown, now: number): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const subscriptions = (raw as { subscriptions?: unknown }).subscriptions;
  if (!Array.isArray(subscriptions)) return [];
  const tokens = subscriptions.flatMap((value: unknown) => {
    if (typeof value !== "object" || value === null) return [];
    const { token, expiresAt } = value as { token?: unknown; expiresAt?: unknown };
    if (typeof token !== "string" || token.trim() === "" || typeof expiresAt !== "string") return [];
    const expires = Date.parse(expiresAt);
    return Number.isFinite(expires) && expires > now ? [token.trim()] : [];
  });
  return [...new Set(tokens)];
}

/** What a tap opens: Paseo's app routes a notification by these fields. */
export function notificationData(entry: NeedsYouEntry, serverId: string | null): Record<string, string> {
  return {
    ...(serverId === null ? {} : { serverId }),
    ...(entry.agentId === null ? {} : { agentId: entry.agentId }),
    ...(entry.workspaceId === null ? {} : { workspaceId: entry.workspaceId }),
  };
}

export function expoMessages(tokens: readonly string[], entry: NeedsYouEntry, serverId: string | null): ExpoMessage[] {
  const data = notificationData(entry, serverId);
  return tokens.map((to) => ({ to, title: entry.title, body: entry.body, data, sound: "default" }));
}


export interface NotifierOptions {
  fetch?: typeof fetch;
  now?: () => number;
  pushUrl?: string;
  home?: string;
}

function seenPath(): string {
  return statePath("notified.json");
}

export class Notifier {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly pushUrl: string;
  private readonly home: string | null;
  private readonly activeAt = new Map<string, number>();
  private feed: FeedNotification[] = [];
  private seq = 0;
  private warned = new Set<string>();

  constructor(options: NotifierOptions = {}) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.pushUrl = options.pushUrl ?? process.env.TARO_EXPO_PUSH_URL ?? EXPO_PUSH_URL;
    this.home = options.home ?? null;
  }

  /** A window reports in; `active` when it can show a notification and was used in the last three minutes. */
  poll(clientId: string, active: boolean, after: number): { seq: number; notifications: FeedNotification[] } {
    if (active) this.activeAt.set(clientId, this.now());
    else this.activeAt.delete(clientId);
    // A window's first poll starts from now: what was sent before it opened is not replayed. A window
    // ahead of the count saw the plugin before a reload, so all that was sent since is new to it.
    if (after < 0) return { seq: this.seq, notifications: [] };
    return { seq: this.seq, notifications: after > this.seq ? [...this.feed] : this.feed.filter((notification) => notification.seq > after) };
  }

  /**
   * Looks at a project's board, with the queue check's alerts (which live in memory, outside the
   * board), and announces what entered Needs you since the last look.
   */
  check(paseo: PaseoApi, state: PluginState, project: string, queueAlerts: readonly BoardAlert[] = []): Promise<number> {
    return serialized(`notify:${project}`, async () => {
      const config = await readProjectConfig(project);
      if (config === null) return 0;
      const board = await loadBoard(paseo, state, project, queueAlerts);
      const entries = needsYouEntries(
        board,
        config.managerWorkspaceId === "" ? null : config.managerWorkspaceId,
        config.managerAgentId === "" ? null : config.managerAgentId,
      );
      return this.announce(project, entries, config.notify);
    });
  }

  /**
   * Announces the entries not seen before, and keeps them all as seen; switched off, only keeps them.
   * Host entries (threads running low) are kept seen once for every project, so they are announced once.
   */
  async announce(project: string, entries: readonly NeedsYouEntry[], notify: boolean): Promise<number> {
    const fresh = await serialized("notified", async () => {
      const all = await this.readSeen();
      const own = freshEntries(all[project] ?? null, entries.filter((entry) => !isHostEntry(entry.key)), this.now());
      all[project] = own.seen;
      // Only a project that announces looks after the host's entries: one switched off must not swallow them for the rest.
      if (!notify) {
        await writeJsonAtomically(seenPath(), all);
        return own.fresh;
      }
      const host = freshEntries(all[HOST_SEEN] ?? null, entries.filter((entry) => isHostEntry(entry.key)), this.now());
      all[HOST_SEEN] = host.seen;
      await writeJsonAtomically(seenPath(), all);
      return [...host.fresh, ...own.fresh];
    });
    // Switched off, entries are still taken as seen: switching on again announces nothing old.
    if (!notify || fresh.length === 0) return 0;
    await this.send(fresh);
    return fresh.length;
  }

  /** Sends one test push to every registered phone, for the user's say-so check (run by hand when testing). */
  async sendTest(): Promise<number> {
    const tokens = await this.tokens();
    await this.push(expoMessages(tokens, { key: "test", title: "Taro test", body: "If you can read this, Taro can reach your phone.", agentId: null, workspaceId: null }, await this.serverId()));
    return tokens.length;
  }

  private async send(entries: readonly NeedsYouEntry[]): Promise<void> {
    const serverId = await this.serverId();
    for (const entry of entries) {
      this.seq += 1;
      this.feed.push({ seq: this.seq, title: entry.title, body: entry.body, data: notificationData(entry, serverId) });
    }
    this.feed = this.feed.slice(-FEED_LENGTH);
    if (someonePresent(this.activeAt.values(), this.now())) return;
    const tokens = await this.tokens();
    await this.push(entries.flatMap((entry) => expoMessages(tokens, entry, serverId)));
  }

  private async push(messages: readonly ExpoMessage[]): Promise<void> {
    for (let start = 0; start < messages.length; start += MAX_BATCH_SIZE) {
      const batch = messages.slice(start, start + MAX_BATCH_SIZE);
      try {
        const response = await this.fetch(this.pushUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(batch),
        });
        if (!response.ok) {
          console.error(`[taro] the push service answered ${response.status} ${response.statusText}`);
          continue;
        }
        const result = (await response.json().catch(() => null)) as { data?: { status?: string; details?: { error?: string } }[] } | null;
        // A refused token is Paseo's to revoke (its token store owns the file); Taro only says so. Expo's
        // message quotes the token, so only its error code is logged.
        (result?.data ?? []).forEach((ticket, index) => {
          if (ticket.status === "error") console.error(`[taro] push ${start + index + 1} was refused: ${ticket.details?.error ?? "no reason given"}`);
        });
      } catch (error: unknown) {
        console.error("[taro] could not send push notifications:", error);
      }
    }
  }

  private paseoHome(): string {
    return this.home ?? paseoHome();
  }

  private async tokens(): Promise<string[]> {
    const raw = await readJsonIfPresent(join(this.paseoHome(), "push-tokens.json")).catch(() => undefined);
    if (raw === null) {
      this.warnOnce("tokens", "[taro] no phone has registered for Paseo's push notifications yet");
      return [];
    }
    if (raw === undefined || typeof raw !== "object" || !Array.isArray((raw as { subscriptions?: unknown }).subscriptions)) {
      this.warnOnce("tokens", "[taro] Paseo's push-tokens.json is unreadable or reshaped; no phone notifications");
      return [];
    }
    return activePushTokens(raw, this.now());
  }

  private async serverId(): Promise<string | null> {
    // Paseo reads the same override first (`server-id.js`).
    const override = process.env.PASEO_SERVER_ID?.trim() ?? "";
    if (override !== "") return override;
    const text = await readTextIfPresent(join(this.paseoHome(), "server-id")).catch(() => null);
    const id = text?.trim() ?? "";
    if (id === "") this.warnOnce("server-id", "[taro] Paseo's server-id could not be read; a tap on a notification opens the app only");
    return id === "" ? null : id;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(message);
  }

  private async readSeen(): Promise<Record<string, SeenEntries>> {
    const raw = await readJsonIfPresent(seenPath()).catch(() => null);
    if (typeof raw !== "object" || raw === null) return {};
    const all: Record<string, SeenEntries> = {};
    for (const [project, seen] of Object.entries(raw)) {
      const parsed = SeenEntriesSchema.safeParse(seen);
      if (parsed.success) all[project] = parsed.data;
    }
    return all;
  }
}
