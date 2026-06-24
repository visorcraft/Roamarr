CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_user_idx` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_trip_shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`shared_with_user_id` integer,
	`shared_with_group_id` integer,
	`permission` text DEFAULT 'read' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shares_one_target_ck" CHECK(("__new_trip_shares"."shared_with_user_id" is not null) <> ("__new_trip_shares"."shared_with_group_id" is not null)),
	CONSTRAINT "shares_perm_ck" CHECK("__new_trip_shares"."permission" in ('read','edit'))
);
--> statement-breakpoint
INSERT INTO `__new_trip_shares`("id", "trip_id", "shared_with_user_id", "shared_with_group_id", "permission", "created_at") SELECT "id", "trip_id", "shared_with_user_id", "shared_with_group_id", "permission", "created_at" FROM `trip_shares`;--> statement-breakpoint
DROP TABLE `trip_shares`;--> statement-breakpoint
ALTER TABLE `__new_trip_shares` RENAME TO `trip_shares`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `shares_trip_user_uq` ON `trip_shares` (`trip_id`,`shared_with_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shares_trip_group_uq` ON `trip_shares` (`trip_id`,`shared_with_group_id`);--> statement-breakpoint
CREATE INDEX `shares_user_idx` ON `trip_shares` (`shared_with_user_id`);--> statement-breakpoint
CREATE INDEX `shares_group_idx` ON `trip_shares` (`shared_with_group_id`);--> statement-breakpoint
ALTER TABLE `settings` ADD `webhook_url` text;--> statement-breakpoint
ALTER TABLE `trips` ADD `calendar_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `trips_calendar_token_unique` ON `trips` (`calendar_token`);--> statement-breakpoint
ALTER TABLE `users` ADD `disabled` integer DEFAULT false NOT NULL;