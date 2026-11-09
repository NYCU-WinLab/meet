CREATE TABLE "guest_links" (
	"id" text PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"room" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_links_secretHash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
CREATE INDEX "guest_links_room_idx" ON "guest_links" USING btree ("room");