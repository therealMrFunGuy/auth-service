import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { anchor, customer, serviceEvent, storm } from "@/db/schema";
import { FAR_FROM_PROPERTY_M } from "@/lib/geo";
import { requireDispatcher } from "@/lib/session";
import { explorerUrl } from "@/lib/solana";
import { fmtDateTime, fmtTime } from "@/lib/time";
import { getTimezone } from "@/lib/company";
import { AnchorRetry, SendProofButton, StormControls } from "./StormControls";

export const metadata: Metadata = { title: "Storm" };

function location(distanceM: number | null, accuracyM: number | null) {
  if (distanceM == null) return accuracyM == null ? { text: "No GPS", warn: true } : { text: "Property not on map", warn: false };
  if (distanceM > FAR_FROM_PROPERTY_M) return { text: `${distanceM} m away`, warn: true };
  return { text: `${distanceM} m away`, warn: false };
}

function NoticeStatus({
  eventId,
  channel,
  sentAt,
  error,
  hasContact,
  enabled,
  tz,
}: {
  eventId: string;
  channel: "email" | "text";
  sentAt: Date | null;
  error: string | null;
  hasContact: boolean;
  enabled: boolean;
  tz: string;
}) {
  const noun = channel === "email" ? "email" : "phone";
  if (!hasContact) return <div className="text-slush">No customer {noun}</div>;
  const verb = channel === "email" ? "Emailed" : "Texted";
  return (
    <div className="space-y-0.5">
      {sentAt ? (
        <div className="text-slush">{verb} {fmtTime(sentAt, tz)}</div>
      ) : error ? (
        <div className="text-brake" title={error}>{channel === "email" ? "Email" : "Text"} failed</div>
      ) : !enabled ? (
        <div className="text-slush">Proof {channel === "email" ? "emails" : "texts"} off</div>
      ) : null}
      <SendProofButton
        eventId={eventId}
        channel={channel}
        label={sentAt ? (channel === "email" ? "Email again" : "Text again") : channel === "email" ? "Email customer" : "Text customer"}
      />
    </div>
  );
}

