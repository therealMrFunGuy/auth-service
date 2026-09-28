import "server-only";

/**
 * Normalizes a North American phone number to E.164 (+15551234567).
 * Numbers already starting with + are kept if they look plausible. Anything else → null.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s*(x|ext\.?)\s*\d+$/i, ""); // drop extensions
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1") && /^[2-9]/.test(digits[1])) return `+${digits}`;
  return null;
}

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM = process.env.TWILIO_FROM;
const SERVICE = process.env.TWILIO_MESSAGING_SERVICE_SID;

export const smsConfigured = () => Boolean(SID && TOKEN && (FROM || SERVICE));

/**
 * Sends a text through Twilio when TWILIO_* is set. Without it (local dev), prints the text to the terminal.
 * Twilio handles STOP/START replies and blocks texts to numbers that opted out.
 */
export async function sendSms({ to, body }: { to: string; body: string }) {
  if (!smsConfigured()) {
    console.log(`\n── Text (dev, not sent) ──\nTo: ${to}\n\n${body}\n──────────────────────────\n`);
    return;
  }
  const form = new URLSearchParams({ To: to, Body: body });
  if (SERVICE) form.set("MessagingServiceSid", SERVICE);
  else form.set("From", FROM!);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}` },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string; code?: number } | null;
    throw new Error(`Text to ${to} failed: ${err?.message ?? res.status}${err?.code ? ` (Twilio ${err.code})` : ""}`);
  }
}
