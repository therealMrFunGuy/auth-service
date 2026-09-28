ALTER TABLE "customer" ADD COLUMN "email_proof" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "service_event" ADD COLUMN "customer_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_event" ADD COLUMN "customer_email_error" text;