export default async function StormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireDispatcher();
  const orgId = membership.organizationId;
  const [s] = await db.select().from(storm).where(and(eq(storm.id, id), eq(storm.organizationId, orgId)));
  if (!s) notFound();

  const [visits, anchors, customers, tz] = await Promise.all([
    db.select().from(serviceEvent).where(eq(serviceEvent.stormId, s.id)).orderBy(desc(serviceEvent.completedAt)),
    db.select().from(anchor).where(eq(anchor.stormId, s.id)).orderBy(asc(anchor.createdAt)),
    db.select({ id: customer.id, name: customer.name, street: customer.street, priority: customer.priority, email: customer.email, emailProof: customer.emailProof, phone: customer.phone, textProof: customer.textProof }).from(customer).where(eq(customer.organizationId, orgId)).orderBy(asc(customer.priority), asc(customer.street)),
    getTimezone(orgId),
  ]);

  const served = new Set(visits.map((v) => v.customerId));
  const byId = new Map(customers.map((c) => [c.id, c]));
  const notYet = customers.filter((c) => !served.has(c.id));
  const unsealed = visits.filter((v) => !v.anchorId).length;
  const flagged = visits.filter((v) => location(v.distanceM, v.accuracyM).warn).length;

  return (
    <section className="space-y-10">
      <div>
        <Link href="/dashboard/storms" className="text-sm font-semibold text-slush hover:underline">All storms</Link>
        <h1 className="sign mt-1 text-4xl font-bold">{s.name}</h1>
        <p className="mt-1 text-slush">
          {fmtDateTime(s.startedAt, tz)}
          {s.endedAt ? ` to ${fmtDateTime(s.endedAt, tz)}` : ", still going"}
          {s.snowfallInches != null ? `, ${s.snowfallInches}″ of snow` : ""}
        </p>
        <p className="mt-3 text-lg">
          <strong>{served.size}</strong> of {customers.length} properties serviced
          {flagged > 0 && <span className="text-brake">, {flagged} {flagged === 1 ? "visit needs" : "visits need"} a location check</span>}
        </p>
        <div className="mt-4">
          <StormControls stormId={s.id} isOpen={!s.endedAt} unsealed={unsealed} />
        </div>
        {visits.length > 0 && (
          <a href={`/api/reports/storm/${s.id}`} target="_blank" rel="noopener" className="mt-3 inline-block font-semibold underline">
            Download storm report (PDF)
          </a>
        )}
      </div>

      {anchors.length > 0 && (
        <div>
          <h2 className="sign text-2xl font-bold">Sealed on Solana</h2>
          <ul className="mt-3 divide-y divide-frost rounded border border-frost bg-salt">
            {anchors.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {a.leaves.length} {a.leaves.length === 1 ? "visit" : "visits"},{" "}
                    {a.status === "confirmed" ? `sealed ${fmtDateTime(a.confirmedAt!, tz)}` : a.status === "failed" ? "not sealed" : "sealing…"}
                  </div>
                  <div className="truncate font-mono text-xs text-slush" title={a.merkleRoot}>Root {a.merkleRoot}</div>
                  {a.status === "failed" && <div className="text-sm text-brake">{a.error}</div>}
                </div>
                {a.txSignature && (
                  <a href={explorerUrl(a.txSignature)} target="_blank" rel="noopener noreferrer" className="btn btn-quiet min-h-9 px-3 text-sm">
                    View transaction
                  </a>
                )}
                {a.status !== "confirmed" && <AnchorRetry anchorId={a.id} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="sign text-2xl font-bold">Visits ({visits.length})</h2>
        {visits.length === 0 ? (
          <p className="mt-2 text-slush">No visits logged yet. Drivers check in from the route screen on their phones.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded border border-frost bg-salt">
            <table className="w-full min-w-[860px] text-left">
              <thead className="border-b border-frost text-sm text-slush">
                <tr>
                  <th className="px-4 py-3 font-semibold">Property</th>
                  <th className="px-4 py-3 font-semibold">Driver</th>
                  <th className="px-4 py-3 font-semibold">Finished</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Photos</th>
                  <th className="px-4 py-3"><span className="sr-only">Proof</span></th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => {
                  const loc = location(v.distanceM, v.accuracyM);
                  const mins = Math.round((v.completedAt.getTime() - v.startedAt.getTime()) / 60_000);
                  return (
                    <tr key={v.id} className="border-b border-frost align-top last:border-0">
                      <td className="max-w-[16rem] px-4 py-3">
                        <div className="font-semibold">{v.addressSnapshot}</div>
                        {v.notes && <div className="mt-1 text-sm">{v.notes}</div>}
                      </td>
                      <td className="px-4 py-3">{v.driverName}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {fmtTime(v.completedAt, tz)}
                        <div className="text-sm text-slush">{mins} min on site</div>
                      </td>
                      <td className={`px-4 py-3 ${loc.warn ? "font-semibold text-brake" : ""}`}>{loc.text}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {v.photos.map((p, i) => (
                            <a key={p.sha256} href={`/api/photos/${v.id}/${i}`} target="_blank" rel="noopener noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`/api/photos/${v.id}/${i}`} alt={`Photo ${i + 1}`} className="size-12 rounded object-cover" />
                            </a>
                          ))}
                          {v.photos.length === 0 && <span className="text-sm text-slush">None</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/p/${v.proofToken}`} className="text-sm font-semibold underline">Proof page</Link>
                        <div className="mt-2 space-y-2 text-sm">
                          <NoticeStatus
                            eventId={v.id}
                            channel="email"
                            sentAt={v.customerEmailedAt}
                            error={v.customerEmailError}
                            hasContact={!!byId.get(v.customerId ?? "")?.email}
                            enabled={!!byId.get(v.customerId ?? "")?.emailProof}
                            tz={tz}
                          />
                          <NoticeStatus
                            eventId={v.id}
                            channel="text"
                            sentAt={v.customerTextedAt}
                            error={v.customerTextError}
                            hasContact={!!byId.get(v.customerId ?? "")?.phone}
                            enabled={!!byId.get(v.customerId ?? "")?.textProof}
                            tz={tz}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {notYet.length > 0 && (
        <div>
          <h2 className="sign text-2xl font-bold">Not serviced yet ({notYet.length})</h2>
          <p className="mt-2 max-w-3xl text-slush">{notYet.map((c) => c.street).join(", ")}</p>
        </div>
      )}
    </section>
  );
}
