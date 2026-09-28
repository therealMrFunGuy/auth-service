"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { dropFromQueue, flushQueue, listQueue, QUEUE_EVENT, type QueuedVisit } from "@/lib/offline-queue";

/** Shows visits still on the phone and keeps trying to upload them. */
export function OfflineSync() {
  const router = useRouter();
  const [items, setItems] = useState<QueuedVisit[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setItems(await listQueue()), []);

  const flush = useCallback(async () => {
    setBusy(true);
    const before = (await listQueue()).length;
    await flushQueue();
    const after = await listQueue();
    setItems(after);
    setBusy(false);
    if (after.length < before) router.refresh();
  }, [router]);

  useEffect(() => {
    refresh();
    flush();
    const onQueue = () => refresh();
    window.addEventListener(QUEUE_EVENT, onQueue);
    window.addEventListener("online", flush);
    const timer = setInterval(() => navigator.onLine && flush(), 30_000);
    return () => {
      window.removeEventListener(QUEUE_EVENT, onQueue);
      window.removeEventListener("online", flush);
      clearInterval(timer);
    };
  }, [refresh, flush]);

  const waiting = items.filter((i) => !i.rejected);
  const rejected = items.filter((i) => i.rejected);
  if (items.length === 0) return null;

  return (
    <div className="mt-4 space-y-2" aria-live="polite">
      {waiting.length > 0 && (
        <div className="flex items-center gap-3 rounded border border-beacon bg-night-2 p-3">
          <p className="flex-1 text-[15px]">
            {waiting.length} {waiting.length === 1 ? "visit is" : "visits are"} saved on this phone and will upload when you
            have signal.
          </p>
          <button type="button" className="btn min-h-10 shrink-0 border-night-line px-3 text-sm text-salt" onClick={flush} disabled={busy}>
            {busy ? "Uploading…" : "Upload now"}
          </button>
        </div>
      )}
      {rejected.map((r) => (
        <div key={r.clientId} className="rounded border border-brake bg-night-2 p-3 text-[15px]">
          <p>
            <strong>{r.label}</strong> couldn&apos;t be uploaded: {r.rejected}
          </p>
          <button type="button" className="mt-1 text-sm font-semibold underline" onClick={() => dropFromQueue(r.clientId)}>
            Discard this visit
          </button>
        </div>
      ))}
    </div>
  );
}
