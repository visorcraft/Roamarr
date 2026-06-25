ALTER TABLE `trip_budget_categories` ADD `currency` text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `default_currency` text DEFAULT 'USD' NOT NULL;