/** Company-local time for server-rendered pages. Set APP_TIMEZONE outside the Central zone. */
export const TIMEZONE = process.env.APP_TIMEZONE ?? "America/Chicago";

export const fmtTime = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIMEZONE });
export const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TIMEZONE });
export const fmtDateTime = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TIMEZONE });
