CREATE TABLE `trip_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_comments_trip_idx` ON `trip_comments` (`trip_id`);--> statement-breakpoint
ALTER TABLE `trips` ADD `public_token_expires_at` text;--> statement-breakpoint
ALTER TABLE `trips` ADD `calendar_token_expires_at` text;