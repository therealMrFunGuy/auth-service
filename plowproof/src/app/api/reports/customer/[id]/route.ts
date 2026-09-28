import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { customer, serviceEvent } from "@/db/schema";
import { formatAddress } from "@/lib/address";
import { getTimezone } from "@/lib/company";
import { loadReportVisits, pdfResponse, renderReport } from "@/lib/report";
import { getMembership, isDispatcher } from "@/lib/session";
import { addDays, fmtLongDate, seasonStartYmd, startOfDayIn, ymdIn } from "@/lib/time";

export const maxDuration = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Service history for one customer as a PDF. ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, company time zone). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membership = await getMembership();
  if (!membership || !isDispatcher(membership.role)) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const orgId = membership.organizationId;
  const [c] = await db.select().from(customer).where(and(eq(customer.id, id), eq(customer.organizationId, orgId)));
  if (!c) return new Response("Not found", { status: 404 });

  const tz = await getTimezone(orgId);
  const q = new URL(req.url).searchParams;
  const today = ymdIn(new Date(), tz);
  const from = YMD.test(q.get("from") ?? "") ? q.get("from")! : seasonStartYmd(new Date(), tz);
  const to = YMD.test(q.get("to") ?? "") ? q.get("to")! : today;
  if (from > to) return new Response("The start date is after the end date.", { status: 400 });

  const start = startOfDayIn(from, tz);
  const end = startOfDayIn(addDays(to, 1), tz); // exclusive

  const visits = await loadReportVisits(
    and(eq(serviceEvent.organizationId, orgId), eq(serviceEvent.customerId, c.id), gte(serviceEvent.completedAt, start), lt(serviceEvent.completedAt, end)),
  );
  const pdf = await renderReport({
    orgName: membership.organizationName,
    title: "Snow removal service record",
    subtitle: `${c.name}, ${formatAddress(c)}. Visits from ${fmtLongDate(start, tz)} through ${fmtLongDate(new Date(end.getTime() - 1), tz)}.`,
    tz,
    visits,
    showAddress: false,
    photosPerVisit: 3,
  });
  return pdfResponse(pdf, `plowproof-${c.street}-${from}-to-${to}.pdf`);
}
