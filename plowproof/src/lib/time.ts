/** Fallback zone for companies that haven't picked one in Settings. */
export const TIMEZONE = process.env.APP_TIMEZONE ?? "America/Chicago";

export const fmtTime = (d: Date, timeZone = TIMEZONE) =>
  d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
export const fmtDate = (d: Date, timeZone = TIMEZONE) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
export const fmtDateTime = (d: Date, timeZone = TIMEZONE) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
export const fmtLongDate = (d: Date, timeZone = TIMEZONE) =>
  d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone });

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Zones offered in Settings: US and Canadian snow country. Any valid IANA zone is still accepted. */
export const TIMEZONE_CHOICES = [
  { value: "America/St_Johns", label: "Newfoundland" },
  { value: "America/Halifax", label: "Atlantic (Halifax)" },
  { value: "America/New_York", label: "Eastern (New York, Toronto)" },
  { value: "America/Chicago", label: "Central (Chicago, Minneapolis)" },
  { value: "America/Winnipeg", label: "Central (Winnipeg)" },
  { value: "America/Regina", label: "Saskatchewan (no DST)" },
  { value: "America/Denver", label: "Mountain (Denver, Salt Lake City)" },
  { value: "America/Edmonton", label: "Mountain (Edmonton, Calgary)" },
  { value: "America/Boise", label: "Mountain (Boise)" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific (Seattle, Tahoe)" },
  { value: "America/Vancouver", label: "Pacific (Vancouver)" },
  { value: "America/Anchorage", label: "Alaska" },
];

/** Milliseconds the zone is ahead of UTC at instant `d` (negative in the Americas). */
function zoneOffsetMs(d: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Midnight at the start of `yyyy-mm-dd` in `timeZone`, as a UTC instant. */
export function startOfDayIn(ymd: string, timeZone: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - zoneOffsetMs(new Date(guess), timeZone);
  t = guess - zoneOffsetMs(new Date(t), timeZone); // second pass settles DST edges
  return new Date(t);
}

/** `yyyy-mm-dd` for instant `d` as seen in `timeZone`. */
export const ymdIn = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Snow seasons run July 1 to June 30. Returns the start of the season containing `d`. */
export function seasonStartYmd(d: Date, timeZone: string) {
  const [y, m] = ymdIn(d, timeZone).split("-").map(Number);
  return `${m >= 7 ? y : y - 1}-07-01`;
}

/** Calendar arithmetic on `yyyy-mm-dd` strings. */
export function addDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
