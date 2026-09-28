import { z } from "zod";

/** One customer row as extracted by the AI and edited in the review table. */
export const importRowSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  phone: z.string().trim().max(40).nullable(),
  email: z.string().trim().max(200).nullable(),
  street: z.string().trim().min(1, "Street is required").max(200),
  unit: z.string().trim().max(40).nullable(),
  city: z.string().trim().min(1, "City is required").max(100),
  state: z.string().trim().length(2, "Use the 2-letter state code").toUpperCase(),
  zip: z.string().trim().max(10).nullable(),
  serviceType: z.enum(["residential", "commercial"]),
  triggerInches: z.number().int().min(0).max(24),
  priority: z.number().int().min(1).max(3),
  notes: z.string().trim().max(1000).nullable(),
});

export type ImportRow = z.infer<typeof importRowSchema>;

/** What the parse route returns for each row: the row plus AI flags for the reviewer. */
export type ParsedRow = ImportRow & {
  /** Things the AI wasn't sure about, e.g. "No city given; assumed White Bear Lake". */
  issues: string[];
  /** Already in this org's customer list, or repeated within this import. */
  duplicate: "existing" | "batch" | null;
};

export type ParseResponse = { rows: ParsedRow[]; warnings: string[] } | { error: string };
