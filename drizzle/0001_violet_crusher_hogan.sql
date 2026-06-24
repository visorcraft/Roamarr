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
	CONSTRAINT "segments_type_ck" CHECK("__new_segments"."type" in ('flight','lodging','car','rail','activity','cruise'))
);
--> statement-breakpoint
INSERT INTO `__new_segments`("id", "trip_id", "type", "title", "start_at", "start_tz", "end_at", "location", "confirmation_number", "details_json", "card_id", "created_at", "updated_at") SELECT "id", "trip_id", "type", "title", "start_at", "start_tz", "end_at", "location", "confirmation_number", "details_json", "card_id", "created_at", "updated_at" FROM `segments`;--> statement-breakpoint
DROP TABLE `segments`;--> statement-breakpoint
ALTER TABLE `__new_segments` RENAME TO `segments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `segments_trip_idx` ON `segments` (`trip_id`);--> statement-breakpoint
CREATE INDEX `segments_start_idx` ON `segments` (`start_at`);--> statement-breakpoint
ALTER TABLE `settings` ADD `default_flight_checkin_lead_hours` integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `default_document_expiry_lead_days` integer DEFAULT 90 NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`flight_checkin_lead_hours` integer DEFAULT 24 NOT NULL,
	`document_expiry_lead_days` integer DEFAULT 90 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "users_role_ck" CHECK("__new_users"."role" in ('admin','user')),
	CONSTRAINT "users_flight_lead_ck" CHECK("__new_users"."flight_checkin_lead_hours" >= 0),
	CONSTRAINT "users_doc_lead_ck" CHECK("__new_users"."document_expiry_lead_days" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "password_hash", "display_name", "role", "timezone", "flight_checkin_lead_hours", "document_expiry_lead_days", "created_at") SELECT "id", "email", "password_hash", "display_name", "role", "timezone", 24, 90, "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);