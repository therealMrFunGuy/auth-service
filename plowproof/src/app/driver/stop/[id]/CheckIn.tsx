"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { clock, compressPhoto, getFix } from "@/lib/device";
import {
  clearDraft, dropFromQueue, enqueue, getDraft, saveDraft, uploadVisit, uuid, type Draft, type QueuedVisit,
} from "@/lib/offline-queue";

type Phase =
  | { kind: "loading" }
  | { kind: "idle" }
  | { kind: "working"; draft: Draft }
  | { kind: "finishing"; draft: Draft }
  | { kind: "logged"; at: string; proofToken: string | null; offline: boolean };

const MAX_PHOTOS = 6;

export function CheckIn({ customerId, label }: { customerId: string; label: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);

  // Resume a visit in progress (screen locked, app backgrounded, page refreshed).
  useEffect(() => {
    getDraft(customerId).then((d) => setPhase(d ? { kind: "working", draft: d } : { kind: "idle" }));
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [customerId]);

  const draft = phase.kind === "working" || phase.kind === "finishing" ? phase.draft : null;
  useEffect(() => {
    const urls = (draft?.photos ?? []).map((b) => URL.createObjectURL(b));
    setThumbs(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [draft?.photos]);

  async function update(d: Draft) {
    await saveDraft(d);
    setPhase({ kind: "working", draft: d });
  }

  async function start() {
    setError(null);
    await update({ clientId: uuid(), customerId, startedAt: new Date().toISOString(), photos: [], notes: "" });
    getFix(5_000); // warm up GPS so the finish fix is quick and accurate
  }

  async function addPhotos(files: FileList | null) {
    if (!draft || !files?.length) return;
    const room = MAX_PHOTOS - draft.photos.length;
    const shrunk = await Promise.all([...files].slice(0, room).map((f) => compressPhoto(f)));
    await update({ ...draft, photos: [...draft.photos, ...shrunk] });
  }

  async function finish() {
    if (!draft) return;
    setError(null);
    setPhase({ kind: "finishing", draft });
    const completedAt = new Date().toISOString();
    const fix = await getFix(10_000);
    const visit: QueuedVisit = {
      clientId: draft.clientId,
      customerId,
      label,
      startedAt: draft.startedAt,
      completedAt,
      fix,
      notes: draft.notes,
      photos: draft.photos,
      attempts: 0,
    };
    // Queue first, then clear the draft: the visit is never only in memory.
    await enqueue(visit);
    await clearDraft(customerId);

    const r = await uploadVisit(visit);
    if (r.ok) {
      await dropFromQueue(visit.clientId);
      setPhase({ kind: "logged", at: completedAt, proofToken: r.proofToken, offline: false });
    } else if (r.retry) {
      setPhase({ kind: "logged", at: completedAt, proofToken: null, offline: true });
    } else {
      await dropFromQueue(visit.clientId);
      await saveDraft(draft);
      setError(r.message);
      setPhase({ kind: "working", draft });
    }
  }

  async function cancel() {
    if (!confirm("Throw away this visit? The start time and photos will be deleted.")) return;
    await clearDraft(customerId);
    setPhase({ kind: "idle" });
  }

  if (phase.kind === "loading") return <div className="h-40" />;

  if (phase.kind === "logged") {
    return (
      <div className="rounded border border-night-line bg-night-2 p-5" role="status">
        <p className="sign text-3xl font-bold">Logged at {clock(phase.at)}</p>
        <p className="mt-2 text-frost">
          {phase.offline
            ? "Saved on this phone. It uploads by itself when you have signal. Keep plowing."
            : "Time, location, and photos are locked in."}
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <Link href="/driver" className="btn bg-beacon text-lg text-asphalt">Next stop</Link>
          {phase.proofToken && (
            <Link href={`/p/${phase.proofToken}`} className="text-center text-sm font-semibold text-frost underline">
              View proof page
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (phase.kind === "idle") {
    return (
      <div>
        <button type="button" onClick={start} className="btn h-20 w-full bg-beacon text-2xl text-asphalt">
          Start service
        </button>
        <p className="mt-3 text-center text-frost">Tap when you pull in. Tap Done when you leave.</p>
      </div>
    );
  }

  const d = phase.draft;
  const mins = Math.max(0, Math.round((now - new Date(d.startedAt).getTime()) / 60_000));
  const finishing = phase.kind === "finishing";

  return (
    <div className="space-y-5">
      <p className="text-lg">
        Started {clock(d.startedAt)} <span className="text-frost">({mins} min)</span>
      </p>

      <div>
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          onChange={(e) => {
            addPhotos(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="btn h-16 w-full border-night-line text-lg text-salt"
          onClick={() => camera.current?.click()}
          disabled={d.photos.length >= MAX_PHOTOS || finishing}
        >
          {d.photos.length === 0 ? "Take photo" : d.photos.length >= MAX_PHOTOS ? "Photo limit reached" : "Take another photo"}
        </button>
        {thumbs.length > 0 && (
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {thumbs.map((src, i) => (
              <li key={src} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded object-cover" />
                <button
                  type="button"
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute top-1 right-1 rounded bg-night/85 px-2 py-0.5 text-sm"
                  disabled={finishing}
                  onClick={() => update({ ...d, photos: d.photos.filter((_, j) => j !== i) })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label htmlFor="notes" className="mb-1.5 block font-semibold">Note for the office (optional)</label>
        <textarea
          id="notes"
          rows={2}
          className="w-full rounded border border-night-line bg-night-2 p-3 text-salt"
          placeholder="Car parked in drive, did the walk only"
          value={d.notes}
          disabled={finishing}
          onChange={(e) => update({ ...d, notes: e.target.value })}
        />
      </div>

      {error && <p role="alert" className="text-beacon">{error}</p>}

      <button type="button" onClick={finish} disabled={finishing} className="btn h-20 w-full bg-beacon text-2xl text-asphalt">
        {finishing ? "Getting location…" : "Done"}
      </button>
      <button type="button" onClick={cancel} disabled={finishing} className="block w-full text-center text-sm text-frost underline">
        Cancel this visit
      </button>
    </div>
  );
}
