"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { customer } from "@/db/schema";
import { addressKey } from "@/lib/address";
import { geocodeCustomers } from "@/lib/geocode";
import { importRowSchema } from "@/lib/import-schema";
import { requireDispatcher } from "@/lib/session";

const payloadSchema = z.array(importRowSchema).min(1).max(2000);

export type SaveResult =
  | { ok: true; added: number; skipped: number }
  | { ok: false; error: string; rowErrors?: Record<number, string> };

export async function saveImportedCustomers(rows: unknown): Promise<SaveResult> {
  const { membership } = await requireDispatcher();

  const parsed = payloadSchema.safeParse(rows);
  if (!parsed.success) {
    const rowErrors: Record<number, string> = {};
    for (const issue of parsed.error.issues) {
      const idx = issue.path[0];
      if (typeof idx === "number" && !(idx in rowErrors)) rowErrors[idx] = issue.message;
    }
    return { ok: false, error: "Some rows need fixing before they can be saved.", rowErrors };
  }

  const values = parsed.data.map((r) => ({
    ...r,
    email: r.email || null,
    organizationId: membership.organizationId,
    addressKey: addressKey(r),
    source: "ai_import",
  }));

  const inserted = await db
    .insert(customer)
    .values(values)
    .onConflictDoNothing({ target: [customer.organizationId, customer.addressKey] })
    .returning({ id: customer.id });

  const ids = inserted.map((r) => r.id);
  // Look up map coordinates after the response is sent so the save feels instant.
  after(() => geocodeCustomers(membership.organizationId, ids));

  revalidatePath("/dashboard");
  revalidatePath("/driver");
  return { ok: true, added: ids.length, skipped: values.length - ids.length };
}
