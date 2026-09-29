import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customer, serviceEvent, storm } from "@/db/schema";
import { formatAddress } from "@/lib/address";
import { getTimezone } from "@/lib/company";
import { FAR_FROM_PROPERTY_M } from "@/lib/geo";
import { requireDispatcher } from "@/lib/session";
import { fmtDateTime, seasonStartYmd, ymdIn } from "@/lib/time";
import { PriorityMark } from "@/components/PriorityMark";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireDispatcher();
  const orgId = membership.organizationId;
  const [c] = await db.select().from(customer).where(and(eq(customer.id, id), eq(customer.organizationId, orgId)));
  if (!c) notFound();

  const [visits, tz] = await Promise.all([
    db
      .select({ v: serviceEvent, stormName: storm.name, stormId: storm.id })
      .from(serviceEvent)
      .innerJoin(storm, eq(storm.id, serviceEvent.stormId))
      .where(and(eq(serviceEvent.organizationId, orgId), eq(serviceEvent.customerId, c.id)))
      .orderBy(desc(serviceEvent.completedAt))
      .limit(200),
    getTimezone(orgId),
  ]);
  const now = new Date();

  return (
    <section className="space-y-8">
      <div>
        <Link href="/dashboard" className="text-sm font-semibold text-slush hover:underline">All customers</Link>
        <h1 className="sign mt-1 text-4xl font-bold">{c.name}</h1>
        <p className="mt-1 text-lg">{formatAddress(c)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-slush">
          <PriorityMark priority={c.priority} />
          <span>{c.serviceType === "commercial" ? "Commercial" : "Residential"}, {c.triggerInches}&Prime; trigger</span>
          {c.phone && <span>{c.phone}</span>}
          {c.email && <span>{c.email}</span>}
        </div>
        {c.notes && <p className="mt-2 max-w-2xl">{c.notes}</p>}
      </div>

      <form action={`/api/reports/customer/${c.id}`} method="get" target="_blank" className="flex flex-wrap items-end gap-3 rounded border border-frost bg-salt p-4">
        <div>
          <label htmlFor="from" className="label">From</label>
          <input id="from" name="from" type="date" className="input" defaultValue={seasonStartYmd(now, tz)} required />
        </div>
        <div>
          <label htmlFor="to" className="label">Through</label>
          <input id="to" name="to" type="date" className="input" defaultValue={ymdIn(now, tz)} required />
        </div>
        <button type="submit" className="btn btn-primary">Download PDF report</button>
        <p className="hint basis-full">
          Every visit in the range with times, GPS check, photos, and proof links. Use it with invoices or send it to an insurer.
        </p>
      </form>

      <div>
        <h2 className="sign text-2xl font-bold">Visits ({visits.length}{visits.length === 200 ? "+" : ""})</h2>
        {visits.length === 0 ? (
          <p className="mt-2 text-slush">No visits logged at this property yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-frost rounded border border-frost bg-salt">
            {visits.map(({ v, stormName, stormId }) => {
              const far = v.distanceM != null && v.distanceM > FAR_FROM_PROPERTY_M;
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{fmtDateTime(v.completedAt, tz)} by {v.driverName}</div>
                    <div className="text-sm text-slush">
                      <Link href={`/dashboard/storms/${stormId}`} className="underline">{stormName}</Link>
                      {", "}
                      {v.photos.length} {v.photos.length === 1 ? "photo" : "photos"}
                      {v.distanceM != null && <span className={far ? "font-semibold text-brake" : ""}>, {v.distanceM} m away</span>}
                    </div>
                  </div>
                  <Link href={`/p/${v.proofToken}`} className="text-sm font-semibold underline">Proof page</Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
