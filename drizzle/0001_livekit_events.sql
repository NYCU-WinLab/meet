CREATE TABLE "livekit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"room" text,
	"room_sid" text,
	"participant" text,
	"participant_seconds" integer,
	"egress_id" text,
	"egress_status" text,
	"egress_seconds" integer,
	"egress_bytes" bigint,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "livekit_events_at_idx" ON "livekit_events" USING btree ("at");