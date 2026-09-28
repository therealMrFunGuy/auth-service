"use client";
import { createStore, del, entries, get, set } from "idb-keyval";

/**
 * Visits live on the phone until the server confirms them.
 *  - drafts: a visit in progress, keyed by customerId, so a locked screen or refresh loses nothing
 *  - queue:  finished visits waiting to upload, keyed by clientId (the server's idempotency key)
 */
const drafts = typeof indexedDB !== "undefined" ? createStore("plowproof", "drafts") : undefined;
const queue = typeof indexedDB !== "undefined" ? createStore("plowproof-queue", "visits") : undefined;

export type Fix = { lat: number; lng: number; accuracy: number };

export type Draft = {
  clientId: string;
  customerId: string;
  startedAt: string;
  photos: Blob[];
  notes: string;
};

export type QueuedVisit = {
  clientId: string;
  customerId: string;
  label: string;
  startedAt: string;
  completedAt: string;
  fix: Fix | null;
  notes: string;
  photos: Blob[];
  attempts: number;
  /** Set when the server rejected it for a reason retrying won't fix. */
  rejected?: string;
};

export const QUEUE_EVENT = "plowproof:queue";
const announce = () => window.dispatchEvent(new Event(QUEUE_EVENT));

/** crypto.randomUUID only exists on HTTPS; getRandomValues works everywhere. */
export function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const getDraft = (customerId: string) => get<Draft>(customerId, drafts);
export const saveDraft = (d: Draft) => set(d.customerId, d, drafts);
export const clearDraft = (customerId: string) => del(customerId, drafts);

export async function listQueue(): Promise<QueuedVisit[]> {
  if (!queue) return [];
  return (await entries<string, QueuedVisit>(queue)).map(([, v]) => v).sort((a, b) => a.completedAt.localeCompare(b.completedAt));
}
export async function enqueue(v: QueuedVisit) {
  await set(v.clientId, v, queue);
  announce();
}
export async function dropFromQueue(clientId: string) {
  await del(clientId, queue);
  announce();
}

export type UploadResult = { ok: true; proofToken: string } | { ok: false; retry: boolean; message: string };

export async function uploadVisit(v: QueuedVisit): Promise<UploadResult> {
  const form = new FormData();
  form.set("clientId", v.clientId);
  form.set("customerId", v.customerId);
  form.set("startedAt", v.startedAt);
  form.set("completedAt", v.completedAt);
  form.set("lat", v.fix ? String(v.fix.lat) : "");
  form.set("lng", v.fix ? String(v.fix.lng) : "");
  form.set("accuracyM", v.fix ? String(Math.round(v.fix.accuracy)) : "");
  form.set("notes", v.notes);
  v.photos.forEach((p, i) => form.append("photos", p, `photo-${i + 1}.jpg`));

  let res: Response;
  try {
    res = await fetch("/api/service", { method: "POST", body: form });
  } catch {
    return { ok: false, retry: true, message: "No signal" };
  }
  const body = (await res.json().catch(() => ({}))) as { proofToken?: string; error?: string };
  if (res.ok && body.proofToken) return { ok: true, proofToken: body.proofToken };
  // 401: signed out, keep it until they sign back in. 5xx/429: server trouble, keep retrying.
  const retry = res.status === 401 || res.status === 429 || res.status >= 500;
  return { ok: false, retry, message: body.error ?? `Upload failed (${res.status})` };
}

let flushing = false;
/** Upload everything waiting. Safe to call often; only one flush runs at a time. */
export async function flushQueue() {
  if (flushing || !queue) return;
  flushing = true;
  try {
    for (const v of await listQueue()) {
      if (v.rejected) continue;
      const r = await uploadVisit(v);
      if (r.ok) await dropFromQueue(v.clientId);
      else if (!r.retry) await enqueue({ ...v, rejected: r.message });
      else {
        await set(v.clientId, { ...v, attempts: v.attempts + 1 }, queue);
        if (r.message === "No signal") break; // no point trying the rest right now
      }
    }
  } finally {
    flushing = false;
    announce();
  }
}
