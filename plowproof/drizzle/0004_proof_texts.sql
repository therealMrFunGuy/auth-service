ALTER TABLE "customer" ADD COLUMN "text_proof" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_event" ADD COLUMN "customer_texted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_event" ADD COLUMN "customer_text_error" text;