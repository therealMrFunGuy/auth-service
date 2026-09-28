import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

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

const TOOL: Anthropic.Tool = {
  name: "record_customers",
  description: "Record every snow removal customer / service address found in the input.",
  input_schema: {
    type: "object",
    properties: {
      customers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Customer or business name. For a business, the business name." },
            phone: { type: ["string", "null"], description: "Formatted as (651) 555-0123 when US." },
            email: { type: ["string", "null"] },
            street: { type: "string", description: "House number and street only, e.g. '2140 4th St'." },
            unit: { type: ["string", "null"], description: "Apt/suite/unit/building, e.g. 'Ste 200'." },
            city: { type: "string" },
            state: { type: "string", description: "2-letter code." },
            zip: { type: ["string", "null"], description: "5-digit ZIP if present." },
            serviceType: { type: "string", enum: ["residential", "commercial"] },
            triggerInches: {
              type: ["integer", "null"],
              description: "Snow depth that triggers service, only if the input states it.",
            },
            priority: {
              type: ["integer", "null"],
              description: "1 = first out (medical, 24h business, 'first'/'priority'), 3 = last. Null if not stated.",
            },
            notes: {
              type: ["string", "null"],
              description: "Service details worth keeping: gate codes, sidewalks, salt, where to pile snow, dogs, contract terms.",
            },
            issues: {
              type: "array",
              items: { type: "string" },
              description: "Short notes on anything guessed, missing, or unreadable in this row. Empty if clean.",
            },
          },
          required: ["name", "phone", "email", "street", "unit", "city", "state", "zip", "serviceType", "triggerInches", "priority", "notes", "issues"],
        },
      },
    },
    required: ["customers"],
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

Call record_customers exactly once with every customer you found.`;

type Content = Anthropic.ContentBlockParam;

export async function extractCustomers(content: Content[], opts: { defaultState: string; defaultCity: string | null }) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: system(opts.defaultState, opts.defaultCity),
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content }],
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const truncated = res.stop_reason === "max_tokens";
  const customers = ((block?.input as { customers?: ExtractedCustomer[] } | undefined)?.customers ?? []).filter(
    (c) => c && typeof c.street === "string",
  );
  return { customers, truncated };
}
