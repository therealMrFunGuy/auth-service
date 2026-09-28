import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { serviceEvent, storm } from "@/db/schema";
import { getTimezone } from "@/lib/company";
import { loadReportVisits, pdfResponse, renderReport } from "@/lib/report";
import { getMembership, isDispatcher } from "@/lib/session";
import { fmtDateTime, ymdIn } from "@/lib/time";

export const maxDuration = 60;

/** Every visit in one storm as a PDF, for the office's records and invoicing. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const membership = await getMembership();
  if (!membership || !isDispatcher(membership.role)) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const orgId = membership.organizationId;
  const [s] = await db.select().from(storm).where(and(eq(storm.id, id), eq(storm.organizationId, orgId)));
  if (!s) return new Response("Not found", { status: 404 });

  const tz = await getTimezone(orgId);
  const visits = await loadReportVisits(and(eq(serviceEvent.organizationId, orgId), eq(serviceEvent.stormId, s.id)));
  const snow = s.snowfallInches != null ? ` ${s.snowfallInches}" of snow.` : "";
  const pdf = await renderReport({
    orgName: membership.organizationName,
    title: `${s.name} report`,
    subtitle: `${fmtDateTime(s.startedAt, tz)} ${s.endedAt ? `to ${fmtDateTime(s.endedAt, tz)}` : "(still open)"}.${snow}`,
    tz,
    visits,
    showAddress: true,
    photosPerVisit: 1,
  });
  return pdfResponse(pdf, `plowproof-storm-${ymdIn(s.startedAt, tz)}.pdf`);
}
