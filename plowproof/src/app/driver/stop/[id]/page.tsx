import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customer, serviceEvent } from "@/db/schema";
import { directionsUrl } from "@/lib/address";
import { requireMembership } from "@/lib/session";
import { openStorm } from "@/lib/storms";
import { fmtTime } from "@/lib/time";
import { OfflineSync } from "@/components/OfflineSync";
import { CheckIn } from "./CheckIn";

export const metadata: Metadata = { title: "Stop" };

export default async function StopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireMembership();
  const [c] = await db
    .select()
    .from(customer)
    .where(and(eq(customer.id, id), eq(customer.organizationId, membership.organizationId)));
  if (!c) notFound();

  const current = await openStorm(membership.organizationId);
  const visits = current
    ? await db
        .select({ completedAt: serviceEvent.completedAt, driverName: serviceEvent.driverName, proofToken: serviceEvent.proofToken })
        .from(serviceEvent)
        .where(and(eq(serviceEvent.customerId, c.id), eq(serviceEvent.stormId, current.id)))
        .orderBy(desc(serviceEvent.completedAt))
    : [];

  return (
    <div className="min-h-dvh bg-night text-salt">
      <div className="hazard" />
      <main className="mx-auto max-w-xl px-4 pt-4 pb-16">
        <Link href="/driver" className="inline-flex min-h-11 items-center font-semibold text-frost">
          Back to route
        </Link>
        <OfflineSync />

        <h1 className="sign mt-4 text-4xl leading-tight font-bold">
          {c.street}{c.unit ? ` ${c.unit}` : ""}
        </h1>
        <p className="text-lg text-frost">{c.name}, {c.city}</p>
        {c.notes && <p className="mt-3 text-lg leading-snug text-beacon">{c.notes}</p>}
        <a href={directionsUrl(c)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block font-semibold underline">
          Directions
        </a>

        {visits.length > 0 && (
          <div className="mt-5 rounded border border-night-line bg-night-2 p-3">
            {visits.map((v) => (
              <p key={v.proofToken}>
                Done at {fmtTime(v.completedAt)} by {v.driverName}.{" "}
                <Link href={`/p/${v.proofToken}`} className="text-frost underline">Proof</Link>
              </p>
            ))}
            <p className="mt-1 text-sm text-frost">Back for a second pass? Log it below.</p>
          </div>
        )}

        <div className="mt-8">
          <CheckIn customerId={c.id} label={c.street} />
        </div>
      </main>
    </div>
  );
}
