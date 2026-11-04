// Calendar-day arithmetic on ISO dates (yyyy-mm-dd), in UTC so results never depend on the server's time zone.

const ISO_DAY = "yyyy-mm-dd".length;

const parts = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined || [y, m, d].some(Number.isNaN)) throw new Error(`Not an ISO date: ${day}`);
  return { y, m, d };
};

const format = (date: Date) => date.toISOString().slice(0, ISO_DAY);

/** The calendar day of an ISO date or date-time. */
export const isoDay = (isoDateTime: string) => isoDateTime.slice(0, ISO_DAY);

export function addDays(day: string, days: number): string {
  const { y, m, d } = parts(day);
  return format(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Adds calendar months; a day past the end of the target month clamps to its last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(day: string, months: number): string {
  const { y, m, d } = parts(day);
  const lastDay = new Date(Date.UTC(y, m + months, 0)).getUTCDate();
  return format(new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))));
}
