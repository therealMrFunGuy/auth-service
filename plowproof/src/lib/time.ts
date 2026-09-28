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
