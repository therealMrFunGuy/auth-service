import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customer } from "@/db/schema";
import { formatAddress } from "@/lib/address";
import { requireDispatcher } from "@/lib/session";
import { PriorityMark } from "@/components/PriorityMark";
import { CustomerRowActions, EmailProofToggle, RetryGeocodeButton } from "./CustomerActions";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const { membership } = await requireDispatcher();
  const rows = await db
    .select()
    .from(customer)
    .where(eq(customer.organizationId, membership.organizationId))
    .orderBy(asc(customer.priority), asc(customer.city), asc(customer.name));

  const unmapped = rows.filter((r) => r.geocodeStatus !== "matched").length;
  const commercial = rows.filter((r) => r.serviceType === "commercial").length;

  if (rows.length === 0) {
    return (
      <section className="max-w-xl py-10">
        <h1 className="sign text-4xl font-bold">Add your customers</h1>
        <p className="mt-3 text-slush">
          Paste last season&apos;s list, upload a spreadsheet export or invoice PDF, or snap a photo of your route sheet.
          The importer sorts out names, addresses, and service notes for you to check before saving.
        </p>
        <Link href="/dashboard/import" className="btn btn-primary mt-6">Import customers</Link>
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="sign text-4xl font-bold">Customers</h1>
          <p className="mt-1 text-slush">
            {rows.length} properties, {commercial} commercial
            {unmapped > 0 && `, ${unmapped} not on the map yet`}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {unmapped > 0 && <RetryGeocodeButton />}
          <Link href="/dashboard/import" className="btn btn-primary">Import more</Link>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded border border-frost bg-salt">
        <table className="w-full min-w-[760px] text-left">
          <thead className="border-b border-frost text-sm text-slush">
            <tr>
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Address</th>
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Trigger</th>
              <th className="px-4 py-3 font-semibold">Notes</th>
              <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-frost last:border-0 align-top">
                <td className="px-4 py-3">
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-sm text-slush">{r.serviceType === "commercial" ? "Commercial" : "Residential"}</div>
                  {r.phone && <div className="text-sm text-slush">{r.phone}</div>}
                  {r.email && (
                    <>
                      <div className="text-sm text-slush">{r.email}</div>
                      <EmailProofToggle id={r.id} on={r.emailProof} />
                    </>
                  )}
                </td>
                <td className="px-4 py-3">
                  {formatAddress(r)}
                  {r.geocodeStatus === "no_match" && (
                    <div className="text-sm text-brake">Address not found on the map. Check the spelling.</div>
                  )}
                  {r.geocodeStatus === "pending" && <div className="text-sm text-slush">Finding on map…</div>}
                </td>
                <td className="px-4 py-3"><PriorityMark priority={r.priority} /></td>
                <td className="px-4 py-3 tabular-nums">{r.triggerInches}&Prime;</td>
                <td className="max-w-[16rem] px-4 py-3 text-sm text-slush">{r.notes}</td>
                <td className="px-4 py-3 text-right"><CustomerRowActions id={r.id} name={r.name} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
