import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { serviceEvent, storm } from "@/db/schema";
import { requireDispatcher } from "@/lib/session";
import { fmtDateTime } from "@/lib/time";
import { startStormAction } from "./actions";

export const metadata: Metadata = { title: "Storms" };

export default async function StormsPage() {
  const { membership } = await requireDispatcher();
  const rows = await db
    .select({
      id: storm.id,
      name: storm.name,
      startedAt: storm.startedAt,
      endedAt: storm.endedAt,
      snowfall: storm.snowfallInches,
      visits: sql<number>`count(${serviceEvent.id})::int`,
      unanchored: sql<number>`count(${serviceEvent.id}) filter (where ${serviceEvent.anchorId} is null)::int`,
    })
    .from(storm)
    .leftJoin(serviceEvent, eq(serviceEvent.stormId, storm.id))
    .where(eq(storm.organizationId, membership.organizationId))
    .groupBy(storm.id)
    .orderBy(desc(storm.startedAt));

  const open = rows.find((r) => !r.endedAt);

  return (
    <section className="max-w-4xl">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="sign text-4xl font-bold">Storms</h1>
          <p className="mt-1 max-w-xl text-slush">
            Every visit your drivers log is grouped by storm. When a storm ends, its records are sealed on Solana so
            nobody can change them later.
          </p>
        </div>
        {!open && (
          <form action={startStormAction} className="ml-auto flex gap-2">
            <input name="name" aria-label="Storm name" className="input w-52" placeholder="Name (optional)" />
            <button type="submit" className="btn btn-primary">Start storm</button>
          </form>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-slush">
          No storms yet. Start one when the snow hits, or let the first driver check-in start it automatically.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-frost rounded border border-frost bg-salt">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/dashboard/storms/${r.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-4 hover:bg-snow">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {r.name}
                    {!r.endedAt && <span className="ml-2 rounded bg-beacon px-2 py-0.5 text-sm text-asphalt">In progress</span>}
                  </div>
                  <div className="text-sm text-slush">
                    {fmtDateTime(r.startedAt)}
                    {r.endedAt ? ` to ${fmtDateTime(r.endedAt)}` : ""}
                    {r.snowfall != null ? `, ${r.snowfall}″ of snow` : ""}
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="font-semibold">{r.visits} visits</div>
                  <div className={`text-sm ${r.unanchored > 0 && r.endedAt ? "text-brake" : "text-slush"}`}>
                    {r.visits === 0 ? "" : r.unanchored === 0 ? "Sealed on Solana" : `${r.unanchored} not sealed yet`}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
