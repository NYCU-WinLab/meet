CREATE TABLE "recordings" (
	"id" text PRIMARY KEY NOT NULL,
	"room" text NOT NULL,
	"title" text NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"opener" text DEFAULT '' NOT NULL,
	"booking" text DEFAULT '' NOT NULL,
	"folder" text NOT NULL,
	"stem" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "recordings_room_idx" ON "recordings" USING btree ("room");--> statement-breakpoint
CREATE INDEX "recordings_started_at_idx" ON "recordings" USING btree ("started_at");