import "server-only";
import { PDFDocument, PDFFont, PDFImage, PDFPage, PDFString, StandardFonts, rgb } from "pdf-lib";
import { asc, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { anchor, serviceEvent, storm, type PhotoRef } from "@/db/schema";
import { FAR_FROM_PROPERTY_M } from "@/lib/geo";
import { getObject } from "@/lib/storage";
import { fmtDate, fmtLongDate, fmtTime } from "@/lib/time";

const APP_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export type ReportVisit = {
  id: string;
  startedAt: Date;
  completedAt: Date;
  addressSnapshot: string;
  driverName: string;
  distanceM: number | null;
  accuracyM: number | null;
  lat: number | null;
  notes: string | null;
  photos: PhotoRef[];
  proofToken: string;
  stormName: string;
  anchor: { status: string; txSignature: string | null; cluster: string; confirmedAt: Date | null } | null;
};

type Opts = {
  orgName: string;
  title: string;
  subtitle: string;
  tz: string;
  visits: ReportVisit[];
  /** Customer reports show the address once in the subtitle; storm reports show it per visit. */
  showAddress: boolean;
  photosPerVisit: number;
};

// Brand colors from globals.css.
const ASPHALT = rgb(0x15 / 255, 0x20 / 255, 0x2b / 255);
const SLUSH = rgb(0x5b / 255, 0x68 / 255, 0x75 / 255);
const FROST = rgb(0xd3 / 255, 0xdc / 255, 0xe4 / 255);
const BEACON = rgb(0xf2 / 255, 0xa9 / 255, 0x00 / 255);
const BRAKE = rgb(0xb8 / 255, 0x32 / 255, 0x1c / 255);
const THAW = rgb(0x2e / 255, 0x7a / 255, 0x4c / 255);
const LINK = rgb(0.1, 0.3, 0.7);

const W = 612, H = 792, M = 50, BODY = W - 2 * M;
const THUMB_W = 150, THUMB_H = 112;

/** Standard PDF fonts only cover WinAnsi. Swap the characters Intl and our copy produce, drop the rest. */
const WINANSI_EXTRA = new Set("–—‘’“”•…€".split(""));
export const pdfSafe = (s: string) =>
  s
    .replace(/[    ]/g, " ")
    .replace(/[″]/g, '"')
    .replace(/[′]/g, "'")
    .split("")
    .filter((c) => c.charCodeAt(0) <= 0xff || WINANSI_EXTRA.has(c))
    .join("");

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function addLink(doc: PDFDocument, page: PDFPage, x: number, y: number, w: number, h: number, url: string) {
  const annot = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, y, x + w, y + h],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    }),
  );
  page.node.addAnnot(annot);
}

function locationLine(v: ReportVisit) {
  if (v.distanceM != null) {
    const acc = v.accuracyM != null ? ` (GPS accurate to ${Math.round(v.accuracyM)} m)` : "";
    return { text: `Driver's phone was ${v.distanceM} m from the property${acc}.`, warn: v.distanceM > FAR_FROM_PROPERTY_M };
  }
  return v.lat != null
    ? { text: "Phone location recorded; the property isn't on the map to compare.", warn: false }
    : { text: "No location was available from the driver's phone.", warn: true };
}

function sealLine(v: ReportVisit, tz: string) {
  const a = v.anchor;
  if (!a || a.status !== "confirmed" || !a.txSignature) return { text: "Not sealed on Solana yet (sealed when the storm ends).", color: SLUSH };
  const sig = `${a.txSignature.slice(0, 8)}…${a.txSignature.slice(-8)}`;
  const net = a.cluster === "mainnet-beta" ? "Solana" : `Solana ${a.cluster}`;
  return { text: `Sealed on ${net}${a.confirmedAt ? ` ${fmtDate(a.confirmedAt, tz)}` : ""}, transaction ${sig}.`, color: THAW };
}

