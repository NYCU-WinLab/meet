CREATE TABLE "live_summaries" (
	"room" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	CONSTRAINT "live_summaries_room_started_at_pk" PRIMARY KEY("room","started_at")
);
--> statement-breakpoint
CREATE INDEX "live_summaries_room_idx" ON "live_summaries" USING btree ("room");