ALTER TABLE `trips` ADD `public_show_details` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `calendar_token` text;--> statement-breakpoint
ALTER TABLE `users` ADD `calendar_token_expires_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_calendar_token_unique` ON `users` (`calendar_token`);