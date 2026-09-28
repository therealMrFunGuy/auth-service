CREATE TABLE "company_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"timezone" text NOT NULL,
	"yard_address" text,
	"yard_lat" double precision,
	"yard_lng" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;