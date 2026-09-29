import "server-only";

/**
 * Customer extraction through OpenRouter (OpenAI-compatible chat API).
 * Default model is free (`:free` suffix): 20 requests/minute, 50/day, or 1,000/day once the
 * account has bought $10 of credits. Set OPENROUTER_MODEL to use another model.
 */
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL ?? "qwen/qwen3.8-27b:free";
/** If the main model is busy or down, OpenRouter's free router picks another free model that fits the request. */
const FALLBACK = process.env.OPENROUTER_FALLBACK_MODEL ?? "openrouter/free";

export type ExtractedCustomer = {
  name: string;
  phone: string | null;
  email: string | null;
  street: string;
  unit: string | null;
  city: string;
  state: string;
  zip: string | null;
  serviceType: "residential" | "commercial";
  triggerInches: number | null;
  priority: number | null;
  notes: string | null;
  issues: string[];
};

/** Message parts in OpenAI chat format. PDFs go through OpenRouter's free file parser. */
export type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

/** A failure worth showing to the office as-is (limits, bad key), not just "couldn't be read". */
export class AiError extends Error {}

const nullable = (type: string, description?: string) => ({ type: [type, "null"], ...(description ? { description } : {}) });

// Strict JSON schema: every property required, no extras. Null stands in for "not present".
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["customers"],
  properties: {
    customers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "phone", "email", "street", "unit", "city", "state", "zip", "serviceType", "triggerInches", "priority", "notes", "issues"],
        properties: {
          name: { type: "string", description: "Customer or business name. For a business, the business name." },
          phone: nullable("string", "Formatted as (651) 555-0123 when US."),
          email: nullable("string"),
          street: { type: "string", description: "House number and street only, e.g. '2140 4th St'." },
          unit: nullable("string", "Apt/suite/unit/building, e.g. 'Ste 200'."),
          city: { type: "string" },
          state: { type: "string", description: "2-letter code." },
          zip: nullable("string", "5-digit ZIP if present."),
          serviceType: { type: "string", enum: ["residential", "commercial"] },
          triggerInches: nullable("integer", "Snow depth that triggers service, only if the input states it."),
          priority: nullable("integer", "1 = first out (medical, 24h business, 'first'/'priority'), 3 = last. Null if not stated."),
          notes: nullable("string", "Service details worth keeping: gate codes, sidewalks, salt, where to pile snow, dogs, contract terms."),
          issues: {
            type: "array",
            items: { type: "string" },
            description: "Short notes on anything guessed, missing, or unreadable in this row. Empty if clean.",
          },
        },
      },
    },
  },
};

const system = (defaultState: string, defaultCity: string | null) => `You extract customer records for a snow plowing company from messy input: spreadsheets, CSV exports, invoices, handwritten route sheets, texts, or pasted notes.

Rules:
- One record per service address. If a customer has two properties, make two records with the same name.
- Never invent data. Use null for anything not present. Do not guess phone numbers, emails, or ZIPs.
- If the state is missing, use ${defaultState} and add an issue saying so.${defaultCity ? `\n- If the city is missing, use ${defaultCity} and add an issue saying so.` : `\n- If the city is missing and can't be determined, put "" and add an issue.`}
- Expand obvious typos in city names (e.g. "Whtie Bear Lk" → "White Bear Lake") and note it as an issue.
- serviceType is "commercial" for businesses, churches, HOAs, apartment lots, and parking lots; otherwise "residential".
- Skip header rows, totals, blank rows, and anything that is not a customer.
- Keep issues short and specific, written for the office manager who will review them.

Reply with only a JSON object {"customers": [...]} matching the schema, listing every customer you found.`;

/** Models sometimes wrap JSON in a code fence or add a sentence; take the outermost object. */
function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model didn't return JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

export async function extractCustomers(content: Part[], opts: { defaultState: string; defaultCity: string | null }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new AiError("OPENROUTER_API_KEY is not set on the server.");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      // Optional attribution headers OpenRouter shows on its dashboard.
      "HTTP-Referer": process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      "X-Title": "PlowProof",
    },
    body: JSON.stringify({
      model: MODEL,
      models: FALLBACK && FALLBACK !== MODEL ? [MODEL, FALLBACK] : undefined,
      messages: [
        { role: "system", content: system(opts.defaultState, opts.defaultCity) },
        { role: "user", content },
      ],
      response_format: { type: "json_schema", json_schema: { name: "customers", strict: true, schema: SCHEMA } },
      // Only route to providers that honor the JSON schema.
      provider: { require_parameters: true },
      // PDFs: the free Cloudflare parser. The default (Mistral OCR) is paid per page.
      plugins: [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }],
      max_tokens: 16000,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(240_000),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 429)
      throw new AiError(
        "The free AI model's limit is reached (20 a minute, 50 a day). Wait a minute and try again, or add $10 of OpenRouter credits to raise it to 1,000 a day.",
      );
    if (res.status === 401) throw new AiError("OpenRouter rejected the API key. Check OPENROUTER_API_KEY.");
    if (res.status === 402) throw new AiError("OpenRouter says the account balance is negative. Add credits to keep using free models.");
    throw new Error(`OpenRouter ${res.status}: ${msg}`);
  }

  const data = (await res.json()) as {
    choices?: { finish_reason?: string; message?: { content?: string | null } }[];
    error?: { message?: string };
  };
  if (data.error) throw new Error(`OpenRouter: ${data.error.message}`);
  const choice = data.choices?.[0];
  const truncated = choice?.finish_reason === "length";
  const text = choice?.message?.content ?? "";

  let parsed: { customers?: ExtractedCustomer[] } = {};
  try {
    parsed = parseJson(text) as typeof parsed;
  } catch (err) {
    if (!truncated) throw err; // a cut-off list is reported as truncated, not as a failure
  }
  const customers = (parsed.customers ?? []).filter(
    (c) => c && typeof c.street === "string" && typeof c.name === "string",
  ).map((c) => ({ ...c, issues: Array.isArray(c.issues) ? c.issues : [] }));
  return { customers, truncated };
}
