import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { customer, member, organization, serviceEvent, user } from "@/db/schema";
import { buttonEmail, sendEmail } from "@/lib/email";
import { fmtDate, fmtTime } from "@/lib/time";
import { getTimezone } from "@/lib/company";

const APP_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export type ProofEmailOutcome =
  | { status: "sent"; to: string }
  | { status: "skipped"; reason: "no_email" | "opted_out" | "already_sent" | "not_found" }
  | { status: "failed"; error: string };

/**
 * Emails the customer a link to the visit's proof page.
 * Automatic sends claim the row first (customer_emailed_at IS NULL), so a visit is emailed at most once
 * even if two requests race. `resend: true` is the dispatcher's "Send again" and skips that check.
 */
export async function emailVisitProof(eventId: string, opts: { resend?: boolean } = {}): Promise<ProofEmailOutcome> {
  const [row] = await db
    .select({
      ev: serviceEvent,
      email: customer.email,
      emailProof: customer.emailProof,
      orgName: organization.name,
    })
    .from(serviceEvent)
    .innerJoin(organization, eq(organization.id, serviceEvent.organizationId))
    .leftJoin(customer, eq(customer.id, serviceEvent.customerId))
    .where(eq(serviceEvent.id, eventId));
  if (!row) return { status: "skipped", reason: "not_found" };
  const { ev, orgName } = row;
  const to = row.email?.trim();
  if (!to) return { status: "skipped", reason: "no_email" };
  if (!opts.resend && !row.emailProof) return { status: "skipped", reason: "opted_out" };

  const claimed = await db
    .update(serviceEvent)
    .set({ customerEmailedAt: new Date(), customerEmailError: null })
    .where(opts.resend ? eq(serviceEvent.id, ev.id) : and(eq(serviceEvent.id, ev.id), isNull(serviceEvent.customerEmailedAt)))
    .returning({ id: serviceEvent.id });
  if (claimed.length === 0) return { status: "skipped", reason: "already_sent" };

  // Replies go to the company owner, not a no-reply inbox.
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

  try {
    await sendEmail({ to, subject: `Snow cleared: ${ev.addressSnapshot}`, html, text, replyTo: owner?.email });
    return { status: "sent", to };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db
      .update(serviceEvent)
      .set({ customerEmailedAt: null, customerEmailError: error.slice(0, 500) })
      .where(eq(serviceEvent.id, ev.id));
    return { status: "failed", error };
  }
}
