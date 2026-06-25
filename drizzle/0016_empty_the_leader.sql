CREATE TABLE `packing_template_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`label` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `packing_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `packing_template_items_template_idx` ON `packing_template_items` (`template_id`);--> statement-breakpoint
CREATE TABLE `packing_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `packing_templates_user_idx` ON `packing_templates` (`user_id`);--> statement-breakpoint
CREATE TABLE `trip_budget_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`category` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_budget_categories_trip_idx` ON `trip_budget_categories` (`trip_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trip_budget_categories_trip_category_uq` ON `trip_budget_categories` (`trip_id`,`category`);--> statement-breakpoint
CREATE TABLE `trip_poll_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`poll_id` integer NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`poll_id`) REFERENCES `trip_polls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_poll_options_poll_idx` ON `trip_poll_options` (`poll_id`);--> statement-breakpoint
CREATE TABLE `trip_poll_votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`poll_id` integer NOT NULL,
	`option_id` integer NOT NULL,
	`companion_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`poll_id`) REFERENCES `trip_polls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`option_id`) REFERENCES `trip_poll_options`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_id`) REFERENCES `trip_companions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_poll_votes_poll_idx` ON `trip_poll_votes` (`poll_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trip_poll_votes_poll_companion_uq` ON `trip_poll_votes` (`poll_id`,`companion_id`);--> statement-breakpoint
CREATE TABLE `trip_polls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`question` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_polls_trip_idx` ON `trip_polls` (`trip_id`);--> statement-breakpoint
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
	`card_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "segments_type_ck" CHECK("__new_segments"."type" in ('flight','event','hotel','rental_car','note','todo','parking','boat','train','directions','food','poi','meetup','rideshare','shuttle')),
	CONSTRAINT "segments_status_ck" CHECK("__new_segments"."status" in ('planned','checked_in','boarded','arrived','completed'))
);
--> statement-breakpoint
INSERT INTO `__new_segments`("id", "trip_id", "type", "title", "start_at", "start_tz", "end_at", "location", "confirmation_number", "details_json", "card_id", "created_at", "updated_at") SELECT "id", "trip_id", "type", "title", "start_at", "start_tz", "end_at", "location", "confirmation_number", "details_json", "card_id", "created_at", "updated_at" FROM `segments`;--> statement-breakpoint
DROP TABLE `segments`;--> statement-breakpoint
ALTER TABLE `__new_segments` RENAME TO `segments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `segments_trip_idx` ON `segments` (`trip_id`);--> statement-breakpoint
CREATE INDEX `segments_start_idx` ON `segments` (`start_at`);--> statement-breakpoint
ALTER TABLE `travel_documents` ADD `companion_id` integer REFERENCES trip_companions(id) ON UPDATE no action ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `docs_companion_idx` ON `travel_documents` (`companion_id`);--> statement-breakpoint
ALTER TABLE `trip_companions` ADD `dietary` text;--> statement-breakpoint
ALTER TABLE `trip_companions` ADD `allergies` text;--> statement-breakpoint
ALTER TABLE `trip_companions` ADD `medical_notes` text;