CREATE TABLE `trip_entry_requirements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`country` text NOT NULL,
	`requirement_type` text NOT NULL,
	`status` text DEFAULT 'needed' NOT NULL,
	`due_date` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entry_req_type_ck" CHECK("trip_entry_requirements"."requirement_type" in ('visa','vaccination','other')),
	CONSTRAINT "entry_req_status_ck" CHECK("trip_entry_requirements"."status" in ('needed','in_progress','complete','not_needed'))
);
--> statement-breakpoint
CREATE INDEX `entry_req_trip_idx` ON `trip_entry_requirements` (`trip_id`);--> statement-breakpoint
CREATE TABLE `trip_expense_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expense_id` integer NOT NULL,
	`filename` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `trip_expenses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_expense_attachments_storage_key_unique` ON `trip_expense_attachments` (`storage_key`);--> statement-breakpoint
CREATE TABLE `trip_home_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`text` text NOT NULL,
	`due_date` text,
	`done` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trip_important_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`companion_id` integer,
	`name` text NOT NULL,
	`serial_number` text,
	`tracker_id` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_id`) REFERENCES `trip_companions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `trip_medications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`companion_id` integer,
	`name` text NOT NULL,
	`dosage` text,
	`schedule` text,
	`starts_at` text,
	`ends_at` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_id`) REFERENCES `trip_companions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `trip_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`source_trip_id` integer,
	`snapshot_json` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`start_at` text NOT NULL,
	`start_tz` text DEFAULT 'UTC' NOT NULL,
	`end_at` text,
	`end_tz` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`location` text,
	`confirmation_number` text,
	`details_json` text,
	`meeting_point` text,
	`meeting_at` text,
	`payment_status` text DEFAULT 'quoted' NOT NULL,
	`payment_due_date` text,
	`card_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "segments_type_ck" CHECK("__new_segments"."type" in ('flight','event','hotel','rental_car','note','todo','parking','boat','train','directions','food','poi','meetup','rideshare','shuttle')),
	CONSTRAINT "segments_status_ck" CHECK("__new_segments"."status" in ('planned','checked_in','boarded','arrived','completed')),
	CONSTRAINT "segments_payment_status_ck" CHECK("__new_segments"."payment_status" in ('quoted','deposit_paid','fully_paid','refunded'))
);
--> statement-breakpoint
INSERT INTO `__new_segments`("id", "trip_id", "type", "title", "start_at", "start_tz", "end_at", "end_tz", "status", "location", "confirmation_number", "details_json", "meeting_point", "meeting_at", "payment_status", "payment_due_date", "card_id", "created_at", "updated_at") SELECT "id", "trip_id", "type", "title", "start_at", "start_tz", "end_at", "end_tz", "status", "location", "confirmation_number", "details_json", "meeting_point", "meeting_at", 'quoted', NULL, "card_id", "created_at", "updated_at" FROM `segments`;--> statement-breakpoint
DROP TABLE `segments`;--> statement-breakpoint
ALTER TABLE `__new_segments` RENAME TO `segments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `segments_trip_idx` ON `segments` (`trip_id`);--> statement-breakpoint
CREATE INDEX `segments_start_idx` ON `segments` (`start_at`);--> statement-breakpoint
CREATE TABLE `__new_trip_companions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'adult' NOT NULL,
	`dietary` text,
	`allergies` text,
	`medical_notes` text,
	`needs_car_seat` integer DEFAULT false NOT NULL,
	`needs_stroller` integer DEFAULT false NOT NULL,
	`needs_crib` integer DEFAULT false NOT NULL,
	`needs_kids_meal` integer DEFAULT false NOT NULL,
	`child_ticket_discount` text,
	`seat_preference` text,
	`bed_preference` text,
	`accessibility_needs` text,
	`room_notes` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "companions_cat_ck" CHECK("__new_trip_companions"."category" in ('adult','child','other')),
	CONSTRAINT "companions_seat_ck" CHECK("__new_trip_companions"."seat_preference" is null or "__new_trip_companions"."seat_preference" in ('aisle','window','middle','none')),
	CONSTRAINT "companions_bed_ck" CHECK("__new_trip_companions"."bed_preference" is null or "__new_trip_companions"."bed_preference" in ('king','queen','twin','two_doubles','other'))
);
--> statement-breakpoint
INSERT INTO `__new_trip_companions`("id", "trip_id", "name", "category", "dietary", "allergies", "medical_notes", "needs_car_seat", "needs_stroller", "needs_crib", "needs_kids_meal", "child_ticket_discount", "seat_preference", "bed_preference", "accessibility_needs", "room_notes", "notes", "created_at") SELECT "id", "trip_id", "name", "category", "dietary", "allergies", "medical_notes", 0, 0, 0, 0, NULL, NULL, NULL, NULL, NULL, "notes", "created_at" FROM `trip_companions`;--> statement-breakpoint
DROP TABLE `trip_companions`;--> statement-breakpoint
ALTER TABLE `__new_trip_companions` RENAME TO `trip_companions`;--> statement-breakpoint
CREATE INDEX `companions_trip_idx` ON `trip_companions` (`trip_id`);--> statement-breakpoint
ALTER TABLE `trip_expenses` ADD `exchange_rate` integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE `trip_expenses` ADD `base_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trips` ADD `base_currency` text DEFAULT 'USD' NOT NULL;