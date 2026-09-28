import { eq } from "drizzle-orm";
import { db } from "@/db";
import { serviceEvent } from "@/db/schema";
import { getMembership } from "@/lib/session";
import { getObject } from "@/lib/storage";

/** Serves a visit photo to crew members of that company, or to anyone holding the proof link token. */
export async function GET(req: Request, { params }: { params: Promise<{ eventId: string; index: string }> }) {
  const { eventId, index } = await params;
  const token = new URL(req.url).searchParams.get("t");
  const [ev] = await db
    .select({ org: serviceEvent.organizationId, photos: serviceEvent.photos, proofToken: serviceEvent.proofToken })
    .from(serviceEvent)
    .where(eq(serviceEvent.id, eventId));
  if (!ev) return new Response("Not found", { status: 404 });

  const allowed = token ? token === ev.proofToken : (await getMembership())?.organizationId === ev.org;
  if (!allowed) return new Response("Not found", { status: 404 });

  const photo = ev.photos[Number(index)];
  if (!photo) return new Response("Not found", { status: 404 });
  const body = await getObject(photo.key);
  if (!body) return new Response("Photo missing from storage", { status: 404 });

  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": photo.contentType,
      // Content-addressed and immutable, so it can be cached hard.
      "cache-control": "private, max-age=31536000, immutable",
      etag: `"${photo.sha256}"`,
    },
  });
}
