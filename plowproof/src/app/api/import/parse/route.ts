import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { customer } from "@/db/schema";
import { addressKey } from "@/lib/address";
import { AiError, extractCustomers, type ExtractedCustomer, type Part } from "@/lib/ai-extract";
import type { ParseResponse, ParsedRow } from "@/lib/import-schema";
import { getMembership, getSession, isDispatcher } from "@/lib/session";

export const maxDuration = 300;

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // keeps requests well under provider image limits
const LINES_PER_CHUNK = 120;
const CONCURRENCY = 2; // free models allow 20 requests a minute

const IMAGE_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const;
const TEXT_EXT = new Set(["csv", "tsv", "txt", "text", "md"]);
const HEADER_HINT = /name|address|street|city|phone|email|zip/i;

type Job = { label: string; content: Part[] };

const json = (body: ParseResponse, status = 200) => NextResponse.json(body, { status });

/** Split long text into chunks; repeat a header row on each chunk so columns stay meaningful. */
function textJobs(label: string, text: string): Job[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = HEADER_HINT.test(lines[0]) && /[,\t;|]/.test(lines[0]) ? lines[0] : null;
  const body = header ? lines.slice(1) : lines;
  const jobs: Job[] = [];
  for (let i = 0; i < body.length; i += LINES_PER_CHUNK) {
    const part = body.slice(i, i + LINES_PER_CHUNK);
    const chunk = header ? [header, ...part].join("\n") : part.join("\n");
    jobs.push({ label: `${label} (rows ${i + 1}–${i + part.length})`, content: [{ type: "text", text: chunk }] });
  }
  return jobs;
}

async function fileJobs(file: File): Promise<Job[] | string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.size > MAX_FILE_BYTES) return `${file.name} is over 10 MB. Split it into smaller files.`;
  if (ext === "xlsx" || ext === "xls" || ext === "numbers")
    return `${file.name}: export the sheet as CSV (File → Download → CSV) and upload that instead.`;
  if (TEXT_EXT.has(ext) || file.type.startsWith("text/")) return textJobs(file.name, await file.text());

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  if (ext === "pdf" || file.type === "application/pdf") {
    return [{
      label: file.name,
      content: [
        { type: "file", file: { filename: file.name, file_data: `data:application/pdf;base64,${data}` } },
        { type: "text", text: "Extract every customer in this document." },
      ],
    }];
  }
  const media = IMAGE_TYPES[ext as keyof typeof IMAGE_TYPES];
  if (media) {
    if (file.size > MAX_IMAGE_BYTES) return `${file.name} is over 5 MB. Retake the photo at a lower resolution.`;
    return [{
      label: file.name,
      content: [
        { type: "image_url", image_url: { url: `data:${media};base64,${data}` } },
        { type: "text", text: "This is a photo or screenshot of a customer list. Extract every customer in it." },
      ],
    }];
  }
  return `${file.name}: upload CSV, TXT, PDF, JPG, PNG, or WebP.`;
}

async function runPool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return json({ error: "Sign in to import customers." }, 401);
  const membership = await getMembership();
  if (!membership || !isDispatcher(membership.role))
    return json({ error: "Only owners and admins can import customers." }, 403);
  if (!process.env.OPENROUTER_API_KEY) return json({ error: "OPENROUTER_API_KEY is not set on the server." }, 500);

  const form = await req.formData();
  const text = String(form.get("text") ?? "").trim();
  const defaultState = (String(form.get("defaultState") ?? "MN").trim().toUpperCase() || "MN").slice(0, 2);
  const defaultCity = String(form.get("defaultCity") ?? "").trim() || null;
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  if (!text && files.length === 0) return json({ error: "Paste a list or add a file to import." }, 400);
  if (files.length > MAX_FILES) return json({ error: `Add up to ${MAX_FILES} files at a time.` }, 400);

  const jobs: Job[] = text ? textJobs("Pasted text", text) : [];
  for (const file of files) {
    const result = await fileJobs(file);
    if (typeof result === "string") return json({ error: result }, 400);
    jobs.push(...result);
  }
  if (jobs.length === 0) return json({ error: "Nothing to read in that input." }, 400);

  const warnings: string[] = [];
  const results = await runPool(jobs, CONCURRENCY, async (job) => {
    try {
      const { customers, truncated } = await extractCustomers(job.content, { defaultState, defaultCity });
      if (truncated) warnings.push(`${job.label}: the list was cut off partway. Import the rest separately.`);
      if (customers.length === 0) warnings.push(`${job.label}: no customers found.`);
      return customers;
    } catch (err) {
      console.error(`AI import failed for ${job.label}`, err);
      warnings.push(err instanceof AiError ? `${job.label}: ${err.message}` : `${job.label}: couldn't be read. Try again or paste it as text.`);
      return [] as ExtractedCustomer[];
    }
  });

  const extracted = results.flat();
  const keys = extracted.map((c) =>
    addressKey({ street: c.street, unit: c.unit, city: c.city || defaultCity || "", state: c.state || defaultState }),
  );

  const existing = new Set<string>();
  const uniqueKeys = [...new Set(keys)];
  for (let i = 0; i < uniqueKeys.length; i += 500) {
    const found = await db
      .select({ key: customer.addressKey })
      .from(customer)
      .where(and(eq(customer.organizationId, membership.organizationId), inArray(customer.addressKey, uniqueKeys.slice(i, i + 500))));
    found.forEach((r) => existing.add(r.key));
  }

  const seen = new Set<string>();
  const rows: ParsedRow[] = extracted.map((c, i) => {
    const key = keys[i];
    const duplicate = existing.has(key) ? "existing" : seen.has(key) ? "batch" : null;
    seen.add(key);
    return {
      name: c.name?.trim() ?? "",
      phone: c.phone?.trim() || null,
      email: c.email?.trim() || null,
      street: c.street.trim(),
      unit: c.unit?.trim() || null,
      city: c.city?.trim() || defaultCity || "",
      state: (c.state?.trim() || defaultState).toUpperCase().slice(0, 2),
      zip: c.zip?.trim() || null,
      serviceType: c.serviceType === "commercial" ? "commercial" : "residential",
      triggerInches: Number.isInteger(c.triggerInches) ? Math.min(24, Math.max(0, c.triggerInches!)) : 2,
      priority: c.priority === 1 || c.priority === 3 ? c.priority : 2,
      notes: c.notes?.trim() || null,
      issues: Array.isArray(c.issues) ? c.issues.filter(Boolean) : [],
      duplicate,
    };
  });

  return json({ rows, warnings });
}
