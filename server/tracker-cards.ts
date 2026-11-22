/**
 * Cards and agents recorded in the ticket file (`shared/tracker-cards.ts`), written through the ticket store's
 * one locked path: each change is worked out from the ticket as read under the lock, so two writers answering
 * one card at once leave the first answer and refuse the second. Neither agent verb starts anything or writes
 * an EXECUTION record: they only note what a session outside Paseo did itself.
 *
 * Runs under plain `node` type stripping (the `taro` command): erasable TypeScript only, `.ts` import
 * extensions, Node builtins only, nothing of Paseo's or zod.
 */
import type { Ticket } from "../shared/ticket-format.ts";
import {
  agentsOf,
  answerCardIn,
  answerNote,
  askCardIn,
  cardFromInput,
  cardsOf,
  DEFAULT_HOST,
  finishAgentIn,
  recordAgentIn,
  withdrawCardIn,
  type AnswerInput,
  type RecordAgentInput,
  type TrackerAgent,
  type TrackerCard,
} from "../shared/tracker-cards.ts";
import type { TicketChanges, TicketStore } from "./ticket-store.ts";

export interface ClockOptions {
  now?: () => Date;
}

/**
 * Runs `work` on the ticket as read under the tracker lock and writes the changes it returns in the same write.
 * `editIf` checks its condition under the lock before it applies the changes object, so the condition fills
 * that object in; a throw from `work` leaves the ticket untouched.
 */
async function changeUnderLock<T>(store: TicketStore, ticketId: string, work: (ticket: Ticket) => { changes: TicketChanges; result: T }): Promise<{ ticket: Ticket; result: T }> {
  const changes: TicketChanges = {};
  let result: { value: T } | null = null;
  const written = await store.editIf(
    ticketId,
    (ticket) => {
      const outcome = work(ticket);
      Object.assign(changes, outcome.changes);
      result = { value: outcome.result };
      return true;
    },
    changes,
  );
  const settled = result as { value: T } | null;
  if (written === null || settled === null) throw new Error(`${ticketId} was not written.`);
  return { ticket: written, result: settled.value };
}

function stamp(options: ClockOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

/** Records the card (the asker's JSON) as open; an open card with its id is replaced. */
export async function askCard(store: TicketStore, ticketId: string, input: { card: unknown; host?: string | undefined }, options: ClockOptions = {}): Promise<{ ticket: Ticket; card: TrackerCard }> {
  const card = cardFromInput(input.card, input.host ?? DEFAULT_HOST, stamp(options));
  const { ticket } = await changeUnderLock(store, ticketId, (current) => ({ changes: { cards: askCardIn(current.cards, card) }, result: null }));
  return { ticket, card };
}

/** Answers an open card and appends its ANSWER note, in one write: the only writer of that note for a tracker card. */
export async function answerCard(store: TicketStore, ticketId: string, cardId: string, answer: AnswerInput, options: ClockOptions = {}): Promise<{ ticket: Ticket; card: TrackerCard }> {
  const at = stamp(options);
  const { ticket, result } = await changeUnderLock(store, ticketId, (current) => {
    const { section, card } = answerCardIn(current.cards, ticketId, cardId, answer, at);
    return { changes: { cards: section, appendNotes: [answerNote(card)] }, result: card };
  });
  return { ticket, card: result };
}

export async function withdrawCard(store: TicketStore, ticketId: string, cardId: string): Promise<{ ticket: Ticket; card: TrackerCard }> {
  const { ticket, result } = await changeUnderLock(store, ticketId, (current) => {
    const { section, card } = withdrawCardIn(current.cards, ticketId, cardId);
    return { changes: { cards: section }, result: card };
  });
  return { ticket, card: result };
}

export async function recordAgent(store: TicketStore, ticketId: string, input: RecordAgentInput, options: ClockOptions = {}): Promise<{ ticket: Ticket; agent: TrackerAgent }> {
  const at = stamp(options);
  const { ticket, result } = await changeUnderLock(store, ticketId, (current) => {
    const { section, agent } = recordAgentIn(current.agents, ticketId, input, at);
    return { changes: { agents: section }, result: agent };
  });
  return { ticket, agent: result };
}

export async function finishAgent(store: TicketStore, ticketId: string, input: { name: string; state: string }, options: ClockOptions = {}): Promise<{ ticket: Ticket; agent: TrackerAgent }> {
  const at = stamp(options);
  const { ticket, result } = await changeUnderLock(store, ticketId, (current) => {
    const { section, agent } = finishAgentIn(current.agents, ticketId, input.name, input.state, at);
    return { changes: { agents: section }, result: agent };
  });
  return { ticket, agent: result };
}

/** The card as the ticket holds it now, or null when it has none by that id. */
export async function currentCard(store: TicketStore, ticketId: string, cardId: string): Promise<TrackerCard | null> {
  return cardsOf((await store.read(ticketId)).cards).items.find((card) => card.id === cardId) ?? null;
}

/** Polls until the card is no longer open or `seconds` pass: the card as it last read, `timedOut` when still open. */
export async function waitForCard(
  store: TicketStore,
  ticketId: string,
  cardId: string,
  seconds: number,
  options: { pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ card: TrackerCard; timedOut: boolean }> {
  const pollMs = options.pollMs ?? 500;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const card = await currentCard(store, ticketId, cardId);
    if (card === null) throw new Error(`${ticketId} has no card "${cardId}".`);
    if (card.status !== "open") return { card, timedOut: false };
    const left = deadline - Date.now();
    if (left <= 0) return { card, timedOut: true };
    await sleep(Math.min(pollMs, left));
  }
}

export { agentsOf, cardsOf };
