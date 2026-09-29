"use client";
import { useState, useTransition } from "react";
import type { Channel, NoticeOutcome } from "@/lib/notify";
import { endStormAction, sendProofAction } from "../actions";

export function StormControls({ stormId, isOpen }: { stormId: string; isOpen: boolean }) {
  const [pending, start] = useTransition();
  const [ending, setEnding] = useState(false);
  const [snow, setSnow] = useState("");

  if (!isOpen) return null;
  if (!ending)
    return (
      <button type="button" className="btn btn-primary" onClick={() => setEnding(true)}>End storm</button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded border border-frost bg-salt p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await endStormAction(stormId, snow.trim() === "" ? null : Number(snow));
          setEnding(false);
        });
      }}
    >
      <div>
        <label htmlFor="snow" className="label">Snowfall (inches, optional)</label>
        <input id="snow" type="number" step="0.5" min="0" className="input w-32" value={snow} onChange={(e) => setSnow(e.target.value)} />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Ending…" : "End storm"}</button>
      <button type="button" className="btn btn-quiet" onClick={() => setEnding(false)} disabled={pending}>Keep open</button>
    </form>
  );
}

const SKIP_REASON: Record<string, string> = {
  no_email: "No email on file",
  no_phone: "No phone on file",
  bad_phone: "The phone number isn't one we can text",
};

function describeNotice(o: NoticeOutcome) {
  if (o.status === "sent") return `Sent to ${o.to}`;
  if (o.status === "failed") return `Not sent: ${o.error}`;
  return SKIP_REASON[o.reason] ?? "Not sent";
}

export function SendProofButton({ eventId, channel, label }: { eventId: string; channel: Channel; label: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="text-sm font-semibold text-slush underline disabled:opacity-60"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const o = await sendProofAction(eventId, channel);
            setMsg({ ok: o.status === "sent", text: describeNotice(o) });
          })
        }
      >
        {pending ? "Sending…" : label}
      </button>
      {msg && <span role="status" className={`text-sm ${msg.ok ? "text-thaw" : "text-brake"}`}>{msg.text}</span>}
    </div>
  );
}
