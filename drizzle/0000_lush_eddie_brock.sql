CREATE TABLE `card_benefits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`benefit_type` text NOT NULL,
	`coverage_amount` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`notes` text,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "benefit_type_ck" CHECK("card_benefits"."benefit_type" in ('trip_delay','baggage_delay','trip_cancellation','other'))
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`nickname` text NOT NULL,
	`network` text NOT NULL,
	`last4` text,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cards_net_ck" CHECK("cards"."network" in ('visa','mc','amex','disc','other'))
);
--> statement-breakpoint
CREATE INDEX `cards_user_idx` ON `cards` (`user_id`);--> statement-breakpoint
CREATE TABLE `fare_providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider_key` text NOT NULL,
	`api_key` text,
	`enabled` integer DEFAULT true NOT NULL,
	`config_json` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fare_provider_uq` ON `fare_providers` (`user_id`,`provider_key`);--> statement-breakpoint
CREATE TABLE `fare_watches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`segment_id` integer,
	`provider_id` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_checked_at` text,
	`last_result_json` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `fare_providers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "watch_status_ck" CHECK("fare_watches"."status" in ('active','paused'))
);
--> statement-breakpoint
CREATE INDEX `watch_provider_idx` ON `fare_watches` (`provider_id`);--> statement-breakpoint
CREATE INDEX `watch_status_idx` ON `fare_watches` (`status`);--> statement-breakpoint
CREATE TABLE `group_members` (
	`group_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gm_user_idx` ON `group_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `insurance_policies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`policy_number` text,
	`coverage_summary` text,
	`coverage_amount` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`start_date` text,
	`end_date` text,
	`trip_id` integer,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ins_trip_idx` ON `insurance_policies` (`trip_id`);--> statement-breakpoint
CREATE TABLE `loyalty_programs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`program_name` text NOT NULL,
	`membership_number` text,
	`balance` integer,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `loyalty_user_idx` ON `loyalty_programs` (`user_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`read_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notif_user_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` integer NOT NULL,
	`fire_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`sent_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rem_kind_ck" CHECK("reminders"."kind" in ('flight_checkin','document_expiry')),
	CONSTRAINT "rem_ref_ck" CHECK("reminders"."ref_type" in ('segment','document')),
	CONSTRAINT "rem_stat_ck" CHECK("reminders"."status" in ('pending','sending','sent'))
);
--> statement-breakpoint
CREATE INDEX `rem_due_idx` ON `reminders` (`status`,`fire_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `rem_source_uq` ON `reminders` (`kind`,`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `segments` (
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
	CONSTRAINT "segments_type_ck" CHECK("segments"."type" in ('flight','lodging'))
);
--> statement-breakpoint
CREATE INDEX `segments_trip_idx` ON `segments` (`trip_id`);--> statement-breakpoint
CREATE INDEX `segments_start_idx` ON `segments` (`start_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`instance_name` text DEFAULT 'Roamarr' NOT NULL,
	`setup_complete` integer DEFAULT false NOT NULL,
	`allow_registration` integer DEFAULT false NOT NULL,
	`default_timezone` text DEFAULT 'UTC' NOT NULL,
	`smtp_host` text,
	`smtp_port` integer,
	`smtp_user` text,
	`smtp_pass` text,
	`smtp_from` text
);
--> statement-breakpoint
CREATE TABLE `travel_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`number` text,
	`issuing_authority` text,
	`expires_on` text,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "docs_type_ck" CHECK("travel_documents"."type" in ('passport','drivers_license','global_entry'))
);
--> statement-breakpoint
CREATE INDEX `docs_user_exp_idx` ON `travel_documents` (`user_id`,`expires_on`);--> statement-breakpoint
CREATE TABLE `trip_shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`shared_with_user_id` integer,
	`shared_with_group_id` integer,
	`permission` text DEFAULT 'read' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shares_one_target_ck" CHECK(("trip_shares"."shared_with_user_id" is not null) <> ("trip_shares"."shared_with_group_id" is not null)),
	CONSTRAINT "shares_perm_ck" CHECK("trip_shares"."permission" in ('read'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_trip_user_uq` ON `trip_shares` (`trip_id`,`shared_with_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shares_trip_group_uq` ON `trip_shares` (`trip_id`,`shared_with_group_id`);--> statement-breakpoint
CREATE INDEX `shares_user_idx` ON `trip_shares` (`shared_with_user_id`);--> statement-breakpoint
CREATE INDEX `shares_group_idx` ON `trip_shares` (`shared_with_group_id`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`destination` text,
	`start_date` text,
	`end_date` text,
	`notes` text,
	`default_visibility` text DEFAULT 'private' NOT NULL,
	`public_token` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "trips_vis_ck" CHECK("trips"."default_visibility" in ('private','groups','public'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trips_public_token_unique` ON `trips` (`public_token`);--> statement-breakpoint
CREATE INDEX `trips_owner_idx` ON `trips` (`owner_id`);--> statement-breakpoint
CREATE INDEX `trips_start_idx` ON `trips` (`start_date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "users_role_ck" CHECK("users"."role" in ('admin','user'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);