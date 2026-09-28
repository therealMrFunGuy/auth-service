import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companySettings } from "@/db/schema";
import { TIMEZONE } from "@/lib/time";

export type Settings = {
  timezone: string;
  yardAddress: string | null;
  yard: { lat: number; lng: number } | null;
};

/** Company settings with defaults filled in. Cached per request. */
export const getSettings = cache(async (organizationId: string): Promise<Settings> => {
  const [row] = await db.select().from(companySettings).where(eq(companySettings.organizationId, organizationId));
  return {
    timezone: row?.timezone ?? TIMEZONE,
    yardAddress: row?.yardAddress ?? null,
    yard: row?.yardLat != null && row?.yardLng != null ? { lat: row.yardLat, lng: row.yardLng } : null,
  };
});

export const getTimezone = async (organizationId: string) => (await getSettings(organizationId)).timezone;
