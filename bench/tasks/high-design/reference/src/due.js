const DAY = 86_400_000;

/** `2026-03-10` as a count of days, so dates subtract. Null for anything that is not a real calendar day. */
export function dayNumber(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.getTime() / DAY;
}

/** A day count as `YYYY-MM-DD`. */
export function dayText(number) {
  return new Date(number * DAY).toISOString().slice(0, 10);
}

/** Today: `NOTES_TODAY` when it is set, else the local date. */
export function today() {
  const fixed = process.env.NOTES_TODAY;
  if (fixed !== undefined && dayNumber(fixed) !== null) return fixed;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** What `--due` says as a stored date, or null for `none`; an error for anything else. */
export function parseDue(value) {
  if (value === "none") return null;
  if (value === "today") return today();
  if (value === "tomorrow") return dayText(dayNumber(today()) + 1);
  if (dayNumber(value) === null) throw new Error("a due date must be YYYY-MM-DD");
  return value;
}
