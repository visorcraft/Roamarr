PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`start_at` text NOT NULL,
	`start_tz` text DEFAULT 'UTC' NOT NULL,
	`end_at` text,
	`location` text,
	`confirmation_number` text,
	`details_json` text,
	`card_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "segments_type_ck" CHECK("__new_segments"."type" in ('flight','lodging','car','rail','activity','cruise','event','hotel','rental_car','note','todo','parking','boat','train','directions','food','poi','meetup','rideshare','shuttle'))
);
--> statement-breakpoint
INSERT INTO `__new_segments`("id", "trip_id", "type", "title", "start_at", "start_tz", "end_at", "location", "confirmation_number", "details_json", "card_id", "created_at", "updated_at") SELECT "id", "trip_id", "type", "title", "start_at", "start_tz", "end_at", "location", "confirmation_number", "details_json", "card_id", "created_at", "updated_at" FROM `segments`;--> statement-breakpoint
DROP TABLE `segments`;--> statement-breakpoint
ALTER TABLE `__new_segments` RENAME TO `segments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `segments_trip_idx` ON `segments` (`trip_id`);--> statement-breakpoint
CREATE INDEX `segments_start_idx` ON `segments` (`start_at`);