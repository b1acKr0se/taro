/**
 * What the Stats tab's review findings section shows for its query: nothing until an answer arrives (a daemon
 * without the RPC, an older plugin, answers with an error, and the Stats table below draws as before), the empty
 * state when no review has recorded findings, else the All models row and one row per model.
 */

export interface FindingsRowData {
  model: string;
  tickets: number;
  high: number;
  medium: number;
  low: number;
  escapes: number;
}

export interface FindingsQueryState {
  data: { models: FindingsRowData[]; all: FindingsRowData } | undefined;
  error: unknown;
}

export type FindingsSection = { kind: "hidden" } | { kind: "empty" } | { kind: "rows"; all: FindingsRowData; models: FindingsRowData[] };

export function findingsSection(query: FindingsQueryState): FindingsSection {
  // A refetch that fails keeps the rows already shown; with none, the section stays out of the way.
  if (query.data === undefined) return { kind: "hidden" };
  // A row whose model a mismatched daemon left out would draw a blank name.
  const models = query.data.models.filter((row) => row.model !== "" && row.tickets > 0);
  if (models.length === 0) return { kind: "empty" };
  return { kind: "rows", all: { ...query.data.all, model: "All models" }, models };
}

/** High findings per ticket reviewed, two decimals. */
export function highPerTicketText(row: FindingsRowData): string {
  return row.tickets === 0 ? "0.00" : (row.high / row.tickets).toFixed(2);
}

/** The phone's count beside the model. */
export function reviewedText(row: FindingsRowData): string {
  return `· ${row.tickets} reviewed`;
}
