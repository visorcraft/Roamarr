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
CREATE TABLE `benefit_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`benefit_type` text NOT NULL,
	`name` text NOT NULL,
	`coverage_amount` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`description` text,
	CONSTRAINT "benefit_template_type_ck" CHECK("benefit_templates"."benefit_type" in ('trip_delay', 'baggage_delay', 'trip_cancellation', 'other'))
);
--> statement-breakpoint
CREATE TABLE `card_benefits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`benefit_type` text NOT NULL,
	`coverage_amount` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`notes` text,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "benefit_type_ck" CHECK("card_benefits"."benefit_type" in ('trip_delay', 'baggage_delay', 'trip_cancellation', 'other'))
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
	CONSTRAINT "cards_net_ck" CHECK("cards"."network" in ('visa', 'mc', 'amex', 'disc', 'other'))
);
--> statement-breakpoint
CREATE INDEX `cards_user_idx` ON `cards` (`user_id`);--> statement-breakpoint
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
CREATE TABLE `fare_providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider_key` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`api_key` text,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fare_providers_user_idx` ON `fare_providers` (`user_id`);--> statement-breakpoint
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
	CONSTRAINT "watch_status_ck" CHECK("fare_watches"."status" in ('active', 'paused'))
);
--> statement-breakpoint
CREATE INDEX `watch_provider_idx` ON `fare_watches` (`provider_id`);--> statement-breakpoint
CREATE INDEX `watch_status_idx` ON `fare_watches` (`status`);--> statement-breakpoint
CREATE INDEX `watch_trip_idx` ON `fare_watches` (`trip_id`);--> statement-breakpoint
CREATE INDEX `watch_segment_idx` ON `fare_watches` (`segment_id`);--> statement-breakpoint
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
CREATE INDEX `groups_owner_idx` ON `groups` (`owner_id`);--> statement-breakpoint
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
CREATE INDEX `ins_user_idx` ON `insurance_policies` (`user_id`);--> statement-breakpoint
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
	CONSTRAINT "rem_kind_ck" CHECK("reminders"."kind" in ('flight_checkin', 'document_expiry', 'custom')),
	CONSTRAINT "rem_ref_ck" CHECK("reminders"."ref_type" in ('segment', 'document', 'trip')),
	CONSTRAINT "rem_stat_ck" CHECK("reminders"."status" in ('pending', 'sending', 'sent'))
);
--> statement-breakpoint
CREATE INDEX `rem_due_idx` ON `reminders` (`status`,`fire_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `rem_source_uq` ON `reminders` (`kind`,`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `scheduler_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`success` integer DEFAULT false NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `scheduler_runs_started_idx` ON `scheduler_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `segment_attendees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`segment_id` integer NOT NULL,
	`companion_id` integer NOT NULL,
	`status` text DEFAULT 'going' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_id`) REFERENCES `trip_companions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attendee_status_ck" CHECK("segment_attendees"."status" in ('going', 'maybe', 'not_going'))
);
--> statement-breakpoint
CREATE INDEX `attendees_segment_idx` ON `segment_attendees` (`segment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attendee_segment_companion_uq` ON `segment_attendees` (`segment_id`,`companion_id`);--> statement-breakpoint
CREATE TABLE `segments` (
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
	CONSTRAINT "segments_type_ck" CHECK("segments"."type" in ('flight', 'event', 'hotel', 'rental_car', 'note', 'todo', 'parking', 'boat', 'train', 'directions', 'food', 'poi', 'meetup', 'rideshare', 'shuttle')),
	CONSTRAINT "segments_status_ck" CHECK("segments"."status" in ('planned', 'checked_in', 'boarded', 'arrived', 'completed')),
	CONSTRAINT "segments_payment_status_ck" CHECK("segments"."payment_status" in ('quoted', 'deposit_paid', 'fully_paid', 'refunded'))
);
--> statement-breakpoint
CREATE INDEX `segments_trip_idx` ON `segments` (`trip_id`);--> statement-breakpoint
CREATE INDEX `segments_start_idx` ON `segments` (`start_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`last_ip` text,
	`user_agent` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`instance_name` text DEFAULT 'Roamarr' NOT NULL,
	`setup_complete` integer DEFAULT false NOT NULL,
	`allow_registration` integer DEFAULT false NOT NULL,
	`default_timezone` text DEFAULT 'UTC' NOT NULL,
	`default_currency` text DEFAULT 'USD' NOT NULL,
	`default_flight_checkin_lead_hours` integer DEFAULT 24 NOT NULL,
	`default_document_expiry_lead_days` integer DEFAULT 90 NOT NULL,
	`smtp_host` text,
	`smtp_port` integer,
	`smtp_user` text,
	`smtp_pass` text,
	`smtp_from` text,
	`webhook_url` text
);
--> statement-breakpoint
CREATE TABLE `travel_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`companion_id` integer,
	`type` text NOT NULL,
	`number` text,
	`issuing_authority` text,
	`expires_on` text,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_id`) REFERENCES `trip_companions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "docs_type_ck" CHECK("travel_documents"."type" in ('passport', 'drivers_license', 'global_entry', 'visa'))
);
--> statement-breakpoint
CREATE INDEX `docs_user_exp_idx` ON `travel_documents` (`user_id`,`expires_on`);--> statement-breakpoint
CREATE INDEX `docs_companion_idx` ON `travel_documents` (`companion_id`);--> statement-breakpoint
CREATE TABLE `trip_budget_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`category` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trip_budget_categories_trip_idx` ON `trip_budget_categories` (`trip_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trip_budget_categories_trip_category_uq` ON `trip_budget_categories` (`trip_id`,`category`);--> statement-breakpoint
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
CREATE TABLE `trip_companions` (
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
	CONSTRAINT "companions_cat_ck" CHECK("trip_companions"."category" in ('adult', 'child', 'other')),
	CONSTRAINT "companions_seat_ck" CHECK("trip_companions"."seat_preference" is null or "trip_companions"."seat_preference" in ('aisle', 'window', 'middle', 'none')),
	CONSTRAINT "companions_bed_ck" CHECK("trip_companions"."bed_preference" is null or "trip_companions"."bed_preference" in ('king', 'queen', 'twin', 'two_doubles', 'other'))
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
	CONSTRAINT "entry_req_type_ck" CHECK("trip_entry_requirements"."requirement_type" in ('visa', 'vaccination', 'other')),
	CONSTRAINT "entry_req_status_ck" CHECK("trip_entry_requirements"."status" in ('needed', 'in_progress', 'complete', 'not_needed'))
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
CREATE INDEX `expense_attachments_expense_idx` ON `trip_expense_attachments` (`expense_id`);--> statement-breakpoint
CREATE TABLE `trip_expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`category` text DEFAULT 'other',
	`exchange_rate` integer DEFAULT 10000 NOT NULL,
	`base_amount` integer DEFAULT 0 NOT NULL,
	`paid_by_companion_id` integer,
	`split_among` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paid_by_companion_id`) REFERENCES `trip_companions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "expenses_category_ck" CHECK("trip_expenses"."category" in ('lodging', 'transport', 'food', 'activities', 'other'))
);
--> statement-breakpoint
CREATE INDEX `expenses_trip_idx` ON `trip_expenses` (`trip_id`);--> statement-breakpoint
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
CREATE INDEX `home_tasks_trip_idx` ON `trip_home_tasks` (`trip_id`);--> statement-breakpoint
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
CREATE INDEX `important_items_trip_idx` ON `trip_important_items` (`trip_id`);--> statement-breakpoint
CREATE INDEX `important_items_companion_idx` ON `trip_important_items` (`companion_id`);--> statement-breakpoint
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
CREATE INDEX `medications_trip_idx` ON `trip_medications` (`trip_id`);--> statement-breakpoint
CREATE INDEX `medications_companion_idx` ON `trip_medications` (`companion_id`);--> statement-breakpoint
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
CREATE TABLE `trip_shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`shared_with_user_id` integer,
	`shared_with_group_id` integer,
	`permission` text DEFAULT 'read' NOT NULL,
	`show_details` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shares_one_target_ck" CHECK(("trip_shares"."shared_with_user_id" is not null) <> ("trip_shares"."shared_with_group_id" is not null)),
	CONSTRAINT "shares_perm_ck" CHECK("trip_shares"."permission" in ('read', 'edit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_trip_user_uq` ON `trip_shares` (`trip_id`,`shared_with_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shares_trip_group_uq` ON `trip_shares` (`trip_id`,`shared_with_group_id`);--> statement-breakpoint
CREATE INDEX `shares_user_idx` ON `trip_shares` (`shared_with_user_id`);--> statement-breakpoint
CREATE INDEX `shares_group_idx` ON `trip_shares` (`shared_with_group_id`);--> statement-breakpoint
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
CREATE INDEX `trip_templates_user_idx` ON `trip_templates` (`user_id`);--> statement-breakpoint
CREATE INDEX `trip_templates_source_idx` ON `trip_templates` (`source_trip_id`);--> statement-breakpoint
CREATE TABLE `trips` (
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
	`base_currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'booked' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "trips_vis_ck" CHECK("trips"."default_visibility" in ('private', 'groups', 'public')),
	CONSTRAINT "trips_status_ck" CHECK("trips"."status" in ('planning', 'booked', 'active', 'completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trips_public_token_unique` ON `trips` (`public_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `trips_calendar_token_unique` ON `trips` (`calendar_token`);--> statement-breakpoint
CREATE INDEX `trips_owner_idx` ON `trips` (`owner_id`);--> statement-breakpoint
CREATE INDEX `trips_start_idx` ON `trips` (`start_date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`must_reset_password` integer DEFAULT false NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`flight_checkin_lead_hours` integer DEFAULT 24 NOT NULL,
	`document_expiry_lead_days` integer DEFAULT 90 NOT NULL,
	`email_notifications` integer DEFAULT true NOT NULL,
	`webhook_notifications` integer DEFAULT true NOT NULL,
	`theme_id` text DEFAULT 'midnight-travels' NOT NULL,
	`default_currency` text DEFAULT 'USD' NOT NULL,
	`calendar_token` text,
	`calendar_token_expires_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "users_role_ck" CHECK("users"."role" in ('admin', 'user')),
	CONSTRAINT "users_flight_lead_ck" CHECK("users"."flight_checkin_lead_hours" >= 0),
	CONSTRAINT "users_doc_lead_ck" CHECK("users"."document_expiry_lead_days" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_calendar_token_unique` ON `users` (`calendar_token`);--> statement-breakpoint
INSERT INTO `benefit_templates` (`benefit_type`,`name`,`coverage_amount`,`currency`,`description`) VALUES
	('trip_delay','Trip delay reimbursement',50000,'USD','Reimburses meals, lodging and transport when a trip is delayed.'),
	('baggage_delay','Baggage delay reimbursement',10000,'USD','Reimburses essential purchases when checked baggage is delayed.'),
	('trip_cancellation','Trip cancellation reimbursement',100000,'USD','Reimburses non-refundable trip costs if you cancel for a covered reason.');
