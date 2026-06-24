CREATE TABLE `password_reset_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_token_hash_unique` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `scheduler_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`success` integer DEFAULT false NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `scheduler_runs_started_idx` ON `scheduler_runs` (`started_at`);--> statement-breakpoint
DROP INDEX `fare_provider_uq`;--> statement-breakpoint
ALTER TABLE `fare_providers` ADD `label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trip_shares` ADD `show_details` integer DEFAULT false NOT NULL;