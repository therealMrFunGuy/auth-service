CREATE TABLE "anchor" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"storm_id" text NOT NULL,
	"merkle_root" text NOT NULL,
	"leaves" jsonb NOT NULL,
	"memo" text NOT NULL,
	"cluster" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_signature" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"storm_id" text NOT NULL,
	"customer_id" text,
	"address_snapshot" text NOT NULL,
	"driver_user_id" text,
	"driver_name" text NOT NULL,
	"client_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"accuracy_m" double precision,
	"distance_m" double precision,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"record_hash" text NOT NULL,
	"proof_token" text NOT NULL,
	"anchor_id" text
);
--> statement-breakpoint
CREATE TABLE "storm" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"snowfall_inches" double precision,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anchor" ADD CONSTRAINT "anchor_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anchor" ADD CONSTRAINT "anchor_storm_id_storm_id_fk" FOREIGN KEY ("storm_id") REFERENCES "public"."storm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_event" ADD CONSTRAINT "service_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_event" ADD CONSTRAINT "service_event_storm_id_storm_id_fk" FOREIGN KEY ("storm_id") REFERENCES "public"."storm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_event" ADD CONSTRAINT "service_event_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_event" ADD CONSTRAINT "service_event_driver_user_id_user_id_fk" FOREIGN KEY ("driver_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_event" ADD CONSTRAINT "service_event_anchor_id_anchor_id_fk" FOREIGN KEY ("anchor_id") REFERENCES "public"."anchor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storm" ADD CONSTRAINT "storm_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anchor_org_storm_idx" ON "anchor" USING btree ("organization_id","storm_id");--> statement-breakpoint
CREATE INDEX "service_event_org_storm_idx" ON "service_event" USING btree ("organization_id","storm_id");--> statement-breakpoint
CREATE INDEX "service_event_customer_idx" ON "service_event" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_event_org_client_uidx" ON "service_event" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_event_proof_token_uidx" ON "service_event" USING btree ("proof_token");--> statement-breakpoint
CREATE INDEX "storm_org_idx" ON "storm" USING btree ("organization_id","started_at");