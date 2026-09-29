import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fmtDateTime, fmtTime } from "@/lib/time";
import { verifyVisit, type Check } from "@/lib/verify";

export const metadata: Metadata = { title: "Proof of service", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const MARK: Record<string, { sym: string; cls: string; label: string }> = {
  true: { sym: "✓", cls: "bg-thaw text-salt", label: "Passed" },
  false: { sym: "✕", cls: "bg-brake text-salt", label: "Failed" },
  null: { sym: "…", cls: "bg-frost text-asphalt", label: "Not checked" },
};

function CheckRow({ c }: { c: Check }) {
  const m = MARK[String(c.ok)];
  return (
    <li className="flex gap-3 py-3">
      <span aria-label={m.label} className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${m.cls}`}>
        {m.sym}
      </span>
      <div>
        <div className="font-semibold">{c.title}</div>
        <div className="text-slush">{c.detail}</div>
      </div>
    </li>
  );
}

export default async function ProofPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await verifyVisit(token);
  if (!v) notFound();
  const { ev, orgName, tz, checks } = v;

  const mins = Math.round((ev.completedAt.getTime() - ev.startedAt.getTime()) / 60_000);
  const failed = checks.some((c) => c.ok === false);
  const allGood = checks.every((c) => c.ok === true);
  const driverFirst = ev.driverName.includes("@") ? "Crew member" : ev.driverName.split(" ")[0];

  return (
    <div className="min-h-dvh">
      <div className="hazard" />
      <main className="mx-auto max-w-2xl px-5 pt-8 pb-20">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-lg font-semibold">{orgName}</span>
          <span className="shrink-0 text-sm text-slush">Proof by <span className="sign font-bold text-asphalt">PlowProof</span></span>
        </div>

        <h1 className="sign mt-8 text-4xl leading-tight font-bold">Snow removal completed</h1>
        <p className="mt-2 text-lg">{ev.addressSnapshot}</p>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-frost py-5 sm:grid-cols-3">
          <div><dt className="text-sm text-slush">Finished</dt><dd className="font-semibold">{fmtDateTime(ev.completedAt, tz)}</dd></div>
          <div><dt className="text-sm text-slush">Arrived</dt><dd className="font-semibold">{fmtTime(ev.startedAt, tz)} ({mins < 1 ? "under a minute" : `${mins} min`} on site)</dd></div>
          <div><dt className="text-sm text-slush">Crew</dt><dd className="font-semibold">{driverFirst}</dd></div>
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-sm text-slush">Location</dt>
            <dd className="font-semibold">
              {ev.distanceM != null
                ? `Driver's phone was ${ev.distanceM} m from the property${ev.accuracyM != null ? ` (GPS accurate to ${Math.round(ev.accuracyM)} m)` : ""}`
                : ev.lat != null
                  ? `Phone location recorded (${ev.lat.toFixed(5)}, ${ev.lng!.toFixed(5)})`
                  : "No location was available from the driver's phone"}
            </dd>
          </div>
        </dl>

        {ev.photos.length > 0 && (
          <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ev.photos.map((p, i) => (
              <li key={p.sha256}>
                <a href={`/api/photos/${ev.id}/${i}?t=${token}`} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/photos/${ev.id}/${i}?t=${token}`} alt={`Site photo ${i + 1}`} className="aspect-[4/3] w-full rounded object-cover" />
                </a>
              </li>
            ))}
          </ul>
        )}

        <section className={`mt-10 rounded border-2 p-5 ${failed ? "border-brake" : allGood ? "border-thaw" : "border-frost"} bg-salt`}>
          <h2 className="sign text-2xl font-bold">
            {failed ? "This record failed verification" : allGood ? "Verified: this record hasn't been changed" : "Some checks couldn't run"}
          </h2>
          <ul className="mt-2 divide-y divide-frost">{checks.map((c) => <CheckRow key={c.title} c={c} />)}</ul>
        </section>

        <details className="mt-6 text-sm">
          <summary className="cursor-pointer font-semibold">Technical details for independent verification</summary>
          <div className="mt-3 space-y-3 break-all text-slush">
            <p>
              Record fingerprint (SHA-256 of the fields above in a fixed order, prefixed <code>plowproof:v1</code>):
              <br /><code className="text-asphalt">{ev.recordHash}</code>
            </p>
            {ev.photos.map((p, i) => (
              <p key={p.sha256}>Photo {i + 1} SHA-256: <code className="text-asphalt">{p.sha256}</code></p>
            ))}
          </div>
        </details>
      </main>
    </div>
  );
}
