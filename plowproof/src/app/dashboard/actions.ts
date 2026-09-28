"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/db";
import { customer } from "@/db/schema";
import { geocodeCustomers } from "@/lib/geocode";
import { requireDispatcher } from "@/lib/session";

export async function deleteCustomer(id: string) {
  const { membership } = await requireDispatcher();
  await db.delete(customer).where(and(eq(customer.id, id), eq(customer.organizationId, membership.organizationId)));
  revalidatePath("/dashboard");
  revalidatePath("/driver");
}

export async function retryGeocoding() {
  const { membership } = await requireDispatcher();
  const rows = await db
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.organizationId, membership.organizationId), ne(customer.geocodeStatus, "matched")));
  after(async () => {
    await geocodeCustomers(membership.organizationId, rows.map((r) => r.id));
  });
  return rows.length;
}

export async function setProofNotice(id: string, channel: "email" | "text", on: boolean) {
  const { membership } = await requireDispatcher();
  await db
    .update(customer)
    .set(channel === "email" ? { emailProof: on } : { textProof: on })
    .where(and(eq(customer.id, id), eq(customer.organizationId, membership.organizationId)));
  revalidatePath("/dashboard");
}
