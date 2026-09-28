import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { customer, member, organization, serviceEvent, user } from "@/db/schema";
import { getTimezone } from "@/lib/company";
import { buttonEmail, sendEmail } from "@/lib/email";
import { sendSms, toE164 } from "@/lib/sms";
import { fmtDate, fmtTime } from "@/lib/time";

const APP_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export type Channel = "email" | "text";

export type NoticeOutcome =
  | { status: "sent"; to: string }
  | { status: "skipped"; reason: "no_email" | "no_phone" | "bad_phone" | "opted_out" | "already_sent" | "not_found" }
  | { status: "failed"; error: string };

async function loadVisit(eventId: string) {
  const [row] = await db
    .select({
      ev: serviceEvent,
      orgName: organization.name,
      cust: {
        street: customer.street,
        unit: customer.unit,
        email: customer.email,
        phone: customer.phone,
        emailProof: customer.emailProof,
        textProof: customer.textProof,
      },
    })
    .from(serviceEvent)
    .innerJoin(organization, eq(organization.id, serviceEvent.organizationId))
    .leftJoin(customer, eq(customer.id, serviceEvent.customerId))
    .where(eq(serviceEvent.id, eventId));
  return row ?? null;
}

const COLS = {
  email: { at: serviceEvent.customerEmailedAt, atKey: "customerEmailedAt", errKey: "customerEmailError" },
  text: { at: serviceEvent.customerTextedAt, atKey: "customerTextedAt", errKey: "customerTextError" },
} as const;

/**
 * Claims the visit for this channel, sends, and records the result.
 * Automatic sends only claim when nothing was sent yet (so retries and races never double-send);
 * `resend` is the dispatcher's "Send again" and always goes out.
 */
async function deliver(eventId: string, channel: Channel, resend: boolean, send: () => Promise<void>, to: string): Promise<NoticeOutcome> {
  const c = COLS[channel];
  const claimed = await db
    .update(serviceEvent)
    .set({ [c.atKey]: new Date(), [c.errKey]: null })
    .where(resend ? eq(serviceEvent.id, eventId) : and(eq(serviceEvent.id, eventId), isNull(c.at)))
    .returning({ id: serviceEvent.id });
  if (claimed.length === 0) return { status: "skipped", reason: "already_sent" };
  try {
    await send();
    return { status: "sent", to };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db
      .update(serviceEvent)
      .set({ [c.atKey]: null, [c.errKey]: error.slice(0, 500) })
      .where(eq(serviceEvent.id, eventId));
    return { status: "failed", error };
  }
}

/** Emails the customer a link to the visit's proof page. Replies go to the company owner. */
export async function emailVisitProof(eventId: string, opts: { resend?: boolean } = {}): Promise<NoticeOutcome> {
  const row = await loadVisit(eventId);
  if (!row) return { status: "skipped", reason: "not_found" };
  const { ev, orgName, cust } = row;
  const to = cust?.email?.trim();
  if (!to) return { status: "skipped", reason: "no_email" };
  if (!opts.resend && !cust!.emailProof) return { status: "skipped", reason: "opted_out" };

  const [owner] = await db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, ev.organizationId), eq(member.role, "owner")))
    .orderBy(member.createdAt)
    .limit(1);

  const url = `${APP_URL}/p/${ev.proofToken}`;
  const tz = await getTimezone(ev.organizationId);
  const photos = ev.photos.length === 0 ? "" : ` with ${ev.photos.length} ${ev.photos.length === 1 ? "photo" : "photos"}`;
  const { html, text } = buttonEmail({
    heading: "Your snow removal is done",
    body:
      `${orgName} cleared the snow at ${ev.addressSnapshot} at ${fmtTime(ev.completedAt, tz)} on ${fmtDate(ev.completedAt, tz)}. ` +
      `The proof page shows the visit${photos}, the time on site, and where the crew's phone was. ` +
      `It's sealed on the Solana blockchain when the storm ends, so the record can't be changed later.`,
    cta: "See proof of service",
    url,
    footer: owner
      ? `You're getting this because ${orgName} services this property. Reply to this email to reach them.`
      : `You're getting this because ${orgName} services this property.`,
  });

  return deliver(
    ev.id,
    "email",
    !!opts.resend,
    () => sendEmail({ to, subject: `Snow cleared: ${ev.addressSnapshot}`, html, text, replyTo: owner?.email }),
    to,
  );
}

/** Texts the customer a short note with the proof link. */
export async function textVisitProof(eventId: string, opts: { resend?: boolean } = {}): Promise<NoticeOutcome> {
  const row = await loadVisit(eventId);
  if (!row) return { status: "skipped", reason: "not_found" };
  const { ev, orgName, cust } = row;
  if (!cust?.phone?.trim()) return { status: "skipped", reason: "no_phone" };
  const to = toE164(cust.phone);
  if (!to) return { status: "skipped", reason: "bad_phone" };
  if (!opts.resend && !cust.textProof) return { status: "skipped", reason: "opted_out" };

  const tz = await getTimezone(ev.organizationId);
  const street = cust.unit ? `${cust.street} ${cust.unit}` : cust.street;
  const body = `${orgName}: snow cleared at ${street}, ${fmtTime(ev.completedAt, tz)}. Photos and proof: ${APP_URL}/p/${ev.proofToken}`;
  return deliver(ev.id, "text", !!opts.resend, () => sendSms({ to, body }), to);
}

/** After a visit uploads: send whichever notices this customer has turned on. */
export async function notifyCustomerOfVisit(eventId: string) {
  const [email, text] = await Promise.all([emailVisitProof(eventId), textVisitProof(eventId)]);
  for (const [ch, o] of [["Email", email], ["Text", text]] as const)
    if (o.status === "failed") console.error(`${ch} proof for visit ${eventId} failed: ${o.error}`);
}
