CREATE TABLE "scheduled_rooms" (
	"name" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"opener" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"booking" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_rooms_booking_unique" UNIQUE("booking")
);
