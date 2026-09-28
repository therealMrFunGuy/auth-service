import { relations } from "drizzle-orm";
import { boolean, customType, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";

// Better Auth tables (user, session, organization, member, invitation, ...).
// Regenerate with `npm run auth:generate` after changing auth plugins.
export * from "./auth-schema";

export const customer = pgTable(
  "customer",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),

    street: text("street").notNull(),
    unit: text("unit"),
    city: text("city").notNull(),
    state: text("state").notNull().default("MN"),
    zip: text("zip"),
    /** Normalized street+unit+city+state+zip, used to skip duplicate imports. */
    addressKey: text("address_key").notNull(),

    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    /** pending | matched | no_match */
    geocodeStatus: text("geocode_status").notNull().default("pending"),

    /** residential | commercial */
    serviceType: text("service_type").notNull().default("residential"),
    /** Plow once snowfall reaches this many inches. */
    triggerInches: integer("trigger_inches").notNull().default(2),
    /** 1 = first out (hospitals, retail lots), 3 = last. */
    priority: integer("priority").notNull().default(2),
    notes: text("notes"),
    /** Email the proof page link to this customer after each visit (needs `email`). */
    emailProof: boolean("email_proof").notNull().default(true),
    /** Text the proof link after each visit (needs `phone`). Off by default: only with the customer's OK. */
    textProof: boolean("text_proof").notNull().default(false),

    /** ai_import | manual */
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("customer_org_idx").on(t.organizationId),
    uniqueIndex("customer_org_address_uidx").on(t.organizationId, t.addressKey),
  ],
);

export const customerRelations = relations(customer, ({ one, many }) => ({
  organization: one(organization, { fields: [customer.organizationId], references: [organization.id] }),
  serviceEvents: many(serviceEvent),
}));

const tz = { withTimezone: true } as const;

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/** Photo bytes when STORAGE_DRIVER=db (serverless hosts without a bucket). Keys match the S3/local layout. */
export const storedObject = pgTable("stored_object", {
  key: text("key").primaryKey(),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", tz).defaultNow().notNull(),
});

/** Per-company preferences. A missing row means defaults (APP_TIMEZONE, no yard). */
export const companySettings = pgTable("company_settings", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** IANA zone used for every time shown to the office, drivers, and customers. */
  timezone: text("timezone").notNull(),
  /** Where trucks leave from. Routes start at the stop nearest the yard. */
  yardAddress: text("yard_address"),
  yardLat: doublePrecision("yard_lat"),
  yardLng: doublePrecision("yard_lng"),
  updatedAt: timestamp("updated_at", tz)
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type CompanySettings = typeof companySettings.$inferSelect;

/** One snow event. Service records are grouped by storm, and each storm is anchored on Solana. */
export const storm = pgTable(
  "storm",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    snowfallInches: doublePrecision("snowfall_inches"),
    startedAt: timestamp("started_at", tz).defaultNow().notNull(),
    endedAt: timestamp("ended_at", tz),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  },
  (t) => [index("storm_org_idx").on(t.organizationId, t.startedAt)],
);

export type PhotoRef = { sha256: string; key: string; bytes: number; contentType: string };

/**
 * One visit to one property. Immutable once written: recordHash covers every field below
 * that a customer or insurer would care about (see src/lib/proof.ts).
 */
export const serviceEvent = pgTable(
  "service_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    stormId: text("storm_id")
      .notNull()
      .references(() => storm.id, { onDelete: "cascade" }),
    /** Null if the customer was later deleted; addressSnapshot keeps the record meaningful. */
    customerId: text("customer_id").references(() => customer.id, { onDelete: "set null" }),
    addressSnapshot: text("address_snapshot").notNull(),
    driverUserId: text("driver_user_id").references(() => user.id, { onDelete: "set null" }),
    driverName: text("driver_name").notNull(),

    /** Idempotency key from the phone, so offline retries never double-log. */
    clientId: text("client_id").notNull(),
    startedAt: timestamp("started_at", tz).notNull(),
    completedAt: timestamp("completed_at", tz).notNull(),
    receivedAt: timestamp("received_at", tz).defaultNow().notNull(),

    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    accuracyM: doublePrecision("accuracy_m"),
    /** Meters between the phone and the geocoded property at completion. */
    distanceM: doublePrecision("distance_m"),

    photos: jsonb("photos").$type<PhotoRef[]>().notNull().default([]),
    notes: text("notes"),

    recordHash: text("record_hash").notNull(),
    /** Unguessable token for the public proof page /p/[token]. */
    proofToken: text("proof_token").notNull(),
    anchorId: text("anchor_id").references(() => anchor.id, { onDelete: "set null" }),

    /** Delivery status of the proof email. Not part of recordHash; safe to update. */
    customerEmailedAt: timestamp("customer_emailed_at", tz),
    customerEmailError: text("customer_email_error"),
    customerTextedAt: timestamp("customer_texted_at", tz),
    customerTextError: text("customer_text_error"),
  },
  (t) => [
    index("service_event_org_storm_idx").on(t.organizationId, t.stormId),
    index("service_event_customer_idx").on(t.customerId),
    uniqueIndex("service_event_org_client_uidx").on(t.organizationId, t.clientId),
    uniqueIndex("service_event_proof_token_uidx").on(t.proofToken),
  ],
);

/** A batch of service records whose Merkle root was written to Solana in one memo transaction. */
export const anchor = pgTable(
  "anchor",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    stormId: text("storm_id")
      .notNull()
      .references(() => storm.id, { onDelete: "cascade" }),
    merkleRoot: text("merkle_root").notNull(),
    /** Record hashes in tree order. Stored so any single record's proof can be rebuilt later. */
    leaves: jsonb("leaves").$type<string[]>().notNull(),
    memo: text("memo").notNull(),
    cluster: text("cluster").notNull(),
    /** pending | confirmed | failed */
    status: text("status").notNull().default("pending"),
    txSignature: text("tx_signature"),
    error: text("error"),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at", tz),
  },
  (t) => [index("anchor_org_storm_idx").on(t.organizationId, t.stormId)],
);

export const stormRelations = relations(storm, ({ many }) => ({
  events: many(serviceEvent),
  anchors: many(anchor),
}));

export const serviceEventRelations = relations(serviceEvent, ({ one }) => ({
  storm: one(storm, { fields: [serviceEvent.stormId], references: [storm.id] }),
  customer: one(customer, { fields: [serviceEvent.customerId], references: [customer.id] }),
  anchor: one(anchor, { fields: [serviceEvent.anchorId], references: [anchor.id] }),
}));

export type Storm = typeof storm.$inferSelect;
export type ServiceEvent = typeof serviceEvent.$inferSelect;
export type Anchor = typeof anchor.$inferSelect;

export type Customer = typeof customer.$inferSelect;
export type NewCustomer = typeof customer.$inferInsert;
