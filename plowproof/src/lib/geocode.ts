import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customer } from "@/db/schema";
import { formatAddress } from "@/lib/address";

/**
 * US Census Bureau geocoder: free, no API key, US addresses only.
 * Swap for Mapbox/Google later if you need rooftop accuracy or higher throughput.
 */
export async function geocodeOne(address: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) throw new Error(`Census geocoder ${res.status}`);
  const data = (await res.json()) as {
    result?: { addressMatches?: { coordinates: { x: number; y: number } }[] };
  };
  const match = data.result?.addressMatches?.[0];
  return match ? { lat: match.coordinates.y, lng: match.coordinates.x } : null;
}

/** Geocode the given customers (scoped to one org), 5 at a time. Failed lookups stay "pending" for a retry. */
export async function geocodeCustomers(organizationId: string, ids: string[]) {
  if (ids.length === 0) return;
  const rows = await db
    .select()
    .from(customer)
    .where(and(eq(customer.organizationId, organizationId), inArray(customer.id, ids)));

  let i = 0;
  const worker = async () => {
    while (i < rows.length) {
      const row = rows[i++];
      try {
        const hit = await geocodeOne(formatAddress(row));
        await db
          .update(customer)
          .set(hit ? { lat: hit.lat, lng: hit.lng, geocodeStatus: "matched" } : { geocodeStatus: "no_match" })
          .where(eq(customer.id, row.id));
      } catch (err) {
        console.warn(`Geocode failed for customer ${row.id}:`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, rows.length) }, worker));
}
