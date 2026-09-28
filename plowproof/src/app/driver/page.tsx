import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customer, serviceEvent } from "@/db/schema";
import { directionsUrl } from "@/lib/address";
import { isDispatcher, requireMembership } from "@/lib/session";
import { openStorm } from "@/lib/storms";
import { fmtTime } from "@/lib/time";
import { OfflineSync } from "@/components/OfflineSync";
import { SignOutButton } from "@/components/SignOutButton";

export const metadata: Metadata = { title: "Route" };

const GROUPS = [
  { priority: 1, title: "First out" },
  { priority: 2, title: "Standard" },
  { priority: 3, title: "Last" },
];

export default async function DriverPage() {
  const { session, membership } = await requireMembership();
  const orgId = membership.organizationId;
  const [rows, current] = await Promise.all([
    db.select().from(customer).where(eq(customer.organizationId, orgId)).orderBy(asc(customer.priority), asc(customer.city), asc(customer.street)),
    openStorm(orgId),
  ]);

  const doneAt = new Map<string, Date>();
  if (current) {
    const visits = await db
      .select({ customerId: serviceEvent.customerId, completedAt: serviceEvent.completedAt })
      .from(serviceEvent)
      .where(and(eq(serviceEvent.organizationId, orgId), eq(serviceEvent.stormId, current.id)));
    for (const v of visits) {
      if (v.customerId && (!doneAt.has(v.customerId) || doneAt.get(v.customerId)! < v.completedAt)) doneAt.set(v.customerId, v.completedAt);
    }
  }

  const firstName = (session.user.name || "").split(" ")[0];
  const remaining = rows.length - doneAt.size;

  return (
    <div className="min-h-dvh bg-night text-salt">
      <div className="hazard" />
      <header className="sticky top-0 z-10 border-b border-night-line bg-night/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="sign truncate text-xl font-bold">{membership.organizationName}</div>
            <div className="truncate text-sm text-frost/80">
              {current ? `${current.name}: ${remaining} of ${rows.length} left` : `${firstName ? `${firstName}, ` : ""}${rows.length} stops`}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {isDispatcher(membership.role) && (
              <Link href="/dashboard" className="btn min-h-10 border-night-line px-3 text-sm text-salt">Office</Link>
            )}
            <SignOutButton className="btn min-h-10 border-night-line px-3 text-sm text-salt" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pb-16">
        <OfflineSync />
        {!current && rows.length > 0 && (
          <p className="mt-4 text-frost">No storm is open. Your first check-in starts one.</p>
        )}
        {rows.length === 0 && (
          <p className="mt-10 text-lg text-frost">No stops yet. Once the office imports customers, your route shows up here.</p>
        )}
        {GROUPS.map((g) => {
          const stops = rows.filter((r) => r.priority === g.priority);
          if (stops.length === 0) return null;
          return (
            <section key={g.priority} className="mt-6">
              <h2 className="sign mb-2 text-lg font-semibold text-frost">{g.title} ({stops.length})</h2>
              <ul className="space-y-2">
                {stops.map((s) => {
                  const done = doneAt.get(s.id);
                  return (
                    <li key={s.id} className={`flex items-stretch rounded border bg-night-2 ${done ? "border-night-line opacity-60" : "border-night-line"}`}>
                      <Link href={`/driver/stop/${s.id}`} className="min-w-0 flex-1 p-4 active:bg-night-line">
                        <div className="sign text-2xl leading-tight font-bold">
                          {s.street}{s.unit ? ` ${s.unit}` : ""}
                        </div>
                        <div className="text-frost">{s.name}, {s.city}</div>
                        {done ? (
                          <p className="mt-2 font-semibold text-salt">Done at {fmtTime(done)}</p>
                        ) : (
                          s.notes && <p className="mt-2 text-[15px] leading-snug text-beacon">{s.notes}</p>
                        )}
                        {!done && (
                          <div className="mt-2 flex gap-4 text-sm text-frost/80">
                            <span>{s.triggerInches}&Prime; trigger</span>
                            {s.serviceType === "commercial" && <span>Commercial</span>}
                          </div>
                        )}
                      </Link>
                      <a
                        href={directionsUrl(s)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Directions to ${s.street}`}
                        className="m-3 ml-0 flex w-16 shrink-0 items-center justify-center self-start rounded bg-beacon py-3 font-bold text-asphalt"
                      >
                        Go
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