async function loadThumbs(doc: PDFDocument, visits: ReportVisit[], perVisit: number) {
  const out = new Map<string, PDFImage[]>();
  if (perVisit === 0) return out;
  const jobs = visits.flatMap((v) =>
    v.photos
      .filter((p) => p.contentType === "image/jpeg" || p.contentType === "image/png") // pdf-lib can't embed WebP
      .slice(0, perVisit)
      .map((p) => ({ v, p })),
  );
  let i = 0;
  const results: { id: string; idx: number; img: PDFImage }[] = [];
  const worker = async () => {
    while (i < jobs.length) {
      const idx = i++;
      const { v, p } = jobs[idx];
      const bytes = await getObject(p.key).catch(() => null);
      if (!bytes) continue;
      try {
        const img = p.contentType === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        results.push({ id: v.id, idx, img });
      } catch {
        // Unreadable image: leave it out of the report; the proof page still has it.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker));
  for (const r of results.sort((a, b) => a.idx - b.idx)) out.set(r.id, [...(out.get(r.id) ?? []), r.img]);
  return out;
}

export async function renderReport(o: Opts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${o.title} - ${o.orgName}`));
  doc.setProducer("PlowProof");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const thumbs = await loadThumbs(doc, o.visits, o.photosPerVisit);

  let page = doc.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, size: number, f = font, color = ASPHALT) => {
    page.drawText(pdfSafe(s), { x, y, size, font: f, color });
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };

  // Header
  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: BEACON });
  y -= 4;
  text(o.orgName, M, 11, bold, SLUSH);
  y -= 26;
  text(o.title, M, 22, bold);
  y -= 18;
  for (const line of wrap(o.subtitle, font, 11, BODY)) {
    text(line, M, 11, font, SLUSH);
    y -= 15;
  }
  const sealed = o.visits.filter((v) => v.anchor?.status === "confirmed").length;
  const withPhotos = o.visits.filter((v) => v.photos.length > 0).length;
  y -= 4;
  text(
    `${o.visits.length} ${o.visits.length === 1 ? "visit" : "visits"}, ${withPhotos} with photos, ${sealed} sealed on Solana.`,
    M,
    11,
    bold,
  );
  y -= 14;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: FROST });
  y -= 22;

  if (o.visits.length === 0) {
    text("No visits were logged in this period.", M, 12);
    y -= 20;
  }

  for (const v of o.visits) {
    const mins = Math.max(0, Math.round((v.completedAt.getTime() - v.startedAt.getTime()) / 60_000));
    const loc = locationLine(v);
    const seal = sealLine(v, o.tz);
    const url = `${APP_URL}/p/${v.proofToken}`;
    const detail = `Arrived ${fmtTime(v.startedAt, o.tz)}, finished ${fmtTime(v.completedAt, o.tz)} (${mins < 1 ? "under a minute" : `${mins} min`} on site). Crew: ${v.driverName}.`;
    const blocks = [
      ...(o.showAddress ? [{ lines: wrap(v.addressSnapshot, bold, 11, BODY), f: bold, size: 11, color: ASPHALT }] : []),
      { lines: wrap(detail, font, 10, BODY), f: font, size: 10, color: ASPHALT },
      { lines: wrap(loc.text, font, 10, BODY), f: font, size: 10, color: loc.warn ? BRAKE : ASPHALT },
      ...(v.notes ? [{ lines: wrap(`Notes: ${v.notes}`, font, 10, BODY), f: font, size: 10, color: ASPHALT }] : []),
      { lines: wrap(seal.text, font, 10, BODY), f: font, size: 10, color: seal.color },
    ];
    const imgs = thumbs.get(v.id) ?? [];
    const height =
      18 + blocks.reduce((h, b) => h + b.lines.length * 14, 0) + 14 + (imgs.length ? THUMB_H + 10 : 0) + 20;
    if (y - height < M + 30) newPage();

    text(`${fmtLongDate(v.completedAt, o.tz)}, ${fmtTime(v.completedAt, o.tz)}`, M, 12, bold);
    const storm = pdfSafe(v.stormName);
    page.drawText(storm, { x: W - M - font.widthOfTextAtSize(storm, 10), y, size: 10, font, color: SLUSH });
    y -= 18;
    for (const b of blocks) {
      for (const line of b.lines) {
        text(line, M, b.size, b.f, b.color);
        y -= 14;
      }
    }
    text("Proof page: ", M, 10, font, SLUSH);
    const lx = M + font.widthOfTextAtSize("Proof page: ", 10);
    const shown = url.length > 90 ? `${url.slice(0, 87)}...` : url;
    page.drawText(shown, { x: lx, y, size: 10, font, color: LINK });
    addLink(doc, page, lx, y - 2, font.widthOfTextAtSize(shown, 10), 12, url);
    y -= 14;

    if (imgs.length) {
      y -= 4;
      let x = M;
      for (const img of imgs) {
        const s = Math.min(THUMB_W / img.width, THUMB_H / img.height);
        const w = img.width * s, h = img.height * s;
        page.drawRectangle({ x, y: y - THUMB_H, width: THUMB_W, height: THUMB_H, color: FROST });
        page.drawImage(img, { x: x + (THUMB_W - w) / 2, y: y - THUMB_H + (THUMB_H - h) / 2, width: w, height: h });
        x += THUMB_W + 8;
      }
      y -= THUMB_H + 6;
      if (v.photos.length > imgs.length) {
        y -= 4;
        text(`${v.photos.length - imgs.length} more on the proof page.`, M, 9, font, SLUSH);
        y -= 6;
      }
    }
    y -= 10;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: FROST });
    y -= 20;
  }

  // How to verify, then footers.
  const how = wrap(
    "How to check these records: each visit was fingerprinted (SHA-256) the moment the driver's phone uploaded it, " +
      "including the times, GPS position, notes, and every photo. When a storm ends, the fingerprints of all its visits are " +
      "combined into one value and written to the public Solana blockchain, where it can't be edited or deleted. " +
      "Open any proof page link above to re-check a visit live against its photos and the blockchain.",
    font,
    9,
    BODY,
  );
  if (y - how.length * 12 - 10 < M + 30) newPage();
  text("How to check these records", M, 10, bold);
  y -= 14;
  for (const line of how) {
    text(line, M, 9, font, SLUSH);
    y -= 12;
  }

  const pages = doc.getPages();
  const generated = pdfSafe(`Generated ${fmtLongDate(new Date(), o.tz)} by PlowProof`);
  pages.forEach((p, i) => {
    p.drawText(generated, { x: M, y: 28, size: 8, font, color: SLUSH });
    const n = `Page ${i + 1} of ${pages.length}`;
    p.drawText(n, { x: W - M - font.widthOfTextAtSize(n, 8), y: 28, size: 8, font, color: SLUSH });
  });

  return doc.save();
}

/** Visits for a report, oldest first, with their storm name and seal status. Caller scopes by org. */
export async function loadReportVisits(where: SQL | undefined): Promise<ReportVisit[]> {
  const rows = await db
    .select({ ev: serviceEvent, stormName: storm.name, anchor })
    .from(serviceEvent)
    .innerJoin(storm, eq(storm.id, serviceEvent.stormId))
    .leftJoin(anchor, eq(anchor.id, serviceEvent.anchorId))
    .where(where)
    .orderBy(asc(serviceEvent.completedAt));
  return rows.map(({ ev, stormName, anchor: a }) => ({
    ...ev,
    stormName,
    anchor: a ? { status: a.status, txSignature: a.txSignature, cluster: a.cluster, confirmedAt: a.confirmedAt } : null,
  }));
}

export const pdfResponse = (bytes: Uint8Array, filename: string) =>
  new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename.replace(/[^a-z0-9._-]+/gi, "-")}"`,
      "cache-control": "private, no-store",
    },
  });
