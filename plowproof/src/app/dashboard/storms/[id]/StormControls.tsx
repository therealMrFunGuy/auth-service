"use client";
import { useState, useTransition } from "react";
import type { Channel, NoticeOutcome } from "@/lib/notify";
import type { AnchorOutcome } from "@/lib/storms";
import { anchorNowAction, endStormAction, retryAnchorAction, sendProofAction } from "../actions";

function describe(o: AnchorOutcome) {
  if (o.status === "nothing") return "Nothing new to seal.";
  if (o.status === "confirmed") return `Sealed ${o.count} ${o.count === 1 ? "visit" : "visits"} on Solana.`;
  return `Couldn't reach Solana: ${o.error}. The visits are saved; try sealing again.`;
}

export function StormControls({ stormId, isOpen, unsealed }: { stormId: string; isOpen: boolean; unsealed: number }) {
  const [pending, start] = useTransition();
  const [ending, setEnding] = useState(false);
  const [snow, setSnow] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (fn: () => Promise<AnchorOutcome>) =>
    start(async () => {
      const o = await fn();
      setMsg({ ok: o.status !== "failed", text: describe(o) });
      setEnding(false);
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {isOpen && !ending && (
          <button type="button" className="btn btn-primary" onClick={() => setEnding(true)} disabled={pending}>End storm</button>
        )}
        {isOpen && ending && (
          <form
            className="flex flex-wrap items-end gap-3 rounded border border-frost bg-salt p-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => endStormAction(stormId, snow.trim() === "" ? null : Number(snow)));
            }}
          >
            <div>
              <label htmlFor="snow" className="label">Snowfall (inches, optional)</label>
              <input id="snow" type="number" step="0.5" min="0" className="input w-32" value={snow} onChange={(e) => setSnow(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Sealing…" : unsealed > 0 ? `End and seal ${unsealed} visits` : "End storm"}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setEnding(false)} disabled={pending}>Keep open</button>
          </form>
        )}
        {unsealed > 0 && !ending && (
          <button type="button" className="btn btn-quiet" onClick={() => run(() => anchorNowAction(stormId))} disabled={pending}>
            {pending ? "Sealing…" : `Seal ${unsealed} ${unsealed === 1 ? "visit" : "visits"} now`}
          </button>
        )}
      </div>
      {msg && <p role="status" className={msg.ok ? "text-thaw" : "text-brake"}>{msg.text}</p>}
    </div>
  );
}

export function AnchorRetry({ anchorId }: { anchorId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-sm">{msg}</span>}
      <button
        type="button"
        className="btn btn-quiet min-h-9 px-3 text-sm"
        disabled={pending}
        onClick={() => start(async () => setMsg(describe(await retryAnchorAction(anchorId))))}
      >
        {pending ? "Sealing…" : "Try again"}
      </button>
    </div>
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
