"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { ImportRow, ParseResponse, ParsedRow } from "@/lib/import-schema";
import { saveImportedCustomers } from "./actions";

type Row = ParsedRow & { include: boolean; uid: string };
type Step = "input" | "review" | "done";

const ACCEPT = ".csv,.tsv,.txt,.pdf,.jpg,.jpeg,.png,.webp";
const EXAMPLE = `Tom & Linda Berg, 2140 4th St, White Bear Lake — driveway + front walk, dog in yard
Lakeside Dental  4800 Hwy 61 N  WBL 55110  lot + sidewalks, open 7am, plow first
Pete R 651-555-0182 88 Birch Ln Mahtomedi, gate code 4410`;

export function ImportFlow() {
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [defaultCity, setDefaultCity] = useState("");
  const [defaultState, setDefaultState] = useState("MN");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function read(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReading(true);
    const form = new FormData();
    form.set("text", text);
    form.set("defaultCity", defaultCity);
    form.set("defaultState", defaultState);
    files.forEach((f) => form.append("files", f));
    try {
      const res = await fetch("/api/import/parse", { method: "POST", body: form });
      const data = (await res.json()) as ParseResponse;
      if ("error" in data) throw new Error(data.error);
      if (data.rows.length === 0) throw new Error(data.warnings[0] ?? "No customers found. Try pasting the list as text.");
      setRows(data.rows.map((r, i) => ({ ...r, include: r.duplicate === null, uid: `${i}` })));
      setWarnings(data.warnings);
      setRowErrors({});
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The list couldn't be read. Try again.");
    } finally {
      setReading(false);
    }
  }

  const patch = (uid: string, change: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...change } : r)));

  const included = rows.filter((r) => r.include);
  const flagged = rows.filter((r) => r.issues.length > 0 || r.duplicate || rowErrors[r.uid]);
  const visible = onlyFlagged ? flagged : rows;

  async function save() {
    setSaving(true);
    setError(null);
    const payload: ImportRow[] = included.map(({ include: _i, uid: _u, issues: _is, duplicate: _d, ...row }) => ({
      ...row,
      phone: row.phone || null,
      email: row.email || null,
      unit: row.unit || null,
      zip: row.zip || null,
      notes: row.notes || null,
    }));
    const res = await saveImportedCustomers(payload);
    setSaving(false);
    if (!res.ok) {
      const byUid: Record<string, string> = {};
      Object.entries(res.rowErrors ?? {}).forEach(([idx, msg]) => {
        const r = included[Number(idx)];
        if (r) byUid[r.uid] = msg;
      });
      setRowErrors(byUid);
      setOnlyFlagged(Object.keys(byUid).length > 0);
      setError(res.error);
      return;
    }
    setResult({ added: res.added, skipped: res.skipped });
    setStep("done");
  }

  function reset() {
    setStep("input");
    setRows([]);
    setWarnings([]);
    setText("");
    setFiles([]);
    setResult(null);
    setError(null);
  }

  if (step === "done" && result) {
    return (
      <section className="max-w-xl py-6">
        <h1 className="sign text-4xl font-bold">
          {result.added} {result.added === 1 ? "customer" : "customers"} added
        </h1>
        <p className="mt-3 text-slush">
          {result.skipped > 0 && `${result.skipped} were already in your list and were skipped. `}
          Addresses are being placed on the map now; this takes about a minute for a few hundred.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/dashboard" className="btn btn-primary">See customers</Link>
          <Link href="/dashboard/team" className="btn btn-quiet">Invite drivers</Link>
          <button type="button" className="btn btn-quiet" onClick={reset}>Import another list</button>
        </div>
      </section>
    );
  }

  if (step === "review") {
    return (
      <section className="pb-28">
        <h1 className="sign text-4xl font-bold">Check before saving</h1>
        <ReviewSummary rows={rows} flaggedCount={flagged.length} />
        {warnings.length > 0 && (
          <ul className="mt-4 space-y-1 rounded border border-beacon bg-beacon-soft p-4 text-sm">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}

        <label className="mt-6 inline-flex items-center gap-2 font-semibold">
          <input type="checkbox" className="size-4 accent-asphalt" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
          Only show rows that need a look ({flagged.length})
        </label>

        <div className="mt-3 overflow-x-auto rounded border border-frost bg-salt">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b border-frost text-slush">
              <tr>
                <th className="w-10 px-3 py-2"><span className="sr-only">Include</span></th>
                <th className="px-2 py-2 font-semibold">Name</th>
                <th className="px-2 py-2 font-semibold">Street</th>
                <th className="px-2 py-2 font-semibold">Unit</th>
                <th className="px-2 py-2 font-semibold">City</th>
                <th className="px-2 py-2 font-semibold">State</th>
                <th className="px-2 py-2 font-semibold">ZIP</th>
                <th className="px-2 py-2 font-semibold">Phone</th>
                <th className="px-2 py-2 font-semibold">Type</th>
                <th className="px-2 py-2 font-semibold">Order</th>
                <th className="px-2 py-2 font-semibold">Trigger (in)</th>
                <th className="px-2 py-2 font-semibold">Notes</th>
              </tr>
            </thead>
            {visible.map((r) => (
              <ReviewRow key={r.uid} row={r} error={rowErrors[r.uid]} onChange={(c) => patch(r.uid, c)} />
            ))}
          </table>
          {visible.length === 0 && <p className="p-6 text-slush">Nothing needs a look. Every row is ready to save.</p>}
        </div>

        <div className="fixed inset-x-0 bottom-0 border-t border-frost bg-salt">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
            {error && <p role="alert" className="text-sm text-brake">{error}</p>}
            <button type="button" className="btn btn-quiet ml-auto" onClick={reset} disabled={saving}>Start over</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving || included.length === 0}>
              {saving ? "Saving…" : `Save ${included.length} ${included.length === 1 ? "customer" : "customers"}`}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-3xl">
      <h1 className="sign text-4xl font-bold">Import customers</h1>
      <p className="mt-2 text-slush">
        Bring your list in whatever shape it&apos;s in. You&apos;ll check every row before anything is saved.
      </p>

      <form onSubmit={read} className="mt-8 space-y-7">
        <div>
          <label htmlFor="paste" className="label">Paste a list</label>
          <textarea
            id="paste"
            className="input min-h-44 font-sans"
            placeholder={EXAMPLE}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="hint mt-1.5">Texts, emails, spreadsheet rows, one customer per line or not. Anything works.</p>
        </div>

        <div>
          <span className="label">Or add files</span>
          <label
            htmlFor="files"
            className="flex cursor-pointer flex-col items-start gap-1 rounded border-2 border-dashed border-frost bg-salt p-5 hover:border-asphalt"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)].slice(0, 5));
            }}
          >
            <span className="font-semibold">Choose files or drop them here</span>
            <span className="hint">
              CSV, PDF invoices, or photos of a route sheet. Up to 5 files. Excel users: save as CSV first.
            </span>
          </label>
          <input
            ref={fileInput}
            id="files"
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              setFiles((f) => [...f, ...Array.from(e.target.files ?? [])].slice(0, 5));
              e.target.value = "";
            }}
          />
          {files.length > 0 && (
            <ul className="mt-3 divide-y divide-frost rounded border border-frost bg-salt">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-4 py-2">
                  <span className="truncate">{f.name}</span>
                  <span className="hint">{Math.ceil(f.size / 1024)} KB</span>
                  <button type="button" className="btn btn-danger ml-auto" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <fieldset>
          <legend className="label">When a row is missing its city or state, use</legend>
          <div className="flex gap-3">
            <input aria-label="Default city" className="input max-w-64" placeholder="City (optional)" value={defaultCity} onChange={(e) => setDefaultCity(e.target.value)} />
            <input aria-label="Default state" className="input w-20 uppercase" maxLength={2} value={defaultState} onChange={(e) => setDefaultState(e.target.value.toUpperCase())} />
          </div>
        </fieldset>

        {error && <p role="alert" className="text-brake">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={reading || (!text.trim() && files.length === 0)}>
          {reading ? "Reading your list…" : "Read customers"}
        </button>
        {reading && <p className="hint" aria-live="polite">Long lists and photos can take up to a minute.</p>}
      </form>
    </section>
  );
}

function ReviewSummary({ rows, flaggedCount }: { rows: Row[]; flaggedCount: number }) {
  const dupes = rows.filter((r) => r.duplicate === "existing").length;
  const parts = useMemo(() => {
    const p = [`Found ${rows.length} ${rows.length === 1 ? "customer" : "customers"}.`];
    if (flaggedCount) p.push(`${flaggedCount} need a look (highlighted).`);
    if (dupes) p.push(`${dupes} are already in your list and will be skipped.`);
    return p.join(" ");
  }, [rows.length, flaggedCount, dupes]);
  return <p className="mt-2 max-w-3xl text-slush">{parts}</p>;
}

function Cell({ value, onChange, width, label, invalid }: { value: string | null; onChange: (v: string) => void; width: string; label: string; invalid?: boolean }) {
  return (
    <td className="px-1 py-1.5">
      <input aria-label={label} aria-invalid={invalid} className={`input px-2 py-1.5 ${width}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </td>
  );
}

function ReviewRow({ row: r, error, onChange }: { row: Row; error?: string; onChange: (c: Partial<Row>) => void }) {
  const flagged = r.issues.length > 0 || r.duplicate || error;
  return (
    <tbody className={`border-b border-frost last:border-0 ${r.include ? "" : "opacity-55"} ${flagged ? "bg-beacon-soft/60" : ""}`}>
      <tr className="align-top">
        <td className="px-3 py-3">
          <input type="checkbox" aria-label={`Include ${r.name}`} className="size-4 accent-asphalt" checked={r.include} disabled={r.duplicate === "existing"} onChange={(e) => onChange({ include: e.target.checked })} />
        </td>
        <Cell label="Name" value={r.name} width="w-44" invalid={!r.name.trim()} onChange={(v) => onChange({ name: v })} />
        <Cell label="Street" value={r.street} width="w-44" invalid={!r.street.trim()} onChange={(v) => onChange({ street: v })} />
        <Cell label="Unit" value={r.unit} width="w-20" onChange={(v) => onChange({ unit: v })} />
        <Cell label="City" value={r.city} width="w-36" invalid={!r.city.trim()} onChange={(v) => onChange({ city: v })} />
        <Cell label="State" value={r.state} width="w-14 uppercase" invalid={r.state.trim().length !== 2} onChange={(v) => onChange({ state: v.toUpperCase().slice(0, 2) })} />
        <Cell label="ZIP" value={r.zip} width="w-20" onChange={(v) => onChange({ zip: v })} />
        <Cell label="Phone" value={r.phone} width="w-32" onChange={(v) => onChange({ phone: v })} />
        <td className="px-1 py-1.5">
          <select aria-label="Type" className="input w-32 px-2 py-1.5" value={r.serviceType} onChange={(e) => onChange({ serviceType: e.target.value as Row["serviceType"] })}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </select>
        </td>
        <td className="px-1 py-1.5">
          <select aria-label="Route order" className="input w-28 px-2 py-1.5" value={r.priority} onChange={(e) => onChange({ priority: Number(e.target.value) })}>
            <option value={1}>First out</option>
            <option value={2}>Standard</option>
            <option value={3}>Last</option>
          </select>
        </td>
        <td className="px-1 py-1.5">
          <input aria-label="Trigger inches" type="number" min={0} max={24} className="input w-16 px-2 py-1.5" value={r.triggerInches} onChange={(e) => onChange({ triggerInches: Math.max(0, Math.min(24, Number(e.target.value) || 0)) })} />
        </td>
        <td className="px-1 py-1.5">
          <textarea aria-label="Notes" rows={1} className="input w-56 px-2 py-1.5" value={r.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} />
        </td>
      </tr>
      {flagged && (
        <tr>
          <td />
          <td colSpan={11} className="px-1 pb-3 text-sm">
            {error && <p className="font-semibold text-brake">{error}</p>}
            {r.duplicate === "existing" && <p>Already in your customer list, so it won&apos;t be added again.</p>}
            {r.duplicate === "batch" && <p>Appears more than once in this import.</p>}
            {r.issues.map((i) => <p key={i}>{i}</p>)}
          </td>
        </tr>
      )}
    </tbody>
  );
}
