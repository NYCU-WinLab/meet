CREATE TABLE "guest_joins" (
	"id" serial PRIMARY KEY NOT NULL,
	"link_id" text NOT NULL,
	"name" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_links" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_joins" ADD CONSTRAINT "guest_joins_link_id_guest_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."guest_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_joins_link_idx" ON "guest_joins" USING btree ("link_id");