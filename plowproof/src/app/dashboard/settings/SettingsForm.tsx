"use client";
import { useState, useTransition } from "react";
import { TIMEZONE_CHOICES } from "@/lib/time";
import { saveSettings, type SaveResult } from "./actions";

const YARD_MSG = {
  matched: "Saved. The yard is on the map, so routes start from there.",
  no_match: "Saved, but the yard address wasn't found on the map. Check the spelling; routes start from the first stop for now.",
  lookup_failed: "Saved, but the map lookup didn't respond. Save again in a minute to place the yard.",
  none: "Saved.",
};

export function SettingsForm(props: { timezone: string; yardAddress: string; yardMapped: boolean }) {
  const [timezone, setTimezone] = useState(props.timezone);
  const [yardAddress, setYardAddress] = useState(props.yardAddress);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SaveResult | null>(null);
  const known = TIMEZONE_CHOICES.some((z) => z.value === props.timezone);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await saveSettings({ timezone, yardAddress })));
      }}
    >
      <div>
        <label htmlFor="tz" className="label">Time zone</label>
        <select id="tz" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {!known && <option value={props.timezone}>{props.timezone}</option>}
          {TIMEZONE_CHOICES.map((z) => (
            <option key={z.value} value={z.value}>{z.label}</option>
          ))}
        </select>
        <p className="hint mt-1.5">Used for visit times on the route, the storm pages, proof pages, emails, and reports.</p>
      </div>
      <div>
        <label htmlFor="yard" className="label">Yard address</label>
        <input
          id="yard"
          className="input"
          placeholder="4100 Lyndale Ave S, Minneapolis, MN 55409"
          autoComplete="street-address"
          value={yardAddress}
          onChange={(e) => setYardAddress(e.target.value)}
        />
        <p className="hint mt-1.5">
          Where trucks head out from. Each driver&apos;s route is ordered to start near here.
          {props.yardAddress && !props.yardMapped && " The current address isn't on the map yet."}
        </p>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
      {result && (
        <p role="status" className={result.ok && result.yard !== "no_match" && result.yard !== "lookup_failed" ? "text-thaw" : "text-brake"}>
          {result.ok ? YARD_MSG[result.yard] : result.error}
        </p>
      )}
    </form>
  );
}
