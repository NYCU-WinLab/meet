ALTER TABLE "livekit_events" ADD COLUMN "member" boolean;--> statement-breakpoint
ALTER TABLE "livekit_events" ADD COLUMN "egress_file_started_at" timestamp with time zone;