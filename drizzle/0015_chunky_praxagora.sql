CREATE TABLE `emergency_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`relationship` text,
	`phone` text,
	`email` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `emergency_contacts_user_idx` ON `emergency_contacts` (`user_id`);--> statement-breakpoint
CREATE TABLE `segment_attendees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`segment_id` integer NOT NULL,
	`companion_id` integer NOT NULL,
	`status` text DEFAULT 'going' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_id`) REFERENCES `trip_companions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attendee_status_ck" CHECK("segment_attendees"."status" in ('going','maybe','not_going'))
);
--> statement-breakpoint
CREATE INDEX `attendees_segment_idx` ON `segment_attendees` (`segment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attendee_segment_companion_uq` ON `segment_attendees` (`segment_id`,`companion_id`);--> statement-breakpoint
CREATE TABLE `trip_checklist_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`checklist_id` integer NOT NULL,
	`text` text NOT NULL,
	`packed` integer DEFAULT false NOT NULL,
	`assigned_to_companion_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`checklist_id`) REFERENCES `trip_checklists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_to_companion_id`) REFERENCES `trip_companions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `checklist_items_checklist_idx` ON `trip_checklist_items` (`checklist_id`);--> statement-breakpoint
CREATE TABLE `trip_checklists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checklist_trip_uq` ON `trip_checklists` (`trip_id`);--> statement-breakpoint
CREATE TABLE `trip_companions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'adult' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "companions_cat_ck" CHECK("trip_companions"."category" in ('adult','child','other'))
);
--> statement-breakpoint
CREATE INDEX `companions_trip_idx` ON `trip_companions` (`trip_id`);--> statement-breakpoint
CREATE TABLE `trip_document_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `doc_links_trip_idx` ON `trip_document_links` (`trip_id`);--> statement-breakpoint
CREATE TABLE `trip_expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`paid_by_companion_id` integer,
	`split_among` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paid_by_companion_id`) REFERENCES `trip_companions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `expenses_trip_idx` ON `trip_expenses` (`trip_id`);--> statement-breakpoint
CREATE TABLE `trip_journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`entry_date` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `journal_trip_idx` ON `trip_journal_entries` (`trip_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_trips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`destination` text,
	`start_date` text,
	`end_date` text,
	`notes` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`default_visibility` text DEFAULT 'private' NOT NULL,
	`public_token` text,
	`public_token_expires_at` text,
	`public_show_details` integer DEFAULT false NOT NULL,
	`calendar_token` text,
	`calendar_token_expires_at` text,
	`status` text DEFAULT 'booked' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "trips_vis_ck" CHECK("__new_trips"."default_visibility" in ('private','groups','public')),
	CONSTRAINT "trips_status_ck" CHECK("__new_trips"."status" in ('planning','booked','active','completed'))
);
--> statement-breakpoint
INSERT INTO `__new_trips`("id", "owner_id", "name", "destination", "start_date", "end_date", "notes", "tags", "archived", "favorite", "default_visibility", "public_token", "public_token_expires_at", "public_show_details", "calendar_token", "calendar_token_expires_at", "status", "created_at", "updated_at") SELECT "id", "owner_id", "name", "destination", "start_date", "end_date", "notes", "tags", "archived", "favorite", "default_visibility", "public_token", "public_token_expires_at", "public_show_details", "calendar_token", "calendar_token_expires_at", 'booked', "created_at", "updated_at" FROM `trips`;--> statement-breakpoint
DROP TABLE `trips`;--> statement-breakpoint
ALTER TABLE `__new_trips` RENAME TO `trips`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `trips_public_token_unique` ON `trips` (`public_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `trips_calendar_token_unique` ON `trips` (`calendar_token`);--> statement-breakpoint
CREATE INDEX `trips_owner_idx` ON `trips` (`owner_id`);--> statement-breakpoint
CREATE INDEX `trips_start_idx` ON `trips` (`start_date`);